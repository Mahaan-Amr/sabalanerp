import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { KernelWriteAdmission } from '../../backend/src/services/kernelWriteAdmission';
import { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } from '../../backend/src/services/runtimeBoundaryJournal';
import { RuntimeTaskAdmission } from '../../backend/src/services/runtimeTaskAdmission';
import { RuntimeWorkContext } from '../../backend/src/services/runtimeWorkContext';
import { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { createDurableVersionedHiringFileTransaction } from '../../backend/src/services/hrVersionedDeletionFileJournal';
import { recoverInterruptedPersonnelErasures } from '../../backend/src/services/hrPersonnelErasureRecovery';
import { compileOnlineExpansion, type OnlineExpansionPlan } from '../../backend/src/services/onlineMigrationPlan';
import cleanupExpansion from '../../backend/src/services/hrVersionedFileCleanupExpansion.json';

async function main() {
  assert.equal(process.platform, 'linux');
  const input = (globalThis as typeof globalThis & { __sabalanHrErasureNativeInput?: { migrationSql: string } }).__sabalanHrErasureNativeInput;
  assert.ok(input && typeof input.migrationSql === 'string');
  assert.equal(compileOnlineExpansion(cleanupExpansion as OnlineExpansionPlan).sql, input.migrationSql);
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, 'postgres'); assert.equal(url.port, '5432');
  assert.match(url.pathname, /^\/qa_hr_erasure_[a-f0-9]{32}$/);
  assert.equal(url.searchParams.get('connection_limit'), '2'); assert.equal(url.searchParams.get('pool_timeout'), '5');
  const root = path.join(__dirname, randomBytes(16).toString('hex')); fs.mkdirSync(root, { mode: 0o700 });
  const gate = path.join(root, 'deployment-write-admission.lock'); fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const stat = fs.statSync(gate, { bigint: true });
  const identity = { device: String(stat.dev), inode: String(stat.ino), ownerUid: Number(stat.uid) };
  const runtimeId = randomBytes(32).toString('hex'), journalRoot = path.join(root, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  const work = new RuntimeWorkContext(new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {}), () => {});
  const store = path.join(root, 'versions'), live = path.join(root, 'live');
  for (const directory of [store, live]) fs.mkdirSync(directory, { mode: 0o700 });
  url.searchParams.set('application_name', scope.postgresApplicationName); process.env.DATABASE_URL = url.href;
  const { prisma: db, disconnectDatabase } = await import('../../backend/src/lib/prisma');
  try {
    const publication = await VersionedFilePublication.open(store, live, work);
    // Even an empty-file operation owns its parent before any child exists.
    // The legacy expiry worker must not infer raw-path authority from [] alone.
    const emptyVersionedReceipt = randomUUID(), emptyVersionedToken = randomUUID();
    await db.hrDeletionReceipt.create({ data: {
      id: emptyVersionedReceipt, targetType: 'PERSONNEL', targetId: randomUUID(), actorUserId: 'isolated-native-qa',
      reason: 'Isolated empty versioned owner acceptance', previewFingerprint: runtimeId,
      status: 'PREPARING', operationToken: emptyVersionedToken, leaseExpiresAt: new Date(0),
      recordCounts: { fileProtocol: 'sabalan-versioned-hr-erasure/v1', counts: {} }, fileCounts: {},
    } });
    assert.equal(await recoverInterruptedPersonnelErasures(db), 0);
    const emptyVersionedOwner = await db.hrDeletionReceipt.findUniqueOrThrow({ where: { id: emptyVersionedReceipt } });
    assert.equal(emptyVersionedOwner.status, 'PREPARING'); assert.equal(emptyVersionedOwner.operationToken, emptyVersionedToken);
    const receiptId = randomUUID(), operationToken = randomUUID();
    await db.hrDeletionReceipt.create({ data: {
      id: receiptId, targetType: 'PERSONNEL', targetId: 'isolated-native-qa', actorUserId: 'isolated-native-qa',
      reason: 'Isolated durable file journal acceptance', previewFingerprint: runtimeId,
      status: 'PREPARING', operationToken, leaseExpiresAt: new Date(Date.now() + 300_000), recordCounts: {}, fileCounts: {},
    } });
    const original = await publication.publish('personnel.pdf', Buffer.from('ORIGINAL PRIVATE HR DOCUMENT'));
    const unrelatedWork = new RuntimeWorkContext(
      new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {}), () => {});
    try {
      await assert.rejects(createDurableVersionedHiringFileTransaction({ database: db, publication,
        work: unrelatedWork, root: live, receiptId, operationToken }), /HR_VERSIONED_FILE_JOURNAL_SCOPE_INVALID/);
    } finally { await unrelatedWork.stopAndDrain(1000); }
    const files = await createDurableVersionedHiringFileTransaction({ database: db, publication, work, root: live, receiptId, operationToken });
    const planned = await files.plan('personnel.pdf', 'personnel-deletion');
    assert.equal(planned.status, 'VERSIONED_PLANNED');
    assert.equal(planned.state.originalVersionSha256, original);
    assert.equal(fs.readFileSync(path.join(live, 'personnel.pdf'), 'utf8'), 'ORIGINAL PRIVATE HR DOCUMENT');
    const staged = await files.stage(planned.id);
    assert.equal(staged.status, 'VERSIONED_STAGED');
    assert.deepEqual((await files.read(planned.id)).state.stageReceipt, staged.state.stageReceipt);
    assert.equal(staged.state.stageReceipt.originalVersionSha256, original);
    assert.equal(fs.existsSync(path.join(live, 'personnel.pdf')), false);
    assert.equal(fs.readFileSync(path.join(live, '.deletion-trash/personnel-deletion/personnel.pdf'), 'utf8'), 'ORIGINAL PRIVATE HR DOCUMENT');
    await db.hrDeletionReceipt.update({ where: { id: receiptId }, data: { leaseExpiresAt: new Date(0) } });
    assert.equal(await recoverInterruptedPersonnelErasures(db), 0);
    assert.equal((await files.read(planned.id)).status, 'VERSIONED_STAGED');
    assert.equal((await db.hrDeletionReceipt.findUniqueOrThrow({ where: { id: receiptId } })).operationToken, operationToken);
    const reopened = await createDurableVersionedHiringFileTransaction({ database: db, publication, work, root: live, receiptId, operationToken });
    assert.deepEqual(await reopened.read(planned.id), await files.read(planned.id));
    await assert.rejects(reopened.restore(planned.id), /HR_VERSIONED_FILE_ORIGINAL_ACTOR_REQUIRED/);
    const restored = await files.restore(planned.id);
    assert.equal(restored.status, 'VERSIONED_RESTORED');
    assert.match(restored.state.restoreReceipt.receiptSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await reopened.read(planned.id), restored);
    assert.equal(fs.readFileSync(path.join(live, 'personnel.pdf'), 'utf8'), 'ORIGINAL PRIVATE HR DOCUMENT');
    assert.equal(fs.existsSync(path.join(live, '.deletion-trash/personnel-deletion/personnel.pdf')), false);
    await db.hrDeletionReceipt.update({ where: { id: receiptId }, data: { leaseExpiresAt: new Date(Date.now() + 300_000) } });
    const erasedVersion = await publication.publish('erase.pdf', Buffer.from('RETAINED PRIVATE HR COPY'));
    const erasePlan = await files.plan('erase.pdf', 'erase-operation');
    await files.stage(erasePlan.id);
    await assert.rejects(files.commit(erasePlan.id), /HR_VERSIONED_FILE_OWNER_LOST/);
    assert.equal((await files.read(erasePlan.id)).status, 'VERSIONED_STAGED');
    await db.hrDeletionReceipt.update({ where: { id: receiptId }, data: {
      status: 'FILE_CLEANUP_PENDING', operationToken: null, leaseExpiresAt: null,
    } });
    await assert.rejects(files.restore(erasePlan.id), /HR_VERSIONED_FILE_OWNER_LOST/);
    await assert.rejects(reopened.commit(erasePlan.id), /HR_VERSIONED_FILE_ORIGINAL_ACTOR_REQUIRED/);
    const removed = await files.commit(erasePlan.id);
    assert.equal(removed.status, 'VERSIONED_LIVE_REMOVED_RETAINED_COPIES_PENDING');
    assert.equal(removed.state.removalReceipt.physicalErasure, 'UNPROVEN');
    assert.match(removed.state.removalReceipt.deletedVersionSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await reopened.read(erasePlan.id), removed);
    assert.equal(fs.existsSync(path.join(live, '.deletion-trash/erase-operation/erase.pdf')), false);
    assert.equal(fs.existsSync(path.join(live, 'erase.pdf')), false);
    assert.equal((await publication.readVersion(erasedVersion))!.toString(), 'RETAINED PRIVATE HR COPY');
    assert.equal((await db.hrDeletionReceipt.findUniqueOrThrow({ where: { id: receiptId } })).status, 'FILE_CLEANUP_PENDING');
    const { exerciseHrDeletionFileRetryHttp } = await import('./hr-erasure-file-retry-http.fixture');
    await work.run(() => exerciseHrDeletionFileRetryHttp(db, root));
    const { exerciseVersionedJobApplicationErasure } = await import('./hr-versioned-job-application-erasure.fixture');
    await work.run(() => exerciseVersionedJobApplicationErasure(db, publication, work, live));
    const { exerciseVersionedJobApplicationConcurrency } = await import('./hr-versioned-job-application-concurrency.fixture');
    await work.run(() => exerciseVersionedJobApplicationConcurrency(db, publication, work, live));
    console.log(JSON.stringify({ nativeDatabaseAndFilesPassed: true, root }));
  } finally {
    try { await disconnectDatabase(); } finally { await work.stopAndDrain(1000); }
    console.log(JSON.stringify({ nativeWorkAndDatabaseClosed: true }));
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'HR_NATIVE_FILE_JOURNAL_FAILED'); process.exitCode = 1; });
