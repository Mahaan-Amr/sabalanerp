import assert from 'node:assert/strict';
import test from 'node:test';
import { assignableVehiclesAt, currentEffectivePlate } from './vehicleAssignmentOptions';

test('assignment options include only active vehicles with a plate effective at assignment start', () => {
  const vehicles = [
    { id: 'current', status: 'ACTIVE', plates: [{ plate: 'CURRENT', effectiveFrom: '2026-09-01T00:00:00.000Z', effectiveTo: null }] },
    { id: 'future', status: 'ACTIVE', plates: [{ plate: 'FUTURE', effectiveFrom: '2026-10-01T00:00:00.000Z', effectiveTo: null }] },
    { id: 'expired', status: 'ACTIVE', plates: [{ plate: 'OLD', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: '2026-09-10T00:00:00.000Z' }] },
    { id: 'inactive', status: 'OUT_OF_SERVICE', plates: [{ plate: 'INACTIVE', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null }] },
  ];

  const effectiveAt = '2026-09-20T00:00:00.000Z';
  assert.deepEqual(assignableVehiclesAt(vehicles, effectiveAt).map((vehicle) => vehicle.id), ['current']);
  assert.equal(currentEffectivePlate(vehicles[0], effectiveAt)?.plate, 'CURRENT');
});
