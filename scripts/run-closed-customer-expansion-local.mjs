import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..'), commit = 'a2c75f1027a069e91837ff433e1c91cdc7746798';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {}, historicalSources = {};
const capture = name => {
  const bytes = fs.readFileSync(path.join(root, name)), hash = sha(bytes);
  if (sources[name]) assert.equal(sources[name], hash);
  sources[name] = hash; return bytes;
};
const baseline = JSON.parse(capture('backend/src/services/protectedBootstrapBaseline.json'));
assert.equal(baseline.migrations.length, 425);
capture('scripts/run-closed-customer-expansion-local.mjs');
const staging = path.join('D:/sabalanerp-online-qa', 'closed-customer-expansion-' + randomBytes(16).toString('hex'));
fs.mkdirSync(staging, { mode: 0o700 }); fs.mkdirSync(path.join(staging, 'migrations'));
let actualImageManifestSha256, infrastructureSql;
if (process.env.CLOSED_CUSTOMER_ACTUAL_IMAGE_MANIFEST) {
  assert.ok(process.env.CLOSED_CUSTOMER_RETAINED_HISTORY_FILE);
  const bytes = fs.readFileSync(process.env.CLOSED_CUSTOMER_ACTUAL_IMAGE_MANIFEST), manifest = JSON.parse(bytes);
  assert.equal(manifest.format, 'sabalan-actual-image-customer-input/v1');
  for (const [name, hash] of Object.entries(manifest.sources)) assert.equal(sha(fs.readFileSync(path.join(root, name))), hash);
  const sql = fs.readFileSync(path.join(manifest.destination, 'qa-infrastructure.sql'));
  assert.equal(sha(sql), manifest.files['qa-infrastructure.sql'].sha256);
  actualImageManifestSha256 = sha(bytes); infrastructureSql = path.join(staging, 'qa-infrastructure.sql');
  fs.writeFileSync(infrastructureSql, sql, { flag: 'wx' });
}
const prior = [...baseline.migrations,
  { name: '20261014120000_hr_vehicle_assignment_plans', sha256: 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289' },
  { name: '20261014140000_online_deployment_control', sha256: '872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2' }];
for (const row of prior) {
  const bytes = capture(`backend/prisma/migrations/${row.name}/migration.sql`);
  assert.equal(sha(bytes), row.sha256);
  if (infrastructureSql && prior.indexOf(row) >= 425) continue;
  fs.mkdirSync(path.join(staging, 'migrations', row.name));
  fs.writeFileSync(path.join(staging, 'migrations', row.name, 'migration.sql'), bytes, { flag: 'wx' });
}
const historical = name => {
  const bytes = execFileSync('git', ['show', `${commit}:${name}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  historicalSources[name] = sha(bytes); return bytes;
};
const oldSchema = historical('backend/prisma/schema.prisma');
assert.equal(sha(oldSchema), '28c06abece82c71d2cfa1ffd28ede8b08a90303c4fdbcaec4dbad78b5a8f18ad');
fs.writeFileSync(path.join(staging, 'schema.prisma'), oldSchema, { flag: 'wx' });
fs.writeFileSync(path.join(staging, 'migrations/migration_lock.toml'), capture('backend/prisma/migrations/migration_lock.toml'), { flag: 'wx' });
const expansion = fs.readdirSync(path.join(root, 'backend/prisma/migrations')).filter(name =>
  /^(2026101415|20261014160000_customer_legacy_receipt_resolution|20261019010000_customer_semantic_barrier)/.test(name)).sort()
  .map((name, index) => {
    const bytes = capture(`backend/prisma/migrations/${name}/migration.sql`), file = path.join(staging, `financial-${index}.sql`);
    fs.writeFileSync(file, bytes, { flag: 'wx' }); return { name, file };
  });
assert.equal(expansion.length, 8);
const input = path.join(staging, 'expansion-input.json'); fs.writeFileSync(input, JSON.stringify(expansion), { flag: 'wx' });
const oldClient = path.join(root, 'backend/node_modules/.prisma/production-425-overlap-20261018');
const captureDirectory = directory => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) captureDirectory(file);
    else { assert.ok(entry.isFile()); capture(path.relative(root, file).split(path.sep).join('/')); }
  }
};
captureDirectory(oldClient);
const tokens = bytes => bytes.toString().replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  .replace(/^generator client\s*\{[\s\S]*?^\}\s*/m, '').match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s+|[^\s]/g)
  .filter(token => !/^\s/.test(token) && !token.startsWith('//') && !token.startsWith('/*')).join('');
assert.equal(tokens(oldSchema), tokens(fs.readFileSync(path.join(oldClient, 'schema.prisma'))));
const require = createRequire(import.meta.url), esbuild = require('../backend/node_modules/esbuild');
async function build(entry, old, output) {
  const result = await esbuild.build({ absWorkingDir: root, entryPoints: [entry], bundle: true, platform: 'node',
    packages: 'external', format: 'cjs', target: 'node20', write: false, metafile: true, logLevel: 'silent',
    plugins: [{ name: 'captured-source', setup(builder) {
      if (old) builder.onResolve({ filter: /^@prisma\/client$/ }, () => ({ path: oldClient, external: true }));
      if (old) builder.onResolve({ filter: /^@sabalanerp\// }, args => {
        const parts = args.path.split('/');
        assert.equal(parts.length, 2);
        return { path: path.join(root, 'packages', parts[1], 'src/index.ts') };
      });
      if (old) builder.onResolve({ filter: /packages\/[a-z-]+$/ }, args => {
        assert.ok(args.path.startsWith('.'));
        return { path: path.resolve(args.resolveDir, args.path, 'src/index.ts') };
      });
      builder.onLoad({ filter: /.*/, namespace: 'file' }, args => {
        const relative = path.relative(root, args.path).split(path.sep).join('/');
        assert.ok(relative && !relative.startsWith('../') && !path.isAbsolute(relative));
        const bytes = old ? historical(relative) : capture(relative);
        const loader = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.json': 'json' }[path.extname(args.path)];
        assert.ok(loader); return { contents: bytes, loader, resolveDir: path.dirname(args.path) };
      });
    } }] });
  const file = path.join(staging, output); fs.writeFileSync(file, result.outputFiles[0].contents, { flag: 'wx' });
  return { file, sha256: sha(result.outputFiles[0].contents) };
}
const oldBundle = await build('backend/src/services/accountingCustomerWorkspace.ts', true, 'old-workspace.cjs');
const fixture = await build('backend/src/services/__tests__/closedCustomerExpansion.integration.test.ts', false, 'acceptance.cjs');
const canonical = 'D:/sabalanerp', compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['postgres', 'backend', 'frontend', 'inquiry']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function identities() {
  return Object.fromEntries(['postgres', 'backend', 'frontend', 'inquiry'].map(service => {
    const row = verify().find(row => row.Service === service); verify();
    const [item] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
    return [service, { id: item.Id, image: item.Image, startedAt: item.State.StartedAt }];
  }));
}
const before = identities(), postgresId = before.postgres.id;
verify(); const [container] = JSON.parse(execFileSync('docker', ['inspect', postgresId], { encoding: 'utf8' }));
const env = Object.fromEntries(container.Config.Env.map(value => { const offset = value.indexOf('='); return [value.slice(0, offset), value.slice(offset + 1)]; }));
assert.equal(env.POSTGRES_DB, 'sabalanerp'); assert.equal(env.POSTGRES_USER, 'postgres'); assert.ok(env.POSTGRES_PASSWORD);
assert.equal(container.NetworkSettings.Ports['5432/tcp'][0].HostIp, '127.0.0.1');
assert.equal(container.NetworkSettings.Ports['5432/tcp'][0].HostPort, '55432');
const database = 'qa_customer_expansion_' + randomBytes(16).toString('hex');
const postgres = args => { verify(); return execFileSync('docker', ['exec', postgresId, ...args], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }); };
const scalar = sql => postgres(['psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql]).trim();
postgres(['createdb', '-U', 'postgres', '--template=template0', database]);
const databaseOid = scalar(`SELECT oid FROM pg_database WHERE datname='${database}'`); assert.match(databaseOid, /^[0-9]+$/);
const url = new URL('postgresql://127.0.0.1:55432/' + database); url.username = env.POSTGRES_USER; url.password = env.POSTGRES_PASSWORD;
url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '5');
url.searchParams.set('application_name', 'closed-expansion-' + randomBytes(8).toString('hex'));
const childEnv = { ...process.env, NODE_ENV: 'test', DATABASE_URL: url.href,
  NODE_PATH: [path.join(root, 'backend/node_modules'), path.join(root, 'packages/contract-product-graph/node_modules')].join(path.delimiter),
  CLOSED_CUSTOMER_EXPANSION_LOCAL_ACCEPTANCE: '1', CLOSED_CUSTOMER_EXPANSION_INPUT: input,
  ...(infrastructureSql ? { CLOSED_CUSTOMER_INFRASTRUCTURE_SQL: infrastructureSql } : {}),
  CUSTOMER_SEMANTIC_OLD_CLIENT_DIRECTORY: oldClient, CLOSED_CUSTOMER_OLD_WORKSPACE_BUNDLE: oldBundle.file };
const migrated = spawnSync(process.execPath, [path.join(root, 'backend/node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--schema', path.join(staging, 'schema.prisma')],
  { cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
let tested;
if (migrated.status === 0 && migrated.signal === null) tested = spawnSync(process.execPath, ['--test', fixture.file],
  { cwd: root, env: childEnv, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const redact = value => [url.href, env.POSTGRES_PASSWORD, url.password, encodeURIComponent(env.POSTGRES_PASSWORD)].filter(Boolean)
  .reduce((result, secret) => result.split(secret).join('[LOCAL_DATABASE_SECRET]'), value || '');
const receipt = process => process ? { status: process.status, signal: process.signal, stdout: redact(process.stdout), stderr: redact(process.stderr) } : null;
const report = { format: 'sabalan-closed-customer-expansion-local/v1', pass: false, productionAdmission: false,
  actualProductionImage: false, oldSourceCommit: commit, sources, historicalSources, oldBundle, fixture,
  actualImageManifestSha256,
  database, databaseOid, canonicalBefore: before, migration: receipt(migrated), acceptance: receipt(tested), isolatedDatabaseRetired: false };
const reportPath = path.join(root, 'reports/qa/closed-customer-expansion-' + randomBytes(16).toString('hex') + '.json');
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); save();
assert.equal(migrated.signal, null, 'Retain interrupted native migration database: ' + reportPath);
assert.ok(Number.isInteger(migrated.status), 'Retain database after unknown native launch: ' + reportPath);
if (tested) {
  assert.equal(tested.signal, null, 'Retain interrupted acceptance database.');
  assert.ok(Number.isInteger(tested.status));
  assert.match(tested.stdout, /"closedCustomerExpansionClientsClosed":true/, 'Retain original unclosed-client diagnostic database.');
}
assert.equal(scalar(`SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='${database}')
  + (SELECT count(*) FROM pg_prepared_xacts WHERE database='${database}')`), '0');
assert.equal(scalar(`SELECT oid FROM pg_database WHERE datname='${database}'`), databaseOid);
postgres(['dropdb', '-U', 'postgres', database]); report.isolatedDatabaseRetired = true; save();
assert.equal(migrated.status, 0, report.migration.stderr + report.migration.stdout);
assert.equal(tested?.status, 0, report.acceptance?.stderr + report.acceptance?.stdout);
assert.match(tested.stdout, /"populatedClosedExpansionPassed":true/);
assert.match(tested.stdout, /# fail 0\r?\n/); assert.match(tested.stdout, /# skipped 0\r?\n/);
for (const [name, hash] of Object.entries(sources)) assert.equal(sha(fs.readFileSync(path.join(root, name))), hash);
assert.deepEqual(identities(), before); report.pass = true; save();
console.log(JSON.stringify({ pass: true, reportPath }));
