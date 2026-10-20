import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.env.NODE_ENV, 'test');
  const selected = process.env.APPLICATION_NATIVE_WRITER_CASE;
  assert.ok(['digest-support', 'performance-rollback', 'performance-all', 'all-writers'].includes(selected || ''));
  const { loadOnlineRuntimeScope } = await import('../../backend/src/services/onlineRuntimeScope');
  const issued = loadOnlineRuntimeScope(); assert.ok(issued); assert.equal(issued.scope.purpose, 'jobs');
  const { configureNativeApplicationEnvironment } = await import('./application-native-environment.fixture');
  const browserEnvironment = configureNativeApplicationEnvironment(issued.scope.runtimeId);
  process.env.SUPPORT_TICKET_STORAGE_DIR = path.join(process.cwd(), 'storage/support-tickets');
  process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = path.join(process.cwd(), 'storage/performance-exports');
  const keys = { vault: randomBytes(32).toString('base64'), exports: randomBytes(32).toString('base64') };
  const keyFile = path.join(process.cwd(), 'private-writer-keys.json');
  const keyFd = fs.openSync(keyFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400);
  try { fs.writeFileSync(keyFd, JSON.stringify(keys)); fs.fsyncSync(keyFd); } finally { fs.closeSync(keyFd); }
  const parentFd = fs.openSync(process.cwd(), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(parentFd); } finally { fs.closeSync(parentFd); }
  process.env.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64 = keys.vault;
  process.env.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID = 'qa-native-vault-v1';
  process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64 = keys.exports;
  process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID = 'qa-native-export-v1';
  const { createScopedRuntimeWork } = await import('../../backend/src/services/onlineRuntimeWork');
  const boundary = await createScopedRuntimeWork({ registrySha256: issued.scope.manifestSha256, generation: 1, canJoin: () => true });
  const { prisma: db, disconnectDatabase } = await import('../../backend/src/lib/prisma');
  try {
    await boundary.runBackground(async () => {
      assert.equal(await db.user.count(), 0);
      if (!(await db.effectiveAuthorizationState.findUnique({ where: { id: 1 } }))) {
        await db.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
      }
      const admin = await db.user.create({ data: { username: 'private-writer-' + issued.scope.runtimeId,
        email: issued.scope.runtimeId + '@isolated.invalid', password: 'NO_LOGIN_PRIVATE_WRITER',
        firstName: 'Private', lastName: 'Native Writer', role: 'USER' } });
      const { VersionedFilePublication } = await import('../../backend/src/services/versionedFilePublication');
      const open = async (name: string, root: string) => {
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        const store = path.join(process.cwd(), '.writer-versions-' + name); fs.mkdirSync(store, { mode: 0o700 });
        return await VersionedFilePublication.open(store, root, boundary.context);
      };
      const results: Record<string, unknown> = {};
      if (selected === 'digest-support' || selected === 'all-writers') {
        const root = process.env.SUPPORT_TICKET_STORAGE_DIR!, publication = await open('support', root);
        const { configurePrivateVersionedSupportFiles } = await import('../../backend/src/services/supportFileRuntime');
        await configurePrivateVersionedSupportFiles({ boundary, publication });
        const { qualifySettledDigest } = await import('./settled-digest-native.fixture');
        const { qualifySupportRetention } = await import('./support-retention-native.fixture');
        const digest = await qualifySettledDigest({ boundary, publication, root,
          diagnosticsDirectory: path.join(process.cwd(), '.uncapturable-digest-diagnostics') });
        const support = await qualifySupportRetention({ db, boundary, publication, reporterId: admin.id });
        Object.assign(results, { digest, support });
      }
      if (selected !== 'digest-support') {
        const publication = await open('performance', process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR!);
        const { configurePrivateVersionedPerformanceFiles } = await import('../../backend/src/services/performanceFileRuntime');
        await configurePrivateVersionedPerformanceFiles({ boundary, publication });
        const fixture = await import('./performance-cleanup-native.fixture');
        const input = { db, boundary, publication, actorUserId: admin.id };
        if (selected === 'performance-rollback') results.rollback = await fixture.qualifyPerformanceCleanupRollback(input);
        else { const cleanup = await fixture.qualifyPerformanceCleanup(input); const { qualifyPerformanceExport } = await import('./performance-export-native.fixture');
          Object.assign(results, { cleanup, exports: await qualifyPerformanceExport(input) }); }
      }
      console.log(JSON.stringify({ event: 'native-writers-qualified', selected, runtimeId: issued.scope.runtimeId,
        actualNativeJobs: true, productionAdmission: false, browserEnvironment, results }));
    });
  } finally {
    await boundary.stopAndDrain(5000); await disconnectDatabase(); console.log('APPLICATION_NATIVE_WRITERS_CLOSED');
  }
}
void main().catch(error => { console.error(error?.message || 'APPLICATION_NATIVE_WRITERS_FAILED'); process.exitCode = 1; });
