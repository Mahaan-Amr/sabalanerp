import assert from 'node:assert/strict';
import test from 'node:test';
import { parseOfficialReportDate } from '../accountingOfficialReportDates';

test('date-only reporting includes the entire final day and local cutoff means Tehran time', () => {
  assert.equal(parseOfficialReportDate('2026-04-20', 'پایان', 'end').toISOString(), '2026-04-20T23:59:59.999Z');
  assert.equal(parseOfficialReportDate('2026-03-21', 'شروع', 'start').toISOString(), '2026-03-21T00:00:00.000Z');
  assert.equal(parseOfficialReportDate('2026-09-27T23:59', 'برش', 'cutoff').toISOString(), '2026-09-27T20:29:00.000Z');
  assert.equal(parseOfficialReportDate('2026-09-27T20:29:00Z', 'برش', 'cutoff').toISOString(), '2026-09-27T20:29:00.000Z');
  assert.throws(() => parseOfficialReportDate('INVALID', 'پایان', 'end'), /معتبر نیست/);
  assert.throws(() => parseOfficialReportDate('2026-02-31', 'پایان', 'end'), /معتبر نیست/);
  assert.throws(() => parseOfficialReportDate('2025-02-29T23:59', 'برش', 'cutoff'), /معتبر نیست/);
});
