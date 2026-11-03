import assert from 'node:assert/strict';
import {
  assertCapacityChangeAllowed,
  assertFreshVersion,
  capacityAt,
  maximumCapacityCommitmentFrom,
  projectEffectiveFoundation,
  reconcilePositionCapacity,
  resolveFoundationStatus,
  summarizePositionCoverage,
  type CapacityAssignment,
} from '../hrOrganizationCapacity';

const at = new Date('2026-08-09T12:00:00.000Z');
const assignment = (overrides: Partial<CapacityAssignment> = {}): CapacityAssignment => ({
  id: crypto.randomUUID(),
  type: 'PRIMARY',
  relationshipStatus: 'ACTIVE',
  effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  effectiveTo: null,
  hireConvertedAt: null,
  ...overrides,
});
assert.equal(reconcilePositionCapacity({ capacity: 1, active: true, at, assignments: [assignment({ relationshipStatus: 'ENDED', effectiveTo: null })] }).ended, 1);

const reconciled = reconcilePositionCapacity({
  capacity: 6,
  active: true,
  at,
  assignments: [
    assignment(),
    assignment({ relationshipStatus: 'SUSPENDED', type: 'SECONDARY' }),
    assignment({ relationshipStatus: 'PLANNED', effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), hireConvertedAt: new Date('2026-08-01T00:00:00.000Z') }),
    assignment({ relationshipStatus: 'PLANNED', effectiveFrom: new Date('2026-09-02T00:00:00.000Z'), hireConvertedAt: null }),
    assignment({ type: 'ACTING' }),
    assignment({ effectiveTo: new Date('2026-07-01T00:00:00.000Z') }),
    assignment({ effectiveFrom: new Date('2026-10-01T00:00:00.000Z') }),
  ],
});

assert.deepEqual(reconciled, {
  capacity: 6,
  inUse: 2,
  reservedForStart: 1,
  acting: 1,
  ended: 1,
  future: 2,
  vacancy: 3,
});

assert.deepEqual(summarizePositionCoverage([reconciled]), {
  capacity: 6,
  inUse: 2,
  reservedForStart: 1,
  vacancy: 3,
  percentage: 50,
});

assert.deepEqual(summarizePositionCoverage([]), {
  capacity: 0,
  inUse: 0,
  reservedForStart: 0,
  vacancy: 0,
  percentage: null,
});

assert.throws(
  () => assertCapacityChangeAllowed({ currentCapacity: 6, newCapacity: 2, committedFromEffectiveDate: 3, approvedRecruitmentRemaining: 0, reason: 'کاهش ساختار', effectiveAt: new Date('2026-08-10T00:00:00.000Z'), today: at }),
  /متعهد/,
);
assert.throws(
  () => assertCapacityChangeAllowed({ currentCapacity: 6, newCapacity: 4, committedFromEffectiveDate: 3, approvedRecruitmentRemaining: 2, reason: 'کاهش ساختار', effectiveAt: new Date('2026-08-10T00:00:00.000Z'), today: at }),
  /استخدام/,
);
assert.doesNotThrow(() => assertCapacityChangeAllowed({ currentCapacity: 6, newCapacity: 5, committedFromEffectiveDate: 3, approvedRecruitmentRemaining: 2, reason: 'کاهش ساختار', effectiveAt: new Date('2026-08-10T00:00:00.000Z'), today: at }));
assert.throws(
  () => assertCapacityChangeAllowed({ currentCapacity: 6, newCapacity: 7, committedFromEffectiveDate: 3, approvedRecruitmentRemaining: 0, reason: '', effectiveAt: new Date('2026-08-08T00:00:00.000Z'), today: at }),
  /گذشته/,
);

assert.equal(resolveFoundationStatus({
  baseActive: false,
  at,
  versions: [{ status: 'ACTIVE', effectiveFrom: new Date('2026-09-01T00:00:00.000Z') }],
}), false);
assert.equal(resolveFoundationStatus({
  baseActive: false,
  at: new Date('2026-09-01T00:00:00.000Z'),
  versions: [{ status: 'ACTIVE', effectiveFrom: new Date('2026-09-01T00:00:00.000Z') }],
}), true);
assert.equal(resolveFoundationStatus({
  baseActive: false,
  at: new Date('2026-11-01T00:00:00.000Z'),
  versions: [
    { version: 1, status: 'ACTIVE', effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), afterJson: { isActive: true } },
    { version: 2, status: 'INACTIVE', effectiveFrom: new Date('2026-10-01T00:00:00.000Z'), afterJson: { organizationalUnitId: 'unit-2' } },
  ],
}), true);
assert.equal(resolveFoundationStatus({
  baseActive: true,
  at,
  versions: [{ status: 'INACTIVE', effectiveFrom: new Date('2026-10-01T00:00:00.000Z') }],
}), true);

assert.equal(capacityAt(4, [
  { newCapacity: 6, effectiveAt: new Date('2026-09-01T00:00:00.000Z') },
  { newCapacity: 5, effectiveAt: new Date('2026-08-01T00:00:00.000Z') },
], at), 5);

assert.doesNotThrow(() => assertFreshVersion(new Date('2026-08-09T10:00:00.000Z'), '2026-08-09T10:00:00.000Z'));
assert.throws(() => assertFreshVersion(new Date('2026-08-09T10:00:00.000Z'), undefined), /هم‌زمان/);
assert.throws(
  () => assertFreshVersion(new Date('2026-08-09T10:00:00.000Z'), '2026-08-09T09:59:59.000Z'),
  /هم‌زمان/,
);

assert.equal(maximumCapacityCommitmentFrom([
  assignment({ effectiveFrom: new Date('2026-08-10T00:00:00.000Z'), effectiveTo: new Date('2026-08-20T00:00:00.000Z') }),
  assignment({ effectiveFrom: new Date('2026-08-15T00:00:00.000Z'), effectiveTo: new Date('2026-08-30T00:00:00.000Z') }),
  assignment({ effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), effectiveTo: null }),
  assignment({ type: 'ACTING', effectiveFrom: new Date('2026-08-15T00:00:00.000Z') }),
  assignment({ relationshipStatus: 'CANCELLED' }),
], new Date('2026-08-10T00:00:00.000Z')), 2);
assert.equal(maximumCapacityCommitmentFrom([], new Date('2026-08-10T00:00:00.000Z'), [
  { effectiveFrom: new Date('2026-10-01T00:00:00.000Z'), effectiveTo: null, remaining: 3 },
]), 3);

assert.deepEqual(projectEffectiveFoundation(
  { id: 'position-1', title: 'Old', organizationalUnitId: 'unit-1', isActive: true },
  [
    { effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), afterJson: { id: 'position-1', title: 'Old', organizationalUnitId: 'unit-3', isActive: true } },
    { effectiveFrom: new Date('2026-08-01T00:00:00.000Z'), afterJson: { id: 'position-1', title: 'Old', organizationalUnitId: 'unit-2', isActive: true } },
  ],
  at,
), { id: 'position-1', title: 'Old', organizationalUnitId: 'unit-2', isActive: true });
assert.deepEqual(projectEffectiveFoundation(
  { organizationalUnitId: 'unit-1', isActive: true },
  [
    { effectiveFrom: new Date('2026-09-01T00:00:00.000Z'), afterJson: { organizationalUnitId: 'unit-2' } },
    { effectiveFrom: new Date('2026-10-01T00:00:00.000Z'), afterJson: { isActive: false } },
  ],
  new Date('2026-11-01T00:00:00.000Z'),
), { organizationalUnitId: 'unit-2', isActive: false });
assert.deepEqual(projectEffectiveFoundation(
  { title: 'Corrected', isActive: true },
  [{ version: 1, effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), afterJson: { title: 'Original', isActive: true } }],
  at,
), { title: 'Corrected', isActive: true });

console.log('HR organization capacity tests passed.');
