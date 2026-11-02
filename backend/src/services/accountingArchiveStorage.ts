import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
    try { const bytes = await fs.readFile(candidate); return { candidate, digest: createHash('sha256').update(bytes).digest('hex') }; }
    catch (error: any) { if (error?.code === 'ENOENT') return null; throw error; }
  }));
  const found = present.filter((item): item is NonNullable<typeof item> => item !== null);
  if (found.length > 1 && found[0].digest !== found[1].digest) throw new Error('نسخه‌های مدرک بایگانی یکسان نیستند؛ بررسی و بازیابی لازم است.');
  if (found.length) return found[0].candidate;
  throw new Error('فایل بایگانی در مخزن امن پیدا نشد.');
};
