import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationActionsFor } from './dispatchConfirmationPresentation';

test('external OTP sessions never offer biometric matching actions', () => {
  assert.deepEqual(confirmationActionsFor({
    driverSource: 'EXTERNAL',
    method: 'EXTERNAL_OTP_GUARD',
  }), {
    biometric: false,
    fallback: false,
    otp: true,
  });
});

test('internal biometric sessions offer biometric matching and fallback, not OTP entry', () => {
  assert.deepEqual(confirmationActionsFor({
    driverSource: 'INTERNAL',
    method: 'INTERNAL_BIOMETRIC',
  }), {
    biometric: true,
    fallback: true,
    otp: false,
  });
});

test('unknown or inconsistent sessions fail closed', () => {
  assert.deepEqual(confirmationActionsFor({
    driverSource: 'EXTERNAL',
    method: 'INTERNAL_BIOMETRIC',
  }), {
    biometric: false,
    fallback: false,
    otp: false,
  });
});
