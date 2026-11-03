import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHiringCandidateSearchConditions } from '../hrHiringSearch';

test('a full applicant name matches its first-name and last-name tokens', () => {
  const conditions = buildHiringCandidateSearchConditions('  علی   بهپور  ', false);
  assert.equal(conditions.length, 2);
  assert.deepEqual(conditions.map((condition: any) => (
    condition.OR.map((entry: any) => entry.candidate.firstName?.contains || entry.candidate.lastName?.contains)
  )), [
    ['علی', 'علی'],
    ['بهپور', 'بهپور'],
  ]);
});

test('sensitive identifiers remain permission-gated', () => {
  const hidden = buildHiringCandidateSearchConditions('0912', false)[0] as any;
  const visible = buildHiringCandidateSearchConditions('0912', true)[0] as any;
  assert.equal(hidden.OR.length, 2);
  assert.equal(visible.OR.length, 4);
});
