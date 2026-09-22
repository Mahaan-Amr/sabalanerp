import assert from 'node:assert/strict';
import test from 'node:test';
import {
  biometricEnrollmentPresentation,
  driverEligibilitySections,
} from './driverEligibilityPresentation';

test('separates driver status, biometric enrollment, and dispatch cases into focused surfaces', () => {
  assert.deepEqual(driverEligibilitySections, [
    { value: 'status', label: 'وضعیت راننده' },
    { value: 'biometric', label: 'بیومتریک' },
    { value: 'dispatch', label: 'پرونده‌های ارسال' },
  ]);
});

test('an active biometric enrollment replaces the enrollment form with a compact active summary', () => {
  assert.deepEqual(biometricEnrollmentPresentation({
    hasActiveEnrollment: true,
    imagesRequested: false,
  }), {
    showEnrollmentForm: false,
    showActiveSummary: true,
    showDeactivationAction: true,
    loadEnrollmentImages: false,
  });
});

test('enrollment images remain private and unloaded until explicitly requested', () => {
  assert.equal(biometricEnrollmentPresentation({
    hasActiveEnrollment: true,
    imagesRequested: true,
  }).loadEnrollmentImages, true);
});

test('a missing or deactivated enrollment exposes the guided enrollment form', () => {
  assert.deepEqual(biometricEnrollmentPresentation({
    hasActiveEnrollment: false,
    imagesRequested: false,
  }), {
    showEnrollmentForm: true,
    showActiveSummary: false,
    showDeactivationAction: false,
    loadEnrollmentImages: false,
  });
});
