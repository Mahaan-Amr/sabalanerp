import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { prisma } from '../../lib/prisma';
import accountingRouter from '../../routes/accounting';
import { createAuthoritativeSession, SESSION_COOKIE } from '../identitySessionService';

async function main() {
  const url = new URL(process.env.DATABASE_URL || '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432'
      || !/^\/sabalanerp_concurrency_[a-f0-9]{16}$/.test(url.pathname)) throw new Error('Isolated local test DB required');
  const actorId = process.env.PARTNER_TEST_ACTOR_ID!;
  const expected = {
    ordinary: process.env.PARTNER_TEST_ORDINARY_CANDIDATE_ID!,
    allowed: process.env.PARTNER_TEST_ALLOWED_CANDIDATE_ID!,
    hidden: process.env.PARTNER_TEST_HIDDEN_CANDIDATE_ID!,
  };
  const loadingId = process.env.PARTNER_TEST_LOADING_ID!;
  const otherLoadingId = process.env.PARTNER_TEST_OTHER_LOADING_ID!;
  const hiddenLoadingId = process.env.PARTNER_TEST_HIDDEN_LOADING_ID!;
  const session = await createAuthoritativeSession(prisma, actorId,
    { ipAddress: '127.0.0.1', userAgent: 'isolated-dispatch-list-policy' });
  const app = express(); app.use(express.json()); app.use('/api/accounting', accountingRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/accounting`;
    const headers = { cookie: `${SESSION_COOKIE}=${session.token}`, 'X-Correlation-Id': `${actorId}-candidate-list` };
    const fetchCandidates = (groupId?: string) => fetch(`${base}/dispatch-candidates` + (groupId ? '?loadingId=' + encodeURIComponent(groupId) : ''), { headers });
    const readInvoices = (id: string) => fetch(`${base}/loadings/${id}/sepidar-reference`, { headers });
    const save = (id: string, invoices: { number: string; amountRial: string }[], expectedVersion: string | null = null, reason?: string) =>
      fetch(`${base}/loadings/${id}/sepidar-reference`, { method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ invoices, expectedVersion, reason }),
      });
    let waiting: ReturnType<typeof fetchCandidates> | undefined;
    await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
      waiting = fetchCandidates();
      let blocked = false;
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
        const rows = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
          WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
            AND query LIKE '%partner_operations_controls%'`;
        if (Number(rows[0].count)) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(blocked, true, 'candidate GET reached its shared snapshot fence after route preflight');
      await tx.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId,
        workspace: 'accounting', feature: 'accounting_dispatch_candidates_view' } }, data: { isActive: false } });
    }, { timeout: 20_000 });
    const denied = await waiting!;
    assert.equal(denied.status, 403, 'a view revocation committed after middleware must deny the fenced list read');
    await denied.body?.cancel();
    await prisma.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_view' } }, data: { isActive: true } });
    const response = await fetchCandidates();
    assert.equal(response.status, 200);
    const body = await response.json() as any;
    const returnedIds = body.data.map((row: any) => row.id);
    assert.ok(returnedIds.includes(expected.ordinary), 'ordinary candidates remain visible');
    assert.ok(returnedIds.includes(expected.allowed), 'the individually authorized Partner candidate is visible');
    assert.equal(returnedIds.includes(expected.hidden), false, 'a different Partner Case is excluded before serialization');
    assert.equal(response.headers.get('X-Dispatch-Documents-Permission'), 'MANAGE');
    assert.equal(body.capabilities.canManageAccountingCandidates, true);
    const partnerCaseNumber = process.env.PARTNER_TEST_ALLOWED_CASE_NUMBER!;
    const paged = (page: number, search?: string) => fetch(`${base}/dispatch-candidates?${new URLSearchParams({
      page: String(page), pageSize: '1', ...(search ? { search } : {}),
    })}`, { headers });
    const first = await paged(1);
    assert.equal(first.status, 200);
    const firstPage = await first.json() as any;
    assert.deepEqual(firstPage.pagination, { page: 1, pageSize: 1, total: body.data.length });
    assert.deepEqual(firstPage.data, body.data.slice(0, 1));
    const second = await paged(2);
    assert.deepEqual((await second.json() as any).data, body.data.slice(1, 2));
    const byPartnerCaseNumber = await paged(1, partnerCaseNumber);
    const match = await byPartnerCaseNumber.json() as any;
    assert.deepEqual(match.data.map((row: any) => row.id), [expected.allowed]);
    assert.deepEqual(match.data[0].contractNumbers, []);
    assert.deepEqual(match.relatedCandidates.map((row: any) => row.id), [expected.ordinary],
      'only authorized siblings of page results are included for group actions');
    const groupResponse = await fetchCandidates(loadingId);
    assert.equal(groupResponse.status, 200);
    assert.deepEqual((await groupResponse.json() as any).data,
      body.data.filter((row: any) => row.loadingId === loadingId),
      'the group response matches the list rows for the loading, including permission and evidence flags');
    const hiddenGroup = await fetchCandidates(hiddenLoadingId);
    assert.equal(hiddenGroup.status, 200);
    assert.deepEqual((await hiddenGroup.json() as any).data, [], 'a filtered read cannot disclose an unauthorized loading');
    const documents = await fetch(`${base}/dispatch-candidates?documentQueue=READY&pageSize=1`, { headers });
    assert.equal(documents.status, 200);
    assert.equal(documents.headers.get('X-Dispatch-Documents-Permission'), 'MANAGE');
    const queue = (await documents.json() as any).data;
    assert.equal(queue.counts.READY, body.data.length, 'visible queue counts exclude unauthorized case existence');
    assert.equal(queue.rows.length, 1);
    assert.deepEqual(queue.rows[0].total, { amount: 'UNKNOWN', currency: 'IRR' });
    assert.ok(queue.rows.every((row: any) => !('allocationRevision' in row) && !('waybills' in row) && !('contracts' in row)));
    const documentsGroup = async (id: string) => {
      const result = await fetch(`${base}/dispatch-candidates?${new URLSearchParams({ documentQueue: 'GROUP', loadingId: id })}`, { headers });
      assert.equal(result.status, 200);
      return (await result.json() as any).data.rows;
    };
    assert.deepEqual((await documentsGroup(loadingId)).map((row: any) => row.id).sort(),
      [expected.ordinary, expected.allowed].sort(), 'only authorized sibling summaries refresh after a loading command');
    assert.deepEqual(await documentsGroup(hiddenLoadingId), []);
    assert.equal(body.data.find((row: any) => row.id === expected.ordinary)?.canManage, true,
      'ordinary candidates retain workspace-level mutation availability');
    assert.equal(body.data.find((row: any) => row.id === expected.allowed)?.canManage, true,
      'current dispatch management permission covers the authorized Partner Case without a duplicate write grant');
    for (const row of body.data) {
      assert.equal('allocationRevision' in row, false);
      assert.equal('allocationRevisionId' in row, false);
      assert.equal('workItem' in row, false);
      assert.equal(row.sepidarLoadingReference, null, 'the external reference is initially blank');
      assert.equal(row.canManageSepidarLoadingReference, true);
    }
    const hidden = await save(hiddenLoadingId, [{ number: '991', amountRial: '1' }]);
    assert.equal(hidden.status, 404, 'a different Partner Case cannot be inferred through writes');
    await hidden.body?.cancel();
    assert.equal((await readInvoices(hiddenLoadingId)).status, 404);
    const invalid = await save(loadingId, [{ number: '12A', amountRial: '1' }]);
    assert.equal(invalid.status, 400);
    await invalid.body?.cancel();

    const before = await readInvoices(loadingId);
    assert.equal(before.status, 200);
    assert.equal((await before.json() as any).data.totalRial, null, 'the policy fixture has no priced allocation evidence');
    const unpriced = await save(loadingId, [{ number: '۰۰۱۲۳', amountRial: '1' }]);
    assert.equal(unpriced.status, 409);
    assert.equal((await unpriced.json() as any).code, 'SEPIDAR_AMOUNT_MISMATCH');
    assert.equal(await prisma.sepidarDispatchInvoice.count({ where: { loadingId } }), 0);

    // A migrated number is stored without a fabricated amount.
    await prisma.sepidarDispatchInvoice.create({ data: { number: '00123', loadingId } });
    const withLegacy = await (await fetchCandidates()).json() as any;
    for (const id of [expected.ordinary, expected.allowed]) {
      assert.deepEqual(withLegacy.data.find((row: any) => row.id === id)?.sepidarInvoices,
        [{ number: '00123', amountRial: null }]);
    }
    const byLegacyInvoice = await fetch(`${base}/dispatch-candidates?sepidar=legacy&pageSize=1`, { headers });
    assert.equal(byLegacyInvoice.status, 200);
    const legacyPage = (await byLegacyInvoice.json() as any);
    assert.equal(legacyPage.pagination.total, 2, 'filtering precedes pagination and omits unauthorized cases');
    assert.equal(legacyPage.data.length, 1);
    const byInvoiceNumber = await paged(1, '۰۰۱۲۳');
    assert.equal((await byInvoiceNumber.json() as any).pagination.total, 2);
    const unexplained = await save(loadingId, [], null, ' ');
    assert.equal(unexplained.status, 400);
    await unexplained.body?.cancel();
    const cleared = await save(loadingId, [], null, 'شماره نامعتبر بود');
    assert.equal(cleared.status, 200);
    const clear = (await cleared.json() as any).data;
    assert.deepEqual(clear.invoices, []);
    assert.deepEqual(clear.auditEntry.beforeState.invoices, [{ number: '00123', amountRial: null }]);
    assert.deepEqual(clear.auditEntry.afterState.invoices, []);
    assert.equal(clear.auditEntry.note, 'شماره نامعتبر بود');
    const staleBlank = await save(loadingId, [{ number: '321', amountRial: '1' }], null, 'نسخه قدیمی');
    assert.equal(staleBlank.status, 409, 'an initially blank editor cannot overwrite a recorded correction');
    assert.equal((await staleBlank.json() as any).code, 'SEPIDAR_REFERENCE_STALE');

    await prisma.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage' } }, data: { isActive: false } });
    const viewOnly = await (await fetchCandidates()).json() as any;
    const ordinary = viewOnly.data.find((row: any) => row.id === expected.ordinary);
    assert.deepEqual(ordinary?.sepidarInvoices, []);
    assert.equal(ordinary?.canManage, false);
    assert.equal(ordinary?.canManageSepidarLoadingReference, false);
    const viewOnlyWrite = await save(otherLoadingId, [{ number: '789', amountRial: '1' }]);
    assert.equal(viewOnlyWrite.status, 403);
    await viewOnlyWrite.body?.cancel();
    assert.equal((await readInvoices(otherLoadingId)).status, 403);

    await prisma.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage' } }, data: { isActive: true } });
    await prisma.sepidarDispatchInvoice.create({ data: { number: '321', loadingId, amountRial: '100' } });
    await prisma.logisticsLoading.update({ where: { id: loadingId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    const cancelled = await (await fetchCandidates()).json() as any;
    const cancelledRow = cancelled.data.find((row: any) => row.id === expected.ordinary);
    assert.equal(cancelledRow.loadingStatus, 'CANCELLED');
    assert.deepEqual(cancelledRow.sepidarInvoices, [{ number: '321', amountRial: '100' }]);
    assert.equal(cancelledRow.canManageSepidarLoadingReference, false);
    const cancelledWrite = await save(loadingId, [], clear.auditEntry.id, 'بعد از لغو');
    assert.equal(cancelledWrite.status, 409);
    await cancelledWrite.body?.cancel();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
