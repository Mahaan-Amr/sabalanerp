import { readFile, realpath } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { assertHttpReady, inspectLocalComposeProject } from './design-system-e2e-preflight.mjs';
import { performanceMeasurementSignerFromEnvironment, signedPerformanceAcceptanceLane } from './performance-acceptance-artifact.mjs';
import { PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES } from './performance-acceptance-contract.mjs';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--identity') {
  console.error('Usage: node scripts/run-performance-browser-acceptance.mjs --identity /absolute/candidate.json');
  process.exit(2);
}
const repositoryRoot = path.resolve(import.meta.dirname, '..');
const backendRoot = path.join(repositoryRoot, 'backend');
const databaseUrl = 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
let fixture;
try {
  inspectLocalComposeProject(repositoryRoot);
  await assertHttpReady('http://127.0.0.1:5000/api/ready', 'sabalanerp-local backend');
  await assertHttpReady('http://127.0.0.1:3000/login', 'sabalanerp-local frontend');
  const identity = JSON.parse(await readFile(await realpath(args[1]), 'utf8'));
  const setup = spawnSync(process.execPath, ['--import', 'tsx',
    'src/services/__tests__/performanceAcceptanceBrowserFixture.ts', 'setup'], {
    cwd: backendRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 60_000,
  });
  const fixtureLine = setup.stdout.split(/\r?\n/).find((line) => line.startsWith('PERFORMANCE_BROWSER_FIXTURE:'));
  fixture = JSON.parse(fixtureLine?.slice('PERFORMANCE_BROWSER_FIXTURE:'.length) ?? 'null');
  if (setup.error || setup.status !== 0 || !fixture?.runId || !fixture?.accounts) {
    throw new Error('BROWSER_FIXTURE_SETUP_FAILED');
  }
  const started = performance.now();
  const result = spawnSync(process.execPath, [path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js'),
    'test', '--config=playwright.performance-acceptance.config.ts'], {
    cwd: repositoryRoot, env: { ...process.env, DESIGN_SYSTEM_E2E_BASE_URL: 'http://127.0.0.1:3000',
      PERFORMANCE_BROWSER_ACCOUNTS_JSON: JSON.stringify(fixture.accounts) },
    encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error('BROWSER_MATRIX_FAILED');
  }
  const markerLine = result.stdout.split(/\r?\n/).find((line) => line.includes('PERFORMANCE_BROWSER_MATRIX:'));
  const marker = JSON.parse(markerLine?.slice(markerLine.indexOf('PERFORMANCE_BROWSER_MATRIX:')
    + 'PERFORMANCE_BROWSER_MATRIX:'.length) ?? 'null');
  if (!marker || marker.viewports?.length !== 5
    || !Array.isArray(marker.securityNegativeMatrix)
    || marker.securityNegativeMatrix.length !== PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES.length
    || PERFORMANCE_ACCEPTANCE_BROWSER_SECURITY_NEGATIVES.some((name) => !marker.securityNegativeMatrix.includes(name))) {
    throw new Error('BROWSER_MATRIX_EVIDENCE_MISSING');
  }
  const signer = performanceMeasurementSignerFromEnvironment();
  if (!signer) throw new Error('MEASUREMENT_SIGNER_UNAVAILABLE');
  console.log(JSON.stringify(signedPerformanceAcceptanceLane({
    lane: 'browser-matrix', identity,
    command: 'node scripts/run-performance-browser-acceptance.mjs --identity <candidate>',
    durationMs: performance.now() - started, rawEvidence: `${result.stdout}\n${result.stderr}`,
    measurements: marker, signer,
  })));
} catch (error) {
  console.error('Browser acceptance failed closed; no lane evidence was issued.',
    error instanceof Error ? error.message : 'UNKNOWN_ERROR');
  process.exitCode = 1;
} finally {
  if (fixture?.runId) {
    const cleanup = spawnSync(process.execPath, ['--import', 'tsx',
    'src/services/__tests__/performanceAcceptanceBrowserFixture.ts', 'cleanup', '--run-id', fixture.runId], {
      cwd: backendRoot, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', timeout: 60_000,
    });
    if (cleanup.error || cleanup.status !== 0) {
      console.error('Browser acceptance fixture cleanup failed.');
      process.exitCode = 1;
    }
  }
}
