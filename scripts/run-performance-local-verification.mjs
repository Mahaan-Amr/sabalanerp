import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performanceSourceHash } from './performance-source-identity.mjs';
import { runPerformanceVerification } from './performance-local-verification.mjs';
import { canonicalPerformanceEvidence as canonical } from './performance-evidence-canonical.mjs';

export const performanceDatabaseChecks = (root, environment = process.env) => {
  const iterations = Number(environment.PERFORMANCE_RACE_ITERATIONS ?? '10');
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1000) {
    throw new Error('Invalid local performance race iteration count');
  }
  const source = 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
  const suites = [
    ['shared-client', 'dispatchDocumentsCandidateSchema'],
    ['policy', 'personnelPerformancePolicy'],
    ['workflow', 'personnelPerformanceWorkflow'],
    ['lineage', 'personnelPerformanceExportLineage'],
    ['promotion-race', 'personnelPerformancePromotionEvidenceRace'],
    ['erasure', 'personnelPerformanceErasure'],
    ['erasure-recovery', 'personnelPerformanceErasureRecovery'],
    ['monitoring', 'personnelPerformanceMonitoring'],
    ['safety-races', 'personnelPerformanceSafetyRaces'],
  ];
  return suites.map(([name, suite]) => ({
    name: `performance-${name}-database`, command: process.execPath,
    args: ['--import', 'tsx', `src/services/__tests__/${suite}.integration.test.ts`],
    cwd: path.join(root, 'backend'),
    // Each entry owns a checked, migrated temporary database. The shared-client
    // wrapper redirects foundation/disclosure/operations/privacy before import.
    // Lineage needs gate + worker + observer connections in its isolated client.
    env: {
      DATABASE_URL: name === 'lineage' ? source.replace('connection_limit=2', 'connection_limit=4') : source,
      NODE_ENV: 'test', PERFORMANCE_RACE_ITERATIONS: String(iterations),
      PERFORMANCE_ERASURE_BULK_THRESHOLD: '100',
      PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID: 'local-development-v1',
      PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64: 'cGVyZi1sb2NhbC0wMTIzNDU2Nzg5YWJjZGVmLXYxISE=',
    },
    // Cloning/migrating happens for every iteration; allow that bounded overhead.
    timeoutMs: name === 'safety-races' ? (iterations * 3 + 5) * 60_000 : 30 * 60_000,
  }));
};

const main = async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(root);
  const mode = process.argv[2];
  if (!['unit', 'database', 'all'].includes(mode) || process.argv.length !== 3) {
    console.error('Usage: node scripts/run-performance-local-verification.mjs unit|database|all');
    process.exit(2);
  }
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const command = (name, args) => execFileSync(name, args, { cwd: root, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const composeArgs = ['compose', '-f', path.join(root, 'docker-compose.local.yml')];
  const preflight = () => {
    const output = command('docker', [...composeArgs, 'ps', '--format', 'json']);
    let rows;
    try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
    catch { rows = output.split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
    for (const service of ['postgres', 'backend', 'frontend', 'inquiry']) {
      if (!rows.some((row) => row.Project === 'sabalanerp-local' && row.Service === service
        && row.Name === `sabalanerp-local-${service}-1` && row.State === 'running' && row.Health === 'healthy')) {
        throw new Error('LOCAL_SERVICES_UNAVAILABLE');
      }
    }
  };
  const captureIdentity = async () => {
    const identity = { commit: command('git', ['rev-parse', 'HEAD']), sourceHash: await performanceSourceHash() };
    if (mode === 'unit') return identity;
    const images = {};
    for (const service of ['backend', 'frontend', 'inquiry']) {
      preflight();
      images[service] = command('docker', ['inspect', '--format', '{{.Image}}', `sabalanerp-local-${service}-1`]);
    }
    preflight();
    const metadata = JSON.parse(command('docker', [...composeArgs, 'exec', '-T', 'postgres', 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
      '--username', 'postgres', '--dbname', 'sabalanerp', '--tuples-only', '--no-align', '--command',
      `SELECT json_build_object(
        'migrations', (SELECT json_agg(row_to_json(m) ORDER BY m.migration_name) FROM
          (SELECT migration_name, checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations) m),
        'policies', (SELECT json_agg(row_to_json(p) ORDER BY p."policyKind", p.version) FROM
          (SELECT "policyKind", version, lifecycle, "effectiveFrom", "contentHash" FROM performance_policy_versions) p)
      )`,
    ]));
    return { ...identity, images, appliedMigrationHash: digest(canonical(metadata.migrations)),
      policyMetadataHash: digest(canonical(metadata.policies)),
      composeSourceHash: digest(await readFile('docker-compose.local.yml')),
      runtimeSourceBinding: 'NOT_ATTESTED',
    };
  };

  const checks = [];
  const npmCheck = (name, script, prefix = null) => checks.push({ name, command: 'npm',
    args: [...(prefix ? ['--prefix', prefix] : []), 'run', script], cwd: root,
    env: {},
  });
  if (mode !== 'database') {
    npmCheck('architecture', 'architecture:check');
    npmCheck('backend-build', 'build:backend');
    npmCheck('frontend-build', 'build:frontend');
    npmCheck('lint', 'lint');
    npmCheck('design-system', 'design-system:check');
    npmCheck('design-system-foundation', 'test:design-system-foundation');
    npmCheck('design-system-adoption', 'test:design-system-adoption');
    npmCheck('performance-unit', 'test:personnel-performance');
  }
  if (mode !== 'unit') {
    checks.push(...performanceDatabaseChecks(root));
  }
  const directory = path.join(root, 'test-results', 'personnel-performance', randomUUID());
  await mkdir(directory, { recursive: true, mode: 0o700 });
  console.log(`Performance verification evidence: ${directory}`);
  try {
    const report = await runPerformanceVerification({ directory, checks, identity: captureIdentity });
    console.log(`Local regression checks: ${report.status}. Promotion gates were not evaluated.`);
    process.exitCode = report.status === 'PASS' ? 0 : 1;
  } catch {
    console.error('Local verification blocked. Any existing report remains incomplete; production activation is not authorized.');
    process.exitCode = 1;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
