import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DISPATCH_ARTIFACT_STORAGE_LOCK_NAMESPACE,
  dispatchArtifactStorageLockKey,
  verifyDispatchArtifactStorageUnderLock,
} from '../dispatchDocuments/artifactStorageLock';
import { DispatchDocumentIntegrityError } from '../dispatchDocuments/service';

const bytes = (value: string) => new TextEncoder().encode(value);
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

const run = async () => {
  assert.equal(DISPATCH_ARTIFACT_STORAGE_LOCK_NAMESPACE, 'DISPATCH_ARTIFACT_STORAGE_KEY');
  assert.equal(dispatchArtifactStorageLockKey('dispatch-documents/a.pdf'),
    'DISPATCH_ARTIFACT_STORAGE_KEY:dispatch-documents/a.pdf');

  const locks: string[] = [];
  const reads: string[] = [];
  const durable = new Map([
    ['dispatch-documents/a.pdf', bytes('a')],
    ['dispatch-documents/b.pdf', bytes('bb')],
  ]);
  await verifyDispatchArtifactStorageUnderLock({
    transaction: { $executeRawUnsafe: async (_sql: string, key: string) => { locks.push(key); return 1; } },
    storage: { stage: async () => undefined, read: async key => { reads.push(key); return durable.get(key) ?? null; } },
    artifacts: [
      { storageKey: 'dispatch-documents/b.pdf', byteLength: 2, sha256: sha256(bytes('bb')) },
      { storageKey: 'dispatch-documents/a.pdf', byteLength: 1, sha256: sha256(bytes('a')) },
      { storageKey: 'dispatch-documents/b.pdf', byteLength: 2, sha256: sha256(bytes('bb')) },
    ],
  });
  assert.deepEqual(locks, [
    'DISPATCH_ARTIFACT_STORAGE_KEY:dispatch-documents/a.pdf',
    'DISPATCH_ARTIFACT_STORAGE_KEY:dispatch-documents/b.pdf',
  ], 'storage-key locks are unique and deterministic');
  assert.deepEqual(reads, ['dispatch-documents/a.pdf', 'dispatch-documents/b.pdf']);

  durable.set('dispatch-documents/a.pdf', bytes('moved-or-tampered'));
  await assert.rejects(() => verifyDispatchArtifactStorageUnderLock({
    transaction: { $executeRawUnsafe: async () => 1 },
    storage: { stage: async () => undefined, read: async key => durable.get(key) ?? null },
    artifacts: [{ storageKey: 'dispatch-documents/a.pdf', byteLength: 1, sha256: sha256(bytes('a')) }],
  }), DispatchDocumentIntegrityError);
};

run().then(() => console.log('dispatch artifact storage lock tests passed'));
