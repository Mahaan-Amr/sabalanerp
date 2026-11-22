import assert from 'node:assert/strict';
import test from 'node:test';
import { postgresLsn, postgresWalSegments } from '../../scripts/postgres-recovery-coverage.mjs';

test('WAL coverage includes both sides of a segment boundary but excludes its exact end', () => {
  const range = { timeline: 1, segmentBytes: 16 * 1024 ** 2, startLsn: '0/1000028', endLsn: '0/2000000' };
  assert.deepEqual(postgresWalSegments(range), ['000000010000000000000001']);
  assert.deepEqual(postgresWalSegments({ ...range, endLsn: '0/2000028' }), ['000000010000000000000001', '000000010000000000000002']);
});

test('WAL filenames carry timeline and cross the 4GiB log boundary using the actual segment size', () => {
  assert.deepEqual(postgresWalSegments({ timeline: 3, segmentBytes: 16 * 1024 ** 2, startLsn: '0/FF000028', endLsn: '1/28' }),
    ['0000000300000000000000FF', '000000030000000100000000']);
  assert.deepEqual(postgresWalSegments({ timeline: 15, segmentBytes: 1024 ** 3, startLsn: '0/C0000028', endLsn: '1/28' }),
    ['0000000F0000000000000003', '0000000F0000000100000000']);
  assert.equal(postgresLsn('12345678/9ABCDEF0'), 1311768467463790320n);
});

test('ambiguous LSNs, reversed ranges, unbounded coverage and unsupported sizes never pass', () => {
  const range = { timeline: 1, segmentBytes: 16 * 1024 ** 2, startLsn: '0/1000028', endLsn: '0/2000000' };
  for (const value of ['1/100000000', '-1/0', '0/ff', '00/1', '0/01', '0/0\n', '0x1/2', 1]) {
    assert.throws(() => postgresWalSegments({ ...range, startLsn: value }), /LSN_INVALID/);
  }
  for (const changes of [{ timeline: 0 }, { timeline: 0x100000000 }, { segmentBytes: 3 * 1024 ** 2 },
    { segmentBytes: 0 }, { endLsn: range.startLsn }, { startLsn: '1/0' }, { endLsn: 'FFFF/0' }]) {
    assert.throws(() => postgresWalSegments({ ...range, ...changes }), /WAL_RANGE/);
  }
});
