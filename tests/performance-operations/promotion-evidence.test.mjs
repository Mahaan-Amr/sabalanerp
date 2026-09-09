import { performanceSourceHash } from '../../scripts/performance-source-identity.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validatePromotionMeasurements } from '../../scripts/performance-promotion-measurements.mjs';

test('cohort evidence requires whole-person population counts for every rollout stage', () => {
  const measured = { stage: 'ALL', openP0: 0, openP1: 0, reconciliationMismatches: 0,
    sloPassed: true, hypercareAlertHeartbeatHealthy: true, poolUtilization: 0.5,
    healthyWorkingDays: 10, availableSections: 200, availableAcceptedResults: 100,
    completedSections: 200, acceptedResults: 100, realPilotEvidence: true,
    approvals: ['HUMAN_RESOURCES', 'SECURITY_PRIVACY', 'SYSTEM_OWNER'].map((name) => ({
      name, actorId: `actor-${name}`, decision: 'APPROVE', receiptHash: 'a'.repeat(64),
    })),
  };
  const valid = (changes) => validatePromotionMeasurements('cohort-promotion', { ...measured, ...changes }, new Date().toISOString());
  assert.equal(valid({}), false, 'ALL cannot pass without measured population');
  assert.equal(valid({ readyPopulation: 100, members: 99 }), false, 'ALL must cover the ready population');
  assert.equal(valid({ readyPopulation: 100, members: 100 }), true);
  for (const [stage, members] of [['TEN_PERCENT', 10], ['TWENTY_FIVE_PERCENT', 25], ['FIFTY_PERCENT', 50]]) {
    assert.equal(valid({ stage, readyPopulation: 100, members }), true);
    assert.equal(valid({ stage, readyPopulation: 100, members: members - 1 }), false);
    assert.equal(valid({ stage, readyPopulation: 100, members: 101 }), false);
  }
  assert.equal(valid({ stage: 'PILOT', readyPopulation: 20, members: 10.5 }), false);
  assert.equal(valid({ readyPopulation: 100.5, members: 100.5 }), false);
});

const command = path.resolve('scripts/performance-promotion-evidence.mjs');
test('promotion evidence command rejects absent evidence and writes a blocked report', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-evidence-'));
  try {
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'report.json');
    await writeFile(input, JSON.stringify({ schemaVersion: 1 }));
    const result = spawnSync(process.execPath, [command, '--input', input, '--output', output], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.decision, 'BLOCKED');
    assert.equal(report.productionActivationAuthorized, false);
    assert.equal(report.gates.length, 9);
    assert.ok(report.gates.every((gate) => gate.status === 'BLOCKED'));
    assert.ok(report.blockers.includes('RELEASE_IDENTITY_MISSING'));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('hash-verified matching-release artifacts still require approved measurements', async () => {
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-evidence-'));
  try {
    const release = {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceHash: await performanceSourceHash(), schemaHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), infrastructureHash: 'c'.repeat(64),
      images: { backend: `sha256:${'d'.repeat(64)}`, frontend: `sha256:${'e'.repeat(64)}`, inquiry: `sha256:${'f'.repeat(64)}` },
    };
    const checks = [];
    for (const name of ['policy-weights', 'policy-version-effective-time', 'policy-preview', 'policy-publication-authority', 'policy-snapshot']) {
      const bytes = JSON.stringify({ schemaVersion: 1, release, check: name, status: 'PASS', durationMs: 100,
        observedAt: new Date().toISOString(), command: 'npm run test:personnel-performance-policy', });
      await writeFile(path.join(directory, `${name}.json`), bytes);
      checks.push({ name, path: `${name}.json`, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const input = path.join(directory, 'input.json');
    const output = path.join(directory, 'report.json');
    await writeFile(input, JSON.stringify({ schemaVersion: 1, release, checks }));
    const run = (report) => spawnSync(process.execPath, [command, '--input', input, '--output', report], { encoding: 'utf8' });
    assert.equal(run(output).status, 1, 'other gates remain blocked');
    assert.equal(JSON.parse(await readFile(output, 'utf8')).gates[1].status, 'BLOCKED');
    await writeFile(input, JSON.stringify({ schemaVersion: 1, release: { ...release, sourceHash: '0'.repeat(64) }, checks }));
    const stale = path.join(directory, 'stale.json');
    assert.equal(run(stale).status, 1);
    assert.ok(JSON.parse(await readFile(stale, 'utf8')).blockers.includes('RELEASE_SOURCE_MISMATCH'));
    await writeFile(input, JSON.stringify({ schemaVersion: 1, release, checks }));
    await writeFile(path.join(directory, 'policy-preview.json'), '{}');
    const tampered = path.join(directory, 'tampered.json');
    assert.equal(run(tampered).status, 1);
    assert.equal(JSON.parse(await readFile(tampered, 'utf8')).gates[1].status, 'BLOCKED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a signed report admits an exact target only with approved measurement contracts', async () => {
  const { createHash, createHmac } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-signed-evidence-'));
  try {
    const release = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceHash: await performanceSourceHash(), schemaHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), infrastructureHash: 'c'.repeat(64),
      images: { backend: `sha256:${'d'.repeat(64)}`, frontend: `sha256:${'e'.repeat(64)}`, inquiry: `sha256:${'f'.repeat(64)}` } };
    const target = { phase: 'SCHEMA_PROTECTION', cohortVersionId: 'cohort-exact', cohortStage: 'PILOT', membershipHash: '9'.repeat(64),
      readyPopulation: 10, memberCount: 10 };
    const checks = [];
    for (const name of ['additive-migration', 'permission-matrix', 'encryption', 'audit-lineage', 'retention', 'legal-hold', 'erasure', 'backup-restore']) {
      const observedAt = new Date().toISOString();
      const bytes = JSON.stringify({ schemaVersion: 1, release, check: name, status: 'PASS', durationMs: 10,
        observedAt, command: `acceptance:${name}`, measurements: { contractVersion: 1,
          measurementSource: 'INDEPENDENT_ACCEPTANCE_RUN', runId: `release-run-${name}`, executedBy: 'ci-acceptance-owner',
          rawEvidenceHash: createHash('sha256').update(`raw:${name}`).digest('hex'), environmentHash: release.infrastructureHash,
          sampleCount: 1, assertionsExecuted: 1, failures: 0, skipped: 0, commandExitCode: 0,
          startedAt: new Date(Date.parse(observedAt) - 10).toISOString(), finishedAt: observedAt } });
      await writeFile(path.join(directory, `${name}.json`), bytes);
      checks.push({ name, path: `${name}.json`, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    const validUntil = new Date(Date.now() + 60_000).toISOString();
    await writeFile(path.join(directory, 'input.json'), JSON.stringify({ schemaVersion: 1, release, target, validUntil, checks }));
    const key = Buffer.alloc(32, 17);
    const output = path.join(directory, 'report.json');
    const result = spawnSync(process.execPath, [command, '--input', path.join(directory, 'input.json'), '--output', output], {
      encoding: 'utf8', env: { ...process.env, PERFORMANCE_PROMOTION_ATTESTATION_KEY_ID: 'collector-v1',
        PERFORMANCE_PROMOTION_ATTESTATION_KEY_BASE64: key.toString('base64') },
    });
    assert.equal(result.status, 0);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.decision, 'EVIDENCE_COMPLETE');
    assert.deepEqual(report.target, target);
    assert.deepEqual(report.gates.map(({ status }) => status), ['PASS', ...Array(8).fill('NOT_REQUIRED')]);
    const { attestation, ...unsigned } = report;
    const canonical = (value) => JSON.stringify(value, function (_key, item) {
      return item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item;
    });
    assert.equal(attestation.signature, createHmac('sha256', key).update(canonical(unsigned)).digest('hex'));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('a PASS label cannot replace retirement measurements', async () => {
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-retirement-'));
  try {
    const release = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceHash: await performanceSourceHash(), schemaHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), infrastructureHash: 'c'.repeat(64),
      images: { backend: `sha256:${'d'.repeat(64)}`, frontend: `sha256:${'e'.repeat(64)}`, inquiry: `sha256:${'f'.repeat(64)}` } };
    const artifact = JSON.stringify({ schemaVersion: 1, release, check: 'compatibility-retirement', status: 'PASS',
      durationMs: 100, observedAt: new Date().toISOString(), command: 'measured-retirement-report' });
    await writeFile(path.join(directory, 'retirement.json'), artifact);
    await writeFile(path.join(directory, 'input.json'), JSON.stringify({ schemaVersion: 1, release,
      checks: [{ name: 'compatibility-retirement', path: 'retirement.json', sha256: createHash('sha256').update(artifact).digest('hex') }] }));
    const output = path.join(directory, 'output.json');
    spawnSync(process.execPath, [command, '--input', path.join(directory, 'input.json'), '--output', output]);
    const report = JSON.parse(await readFile(output, 'utf8'));
    assert.equal(report.gates[8].checks.find(({ name }) => name === 'compatibility-retirement').status, 'BLOCKED');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('capacity and race gates require measurements, not a PASS label', async () => {
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-measurements-'));
  try {
    const release = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceHash: await performanceSourceHash(), schemaHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), infrastructureHash: 'c'.repeat(64),
      images: { backend: `sha256:${'d'.repeat(64)}`, frontend: `sha256:${'e'.repeat(64)}`, inquiry: `sha256:${'f'.repeat(64)}` } };
    for (const name of ['capacity-profiles', 'deterministic-races', 'cohort-promotion', 'three-owner-approval', 'failure-injection', 'browser-acceptance', 'export-capacity', 'runbook-rehearsal']) {
      const bytes = JSON.stringify({ schemaVersion: 1, release, check: name, status: 'PASS', durationMs: 1, observedAt: new Date().toISOString(), command: 'acceptance' });
      await writeFile(path.join(directory, 'artifact.json'), bytes);
      await writeFile(path.join(directory, 'input.json'), JSON.stringify({ schemaVersion: 1, release, checks: [{ name, path: 'artifact.json', sha256: createHash('sha256').update(bytes).digest('hex') }] }));
      const output = path.join(directory, `${name}.report.json`);
      spawnSync(process.execPath, [command, '--input', path.join(directory, 'input.json'), '--output', output]);
      const report = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(report.gates.flatMap(({ checks }) => checks).find((check) => check.name === name).status, 'BLOCKED', name);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('retirement accepts complete measurements but rejects 29 healthy days or an open P1', async () => {
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-retirement-measured-'));
  try {
    const release = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      sourceHash: await performanceSourceHash(), schemaHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), infrastructureHash: 'c'.repeat(64),
      images: { backend: `sha256:${'d'.repeat(64)}`, frontend: `sha256:${'e'.repeat(64)}`, inquiry: `sha256:${'f'.repeat(64)}` } };
    const observedAt = new Date().toISOString();
    const daysAgo = (days) => new Date(Date.parse(observedAt) - days * 86400000).toISOString();
    const measurements = { publicActivatedAt: daysAgo(40), continuouslyHealthySince: daysAgo(30),
      allCohortsTransferred: true, legacyConsumers: 0, legacyWriters: 0, reconciliationMismatches: 0, openP0: 0, openP1: 0,
      successfulDeploymentIds: ['deployment-a', 'deployment-b'], successfulRestoreIds: ['restore-a', 'restore-b'],
      approvals: ['HUMAN_RESOURCES', 'SECURITY_PRIVACY', 'SYSTEM_OWNER'].map((name) => ({ name, actorId: `actor-${name}`, decision: 'APPROVE', receiptHash: 'a'.repeat(64) })) };
    for (const [index, change, expected] of [[0, {}, 'PASS'], [1, { continuouslyHealthySince: daysAgo(29) }, 'BLOCKED'], [2, { openP1: 1 }, 'BLOCKED']]) {
      const bytes = JSON.stringify({ schemaVersion: 1, release, check: 'compatibility-retirement', status: 'PASS', durationMs: 100, observedAt,
        command: 'measured-retirement-report', measurements: { ...measurements, ...change } });
      await writeFile(path.join(directory, 'artifact.json'), bytes);
      await writeFile(path.join(directory, 'input.json'), JSON.stringify({ schemaVersion: 1, release, checks: [{ name: 'compatibility-retirement', path: 'artifact.json', sha256: createHash('sha256').update(bytes).digest('hex') }] }));
      const output = path.join(directory, `report-${index}.json`);
      spawnSync(process.execPath, [command, '--input', path.join(directory, 'input.json'), '--output', output]);
      const report = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(report.gates[8].checks.find(({ name }) => name === 'compatibility-retirement').status, expected);
      assert.equal(report.productionActivationAuthorized, false);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('rehearsal requires real hash values before comparing repeated dry-runs', async () => {
  const { createHash } = await import('node:crypto');
  const { execFileSync } = await import('node:child_process');
  const directory = await mkdtemp(path.join(os.tmpdir(), 'performance-rehearsal-'));
  try {
    const release = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), sourceHash: await performanceSourceHash(),
      schemaHash: 'a'.repeat(64), policyHash: 'b'.repeat(64), infrastructureHash: 'c'.repeat(64),
      images: { backend: `sha256:${'d'.repeat(64)}`, frontend: `sha256:${'e'.repeat(64)}`, inquiry: `sha256:${'f'.repeat(64)}` } };
    const measurements = { fullEncryptedCheckpointRestored: true, rpoAcknowledgedWritesLost: 0,
      correctnessRehearsalPassed: true, timedDressRehearsalPassed: true, operatorId: 'operator', runbookHash: true,
      dryRuns: [{ count: 1 }, { count: 1 }], idempotentApplyReconciliations: 3, driftInjected: true, concurrentHrWriteRetried: true };
    for (const [index, values, expected] of [[0, measurements, 'BLOCKED'], [1, { ...measurements, runbookHash: 'a'.repeat(64),
      dryRuns: [{ count: 1, hash: 'b'.repeat(64) }, { count: 1, hash: 'b'.repeat(64) }] }, 'PASS']]) {
      const bytes = JSON.stringify({ schemaVersion: 1, release, check: 'runbook-rehearsal', status: 'PASS', durationMs: 1,
        observedAt: new Date().toISOString(), command: 'rehearsal', measurements: values });
      await writeFile(path.join(directory, 'artifact.json'), bytes);
      await writeFile(path.join(directory, 'input.json'), JSON.stringify({ schemaVersion: 1, release, checks: [{ name: 'runbook-rehearsal', path: 'artifact.json', sha256: createHash('sha256').update(bytes).digest('hex') }] }));
      const output = path.join(directory, `${index}.json`);
      spawnSync(process.execPath, [command, '--input', path.join(directory, 'input.json'), '--output', output]);
      const report = JSON.parse(await readFile(output, 'utf8'));
      assert.equal(report.gates[3].checks.find(({ name }) => name === 'runbook-rehearsal').status, expected);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
