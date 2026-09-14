import { readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { inspectLocalComposeProject } from './design-system-e2e-preflight.mjs';
import { performanceMeasurementSignerFromEnvironment, signedPerformanceAcceptanceLane } from './performance-acceptance-artifact.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--identity') {
  console.error('Usage: node scripts/run-performance-export-capacity-acceptance.mjs --identity /absolute/candidate.json');
  process.exit(2);
}
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const backendRoot = path.join(repositoryRoot, 'backend');
const environment = {
  ...process.env,
  DATABASE_URL: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=4&pool_timeout=10',
  NODE_ENV: 'test',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'local-development-v1',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: 'cGVyZi1sb2NhbC0wMTIzNDU2Nzg5YWJjZGVmLXYxISE=',
  PERFORMANCE_ACCEPTANCE_EXPORT_TIMINGS: '1',
};
const percentile = (values, ratio) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * ratio) - 1];
const marker = (output, prefix) => {
  const line = output.split(/\r?\n/).find((item) => item.includes(prefix));
  return JSON.parse(line?.slice(line.indexOf(prefix) + prefix.length) ?? 'null');
};

try {
  inspectLocalComposeProject(repositoryRoot);
  const identity = JSON.parse(await readFile(await realpath(args[1]), 'utf8'));
  const started = performance.now();
  const timings = spawnSync(process.execPath, ['--import', 'tsx', 'src/services/__tests__/personnelPerformanceExportLineage.integration.test.ts'], {
    cwd: backendRoot, env: environment, encoding: 'utf8', timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024,
  });
  if (timings.error || timings.status !== 0) throw new Error('EXPORT_TIMING_FAILED');
  const workload = spawnSync(process.execPath, ['--import', 'tsx', 'src/services/__tests__/performanceExportCapacity.workload.ts'], {
    cwd: backendRoot, env: environment, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024,
  });
  if (workload.error || workload.status !== 0) throw new Error('EXPORT_CAPACITY_FAILED');
  const timingEvidence = marker(timings.stdout, 'PERFORMANCE_EXPORT_REQUEST_TIMINGS:');
  const capacityEvidence = marker(workload.stdout, 'PERFORMANCE_EXPORT_CAPACITY:');
  if (!timingEvidence?.requestDurationsMs?.length || !timingEvidence?.queueDurationsMs?.length
    || capacityEvidence?.formats?.length !== 2) throw new Error('EXPORT_CAPACITY_EVIDENCE_MISSING');
  const measurements = {
    requestP99Ms: percentile(timingEvidence.requestDurationsMs, 0.99),
    queueP95Ms: percentile(timingEvidence.queueDurationsMs, 0.95),
    formats: capacityEvidence.formats,
  };
  const signer = performanceMeasurementSignerFromEnvironment();
  if (!signer) throw new Error('MEASUREMENT_SIGNER_UNAVAILABLE');
  console.log(JSON.stringify(signedPerformanceAcceptanceLane({
    lane: 'export-capacity', identity,
    command: 'node scripts/run-performance-export-capacity-acceptance.mjs --identity <candidate>',
    durationMs: performance.now() - started,
    rawEvidence: `${timings.stdout}\n${timings.stderr}\n${workload.stdout}\n${workload.stderr}`,
    measurements, signer,
  })));
} catch (error) {
  console.error('Export capacity acceptance failed closed; no lane evidence was issued.',
    error instanceof Error ? error.message : 'UNKNOWN_ERROR');
  process.exitCode = 1;
}
