import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { verifyWalSegmentFiles } from './postgres-recovery-coverage.mjs';

test('actual captured WAL bytes require complete private files and the expected read-back hashes', async () => {
  const root = process.env.WAL_COVERAGE_FIXTURE_ROOT;
  assert.ok(root && path.dirname(root) === '/tmp' && path.basename(root).startsWith('sabalan-wal-bytes-qa-'));
  const directory = path.join(root, 'wal');
  const { range, expected } = JSON.parse(await fs.readFile(path.join(root, 'input.json'), 'utf8'));
  await fs.chmod(directory, 0o700);
  for (const row of expected) await fs.chmod(path.join(directory, row.name), 0o600);
  const result = await verifyWalSegmentFiles(directory, range, expected);
  assert.deepEqual(result.segments, expected);
  await assert.rejects(() => verifyWalSegmentFiles(directory, range, expected.slice(1)), /EVIDENCE_INVALID/);
  await assert.rejects(() => verifyWalSegmentFiles(directory, { ...range, timeline: range.timeline + 1 }, expected), /EVIDENCE_INVALID/);
  const file = path.join(directory, expected[0].name);
  const saved = await fs.readFile(file);
  const damaged = Buffer.from(saved); damaged[damaged.length - 8] ^= 1;
  try {
    await fs.writeFile(file, damaged);
    await assert.rejects(() => verifyWalSegmentFiles(directory, range, expected), /HASH_MISMATCH/);
    await fs.writeFile(file, saved.subarray(0, saved.length - 1));
    await assert.rejects(() => verifyWalSegmentFiles(directory, range, expected), /SEGMENT_INVALID/);
    await fs.writeFile(file, saved);
    await fs.link(file, path.join(directory, 'additional-link'));
    await assert.rejects(() => verifyWalSegmentFiles(directory, range, expected), /SEGMENT_INVALID/);
    await fs.unlink(path.join(directory, 'additional-link'));
    await fs.rename(file, file + '.partial');
    await assert.rejects(() => verifyWalSegmentFiles(directory, range, expected), error => error.code === 'ENOENT');
    await fs.rename(file + '.partial', file);
    await fs.rename(file, file + '.original');
    await fs.symlink(file + '.original', file);
    await assert.rejects(() => verifyWalSegmentFiles(directory, range, expected), /SEGMENT_INVALID/);
    await fs.unlink(file);
    await fs.rename(file + '.original', file);
    assert.deepEqual((await verifyWalSegmentFiles(directory, range, expected)).segments, expected);
  } finally { await fs.writeFile(file, saved); }
});
