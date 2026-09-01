import assert from 'node:assert/strict';
import {
  foundationReferenceSnapshot,
  nextFoundationCodeOccurrence,
  projectFoundationAtEvent,
  summarizeFoundationDependencies,
  versionedFoundationIdentity,
} from '../hrFoundationGovernance';

assert.equal(nextFoundationCodeOccurrence([]), 1);
assert.equal(nextFoundationCodeOccurrence([1, 3, 2]), 4);
assert.equal(versionedFoundationIdentity('POSITION', '22', 2), 'جایگاه 22 · نسخه 2');
assert.deepEqual(
  foundationReferenceSnapshot('POSITION', { id: 'p-22', code: '22', codeOccurrence: 2, title: 'سرپرست' }, new Date('2026-08-27T10:00:00.000Z')),
  { entityType: 'POSITION', entityId: 'p-22', code: '22', codeOccurrence: 2, name: 'سرپرست', title: 'سرپرست', displayName: 'سرپرست', definition: { id: 'p-22', code: '22', codeOccurrence: 2, title: 'سرپرست' }, capturedAt: '2026-08-27T10:00:00.000Z' },
);

const dependencies = summarizeFoundationDependencies([
  { kind: 'childUnits', referenceId: 'cutting-line', resolution: 'REQUIRED', href: '/units/cutting-line' },
  { kind: 'positions', referenceId: 'inactive-position', resolution: 'REQUIRED', href: '/positions/inactive-position' },
  { kind: 'assignments', referenceId: 'ended-assignment', resolution: 'SNAPSHOT', href: '/personnel/p1' },
  { kind: 'assignments', referenceId: 'active-assignment', resolution: 'REQUIRED', href: '/personnel/p2' },
]);

assert.deepEqual(dependencies, {
  resolvable: [
    { kind: 'childUnits', count: 1, href: '/units/cutting-line' },
    { kind: 'positions', count: 1, href: '/positions/inactive-position' },
    { kind: 'assignments', count: 1, href: '/personnel/p2' },
  ],
  snapshotEligible: [
    { kind: 'assignments', count: 1, href: '/personnel/p1' },
  ],
  eligible: false,
});

const lifecycle = [
  { version: 1, effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), afterJson: { id: 'p-1', code: 'OLD', title: 'عنوان اولیه', jobId: 'job-1' } },
  { version: 2, effectiveFrom: new Date('2025-06-01T00:00:00.000Z'), afterJson: { title: 'عنوان اصلاح‌شده' } },
  { version: 3, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), afterJson: { code: 'NEW', jobId: 'job-2' } },
];
assert.deepEqual(
  projectFoundationAtEvent({ id: 'p-1', code: 'NEW', title: 'عنوان اصلاح‌شده', jobId: 'job-2' }, lifecycle, new Date('2025-08-01T00:00:00.000Z')),
  { id: 'p-1', code: 'OLD', title: 'عنوان اصلاح‌شده', jobId: 'job-1' },
);

assert.deepEqual(
  projectFoundationAtEvent(
    { id: 'legacy', code: 'NEW', title: 'عنوان فعلی', jobId: 'job-2' },
    [
      { version: 1, effectiveFrom: new Date('2020-01-01T00:00:00.000Z'), afterJson: { id: 'legacy', code: 'OLD', title: 'عنوان اولیه', jobId: 'job-1' } },
      { version: 2, effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), afterJson: { code: 'NEW' } },
      { version: 3, effectiveFrom: new Date('2025-06-01T00:00:00.000Z'), afterJson: { title: 'عنوان فعلی', jobId: 'job-2' } },
    ],
    new Date('2024-12-01T00:00:00.000Z'),
  ),
  { id: 'legacy', code: 'OLD', title: 'عنوان اولیه', jobId: 'job-1' },
);

console.log('HR foundation governance tests passed.');
