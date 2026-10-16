import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationActionsFor } from './dispatchConfirmationPresentation';

test('historical OTP-only external sessions do not offer new confirmation actions', () => {
  assert.deepEqual(confirmationActionsFor({
    driverSource: 'EXTERNAL',
    method: 'EXTERNAL_OTP_GUARD',
  }), {
    biometric: false,
    fallback: false,
    otp: false,
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

for (const source of ['INTERNAL', 'EXTERNAL']) {
 test(`${source} biometric and fallback sessions expose identical actions`, () => {
  assert.deepEqual(confirmationActionsFor({driverSource: source, method: `${source}_BIOMETRIC`}), {biometric:true, fallback:true, otp:false});
  assert.deepEqual(confirmationActionsFor({driverSource: source, method: `${source}_FALLBACK`}), {biometric:false, fallback:false, otp:true});
 });
}
