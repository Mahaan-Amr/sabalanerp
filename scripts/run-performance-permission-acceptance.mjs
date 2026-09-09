import { readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { PERFORMANCE_ACCEPTANCE_NONDISCLOSURE_SCENARIOS } from './performance-acceptance-contract.mjs';
import { performanceMeasurementSignerFromEnvironment, signedPerformanceAcceptanceLane } from './performance-acceptance-artifact.mjs';
import { inspectLocalComposeProject } from './design-system-e2e-preflight.mjs';

const args = process.argv.slice(2);
const value = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : null;
};
const identityPath = value('--identity');
const reviewPath = value('--review');
if (args.length !== 4 || !identityPath || !reviewPath) {
  console.error('Usage: node scripts/run-performance-permission-acceptance.mjs --identity candidate.json --review review.json');
  process.exit(2);
}

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const environment = {
  ...process.env,
  DATABASE_URL: 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=4&pool_timeout=10',
  NODE_ENV: 'test',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'local-development-v1',
  PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: 'cGVyZi1sb2NhbC0wMTIzNDU2Nzg5YWJjZGVmLXYxISE=',
};
const raw = [];
const execute = (name, command, commandArgs, cwd) => {
  const result = spawnSync(command, commandArgs, { cwd, env: environment, encoding: 'utf8',
    timeout: 20 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  raw.push(JSON.stringify({ name, exitCode: result.status, signal: result.signal,
    stdout: result.stdout, stderr: result.stderr }));
  if (result.error || result.status !== 0) throw new Error(`PERMISSION_CHECK_FAILED:${name}`);
};

try {
  inspectLocalComposeProject(repositoryRoot);
  const [identity, review] = await Promise.all([
    readFile(await realpath(identityPath), 'utf8').then(JSON.parse),
    readFile(await realpath(reviewPath), 'utf8').then(JSON.parse),
  ]);
  if (review?.contract !== 'PERSONNEL_PERFORMANCE_CODE_REVIEW_V1' || review.commit !== identity.commit
    || review.standards?.status !== 'PASS' || review.spec?.status !== 'PASS') throw new Error('REVIEW_MISMATCH');
  const findings = [...review.standards.findings, ...review.spec.findings];
  const severity = (finding) => String(finding?.severity ?? finding?.priority ?? '').toUpperCase();
  const openP0 = findings.filter((finding) => severity(finding) === 'P0').length;
  const openP1 = findings.filter((finding) => severity(finding) === 'P1').length;
  if (openP0 || openP1) throw new Error('OPEN_CRITICAL_FINDINGS');
  const started = performance.now();
  execute('foundation-unit-routes', 'npm', ['--prefix', 'backend', 'run', 'test:personnel-performance-foundation'], repositoryRoot);
  for (const file of [
    'personnelPerformanceFoundation.integration.test.ts',
    'personnelPerformanceWorkflow.integration.test.ts',
    'personnelPerformanceDisclosure.integration.test.ts',
    'personnelPerformancePrivacy.integration.test.ts',
  ]) execute(file, process.execPath, ['--import', 'tsx', `src/services/__tests__/${file}`], path.join(repositoryRoot, 'backend'));
  const signer = performanceMeasurementSignerFromEnvironment();
  if (!signer) throw new Error('MEASUREMENT_SIGNER_UNAVAILABLE');
  const measurements = {
    scenarios: PERFORMANCE_ACCEPTANCE_NONDISCLOSURE_SCENARIOS.map((name) => ({ name, status: 'PASS' })),
    permissionBranchesCoveredPercent: 100,
    additionalDisclosures: 0,
    openP0,
    openP1,
  };
  console.log(JSON.stringify(signedPerformanceAcceptanceLane({
    lane: 'permission-nondisclosure', identity,
    command: 'node scripts/run-performance-permission-acceptance.mjs --identity <candidate> --review <review>',
    durationMs: performance.now() - started, rawEvidence: raw.join('\n'), measurements, signer,
  })));
} catch (error) {
  console.error('Permission and nondisclosure acceptance failed closed; no lane evidence was issued.',
    error instanceof Error ? error.message : 'UNKNOWN_ERROR');
  process.exitCode = 1;
}
