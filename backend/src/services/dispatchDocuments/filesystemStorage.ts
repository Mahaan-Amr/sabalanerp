import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { DispatchArtifactStorage } from './ports';

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
    await mkdir(path.dirname(target), { recursive: true });
    const handle = await open(target, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async read(storageKey) {
    try { return new Uint8Array(await readFile(resolveKey(root, storageKey))); }
    catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
  },
  async discard(storageKey) {
    try { await unlink(resolveKey(root, storageKey)); }
    catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  },
});
