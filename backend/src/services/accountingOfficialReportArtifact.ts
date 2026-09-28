import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Called under the snapshot's database transaction lock. Never replaces a frozen artifact. */
export async function retainOfficialReportArtifact(input: {
  snapshotId: string; format: 'pdf' | 'xlsx'; existingHash: string | null;
  root: string; render: () => Promise<Buffer>; recordHash: (hash: string) => Promise<void>;
}) {
  if (!/^[a-zA-Z0-9_-]+$/.test(input.snapshotId)) throw new Error('شناسه گزارش معتبر نیست.');
  const directory = path.join(input.root, input.snapshotId);
  if (input.existingHash) {
    if (!/^[a-f0-9]{64}$/.test(input.existingHash)) throw new Error('اثر انگشت خروجی معتبر نیست.');
    let bytes: Buffer;
    try { bytes = await fs.readFile(path.join(directory, `${input.existingHash}.${input.format}`)); }
    catch { throw new Error('فایل منجمد این نسخه در دسترس نیست؛ بازیابی فایل یا ساخت نسخه جدید گزارش لازم است.'); }
    if (digest(bytes) !== input.existingHash) throw new Error('اثر انگشت فایل منجمد با سابقه گزارش مطابقت ندارد.');
    return { bytes, hash: input.existingHash };
  }
  const bytes = await input.render();
  const hash = digest(bytes);
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${hash}.${input.format}`);
  try { await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error: any) { if (error.code !== 'EEXIST') throw error; }
  if (digest(await fs.readFile(target)) !== hash) throw new Error('ذخیره فایل منجمد تأیید نشد.');
  await input.recordHash(hash);
  return { bytes, hash };
}
