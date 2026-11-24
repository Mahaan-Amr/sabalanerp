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
    const register = (id: string, value: string) => fetch(`${base}/loadings/${id}/sepidar-reference`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
    });
    const correct = (id: string, value: string | null, expectedVersion: string | null, reason: string) =>
      fetch(`${base}/loadings/${id}/sepidar-reference`, { method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ value, expectedVersion, reason }),
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
    const hidden = await register(hiddenLoadingId, '991');
    assert.equal(hidden.status, 404, 'a different Partner Case cannot be inferred through writes');
    await hidden.body?.cancel();
    const invalid = await register(loadingId, '12A');
    assert.equal(invalid.status, 400);
    await invalid.body?.cancel();
    const saved = await register(loadingId, ' ۰۰۱۲۳ ');
    assert.equal(saved.status, 201);
    const firstSave = (await saved.json() as any).data;
    assert.equal(firstSave.value, '00123');
    const firstVersion = firstSave.auditEntry.id;
    const reloaded = await (await fetchCandidates()).json() as any;
    assert.equal(reloaded.data.find((row: any) => row.id === expected.ordinary)?.sepidarLoadingReference, '00123');
    assert.equal(reloaded.data.find((row: any) => row.id === expected.allowed)?.sepidarLoadingReference, '00123');
    assert.equal(reloaded.data.find((row: any) => row.id === expected.allowed)?.sepidarLoadingReferenceHistory[0].id, firstVersion);
    const stale = await register(loadingId, '999');
    assert.equal(stale.status, 409);
    await stale.body?.cancel();
    const unexplained = await correct(loadingId, '999', firstVersion, '  ');
    assert.equal(unexplained.status, 400);
    await unexplained.body?.cancel();
    const corrected = await correct(loadingId, '999', firstVersion, 'اصلاح اشتباه تایپی');
    assert.equal(corrected.status, 200);
    const correction = (await corrected.json() as any).data;
    assert.equal(correction.value, '999');
    const concurrent = await correct(loadingId, '777', firstVersion, 'نسخه قدیمی');
    assert.equal(concurrent.status, 409);
    await concurrent.body?.cancel();
    const duplicate = await register(otherLoadingId, '999');
    assert.equal(duplicate.status, 409);
    await duplicate.body?.cancel();
    const reverted = await correct(loadingId, '00123', correction.auditEntry.id, 'بازگرداندن شماره اولیه');
    assert.equal(reverted.status, 200);
    const revertedVersion = (await reverted.json() as any).data.auditEntry.id;
    const staleRevertedValue = await correct(loadingId, '777', firstVersion, 'نسخه قدیمی');
    assert.equal(staleRevertedValue.status, 409, 'a matching value from an older audit version is stale');
    assert.equal((await staleRevertedValue.json() as any).code, 'SEPIDAR_REFERENCE_STALE');
    const cleared = await correct(loadingId, null, revertedVersion, 'شماره نامعتبر بود');
    assert.equal(cleared.status, 200);
    const clear = (await cleared.json() as any).data;
    assert.equal(clear.value, null);
    const afterClear = await (await fetchCandidates()).json() as any;
    assert.equal(afterClear.data.find((row: any) => row.id === expected.ordinary)?.sepidarLoadingReference, null);
    assert.equal(afterClear.data.find((row: any) => row.id === expected.allowed)?.sepidarLoadingReference, null);
    const staleBlank = await correct(loadingId, '321', null, 'نسخه قدیمی');
    assert.equal(staleBlank.status, 409, 'an initially blank editor cannot write after a save and clear');
    assert.equal((await staleBlank.json() as any).code, 'SEPIDAR_REFERENCE_STALE');
    const unexplainedReentry = await correct(loadingId, '321', clear.auditEntry.id, ' ');
    assert.equal(unexplainedReentry.status, 400, 'a cleared reference retains its correction history');
    await unexplainedReentry.body?.cancel();
    const other = await register(otherLoadingId, '456');
    assert.equal(other.status, 201);
    await other.body?.cancel();
    const audit = await fetch(`${base}/audit?action=REGISTER_SEPIDAR_LOADING_REFERENCE`, { headers });
    assert.equal(audit.status, 200);
    const history = await audit.json() as any;
    assert.ok(history.data.items.some((item: any) => item.entityId === loadingId && item.actorId === actorId
      && item.note.includes('00123') && item.createdAt));
    const changes = afterClear.data.find((row: any) => row.id === expected.ordinary)
      ?.sepidarLoadingReferenceHistory || [];
    assert.ok(changes.some((item: any) => item.beforeState?.sepidarLoadingReference === '00123'
      && item.afterState?.sepidarLoadingReference === '999' && item.note.includes('اصلاح اشتباه تایپی')));
    assert.ok(changes.some((item: any) => item.beforeState?.sepidarLoadingReference === '00123'
      && item.afterState?.sepidarLoadingReference === null && item.note.includes('شماره نامعتبر بود')));
    await prisma.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage' } }, data: { isActive: false } });
    const viewOnly = await (await fetchCandidates()).json() as any;
    assert.equal(viewOnly.data.find((row: any) => row.id === expected.ordinary)?.sepidarLoadingReference, null);
    assert.equal(viewOnly.data.find((row: any) => row.id === expected.ordinary)?.canManage, false);
    assert.equal(viewOnly.data.find((row: any) => row.id === expected.ordinary)?.canManageSepidarLoadingReference, false);
    const viewOnlyWrite = await register(otherLoadingId, '789');
    assert.equal(viewOnlyWrite.status, 403);
    await viewOnlyWrite.body?.cancel();
    await prisma.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage' } }, data: { isActive: true } });
    const reentered = await correct(loadingId, '321', clear.auditEntry.id, 'ثبت دوباره پس از بررسی');
    assert.equal(reentered.status, 200);
    const reenteredVersion = (await reentered.json() as any).data.auditEntry.id;
    await prisma.logisticsLoading.update({ where: { id: loadingId }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    const cancelled = await (await fetchCandidates()).json() as any;
    const cancelledRow = cancelled.data.find((row: any) => row.id === expected.ordinary);
    assert.equal(cancelledRow.loadingStatus, 'CANCELLED');
    assert.equal(cancelledRow.sepidarLoadingReference, '321');
    assert.equal(cancelledRow.canManageSepidarLoadingReference, false);
    assert.ok(cancelledRow.sepidarLoadingReferenceHistory.some((item: any) => item.note === 'ثبت دوباره پس از بررسی'));
    const cancelledWrite = await correct(loadingId, '789', reenteredVersion, 'بعد از لغو');
    assert.equal(cancelledWrite.status, 409);
    await cancelledWrite.body?.cancel();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
