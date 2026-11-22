import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import type { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { DISPATCH_DOCUMENT_STORAGE_ROOT } from '../../backend/src/services/dispatchFileRuntime';
import { createScopedVersionedFilesystemDispatchArtifactStorage } from '../../backend/src/services/dispatchDocuments/filesystemStorage';
import { prepareDispatchArtifact } from '../../backend/src/services/dispatchDocuments/artifactPreparation';
import { renderDispatchDocumentPdf } from '../../backend/src/documents/dispatch/dispatchDocumentPdf';
import { dispatchPrintBothFixture } from '../../backend/src/documents/dispatch/dispatchDocumentFixtures';

const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)])) : value;
type Artifact = { storageKey: string; sha256: string; byteLength: number; putVersionSha256: string;
  deleted: boolean; headVersionSha256: string };
export type NativeDispatchArtifactQualification = {
  format: 'sabalan-native-dispatch-artifact/v1'; operationId: string; auditId: string; actorId: string;
  eventHash: string; artifacts: Artifact[]; fullIssuanceQualified: false; domainAuthorityQualified: false;
};

/** Exercises the real artifact preparer, Chromium renderer, confined storage
 * and immutable SQL audit. Render data is the established document fixture;
 * this deliberately does not qualify candidate issuance or domain authority. */
export async function qualifyNativeDispatch(input: { db: PrismaClient; boundary: RuntimeWorkBoundary;
  publication: VersionedFilePublication; reporterId: string }): Promise<NativeDispatchArtifactQualification> {
  const { db, boundary, publication } = input;
  assert.ok(publication.ownsRoot(DISPATCH_DOCUMENT_STORAGE_ROOT) && publication.ownsWork(boundary.context));
  const files = await publication.bindRoot(DISPATCH_DOCUMENT_STORAGE_ROOT);
  const storage = createScopedVersionedFilesystemDispatchArtifactStorage(DISPATCH_DOCUMENT_STORAGE_ROOT, files);
  return boundary.runBackground(async () => {
    const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
    assert.match(name, /^qa_[a-z_]+_[a-f0-9]{32}$/);
    assert.ok(await db.user.findUnique({ where: { id: input.reporterId }, select: { id: true } }));
    const operationId = randomUUID(), artifacts: Artifact[] = [];
    for (const [index, source] of dispatchPrintBothFixture.inputs.entries()) {
      const prepared = await prepareDispatchArtifact({ storage, publisher: { async publish(renderInput) {
        const rendered = await renderDispatchDocumentPdf(renderInput);
        return { bytes: rendered.bytes, mediaType: rendered.metadata.mimeType };
      } } }, { ...source, documentId: operationId + '-' + index });
      const bytes = await storage.read(prepared.storageKey);
      assert.ok(bytes && bytes.byteLength > 4 && Buffer.from(bytes).subarray(0, 5).toString() === '%PDF-');
      assert.equal(digest(bytes), prepared.sha256);
      const put = await files.inspect(prepared.storageKey); assert.equal(put?.operation, 'PUT');
      assert.ok(put?.versionSha256);
      if (index === 1) { await storage.discard!(prepared.storageKey); assert.equal(await storage.read(prepared.storageKey), null); }
      const head = await files.inspect(prepared.storageKey); assert.ok(head?.versionSha256);
      assert.equal(head.operation, index === 1 ? 'DELETE' : 'PUT');
      artifacts.push({ storageKey: prepared.storageKey, sha256: prepared.sha256, byteLength: prepared.byteLength,
        putVersionSha256: put.versionSha256, deleted: index === 1, headVersionSha256: head.versionSha256 });
    }
    const payload = { format: 'sabalan-native-dispatch-artifact/v1' as const, operationId,
      artifacts, fullIssuanceQualified: false as const, domainAuthorityQualified: false as const };
    const eventHash = digest(JSON.stringify(canonical(payload)));
    const audit = await db.dispatchLifecycleAudit.create({ data: { aggregateType: 'PRIVATE_ARTIFACT_QUALIFICATION',
      aggregateId: operationId, eventType: 'PRIVATE_ARTIFACT_PREPARED_AND_DISCARDED', actorId: input.reporterId,
      payload, eventHash } });
    return { ...payload, auditId: audit.id, actorId: input.reporterId, eventHash };
  });
}

/** Reads the independently restored SQL and live tree. Immutable PUT/DELETE
 * version bytes remain the common sealed-reader verifier's responsibility. */
export async function verifyRestoredNativeDispatch(input: { db: PrismaClient;
  qualification: NativeDispatchArtifactQualification }): Promise<void> {
  const q = input.qualification;
  assert.equal(q.format, 'sabalan-native-dispatch-artifact/v1');
  const { auditId, actorId, eventHash, ...payload } = q;
  const audit = await input.db.dispatchLifecycleAudit.findUniqueOrThrow({ where: { id: auditId } });
  assert.equal(audit.aggregateType, 'PRIVATE_ARTIFACT_QUALIFICATION'); assert.equal(audit.aggregateId, q.operationId);
  assert.equal(audit.eventType, 'PRIVATE_ARTIFACT_PREPARED_AND_DISCARDED'); assert.equal(audit.actorId, actorId);
  assert.equal(audit.eventHash, eventHash); assert.equal(digest(JSON.stringify(canonical(payload))), eventHash);
  assert.deepEqual(audit.payload, payload);
  for (const artifact of q.artifacts) {
    assert.match(artifact.storageKey, /^dispatch-documents\/[A-Za-z0-9_-]+\.pdf$/);
    const file = path.join(DISPATCH_DOCUMENT_STORAGE_ROOT, artifact.storageKey);
    if (artifact.deleted) await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
    else { const bytes = await fs.readFile(file); assert.equal(bytes.length, artifact.byteLength); assert.equal(digest(bytes), artifact.sha256); }
  }
}
