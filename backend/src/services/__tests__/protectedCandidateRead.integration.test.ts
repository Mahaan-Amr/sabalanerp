import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

test('selected protected catalog serves an authenticated ERP user read without online state', async () => {
  const databaseUrl = new URL(process.env.DATABASE_URL || '');
  assert.equal(databaseUrl.hostname, '127.0.0.1');
  assert.equal(databaseUrl.port, '55432');
  assert.equal(databaseUrl.pathname, '/qa_protected_candidate_428');
  assert.equal(process.env.NODE_ENV, 'development');
  const coordination = await fs.mkdtemp(path.join(os.tmpdir(), 'protected-candidate-428-'));
  process.env.RECOVERY_COORDINATION_DIR = coordination;

  const { prisma, disconnectDatabase } = await import('../../lib/prisma');
  const { initializeRecoveryRuntime } = await import('../recoveryRuntime');
  const { createAuthoritativeSession, SESSION_COOKIE } = await import('../identitySessionService');
  const { createApplication } = await import('../../application');
  const userId = 'qa-protected-candidate-428';
  let application: ReturnType<typeof createApplication> | undefined;
  try {
    const [catalog] = await prisma.$queryRaw<Array<{ applied: number; online: number }>>`
      SELECT count(*)::int AS applied,
        count(*) FILTER (WHERE migration_name IN
          ('20261014140000_online_deployment_control','20261019010000_customer_semantic_barrier',
           '20261019020000_hr_versioned_file_cleanup','20261020010000_online_realtime_completion',
           '20261020093000_online_serving_epochs'))::int AS online
      FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    assert.deepEqual(catalog, { applied: 451, online: 0 });
    const [tables] = await prisma.$queryRaw<Array<{ onlineRegistry: string | null; servingEpochs: string | null }>>`
      SELECT to_regclass('public.online_releases')::text AS "onlineRegistry",
        to_regclass('public.online_serving_epochs')::text AS "servingEpochs"`;
    assert.deepEqual(tables, { onlineRegistry: null, servingEpochs: null });

    await prisma.user.create({ data: { id: userId, email: 'qa-protected-428@example.invalid',
      username: userId, password: 'unused-isolated-qa-password', firstName: 'Protected', lastName: 'Candidate', role: 'ADMIN' } });
    const { token } = await createAuthoritativeSession(prisma, userId, { userAgent: 'protected-candidate-qa' });
    initializeRecoveryRuntime();
    application = createApplication({ runtimeRole: 'standalone', isShuttingDown: () => false });
    await new Promise<void>(resolve => application!.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(application.server.address() as AddressInfo).port}`;
    const denied = await fetch(`${base}/api/users`);
    assert.equal(denied.status, 401);
    const response = await fetch(`${base}/api/users`, { headers: { cookie: `${SESSION_COOKIE}=${token}` } });
    assert.equal(response.status, 200);
    const body = await response.json() as { success: boolean; data: Array<{ id: string }> };
    assert.equal(body.success, true);
    assert.ok(body.data.some(user => user.id === userId));
  } finally {
    if (application) await new Promise<void>(resolve => application!.io.close(() => resolve()));
    await prisma.authSession.deleteMany({ where: { userId } });
    await prisma.recognizedBrowserProfile.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await disconnectDatabase();
    await fs.rm(coordination, { recursive: true, force: true });
  }
});
