import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';

type Component = { path: string; size: number; sha256: string };
type Mapping = { payloadPath: string; livePath: string };
const failure = (code: string) => Object.assign(new Error(code), { code });

/** Verify the promoted stores, independently of the archive's staging validation.
 * Database and coordination files have deliberate restore transformations and
 * are verified by the database/finalization gates, not byte comparison here. */
export async function verifyRestoredFiles(components: readonly Component[], mappings: readonly Mapping[], verifiedErasedPaths: readonly string[] = []) {
  let files = 0;
  let bytes = 0;
  const erased = new Set(verifiedErasedPaths.map(file => path.resolve(file)));
  const exportRoot = mappings.find(mapping => mapping.payloadPath === 'files/performance-exports')?.livePath;
  for (const file of erased) {
    if (!exportRoot || !file.startsWith(`${path.resolve(exportRoot)}${path.sep}`)) throw failure('DEPLOYMENT_DRILL_RESTORED_PATH_UNSAFE');
    const exists = await fs.lstat(file).then(() => true).catch(error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    });
    if (exists) throw failure('DEPLOYMENT_DRILL_ERASED_FILE_PRESENT');
  }
  for (const component of components) {
    if (component.path === 'database/main.dump' || component.path.startsWith('recovery-coordination/')) continue;
    const segments = component.path.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.includes('\\') || segment.includes(':'))) {
      throw failure('DEPLOYMENT_DRILL_RESTORED_PATH_UNSAFE');
    }
    const mapping = mappings.find(entry => component.path.startsWith(`${entry.payloadPath}/`));
    if (!mapping) throw failure('DEPLOYMENT_DRILL_RESTORED_PATH_UNSAFE');
    const root = path.resolve(mapping.livePath);
    const relative = component.path.slice(mapping.payloadPath.length + 1).split('/');
    if (erased.has(path.join(root, ...relative))) continue;
    let target = root;
    try {
      // No symlink hop may escape a protected store, including its root.
      if (!(await fs.lstat(root)).isDirectory() || (await fs.lstat(root)).isSymbolicLink()) throw new Error();
      for (const segment of relative) {
        target = path.join(target, segment);
        if ((await fs.lstat(target)).isSymbolicLink()) throw new Error();
      }
      const stat = await fs.stat(target);
      if (!stat.isFile() || stat.size !== component.size) throw new Error();
      const hash = crypto.createHash('sha256');
      for await (const chunk of createReadStream(target)) hash.update(chunk);
      if (hash.digest('hex') !== component.sha256) throw new Error();
    } catch { throw failure('DEPLOYMENT_DRILL_RESTORED_FILE_MISMATCH'); }
    files += 1;
    bytes += component.size;
  }
  return { files, bytes, ...(erased.size ? { erasedFiles: erased.size } : {}) };
}
