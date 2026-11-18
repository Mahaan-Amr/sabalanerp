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
    const fetchCandidates = () => fetch(`${base}/dispatch-candidates`, { headers });
    const register = (id: string, value: string) => fetch(`${base}/loadings/${id}/sepidar-reference`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
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
    assert.equal(body.data.find((row: any) => row.id === expected.ordinary)?.canManage, true,
      'ordinary candidates retain workspace-level mutation availability');
    assert.equal(body.data.find((row: any) => row.id === expected.allowed)?.canManage, true,
      'current dispatch management permission covers the authorized Partner Case without a duplicate write grant');
    for (const row of body.data) {
      assert.equal('allocationRevision' in row, false);
      assert.equal('allocationRevisionId' in row, false);
      assert.equal('workItem' in row, false);
      assert.equal(row.sepidarLoadingReference, null, 'the external reference is initially blank');
    }
    const hidden = await register(hiddenLoadingId, '991');
    assert.equal(hidden.status, 404, 'a different Partner Case cannot be inferred through writes');
    await hidden.body?.cancel();
    const invalid = await register(loadingId, '12A');
    assert.equal(invalid.status, 400);
    await invalid.body?.cancel();
    const saved = await register(loadingId, ' ۰۰۱۲۳ ');
    assert.equal(saved.status, 201);
    assert.equal((await saved.json() as any).data.value, '00123');
    const reloaded = await (await fetchCandidates()).json() as any;
    assert.equal(reloaded.data.find((row: any) => row.id === expected.ordinary)?.sepidarLoadingReference, '00123');
    assert.equal(reloaded.data.find((row: any) => row.id === expected.allowed)?.sepidarLoadingReference, '00123');
    const stale = await register(loadingId, '999');
    assert.equal(stale.status, 409);
    await stale.body?.cancel();
    const duplicate = await register(otherLoadingId, '00123');
    assert.equal(duplicate.status, 409);
    await duplicate.body?.cancel();
    const other = await register(otherLoadingId, '456');
    assert.equal(other.status, 201);
    await other.body?.cancel();
    const audit = await fetch(`${base}/audit?action=REGISTER_SEPIDAR_LOADING_REFERENCE`, { headers });
    assert.equal(audit.status, 200);
    const history = await audit.json() as any;
    assert.ok(history.data.items.some((item: any) => item.entityId === loadingId && item.actorId === actorId
      && item.note.includes('00123') && item.createdAt));
    await prisma.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage' } }, data: { isActive: false } });
    const viewOnly = await (await fetchCandidates()).json() as any;
    assert.equal(viewOnly.data.find((row: any) => row.id === expected.ordinary)?.sepidarLoadingReference, '00123');
    assert.equal(viewOnly.data.find((row: any) => row.id === expected.ordinary)?.canManage, false);
    const viewOnlyWrite = await register(otherLoadingId, '789');
    assert.equal(viewOnlyWrite.status, 403);
    await viewOnlyWrite.body?.cancel();
    await prisma.featurePermission.update({ where: { userId_workspace_feature: { userId: actorId,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage' } }, data: { isActive: true } });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await prisma.$disconnect();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
