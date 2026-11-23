import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../lib/prisma';
import accountingRouter from '../../routes/accounting';
import partnerAccountingRouter from '../../routes/partner-accounting';
import dispatchCreditRouter from '../../routes/dispatchCredit';
import logisticsRouter from '../../routes/logistics';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

async function main() {
  const url = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.match(url.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
  const expected = JSON.parse(process.env.PARTNER_TEST_OWNER!);
  const requesterId = process.env.PARTNER_TEST_ACTOR_ID!;
  const managerId = process.env.PARTNER_TEST_MANAGER_ID;
  const invoiceId = process.env.PARTNER_TEST_INVOICE_ID;
  const logisticsId = process.env.PARTNER_TEST_LOADING_ACTOR_ID!;
  const sale = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { id: expected.caseId }, include: { customerContract: true, head: true, profile: true } });
  const issueSession = (actorId: string) => createAuthoritativeSession(prisma, actorId, {
    ipAddress: '127.0.0.1', userAgent: 'isolated-partner-alternative-loading',
  });
  const [requester, manager, logistics] = await Promise.all([issueSession(requesterId), managerId && issueSession(managerId), issueSession(logisticsId)]);
  const app = express();
  app.use(express.json());
  app.use('/accounting', accountingRouter);
  app.use('/partner/accounting', partnerAccountingRouter);
  app.use('/dispatch-credit', dispatchCreditRouter);
  app.use('/logistics', logisticsRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const request = async (path: string, token: string, body?: unknown, key = 'alternative-loading') => {
      const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
        method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}`,
          'Idempotency-Key': key, 'X-Correlation-Id': key, Connection: 'close' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() as any };
    };
    const load = (path: string, body?: unknown, key?: string) => request(`/logistics${path}`, logistics.token, body, key);
    const projectsPath = `/customers/${sale.customerId}/projects`;
    const customersPath = '/customers?search=Customer%20Lifecycle';
    const selection = { sourceKind: 'PARTNER_CASE', expected, deliveryId: 'separate-delivery' };
    const assertHidden = async (key: string) => {
      for (const path of [customersPath, projectsPath]) {
        const response = await load(path);
        assert.equal(response.status, 200, JSON.stringify(response.body));
        assert.deepEqual(response.body.data, []);
      }
      assert.equal((await load('/loadings', selection, key)).status, 409);
    };
    const baselines = () => prisma.shipmentQuantityEvidence.findMany({ where: {
      partnerCaseId: expected.caseId, kind: 'CONTRACTED_SET',
    } });
    const accounting = (body: unknown, key: string) => request('/accounting/actions', requester.token, body, key);
    let authorityId: string | undefined;
    let clearedCheckId: string | undefined;
    if (manager) {
      assert.equal((await baselines()).length, 0);
      await assertHidden('before-approval');
      const pending = await request(`/dispatch-credit/contracts/${sale.customerContractId}/requests`, requester.token, { kind: 'MANAGER' });
      assert.equal(pending.status, 200, JSON.stringify(pending.body));
      authorityId = pending.body.data.id;
      await assertHidden('pending-approval');
      const decision = () => request(`/dispatch-credit/authorities/${pending.body.data.id}/actions`, manager.token,
        { action: 'APPROVE', promisedDate: '2099-01-01' });
      const approved = await decision();
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal((await baselines()).length, 1, 'approving a current grant prepares the contractual baseline');
      assert.equal((await decision()).status, 409);
    } else {
      assert.ok(invoiceId);
      const approved = await accounting({ kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId, sepidarAmount: '1600',
        systemInvoiceDate: new Date().toISOString().slice(0, 10), systemInvoiceNumber: 'settlement-test-invoice',
        note: 'تأیید صورتحساب آزمایشی پرونده همکار' }, 'publish-invoice');
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      const published = await request('/partner/accounting/receivables', requester.token, { expected, invoiceRecordId: invoiceId });
      assert.equal(published.status, 200, JSON.stringify(published.body));
      const receivable = await prisma.accountingReceivable.findFirstOrThrow({ where: { invoiceRecordId: invoiceId } });

      // Reproduce a pre-parity obligation lacking old logistics evidence and
      // Sepidar evidence. Keep its actual canonical debt and approval event.
      await prisma.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.shipmentQuantityEvidence.deleteMany({ where: { partnerCaseId: expected.caseId, kind: 'CONTRACTED_SET' } });
        await tx.partnerFulfillmentLineage.deleteMany({ where: { caseId: expected.caseId } });
        await tx.accountingFinancialRecord.update({ where: { id: invoiceId }, data: { sepidarAmount: null } });
      });
      await assertHidden('no-realized-receipt');
      const partial = await accounting({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id,
        method: 'BANK_TRANSFER', amount: '800' }, 'partial-receipt');
      assert.equal(partial.status, 200, JSON.stringify(partial.body));
      await assertHidden('partially-paid');
      const check = await accounting({ kind: 'REGISTER_RECEIPT', receivableId: receivable.id, method: 'CHECK', amount: '800',
        check: { checkNumber: '123456', ownerName: 'آزمون', dueDate: '2099-01-01' } }, 'register-check');
      assert.equal(check.status, 200, JSON.stringify(check.body));
      clearedCheckId = check.body.data.affected.paymentEventIds[0];
      const update = (status: string, key: string) =>
        accounting({ kind: 'UPDATE_CHECK_STATUS', paymentEventId: clearedCheckId, status }, key);
      const deposited = await update('DEPOSITED', 'deposited-check');
      assert.equal(deposited.status, 200, JSON.stringify(deposited.body));
      await assertHidden('posted-but-uncleared');
      assert.equal((await baselines()).length, 0);
      const clear = () => update('CLEARED', 'cleared-check');
      const cleared = await clear();
      assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
      assert.equal((await baselines()).length, 1, 'clearing the final wholesale payment prepares the contractual baseline');
      const replay = await clear();
      assert.equal(replay.status, 200, JSON.stringify(replay.body));
    }

    const customers = await load(customersPath);
    assert.equal(customers.status, 200, JSON.stringify(customers.body));
    assert.ok(customers.body.data.some((row: { id: string }) => row.id === sale.customerId));
    const projects = await load(projectsPath);
    assert.equal(projects.status, 200, JSON.stringify(projects.body));
    const selected = projects.body.data.find((row: { deliveryId: string }) => row.deliveryId === selection.deliveryId);
    assert.ok(selected, JSON.stringify(projects.body));
    assert.deepEqual(selected.owner, expected);
    assert.equal(selected.contractNumber, sale.customerContract?.contractNumber);
    const draft = await load('/loadings', { ...selection, expected: selected.owner, deliveryId: selected.deliveryId }, 'alternative-draft');
    assert.equal(draft.status, 201, JSON.stringify(draft.body));
    const reopened = await load(`/loadings/${draft.body.data.loadingId}`);
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    assert.equal(reopened.body.data.source.recipient.customerId, sale.customerId);
    assert.equal(reopened.body.data.source.deliveryId, selection.deliveryId);
    assert.equal(reopened.body.data.source.rows[0].plannedQuantity, '0.750');
    assert.equal((await baselines()).length, 1);

    if (authorityId) {
      // Keep a live-shaped grant with a stale commercial revision.
      const authority = await prisma.contractDispatchAuthority.findUniqueOrThrow({ where: { id: authorityId } });
      await prisma.contractDispatchAuthority.update({ where: { id: authority.id }, data: { revision: authority.revision - 1 } });
      await assertHidden('stale-manager-grant');
    }
    if (clearedCheckId) {
      const bounced = await accounting({ kind: 'UPDATE_CHECK_STATUS', status: 'BOUNCED', paymentEventId: clearedCheckId }, 'bounced-check');
      assert.equal(bounced.status, 200, JSON.stringify(bounced.body));
      await assertHidden('payment-reversed');
      assert.equal((await load(`/loadings/${draft.body.data.loadingId}`)).status, 200);
      const recovered = await accounting({ kind: 'UPDATE_CHECK_STATUS', status: 'CLEARED', paymentEventId: clearedCheckId }, 'cleared-again');
      assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
      assert.equal((await baselines()).length, 1);

    }
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
