import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export const HR_HIRING_STORAGE_DIR = path.join(process.cwd(), 'storage', 'hr-hiring');
export const HR_HIRING_ALLOWED_MIME = new Set(['application/pdf', 'image/jpeg', 'image/png']);

const matchesSignature = (mimeType: string, header: Buffer) => {
  if (mimeType === 'application/pdf') return header.subarray(0, 5).toString('ascii') === '%PDF-';
  if (mimeType === 'image/jpeg') return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (mimeType === 'image/png') return header.length >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
};

export const validateHiringFileSignature = (filePath: string, mimeType: string) => {
  if (!HR_HIRING_ALLOWED_MIME.has(mimeType)) throw new Error('Unsupported HR document type.');
  const descriptor = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(8);
    const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
    if (!matchesSignature(mimeType, header.subarray(0, bytesRead))) {
      throw new Error('HR document content does not match its declared file type.');
    }
  } finally {
    fs.closeSync(descriptor);
  }
};

export const ensureHrHiringStorage = () => {
  fs.mkdirSync(HR_HIRING_STORAGE_DIR, { recursive: true });
};

export const safeHiringStoragePath = (storageName: string) => {
  const safeName = path.basename(storageName);
  if (safeName !== storageName) throw new Error('Invalid storage name');
  return path.join(HR_HIRING_STORAGE_DIR, safeName);
};

export const sha256File = (filePath: string) => new Promise<string>((resolve, reject) => {
  const hash = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  stream.on('error', reject);
  stream.on('data', (chunk) => hash.update(chunk));
  stream.on('end', () => resolve(hash.digest('hex')));
});

export const scanHiringFile = async (filePath: string): Promise<string> => {
  const command = process.env.HR_HIRING_ANTIVIRUS_COMMAND;
  if (!command) {
    if (process.env.NODE_ENV === 'production' && process.env.ALLOW_UNSCANNED_HR_FILES !== 'true') {
      throw new Error('HR document antivirus scanning is not configured.');
    }
    return 'SKIPPED_DEVELOPMENT';
  }

  try {
    await execFileAsync(command, [filePath], { timeout: 60_000, windowsHide: true });
    return 'CLEAN';
  } catch (error: any) {
    const message = String(error?.stderr || error?.message || 'Antivirus scan failed');
    throw new Error(`Document rejected by antivirus scanner: ${message.slice(0, 240)}`);
  }
};

export const removeHiringFile = (filePath?: string) => {
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch { /* best-effort cleanup */ }
};
