import assert from 'node:assert/strict';
import {
  assertValidEffectivePeriod,
  effectivePeriodsOverlap,
  normalizeIranianPlate,
  projectInternalDriverReadiness,
} from '../dispatchMasterDataPolicy';

assert.equal(normalizeIranianPlate(' ۱۲ ب ۳۴۵ ایران ۶۷ '), '12ب345ایران67');
assert.equal(normalizeIranianPlate('IR-22 AA 010'), 'IR22AA010');

assert.equal(
  effectivePeriodsOverlap(
    { from: new Date('2026-08-01T00:00:00.000Z'), to: new Date('2026-08-10T00:00:00.000Z') },
    { from: new Date('2026-08-10T00:00:00.000Z'), to: null },
  ),
  false,
  'effective periods are half-open so a replacement may start exactly when its predecessor ends',
);
assert.equal(
  effectivePeriodsOverlap(
    { from: new Date('2026-08-01T00:00:00.000Z'), to: null },
    { from: new Date('2026-08-09T00:00:00.000Z'), to: new Date('2026-08-11T00:00:00.000Z') },
  ),
  true,
);
assert.throws(
  () => assertValidEffectivePeriod(new Date('2026-08-02T00:00:00.000Z'), new Date('2026-08-01T00:00:00.000Z')),
  /after its start/i,
);

const ready = projectInternalDriverReadiness({
  personnelActive: true,
  activeEmployment: true,
  eligible: true,
  drivingProfileActive: true,
  licenceExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
  assignedVehicleInService: true,
}, new Date('2026-08-07T00:00:00.000Z'));
assert.deepEqual(ready, { status: 'READY', blockers: [] });

const blocked = projectInternalDriverReadiness({
  personnelActive: true,
  activeEmployment: true,
  eligible: false,
  drivingProfileActive: true,
  licenceExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
  assignedVehicleInService: false,
}, new Date('2026-08-07T00:00:00.000Z'));
assert.deepEqual(blocked, {
  status: 'NOT_READY',
  blockers: ['ELIGIBILITY_INACTIVE', 'LICENCE_EXPIRED', 'VEHICLE_NOT_IN_SERVICE'],
});

console.log('Dispatch master-data policy tests passed.');
