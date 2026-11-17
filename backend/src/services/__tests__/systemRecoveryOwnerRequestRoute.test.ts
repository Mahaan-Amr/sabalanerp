import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import bcrypt from 'bcryptjs';
import express from 'express';
import ts from 'typescript';
import { HttpRequestLifecycle } from '../httpRequestLifecycle';

async function loadModule(file: string, replacements: Record<string, unknown>, environment: NodeJS.ProcessEnv) {
  const filename = path.join(__dirname, file);
  const requireModule = createRequire(filename);
  const exported: Record<string, any> = {};
  const code = ts.transpileModule(await fs.readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports: exported, require: (name: string) => replacements[name] ?? requireModule(name),
    process: { env: environment }, console, Buffer, setImmediate,
  }, { filename });
  return exported;
}

test('restricted System Recovery records an authenticated complete backup request for the owner runner', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-recovery-request-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const environment = { DATABASE_URL: 'postgresql://sabalan_application_runtime@localhost/test' };
  const password = 'isolated-admin-password';
  const passwordHash = await bcrypt.hash(password, 4);
  const operationId = 'cm12345678901234567890123';
  const committed: unknown[][] = [];
  let failAudit = false;
  let writeAdmitted = true;
  const requests = new HttpRequestLifecycle(() => writeAdmitted);
  const database = {
    user: { findUnique: async ({ where }: { where: { id: string } }) => where.id === 'admin' ? { password: passwordHash } : null },
    async $transaction(work: (transaction: object) => Promise<unknown>) {
      const writes: unknown[] = [];
      const result = await work({
        recoveryOperation: { create: async ({ data }: { data: object }) => {
          writes.push({ operation: data });
          return { id: operationId, ...data };
        } },
        recoveryAuditEvent: { create: async ({ data }: { data: object }) => {
          if (failAudit) throw new Error('Injected audit failure');
          writes.push({ audit: data });
        } },
      });
      committed.push(writes);
      return result;
    },
  };
  const engine = { createRecoveryPackage: () => assert.fail('The serving backend must not execute the backup') };
  const auth = await loadModule('../../middleware/auth.ts', {
    '../lib/prisma': { prisma: database },
    '../services/identitySessionService': {
      SESSION_COOKIE: 'session',
      parseCookies: (cookie?: string) => ({ session: cookie?.split('=')[1] }),
      resolveAuthoritativeSession: async (_database: object, token: string) => ({
        id: token, user: { id: token, isActive: true, role: token === 'admin' ? 'ADMIN' : 'USER' },
      }),
    },
  }, environment);
  const backupRequest = await loadModule('../systemRecoveryBackupRequest.ts', { './systemRecoveryEngine': engine }, environment);
  const route = await loadModule('../../routes/system-recovery.ts', {
    '../lib/prisma': { prisma: database },
    '../middleware/auth': auth,
    '../services/systemRecoveryEngine': engine,
    '../services/systemRecoveryBackupRequest': backupRequest,
    '../services/recoveryRuntime': { RECOVERY_ROOT: root },
    '../services/notificationService': {},
    '../services/httpRequestLifecycle': { runtimeHttpRequests: requests },
  }, environment);
  const app = express();
  app.use(requests.middleware);
  app.use(express.json());
  app.use('/api/system-recovery', route.default);
  const server = app.listen(0, '127.0.0.1');
  t.after(() => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert(address && typeof address === 'object');
  const post = (body: object, session?: string, pathname = '/owner-backup-requests') =>
    fetch(`http://127.0.0.1:${address.port}/api/system-recovery${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(session ? { Cookie: 'session=' + session } : {}) },
      body: JSON.stringify(body),
    });

  const response = await post({ adminPassword: password }, 'admin');
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { success: true, data: { id: operationId, status: 'CREATING' } });
  const persisted = JSON.parse(JSON.stringify(committed));
  assert(Number.isFinite(Date.parse(persisted[0][0].operation.expiresAt)));
  delete persisted[0][0].operation.expiresAt;
  assert.deepEqual(persisted, [[
    { operation: { packageType: 'COMPLETE', source: 'CREATED', status: 'CREATING', progress: 0, createdById: 'admin' } },
    { audit: { operationId, actorId: 'admin', eventType: 'RECOVERY_OWNER_BACKUP_REQUESTED', details: { packageType: 'COMPLETE' } } },
  ]]);

  assert.equal((await post({ adminPassword: password })).status, 401);
  assert.equal((await post({ adminPassword: password }, 'user')).status, 403);
  assert.equal((await post({ adminPassword: 'incorrect' }, 'admin')).status, 403);
  assert.equal((await post({ adminPassword: password, passphrase: 'separate-secret' }, 'admin')).status, 400);
  assert.equal((await post({ adminPassword: password }, 'admin', '/backups')).status, 503);
  assert.equal((await post({ adminPassword: password }, 'admin', '/uploads')).status, 503);
  assert.equal((await post({ adminPassword: password }, 'admin', '/id/restore')).status, 503);
  writeAdmitted = false;
  const held = await post({ adminPassword: password }, 'admin');
  assert.equal(held.status, 503);
  const holdResponse = await held.json();
  assert(holdResponse && typeof holdResponse === 'object' && 'error' in holdResponse);
  assert.equal(holdResponse.error, 'RECOVERY_WRITE_ADMISSION_CLOSED');
  writeAdmitted = true;
  failAudit = true;
  const failed = await post({ adminPassword: password }, 'admin');
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), { success: false, error: 'SYSTEM_RECOVERY_OWNER_REQUEST_FAILED' });
  assert.equal(committed.length, 1);
  environment.DATABASE_URL = 'postgresql://legacy@localhost/test';
  assert.equal((await post({ adminPassword: password }, 'admin')).status, 404);
});
