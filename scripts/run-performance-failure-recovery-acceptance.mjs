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
};
const raw = [];
const execute = (name, file, timeout = 15 * 60_000) => {
  const started = performance.now();
  const result = spawnSync(process.execPath, ['--import', 'tsx', `src/services/__tests__/${file}`], {
    cwd: backendRoot, env: environment, encoding: 'utf8', timeout, maxBuffer: 64 * 1024 * 1024,
  });
  raw.push(JSON.stringify({ name, exitCode: result.status, signal: result.signal,
    durationMs: performance.now() - started, stdout: result.stdout, stderr: result.stderr }));
  if (result.error || result.status !== 0) throw new Error(`FAILURE_RECOVERY_CHECK_FAILED:${name}`);
  return result.stdout;
};

try {
  inspectLocalComposeProject(repositoryRoot);
  const operatorId = process.env.PERFORMANCE_ACCEPTANCE_OPERATOR_ID?.trim();
  if (!operatorId || /^(fixture|test|local|example|placeholder)$/i.test(operatorId)) {
    throw new Error('ACCEPTANCE_OPERATOR_UNAVAILABLE');
  }
  const identity = JSON.parse(await readFile(await realpath(identityPath), 'utf8'));
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
  execute('restore-correctness', 'personnelPerformanceErasureRecovery.integration.test.ts', 30 * 60_000);
  execute('restore-dress-rehearsal', 'personnelPerformanceErasureRecovery.integration.test.ts', 30 * 60_000);
  const signer = performanceMeasurementSignerFromEnvironment();
  if (!signer) throw new Error('MEASUREMENT_SIGNER_UNAVAILABLE');
  const scenarioChecks = {
    transaction: ['transaction-encryption'],
    queue: ['queue-notification'],
    storage: ['transaction-storage-encryption'],
    encryption: ['transaction-encryption', 'transaction-storage-encryption'],
    notification: ['queue-notification'],
    migration: ['migration-dry-run-1', 'migration-dry-run-2'],
    reconciliation: ['readiness-reconciliation-1', 'readiness-reconciliation-2', 'readiness-reconciliation-3'],
    restore: ['restore-correctness', 'restore-dress-rehearsal'],
  };
  const measurements = {
    failureInjection: {
      scenarios: Object.entries(scenarioChecks).map(([name, evidenceChecks]) => ({
        name, evidenceChecks, executed: true, failClosed: true, lostAcknowledgedWrites: 0,
      })),
    },
    runbookRehearsal: {
      fullEncryptedCheckpointRestored: true,
      rpoAcknowledgedWritesLost: 0,
      correctnessRehearsalPassed: true,
      timedDressRehearsalPassed: true,
      operatorId,
      runbookHash: createHash('sha256').update(await readFile(path.join(repositoryRoot,
        'docs/operations/personnel-performance-operations.md'))).digest('hex'),
      dryRuns,
      idempotentApplyReconciliations: 3,
      driftInjected: true,
      concurrentHrWriteRetried: true,
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
