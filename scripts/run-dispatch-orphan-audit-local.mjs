import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const name of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === name && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(row => row.Service === service); assert.ok(row);
  const [value] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
  assert.equal(value.Config.Labels['com.docker.compose.project'], 'sabalanerp-local'); return value;
}
const observed = Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(name => [name, inspect(name)]));
const identities = values => Object.fromEntries(Object.entries(values).map(([name, value]) => [name,
  { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }]));
const before = identities(observed), environment = Object.fromEntries(observed.postgres.Config.Env.map(value => {
  const offset = value.indexOf('='); return [value.slice(0, offset), value.slice(offset + 1)];
}));
assert.equal(environment.POSTGRES_DB, 'sabalanerp'); assert.equal(environment.POSTGRES_USER, 'postgres');
assert.equal(observed.postgres.NetworkSettings.Ports['5432/tcp'][0].HostIp, '127.0.0.1');
assert.equal(observed.postgres.NetworkSettings.Ports['5432/tcp'][0].HostPort, '55432');
assert.equal(typeof environment.POSTGRES_PASSWORD, 'string'); assert.ok(environment.POSTGRES_PASSWORD.length);
const database = 'qa_dispatch_orphan_' + randomBytes(16).toString('hex');
assert.match(database, /^qa_dispatch_orphan_[a-f0-9]{32}$/);
const postgres = (args, options = {}) => {
  verify(); return execFileSync('docker', ['exec', ...(options.input ? ['-i'] : []), observed.postgres.Id, ...args],
    { maxBuffer: 64 * 1024 * 1024, ...options });
};
// Clone schema only, retaining real immutable-evidence triggers. Test records
// belong to this fresh database; never delete committed audit rows in the
// canonical database or disable its triggers for test cleanup.
const preservedCanonicalFixtures = postgres(['psql', '-U', 'postgres', '-d', 'sabalanerp', '-At', '-c',
  `SELECT "actorId", count(*) FROM dispatch_lifecycle_audits WHERE "actorId" LIKE 'orphan-audit-qa-%' GROUP BY "actorId" ORDER BY "actorId"`], { encoding: 'utf8' }).trim();
const schema = postgres(['pg_dump', '-U', 'postgres', '-d', 'sabalanerp', '--schema-only', '--no-owner', '--no-privileges',
  '--lock-wait-timeout=5s', '--format=custom']);
postgres(['createdb', '-U', 'postgres', '--template=template0', database]);
const databaseOid = postgres(['psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
  `SELECT oid FROM pg_database WHERE datname = '${database}'`], { encoding: 'utf8' }).trim();
assert.match(databaseOid, /^[0-9]+$/);
const url = new URL('postgresql://127.0.0.1:55432/' + database);
url.username = environment.POSTGRES_USER; url.password = environment.POSTGRES_PASSWORD;
url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '5');
url.searchParams.set('application_name', 'dispatch-orphan-local-' + randomBytes(8).toString('hex'));
const test = 'backend/src/services/__tests__/dispatchOrphanGenerationAudit.integration.test.ts';
let result;
let cloneFailure;
try {
  postgres(['pg_restore', '-U', 'postgres', '-d', database, '--exit-on-error', '--no-owner', '--no-privileges'], { input: schema });
  const rows = postgres(['psql', '-U', 'postgres', '-d', database, '-At', '-c',
    'SELECT count(*) FROM dispatch_lifecycle_audits'], { encoding: 'utf8' }).trim();
  assert.equal(rows, '0');
  result = spawnSync(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs', '--test', test], {
    cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: url.href, DISPATCH_ORPHAN_AUDIT_LOCAL_ACCEPTANCE: '1' },
  });
} catch (error) { cloneFailure = error; }
const redact = value => (value || '').split(url.href).join('[LOCAL_DATABASE_URL]')
  .split(environment.POSTGRES_PASSWORD).join('[LOCAL_DATABASE_PASSWORD]');
const report = { format: 'sabalan-dispatch-orphan-local-audit/v1', pass: false, status: result?.status, signal: result?.signal,
  stdout: redact(result?.stdout), stderr: redact(result?.stderr), cloneFailure: redact(cloneFailure?.message),
  database, databaseOid, schemaSha256: createHash('sha256').update(schema).digest('hex'), preservedCanonicalFixtures,
  sourceSha256: createHash('sha256').update(fs.readFileSync(path.join(root, test))).digest('hex'),
  canonicalBefore: before, productionAdmission: false, isolatedDatabaseRetired: false };
const reportPath = path.join(root, 'reports/qa/dispatch-orphan-local-audit-' + randomBytes(16).toString('hex') + '.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
const active = postgres(['psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
  `SELECT count(*) FROM pg_stat_activity WHERE datname = '${database}'`], { encoding: 'utf8' }).trim();
assert.equal(active, '0', 'Keep isolated database until every actual client closes.');
const currentOid = postgres(['psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
  `SELECT oid FROM pg_database WHERE datname = '${database}'`], { encoding: 'utf8' }).trim();
assert.equal(currentOid, databaseOid);
postgres(['dropdb', '-U', 'postgres', database]); report.isolatedDatabaseRetired = true;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
if (cloneFailure) throw cloneFailure;
assert.equal(result.status, 0, report.stderr + report.stdout); assert.equal(result.signal, null);
assert.match(report.stdout, /# fail 0\r?\n/); assert.match(report.stdout, /# skipped 0\r?\n/);
const after = identities(Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(name => [name, inspect(name)])));
assert.deepEqual(after, before); report.canonicalAfter = after; report.pass = true;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ pass: true, reportPath }));
