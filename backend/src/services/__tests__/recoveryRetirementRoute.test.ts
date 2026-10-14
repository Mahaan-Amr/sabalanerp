import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import test from 'node:test';
import express from 'express';
import bcrypt from 'bcryptjs';
import ts from 'typescript';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

test('real restore HTTP failure keeps retirement reserved through status and audit persistence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-recovery-route-'));
  const previous = process.env.RECOVERY_COORDINATION_DIR;
  process.env.RECOVERY_COORDINATION_DIR = root;
  const runtime = await import('../recoveryRuntime');
  runtime.initializeRecoveryRuntime();
  const load = createRequire(path.join(__dirname, '../../routes/system-recovery.ts'));
  const statusHolding = deferred();
  const statusEntered = deferred();
  const auditHolding = deferred();
  const auditEntered = deferred();
  const completed: string[] = [];
  const password = await bcrypt.hash('local-test-administrator', 4);
  const database: any = {
    user: { findUnique: async ({ select }: any) => select.password ? { password } : { firstName: 'QA', lastName: 'Owner', username: 'qa' },
      count: async () => 1, findMany: async () => [] },
    recoveryOperation: {
      findUnique: async () => ({ id: 'qa-restore', status: 'VALIDATED', storageName: 'fixture.sabrec', encryptedSha256: 'a'.repeat(64), packageType: 'COMPLETE' }),
      update: async ({ data }: any) => {
        if (data.status === 'FAILED') { statusEntered.resolve(); await statusHolding.promise; completed.push('status'); }
      },
    },
    recoveryAuditEvent: { create: async ({ data }: any) => {
      if (data.eventType === 'RECOVERY_RESTORE_FAILED') { auditEntered.resolve(); await auditHolding.promise; completed.push('audit'); }
    } },
    $transaction: async (work: any) => work(database),
  };
  const replacements: Record<string, unknown> = {
    '../lib/prisma': { prisma: database },
    '../middleware/auth': { protect: (request: any, _response: any, next: any) => { request.user = { id: 'qa-owner' }; next(); }, authorize: () => (_req: any, _res: any, next: any) => next() },
    '../services/systemRecoveryEngine': { recoveryPackagePath: () => '/unused/fixture.sabrec',
      validateRecoveryPackage: async () => ({ compatibility: { compatible: true } }),
      stageAndPromoteRecovery: async () => { throw Object.assign(new Error('Injected isolated restore failure'), { code: 'QA_RESTORE_FAILURE' }); } },
    '../services/recoveryRuntime': { ...runtime, RECOVERY_ROOT: root },
    '../services/notificationService': { publishNotificationEvent: async () => undefined },
  };
  const code = ts.transpileModule(await fs.readFile(path.join(__dirname, '../../routes/system-recovery.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const exported: any = {};
  vm.runInNewContext(code, { exports: exported, require: (name: string) => replacements[name] ?? load(name),
    console, process, Buffer, setImmediate, setTimeout, clearTimeout }, { filename: 'system-recovery-route-under-test.js' });
  const app = express(); app.use(express.json()); app.use(exported.default);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${(server.address() as any).port}/qa-restore/restore`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ adminPassword: 'local-test-administrator',
        passphrase: 'Local-test-passphrase-123', confirmationPhrase: 'RESTORE SABALAN ERP', breakGlassReason: 'Isolated recovery retirement regression test.' }),
    });
    assert.equal(response.status, 202);
    await Promise.race([statusEntered.promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Failure handler not entered')), 2000).unref())]);
    let drained = false;
    const drain = runtime.waitForRecoveryOperationDrain(2000).then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 15));
    assert.equal(drained, false, 'failure status persistence still owns retirement');
    statusHolding.resolve(); await auditEntered.promise;
    assert.equal(drained, false, 'failure audit persistence still owns retirement');
    auditHolding.resolve(); await drain;
    assert.deepEqual(completed, ['status', 'audit']);
  } finally {
    statusHolding.resolve(); auditHolding.resolve();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    if (previous === undefined) delete process.env.RECOVERY_COORDINATION_DIR; else process.env.RECOVERY_COORDINATION_DIR = previous;
    await fs.rm(root, { recursive: true, force: true });
  }
});
