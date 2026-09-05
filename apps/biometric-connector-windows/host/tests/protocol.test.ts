import assert from 'node:assert/strict';
import test from 'node:test';
import {
  openTransportEnvelope,
  sealTransportEnvelope,
  signConnectorCommand,
  signConnectorResponse,
  verifyConnectorCommand,
  verifyConnectorResponse,
} from '../src/protocol';

const commandSecret = Buffer.alloc(32, 3);
const transportKey = Buffer.alloc(32, 7);
const now = new Date('2026-09-02T13:00:00.000Z');
const command = {
  commandId: 'command-01',
  nonce: 'nonce-01',
  workstationId: 'PILOT-ACCOUNTING-01',
  issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  operation: 'VERIFY' as const,
  payload: {
    challengeId: 'session-01',
    expectedDriverId: 'driver-01',
    templateReference: 'template-01',
    waybillIntegrityHash: 'a'.repeat(64),
    transportEnvelopeDigest: 'b'.repeat(64),
  },
};

test('command signatures bind operation, workstation, driver, waybill and envelope digest', () => {
  const signed = signConnectorCommand(command, commandSecret);
  assert.deepEqual(verifyConnectorCommand(signed, commandSecret, { workstationId: 'PILOT-ACCOUNTING-01', now }), command);
  assert.throws(() => verifyConnectorCommand({ ...signed, command: { ...command, workstationId: 'OTHER' } }, commandSecret, { workstationId: 'PILOT-ACCOUNTING-01', now }), /signature|workstation/i);
  assert.throws(() => verifyConnectorCommand({ ...signed, command: { ...command, payload: { ...command.payload, expectedDriverId: 'driver-02' } } }, commandSecret, { workstationId: 'PILOT-ACCOUNTING-01', now }), /signature/i);
  assert.throws(() => verifyConnectorCommand(signed, commandSecret, { workstationId: 'PILOT-ACCOUNTING-01', now: new Date(now.getTime() + 31_000) }), /expired/i);
});

test('transport envelopes are one-use-context bound and reject substitution', () => {
  const context = { commandId: 'command-01', workstationId: 'PILOT-ACCOUNTING-01', purpose: 'VERIFY_EXPECTED' as const, subjectId: 'driver-01', waybillIntegrityHash: 'a'.repeat(64) };
  const material = Buffer.from('iso-template-material');
  const envelope = sealTransportEnvelope(material, context, 'transport-v1', transportKey);
  assert.deepEqual(openTransportEnvelope(envelope, context, { 'transport-v1': transportKey }), material);
  assert.throws(() => openTransportEnvelope(envelope, { ...context, subjectId: 'driver-02' }, { 'transport-v1': transportKey }));
  assert.throws(() => openTransportEnvelope(envelope, { ...context, commandId: 'command-02' }, { 'transport-v1': transportKey }));
  assert.equal(JSON.stringify(envelope).includes(material.toString('utf8')), false);
});

test('connector response attestation binds the normalized result and enrollment envelope digest', () => {
  const response = {
    commandId: 'command-01',
    result: {
      availability: 'AVAILABLE' as const,
      device: { model: 'BioMini SLIM 2', serial: 'SBBM-SLIM2-01', connectorVersion: '1.0.0', sdkVersion: '3.11.1.595' },
      captureQuality: { state: 'ACCEPTED' as const, score: 86 },
      liveness: { state: 'LIVE' as const, score: 999 },
      match: { state: 'MATCH' as const, score: 97 },
      errorCategory: 'NONE',
      retryable: false,
    },
    transportEnvelopeDigest: 'c'.repeat(64),
    completedAt: now.toISOString(),
  };
  const signed = signConnectorResponse(response, commandSecret);
  assert.deepEqual(verifyConnectorResponse(signed, commandSecret, command, now), response);
  assert.throws(() => verifyConnectorResponse({ ...signed, response: { ...response, result: { ...response.result, match: { state: 'NO_MATCH' as const, score: 3 } } } }, commandSecret, command, now), /signature/i);
  assert.throws(() => verifyConnectorResponse({ ...signed, response: { ...response, commandId: 'command-02' } }, commandSecret, command, now), /signature|command/i);
});
