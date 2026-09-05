import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openBiometricTransportEnvelope,
  sealBiometricTransportEnvelope,
  signBiometricConnectorResponse,
  verifyBiometricConnectorResponse,
  type BiometricTransportContext,
} from '../biometricWorkstationProtocol';
import { signBiometricCommand } from '../biometricSigning';

const commandSecret = Buffer.alloc(32, 3);
const transportKey = Buffer.alloc(32, 7);
const now = new Date('2026-09-02T13:00:00.000Z');
const command = {
  commandId: 'command-01', nonce: 'nonce-01', workstationId: 'PILOT-01', issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 30_000).toISOString(), operation: 'VERIFY' as const,
  payload: { challengeId: 'session-01', expectedDriverId: 'driver-01', waybillIntegrityHash: 'a'.repeat(64), transportEnvelopeDigest: 'b'.repeat(64) },
};

test('backend command signatures interoperate with the production 32-byte workstation secret', () => {
  assert.match(signBiometricCommand(command, commandSecret).signature, /^[A-Za-z0-9_-]{43}$/);
});

test('backend transport encryption is context bound and contains no plaintext template', () => {
  const context: BiometricTransportContext = { commandId: command.commandId, workstationId: command.workstationId, purpose: 'VERIFY_EXPECTED', subjectId: 'driver-01', waybillIntegrityHash: 'a'.repeat(64) };
  const material = Buffer.from('iso-template-material');
  const envelope = sealBiometricTransportEnvelope(material, context, 'transport-v1', transportKey);
  assert.deepEqual(openBiometricTransportEnvelope(envelope, context, { 'transport-v1': transportKey }), material);
  assert.throws(() => openBiometricTransportEnvelope(envelope, { ...context, subjectId: 'driver-02' }, { 'transport-v1': transportKey }));
  assert.equal(JSON.stringify(envelope).includes(material.toString()), false);
});

test('backend verifies connector result signature, command binding, expiry and optional envelope digest', () => {
  const response = { commandId: command.commandId, result: { availability: 'AVAILABLE' as const, device: { model: 'BioMini SLIM 2', serial: 'SERIAL-01', connectorVersion: '1.0.0', sdkVersion: '3.11.1.595' }, captureQuality: { state: 'ACCEPTED' as const, score: 86 }, liveness: { state: 'LIVE' as const, score: 999 }, match: { state: 'MATCH' as const, score: 97 }, errorCategory: 'NONE', retryable: false }, completedAt: now.toISOString() };
  const signed = signBiometricConnectorResponse(response, commandSecret);
  assert.deepEqual(verifyBiometricConnectorResponse(signed, commandSecret, command, now), response);
  assert.throws(() => verifyBiometricConnectorResponse({ ...signed, response: { ...response, commandId: 'other' } }, commandSecret, command, now), /signature|command/i);
  const late = signBiometricConnectorResponse({ ...response, completedAt: new Date(now.getTime() + 31_000).toISOString() }, commandSecret);
  assert.throws(() => verifyBiometricConnectorResponse(late, commandSecret, command, new Date(now.getTime() + 31_000)), /expired/i);
});
