import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { PrismaClient } from '@prisma/client';
import type { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import type { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { performanceExportStorageDirectory } from '../../backend/src/services/performanceFileRuntime';
import { activeHrActionPermissionsForUser } from '../../backend/src/services/hrAuthorizationService';
import { canonicalPerformanceHash } from '../../backend/src/services/personnelPerformancePolicy';
import { persistPerformancePayload, readPerformancePayload, performanceVaultKeyFromEnvironment } from '../../backend/src/services/personnelPerformancePayloadStore';
import { sealPerformanceExportLineage, resolvePerformanceExportDependencies } from '../../backend/src/services/personnelPerformanceExportLineage';
import { readPerformanceRetentionPolicy } from '../../backend/src/services/personnelPerformanceRetentionStore';
import { processPerformanceExport, claimPerformanceExportDownload, completePerformanceExportDownload,
  decryptPerformanceExportArtifact, performanceExportKeyFromEnvironment } from '../../backend/src/services/personnelPerformanceDisclosureStore';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
// Private test token is reproducible only with the separately held actual
// export key. Neither token nor key is included in qualification metadata.
const privateToken = (exportId: string) => createHmac('sha256', performanceExportKeyFromEnvironment().key)
  .update('sabalan-native-performance-download/v1:' + exportId).digest('base64url');
const expectedRows = [{ level: 'Native approved aggregate', count: '12' }, { level: 'Native follow-up aggregate', count: '10' }];
export type PerformanceExportQualification = { format: 'sabalan-native-performance-export/v1'; exportId: string;
  actorUserId: string; encryptedPayloadId: string; evidenceRevision: string; sourceArtifactPath: string; fileName: string;
  artifactHash: string; cipherSha256: string; cipherBytes: number; plaintextBytes: number; versionSha256: string; snapshotHash: string; sourcePolicyId: string };
function assertWorkbook(bytes: Buffer) {
  const book = XLSX.read(bytes, { type: 'buffer' });
  assert.deepEqual(book.SheetNames, ['گزارش عملکرد']);
  assert.deepEqual(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { raw: false }), expectedRows);
}

/** Real processor fixture, not an analytics-population/request-authorization
 * acceptance claim. No mocked renderer, SQL, encryption or extra Prisma client.
 * The caller prebinds the same genuine jobs publication/root before app import. */
export async function qualifyPerformanceExport(input: {
  db: PrismaClient; boundary: RuntimeWorkBoundary; publication: VersionedFilePublication; actorUserId: string;
}): Promise<PerformanceExportQualification> {
  const { db, boundary, publication, actorUserId } = input;
  assert.ok(publication.ownsRoot(performanceExportStorageDirectory()) && publication.ownsWork(boundary.context));
  const files = await publication.bindRoot(performanceExportStorageDirectory());
  return boundary.runBackground(async () => {
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
    assert.match(name, /^qa_[a-z_]+_[a-f0-9]{32}$/);
    const actor = await db.user.findUniqueOrThrow({ where: { id: actorUserId } });
    assert.equal(actor.role, 'USER', 'Canonical Performance fixtures use an explicit action-granted actor, not a catalog override');
    assert.equal(actor.isActive, true);
    await db.hrWorkspaceCatalog.upsert({ where: { code: 'HUMAN_RESOURCES' }, update: {},
      create: { code: 'HUMAN_RESOURCES', displayName: 'Private native fixture' } });
    for (const featureCode of ['REQUEST_PERFORMANCE_EXPORT', 'VIEW_PERFORMANCE_ANALYTICS', 'PLACE_PERFORMANCE_LEGAL_HOLD']) {
      await db.hrFeatureCatalog.upsert({ where: { code: featureCode }, update: {},
        create: { code: featureCode, workspaceCode: 'HUMAN_RESOURCES', displayName: featureCode } });
      await db.hrFeatureAccessGrant.upsert({ where: { stableKey: 'native-performance-fixture:' + actorUserId + ':' + featureCode }, update: {},
        create: { stableKey: 'native-performance-fixture:' + actorUserId + ':' + featureCode, userId: actorUserId,
          featureCode, level: 'ADMIN', effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
          reason: 'Explicit isolated native Performance test authority; not release approval or runtime ownership' } });
    }
    const permissions = await activeHrActionPermissionsForUser(db, actorUserId);
    assert.ok(permissions.includes('REQUEST_PERFORMANCE_EXPORT') && permissions.includes('VIEW_PERFORMANCE_ANALYTICS'));
    const [{ revision }] = await db.$queryRaw<Array<{ revision: bigint }>>`SELECT revision FROM performance_disclosure_revision WHERE id=1`;
    const { policy } = await readPerformanceRetentionPolicy(db, new Date());
    const policyScope = { aggregateType: 'POLICY_VERSION', aggregateIdHash: sha(policy.id) };
    const evidenceRevision = String(revision), exportId = randomUUID(), token = privateToken(exportId);
    const snapshot = { scope: { reportKind: 'AGGREGATE', evidenceRevision }, report: { levelDistribution: expectedRows.map(row => ({ level: row.level, count: Number(row.count) })) } };
    const payload = await db.$transaction(async tx => {
      const encrypted = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_EXPORT', aggregateId: exportId,
        payloadKind: 'SCOPE_SNAPSHOT', schemaVersion: 1, payload: snapshot, keyring: performanceVaultKeyFromEnvironment() });
      await tx.performanceExportReceipt.create({ data: { id: exportId, requestedByUserId: actorUserId, exportKind: 'XLSX',
        scopeHash: canonicalPerformanceHash(snapshot.scope), permissionHash: canonicalPerformanceHash([...permissions].sort()),
        encryptedPayloadId: encrypted.id, downloadTokenHash: sha(token), expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } });
      // A real verified policy source supplies the required nonempty sealed
      // reconstruction. This is not a populated HR analytics acceptance claim.
      await sealPerformanceExportLineage(tx, exportId, { sources: [{ aggregateType: 'POLICY_VERSION', id: policy.id, record: policy }], scopes: [policyScope],
        reportingFrom: '2026-01-01T00:00:00.000Z', reportingTo: '2026-04-01T00:00:00.000Z' }, snapshot, performanceVaultKeyFromEnvironment());
      return encrypted;
    });
    const ready = await processPerformanceExport(db, exportId);
    assert.ok(ready); assert.equal(ready.status, 'READY'); assert.equal(ready.attemptCount, 1);
    assert.ok(ready.artifactPath && ready.artifactHash); assert.equal(ready.artifactKeyId, performanceExportKeyFromEnvironment().keyId);
    assert.equal(ready.artifactMimeType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    const fileName = path.basename(ready.artifactPath);
    assert.equal(ready.artifactPath, path.join(performanceExportStorageDirectory(), fileName));
    const ciphertext = await fs.readFile(ready.artifactPath), plaintext = decryptPerformanceExportArtifact(ciphertext, performanceExportKeyFromEnvironment().key);
    assert.equal(ciphertext.subarray(0, 4).toString(), 'SPX1'); assert.equal(sha(plaintext), ready.artifactHash);
    assert.equal(plaintext.length, ready.artifactSize); assertWorkbook(plaintext);
    const settled = await files.readSettled(fileName, 2 * 1024 * 1024);
    assert.equal(settled.head?.operation, 'PUT'); assert.deepEqual(settled.bytes, ciphertext);
    const head = settled.head; assert.ok(head);
    assert.deepEqual(await files.readVersion(fileName, head.versionSha256), ciphertext);
    assert.deepEqual(await readPerformancePayload(db, payload.id, performanceVaultKeyFromEnvironment()), snapshot);
    assert.deepEqual(await resolvePerformanceExportDependencies(db, exportId), [policyScope]);
    assert.equal(await db.performanceExportArtifact.count({ where: { exportId, attemptCount: 1, artifactPath: ready.artifactPath } }), 1);
    assert.equal(await db.performanceAuditEvent.count({ where: { aggregateType: 'PERFORMANCE_EXPORT', aggregateId: exportId, eventType: 'PERFORMANCE_EXPORT_GENERATED' } }), 1);
    // Exercise actual permission/token/decryption/claim code without pretending
    // completion/expiry cleanup is safe before its separate SQL-first fix.
    const claimed = await claimPerformanceExportDownload(db, { exportId, actorUserId, token });
    assert.ok(claimed.bytes.equals(plaintext)); assert.equal(claimed.mimeType, ready.artifactMimeType);
    await completePerformanceExportDownload(db, { exportId, actorUserId, delivered: false });
    assert.equal((await db.performanceExportReceipt.findUniqueOrThrow({ where: { id: exportId } })).status, 'READY');
    return { format: 'sabalan-native-performance-export/v1', exportId, actorUserId, encryptedPayloadId: payload.id, evidenceRevision,
      sourceArtifactPath: ready.artifactPath, fileName, artifactHash: ready.artifactHash, cipherSha256: sha(ciphertext),
      cipherBytes: ciphertext.length, plaintextBytes: plaintext.length, versionSha256: head.versionSha256,
      snapshotHash: canonicalPerformanceHash(snapshot), sourcePolicyId: policy.id };
  });
}

/** Verify the actual restored inode, never the source absolute pathname. The
 * private source/restore cwd mapping still needs its own service-path proof. */
export async function verifyRestoredPerformanceExport(input: { db: PrismaClient; boundary: RuntimeWorkBoundary; qualification: PerformanceExportQualification }) {
  return input.boundary.context.run(async () => {
  const { db, qualification: value } = input; assert.equal(value.format, 'sabalan-native-performance-export/v1');
  assert.equal(path.basename(value.fileName), value.fileName);
  const receipt = await db.performanceExportReceipt.findUniqueOrThrow({ where: { id: value.exportId } });
  assert.equal(receipt.status, 'READY'); assert.equal(receipt.artifactPath, value.sourceArtifactPath);
  assert.equal(receipt.artifactHash, value.artifactHash); assert.equal(receipt.encryptedPayloadId, value.encryptedPayloadId);
  const target = path.join(performanceExportStorageDirectory(), value.fileName);
  assert.notEqual(target, value.sourceArtifactPath, 'Private restore must read its independent destination, not the serving source');
  const ciphertext = await fs.readFile(target); assert.equal(ciphertext.length, value.cipherBytes); assert.equal(sha(ciphertext), value.cipherSha256);
  const plaintext = decryptPerformanceExportArtifact(ciphertext, performanceExportKeyFromEnvironment().key);
  assert.equal(sha(plaintext), value.artifactHash); assert.equal(plaintext.length, value.plaintextBytes); assertWorkbook(plaintext);
  assert.equal(canonicalPerformanceHash(await readPerformancePayload(db, value.encryptedPayloadId, performanceVaultKeyFromEnvironment())), value.snapshotHash);
  assert.deepEqual(await resolvePerformanceExportDependencies(db, value.exportId), [{ aggregateType: 'POLICY_VERSION', aggregateIdHash: sha(value.sourcePolicyId) }]);
  assert.equal(await db.performanceExportArtifact.count({ where: { exportId: value.exportId, artifactPath: value.sourceArtifactPath, attemptCount: 1 } }), 1);
  assert.equal(await db.performanceAuditEvent.count({ where: { aggregateType: 'PERFORMANCE_EXPORT', aggregateId: value.exportId, eventType: 'PERFORMANCE_EXPORT_GENERATED' } }), 1);
  const [{ revision }] = await db.$queryRaw<Array<{ revision: bigint }>>`SELECT revision FROM performance_disclosure_revision WHERE id=1`;
  assert.equal(String(revision), value.evidenceRevision, 'Retained processor qualification must follow hold probes before the cut');
  // Invoke actual restored authorization/token/inventory/path/decryption/SQL
  // claim code, not a source-file read standing in for restored service work.
  const claimed = await claimPerformanceExportDownload(db, { exportId: value.exportId, actorUserId: value.actorUserId, token: privateToken(value.exportId) });
  assert.ok(claimed.bytes.equals(plaintext)); assertWorkbook(claimed.bytes);
  await completePerformanceExportDownload(db, { exportId: value.exportId, actorUserId: value.actorUserId, delivered: false });
  assert.equal((await db.performanceExportReceipt.findUniqueOrThrow({ where: { id: value.exportId } })).status, 'READY');
  return { performanceRestoredCipherSqlSnapshotAndActualXlsxVerified: true, actualRestoredDomainDownloadPathQualified: true, expiryQualified: false };
  });
}
