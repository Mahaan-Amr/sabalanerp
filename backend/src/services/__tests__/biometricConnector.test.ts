import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { FEATURES, FEATURE_WORKSPACE_MAP } from '../../middleware/feature';
import {
  AuthenticatedBiometricConnector,
  BiometricCommandJournal,
  DeterministicBiometricSimulator,
  digestBiometricValue,
  ProtectedTemplateVault,
  readBiometricConnectorDiagnostics,
  signBiometricCommand,
} from '../biometricConnector';

const now = new Date('2026-08-07T10:00:00.000Z');
const secret = 'test-connector-secret-that-is-long-enough';

const command = (scenario: string, overrides: Record<string, unknown> = {}) => signBiometricCommand({
  commandId: `command-${scenario}`,
  nonce: `nonce-${scenario}`,
  workstationId: 'accounting-01',
  issuedAt: now.toISOString(),
  expiresAt: new Date(now.getTime() + 30_000).toISOString(),
  operation: 'VERIFY',
  payload: {
    challengeId: 'challenge-01',
    expectedDriverId: 'driver-01',
    templateReference: 'template-01',
    simulation: { scenario, attempt: 1 },
    ...overrides,
  },
}, secret);

test('device-neutral simulator reports safe outcomes for every required scenario', async () => {
  const simulator = new DeterministicBiometricSimulator();
  const expectations = {
    SUCCESS: ['AVAILABLE', 'ACCEPTED', 'LIVE', 'MATCH'],
    POOR_QUALITY: ['AVAILABLE', 'REJECTED', 'NOT_EVALUATED', 'NOT_EVALUATED'],
    LIVENESS_FAILURE: ['AVAILABLE', 'ACCEPTED', 'NOT_LIVE', 'NOT_EVALUATED'],
    NON_MATCH: ['AVAILABLE', 'ACCEPTED', 'LIVE', 'NO_MATCH'],
    WRONG_DRIVER: ['AVAILABLE', 'ACCEPTED', 'LIVE', 'NO_MATCH'],
    DISCONNECT: ['UNAVAILABLE', 'NOT_EVALUATED', 'NOT_EVALUATED', 'NOT_EVALUATED'],
    TIMEOUT: ['AVAILABLE', 'NOT_EVALUATED', 'NOT_EVALUATED', 'NOT_EVALUATED'],
    RETRY: ['AVAILABLE', 'NOT_EVALUATED', 'NOT_EVALUATED', 'NOT_EVALUATED'],
    RECOVERY: ['AVAILABLE', 'ACCEPTED', 'LIVE', 'MATCH'],
    LICENSING_FAILURE: ['UNAVAILABLE', 'NOT_EVALUATED', 'NOT_EVALUATED', 'NOT_EVALUATED'],
  } as const;

  for (const [scenario, expected] of Object.entries(expectations)) {
    const result = await simulator.execute(command(scenario).command);
    assert.deepEqual(
      [result.availability, result.captureQuality.state, result.liveness.state, result.match.state],
      expected,
      scenario,
    );
    assert.equal(JSON.stringify(result).includes('rawImage'), false);
    assert.equal(JSON.stringify(result).includes('templateMaterial'), false);
    if (scenario === 'LICENSING_FAILURE') assert.equal(result.errorCategory, 'SDK_LICENSE_INVALID');
  }

  const retry = await simulator.execute(command('RETRY', { simulation: { scenario: 'RETRY', attempt: 2 } }).command);
  assert.equal(retry.match.state, 'MATCH');
  const unsupported = await simulator.execute(command('UNRECOGNIZED').command);
  assert.equal(unsupported.match.state, 'NOT_EVALUATED');
  assert.equal(unsupported.errorCategory, 'INVALID_COMMAND');
});

test('only three good-quality live non-matches unlock biometric fallback', async () => {
  const simulator = new DeterministicBiometricSimulator();
  const first = await simulator.execute(command('NON_MATCH').command);
  assert.deepEqual(first.fallback, { goodQualityLiveNonMatchCount: 1, eligible: false });
  await simulator.execute(command('POOR_QUALITY', { challengeId: 'challenge-01' }).command);
  await simulator.execute(command('LIVENESS_FAILURE', { challengeId: 'challenge-01' }).command);
  const second = await simulator.execute(command('NON_MATCH', { simulation: { scenario: 'NON_MATCH', attempt: 2 } }).command);
  const third = await simulator.execute(command('NON_MATCH', { simulation: { scenario: 'NON_MATCH', attempt: 3 } }).command);
  assert.deepEqual(second.fallback, { goodQualityLiveNonMatchCount: 2, eligible: false });
  assert.deepEqual(third.fallback, { goodQualityLiveNonMatchCount: 3, eligible: true });
});

test('diagnostics disclose operational health but no biometric or authentication material', async () => {
  const diagnostics = await readBiometricConnectorDiagnostics(
    new DeterministicBiometricSimulator(),
    new Date('2026-08-07T10:05:00.000Z'),
  );
  assert.deepEqual(diagnostics, {
    mode: 'SIMULATOR',
    availability: 'AVAILABLE',
    liveEnrollmentEnabled: false,
    checkedAt: '2026-08-07T10:05:00.000Z',
    device: {
      model: 'Sabalan deterministic simulator',
      serial: 'SIM-0001',
      connectorVersion: '1.0.0-simulator',
      sdkVersion: 'simulator-1',
    },
    supportedChecks: ['capture-quality', 'liveness', 'one-to-one-match', 'retry-recovery', 'licensing'],
  });
  assert.doesNotMatch(JSON.stringify(diagnostics), /template|secret|nonce|signature|raw.?image/i);
});

test('diagnostic access is isolated behind an Accounting feature permission', () => {
  assert.equal(FEATURES.ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW, 'accounting_biometric_diagnostics_view');
  assert.equal(FEATURE_WORKSPACE_MAP[FEATURES.ACCOUNTING_BIOMETRIC_DIAGNOSTICS_VIEW], 'accounting');
});

test('signed commands reject replay and survive restart with idempotent results', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'sabalan-biometric-'));
  const journalPath = join(directory, 'commands.json');
  const firstGateway = new AuthenticatedBiometricConnector({
    secret,
    workstationId: 'accounting-01',
    connector: new DeterministicBiometricSimulator(),
    journal: new BiometricCommandJournal(journalPath),
    now: () => now,
  });
  const signed = command('SUCCESS');
  const first = await firstGateway.execute(signed);

  const restartedGateway = new AuthenticatedBiometricConnector({
    secret,
    workstationId: 'accounting-01',
    connector: new DeterministicBiometricSimulator(),
    journal: new BiometricCommandJournal(journalPath),
    now: () => now,
  });
  assert.deepEqual(await restartedGateway.execute(signed), first);

  const replay = signBiometricCommand({ ...signed.command, commandId: 'different-command' }, secret);
  await assert.rejects(() => restartedGateway.execute(replay), /replay/i);
  const tampered = { ...signed, command: { ...signed.command, payload: { ...signed.command.payload, expectedDriverId: 'driver-02' } } };
  await assert.rejects(() => restartedGateway.execute(tampered), /signature/i);
});

test('command execution is durably reserved before the device runs and concurrent duplicates do not execute twice', async () => {
  const journalPath = join(mkdtempSync(join(tmpdir(), 'sabalan-biometric-concurrent-')), 'commands.json');
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let executions = 0;
  const connector = {
    execute: async (input: any) => {
      executions += 1;
      const stored = JSON.parse(readFileSync(journalPath, 'utf8'));
      assert.equal(stored[0].state, 'IN_FLIGHT');
      await blocked;
      return new DeterministicBiometricSimulator().execute(input);
    },
  };
  const gateway = new AuthenticatedBiometricConnector({ secret, workstationId: 'accounting-01', connector, journal: new BiometricCommandJournal(journalPath), now: () => now });
  const signed = command('SUCCESS');
  const first = gateway.execute(signed);
  await assert.rejects(() => gateway.execute(signed), /in progress/i);
  assert.equal(executions, 1);
  release();
  await first;
  assert.equal(executions, 1);
});

test('an in-flight command found after restart is interrupted and never replayed', async () => {
  const journalPath = join(mkdtempSync(join(tmpdir(), 'sabalan-biometric-crash-')), 'commands.json');
  const signed = command('SUCCESS');
  const journal = new BiometricCommandJournal(journalPath);
  journal.reserve({ commandId: signed.command.commandId, nonceHash: digestBiometricValue(signed.command.nonce), requestHash: digestBiometricValue(signed.command) });
  let executions = 0;
  const restarted = new AuthenticatedBiometricConnector({
    secret,
    workstationId: 'accounting-01',
    connector: { execute: async () => { executions += 1; throw new Error('must not execute'); } },
    journal: new BiometricCommandJournal(journalPath),
    now: () => now,
  });
  await assert.rejects(() => restarted.execute(signed), /interrupted.*unknown/i);
  assert.equal(executions, 0);
  assert.equal(JSON.parse(readFileSync(journalPath, 'utf8'))[0].state, 'INTERRUPTED');
});

test('signed forbidden and malformed payloads fail before journaling or device execution', async () => {
  const journalPath = join(mkdtempSync(join(tmpdir(), 'sabalan-biometric-payload-')), 'commands.json');
  let executions = 0;
  const gateway = new AuthenticatedBiometricConnector({
    secret,
    workstationId: 'accounting-01',
    connector: { execute: async (input) => { executions += 1; return new DeterministicBiometricSimulator().execute(input); } },
    journal: new BiometricCommandJournal(journalPath),
    now: () => now,
  });
  const forbiddenPayloads = [
    { ...command('SUCCESS').command.payload, rawImage: 'data:image/png;base64,AAAA' },
    { ...command('SUCCESS').command.payload, sample: 'A'.repeat(128) },
    { ...command('SUCCESS').command.payload, unknownField: 'value' },
    { ...command('SUCCESS').command.payload, expectedDriverId: 'A'.repeat(128) },
    { challengeId: 'challenge-01', expectedDriverId: 'driver-01' },
  ];
  for (const [index, payload] of forbiddenPayloads.entries()) {
    const signed = signBiometricCommand({ ...command('SUCCESS').command, commandId: `forbidden-${index}`, nonce: `forbidden-${index}`, payload }, secret);
    await assert.rejects(() => gateway.execute(signed), /payload/i);
  }
  assert.equal(executions, 0);
  assert.equal(existsSync(journalPath), false);
});

test('connector rejects weak authentication and commands with an excessive validity window', async () => {
  const journalPath = join(mkdtempSync(join(tmpdir(), 'sabalan-biometric-policy-')), 'commands.json');
  assert.throws(() => new AuthenticatedBiometricConnector({
    secret: 'weak', workstationId: 'accounting-01', connector: new DeterministicBiometricSimulator(), journal: new BiometricCommandJournal(journalPath),
  }), /32 bytes/i);
  const gateway = new AuthenticatedBiometricConnector({
    secret, workstationId: 'accounting-01', connector: new DeterministicBiometricSimulator(), journal: new BiometricCommandJournal(journalPath), now: () => now,
  });
  const longLived = signBiometricCommand({
    ...command('SUCCESS').command,
    commandId: 'long-lived', nonce: 'long-lived', expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
  }, secret);
  await assert.rejects(() => gateway.execute(longLived), /validity window/i);
  const malformedTime = signBiometricCommand({ ...command('SUCCESS').command, commandId: 'bad-time', nonce: 'bad-time', issuedAt: 'not-a-date' }, secret);
  await assert.rejects(() => gateway.execute(malformedTime), /timestamp/i);
});

test('protected templates use authenticated encryption and never persist plaintext', () => {
  const key = Buffer.alloc(32, 7);
  const vault = new ProtectedTemplateVault({ activeKeyId: 'key-2026-08', keys: { 'key-2026-08': key } });
  const material = Buffer.from('reusable-fingerprint-template-material');
  const envelope = vault.seal(material, { personnelId: 'personnel-01', finger: 'RIGHT_INDEX', format: 'ISO_19794_2' });

  assert.deepEqual(vault.open(envelope, { personnelId: 'personnel-01', finger: 'RIGHT_INDEX', format: 'ISO_19794_2' }), material);
  assert.equal(JSON.stringify(envelope).includes(material.toString('utf8')), false);
  assert.throws(() => vault.open(envelope, { personnelId: 'personnel-02', finger: 'RIGHT_INDEX', format: 'ISO_19794_2' }));

  const directory = mkdtempSync(join(tmpdir(), 'sabalan-biometric-journal-'));
  const journalPath = join(directory, 'commands.json');
  const journal = new BiometricCommandJournal(journalPath);
  journal.reserve({ commandId: 'safe', nonceHash: 'hash', requestHash: 'hash' });
  journal.complete('safe', { success: true });
  assert.equal(readFileSync(journalPath, 'utf8').includes(material.toString('utf8')), false);
});
