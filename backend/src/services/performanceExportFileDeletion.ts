import { constants, promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import type { VersionedFileRootScope } from './versionedFilePublication';
import { performanceExportFileKey, removePerformanceExportFile } from './performanceFileRuntime';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';

export type PerformanceFileSource = { path: string; operation: 'PUT' | 'DELETE' | 'ABSENT'; versionSha256: string | null;
  sha256: string | null; bytes: number; device: string | null; inode: string | null; modified: string | null; changed: string | null };
const fail = (): never => { throw Object.assign(Error('PERFORMANCE_CLEANUP_FILE_SOURCE_UNPROVEN'), { code: 'PERFORMANCE_CLEANUP_FILE_SOURCE_UNPROVEN' }); };
export async function performanceCleanupFileSource(target: string, files: VersionedFileRootScope | undefined): Promise<PerformanceFileSource> {
  const key = performanceExportFileKey(target);
  const base = { path: target, versionSha256: null, sha256: null, bytes: 0, device: null, inode: null, modified: null, changed: null };
  if (files) {
    const read = await files.readSettledDigest(key, 101 * 1024 * 1024);
    if (!read.head) { if (read.sha256 !== null || read.byteLength !== 0) return fail(); return { ...base, operation: 'ABSENT' }; }
    if (read.head.operation === 'DELETE') { if (read.sha256 !== null || read.byteLength !== 0) return fail(); return { ...base, operation: 'DELETE', versionSha256: read.head.versionSha256 }; }
    if (!read.sha256 || read.byteLength !== read.head.byteLength) return fail();
    return { ...base, operation: 'PUT', versionSha256: read.head.versionSha256,
      sha256: read.sha256, bytes: read.byteLength };
  }
  let handle;
  try { handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...base, operation: 'ABSENT' }; throw error; }
  try {
    const initial = await handle.stat({ bigint: true });
    if (!initial.isFile() || initial.size > 101n * 1024n * 1024n) return fail();
    const digest = createHash('sha256'), chunk = Buffer.alloc(262144); let count = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null); if (!bytesRead) break;
      count += bytesRead; if (BigInt(count) > initial.size) return fail(); digest.update(chunk.subarray(0, bytesRead));
    }
    if (BigInt(count) !== initial.size) return fail();
    for (const current of [await handle.stat({ bigint: true }), await fs.lstat(target, { bigint: true })]) {
      for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'] as const) if (current[field] !== initial[field]) return fail();
    }
    return { ...base, operation: 'PUT', bytes: count, sha256: digest.digest('hex'),
      device: String(initial.dev), inode: String(initial.ino), modified: String(initial.mtimeNs), changed: String(initial.ctimeNs) };
  } finally { await handle.close(); }
}
export async function removePinnedPerformanceFile(source: PerformanceFileSource, files: VersionedFileRootScope | undefined) {
  const current = await performanceCleanupFileSource(source.path, files);
  if (canonicalPerformanceHash(current) !== canonicalPerformanceHash(source)) return fail();
  if (source.operation !== 'PUT') return null;
  if (files) { if (!source.versionSha256) return fail(); return files.removeUpload(performanceExportFileKey(source.path), source.versionSha256); }
  await removePerformanceExportFile(source.path); return null;
}
