import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { publishDurableFile, syncExistingDurableFile } from './durableFilePublication';
import { assertVersionedFileRootScope, type VersionedFileRootScope } from './versionedFilePublication';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Called under the snapshot's database transaction lock. Never replaces a frozen artifact. */
export async function retainOfficialReportArtifact(input: {
  snapshotId: string; format: 'pdf' | 'xlsx'; existingHash: string | null;
  root: string; render: () => Promise<Buffer>; recordHash: (hash: string) => Promise<void>;
  files?: VersionedFileRootScope;
}) {
  // Explicit private composition only: an injected owner must be genuine and
  // confined to the exact report root, including frozen-read-only requests.
  if (input.files !== undefined) assertVersionedFileRootScope(input.files, input.root);
  if (!/^[a-zA-Z0-9_-]+$/.test(input.snapshotId)) throw new Error('شناسه گزارش معتبر نیست.');
  const directory = path.join(input.root, input.snapshotId);
  if (input.existingHash) {
    if (!/^[a-f0-9]{64}$/.test(input.existingHash)) throw new Error('اثر انگشت خروجی معتبر نیست.');
    let bytes: Buffer;
    try {
      const key = `${input.snapshotId}/${input.existingHash}.${input.format}`;
      const frozen = input.files ? await input.files.read(key) : await fs.readFile(path.join(input.root, key));
      if (!frozen) throw new Error('OFFICIAL_REPORT_ARTIFACT_MISSING');
      bytes = frozen;
    }
    catch { throw new Error('فایل منجمد این نسخه در دسترس نیست؛ بازیابی فایل یا ساخت نسخه جدید گزارش لازم است.'); }
    if (digest(bytes) !== input.existingHash) throw new Error('اثر انگشت فایل منجمد با سابقه گزارش مطابقت ندارد.');
    return { bytes, hash: input.existingHash };
  }
  const bytes = await input.render();
  const hash = digest(bytes);
  const target = path.join(directory, `${hash}.${input.format}`);
  if (input.files) {
    const key = `${input.snapshotId}/${hash}.${input.format}`;
    try { await input.files.publish(key, bytes); }
    catch (error: any) { if (error?.code !== 'FILE_VERSION_ALREADY_EXISTS') throw error; }
    const frozen = await input.files.read(key);
    if (!frozen || digest(frozen) !== hash) throw new Error('ذخیره فایل منجمد تأیید نشد.');
  } else {
    try { await publishDurableFile(target, bytes); }
    catch (error: any) { if (error.code !== 'EEXIST') throw error; }
    if (digest(await fs.readFile(target)) !== hash) throw new Error('ذخیره فایل منجمد تأیید نشد.');
    await syncExistingDurableFile(target);
  }
  await input.recordHash(hash);
  return { bytes, hash };
}
