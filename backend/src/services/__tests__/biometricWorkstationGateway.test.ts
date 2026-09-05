import assert from 'node:assert/strict';
import test from 'node:test';
import { BiometricWorkstationGateway, readBiometricWorkstationConfig } from '../biometricWorkstationGateway';
import { digestBiometricValue } from '../biometricProtocol';
import { signBiometricConnectorResponse, sealBiometricTransportEnvelope } from '../biometricWorkstationProtocol';

const commandSecret = Buffer.alloc(32, 3);
const transportKey = Buffer.alloc(32, 7);
const now = new Date('2026-09-02T13:00:00.000Z');
const config = { 'PILOT-01': { commandSecretBase64: commandSecret.toString('base64'), activeTransportKeyId: 'transport-v1', transportKeysBase64: { 'transport-v1': transportKey.toString('base64') } } };

const database = () => {
  const rows = new Map<string, any>();
  const client: any = { biometricConnectorChallenge: {
    create: async ({ data }: any) => { rows.set(data.id, { ...data, status: data.status || 'ISSUED' }); return data; },
    findUnique: async ({ where }: any) => rows.get(where.id) || null,
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const [id, row] of rows) {
        if (where.id?.in ? !where.id.in.includes(id) : where.id !== id) continue;
        if (where.status && row.status !== where.status) continue;
        if (where.expiresAt?.gte && row.expiresAt < where.expiresAt.gte) continue;
        rows.set(id, { ...row, ...data }); count += 1;
      }
      return { count };
    },
  }, $executeRawUnsafe: async () => 1 };
  client.$transaction = async (operation: (tx: any) => Promise<any>) => operation(client);
  return { rows, client };
};

test('workstation configuration rejects non-canonical or incomplete key material', () => {
  assert.deepEqual(readBiometricWorkstationConfig(JSON.stringify(config)), config);
  assert.throws(() => readBiometricWorkstationConfig(JSON.stringify({ 'PILOT-01': { ...config['PILOT-01'], commandSecretBase64: `${commandSecret.toString('base64')}!` } })), /command secret/i);
  assert.throws(() => readBiometricWorkstationConfig(JSON.stringify({ 'PILOT-01': { ...config['PILOT-01'], activeTransportKeyId: 'missing' } })), /active transport key/i);
});

test('enrollment challenge consumes a signed capture once and opens only its bound template', async () => {
  const db = database();
  const gateway = new BiometricWorkstationGateway(db.client, config, () => now);
  const issued = await gateway.issueEnrollment({ workstationId: 'PILOT-01', actorId: 'hr-01', personnelId: 'person-01', finger: 'RIGHT_INDEX' });
  const context = { commandId: issued.command.commandId, workstationId: 'PILOT-01', purpose: 'ENROLLMENT_CAPTURE' as const, subjectId: 'person-01', finger: 'RIGHT_INDEX' };
  const material = Buffer.from('iso-template-material');
  const envelope = sealBiometricTransportEnvelope(material, context, 'transport-v1', transportKey);
  const response = { commandId: issued.command.commandId, result: { availability: 'AVAILABLE' as const, device: { model: 'BioMini SLIM 2', serial: 'SERIAL-01', connectorVersion: '1.0.0', sdkVersion: '3.11.1.595' }, captureQuality: { state: 'ACCEPTED' as const, score: 86 }, liveness: { state: 'LIVE' as const, score: 999 }, match: { state: 'NOT_EVALUATED' as const }, errorCategory: 'NONE', retryable: false }, transportEnvelopeDigest: digestBiometricValue(envelope), completedAt: now.toISOString() };
  const signedResponse = signBiometricConnectorResponse(response, commandSecret);
  const claimed = await gateway.claimEnrollmentCapture({ challengeId: issued.command.commandId, actorId: 'hr-01', signedResponse, transportEnvelope: envelope });
  assert.deepEqual(claimed.material, material);
  await assert.rejects(() => gateway.claimEnrollmentCapture({ challengeId: issued.command.commandId, actorId: 'hr-01', signedResponse, transportEnvelope: envelope }), /already used/i);
});

test('verification challenge is bound to actor, session, driver, waybill and one use', async () => {
  const db = database();
  const gateway = new BiometricWorkstationGateway(db.client, config, () => now);
  const issued = await gateway.issueVerification({ workstationId: 'PILOT-01', actorId: 'accountant-01', sessionId: 'session-01', driverId: 'driver-01', waybillIntegrityHash: 'a'.repeat(64), expectedTemplate: Buffer.from('expected') });
  assert.equal(issued.command.payload.transportEnvelopeDigest, digestBiometricValue(issued.transportEnvelope));
  const response = { commandId: issued.command.commandId, result: { availability: 'AVAILABLE' as const, device: { model: 'BioMini SLIM 2', serial: 'SERIAL-01', connectorVersion: '1.0.0', sdkVersion: '3.11.1.595' }, captureQuality: { state: 'ACCEPTED' as const, score: 86 }, liveness: { state: 'LIVE' as const, score: 999 }, match: { state: 'MATCH' as const, score: 97 }, errorCategory: 'NONE', retryable: false }, completedAt: now.toISOString() };
  const signedResponse = signBiometricConnectorResponse(response, commandSecret);
  await assert.rejects(() => gateway.claimVerification({ challengeId: issued.command.commandId, actorId: 'other', signedResponse }), /invalid/i);
  const claimed = await gateway.claimVerification({ challengeId: issued.command.commandId, actorId: 'accountant-01', signedResponse });
  assert.equal(claimed.challenge.contextId, 'session-01');
  await gateway.complete([issued.command.commandId], true);
  assert.equal(db.rows.get(issued.command.commandId).status, 'COMPLETED');
});
