import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Hash without buffering the complete document; reject changed or replaced files. */
export async function sha256ArchiveFile(filePath: string): Promise<string> {
  const file = await fs.open(filePath, 'r');
  try {
    const before = await file.stat({ bigint: true });
    if (!before.isFile()) throw new Error('فایل بایگانی معتبر نیست.');
    const hash = createHash('sha256');
    for await (const chunk of file.createReadStream({ autoClose: false })) hash.update(chunk as Buffer);
    const after = await file.stat({ bigint: true });
    const pathAfter = await fs.stat(filePath, { bigint: true });
    const same = (a: typeof before, b: typeof before) => (process.platform === 'win32' || a.dev === b.dev) && a.ino === b.ino
      && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
    if (!same(before, after) || !same(before, pathAfter)) throw new Error('فایل بایگانی هنگام بررسی تغییر کرد.');
    return hash.digest('hex');
  } finally {
    await file.close();
  }
}

const safeArchivePath = (root: string, storageKey: string) => {
  const normalized = storageKey.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
    || normalized.split('/').includes('..')) throw new Error('نشانی فایل بایگانی معتبر نیست.');
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('نشانی فایل بایگانی معتبر نیست.');
  return resolved;
};

export const archiveWritePath = (storageKey: string, applicationRoot = process.cwd()) =>
  safeArchivePath(path.resolve(applicationRoot, 'storage', 'accounting-contracts', '.official-reports', 'archive-evidence'), storageKey);

export const resolveArchiveReadPath = async (storageKey: string, applicationRoot = process.cwd()) => {
  const current = archiveWritePath(storageKey, applicationRoot);
  const historical = safeArchivePath(path.resolve(applicationRoot, 'storage', 'accounting-archive'), storageKey);
  // A duplicate key with different content is ambiguous; never silently select one.
  const candidates = [current, historical];
  const present = await Promise.all(candidates.map(async (candidate) => {
    try { return { candidate, digest: await sha256ArchiveFile(candidate) }; }
    catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
  }));
  const found = present.filter((item): item is NonNullable<typeof item> => item !== null);
  if (found.length > 1 && found[0].digest !== found[1].digest) throw new Error('نسخه‌های مدرک بایگانی یکسان نیستند؛ بررسی و بازیابی لازم است.');
  if (found.length) return found[0].candidate;
  throw new Error('فایل بایگانی در مخزن امن پیدا نشد.');
};
