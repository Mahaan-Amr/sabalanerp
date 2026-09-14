import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { inspectLocalComposeProject } from './design-system-e2e-preflight.mjs';
import { performanceMeasurementSignerFromEnvironment, signedPerformanceAcceptanceLane } from './performance-acceptance-artifact.mjs';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const identityPath = value('--identity');
if (args.length !== 2 || !identityPath) {
  console.error('Usage: node scripts/run-performance-failure-recovery-acceptance.mjs --identity /absolute/candidate.json');
  process.exit(2);
}

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const backendRoot = path.join(repositoryRoot, 'backend');
const databaseUrl = 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=4&pool_timeout=10';
const environment = {
  ...process.env,
  DATABASE_URL: databaseUrl,
  NODE_ENV: 'test',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'local-development-v1',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: 'cGVyZi1sb2NhbC0wMTIzNDU2Nzg5YWJjZGVmLXYxISE=',
  PERFORMANCE_ACCEPTANCE_INJECT_MIGRATION_FAILURE: '1',
  PERFORMANCE_ACCEPTANCE_FAILURE_RECOVERY: '1',
};
const raw = [];
const observations = [];
const execute = (name, file, timeout = 15 * 60_000, environmentOverrides = {}) => {
  const started = performance.now();
  const result = spawnSync(process.execPath, ['--import', 'tsx', `src/services/__tests__/${file}`], {
    cwd: backendRoot, env: { ...environment, ...environmentOverrides }, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024,
  });
  raw.push(JSON.stringify({ name, exitCode: result.status, signal: result.signal,
    durationMs: performance.now() - started, stdout: result.stdout, stderr: result.stderr }));
  if (result.error || result.status !== 0) throw new Error(`FAILURE_RECOVERY_CHECK_FAILED:${name}`);
  const markers = result.stdout.split(/\r?\n/).filter((line) => line.startsWith('PERFORMANCE_FAILURE_RECOVERY:'));
  if (markers.length !== 1) throw new Error(`FAILURE_RECOVERY_EVIDENCE_COUNT_INVALID:${name}`);
  let marker;
  try { marker = JSON.parse(markers[0].slice('PERFORMANCE_FAILURE_RECOVERY:'.length)); } catch { marker = null; }
  if (marker?.contract !== 'PERSONNEL_PERFORMANCE_FAILURE_RECOVERY_V1' || !Array.isArray(marker.scenarios)) {
    throw new Error(`FAILURE_RECOVERY_EVIDENCE_INVALID:${name}`);
  }
  for (const scenario of marker.scenarios) {
    if (typeof scenario?.name !== 'string' || scenario.injected !== true || scenario.failClosed !== true
      || scenario.lostAcknowledgedWrites !== 0) throw new Error(`FAILURE_RECOVERY_SCENARIO_INVALID:${name}`);
  }
  observations.push({ check: name, marker });
  return result.stdout;
};

try {
  inspectLocalComposeProject(repositoryRoot);
  const operatorId = process.env.PERFORMANCE_ACCEPTANCE_OPERATOR_ID?.trim();
  if (!operatorId || /^(fixture|test|local|example|placeholder)$/i.test(operatorId)) {
    throw new Error('ACCEPTANCE_OPERATOR_UNAVAILABLE');
  }
  const identity = JSON.parse(await readFile(await realpath(identityPath), 'utf8'));
  const runbookHash = createHash('sha256').update(await readFile(path.join(repositoryRoot,
    'docs/operations/personnel-performance-operations.md'))).digest('hex');
  const started = performance.now();
  const dryRunOutputs = [
    execute('migration-dry-run-1', 'dispatchDocumentsCandidateSchema.integration.test.ts'),
    execute('migration-dry-run-2', 'dispatchDocumentsCandidateSchema.integration.test.ts'),
  ];
  const dryRuns = dryRunOutputs.map((output) => {
    if (!output.includes('PERFORMANCE_FAILURE_INJECTION:migration:PASS')) {
      throw new Error('MIGRATION_FAILURE_INJECTION_EVIDENCE_MISSING');
    }
    const row = output.split(/\r?\n/).map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    }).find((item) => item?.candidateMigrationHash);
    if (!row || !Number.isInteger(row.candidateMigrations) || !/^[a-f0-9]{64}$/.test(row.candidateMigrationHash)) {
      throw new Error('MIGRATION_DRY_RUN_EVIDENCE_MISSING');
    }
    return { count: row.candidateMigrations, hash: row.candidateMigrationHash };
  });
  if (dryRuns[0].count !== dryRuns[1].count || dryRuns[0].hash !== dryRuns[1].hash) {
    throw new Error('MIGRATION_DRY_RUN_MISMATCH');
  }
  execute('transaction-encryption', 'personnelPerformanceWorkflow.integration.test.ts');
  for (let run = 1; run <= 3; run += 1) execute(`readiness-reconciliation-${run}`,
    'personnelPerformanceReadinessCoverage.integration.test.ts');
  execute('transaction-storage-encryption', 'personnelPerformanceErasure.integration.test.ts');
  execute('queue-notification', 'personnelPerformanceMonitoring.integration.test.ts');
  execute('restore-correctness', 'personnelPerformanceErasureRecovery.integration.test.ts', 30 * 60_000, {
    PERFORMANCE_ACCEPTANCE_RESTORE_REHEARSAL_MODE: 'correctness',
    PERFORMANCE_ACCEPTANCE_OPERATOR_ID: operatorId,
  });
  execute('restore-dress-rehearsal', 'personnelPerformanceErasureRecovery.integration.test.ts', 30 * 60_000, {
    PERFORMANCE_ACCEPTANCE_RESTORE_REHEARSAL_MODE: 'timed-dress',
    PERFORMANCE_ACCEPTANCE_OPERATOR_ID: operatorId,
  });
  const signer = performanceMeasurementSignerFromEnvironment();
  if (!signer) throw new Error('MEASUREMENT_SIGNER_UNAVAILABLE');
  const scenarioChecks = {
    transaction: ['transaction-encryption'],
    queue: ['queue-notification'],
    storage: ['transaction-storage-encryption'],
    encryption: ['transaction-encryption'],
    notification: ['queue-notification'],
    migration: ['migration-dry-run-1', 'migration-dry-run-2'],
    reconciliation: ['readiness-reconciliation-1', 'readiness-reconciliation-2', 'readiness-reconciliation-3'],
    restore: ['restore-correctness', 'restore-dress-rehearsal'],
  };
  const scenarioEvidence = Object.entries(scenarioChecks).map(([name, evidenceChecks]) => {
    const matching = observations.filter(({ check, marker }) => evidenceChecks.includes(check)
      && marker.scenarios.some((scenario) => scenario.name === name));
    if (matching.length !== evidenceChecks.length || matching.some(({ marker }) => marker.scenarios
      .filter((scenario) => scenario.name === name).length !== 1)) throw new Error(`FAILURE_RECOVERY_SCENARIO_MISSING:${name}`);
    return { name, evidenceChecks, executed: matching.every(({ marker }) => marker.scenarios
      .some((scenario) => scenario.name === name && scenario.injected === true)),
    failClosed: matching.every(({ marker }) => marker.scenarios
      .some((scenario) => scenario.name === name && scenario.failClosed === true)),
    lostAcknowledgedWrites: Math.max(...matching.map(({ marker }) => marker.scenarios
      .find((scenario) => scenario.name === name).lostAcknowledgedWrites)) };
  });
  const readinessRehearsals = observations.filter(({ check }) => check.startsWith('readiness-reconciliation-'))
    .map(({ marker }) => marker.rehearsal);
  const restoreRehearsals = observations.filter(({ check }) => check.startsWith('restore-'))
    .map(({ marker }) => marker.rehearsal);
  if (readinessRehearsals.length !== 3 || readinessRehearsals.some((item) => item?.idempotentApplyReconciliations !== 1
    || item.driftInjected !== true || item.concurrentHrWriteRetried !== true)
    || restoreRehearsals.length !== 2
    || restoreRehearsals[0]?.rehearsalMode !== 'correctness'
    || restoreRehearsals[0]?.correctnessRehearsalPassed !== true
    || restoreRehearsals[0]?.timedDressRehearsalPassed !== false
    || restoreRehearsals[1]?.rehearsalMode !== 'timed-dress'
    || restoreRehearsals[1]?.correctnessRehearsalPassed !== false
    || restoreRehearsals[1]?.timedDressRehearsalPassed !== true
    || restoreRehearsals.some((item) => item?.fullEncryptedCheckpointRestored !== true
      || item.encryptedCheckpointVerified !== true || item.independentCopy !== true
      || item.rpoAcknowledgedWritesLost !== 0 || item.operatorId !== operatorId
      || item.runbookHash !== runbookHash || !Number.isFinite(item.durationMs) || item.durationMs <= 0
      || !/^[a-f0-9]{64}$/.test(item.checkpointChecksum)
      || item.sourceDatabase === item.restoredDatabase)) throw new Error('FAILURE_RECOVERY_REHEARSAL_EVIDENCE_INVALID');
  const measurements = {
    failureInjection: {
      scenarios: scenarioEvidence,
    },
    runbookRehearsal: {
      fullEncryptedCheckpointRestored: restoreRehearsals.every((item) => item.fullEncryptedCheckpointRestored),
      rpoAcknowledgedWritesLost: Math.max(...restoreRehearsals.map((item) => item.rpoAcknowledgedWritesLost)),
      correctnessRehearsalPassed: restoreRehearsals[0].correctnessRehearsalPassed,
      timedDressRehearsalPassed: restoreRehearsals[1].timedDressRehearsalPassed,
      operatorId,
      runbookHash,
      dryRuns,
      idempotentApplyReconciliations: readinessRehearsals.reduce((sum, item) => sum + item.idempotentApplyReconciliations, 0),
      driftInjected: readinessRehearsals.every((item) => item.driftInjected),
      concurrentHrWriteRetried: readinessRehearsals.every((item) => item.concurrentHrWriteRetried),
    },
  };
  console.log(JSON.stringify(signedPerformanceAcceptanceLane({
    lane: 'failure-recovery', identity,
    command: 'node scripts/run-performance-failure-recovery-acceptance.mjs --identity <candidate>',
    durationMs: performance.now() - started, rawEvidence: raw.join('\n'), measurements, signer,
  })));
} catch (error) {
  console.error('Failure and recovery acceptance failed closed; no lane evidence was issued.',
    error instanceof Error ? error.message : 'UNKNOWN_ERROR');
  process.exitCode = 1;
}
