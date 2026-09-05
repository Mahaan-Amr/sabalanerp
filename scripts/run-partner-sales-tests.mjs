import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { repositoryRoot, interfaceVersion, preflight, validateNamespace, localSql } from '../tests/partner-sales/harness/safety.mjs';
import { buildInventory, renderInventory } from '../tests/partner-sales/harness/inventory.mjs';
import { removeFixture } from '../tests/partner-sales/harness/fixtures.mjs';
import { foundationInterface } from '../tests/partner-sales/harness/foundation.mjs';

const [mode = 'unit', ...args] = process.argv.slice(2);
try {
  if (!['unit', 'transport', 'integration', 'foundation', 'inventory', 'check-inventory', 'typecheck', 'db', 'browser', 'all', 'cleanup'].includes(mode)) throw new Error();
  if (mode === 'cleanup') { if (args.length !== 1) throw new Error(); validateNamespace(args[0]); }
  else if (args.length) throw new Error();
} catch {
  console.error('Partner QA usage: node scripts/run-partner-sales-tests.mjs unit|transport|integration|foundation|inventory|check-inventory|typecheck|db|browser|all|cleanup <namespace for cleanup only>');
  process.exit(2);
}

const runId = `partner-qa-${randomUUID()}`;
const output = path.join(repositoryRoot, 'test-results/partner-sales', runId);
await mkdir(output, { recursive: true });
const git = (args) => {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Cannot capture Partner QA candidate identity.');
  return result.stdout.trim();
};
const gitBytes = (args) => {
  const result = spawnSync('git', args, { cwd: repositoryRoot, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('Cannot capture Partner QA candidate patch.');
  return result.stdout;
};
const digest = value => createHash('sha256').update(value).digest('hex');
const manifest = {
  interfaceVersion, foundationInterface, runId, mode, startedAt: new Date().toISOString(),
  head: git(['rev-parse', 'HEAD']), tree: git(['rev-parse', 'HEAD^{tree}']),
  reviewBase: git(['merge-base', 'HEAD', 'origin/main']),
  cachedPatchHash: digest(gitBytes(['diff', '--cached', '--binary'])),
  workingPatchHash: digest(gitBytes(['diff', '--binary'])),
  workspaceStatus: git(['status', '--short']), checks: [], status: 'blocked',
  limitations: ['Production activation remains closed pending the separate release decision.', 'Runtime container identity is recorded separately from checkout HEAD.', 'External SMS remains the approved local sandbox fake; persisted OTP/session behavior is covered by backend integration tests.', 'The external trustseal.enamad.ir/logo.aspx footer image is replaced with a neutral browser-test placeholder; local UI and APIs are not intercepted.', 'Anonymous redirect diagnostics remain fatal and are recorded per browser project; no exception is allowlisted.'],
};

async function hashFiles(root) {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...await hashFiles(full));
    else result.push({ path: path.relative(repositoryRoot, full).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(full)).digest('hex') });
  }
  return result;
}

function run(name, commandArgs, environment = {}, timeoutMs = 10 * 60_000) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repositoryRoot, env: { ...process.env, PARTNER_QA_RUN_ID: runId,
      NODE_PATH: path.join(repositoryRoot, 'backend/node_modules'),
      CONTRACT_RECOVERY_TEST_DATABASE_URL:
        'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10',
      ...environment },
    encoding: 'utf8', timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  const log = `${result.stdout || ''}${result.stderr || ''}`;
  const logFile = `${manifest.checks.length}-${name.replaceAll(/[^a-z0-9]+/gi, '-')}.log`;
  writeFileSync(path.join(output, logFile), log);
  process.stdout.write(log);
  manifest.checks.push({ name, command: ['node', ...commandArgs].join(' '), logFile, status: result.status === 0 ? 'pass' : 'fail', exitCode: result.status });
  if (result.error || result.status !== 0) throw new Error(`${name} failed; see test output.`);
}

const browserDatabasePattern = /^sabalanerp_partner_browser_[a-f0-9]{16}$/;
function compose(args, environment = {}) {
  // Every action rechecks the existing project, including cleanup after failures.
  if (args[0] !== 'ps') compose(['ps']);
  const result = spawnSync('docker', ['compose', '-f', path.join(repositoryRoot, 'docker-compose.local.yml'), ...args], {
    cwd: repositoryRoot, env: { ...process.env, ...environment }, encoding: 'utf8', timeout: 10 * 60_000,
    maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  if (result.error || result.status !== 0) throw new Error(`sabalanerp-local Docker action failed: ${result.stderr || result.stdout || result.error?.message}`);
  return result.stdout;
}
function postgres(command) {
  return compose(['exec', '-T', 'postgres', 'sh', '-lc', command]);
}
function waitForServiceHealth(service) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    compose(['ps']);
    const result = spawnSync('docker', ['inspect', '--format', '{{.State.Health.Status}}', `sabalanerp-local-${service}-1`], {
      cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000, windowsHide: true,
    });
    if (result.status === 0 && result.stdout.trim() === 'healthy') return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
  }
  throw new Error(`sabalanerp-local ${service} did not become healthy after candidate switch.`);
}
function quoteIdentifier(value) {
  if (!browserDatabasePattern.test(value)) throw new Error('Unsafe Partner browser database name.');
  return `"${value}"`;
}
async function runBrowserAcceptance() {
  const databaseName = `sabalanerp_partner_browser_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const quoted = quoteIdentifier(databaseName);
  const databaseUrl = `postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/${databaseName}` +
    '?schema=public&connection_limit=2&pool_timeout=10';
  let databaseCreated = false;
  let backendSwitched = false;
  compose(['ps']);
  try {
    // Compose services are image-backed (no source bind mounts). Build both
    // candidate images before switching the existing local stack so browser
    // evidence cannot accidentally exercise an older checkout.
    compose(['build', 'backend', 'frontend']);
    postgres(`psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'CREATE DATABASE ${quoted}'`);
    databaseCreated = true;
    postgres(`set -o pipefail; pg_dump --schema-only --username postgres --dbname sabalanerp --no-owner --no-privileges ` +
      `| psql -v ON_ERROR_STOP=1 --username postgres --dbname ${quoted}`);
    // The backend entrypoint runs prisma migrate deploy. Preserve only migration
    // ledger evidence so it verifies this exact schema instead of replaying all
    // migrations; no application rows are copied into browser acceptance.
    postgres(`set -o pipefail; pg_dump --data-only --username postgres --dbname sabalanerp ` +
      `--table=public._prisma_migrations --no-owner --no-privileges ` +
      `| psql -v ON_ERROR_STOP=1 --username postgres --dbname ${quoted}`);
    // A failed Compose response may still have switched the service; always restore it.
    backendSwitched = true;
    compose(['up', '-d', '--force-recreate', '--no-deps', 'backend'], { LOCAL_POSTGRES_DATABASE: databaseName });
    waitForServiceHealth('backend');
    // The persistent local stack may have been created from another worktree.
    // Recreate only its existing frontend service so browser acceptance always
    // exercises the candidate whose patch identity is in this manifest.
    compose(['ps']);
    compose(['up', '-d', '--force-recreate', '--no-deps', 'frontend']);
    waitForServiceHealth('frontend');
    manifest.browserRuntime = await preflight({ database: databaseName });
    manifest.browserRuntime.images = [];
    for (const service of ['backend', 'frontend']) {
      compose(['ps']);
      const identity = spawnSync('docker', ['inspect', '--format', '{{json .Image}}', `sabalanerp-local-${service}-1`], {
        cwd: repositoryRoot, encoding: 'utf8', timeout: 10_000, windowsHide: true,
      });
      if (identity.error || identity.status !== 0) throw new Error(`Cannot capture ${service} browser image identity.`);
      manifest.browserRuntime.images.push({ service, imageId: JSON.parse(identity.stdout) });
    }
    try {
      run('anonymous and authenticated live browser acceptance',
        ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.partner-sales.config.ts'],
        { CONTRACT_RECOVERY_TEST_DATABASE_URL: databaseUrl }, 30 * 60_000);
    } catch (error) {
      writeFileSync(path.join(output, 'browser-backend.log'), compose(['logs', '--no-color', 'backend']));
      throw error;
    }
  } finally {
    if (backendSwitched) {
      compose(['ps']);
      compose(['up', '-d', '--force-recreate', '--no-deps', 'backend'], { LOCAL_POSTGRES_DATABASE: 'sabalanerp' });
      waitForServiceHealth('backend');
    }
    if (databaseCreated) {
      postgres(`psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command ` +
        `"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${databaseName}' AND pid <> pg_backend_pid()"`);
      postgres(`psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --command 'DROP DATABASE IF EXISTS ${quoted}'`);
      manifest.browserDatabaseCleanup = { database: databaseName, status: 'dropped' };
    }
    if (backendSwitched) manifest.restoredRuntime = await preflight();
  }
}

try {
  manifest.sourceFiles = await hashFiles(path.join(repositoryRoot, 'tests/partner-sales'));
  for (const file of ['scripts/run-partner-sales-tests.mjs', 'playwright.partner-sales.config.ts', '.github/workflows/partner-sales.yml']) {
    manifest.sourceFiles.push({ path: file, sha256: createHash('sha256').update(await readFile(path.join(repositoryRoot, file))).digest('hex') });
  }
  manifest.sourceHash = createHash('sha256').update(JSON.stringify(manifest.sourceFiles.sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');
  const candidatePaths = git(['ls-files', '--cached', '--others', '--exclude-standard', '--',
    'backend/prisma', 'backend/src/routes/partner-*', 'backend/src/services/partnerSales',
    'backend/src/services/crossWorkspaceDutyAdapters/partnerFinancialCorrectionAdapter.ts',
    'frontend/src/features/contract-creation/partner', 'frontend/src/features/partner-sales',
    'packages/partner-sales-contracts/src', 'scripts/run-partner-sales-tests.mjs', 'tests/partner-sales'])
    .split(/\r?\n/).filter(Boolean);
  manifest.candidateFiles = await Promise.all(candidatePaths.map(async file => ({ path: file,
    sha256: digest(await readFile(path.join(repositoryRoot, file))) })));
  manifest.candidateHash = digest(JSON.stringify(manifest.candidateFiles));
  if (['foundation', 'all'].includes(mode)) {
    manifest.foundationBuildFiles = await hashFiles(path.join(repositoryRoot, 'packages/partner-sales-contracts/dist'));
  }
  const inventory = await buildInventory();
  manifest.inventoryHash = inventory.inventoryHash;
  await writeFile(path.join(output, 'inventory.json'), JSON.stringify(inventory, null, 2));
  const inventoryPath = path.join(repositoryRoot, 'docs/qa/partner-sales/inventory.md');
  if (mode === 'inventory') {
    await mkdir(path.dirname(inventoryPath), { recursive: true });
    await writeFile(inventoryPath, renderInventory(inventory));
  }
  if (['check-inventory', 'all'].includes(mode)) {
    if ((await readFile(inventoryPath, 'utf8')).replaceAll('\r\n', '\n') !== renderInventory(inventory)) throw new Error('Route/action inventory drift; regenerate and review the changed coverage rows.');
    manifest.checks.push({ name: 'inventory freshness', status: 'pass' });
  }
  if (['unit', 'all'].includes(mode)) run('harness contracts', ['--test', 'tests/partner-sales/safety.test.mjs', 'tests/partner-sales/inventory.test.mjs', 'tests/partner-sales/runner.test.mjs']);
  if (['transport', 'integration', 'all'].includes(mode)) run('authenticated workspace integration', [
    'backend/node_modules/tsx/dist/cli.mjs', '--test',
    'tests/partner-sales/integration/workspace-query.test.ts',
    'tests/partner-sales/integration/workspace-transport.test.ts',
  ]);
  if (['integration', 'all'].includes(mode)) run('Partner lifecycle and downstream integration', [
    'backend/node_modules/tsx/dist/cli.mjs', '--test', '--test-concurrency=1',
    'backend/src/services/__tests__/partnerCustomerOutput.test.ts',
    'backend/src/services/__tests__/partnerCaseLifecycle.integration.test.ts',
    'backend/src/services/__tests__/partnerAccounting.test.ts',
    'backend/src/services/__tests__/partnerFulfillment.test.ts',
    'backend/src/services/__tests__/partnerFinancialCorrection.integration.test.ts',
    'backend/src/services/__tests__/partnerOperationsPrisma.integration.test.ts',
  ]);
  if (['foundation', 'all'].includes(mode)) run('foundation consumer contract', ['--test', 'tests/partner-sales/foundation-contract.test.mjs']);
  if (['typecheck', 'all'].includes(mode)) run('typecheck', ['frontend/node_modules/typescript/bin/tsc', '-p', 'tests/partner-sales/tsconfig.json']);
  if (['db', 'browser', 'all', 'cleanup'].includes(mode)) {
    manifest.runtime = await preflight();
    manifest.schema = JSON.parse(await localSql(`SELECT json_build_object(
      'appliedMigrationCount', count(*),
      'migrationHash', md5(string_agg(migration_name || ':' || checksum, ',' ORDER BY migration_name))
    ) FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;`));
  }
  if (['browser', 'all'].includes(mode)) await runBrowserAcceptance();
  if (['db', 'all'].includes(mode)) run('real-schema fixtures and authenticated APIs', ['--test', '--test-concurrency=1',
    'tests/partner-sales/fixtures.integration.test.mjs', 'tests/partner-sales/api.integration.test.mjs',
    'tests/partner-sales/integration/live-workspace.integration.test.mjs']);
  if (mode === 'cleanup') { await removeFixture(args[0]); manifest.checks.push({ name: 'exact namespace cleanup', status: 'pass' }); }
  for (const file of [...manifest.sourceFiles, ...(manifest.foundationBuildFiles || [])]) {
    if (createHash('sha256').update(await readFile(path.join(repositoryRoot, file.path))).digest('hex') !== file.sha256) {
      throw new Error('Harness source changed during execution; rerun against a fixed candidate.');
    }
  }
  for (const file of manifest.candidateFiles) {
    if (digest(await readFile(path.join(repositoryRoot, file.path))) !== file.sha256) {
      throw new Error('Implementation candidate changed during execution; rerun against a fixed candidate.');
    }
  }
  if (digest(gitBytes(['diff', '--cached', '--binary'])) !== manifest.cachedPatchHash ||
      digest(gitBytes(['diff', '--binary'])) !== manifest.workingPatchHash) {
    throw new Error('Candidate patch changed during execution; rerun against a fixed candidate.');
  }
  manifest.status = 'pass';
} catch (error) {
  manifest.status = 'fail';
  manifest.error = error.message;
  console.error(error.message);
  process.exitCode = 1;
} finally {
  manifest.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log(`Partner QA evidence: ${path.relative(repositoryRoot, output)}`);
}
