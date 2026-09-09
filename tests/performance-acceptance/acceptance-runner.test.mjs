import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runPerformanceAcceptance } from '../../scripts/performance-acceptance-runner.mjs';

const posixOnly = { skip: process.platform === 'win32' ? 'Requires POSIX process groups.' : false };
const keys = generateKeyPairSync('ed25519');
const canonical = (value) => JSON.stringify(value, function (_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
});
const measurementPublicKey = { keyId: 'acceptance-runner-v1', publicKey: keys.publicKey };
const command = (name, exitCode = 0, identity = candidateIdentity()) => ({
  name,
  command: process.execPath,
  args: ['-e', `console.log(${JSON.stringify(JSON.stringify((() => {
    const artifact = { schemaVersion: 1, contract: 'PERSONNEL_PERFORMANCE_ACCEPTANCE_LANE_V1', lane: name,
      status: 'PASS', productionActivationAuthorized: false,
      candidateIdentityHash: createHash('sha256').update(canonical(identity)).digest('hex') };
    return { ...artifact, measurementAttestation: { keyId: measurementPublicKey.keyId, algorithm: 'Ed25519',
      signature: sign(null, Buffer.from(canonical(artifact)), keys.privateKey).toString('base64') } };
  })()))});process.exit(${exitCode})`],
});
const greenChecks = () => [
  command('integrated-regression'), command('twelve-races'), command('failure-recovery'),
  command('permission-nondisclosure'), command('browser-matrix'), command('export-capacity'),
];
const candidateIdentity = (changes = {}) => ({
  commit: 'a'.repeat(40), sourceHash: 'b'.repeat(64), schemaHash: 'c'.repeat(64),
  policyHash: 'd'.repeat(64), infrastructureHash: 'e'.repeat(64),
  images: { backend: `sha256:${'1'.repeat(64)}`, frontend: `sha256:${'2'.repeat(64)}`, inquiry: `sha256:${'3'.repeat(64)}` },
  runtimeSourceBinding: { status: 'ATTESTED', evidenceHash: 'f'.repeat(64) },
  ...changes,
});

test('a stable candidate with green nondeferred lanes is ready for independent QA, not promotion', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const report = await runPerformanceAcceptance({
      directory,
      measurementPublicKey,
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
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a failed nondeferred lane is retained and blocks candidate handoff', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const report = await runPerformanceAcceptance({
      directory,
      measurementPublicKey,
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
      measurementPublicKey,
      identity: async () => candidateIdentity({ sourceHash: identityRead++ ? '0'.repeat(64) : 'b'.repeat(64) }),
      checks: greenChecks(),
    });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.candidateHandoffReady, false);
    assert.deepEqual(report.blockers, ['CANDIDATE_CHANGED']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('candidate handoff refuses missing, duplicate, or unknown acceptance lanes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const identity = async () => candidateIdentity();
    await assert.rejects(runPerformanceAcceptance({ directory, identity, measurementPublicKey, checks: greenChecks().slice(1) }), /exact acceptance lanes/);
    await assert.rejects(runPerformanceAcceptance({ directory, identity, measurementPublicKey, checks: [...greenChecks(), command('twelve-races')] }), /exact acceptance lanes/);
    await assert.rejects(runPerformanceAcceptance({ directory, identity, measurementPublicKey, checks: [...greenChecks().slice(0, -1), command('made-up')] }), /exact acceptance lanes/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a zero exit without a valid lane result cannot become acceptance evidence', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const checks = greenChecks();
    checks[0] = { name: 'integrated-regression', command: process.execPath, args: ['-e', "console.log('{}')"] };
    const report = await runPerformanceAcceptance({ directory, checks, measurementPublicKey,
      identity: async () => candidateIdentity() });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.checks[0].status, 'FAIL');
    assert.equal(report.checks[0].reason, 'INVALID_LANE_RESULT');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('unattested or incomplete runtime identity blocks a green handoff', posixOnly, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-acceptance-'));
  try {
    const report = await runPerformanceAcceptance({ directory, checks: greenChecks(), measurementPublicKey,
      identity: async () => ({ commit: 'a'.repeat(40), sourceHash: 'b'.repeat(64), runtimeSourceBinding: 'NOT_ATTESTED' }) });
    assert.equal(report.status, 'BLOCKED');
    assert.equal(report.candidateHandoffReady, false);
    assert.ok(report.blockers.includes('CANDIDATE_IDENTITY_UNATTESTED'));
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
    const report = await runPerformanceAcceptance({ directory, checks, measurementPublicKey,
      identity: async () => candidateIdentity() });
    assert.equal(report.status, 'FAIL');
    assert.equal(report.checks[0].reason, 'INVALID_LANE_RESULT');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
