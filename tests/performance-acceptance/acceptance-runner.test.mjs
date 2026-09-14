import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, verify } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  PERFORMANCE_ACCEPTANCE_FAILURE_SCENARIOS,
  PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES,
  PERFORMANCE_ACCEPTANCE_INTEGRATED_CHECKS,
  PERFORMANCE_ACCEPTANCE_NONDISCLOSURE_SCENARIOS,
  PERFORMANCE_ACCEPTANCE_RACES,
} from '../../scripts/performance-acceptance-contract.mjs';
import { runPerformanceAcceptance } from '../../scripts/performance-acceptance-runner.mjs';
import { performanceAcceptanceTrustFromEnvironment } from '../../scripts/performance-acceptance-artifact.mjs';

const posixOnly = { skip: process.platform === 'win32' ? 'Requires POSIX process groups.' : false };
const keys = generateKeyPairSync('ed25519');
const candidateKeys = generateKeyPairSync('ed25519');
const handoffKeys = generateKeyPairSync('ed25519');
const canonical = (value) => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});
const measurementPublicKey = { keyId: 'acceptance-runner-v1', publicKey: keys.publicKey };
const candidatePublicKey = { keyId: 'candidate-builder-v1', publicKey: candidateKeys.publicKey };
const handoffSigner = { keyId: 'candidate-handoff-v1', privateKey: handoffKeys.privateKey };
const candidateIdentity = (changes = {}) => {
  const release = {
    commit: 'a'.repeat(40), sourceHash: 'b'.repeat(64), schemaHash: 'c'.repeat(64),
    policyHash: 'd'.repeat(64), infrastructureHash: 'e'.repeat(64),
    images: { backend: `sha256:${'1'.repeat(64)}`, frontend: `sha256:${'2'.repeat(64)}`, inquiry: `sha256:${'3'.repeat(64)}` },
    ...changes,
  };
  const binding = { status: 'ATTESTED', evidenceHash: 'f'.repeat(64), keyId: candidatePublicKey.keyId, algorithm: 'Ed25519' };
  return { ...release, runtimeSourceBinding: { ...binding,
    signature: sign(null, Buffer.from(canonical({ release, binding })), candidateKeys.privateKey).toString('base64') } };
};
const passItems = (names) => names.map((name) => ({ name, status: 'PASS' }));
const measurementsFor = (name) => ({
  'integrated-regression': { checks: passItems(PERFORMANCE_ACCEPTANCE_INTEGRATED_CHECKS), openP0: 0, openP1: 0, skipped: 0 },
  'twelve-races': { database: 'PostgreSQL', deterministicBarriers: true,
    races: PERFORMANCE_ACCEPTANCE_RACES.map(({ name: raceName }) => ({ name: raceName, iterations: 100, actors: 2,
      failures: 0, validTruthsPerIteration: 1, duplicateEvents: 0, lostWrites: 0, additionalDisclosures: 0, loserBusinessResponse: true })) },
  'failure-recovery': {
    failureInjection: { scenarios: PERFORMANCE_ACCEPTANCE_FAILURE_SCENARIOS.map((scenario) => ({ name: scenario,
      executed: true, failClosed: true, lostAcknowledgedWrites: 0 })) },
    runbookRehearsal: { fullEncryptedCheckpointRestored: true, rpoAcknowledgedWritesLost: 0,
      correctnessRehearsalPassed: true, timedDressRehearsalPassed: true, operatorId: 'operator-1', runbookHash: '1'.repeat(64),
      dryRuns: [{ count: 10, hash: '2'.repeat(64) }, { count: 10, hash: '2'.repeat(64) }],
      idempotentApplyReconciliations: 3, driftInjected: true, concurrentHrWriteRetried: true },
  },
  'permission-nondisclosure': { scenarios: passItems(PERFORMANCE_ACCEPTANCE_NONDISCLOSURE_SCENARIOS),
    permissionBranchesCoveredPercent: 100, additionalDisclosures: 0, openP0: 0, openP1: 0 },
  'browser-matrix': { realBrowser: true, realPersistence: true, roleActionScopeMatrixComplete: true,
    pageUsableP95Ms: 1000, pageUsableP99Ms: 1200,
    securityNegativeMatrix: [...PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES],
    roles: ['noAccess', 'supervisor', 'reviewer', 'lifecycleManager'].map((role) => ({ name: role, capabilities: [], realPersistence: true })),
    lifecycleStates: ['DRAFT', 'REJECTED', 'SUBMITTED', 'ACCEPTED'],
    viewports: ['360', '390', '768', '1280', '1920'].map((viewport) => ({ name: viewport, usableDurationMs: 1000, rtl: true,
      light: true, dark: true, keyboard: true, focus: true, reducedMotion: true, zoom200: true })) },
  'export-capacity': { requestP99Ms: 1000, queueP95Ms: 1000, formats: [
    { name: 'Excel', samples: 1, p95Ms: 1000, maximumDurationMs: 2000, concurrentJobs: 5, units: 100000, maximumBytes: 10_000_000, byteLimit: 100 * 1024 * 1024, partialArtifacts: 0 },
    { name: 'PDF', samples: 1, p95Ms: 1000, maximumDurationMs: 2000, concurrentJobs: 2, units: 500, maximumBytes: 5_000_000, byteLimit: 50 * 1024 * 1024, partialArtifacts: 0 },
  ] },
}[name]);
const command = (name, exitCode = 0, identity = candidateIdentity()) => ({
  name,
  command: process.execPath,
  args: ['-e', `console.log(${JSON.stringify(JSON.stringify((() => {
    const artifact = { schemaVersion: 1, contract: 'PERSONNEL_PERFORMANCE_ACCEPTANCE_LANE_V1', lane: name,
      status: 'PASS', productionActivationAuthorized: false,
      candidateIdentityHash: createHash('sha256').update(canonical(identity)).digest('hex'),
      observedAt: new Date().toISOString(), durationMs: 1, command: 'independent acceptance fixture',
      rawEvidenceHash: '9'.repeat(64), measurements: measurementsFor(name) };
    return { ...artifact, measurementAttestation: { keyId: measurementPublicKey.keyId, algorithm: 'Ed25519',
      signature: sign(null, Buffer.from(canonical(artifact)), keys.privateKey).toString('base64') } };
  })()))});process.exit(${exitCode})`],
});
const greenChecks = () => [
  command('integrated-regression'), command('twelve-races'), command('failure-recovery'),
  command('permission-nondisclosure'), command('browser-matrix'), command('export-capacity'),
];
const trust = { measurementPublicKey, candidatePublicKey, handoffSigner };

test('collector trust roots come from independent environment configuration', () => {
  const encoded = (key, type) => key.export({ format: 'der', type }).toString('base64');
  const configured = performanceAcceptanceTrustFromEnvironment({
    PERFORMANCE_MEASUREMENT_ATTESTATION_KEY_ID: measurementPublicKey.keyId,
    PERFORMANCE_MEASUREMENT_ATTESTATION_PUBLIC_KEY_BASE64: encoded(keys.publicKey, 'spki'),
    PERFORMANCE_CANDIDATE_ATTESTATION_KEY_ID: candidatePublicKey.keyId,
    PERFORMANCE_CANDIDATE_ATTESTATION_PUBLIC_KEY_BASE64: encoded(candidateKeys.publicKey, 'spki'),
    PERFORMANCE_HANDOFF_ATTESTATION_KEY_ID: handoffSigner.keyId,
    PERFORMANCE_HANDOFF_ATTESTATION_PRIVATE_KEY_BASE64: encoded(handoffKeys.privateKey, 'pkcs8'),
  });
  assert.equal(configured.measurementPublicKey.keyId, measurementPublicKey.keyId);
  assert.equal(configured.candidatePublicKey.keyId, candidatePublicKey.keyId);
  assert.equal(configured.handoffSigner.keyId, handoffSigner.keyId);
  assert.deepEqual(performanceAcceptanceTrustFromEnvironment({
    PERFORMANCE_MEASUREMENT_ATTESTATION_KEY_ID: 'fixture-key',
    PERFORMANCE_MEASUREMENT_ATTESTATION_PUBLIC_KEY_BASE64: encoded(keys.publicKey, 'spki'),
  }), { measurementPublicKey: null, candidatePublicKey: null, handoffSigner: null });
});

test('a stable candidate with green nondeferred lanes is ready for independent QA, not promotion', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const report = await runPerformanceAcceptance({
      directory,
      ...trust,
      identity: async () => candidateIdentity(),
      checks: greenChecks(),
    });
    assert.equal(report.status, 'PASS_WITH_DEFERRALS');
    assert.equal(report.candidateHandoffReady, true);
    assert.equal(report.independentQaAuthorized, true);
    assert.equal(report.promotionDecision, 'BLOCKED_DEFERRED_INPUTS');
    assert.equal(report.productionActivationAuthorized, false);
    assert.deepEqual(report.deferrals.map(({ status }) => status), ['DEFERRED', 'DEFERRED', 'DEFERRED']);
    assert.ok(report.checks.every(({ status, outputHash }) => status === 'PASS' && /^[a-f0-9]{64}$/.test(outputHash)));
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')), report);
    assert.equal(report.evidenceJournalHash, createHash('sha256').update(await readFile(path.join(directory, 'events.ndjson'))).digest('hex'));
    const { handoffAttestation, ...unsignedReport } = report;
    assert.equal(verify(null, Buffer.from(canonical(unsignedReport)), handoffKeys.publicKey,
      Buffer.from(handoffAttestation.signature, 'base64')), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a failed nondeferred lane is retained and blocks candidate handoff', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const report = await runPerformanceAcceptance({
      directory,
      ...trust,
      identity: async () => candidateIdentity(),
      checks: greenChecks().map((check) => check.name === 'twelve-races' ? command(check.name, 7) : check),
    });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.candidateHandoffReady, false);
    assert.deepEqual(report.checks.map(({ name, status, exitCode }) => [name, status, exitCode]), [
      ['integrated-regression', 'PASS', 0], ['twelve-races', 'FAIL', 7],
      ['failure-recovery', 'PASS', 0], ['permission-nondisclosure', 'PASS', 0],
      ['browser-matrix', 'PASS', 0], ['export-capacity', 'PASS', 0],
    ]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a candidate identity change blocks otherwise green evidence', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  let identityRead = 0;
  try {
    const report = await runPerformanceAcceptance({
      directory,
      ...trust,
      identity: async () => candidateIdentity({ sourceHash: identityRead++ ? '0'.repeat(64) : 'b'.repeat(64) }),
      checks: greenChecks(),
    });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.candidateHandoffReady, false);
    assert.deepEqual(report.blockers, ['CANDIDATE_CHANGED']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('candidate handoff records missing, duplicate, or unknown acceptance lanes as blocking evidence', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const identity = async () => candidateIdentity();
    const missing = await runPerformanceAcceptance({ directory: path.join(directory, 'missing'), identity, ...trust, checks: greenChecks().slice(1) });
    assert.equal(missing.status, 'BLOCKED');
    assert.ok(missing.blockers.includes('ACCEPTANCE_LANES_INCOMPLETE'));
    assert.equal(missing.checks.find(({ name }) => name === 'integrated-regression').status, 'ABSENT');
    const duplicate = await runPerformanceAcceptance({ directory: path.join(directory, 'duplicate'), identity, ...trust,
      checks: [...greenChecks(), command('twelve-races')] });
    assert.equal(duplicate.status, 'BLOCKED');
    const unknown = await runPerformanceAcceptance({ directory: path.join(directory, 'unknown'), identity, ...trust,
      checks: [...greenChecks().slice(0, -1), command('made-up')] });
    assert.equal(unknown.status, 'BLOCKED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a signed PASS label with incomplete measurements is rejected', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const checks = greenChecks();
    const invalid = command('twelve-races');
    const encoded = JSON.parse(invalid.args[1].match(/console\.log\((.*)\);process/s)[1]);
    const artifact = JSON.parse(encoded);
    const { measurementAttestation: _old, ...unsigned } = artifact;
    unsigned.measurements.races = unsigned.measurements.races.slice(1);
    artifact.measurements = unsigned.measurements;
    artifact.measurementAttestation.signature = sign(null, Buffer.from(canonical(unsigned)), keys.privateKey).toString('base64');
    invalid.args = ['-e', `console.log(${JSON.stringify(JSON.stringify(artifact))})`];
    checks[1] = invalid;
    const report = await runPerformanceAcceptance({ directory, checks, ...trust,
      identity: async () => candidateIdentity() });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.checks[1].reason, 'INVALID_LANE_RESULT');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a zero exit without a valid lane result cannot become acceptance evidence', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const checks = greenChecks();
    checks[0] = { name: 'integrated-regression', command: process.execPath, args: ['-e', "console.log('{}')"] };
    const report = await runPerformanceAcceptance({ directory, checks, ...trust,
      identity: async () => candidateIdentity() });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.checks[0].status, 'FAIL');
    assert.equal(report.checks[0].reason, 'INVALID_LANE_RESULT');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unattested or incomplete runtime identity blocks a green handoff', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const report = await runPerformanceAcceptance({ directory, checks: greenChecks(), ...trust,
      identity: async () => ({ commit: 'a'.repeat(40), sourceHash: 'b'.repeat(64), runtimeSourceBinding: 'NOT_ATTESTED' }) });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.candidateHandoffReady, false);
    assert.ok(report.blockers.includes('CANDIDATE_IDENTITY_UNATTESTED'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an unavailable initial identity is retained as a blocked final report', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  let reads = 0;
  try {
    const report = await runPerformanceAcceptance({ directory, checks: greenChecks(), ...trust,
      identity: async () => { if (reads++ === 0) throw new Error('identity unavailable'); return candidateIdentity(); } });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.candidateHandoffReady, false);
    assert.ok(report.blockers.includes('CANDIDATE_IDENTITY_UNAVAILABLE'));
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8')), report);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a forged lane result cannot become acceptance evidence', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const checks = greenChecks();
    const forged = JSON.parse(checks[0].args[1].match(/console\.log\((.*)\);process/s)[1]);
    const artifact = JSON.parse(forged);
    artifact.measurementAttestation.signature = Buffer.alloc(64).toString('base64');
    checks[0].args = ['-e', `console.log(${JSON.stringify(JSON.stringify(artifact))})`];
    const report = await runPerformanceAcceptance({ directory, checks, ...trust,
      identity: async () => candidateIdentity() });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.checks[0].reason, 'INVALID_LANE_RESULT');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
