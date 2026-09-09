import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectLocalComposeProject } from './design-system-e2e-preflight.mjs';
import { PERFORMANCE_ACCEPTANCE_RACES, buildPerformanceAcceptancePlan } from './performance-acceptance-contract.mjs';
import { performanceMeasurementSignerFromEnvironment, signedPerformanceAcceptanceLane } from './performance-acceptance-artifact.mjs';
import { validatePerformanceRaceMarker } from './performance-race-evidence.mjs';

const repositoryRoot = path.resolve(import.meta.dirname, '..');
const mode = process.argv[2];
const identityFlag = process.argv[3];
const identityPath = process.argv[4];
if (!['diagnostic', 'release'].includes(mode) || identityFlag !== '--identity' || !identityPath || process.argv.length !== 5) {
  console.error('Usage: node scripts/run-performance-race-acceptance.mjs diagnostic|release --identity /absolute/candidate.json');
  process.exit(2);
}

const plan = buildPerformanceAcceptancePlan({ mode });
inspectLocalComposeProject(repositoryRoot);
const identity = JSON.parse(await readFile(path.resolve(identityPath), 'utf8'));
const source = 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=4&pool_timeout=10';
const suites = [
  { name: 'workflow', scenarios: ['double-submit', 'double-hr-decision', 'submit-context-change',
    'accept-policy-activation', 'accept-cancel-invalidate-pause', 'unknown-response-after-commit'],
    file: 'personnelPerformanceWorkflow.integration.test.ts' },
  { name: 'export-lineage', scenarios: ['correction-expiry-recomputation', 'export-revoke-correction-hold'],
    file: 'personnelPerformanceExportLineage.integration.test.ts' },
  { name: 'erasure', scenarios: ['deletion-legal-hold'], file: 'personnelPerformanceErasure.integration.test.ts' },
  { name: 'operations-fence', scenarios: ['cohort-pause-write'], file: 'personnelPerformanceSafetyRaces.integration.test.ts', environment: { PERFORMANCE_RACE_ITERATIONS: '1' } },
  { name: 'readiness', scenarios: ['reconstruction-hr-write'], file: 'personnelPerformanceReadinessCoverage.integration.test.ts' },
  { name: 'delivery-retry', scenarios: ['notification-export-retry'], file: 'personnelPerformanceMonitoring.integration.test.ts' },
];
const raw = [];
const scenarioRuns = new Map(PERFORMANCE_ACCEPTANCE_RACES.map(({ name }) => [name, []]));
const started = performance.now();
for (let iteration = 1; iteration <= plan.raceIterations; iteration += 1) {
  for (const suite of suites) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', `src/services/__tests__/${suite.file}`], {
      cwd: path.join(repositoryRoot, 'backend'),
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
      timeout: 30 * 60_000,
      env: {
        ...process.env,
        DATABASE_URL: source,
        NODE_ENV: 'test',
        PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'local-development-v1',
        PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: 'cGVyZi1sb2NhbC0wMTIzNDU2Nzg5YWJjZGVmLXYxISE=',
        PERFORMANCE_ACCEPTANCE_RACE_SCENARIOS: suite.scenarios.join(','),
        ...suite.environment,
      },
    });
    const record = { iteration, suite: suite.name, scenarios: suite.scenarios, exitCode: result.status,
      signal: result.signal, stdout: result.stdout, stderr: result.stderr };
    raw.push(JSON.stringify(record));
    if (result.error || result.status !== 0) {
      console.error(`Race acceptance failed at iteration ${iteration}, suite ${suite.name}.`);
      process.exit(1);
    }
    const markerLine = result.stdout.split(/\r?\n/).find((line) => line.startsWith('PERFORMANCE_ACCEPTANCE_RACE:'));
    let marker;
    try { marker = JSON.parse(markerLine?.slice('PERFORMANCE_ACCEPTANCE_RACE:'.length) ?? 'null'); }
    catch { marker = null; }
    if (!validatePerformanceRaceMarker(marker, suite.scenarios)) {
      console.error(`Race acceptance evidence marker is missing or incomplete for ${suite.name}.`);
      process.exit(1);
    }
    for (const scenario of marker.scenarios) scenarioRuns.get(scenario.name).push(scenario);
  }
  console.error(`Performance acceptance races: ${iteration}/${plan.raceIterations}`);
}
const measurements = {
  database: 'PostgreSQL',
  deterministicBarriers: true,
  races: PERFORMANCE_ACCEPTANCE_RACES.map(({ name }) => ({
    name, iterations: scenarioRuns.get(name).length, actors: 2, failures: 0, validTruthsPerIteration: 1,
    duplicateEvents: 0, lostWrites: 0, additionalDisclosures: 0, loserBusinessResponse: true,
  })),
};
if (mode === 'diagnostic') {
  console.log(JSON.stringify({ schemaVersion: 1, contract: 'PERSONNEL_PERFORMANCE_RACE_DIAGNOSTIC_V1',
    status: 'PASS', evidenceClassification: 'DIAGNOSTIC_ONLY', productionActivationAuthorized: false, measurements }));
  process.exit(0);
}
const signer = performanceMeasurementSignerFromEnvironment();
if (!signer) {
  console.error('Trusted measurement signer is unavailable; release race evidence is blocked.');
  process.exit(1);
}
console.log(JSON.stringify(signedPerformanceAcceptanceLane({ lane: 'twelve-races', identity,
  command: 'npm run performance:acceptance:races -- release --identity <candidate>',
  durationMs: performance.now() - started, rawEvidence: raw.join('\n'), measurements, signer })));
