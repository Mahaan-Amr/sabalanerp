import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { execFile } from 'node:child_process';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { promisify } from 'node:util';
import bcrypt from 'bcryptjs';
import express from 'express';
import ts from 'typescript';
import { HttpRequestLifecycle } from '../httpRequestLifecycle';
import { encryptRecoveryArchive } from '../recoveryCrypto';

async function loadModule(file: string, replacements: Record<string, unknown>, environment: NodeJS.ProcessEnv) {
  const filename = path.join(__dirname, file);
  const requireModule = createRequire(filename);
  const exported: Record<string, any> = {};
  const code = ts.transpileModule(await fs.readFile(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports: exported, require: (name: string) => replacements[name] ?? requireModule(name),
    process: { env: environment, cwd: process.cwd, platform: process.platform }, console, Buffer, setImmediate,
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
  assert.equal((await post({ adminPassword: password }, 'admin', '/backups')).status, 400);
  assert.equal((await post({ adminPassword: password }, 'admin', '/uploads')).status, 400);
  assert.equal((await post({ adminPassword: password }, 'admin', '/id/restore')).status, 400);
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

for (const intent of ['BACKUP', 'RESTORE'] as const) {
test(`restricted ADMIN validates an encrypted upload and queues ${intent} without database control privileges`, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-recovery-upload-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const environment = {
    DATABASE_URL: 'postgresql://sabalan_application_runtime@localhost/test',
    RECOVERY_STORAGE_DIR: root,
    NODE_ENV: 'production',
    SYSTEM_RECOVERY_OWNER_PUBLIC_KEY_FILE: path.join(root, 'owner-public.pem'),
  };
  const keys = generateKeyPairSync('rsa', { modulusLength: 3072,
    publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  await fs.writeFile(environment.SYSTEM_RECOVERY_OWNER_PUBLIC_KEY_FILE, keys.publicKey);
  const password = 'isolated-admin-password';
  const passphrase = 'Recovery-passphrase-123';
  const passwordHash = await bcrypt.hash(password, 4);
  const operations = new Map<string, any>();
  const events: any[] = [];
  let operationNumber = 0;
  const database = {
    user: {
      findUnique: async () => ({ password: passwordHash, firstName: 'Test', lastName: 'Admin', username: 'admin' }),
      findMany: async () => [], count: async () => 1,
    },
    recoveryOperation: {
      create: async ({ data }: any) => {
        const operation = { id: 'c' + String(++operationNumber).padStart(24, '0'), ...data };
        operations.set(operation.id, operation);
        return operation;
      },
      update: async ({ where, data }: any) => Object.assign(operations.get(where.id), data),
      findMany: async () => [...operations.values()],
      findFirst: async () => null,
      findUnique: async ({ where }: any) => operations.get(where.id),
    },
    recoveryAuditEvent: { create: async ({ data }: any) => { events.push(data); return data; } },
    async $transaction(work: (tx: object) => Promise<any>): Promise<any> { return work(database); },
    $queryRawUnsafe: async (sql: string) => {
      assert.equal(sql, 'SHOW server_version', 'upload validation must not execute privileged SQL');
      return [{ version: '15.0' }];
    },
  };
  const runtime = { ...await import('../recoveryRuntime'), RECOVERY_ROOT: root, RECOVERY_COORDINATION_DIR: path.join(root, 'coordination') };
  t.after(() => runtime.releaseRecoveryOperation());
  const engine = await loadModule('../systemRecoveryEngine.ts', {
    './recoveryRuntime': runtime,
  }, environment);
  const handoff = await loadModule('../systemRecoveryOwnerHandoff.ts', { './recoveryRuntime': runtime }, environment);
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
  const route = await loadModule('../../routes/system-recovery.ts', {
    '../lib/prisma': { prisma: database },
    '../middleware/auth': auth,
    '../services/systemRecoveryEngine': engine,
    '../services/systemRecoveryOwnerHandoff': handoff,
    '../services/recoveryRuntime': runtime,
    '../services/notificationService': {},
  }, environment);
  const app = express();
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
  const baseUrl = `http://127.0.0.1:${address.port}/api/system-recovery`;
  const payload = path.join(root, 'fixture');
  const components: Array<{ path: string; size: number; sha256: string }> = [];
  for (const [name, bytes] of [['database/main.dump', 'opaque-dump'], ['inquiry/inquiry.db', 'opaque-sqlite']]) {
    await fs.mkdir(path.dirname(path.join(payload, name)), { recursive: true });
    await fs.writeFile(path.join(payload, name), bytes);
    components.push({ path: name, size: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await fs.writeFile(path.join(payload, 'manifest.json'), JSON.stringify({
    format: 'sabalan-recovery', formatVersion: 1, packageType: 'COMPLETE',
    appVersion: '1.0.0', postgresVersion: '15.0', components,
  }));
  const archive = path.join(root, 'fixture.tar.gz');
  const encrypted = path.join(root, 'fixture.sabrec');
  await promisify(execFile)('tar', ['-czf', archive, '-C', payload, '.']);
  await encryptRecoveryArchive(archive, encrypted, passphrase);
  const form = new FormData();
  form.set('adminPassword', password);
  form.set('passphrase', passphrase);
  form.set('file', new Blob([await fs.readFile(encrypted)]), 'complete.sabrec');
  const response = await fetch(`${baseUrl}/uploads`, { method: 'POST', headers: { Cookie: 'session=admin' }, body: form });
  assert.equal(response.status, 202);
  const receipt: any = await response.json();
  assert.equal(receipt.data.originalName, 'complete.sabrec');
  assert.equal(receipt.data.storageName, undefined);
  let result: any;
  const validationDeadline = Date.now() + 30_000;
  while (Date.now() < validationDeadline) {
    const listing: any = await (await fetch(baseUrl, { headers: { Cookie: 'session=admin' } })).json();
    result = listing.data.operations.find((operation: any) => operation.id === receipt.data.id);
    if (result.status !== 'VALIDATING') break;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(result.status, 'VALIDATED', result.errorMessage);
  assert.equal(result.packageType, 'COMPLETE');
  assert.equal(result.progress, 100);
  assert.equal(result.compatibility.compatible, true);
  if (intent === 'RESTORE') {
    const restoreResponse = await fetch(`${baseUrl}/${receipt.data.id}/restore`, { method: 'POST',
      headers: { Cookie: 'session=admin', 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password, passphrase, confirmationPhrase: 'RESTORE SABALAN ERP',
        breakGlassReason: 'Restore the approved complete backup after operator verification.' }) });
    assert.equal(restoreResponse.status, 202);
    const restored: any = await restoreResponse.json();
    assert.equal(restored.data.operationId, receipt.data.id);
    assert.equal(restored.data.restarting, true);
    const sealed = await fs.readFile(path.join(root, 'owner-inbox', receipt.data.id + '.json'));
    const request = handoff.openRecoveryOwnerRequest(sealed, keys.privateKey);
    assert.equal(request.action, 'RESTORE');
    assert.equal(request.actorId, 'admin');
    assert.equal(request.checksum, result.encryptedSha256);
    assert.equal(request.confirmationPhrase, 'RESTORE SABALAN ERP');
    assert.equal(sealed.includes(Buffer.from(passphrase)), false);
    return;
  }
  const backupResponse = await fetch(`${baseUrl}/backups`, { method: 'POST',
    headers: { Cookie: 'session=admin', 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminPassword: password, passphrase, packageType: 'SANITIZED_TEST' }) });
  assert.equal(backupResponse.status, 202);
  const backup: any = await backupResponse.json();
  assert.equal(backup.data.packageType, 'SANITIZED_TEST');
  const sealed = await fs.readFile(path.join(root, 'owner-inbox', backup.data.id + '.json'));
  assert.equal(sealed.includes(Buffer.from(passphrase)), false);
  const request = handoff.openRecoveryOwnerRequest(sealed, keys.privateKey);
  assert.equal(request.operationId, backup.data.id);
  assert.equal(request.actorId, 'admin');
  assert.equal(request.action, 'BACKUP');
  assert.equal(request.packageType, 'SANITIZED_TEST');
  assert.equal(request.passphrase, passphrase);
  assert(events.some(event => event.operationId === backup.data.id && event.eventType === 'RECOVERY_OWNER_HANDOFF_REQUESTED'
    && event.details.sealedSha256 === createHash('sha256').update(sealed).digest('hex')));
});
}
