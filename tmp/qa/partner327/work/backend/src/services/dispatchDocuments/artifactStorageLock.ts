import { createHash } from 'node:crypto';
import type { DispatchArtifactStorage } from './ports';
import { DispatchDocumentIntegrityError } from './service';

export const DISPATCH_ARTIFACT_STORAGE_LOCK_NAMESPACE = 'DISPATCH_ARTIFACT_STORAGE_KEY' as const;

export const dispatchArtifactStorageLockKey = (storageKey: string): string =>
  `${DISPATCH_ARTIFACT_STORAGE_LOCK_NAMESPACE}:${storageKey}`;

export type DispatchArtifactStorageLockTransaction = {
  $executeRawUnsafe(query: string, key: string): Promise<unknown>;
};

export const acquireDispatchArtifactStorageKeyLocks = async (
  transaction: DispatchArtifactStorageLockTransaction,
  storageKeys: readonly string[],
): Promise<void> => {
  for (const storageKey of [...new Set(storageKeys)].sort()) {
    await transaction.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', dispatchArtifactStorageLockKey(storageKey));
  }
};

type ExpectedDurableArtifact = Readonly<{ storageKey: string; byteLength: number; sha256: string }>;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

export const verifyDispatchArtifactStorageUnderLock = async (input: {
  transaction: DispatchArtifactStorageLockTransaction;
  storage: DispatchArtifactStorage;
  artifacts: readonly ExpectedDurableArtifact[];
}): Promise<void> => {
  const expectedByKey = new Map<string, ExpectedDurableArtifact>();
  for (const artifact of input.artifacts) {
    const existing = expectedByKey.get(artifact.storageKey);
    if (existing && (existing.byteLength !== artifact.byteLength || existing.sha256 !== artifact.sha256)) {
      throw new DispatchDocumentIntegrityError('Conflicting dispatch artifact metadata uses one storage key.');
    }
    expectedByKey.set(artifact.storageKey, artifact);
  }
  const storageKeys = [...expectedByKey.keys()].sort();
  await acquireDispatchArtifactStorageKeyLocks(input.transaction, storageKeys);
  for (const storageKey of storageKeys) {
    const expected = expectedByKey.get(storageKey)!;
    const durable = await input.storage.read(storageKey);
    if (!durable || durable.byteLength !== expected.byteLength || sha256(durable) !== expected.sha256) {
      throw new DispatchDocumentIntegrityError('Durable dispatch artifact changed before metadata publication.');
    }
  }
};
