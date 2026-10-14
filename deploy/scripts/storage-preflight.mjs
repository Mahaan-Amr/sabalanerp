import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dockerStorageAdapter, executeStorageCleanup, planStorageCleanup } from '../../scripts/deployment-storage.mjs';

export async function storagePreflight(args) {
  const values = new Map();
  const allowed = new Set(['--lock-file', '--lock-fd', '--checkpoint-root', '--journal-root', '--project', '--storage-root', '--required-bytes', '--document', '--protected-image', '--audit', '--mode']);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!allowed.has(key) || args[index + 1] === undefined) throw new Error('STORAGE_ARGUMENT_INVALID');
    values.set(key, [...(values.get(key) ?? []), args[index + 1]]);
  }
  const one = key => {
    const entries = values.get(key);
    if (entries?.length !== 1 || !entries[0]) throw new Error(`STORAGE_ARGUMENT_REQUIRED:${key}`);
    return entries[0];
  };
  const lockPath = fs.realpathSync(one('--lock-file'));
  const lockDescriptor = Number(one('--lock-fd'));
  if (!Number.isInteger(lockDescriptor) || lockDescriptor < 3 || lockDescriptor > 20) throw new Error('STORAGE_LOCK_INVALID');
  const assertLock = async () => {
    const file = fs.statSync(lockPath);
    const descriptor = fs.fstatSync(lockDescriptor);
    if (file.dev !== descriptor.dev || file.ino !== descriptor.ino) throw new Error('STORAGE_LOCK_INVALID');
    const stdio = Array.from({ length: lockDescriptor + 1 }, () => 'ignore');
    stdio[lockDescriptor] = lockDescriptor;
    // The inherited descriptor is the same open-file description as the owner.
    execFileSync('flock', ['--nonblock', String(lockDescriptor)], { stdio, timeout: 5_000 });
  };
  await assertLock();
  const checkpointRoots = values.get('--checkpoint-root');
  if (!checkpointRoots?.length) throw new Error('STORAGE_CHECKPOINT_ROOT_REQUIRED');
  const project = one('--project');
  const storageRoot = one('--storage-root');
  const requiredBytes = Number(one('--required-bytes'));
  if (!Number.isSafeInteger(requiredBytes) || requiredBytes < 0) throw new Error('STORAGE_CAPACITY_INVALID');
  const adapter = dockerStorageAdapter({
    project, storageRoot, checkpointRoots, documents: values.get('--document') ?? [],
    journalRoots: values.get('--journal-root') ?? [],
    protectedImages: values.get('--protected-image') ?? [], auditPath: one('--audit'), assertLock,
  });
  const mode = one('--mode');
  if (!['plan', 'apply'].includes(mode)) throw new Error('STORAGE_MODE_INVALID');
  const result = mode === 'apply'
    ? await executeStorageCleanup(adapter)
    : { plan: planStorageCleanup(await adapter.snapshot()), availableBytes: await adapter.availableBytes() };
  await adapter.record({ event: 'CAPACITY_CHECK', requiredBytes, availableBytes: result.availableBytes, sufficient: result.availableBytes >= requiredBytes });
  if (result.availableBytes < requiredBytes) throw new Error('STORAGE_CAPACITY_INSUFFICIENT');
  return { ok: true, project, ...result };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  storagePreflight(process.argv.slice(2)).then(result => console.log(JSON.stringify(result))).catch(error => {
    // Error codes only: Docker's stderr may include private paths or configuration.
    console.error(JSON.stringify({ ok: false, code: /^STORAGE_[A-Z_]+(?::--[a-z-]+)?$/.test(error.message) ? error.message : 'STORAGE_PREFLIGHT_FAILED' }));
    process.exitCode = 1;
  });
}
