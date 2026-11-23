import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import express from 'express';
import type { Prisma } from '@prisma/client';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../lib/prisma';
import accountingRouter from '../../routes/accounting';
import logisticsRouter from '../../routes/logistics';
import dispatchCreditRouter from '../../routes/dispatchCredit';
import { readPartnerShipmentQuantityProjection } from '../partnerSales/fulfillment/quantityStore';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';
import { shipmentQuantityEvidenceIntegrityHash } from '../shipmentQuantityProjectionStore';

async function main() {
  const database = new URL(process.env.DATABASE_URL ?? '');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55432');
  assert.match(database.pathname, /^\/sabalanerp_concurrency_[a-f0-9]{16}$/);

  const accountantId = process.env.PARTNER_TEST_ACTOR_ID!;
  const logisticsId = process.env.PARTNER_TEST_LOADING_ACTOR_ID!;
  const invoiceId = process.env.PARTNER_TEST_INVOICE_ID!;
  try {
    await prisma.featurePermission.create({ data: { userId: accountantId, workspace: 'accounting',
      feature: 'accounting_records_approve_void', permissionLevel: 'edit', grantedBy: accountantId } });
    const issueSession = (actorId: string) => createAuthoritativeSession(prisma, actorId, {
      ipAddress: '127.0.0.1', userAgent: 'isolated-partner-financial-loading',
    });
    const [accountant, loader] = await Promise.all([issueSession(accountantId), issueSession(logisticsId)]);
    const invoice = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId } });
    const sale = await prisma.partnerSaleCase.findUniqueOrThrow({ where: { internalRecordId: invoice.sourceId! },
      include: { customerContract: true } });
    const expected = { caseId: sale.id, revision: sale.headRevision, integrityHash: sale.integrityHash };
    const app = express();
    app.use(express.json());
    app.use('/api/accounting', accountingRouter);
    app.use('/api/logistics', logisticsRouter);
    app.use('/api/dispatch-credit', dispatchCreditRouter);
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const request = async (path: string, token: string, body?: unknown, key = 'financial-loading') => {
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api${path}`, {
          method: body ? 'POST' : 'GET',
          headers: { 'content-type': 'application/json', cookie: `${SESSION_COOKIE}=${token}`,
            'Idempotency-Key': key, 'X-Correlation-Id': key },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return { status: response.status, body: await response.json() as any };
      };
      const logistics = (path: string, body?: unknown, key?: string) => request(`/logistics${path}`, loader.token, body, key);
      const projectsPath = `/customers/${sale.customerId}/projects`;
      const customersPath = '/customers?search=Customer%20Lifecycle';
      const approve = (amount: string, key: string, token = accountant.token) => request('/accounting/actions', token, {
        kind: 'APPROVE_FINANCIAL_INVOICE', invoiceId, systemInvoiceNumber: `${invoiceId}-official`,
        systemInvoiceDate: new Date().toISOString().slice(0, 10), sepidarAmount: amount, note: 'تأیید صورتحساب آزمایشی پرونده همکار',
      }, key);
      const assertHidden = async () => {
        for (const path of [customersPath, projectsPath]) {
          const response = await logistics(path);
          assert.equal(response.status, 200, JSON.stringify(response.body));
          assert.deepEqual(response.body.data, []);
        }
      };

      const anticipated = { sourceKind: 'PARTNER_CASE', expected, deliveryId: 'separate-delivery' };
      if (process.env.PARTNER_TEST_BASELINE_REPAIR === '1') {
        const runRepair = async (apply = false) => {
          const { stdout } = await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
            'backend/src/scripts/repair-partner-loading-baseline.ts', `--contract=${sale.customerContract!.contractNumber}`,
            ...(apply ? ['--apply'] : [])], { timeout: 20_000 });
          return JSON.parse(stdout.trim().split('\n').at(-1)!);
        };
        const beforeApproval = await runRepair();
        assert.equal(beforeApproval.status, 'ineligible', JSON.stringify(beforeApproval));
        assert.equal((await runRepair(true)).status, 'ineligible');
        const approved = await approve('1600', 'existing-financial-approval');
        assert.equal(approved.status, 200, JSON.stringify(approved.body));
        const approvedInvoice = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId } });
        const quantityWhere = { partnerCaseId: sale.id };
        const historicalBaseline = await prisma.shipmentQuantityEvidence.findFirstOrThrow({ where: quantityWhere });
        await prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await tx.shipmentQuantityEvidence.delete({ where: { id: historicalBaseline.id } });
          await tx.partnerFulfillmentLineage.deleteMany({ where: { caseId: sale.id } });
        });

        await assertHidden();
        assert.equal((await logistics('/loadings', anticipated, 'old-case-missing-baseline')).status, 409);
        const plan = await runRepair();
        assert.equal(plan.status, 'missing');
        assert.deepEqual(plan.missingBaselines.map((row: { quantity: string }) => row.quantity), ['2.000']);
        await assertHidden();
        await prisma.dispatchCutoverControl.create({ data: { id: 'dispatch', phase: 'PILOT_SAFETY_PAUSE', legacyWritesEnabled: false } });
        assert.equal((await runRepair()).status, 'ineligible');
        assert.equal((await runRepair(true)).status, 'ineligible');
        await prisma.dispatchCutoverControl.delete({ where: { id: 'dispatch' } });
        let waitingRepair: ReturnType<typeof runRepair> | undefined;
        try {
          await prisma.$transaction(async tx => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('DISPATCH_CUTOVER'))`;
            waitingRepair = runRepair(true);
            const deadline = Date.now() + 4_000;
            for (;;) {
              await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
              const [waiters] = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
                WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event = 'advisory'
                  AND query LIKE '%pg_advisory_xact_lock%'`;
              if (waiters.count > 0n) break;
              assert.ok(Date.now() < deadline, 'repair reaches the cutover contention retry');
              await new Promise(resolve => setTimeout(resolve, 25));
            }
            // The holder models existing downstream dispatch order. A repair
            // waiting for cutover must release its Partner locks first.
            await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE NOWAIT`;
            await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${sale.id} FOR UPDATE NOWAIT`;
          }, { timeout: 6_000 });
        } finally {
          // The CLI must exit before the isolated database is inspected or removed.
          if (waitingRepair) await waitingRepair;
        }
        assert.equal((await waitingRepair)?.status, 'repaired');
        const repeated = await Promise.all([runRepair(true), runRepair(true)]);
        assert.deepEqual(repeated.map(report => report.status), ['already-present', 'already-present']);
        assert.equal((await runRepair()).status, 'already-present');
        const customers = await logistics(customersPath);
        assert.ok(customers.body.data.some((row: { id: string }) => row.id === sale.customerId));
        const projects = await logistics(projectsPath);
        const delivery = projects.body.data.find((row: { deliveryId: string }) => row.deliveryId === anticipated.deliveryId);
        assert.ok(delivery);
        assert.equal(delivery.contractNumber, sale.customerContract?.contractNumber);
        assert.deepEqual(delivery.owner, expected);
        const draft = await logistics('/loadings', { ...anticipated, expected: delivery.owner }, 'repaired-case-draft');
        assert.equal(draft.status, 201, JSON.stringify(draft.body));
        const reopened = await logistics(`/loadings/${draft.body.data.loadingId}`);
        assert.equal(reopened.body.data.source.deliveryId, anticipated.deliveryId);
        assert.equal(reopened.body.data.source.recipient.customerId, sale.customerId);
        assert.equal(reopened.body.data.source.rows[0].plannedQuantity, '0.750');
        assert.deepEqual(await prisma.accountingFinancialRecord.findUnique({ where: { id: invoiceId } }), approvedInvoice);
        assert.equal(await prisma.shipmentQuantityEvidence.count({ where: quantityWhere }), 1);
        const repaired = await prisma.shipmentQuantityEvidence.findFirstOrThrow({ where: quantityWhere });
        const lineage = await prisma.partnerFulfillmentLineage.findUniqueOrThrow({ where: { id: repaired.partnerLineageId! } });
        const requesterId = `${sale.id}-repair-requester`;
        const managerId = `${sale.id}-repair-manager`;
        await prisma.user.createMany({ data: [requesterId, managerId].map(id => ({ id, username: id,
          email: `${id}@example.invalid`, password: 'not-a-login', firstName: 'Baseline', lastName: 'Repair', role: 'ADMIN' })) });
        const [requester, manager] = await Promise.all([issueSession(requesterId), issueSession(managerId)]);
        const managerRequest = await request(`/dispatch-credit/contracts/${sale.customerContractId}/requests`, requester.token, { kind: 'MANAGER' });
        assert.equal(managerRequest.status, 200, JSON.stringify(managerRequest.body));
        const managerApproval = await request(`/dispatch-credit/authorities/${managerRequest.body.data.id}/actions`, manager.token, {
          action: 'APPROVE', promisedDate: '2099-01-01',
        });
        assert.equal(managerApproval.status, 200, JSON.stringify(managerApproval.body));
        await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
          'backend/src/services/__tests__/partnerFinancialApprovalProbe.ts'], { timeout: 40_000, env: { ...process.env,
          PARTNER_TEST_DRAFT_FIXTURE: 'PUBLISH', PARTNER_TEST_INVOICE_ID: invoiceId, PARTNER_TEST_ACTOR_ID: accountantId } });
        await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
          'backend/src/services/__tests__/partnerFinalizationHttpProbe.ts'], { timeout: 40_000, env: { ...process.env,
          PARTNER_TEST_REPAIR_FINALIZE: '1', PARTNER_TEST_ACTOR_ID: managerId, PARTNER_TEST_ACCOUNTANT_ID: accountantId,
          PARTNER_TEST_OWNER: JSON.stringify(expected) } });
        const line = await prisma.logisticsAllocationRevisionLine.findFirstOrThrow({ where: { partnerCaseId: sale.id },
          include: { revision: { include: { candidate: true } } } });
        assert.equal(line.revision.candidate?.status, 'PENDING');
        const preserved = await prisma.shipmentQuantityEvidence.findFirstOrThrow({ where: { ...quantityWhere,
          kind: 'ALLOCATION_FINALIZED', sourceType: 'PARTNER_LOGISTICS_ALLOCATION_REVISION', sourceId: line.id } });
        assert.deepEqual(preserved.metadata, { loadingId: line.revision.loadingId, revisionId: line.revision.id,
          deliveryId: anticipated.deliveryId });
        assert.ok(preserved.quantity.equals(line.quantity));
        await prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await tx.shipmentQuantityEvidence.delete({ where: { id: repaired.id } });
        });
        await assertHidden();
        const partialPlan = await runRepair();
        assert.equal(partialPlan.status, 'missing', JSON.stringify(partialPlan));
        assert.deepEqual(partialPlan.missingLineages, []);
        assert.equal((await runRepair(true)).status, 'repaired');
        assert.deepEqual(await prisma.partnerFulfillmentLineage.findUnique({ where: { id: lineage.id } }), lineage);
        assert.deepEqual(await prisma.shipmentQuantityEvidence.findUnique({ where: { id: preserved.id } }), preserved);
        const projection = await prisma.$transaction(tx => readPartnerShipmentQuantityProjection(tx, sale.id));
        assert.equal(projection.rows[0].quantities?.finalizedReserved, '0.250');
        assert.equal(projection.rows[0].quantities?.availableToLoad, '1.750');
        await prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await tx.shipmentQuantityEvidence.delete({ where: { id: preserved.id } });
        });
        assert.equal((await runRepair()).status, 'conflict', 'a live allocation revision without its exact ledger witness is a conflict');
        assert.equal((await runRepair(true)).status, 'conflict');
        await prisma.shipmentQuantityEvidence.create({ data: { ...preserved, metadata: preserved.metadata as Prisma.InputJsonValue } });
        await prisma.$transaction(async tx => {
          await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
          await tx.shipmentQuantityEvidence.update({ where: { id: repaired.id }, data: { integrityHash: 'corrupt-fixture' } });
        });
        assert.equal((await runRepair()).status, 'conflict');
        assert.equal((await runRepair(true)).status, 'conflict');
        assert.equal((await prisma.shipmentQuantityEvidence.findUniqueOrThrow({ where: { id: repaired.id } })).integrityHash, 'corrupt-fixture');
        return;
      }

      await assertHidden();
      assert.equal((await logistics('/loadings', anticipated, 'before-approval')).status, 409);
      assert.equal((await approve('1600', 'unprivileged-approval', loader.token)).status, 403);
      assert.equal((await approve('1599', 'mismatched-approval')).status, 400);
      assert.equal((await approve('1600.01', 'fractional-mismatch')).status, 400);
      await assertHidden();

      const [approved, approvalReplay] = await Promise.all([
        approve('1600', 'valid-approval'), approve('1600', 'valid-approval'),
      ]);
      assert.equal(approved.status, 200, JSON.stringify(approved.body));
      assert.equal(approvalReplay.status, 200, JSON.stringify(approvalReplay.body));
      const customers = await logistics(customersPath);
      assert.equal(customers.status, 200, JSON.stringify(customers.body));
      assert.ok(customers.body.data.some((row: { id: string }) => row.id === sale.customerId),
        'matching effective financial approval makes the end customer searchable');

      const projects = await logistics(projectsPath);
      assert.equal(projects.status, 200, JSON.stringify(projects.body));

      const adminId = `${sale.id}-logistics-admin`;
      await prisma.user.create({ data: { id: adminId, username: adminId, email: `${adminId}@example.invalid`,
        password: 'not-a-login', firstName: 'Logistics', lastName: 'Admin', role: 'ADMIN' } });
      const admin = await issueSession(adminId);
      const adminPicker = await request(`/logistics${projectsPath}`, admin.token);
      assert.equal(adminPicker.status, 200, JSON.stringify(adminPicker.body));
      assert.ok(adminPicker.body.data.some((row: { deliveryId: string }) => row.deliveryId === anticipated.deliveryId),
        'Admin can discover a Case delivery before submitting a reason');
      const withoutReason = await request('/logistics/loadings', admin.token, anticipated, 'admin-reason-required');
      assert.equal(withoutReason.status, 403, JSON.stringify(withoutReason.body));
      const withReason = await request('/logistics/loadings', admin.token,
        { ...anticipated, reason: 'ثبت بارگیری با مجوز مدیر' }, 'admin-with-reason');
      assert.equal(withReason.status, 201, JSON.stringify(withReason.body));

      await prisma.dispatchCutoverControl.create({ data: { id: 'dispatch', phase: 'PILOT_SAFETY_PAUSE',
        legacyWritesEnabled: false } });
      try {
        await assertHidden();
        assert.equal((await logistics('/loadings', anticipated, 'paused-draft')).status, 409);
      } finally {
        await prisma.dispatchCutoverControl.delete({ where: { id: 'dispatch' } });
      }

      const selected = projects.body.data.find((row: { deliveryId: string }) => row.deliveryId === 'separate-delivery');
      assert.ok(selected, JSON.stringify(projects.body));
      assert.equal(selected.contractNumber, sale.customerContract?.contractNumber);
      assert.equal(selected.remainingCount, 1);
      assert.deepEqual(selected.owner, expected);
      const payload = { sourceKind: 'PARTNER_CASE', expected: selected.owner, deliveryId: selected.deliveryId };
      const draft = await logistics('/loadings', payload);
      assert.equal(draft.status, 201, JSON.stringify(draft.body));
      const loadingId = draft.body.data.loadingId;
      const reopened = await logistics(`/loadings/${loadingId}`);
      assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
      assert.equal(reopened.body.data.status, 'DRAFT');
      assert.deepEqual(reopened.body.data.source.owner, payload.expected);
      assert.equal(reopened.body.data.source.deliveryId, payload.deliveryId);
      assert.equal(reopened.body.data.source.recipient.customerId, sale.customerId);
      assert.equal(reopened.body.data.source.rows[0].plannedQuantity, '0.750');
      assert.equal((await approve('1600', 'valid-approval')).status, 200);
      const retry = await logistics('/loadings', payload);
      assert.equal(retry.status, 200, JSON.stringify(retry.body));
      assert.equal(retry.body.data.loadingId, loadingId);

      const contractId = sale.customerContractId!;
      await prisma.salesContract.update({ where: { id: contractId }, data: { isInactive: true } });
      try {
        await assertHidden();
        assert.equal((await logistics('/loadings', payload, 'inactive-contract')).status, 409);
        assert.equal((await logistics(`/loadings/${loadingId}`)).status, 200, 'an existing draft remains accessible');
      } finally {
        await prisma.salesContract.update({ where: { id: contractId }, data: { isInactive: false } });
      }
      await prisma.salesContract.update({ where: { id: contractId }, data: { status: 'APPROVED' } });
      try {
        await assertHidden();
        assert.equal((await logistics('/loadings', payload, 'not-final')).status, 409);
      } finally {
        await prisma.salesContract.update({ where: { id: contractId }, data: { status: 'SIGNED' } });
      }

      // Isolated physical evidence fixture: a previously finalized reservation
      // consumes the whole contract row, including any unplanned quantity.
      const baselines = await prisma.shipmentQuantityEvidence.findMany({ where: {
        partnerCaseId: sale.id, kind: 'CONTRACTED_SET',
      } });
      assert.equal(baselines.length, 1, 'concurrent and repeated approval records exactly one baseline');
      const [baseline] = baselines;
      assert.equal(baseline.quantity.toString(), '2', 'the base comes from the contract row even when the delivery plans total less');
      const reservedAt = new Date();
      const reservation = { id: 'fully-reserved-partner-row', sourceKind: 'PARTNER_CASE' as const,
        contractId: null, contractItemId: null, partnerCaseId: sale.id, partnerLineageId: baseline.partnerLineageId!,
        partnerCaseRevision: expected.revision, partnerIntegrityHash: expected.integrityHash,
        productRowId: baseline.productRowId, unit: baseline.unit, kind: 'ALLOCATION_FINALIZED' as const,
        quantity: '2.000', effectiveAt: reservedAt.toISOString(), recordedAt: reservedAt.toISOString(),
        sourceType: 'PARTNER_LOGISTICS_ALLOCATION_REVISION', sourceId: 'fully-reserved-partner-row', sourceVersion: 1,
        integrityHash: '', metadata: {} };
      await prisma.shipmentQuantityEvidence.create({ data: { ...reservation, effectiveAt: reservedAt, recordedAt: reservedAt,
        integrityHash: shipmentQuantityEvidenceIntegrityHash(reservation) } });
      await assertHidden();
      assert.equal((await logistics('/loadings', payload, 'zero-remaining')).status, 409);

      const directCustomerId = process.env.PARTNER_TEST_DIRECT_CUSTOMER_ID!;
      const directProjectId = process.env.PARTNER_TEST_DIRECT_PROJECT_ID!;
      const directCustomers = await logistics('/customers?search=Direct%20Logistics');
      assert.equal(directCustomers.status, 200, JSON.stringify(directCustomers.body));
      assert.ok(directCustomers.body.data.some((row: { id: string }) => row.id === directCustomerId));
      const directProjects = await logistics(`/customers/${directCustomerId}/projects`);
      assert.equal(directProjects.status, 200, JSON.stringify(directProjects.body));
      assert.ok(directProjects.body.data.some((row: { id: string }) => row.id === directProjectId));
      const directDraft = await logistics('/loadings', { projectId: directProjectId });
      assert.equal(directDraft.status, 201, JSON.stringify(directDraft.body));
      assert.equal(directDraft.body.data.projectId, directProjectId);
      assert.equal(directDraft.body.data.customerId, directCustomerId);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
