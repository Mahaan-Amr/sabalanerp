import { createHash, createHmac, randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'node:path';
import { link, open, readFile, stat, unlink } from 'node:fs/promises';

const [cohortPath, approvalPath, keyFile, keyId, approvedBy] = process.argv.slice(2);
if (![cohortPath, approvalPath, keyFile, keyId, approvedBy].every(value => value?.trim())) {
  throw new Error('Usage: node approve-shipment-statement-cohort.mjs <cohort.json> <approval.json> <approval-key-file> <key-id> <approved-by>');
}
const cohort = await readFile(cohortPath);
const keyMetadata = await stat(keyFile);
if (!keyMetadata.isFile()) throw new Error('The independent cohort approval key must be a regular file.');
if ((keyMetadata.mode & 0o077) !== 0) throw new Error('The independent cohort approval key must not be accessible by group or other users.');
const key = (await readFile(keyFile, 'utf8')).trim();
if (key.length < 32) throw new Error('The independent cohort approval key is too short.');
const cohortSha256 = createHash('sha256').update(cohort).digest('hex');
const payload = JSON.stringify({ algorithm: 'HMAC-SHA256', keyId, approvedBy, cohortSha256 });
const approval = { algorithm: 'HMAC-SHA256', keyId, approvedBy,
  signature: createHmac('sha256', key).update(payload).digest('hex') };
const temporary = join(dirname(approvalPath), `.${basename(approvalPath)}.${randomUUID()}.tmp`);
let handle = await open(temporary, 'wx', 0o600);
try {
  await handle.writeFile(`${JSON.stringify(approval, null, 2)}\n`, 'utf8');
  await handle.sync();
  await handle.close();
  handle = undefined;
  await link(temporary, approvalPath);
} finally {
  await handle?.close();
  await unlink(temporary).catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
}
console.log(JSON.stringify({ approved: true, cohortSha256, keyId, approvedBy }));
