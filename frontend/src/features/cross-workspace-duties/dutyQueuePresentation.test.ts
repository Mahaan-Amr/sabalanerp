import assert from 'node:assert/strict';
import { buildDutyQueueTabs, dutyQueueEmptyTitle } from './dutyQueuePresentation';

assert.deepEqual(
  buildDutyQueueTabs({ open: 2, available: 3, triage: 4, canManageTriage: false }).map(({ value, count }) => ({ value, count })),
  [
    { value: 'assigned', count: 2 },
    { value: 'available', count: 3 },
    { value: 'history', count: undefined },
  ],
);
assert.deepEqual(
  buildDutyQueueTabs({ open: 2, available: 3, triage: 4, canManageTriage: true }).map(({ value }) => value),
  ['assigned', 'available', 'triage', 'history'],
);
assert.equal(dutyQueueEmptyTitle('available'), 'وظیفه قابل دریافت وجود ندارد');
console.log('Cross-workspace duty queue presentation tests passed.');
