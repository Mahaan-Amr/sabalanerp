import assert from 'node:assert/strict';
import test from 'node:test';
import { signBiometricCommand } from '../../../../backend/src/services/biometricSigning';
import { openBiometricTransportEnvelope, sealBiometricTransportEnvelope } from '../../../../backend/src/services/biometricWorkstationProtocol';
import { openTransportEnvelope, sealTransportEnvelope, verifyConnectorCommand } from '../src/protocol';

const commandSecret = Buffer.alloc(32, 3);
const transportKey = Buffer.alloc(32, 7);

test('backend and workstation host share exact command canonicalization and HMAC encoding', () => {
  const now = new Date('2026-09-02T13:00:00.000Z');
  const command = { commandId: 'interop-01', nonce: 'nonce-01', workstationId: 'PILOT-01', issuedAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30_000).toISOString(), operation: 'HEALTH' as const, payload: {} };
  const signed = signBiometricCommand(command, commandSecret);
  assert.deepEqual(verifyConnectorCommand(signed, commandSecret, { workstationId: 'PILOT-01', now }), command);
});

test('backend and workstation host can open each other transport envelopes', () => {
  const context = { commandId: 'interop-02', workstationId: 'PILOT-01', purpose: 'VERIFY_EXPECTED' as const, subjectId: 'driver-01', waybillIntegrityHash: 'a'.repeat(64) };
  const material = Buffer.from('iso-template-material');
  const fromBackend = sealBiometricTransportEnvelope(material, context, 'transport-v1', transportKey);
  assert.deepEqual(openTransportEnvelope(fromBackend, context, { 'transport-v1': transportKey }), material);
  const fromHost = sealTransportEnvelope(material, context, 'transport-v1', transportKey);
  assert.deepEqual(openBiometricTransportEnvelope(fromHost, context, { 'transport-v1': transportKey }), material);
});
