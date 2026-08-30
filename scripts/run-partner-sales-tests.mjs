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
  if (!['unit', 'integration', 'foundation', 'inventory', 'check-inventory', 'typecheck', 'db', 'browser', 'all', 'cleanup'].includes(mode)) throw new Error();
  if (mode === 'cleanup') { if (args.length !== 1) throw new Error(); validateNamespace(args[0]); }
  else if (args.length) throw new Error();
} catch {
  console.error('Partner QA usage: node scripts/run-partner-sales-tests.mjs unit|integration|foundation|inventory|check-inventory|typecheck|db|browser|all|cleanup <namespace for cleanup only>');
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
const manifest = {
  interfaceVersion, foundationInterface, runId, mode, startedAt: new Date().toISOString(),
  head: git(['rev-parse', 'HEAD']), reviewBase: '9fcf2edb4f5f580f0e2e71347cd60fd374f8b3aa',
  workspaceStatus: git(['status', '--short']), checks: [], status: 'blocked',
  limitations: ['Module baseline only; not Partner E2E or release acceptance.', 'Runtime container identity is recorded separately from checkout HEAD.', 'Foundation fixtures/clock/sandbox prove the consumer contract, not a live Partner backend or real OTP flow.', 'Known legacy redirect diagnostics remain open as LEGACY-314-01; functional browser pass does not close them.'],
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

function run(name, commandArgs) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: repositoryRoot, env: { ...process.env, PARTNER_QA_RUN_ID: runId,
      NODE_PATH: path.join(repositoryRoot, 'backend/node_modules') },
    encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  const log = `${result.stdout || ''}${result.stderr || ''}`;
  const logFile = `${manifest.checks.length}-${name.replaceAll(/[^a-z0-9]+/gi, '-')}.log`;
  writeFileSync(path.join(output, logFile), log);
  process.stdout.write(log);
  manifest.checks.push({ name, command: ['node', ...commandArgs].join(' '), logFile, status: result.status === 0 ? 'pass' : 'fail', exitCode: result.status });
  if (result.error || result.status !== 0) throw new Error(`${name} failed; see test output.`);
}

try {
  manifest.sourceFiles = await hashFiles(path.join(repositoryRoot, 'tests/partner-sales'));
  for (const file of ['scripts/run-partner-sales-tests.mjs', 'playwright.partner-sales.config.ts', '.github/workflows/partner-sales.yml']) {
    manifest.sourceFiles.push({ path: file, sha256: createHash('sha256').update(await readFile(path.join(repositoryRoot, file))).digest('hex') });
  }
  manifest.sourceHash = createHash('sha256').update(JSON.stringify(manifest.sourceFiles.sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');
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
  if (['integration', 'all'].includes(mode)) run('authenticated workspace integration', [
    'backend/node_modules/tsx/dist/cli.mjs', '--test',
    'tests/partner-sales/integration/workspace-query.test.ts',
    'tests/partner-sales/integration/workspace-transport.test.ts',
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
  if (['db', 'all'].includes(mode)) run('real-schema fixtures and authenticated APIs', ['--test', '--test-concurrency=1',
    'tests/partner-sales/fixtures.integration.test.mjs', 'tests/partner-sales/api.integration.test.mjs',
    'tests/partner-sales/integration/live-workspace.integration.test.mjs']);
  if (['browser', 'all'].includes(mode)) run('anonymous browser baseline', ['node_modules/@playwright/test/cli.js', 'test', '--config=playwright.partner-sales.config.ts']);
  if (mode === 'cleanup') { await removeFixture(args[0]); manifest.checks.push({ name: 'exact namespace cleanup', status: 'pass' }); }
  for (const file of [...manifest.sourceFiles, ...(manifest.foundationBuildFiles || [])]) {
    if (createHash('sha256').update(await readFile(path.join(repositoryRoot, file.path))).digest('hex') !== file.sha256) {
      throw new Error('Harness source changed during execution; rerun against a fixed candidate.');
    }
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
