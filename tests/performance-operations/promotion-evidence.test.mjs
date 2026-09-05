import { performanceSourceHash } from '../../scripts/performance-source-identity.mjs';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

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

test('only hash-verified, matching-release check artifacts satisfy a gate', async () => {
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
    assert.equal(JSON.parse(await readFile(output, 'utf8')).gates[1].status, 'PASS');
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
