import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { BiometricDeviceError, FakeBiometricDevice } from '../src/deviceAdapter';
import { digest, sealTransportEnvelope, signConnectorCommand, verifyConnectorResponse } from '../src/protocol';
import { createConnectorServer } from '../src/server';

const commandSecret = Buffer.alloc(32, 3);
const transportKey = Buffer.alloc(32, 7);
const workstationId = 'PILOT-ACCOUNTING-01';
const allowedOrigin = 'https://erp.example.test';
const fixedNow = new Date('2026-09-02T13:00:00.000Z');

const command = (operation: 'HEALTH' | 'CAPTURE' = 'HEALTH') => ({
  commandId: `command-${operation.toLowerCase()}`,
  nonce: `nonce-${operation.toLowerCase()}`,
  workstationId,
  issuedAt: fixedNow.toISOString(),
  expiresAt: new Date(fixedNow.getTime() + 30_000).toISOString(),
  operation,
  payload: operation === 'CAPTURE'
    ? { challengeId: 'enrollment-01', subjectId: 'driver-01', finger: 'RIGHT_INDEX' }
    : {},
});

const withServer = async (run: (baseUrl: string, device: FakeBiometricDevice, journalPath: string) => Promise<void>) => {
  const device = new FakeBiometricDevice();
  const journalPath = join(mkdtempSync(join(tmpdir(), 'sabalan-host-')), 'journal.json');
  const server = createConnectorServer({
    allowedOrigin, workstationId, commandSecret, transportKeys: { activeKeyId: 'transport-v1', keys: { 'transport-v1': transportKey } },
    journalPath, device, now: () => fixedNow,
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  assert.equal(address.address, '127.0.0.1');
  try { await run(`http://127.0.0.1:${address.port}`, device, journalPath); }
  finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
};

const post = (baseUrl: string, body: unknown, origin = allowedOrigin) => fetch(`${baseUrl}/v1/commands`, {
  method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('rejects missing and unapproved browser origins before touching the device', () => withServer(async (baseUrl, device) => {
  const signed = signConnectorCommand(command(), commandSecret);
  assert.equal((await post(baseUrl, signed, 'https://evil.example')).status, 403);
  assert.equal((await fetch(`${baseUrl}/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(signed) })).status, 403);
  assert.equal(device.calls.length, 0);
}));

test('executes a signed command once and returns a signed, replay-safe response', () => withServer(async (baseUrl, device, journalPath) => {
  const plain = command();
  const signed = signConnectorCommand(plain, commandSecret);
  const first = await post(baseUrl, signed);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(verifyConnectorResponse(firstBody, commandSecret, plain, fixedNow).result.availability, 'AVAILABLE');
  const replay = await post(baseUrl, signed);
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), firstBody);
  assert.equal(device.calls.length, 1);
  const journal = readFileSync(journalPath, 'utf8');
  assert.equal(journal.includes(plain.nonce), false);
  assert.equal(journal.includes(commandSecret.toString('base64')), false);
}));

test('rejects nonce substitution and concurrent duplicates', () => withServer(async (baseUrl, device) => {
  device.delayMilliseconds = 50;
  const plain = command();
  const signed = signConnectorCommand(plain, commandSecret);
  const [one, two] = await Promise.all([post(baseUrl, signed), post(baseUrl, signed)]);
  assert.deepEqual([one.status, two.status].sort(), [200, 409]);
  const substituted = { ...plain, commandId: 'command-other' };
  const response = await post(baseUrl, signConnectorCommand(substituted, commandSecret));
  assert.equal(response.status, 409);
  assert.equal(device.calls.length, 1);
}));

test('capture seals the ISO template and never returns plaintext material', () => withServer(async (baseUrl, device, journalPath) => {
  const plain = command('CAPTURE');
  const response = await post(baseUrl, signConnectorCommand(plain, commandSecret));
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  verifyConnectorResponse(body, commandSecret, plain, fixedNow);
  assert.ok(body.transportEnvelope);
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes(device.templateMaterial.toString('utf8')), false);
  assert.equal(readFileSync(journalPath, 'utf8').includes('iso-template-material'), false);
  assert.equal(device.templateWasCleared, true);
}));

test('verification opens only the signed one-use expected template and clears it after matching', () => withServer(async (baseUrl, device) => {
  const context = { commandId: 'command-verify', workstationId, purpose: 'VERIFY_EXPECTED' as const, subjectId: 'driver-01', waybillIntegrityHash: 'a'.repeat(64) };
  const envelope = sealTransportEnvelope(device.templateMaterial, context, 'transport-v1', transportKey);
  const plain = {
    commandId: context.commandId, nonce: 'nonce-verify', workstationId, issuedAt: fixedNow.toISOString(), expiresAt: new Date(fixedNow.getTime() + 30_000).toISOString(), operation: 'VERIFY' as const,
    payload: { challengeId: 'session-01', expectedDriverId: context.subjectId, waybillIntegrityHash: context.waybillIntegrityHash, transportEnvelopeDigest: digest(envelope) },
  };
  const response = await post(baseUrl, { ...signConnectorCommand(plain, commandSecret), transportEnvelope: envelope });
  assert.equal(response.status, 200);
  const body = await response.json() as any;
  assert.equal(verifyConnectorResponse(body, commandSecret, plain, fixedNow).result.match.state, 'MATCH');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(device.expectedTemplateWasCleared, true);

  const substituted = { ...envelope, ciphertext: envelope.ciphertext.slice(0, -2) + 'AA' };
  const rejected = await post(baseUrl, { ...signConnectorCommand({ ...plain, commandId: 'command-substitution', nonce: 'nonce-substitution' }, commandSecret), transportEnvelope: substituted });
  assert.equal(rejected.status, 400);
}));

test('rejects oversized and malformed requests before device access', () => withServer(async (baseUrl, device) => {
  const oversized = await fetch(`${baseUrl}/v1/commands`, { method: 'POST', headers: { origin: allowedOrigin, 'content-type': 'application/json' }, body: 'x'.repeat(70_000) });
  assert.equal(oversized.status, 413);
  assert.equal((await fetch(`${baseUrl}/v1/commands`, { method: 'POST', headers: { origin: allowedOrigin, 'content-type': 'application/json' }, body: '{' })).status, 400);
  assert.equal(device.calls.length, 0);
}));

test('returns signed unavailable evidence for a genuine device outage', () => withServer(async (baseUrl, device) => {
  device.health = async () => { throw new BiometricDeviceError('DEVICE_DISCONNECTED', true); };
  const plain = command();
  const response = await post(baseUrl, signConnectorCommand(plain, commandSecret));
  assert.equal(response.status, 200);
  const result = verifyConnectorResponse(await response.json() as any, commandSecret, plain, fixedNow).result;
  assert.equal(result.availability, 'UNAVAILABLE');
  assert.equal(result.errorCategory, 'DEVICE_DISCONNECTED');
  assert.equal(result.retryable, true);
}));
