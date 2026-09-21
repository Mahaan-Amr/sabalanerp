import assert from 'node:assert/strict';
import test from 'node:test';
import { projectBiometricEnrollmentTemplate } from '../biometricEnrollmentProjection';

test('refreshed enrollment projection keeps safe quality and liveness evidence for each finger', () => {
  const projected = projectBiometricEnrollmentTemplate({
    finger: 'RIGHT_INDEX',
    imageMimeType: 'image/png',
    imageWidth: 300,
    imageHeight: 400,
    imageByteLength: 12000,
    deviceEvidence: {
      commandId: 'capture-01',
      deviceSerial: 'sensitive-device-id',
      captureQuality: { state: 'ACCEPTED', score: 98 },
      liveness: { state: 'LIVE', score: 999 },
    },
  });

  assert.deepEqual(projected, {
    finger: 'RIGHT_INDEX',
    imageMimeType: 'image/png',
    imageWidth: 300,
    imageHeight: 400,
    imageByteLength: 12000,
    captureQuality: { state: 'ACCEPTED', score: 98 },
    liveness: { state: 'LIVE' },
  });
  assert.equal(JSON.stringify(projected).includes('sensitive-device-id'), false);
  assert.equal(JSON.stringify(projected).includes('capture-01'), false);
  assert.equal(JSON.stringify(projected).includes('999'), false);
});
