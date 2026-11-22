import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { DispatchArtifactStorage } from './ports';
import { publishDurableFile, removeDurableFile } from '../durableFilePublication';
import { VersionedFilePublication, assertVersionedFileRootScope, type VersionedFileRootScope } from '../versionedFilePublication';

const resolveKey = (root: string, storageKey: string) => {
  if (!/^dispatch-documents\/[A-Za-z0-9_-]+\.pdf$/.test(storageKey)) throw new Error('Invalid dispatch artifact storage key.');
  const absoluteRoot = path.resolve(root);
  const target = path.resolve(absoluteRoot, storageKey);
  if (!target.startsWith(`${absoluteRoot}${path.sep}`)) throw new Error('Dispatch artifact storage key escapes its root.');
  return target;
};

export const createFilesystemDispatchArtifactStorage = (root: string): DispatchArtifactStorage => ({
  async stage({ storageKey, bytes }) {
    const target = resolveKey(root, storageKey);
    await publishDurableFile(target, bytes);
  },
  async read(storageKey) {
    try { return new Uint8Array(await readFile(resolveKey(root, storageKey))); }
    catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
  },
  async discard(storageKey) {
    await removeDurableFile(resolveKey(root, storageKey));
  },
});

/** Explicit private composition for an already admitted storage owner. Ordinary
 * runtime construction remains unchanged until complete release admission. */
export const createVersionedFilesystemDispatchArtifactStorage = (
  root: string, versions: VersionedFilePublication,
): DispatchArtifactStorage => {
  if (!(versions instanceof VersionedFilePublication) || !versions.ownsRoot(root)) throw new Error('FILE_VERSION_STORAGE_ROOT_MISMATCH');
  return {
    ...createFilesystemDispatchArtifactStorage(root),
    async stage({ storageKey, bytes }) {
      resolveKey(root, storageKey);
      await versions.publish(storageKey, bytes);
    },
    async discard(storageKey) {
      resolveKey(root, storageKey);
      await versions.remove(storageKey);
    },
  };
};

/** Explicit root-confined composition for the platform's shared file owner. */
export const createScopedVersionedFilesystemDispatchArtifactStorage = (
  root: string, files: VersionedFileRootScope,
): DispatchArtifactStorage => {
  assertVersionedFileRootScope(files, root);
  return {
    async stage({ storageKey, bytes }) { resolveKey(root, storageKey); await files.publish(storageKey, bytes); },
    async read(storageKey) { resolveKey(root, storageKey); return files.read(storageKey); },
    async discard(storageKey) { resolveKey(root, storageKey); await files.remove(storageKey); },
  };
};
