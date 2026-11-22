import assert from 'node:assert/strict';
import test from 'node:test';
import { biometricAttemptNotice, confirmationActionsFor } from './dispatchConfirmationPresentation';

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

test('an issued exit authorization suppresses scan and fallback actions immediately and on reopen', () => {
  const active = { driverSource: 'INTERNAL', method: 'INTERNAL_BIOMETRIC', status: 'ACTIVE' };
  const authorization = { id: 'authorization' };
  const hiddenActions = { biometric: false, fallback: false, otp: false };
  assert.deepEqual(confirmationActionsFor({ ...active, authorization }), hiddenActions);
  assert.deepEqual(confirmationActionsFor({ ...active, status: 'CONFIRMED', authorization }), hiddenActions);
});

for (const source of ['INTERNAL', 'EXTERNAL']) {
 test(`${source} biometric and fallback sessions expose identical actions`, () => {
  assert.deepEqual(confirmationActionsFor({driverSource: source, method: `${source}_BIOMETRIC`}), {biometric:true, fallback:true, otp:false});
  assert.deepEqual(confirmationActionsFor({driverSource: source, method: `${source}_FALLBACK`}), {biometric:false, fallback:false, otp:true});
 });
}

test('a recorded biometric attempt reports its outcome independently of HTTP success', () => {
  const live = { captureQuality: { state: 'ACCEPTED' }, liveness: { state: 'LIVE' } };
  assert.match(biometricAttemptNotice({ result: { ...live, match: { state: 'NO_MATCH' } } }).text, /تطابق ندارد/);
  assert.match(biometricAttemptNotice({ result: { errorCategory: 'POOR_CAPTURE_QUALITY' } }).text, /کیفیت/);
  assert.match(biometricAttemptNotice({ result: { errorCategory: 'LIVENESS_FAILED' } }).text, /زنده‌بودن/);
  const timedOut = biometricAttemptNotice({ result: { errorCategory: 'CAPTURE_TIMEOUT' }, fallbackEligible: true });
  assert.equal(timedOut.kind, 'error');
  assert.match(timedOut.text, /مهلت.*روش جایگزین/);
  assert.match(biometricAttemptNotice({ result: { errorCategory: 'DEVICE_DISCONNECTED' } }).text, /اتصال حسگر/);
  assert.equal(biometricAttemptNotice({ result: { ...live, match: { state: 'MATCH' } } }).kind, 'error');
  assert.equal(biometricAttemptNotice(undefined).kind, 'error');
  assert.deepEqual(biometricAttemptNotice({ authorization: { id: 'authorization' } }), {
    kind: 'success', text: 'اثر انگشت راننده تأیید شد.',
  });
});
