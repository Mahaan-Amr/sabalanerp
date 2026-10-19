import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import express from 'express';
import { HttpRequestLifecycle } from '../../backend/src/services/httpRequestLifecycle';
import { createAuthoritativeSession, SESSION_COOKIE } from '../../backend/src/services/identitySessionService';
import hiringRouter from '../../backend/src/routes/hr-hiring';

/** Real router/auth/session/database path inside the already existing private
 * candidate. No main application, jobs, external providers or public listener. */
export async function exerciseHrDeletionFileRetryHttp(db: PrismaClient, root: string) {
  const run = randomUUID();
  const user = (role: 'ADMIN' | 'MANAGER') => db.user.create({ data: {
    email: `${run}-${role}@isolated.example.invalid`, username: `${run}-${role}`, password: 'NO_LOGIN_PRIVATE_QA',
    firstName: 'Isolated', lastName: 'QA', role,
  } });
  const admin = await user('ADMIN'), manager = await user('MANAGER');
  await db.hrWorkspaceCatalog.create({ data: { code: 'HUMAN_RESOURCES', displayName: 'Isolated Human Resources' } });
  await db.hrWorkspaceAccessGrant.create({ data: { stableKey: 'http-retry-qa-' + run, userId: manager.id,
    workspaceCode: 'HUMAN_RESOURCES', level: 'ADMIN', effectiveFrom: new Date(0), grantedByUserId: admin.id,
    reason: 'Isolated actual HR administrator-boundary acceptance' } });
  const adminSession = await createAuthoritativeSession(db, admin.id, { ipAddress: '127.0.0.1', userAgent: 'Isolated HR route acceptance' });
  const managerSession = await createAuthoritativeSession(db, manager.id, { ipAddress: '127.0.0.1', userAgent: 'Isolated HR route acceptance' });
  const lifecycle = new HttpRequestLifecycle(() => true), app = express();
  app.use(lifecycle.middleware); app.use(express.json()); app.use('/api/hr-hiring', hiringRouter); lifecycle.install(app);
  const server = await new Promise<ReturnType<typeof app.listen>>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  try {
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const request = async (id: string, token?: string) => {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/hr-hiring/deletion-receipts/${id}/retry-files`, {
        method: 'POST', headers: token ? { Cookie: `${SESSION_COOKIE}=${token}` } : {},
      });
      return { status: response.status, body: await response.json() as any };
    };
    for (const kind of ['preparing', 'versioned', 'legacy'] as const) {
      const id = randomUUID(), name = `${id}.pdf`, trash = path.join(root, '.deletion-trash', id);
      fs.mkdirSync(trash, { recursive: true }); const stagedPath = path.join(trash, name);
      fs.writeFileSync(stagedPath, 'PRIVATE HTTP CLEANUP COPY');
      const receipt = await db.hrDeletionReceipt.create({ data: {
        id, targetType: 'PERSONNEL', targetId: 'isolated-http-qa', actorUserId: admin.id, reason: 'Isolated actual HTTP retry acceptance',
        previewFingerprint: run, status: kind === 'preparing' ? 'PREPARING' : 'FILE_CLEANUP_PENDING',
        operationToken: kind === 'preparing' ? randomUUID() : null, leaseExpiresAt: kind === 'preparing' ? new Date(0) : null,
        recordCounts: {}, fileCounts: {},
      } });
      const row = await db.hrDeletionFileCleanup.create({ data: {
        receiptId: id, storageName: name, originalPath: path.join(root, name), stagedPath,
        status: kind === 'legacy' ? 'PENDING' : 'VERSIONED_STAGED',
      } });
      assert.equal((await request(id)).status, 401);
      const denied = await request(id, managerSession.token);
      assert.equal(denied.status, 403); assert.match(denied.body.error, /فقط مدیر سامانه/);
      assert.deepEqual(await db.hrDeletionFileCleanup.findUnique({ where: { id: row.id } }), row);
      assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'PRIVATE HTTP CLEANUP COPY');
      const actual = await request(id, adminSession.token);
      if (kind === 'legacy') {
        assert.equal(actual.status, 200); assert.equal(actual.body.success, true);
        assert.deepEqual(actual.body.data, { receiptId: id, status: 'COMPLETED', remaining: 0 });
        assert.equal(fs.existsSync(stagedPath), false);
      } else {
        assert.equal(actual.status, kind === 'preparing' ? 409 : 202);
        assert.equal(actual.body.success, false);
        assert.match(actual.body.error, kind === 'preparing' ? /مرحلهٔ پاک‌سازی/ : /نسخه‌های نگهداری‌شده/);
        assert.deepEqual(await db.hrDeletionReceipt.findUnique({ where: { id } }), receipt);
        assert.deepEqual(await db.hrDeletionFileCleanup.findUnique({ where: { id: row.id } }), row);
        assert.equal(fs.readFileSync(stagedPath, 'utf8'), 'PRIVATE HTTP CLEANUP COPY');
      }
    }
    await db.authSession.update({ where: { id: adminSession.session.id }, data: { revokedAt: new Date(), revocationReason: 'ISOLATED_QA' } });
    assert.equal((await request(randomUUID(), adminSession.token)).status, 401);
    console.log(JSON.stringify({ actualHrRetryRouterPassed: true, cases: ['anonymous', 'hr-manager', 'admin-preparing', 'admin-versioned', 'admin-legacy', 'revoked-session'] }));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await lifecycle.waitForDrain(1000);
    console.log(JSON.stringify({ actualHrRetryHttpClosed: true }));
  }
}
