import assert from 'node:assert/strict';
import { latestDecisionsByKind } from '../hrApplicationDecisionVersions';

const decisions = [
  { kind: 'HR_INTERVIEW', outcome: 'POSITIVE', version: 2 },
  { kind: 'HR_INTERVIEW', outcome: 'NEGATIVE', version: 1 },
  { kind: 'HR_PRELIMINARY_APPROVAL', outcome: 'POSITIVE', version: 1 },
];

const latest = latestDecisionsByKind(decisions);
assert.equal(latest.get('HR_INTERVIEW')?.outcome, 'POSITIVE');
assert.equal(latest.get('HR_INTERVIEW')?.version, 2);
assert.equal(latest.get('HR_PRELIMINARY_APPROVAL')?.outcome, 'POSITIVE');

console.log('HR application decision version tests passed.');
