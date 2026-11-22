import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function measureDeploymentCapacity(roots, imageWorkingBytes) {
  if (!Number.isSafeInteger(imageWorkingBytes) || imageWorkingBytes < 0 || !roots.length) throw new Error('STORAGE_CAPACITY_INVALID');
  const measure = async file => {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw new Error('STORAGE_SOURCE_SYMLINK');
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) throw new Error('STORAGE_SOURCE_INVALID');
    let size = 0;
    for (const entry of await fs.readdir(file)) size += await measure(path.join(file, entry));
    return size;
  };
  let sourceBytes = 0;
  for (const root of new Set(roots)) sourceBytes += await measure(root);
  const checkpointBytes = Math.ceil(sourceBytes * 1.15);
  return {
    sourceBytes,
    localBytes: checkpointBytes + Math.ceil(sourceBytes * 1.25) + imageWorkingBytes + 1024 ** 3,
    remoteBytes: checkpointBytes + Math.ceil(checkpointBytes * 0.05),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  measureDeploymentCapacity(process.argv.slice(3), Number(process.argv[2])).then(result => {
    console.log(`${result.localBytes} ${result.remoteBytes}`);
  }).catch(() => { console.error('STORAGE_CAPACITY_MEASUREMENT_FAILED'); process.exitCode = 1; });
}
