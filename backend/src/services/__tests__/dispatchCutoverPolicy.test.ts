import assert from 'node:assert/strict';
import test from 'node:test';
import { criticalFailureDisposition, validateLegacyDisposition, validateRehearsalGate } from '../dispatchCutoverPolicy';

test('legacy classification never guesses or accepts incomplete links', () => {
  assert.throws(() => validateLegacyDisposition({ disposition: 'LINKED', driverSource: null, driverId: null, vehicleSource: null, vehicleId: null }), /explicit canonical driver and vehicle/i);
  assert.deepEqual(validateLegacyDisposition({ disposition: 'HISTORICAL_ONLY', driverSource: null, driverId: null, vehicleSource: null, vehicleId: null }), {
    disposition: 'HISTORICAL_ONLY', driverSource: null, driverId: null, vehicleSource: null, vehicleId: null,
  });
});

test('cutover requires two complete consecutive rehearsals with exact reconciliation', () => {
  assert.throws(() => validateRehearsalGate([{ status: 'PASSED', sourceHash: 'a', targetHash: 'a' }]), /two successful/i);
  assert.throws(() => validateRehearsalGate([
    { status: 'PASSED', sourceHash: 'a', targetHash: 'a' },
    { status: 'PASSED', sourceHash: 'b', targetHash: 'c' },
  ]), /matching source and target hashes/i);
  assert.doesNotThrow(() => validateRehearsalGate([
    { status: 'PASSED', sourceHash: 'a', targetHash: 'a' },
    { status: 'PASSED', sourceHash: 'b', targetHash: 'b' },
  ]));
});

test('critical failure rolls back only before first canonical admission', () => {
  assert.equal(criticalFailureDisposition({ phase: 'CANONICAL_LIVE', firstCanonicalAdmissionAt: null }), 'RESTORE_LEGACY_WRITES');
  assert.equal(criticalFailureDisposition({ phase: 'CANONICAL_LIVE', firstCanonicalAdmissionAt: new Date() }), 'PILOT_SAFETY_PAUSE');
  assert.equal(criticalFailureDisposition({ phase: 'PILOT_SAFETY_PAUSE', firstCanonicalAdmissionAt: new Date() }), 'PILOT_SAFETY_PAUSE');
});
