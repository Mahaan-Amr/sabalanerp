import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..');
const suite = process.env.CUSTOMER_BARRIER_SUITE || 'closed';
assert.ok(['closed', 'counter-race', 'partial-status-race', 'partial-event-race'].includes(suite));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const migration = 'backend/prisma/migrations/20261019010000_customer_semantic_barrier/migration.sql';
const migrationBytes = fs.readFileSync(path.join(root, migration));
const sources = Object.fromEntries([migration, 'backend/prisma/schema.prisma', 'scripts/run-customer-semantic-barrier-local.mjs']
  .map(name => [name, sha(name === migration ? migrationBytes : fs.readFileSync(path.join(root, name)))]));
const oldClientDirectory = path.join(root, 'backend/node_modules/.prisma/production-425-overlap-20261018');
function captureOldClient(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) captureOldClient(file);
    else { assert.ok(entry.isFile()); sources[path.relative(root, file).split(path.sep).join('/')] = sha(fs.readFileSync(file)); }
  }
}
captureOldClient(oldClientDirectory);
const oldSource = execFileSync('git', ['show', 'a2c75f1027a069e91837ff433e1c91cdc7746798:backend/prisma/schema.prisma'],
  { cwd: root, maxBuffer: 4 * 1024 * 1024 });
assert.equal(sha(oldSource), '28c06abece82c71d2cfa1ffd28ede8b08a90303c4fdbcaec4dbad78b5a8f18ad');
// Compare schema tokens outside the private generator, preserving quoted
// strings. Prisma generation reformats whitespace and private output paths.
const schemaTokens = value => value.toString('utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  .replace(/^generator client\s*\{[\s\S]*?^\}\s*/m, '')
  .match(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\s+|[^\s]/g)
  .filter(token => !/^\s/.test(token) && !token.startsWith('//') && !token.startsWith('/*')).join('');
assert.equal(schemaTokens(oldSource), schemaTokens(fs.readFileSync(path.join(oldClientDirectory, 'schema.prisma'))));
const oldModelSource = { commit: 'a2c75f1027a069e91837ff433e1c91cdc7746798', schemaSha256: sha(oldSource),
  schemaTokensSha256: sha(schemaTokens(oldSource)), actualProductionImage: false };
const require = createRequire(import.meta.url), esbuild = require('../backend/node_modules/esbuild');
const built = await esbuild.build({ absWorkingDir: root,
  entryPoints: { raw: 'backend/src/services/__tests__/customerSemanticBarrier.integration.test.ts',
    commands: 'backend/src/services/__tests__/customerSemanticCommandBarrier.integration.test.ts',
    installer: 'backend/src/services/__tests__/customerSemanticBarrierInstall.integration.test.ts',
    race: 'backend/src/services/__tests__/customerSemanticBarrierRace.integration.test.ts' },
  bundle: true, platform: 'node', packages: 'external', format: 'cjs', target: 'node20', write: false,
  outdir: 'private-barrier-bundle', outExtension: { '.js': '.cjs' }, metafile: true, logLevel: 'silent',
  plugins: [{ name: 'captured-private-source', setup(build) {
    build.onLoad({ filter: /.*/, namespace: 'file' }, args => {
      const relative = path.relative(root, args.path);
      assert.ok(relative && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
      const name = relative.split(path.sep).join('/'), bytes = fs.readFileSync(args.path), hash = sha(bytes);
      if (sources[name]) assert.equal(sources[name], hash);
      sources[name] = hash;
      const loader = { '.ts': 'ts', '.tsx': 'tsx', '.js': 'js', '.cjs': 'js', '.mjs': 'js', '.json': 'json' }[path.extname(args.path)];
      assert.ok(loader);
      return { contents: bytes, loader, resolveDir: path.dirname(args.path) };
    });
  } }],
});
for (const name of Object.keys(built.metafile.inputs)) assert.ok(sources[name]);
const bundleDirectory = path.join('D:/sabalanerp-online-qa', 'customer-barrier-' + randomBytes(16).toString('hex'));
fs.mkdirSync(bundleDirectory, { mode: 0o700 });
const bundleFiles = built.outputFiles.map(file => {
  const name = path.join(bundleDirectory, path.basename(file.path));
  fs.writeFileSync(name, file.contents, { flag: 'wx', mode: 0o400 });
  return name;
});
const bundles = Object.fromEntries(built.outputFiles.map(file => [path.basename(file.path), sha(file.contents)]));
const sqlFile = path.join(bundleDirectory, 'barrier.sql');
fs.writeFileSync(sqlFile, migrationBytes, { flag: 'wx', mode: 0o400 });
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function identities() {
  return Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => {
    const row = verify().find(value => value.Service === service);
    verify();
    const [value] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
    return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
  }));
}
const before = identities(), postgresId = before.postgres.id;
verify();
const [observed] = JSON.parse(execFileSync('docker', ['inspect', postgresId], { encoding: 'utf8' }));
const environment = Object.fromEntries(observed.Config.Env.map(value => {
  const offset = value.indexOf('='); return [value.slice(0, offset), value.slice(offset + 1)];
}));
assert.equal(environment.POSTGRES_DB, 'sabalanerp'); assert.equal(environment.POSTGRES_USER, 'postgres');
assert.equal(observed.NetworkSettings.Ports['5432/tcp'][0].HostIp, '127.0.0.1');
assert.equal(observed.NetworkSettings.Ports['5432/tcp'][0].HostPort, '55432');
assert.ok(environment.POSTGRES_PASSWORD);
const database = 'qa_customer_barrier_' + randomBytes(16).toString('hex');
const postgres = (args, options = {}) => {
  verify(); return execFileSync('docker', ['exec', ...(options.input ? ['-i'] : []), postgresId, ...args],
    { maxBuffer: 64 * 1024 * 1024, ...options });
};
const schema = postgres(['pg_dump', '-U', 'postgres', '-d', 'sabalanerp', '--schema-only', '--no-owner', '--no-privileges',
  '--lock-wait-timeout=5s', '--format=custom']);
postgres(['createdb', '-U', 'postgres', '--template=template0', database]);
const scalar = sql => postgres(['psql', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const databaseOid = scalar(`SELECT oid FROM pg_database WHERE datname='${database}'`);
assert.match(databaseOid, /^[0-9]+$/);
const url = new URL('postgresql://127.0.0.1:55432/' + database);
url.username = environment.POSTGRES_USER; url.password = environment.POSTGRES_PASSWORD;
url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '5');
url.searchParams.set('application_name', 'customer-barrier-' + randomBytes(8).toString('hex'));
let result, installerResult, failure;
try {
  postgres(['pg_restore', '-U', 'postgres', '-d', database, '--exit-on-error', '--no-owner', '--no-privileges'], { input: schema });
  const options = {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: path.join(root, 'backend/node_modules'), DATABASE_URL: url.href,
      CUSTOMER_SEMANTIC_BARRIER_LOCAL_ACCEPTANCE: '1', CUSTOMER_SEMANTIC_OLD_CLIENT_DIRECTORY: oldClientDirectory,
      CUSTOMER_SEMANTIC_BARRIER_RACE_KIND: suite,
      CUSTOMER_SEMANTIC_BARRIER_SQL_FILE: sqlFile, CUSTOMER_SEMANTIC_BARRIER_SQL_SHA256: sha(migrationBytes) },
  };
  if (suite !== 'closed') result = spawnSync(process.execPath, ['--test', ...bundleFiles.filter(file => path.basename(file) === 'race.cjs')], options);
  else {
    installerResult = spawnSync(process.execPath, ['--test', ...bundleFiles.filter(file => path.basename(file) === 'installer.cjs')], options);
    if (installerResult.status !== 0 || installerResult.signal !== null) throw new Error('Private barrier installer acceptance failed.');
    assert.match(installerResult.stdout, /"barrierInstalledAfterFaults":true/);
    result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...bundleFiles.filter(file => ['raw.cjs', 'commands.cjs'].includes(path.basename(file)))], options);
  }
} catch (error) { failure = error; }
const redact = value => [url.href, environment.POSTGRES_PASSWORD, url.password, encodeURIComponent(environment.POSTGRES_PASSWORD)]
  .filter(Boolean).reduce((output, secret) => output.split(secret).join('[LOCAL_DATABASE_SECRET]'), value || '');
const report = { format: 'sabalan-customer-semantic-barrier/v1', suite, pass: false, database, databaseOid,
  sources, bundles, bundleDirectory, oldModelSource, schemaSha256: sha(schema), stdout: redact(result?.stdout), stderr: redact(result?.stderr),
  installer: installerResult ? { status: installerResult.status, signal: installerResult.signal,
    stdout: redact(installerResult.stdout), stderr: redact(installerResult.stderr) } : null,
  failure: redact(failure?.message), status: result?.status, signal: result?.signal,
  canonicalBefore: before, isolatedDatabaseRetired: false, productionAdmission: false };
const reportPath = path.join(root, 'reports/qa/customer-semantic-barrier-' + randomBytes(16).toString('hex') + '.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
assert.ok(suite === 'closed' ? installerResult : result, 'Retain diagnostic database after unknown clone/installer launch: ' + reportPath);
if (installerResult) {
  assert.equal(installerResult.signal, null, 'Retain interrupted installer database.');
  assert.match(installerResult.stdout, /"closedBarrierInstallerClientsClosed":true/,
    'Retain diagnostic database until original installer clients close.');
}
if (result) {
  assert.equal(result.signal, null, 'Retain interrupted diagnostic database.');
  assert.ok(Number.isInteger(result.status), 'Retain diagnostic database after unknown test-process launch.');
}
if (suite !== 'closed') assert.match(result.stdout, /"closedBarrierRaceClientsClosed":true/,
  'Retain diagnostic database until the original race clients close.');
assert.equal(scalar(`SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='${database}')
  + (SELECT count(*) FROM pg_prepared_xacts WHERE database='${database}')`), '0');
assert.equal(scalar(`SELECT oid FROM pg_database WHERE datname='${database}'`), databaseOid);
postgres(['dropdb', '-U', 'postgres', database]); report.isolatedDatabaseRetired = true;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
if (failure) throw failure;
assert.equal(result.status, 0, report.stderr + report.stdout);
assert.match(report.stdout, /# fail 0\r?\n/); assert.match(report.stdout, /# skipped 0\r?\n/);
for (const [name, hash] of Object.entries(sources)) assert.equal(sha(fs.readFileSync(path.join(root, name))), hash);
assert.deepEqual(identities(), before); report.pass = true;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, reportPath }));
