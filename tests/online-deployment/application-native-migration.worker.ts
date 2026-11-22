import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { assertNativePrivateIPv4 } from './native-private-network.fixture.mjs';

const hash = (bytes: string | Buffer) => createHash('sha256').update(bytes).digest('hex');
function read(file: string, maximum = 65536) {
  assert.equal(fs.realpathSync(file), file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!())
      && !(before.mode & 0o077n) && before.size > 0n && before.size <= BigInt(maximum));
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, null); assert.ok(n > 0); offset += n; }
    assert.equal(fs.readSync(fd, Buffer.alloc(1), 0, 1, null), 0);
    for (const after of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(file, { bigint: true })]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'nlink', 'uid', 'mode'] as const) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.env.NODE_ENV, 'test');
  const input = JSON.parse(read(process.env.APPLICATION_MIGRATION_INPUT!).toString());
  assert.equal(input.format, 'sabalan-native-migration-input/v1');
  assertNativePrivateIPv4(input.host);
  assert.ok(Number.isInteger(input.port) && input.port >= 1024 && input.port <= 65535);
  const seedBytes = read(path.join(process.cwd(), 'acceptance-seed.json'));
  assert.equal(hash(seedBytes), input.seedSha256); const seed = JSON.parse(seedBytes.toString());
  process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = path.join(process.cwd(), 'storage/performance-exports');
  const performanceKeys = { vault: randomBytes(32).toString('base64'), exports: randomBytes(32).toString('base64') };
  const performanceKeyFd = fs.openSync(path.join(__dirname, 'private-performance-keys.json'), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400);
  try { fs.writeFileSync(performanceKeyFd, JSON.stringify(performanceKeys)); fs.fsyncSync(performanceKeyFd); } finally { fs.closeSync(performanceKeyFd); }
  const keyParentFd = fs.openSync(__dirname, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(keyParentFd); } finally { fs.closeSync(keyParentFd); }
  process.env.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64 = performanceKeys.vault;
  process.env.PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID = 'qa-native-vault-v1';
  process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64 = performanceKeys.exports;
  process.env.PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID = 'qa-native-export-v1';
  process.env.SUPPORT_TICKET_STORAGE_DIR = path.join(process.cwd(), 'storage/support-tickets');
  const { loadOnlineRuntimeScope } = await import('../../backend/src/services/onlineRuntimeScope');
  const issued = loadOnlineRuntimeScope(); assert.ok(issued); assert.equal(issued.scope.purpose, 'jobs');
  const { configureNativeApplicationEnvironment } = await import('./application-native-environment.fixture');
  const browserEnvironment = configureNativeApplicationEnvironment(issued.scope.runtimeId);
  assert.equal(issued.scope.database.name, seed.database);
  const { createScopedRuntimeWork } = await import('../../backend/src/services/onlineRuntimeWork');
  const boundary = await createScopedRuntimeWork({ registrySha256: issued.scope.manifestSha256, generation: 1, canJoin: () => true });
  const { prisma: db, disconnectDatabase } = await import('../../backend/src/lib/prisma');
  try {
    const { VersionedFilePublication } = await import('../../backend/src/services/versionedFilePublication');
    const { supportTicketStorageDirectory, configurePrivateVersionedSupportFiles } = await import('../../backend/src/services/supportFileRuntime');
    const supportRoot = supportTicketStorageDirectory();
    const source = input.sources.find((value: any) => value.path === supportRoot);
    assert.ok(source && source.storeRoot.startsWith(path.dirname(process.cwd()) + '/versions/'));
    const supportPublication = await VersionedFilePublication.open(source.storeRoot, supportRoot, boundary.context);
    await configurePrivateVersionedSupportFiles({ boundary, publication: supportPublication });
    const { qualifySupportRetention } = await import('./support-retention-native.fixture');
    const { DISPATCH_DOCUMENT_STORAGE_ROOT, configurePrivateVersionedDispatchFiles } = await import('../../backend/src/services/dispatchFileRuntime');
    const dispatchSource = input.sources.find((value: any) => value.path === DISPATCH_DOCUMENT_STORAGE_ROOT);
    assert.ok(dispatchSource && dispatchSource.storeRoot.startsWith(path.dirname(process.cwd()) + '/versions/'));
    const dispatchPublication = await VersionedFilePublication.open(dispatchSource.storeRoot, DISPATCH_DOCUMENT_STORAGE_ROOT, boundary.context);
    await configurePrivateVersionedDispatchFiles({ boundary, publication: dispatchPublication });
    const { installNativePdfStageTrace } = await import('./pdf-renderer-stage-trace.fixture');
    installNativePdfStageTrace();
    const { qualifyNativeDispatch } = await import('./dispatch-artifact-native.fixture');
    const { performanceExportStorageDirectory, configurePrivateVersionedPerformanceFiles } = await import('../../backend/src/services/performanceFileRuntime');
    const performanceRoot = performanceExportStorageDirectory();
    const performanceSource = input.sources.find((value: any) => value.path === performanceRoot);
    assert.ok(performanceSource && performanceSource.storeRoot.startsWith(path.dirname(process.cwd()) + '/versions/'));
    const performancePublication = await VersionedFilePublication.open(performanceSource.storeRoot, performanceRoot, boundary.context);
    await configurePrivateVersionedPerformanceFiles({ boundary, publication: performancePublication });
    const { qualifyPerformanceCleanup } = await import('./performance-cleanup-native.fixture');
    const { qualifyPerformanceExport } = await import('./performance-export-native.fixture');
    const { applyOnlineExpansion, backfillMirroredColumn, compileOnlineExpansion, mirroredBackfillOperationSha256 } = await import('../../backend/src/services/onlineMigrationPlan');
    const plan = { format: 'sabalan-online-expansion/v1' as const, migrationName: '20261019090000_qa_native_shared_mirror',
      operations: [{ kind: 'mirror-column' as const, table: 'application_online_migration_probe', column: 'amount_v2', sourceColumn: 'amount', type: 'numeric(24,8)' as const }] };
    const compiled = compileOnlineExpansion(plan);
    const owner = { deploymentId: 'private-migration-' + issued.scope.runtimeId, leaseToken: randomUUID(), releaseId: issued.scope.releaseId };
    const headers = { Cookie: 'sabalan_session=' + seed.sessionToken, 'Content-Type': 'application/json' };
    const accountUrl = 'http://' + input.host + ':' + input.port + '/api/accounting/ledger/customer-accounts/' + encodeURIComponent(seed.customerId);
    const balance = async (expected: string) => { const response = await fetch(accountUrl, { headers }); const result = await response.json() as any;
      assert.equal(response.status, 200, JSON.stringify(result)); assert.equal(String(result.data.netBalanceRials), expected); };
    const fullHistory = async () => { const [row] = await db.$queryRaw<{ value: string }[]>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations t`;
      return { rows: JSON.parse(row.value).length, sha256: hash(row.value) }; };
    await boundary.runBackground(async () => {
      assert.deepEqual(await fullHistory(), input.originalHistory);
      await db.deploymentOperation.create({ data: { id: owner.deploymentId, activeKey: 'production', leaseToken: owner.leaseToken,
        releaseId: owner.releaseId, targetCommit: issued.scope.sourceCommit, owner: issued.scope.runtimeId, phase: 'LEASE_ACQUIRED',
        leaseExpiresAt: new Date(Date.now() + 600_000), heartbeatAt: new Date(), startedAt: new Date() } });
      await db.onlineRelease.create({ data: { id: owner.releaseId, deploymentId: owner.deploymentId, manifestSha256: issued.scope.manifestSha256,
        sourceCommit: issued.scope.sourceCommit, identityJson: { runtimeId: issued.scope.runtimeId }, compatibilityJson: { diagnosticProbeOnly: true },
        recoveryJson: { productionAdmission: false }, phase: 'EXPANDING' } });
      await db.onlineMigrationStep.create({ data: { id: 'expand-' + issued.scope.runtimeId, releaseId: owner.releaseId, stepId: plan.migrationName,
        phase: 'expand', operationSha256: compiled.operationSha256, operationJson: compiled.plan, sourceMigrationName: plan.migrationName } });
      await balance('123456789');
      await assert.rejects(() => applyOnlineExpansion(db, { ...owner, leaseToken: 'not-the-lease' }, plan, Buffer.from(compiled.sql)), /LEASE_LOST/);
      assert.equal((await applyOnlineExpansion(db, owner, plan, Buffer.from(compiled.sql))).applied, true);
      assert.equal((await applyOnlineExpansion(db, owner, plan, Buffer.from(compiled.sql))).applied, false);
      const backfill = { format: 'sabalan-mirror-backfill/v1' as const, expansionMigrationName: plan.migrationName, operation: plan.operations[0] };
      const stepId = 'backfill-' + issued.scope.runtimeId;
      await db.onlineMigrationStep.create({ data: { id: stepId, releaseId: owner.releaseId, stepId, phase: 'backfill',
        operationSha256: mirroredBackfillOperationSha256(backfill), operationJson: backfill } });
      await db.onlineRelease.update({ where: { id: owner.releaseId }, data: { phase: 'BACKFILLING' } });
      // Actual canonical financial writes/readbacks overlap independently
      // acknowledged old/new numeric writers and bounded resumable batches.
      let batchCount = 0;
      const activity = await Promise.allSettled([
        (async () => {
          for (const [kind, expected] of [['DEBIT', '123456791'], ['CREDIT', '123456789']] as const) {
            const response = await fetch(accountUrl + '/operations', { method: 'POST', headers,
              body: JSON.stringify({ ...seed.command, kind, amountRials: '2', idempotencyKey: randomUUID() }) });
            const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result));
            await balance(expected);
          }
        })(),
        (async () => { for (let i = 1; i <= 20; i++) await db.$executeRaw`UPDATE application_online_migration_probe SET amount=amount+0.125 WHERE id=${i}`; })(),
        (async () => { for (let i = 21; i <= 40; i++) await db.$executeRaw`UPDATE application_online_migration_probe SET amount_v2=coalesce(amount_v2,amount)+0.25 WHERE id=${i}`; })(),
        (async () => { let done = false; for (; batchCount < 40 && !done; batchCount++) done = (await backfillMirroredColumn(db, owner, stepId, backfill, 7)).complete;
          assert.ok(done); })(),
      ]);
      for (const result of activity) if (result.status === 'rejected') throw result.reason;
      const [totals] = await db.$queryRaw<{ count: number; sum: string; equal: boolean }[]>`SELECT count(*)::int AS count,sum(amount)::text AS sum,bool_and(amount=amount_v2) AS equal FROM application_online_migration_probe`;
      assert.deepEqual(totals, { count: 100, sum: '1032.50000000', equal: true });
      const [old] = await db.$queryRaw<{ value: string }[]>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations t WHERE migration_name<>${plan.migrationName}`;
      assert.deepEqual({ rows: JSON.parse(old.value).length, sha256: hash(old.value) }, input.originalHistory);
      const history = await fullHistory(); assert.equal(history.rows, input.originalHistory.rows + 1);
      const support = await qualifySupportRetention({ db, boundary, publication: supportPublication, reporterId: seed.adminId });
      const dispatch = await qualifyNativeDispatch({ db, boundary, publication: dispatchPublication, reporterId: seed.adminId });
      const performanceActor = await db.user.create({ data: { username: 'native-performance-' + issued.scope.runtimeId,
        email: 'performance-' + issued.scope.runtimeId + '@isolated.invalid', password: 'NO_LOGIN_PRIVATE_PERFORMANCE',
        firstName: 'Private', lastName: 'Performance Writer', role: 'USER' } });
      const performanceInput = { db, boundary, publication: performancePublication, actorUserId: performanceActor.id };
      const performanceCleanup = await qualifyPerformanceCleanup(performanceInput);
      // Capture the retained receipt only after cleanup/hold evidence revisions settle.
      const performanceExport = await qualifyPerformanceExport(performanceInput);
      await db.onlineRelease.update({ where: { id: owner.releaseId }, data: { phase: 'ACCEPTING' } });
      console.log(JSON.stringify({ event: 'migration-qualified', runtimeId: issued.scope.runtimeId, migrationName: plan.migrationName,
        sqlSha256: compiled.sqlSha256, originalHistory: input.originalHistory, history, batchCount, totals,
        canonicalFinancialWrites: 2, netBalancePreserved: '123456789', support, dispatch, performanceCleanup, performanceExport, browserEnvironment, actualNativeJobsOwner: true, financialSchemaQualified: false }));
    });
  } finally { await boundary.stopAndDrain(5000); await disconnectDatabase(); console.log('APPLICATION_NATIVE_MIGRATION_CLOSED'); }
}
void main().catch(error => { console.error(error?.stack || 'APPLICATION_NATIVE_MIGRATION_FAILED'); process.exitCode = 1; });
