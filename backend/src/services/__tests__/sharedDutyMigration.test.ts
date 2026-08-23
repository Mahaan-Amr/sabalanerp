import assert from 'node:assert/strict';
import test from 'node:test';
import { planSharedDutyMigration } from '../sharedDutyMigration';

test('only open, current shared decisions are migration candidates', () => {
  const result = planSharedDutyMigration([
    { id: 'shared-current', status: 'OPEN', accountabilityModel: 'SHARED_DECISION', sourceIsCurrent: true },
    { id: 'shared-stale', status: 'OPEN', accountabilityModel: 'SHARED_DECISION', sourceIsCurrent: false },
    { id: 'shared-closed', status: 'COMPLETED', accountabilityModel: 'SHARED_DECISION', sourceIsCurrent: true },
    { id: 'execution', status: 'OPEN', accountabilityModel: 'INDIVIDUAL_EXECUTION', sourceIsCurrent: true },
  ]);
  assert.deepEqual(result, {
    migrate: ['shared-current'],
    stale: ['shared-stale'],
    unchanged: ['shared-closed', 'execution'],
  });
});
