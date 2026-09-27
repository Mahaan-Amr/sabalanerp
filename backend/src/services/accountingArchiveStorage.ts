import fs from 'node:fs/promises';
import path from 'node:path';

const safeArchivePath = (root: string, storageKey: string) => {
  const normalized = storageKey.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized)
    || normalized.split('/').includes('..')) throw new Error('نشانی فایل بایگانی معتبر نیست.');
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('نشانی فایل بایگانی معتبر نیست.');
  return resolved;
};

export const archiveWritePath = (storageKey: string, applicationRoot = process.cwd()) =>
  safeArchivePath(path.resolve(applicationRoot, 'storage', 'accounting-contracts', 'accounting-archive'), storageKey);

export const resolveArchiveReadPath = async (storageKey: string, applicationRoot = process.cwd()) => {
  const current = archiveWritePath(storageKey, applicationRoot);
  const historical = safeArchivePath(path.resolve(applicationRoot, 'storage', 'accounting-archive'), storageKey);
  const currentFile = await fs.stat(current).catch(() => null);
  if (currentFile?.isFile()) return current;
  const historicalFile = await fs.stat(historical).catch(() => null);
  if (historicalFile?.isFile()) return historical;
  throw new Error('فایل بایگانی در مخزن امن پیدا نشد.');
};
