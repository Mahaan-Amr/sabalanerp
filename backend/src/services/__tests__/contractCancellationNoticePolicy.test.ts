import assert from 'node:assert/strict';
import test from 'node:test';
import { cancellationSubmissionIsUnknown, normalizeCancellationMobile, resolveCancellationRecipient } from '../contractCancellationNoticePolicy';

const mobile = (number: string, isPrimary = false, isActive = true) => ({ number, isPrimary, isActive, type: 'mobile' });
test('primary and sole active mobile win over historical, inactive and landline records', () => {
  const phones = [mobile('09120000001', true, false), mobile('+989120000002'), mobile('09120000003', true),
    { ...mobile('02112345678', true), type: 'home' }];
  assert.equal(resolveCancellationRecipient(phones).phoneNumber, '09120000003');
  assert.equal(resolveCancellationRecipient(phones).canChoosePhone, false);
  assert.equal(resolveCancellationRecipient(phones.slice(0, 2)).phoneNumber, '09120000002');
  assert.equal(resolveCancellationRecipient(phones, '09120000001').phoneNumber, '09120000003');
});
test('several mobiles without primary require an active explicit choice', () => {
  const phones = [mobile('09120000001'), mobile('09120000002')];
  assert.equal(resolveCancellationRecipient(phones).status, 'NEEDS_SELECTION');
  assert.equal(resolveCancellationRecipient(phones).canChoosePhone, true);
  assert.equal(resolveCancellationRecipient(phones, '09120000002').phoneNumber, '09120000002');
  assert.equal(resolveCancellationRecipient(phones, '09120000003').phoneNumber, null);
});
test('every attempt resolves changed current contact data and never uses an inactive selected recipient', () => {
  const phones = [mobile('09120000001', false, false), mobile('09120000002', true)];
  assert.equal(resolveCancellationRecipient(phones, '09120000001').phoneNumber, '09120000002');
  assert.equal(resolveCancellationRecipient([]).status, 'NEEDS_PHONE');
  assert.equal(resolveCancellationRecipient([mobile('invalid')]).status, 'NEEDS_PHONE');
});
test('mobile normalization handles Persian digits and international representations without accepting landlines', () => {
  for (const value of ['۰۹۱۲۰۰۰۰۰۰۱', '٠٩١٢٠٠٠٠٠٠١', '00989120000001', '+98 912 000 0001', '9120000001']) {
    assert.equal(normalizeCancellationMobile(value), '09120000001');
  }
  assert.equal(normalizeCancellationMobile('02112345678'), null);
});
test('ambiguous provider outcomes stop automatic retries while definite rejections and connection failures may retry', () => {
  assert.equal(cancellationSubmissionIsUnknown({ success: false, failureKind: 'NETWORK', errorCode: 'ECONNRESET' }), true);
  assert.equal(cancellationSubmissionIsUnknown({ success: false, failureKind: 'HTTP', httpStatus: 504 }), true);
  assert.equal(cancellationSubmissionIsUnknown({ success: false, failureKind: 'NETWORK', errorCode: 'ENOTFOUND' }), false);
  assert.equal(cancellationSubmissionIsUnknown({ success: false, failureKind: 'PROVIDER_REJECTION' }), false);
  assert.equal(cancellationSubmissionIsUnknown({ success: true }), false);
});
