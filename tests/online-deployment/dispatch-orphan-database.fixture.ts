import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { KernelWriteAdmission } from '../../backend/src/services/kernelWriteAdmission';
import { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } from '../../backend/src/services/runtimeBoundaryJournal';
import { RuntimeTaskAdmission } from '../../backend/src/services/runtimeTaskAdmission';
import { RuntimeWorkContext } from '../../backend/src/services/runtimeWorkContext';
import { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { createVersionedDispatchOrphanStorage } from '../../backend/src/services/dispatchVersionedOrphanStorage';

async function main() {
  assert.equal(process.platform, 'linux');
  const input = (globalThis as typeof globalThis & { __sabalanOrphanLocalInput?: { databaseUrl: string } }).__sabalanOrphanLocalInput;
  assert.ok(input && typeof input.databaseUrl === 'string');
  assert.equal(process.env.DATABASE_URL, input.databaseUrl);
  const url = new URL(input.databaseUrl);
  assert.equal(url.hostname, 'postgres'); assert.equal(url.port, '5432');
  assert.match(url.pathname, /^\/qa_dispatch_orphan_[a-f0-9]{32}$/);
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
  const publication = await VersionedFilePublication.open(store, live, work);
  const roots = { artifacts: path.join(live, 'artifacts'), quarantine: path.join(live, 'quarantine'),
    cleanup: path.join(live, 'cleanup'), state: path.join(live, 'state') };
  for (const directory of Object.values(roots)) fs.mkdirSync(directory, { mode: 0o700 });
  url.searchParams.set('application_name', scope.postgresApplicationName);
  process.env.DATABASE_URL = url.href;
  // This private process owns its sole application pool. Bootstrap and URL
  // validation precede every module that can construct that client.
  const { prisma: client, disconnectDatabase } = await import('../../backend/src/lib/prisma');
  const actorId = 'native-orphan-qa-' + runtimeId;
  try {
    const { createDispatchDocumentFilesystem, createDispatchDocumentRecoveryOperations,
      dispatchRecoveryIntegrityHash } = await import('../../backend/src/services/dispatchDocumentAuditRecovery');
    const artifact = await publication.bindRoot(roots.artifacts), quarantine = await publication.bindRoot(roots.quarantine),
      cleanup = await publication.bindRoot(roots.cleanup);
    const key = 'dispatch-documents/native-orphan.pdf', original = Buffer.from('EXACT ORIGINAL DISPATCH DOCUMENT 123456789.12345678');
    const originalVersion = await artifact.publish(key, original);
    const operations = createDispatchDocumentRecoveryOperations(client, createDispatchDocumentFilesystem({
      artifactRoot: roots.artifacts, quarantineRoot: roots.quarantine, cleanupStagingRoot: roots.cleanup,
    }), {} as never, { orphanStorage: ({ operationId }) => createVersionedDispatchOrphanStorage({ publication, roots, operationId }) });
    const authority = { effectiveAuthority: 'SYSTEM_RECOVERY_ADMIN', workspace: 'SYSTEM_RECOVERY' as const,
      feature: 'accounting_audit_view', permission: 'ADMIN' as const, subjectType: 'DISPATCH_DOCUMENT',
      subjectId: 'native-orphan-qa', sessionId: runtimeId, deviceId: 'isolated-native-local', beforeHash: null, afterHash: null };
    const common = { actorId, authority, correlationId: runtimeId, now: new Date('2026-10-01T00:00:00.000Z') };
    const reconciled = await work.run(() => operations.reconcile({ ...common, idempotencyKey: runtimeId + ':reconcile' }));
    assert.equal(reconciled.orphans.length, 1); assert.equal(reconciled.orphans[0]!.storageKey, key);
    const quarantined = await work.run(() => operations.quarantine({ ...common, storageKey: key,
      reason: 'native isolated acceptance', idempotencyKey: runtimeId + ':quarantine' }));
    assert.equal(quarantined.status, 'QUARANTINED'); assert.equal(await artifact.read(key), null);
    assert.deepEqual(await quarantine.read(key), original);
    const aggregateId = dispatchRecoveryIntegrityHash({ storageKey: key });
    const qAudit = await client.dispatchLifecycleAudit.findFirstOrThrow({ where: { aggregateId, eventType: 'QUARANTINE_COMPLETED' } });
    const evidence = (qAudit.payload as any).detail.fileReceipt;
    assert.equal(evidence.versionSha256, (await quarantine.inspect(key))!.versionSha256);
    assert.match(evidence.moveReceiptSha256, /^[a-f0-9]{64}$/);
    const removed = await work.run(() => operations.cleanup({ ...common, storageKey: key,
      reason: 'native isolated acceptance', idempotencyKey: runtimeId + ':cleanup', now: new Date('2026-10-19T00:00:00.000Z') }));
    assert.equal(removed.status, 'REMOVED'); assert.equal(await quarantine.read(key), null); assert.equal(await cleanup.read(key), null);
    assert.deepEqual(await artifact.readVersion(key, originalVersion), original);
    const rows = await client.dispatchLifecycleAudit.findMany({ where: { aggregateId }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
    assert.deepEqual(rows.map(row => row.eventType), ['INCIDENT_RECORDED', 'QUARANTINE_INTENT_RECORDED', 'QUARANTINE_COMPLETED', 'CLEANUP_INTENT_RECORDED', 'CLEANUP_COMPLETED']);
    for (let index = 1; index < rows.length; index++) assert.equal(rows[index]!.previousHash, rows[index - 1]!.eventHash);
    assert.equal(rows.every(row => row.actorId === actorId), true);
    assert.deepEqual(fs.readdirSync(path.join(store, 'pending')), []);
    console.log(JSON.stringify({ nativeDatabaseAndFilesPassed: true, auditEvents: rows.length, orphanCount: reconciled.orphans.length,
      currentCopiesRemoved: true, originalVersionRestorable: true, physicalErasure: 'UNPROVEN', productionAdmission: false }));
  } finally {
    try { await disconnectDatabase(); } finally { await work.stopAndDrain(1000); }
    console.log(JSON.stringify({ nativeWorkAndDatabaseClosed: true, runtimeId, journalRoot, gate }));
  }
}
void main().catch(error => { console.error(error instanceof Error ? error.message : 'NATIVE_ORPHAN_DATABASE_FAILED'); process.exitCode = 1; });
