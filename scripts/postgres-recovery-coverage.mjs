import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const sha256 = /^[a-f0-9]{64}$/;
const lsnPattern = /^(?:0|[1-9A-F][0-9A-F]{0,7})\/(?:0|[1-9A-F][0-9A-F]{0,7})$/;

export function postgresLsn(value) {
  if (typeof value !== 'string' || !lsnPattern.test(value)) fail('RECOVERY_WAL_LSN_INVALID');
  const [high, low] = value.split('/');
  return (BigInt('0x' + high) << 32n) | BigInt('0x' + low);
}

/** Exact, end-exclusive segment coverage. This is byte/name coverage only:
 * native pg_verifybackup/pg_waldump, cluster identity, independent restore and
 * coherent file/SQLite/privacy coverage remain separate mandatory evidence. */
export function postgresWalSegments({ timeline, startLsn, endLsn, segmentBytes }) {
  if (!Number.isSafeInteger(timeline) || timeline < 1 || timeline > 0xffffffff
    || !Number.isSafeInteger(segmentBytes) || segmentBytes < 1024 ** 2 || segmentBytes > 1024 ** 3
    || (BigInt(segmentBytes) & (BigInt(segmentBytes) - 1n)) !== 0n) fail('RECOVERY_WAL_RANGE_INVALID');
  const start = postgresLsn(startLsn), end = postgresLsn(endLsn), bytes = BigInt(segmentBytes);
  if (end <= start) fail('RECOVERY_WAL_RANGE_INVALID');
  const first = start / bytes, last = (end - 1n) / bytes;
  if (last - first >= 8192n) fail('RECOVERY_WAL_RANGE_TOO_LARGE');
  const perLog = 0x100000000n / bytes;
  const hex = value => value.toString(16).toUpperCase().padStart(8, '0');
  const result = [];
  for (let index = first; index <= last; index += 1n) {
    result.push(hex(BigInt(timeline)) + hex(index / perLog) + hex(index % perLog));
  }
  return result;
}

/** Verify a private, already-captured raw WAL set. A JSON PASS field, partial
 * segment, filename on another timeline or same-size corruption is insufficient.
 * Nothing here publishes a recovery point, removes WAL, or enables a release. */
export async function verifyWalSegmentFiles(directory, range, expected) {
  const names = postgresWalSegments(range);
  if (process.platform !== 'linux' || !path.isAbsolute(directory)
    || await fs.realpath(directory) !== directory) fail('RECOVERY_WAL_DIRECTORY_INVALID');
  const directoryStat = await fs.lstat(directory, { bigint: true });
  if (!directoryStat.isDirectory() || (directoryStat.mode & 0o077n) !== 0n
    || directoryStat.uid !== BigInt(process.getuid())) fail('RECOVERY_WAL_DIRECTORY_INVALID');
  if (!Array.isArray(expected) || expected.length !== names.length
    || new Set(expected.map(item => item?.name)).size !== names.length) fail('RECOVERY_WAL_EVIDENCE_INVALID');
  const identities = new Map(expected.map(item => [item?.name, item]));
  const verified = [];
  for (const name of names) {
    const identity = identities.get(name);
    if (!identity || identity.bytes !== range.segmentBytes || !sha256.test(identity.sha256)) fail('RECOVERY_WAL_EVIDENCE_INVALID');
    const file = path.join(directory, name);
    const named = await fs.lstat(file, { bigint: true });
    if (!named.isFile() || named.nlink !== 1n || named.size !== BigInt(range.segmentBytes)
      || named.uid !== directoryStat.uid || (named.mode & 0o077n) !== 0n) fail('RECOVERY_WAL_SEGMENT_INVALID');
    const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const opened = await handle.stat({ bigint: true });
      if (opened.dev !== named.dev || opened.ino !== named.ino) fail('RECOVERY_WAL_SEGMENT_CHANGED');
      const hash = createHash('sha256');
      const buffer = Buffer.alloc(256 * 1024);
      let bytes = 0;
      while (true) {
        const result = await handle.read(buffer, 0, Math.min(buffer.length, range.segmentBytes - bytes + 1), null);
        if (!result.bytesRead) break;
        bytes += result.bytesRead;
        if (bytes > range.segmentBytes) fail('RECOVERY_WAL_SEGMENT_CHANGED');
        hash.update(buffer.subarray(0, result.bytesRead));
      }
      const after = await handle.stat({ bigint: true });
      const current = await fs.lstat(file, { bigint: true });
      if (bytes !== range.segmentBytes || hash.digest('hex') !== identity.sha256) fail('RECOVERY_WAL_HASH_MISMATCH');
      if (after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1n || after.size !== opened.size
        || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs
        || current.dev !== opened.dev || current.ino !== opened.ino || current.uid !== named.uid
        || (current.mode & 0o077n) !== 0n) fail('RECOVERY_WAL_SEGMENT_CHANGED');
      verified.push({ name, bytes, sha256: identity.sha256 });
    } finally { await handle.close(); }
  }
  const finalDirectory = await fs.lstat(directory, { bigint: true });
  if (finalDirectory.dev !== directoryStat.dev || finalDirectory.ino !== directoryStat.ino
    || finalDirectory.uid !== directoryStat.uid || (finalDirectory.mode & 0o077n) !== 0n
    || await fs.realpath(directory) !== directory) fail('RECOVERY_WAL_DIRECTORY_CHANGED');
  return { range: { ...range }, segments: verified };
}
