import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);

/** Combine already-authorized, checksum-verified documents only in a private,
 * short-lived directory. No combined document is retained as a new original. */
export async function mergeDispatchPdfs(documents: readonly Uint8Array[]): Promise<Buffer> {
  if (documents.length < 2 || documents.length > 101 || documents.some(document =>
    document.byteLength < 5 || Buffer.from(document.subarray(0, 5)).toString('ascii') !== '%PDF-') ||
    documents.reduce((sum, document) => sum + document.byteLength, 0) > 64 * 1024 * 1024) {
    throw new Error('اسناد انتخاب‌شده برای چاپ کامل یا معتبر نیستند.');
  }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sabalan-dispatch-print-'));
  try {
    const paths = documents.map((_, index) => path.join(directory, `${index}.pdf`));
    for (const [index, file] of paths.entries()) {
      await writeFile(file, documents[index], { mode: 0o600, flag: 'wx' });
    }
    const output = path.join(directory, 'combined.pdf');
    await execute('pdfunite', [...paths, output], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const combined = await readFile(output);
    if (combined.byteLength > 64 * 1024 * 1024 || combined.subarray(0, 5).toString('ascii') !== '%PDF-') {
      throw new Error('فایل چاپی ترکیبی معتبر نیست.');
    }
    return combined;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
