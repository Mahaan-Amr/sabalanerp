import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const root = path.resolve(import.meta.dirname, '..'), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const suite = process.env.HR_ERASURE_FILE_SUITE || 'legacy'; assert.ok(['legacy', 'native', 'predecessor', 'profile'].includes(suite));
const native = suite === 'native' || suite === 'profile';
const test = suite === 'profile' ? 'tests/online-deployment/hr-file-runtime-profile.fixture.ts'
  : suite === 'native' ? 'tests/online-deployment/hr-erasure-file-journal.fixture.ts'
  : suite === 'predecessor' ? 'backend/src/services/__tests__/hrDeletionFileCleanupPredecessor.integration.test.ts'
  : 'backend/src/services/__tests__/hrErasureFileRecovery.integration.test.ts';
const sources = {}, capture = name => {
  const bytes = fs.readFileSync(path.join(root, name)), hash = sha(bytes);
  if (sources[name]) assert.equal(sources[name], hash);
  sources[name] = hash; return bytes;
};
capture('scripts/run-hr-erasure-file-recovery-local.mjs');
capture('backend/prisma/schema.prisma');
capture('backend/node_modules/.prisma/client/schema.prisma');
const migration = capture('backend/prisma/migrations/20261019020000_hr_versioned_file_cleanup/migration.sql');
capture('backend/src/services/hrVersionedFileCleanupExpansion.json');
assert.match(migration.toString(), /^-- Generated bounded online expansion: 20261019020000_hr_versioned_file_cleanup\r?\nALTER TABLE "public"\."hr_deletion_file_cleanups" ADD COLUMN "versionedFileState" jsonb;\r?\n$/);
const require = createRequire(import.meta.url), esbuild = require('../backend/node_modules/esbuild');
const built = await esbuild.build({ absWorkingDir: root,
  entryPoints: [test],
  bundle: true, platform: 'node', packages: 'external', format: 'cjs', target: 'node22', write: false, logLevel: 'silent',
  plugins: [{ name: 'capture-hr-recovery-sources', setup(build) {
    build.onLoad({ filter: /.*/, namespace: 'file' }, args => {
      const name = path.relative(root, args.path).split(path.sep).join('/');
      assert.ok(name && !name.startsWith('../') && !path.isAbsolute(name));
      const loader = { '.ts': 'ts', '.js': 'js', '.json': 'json' }[path.extname(args.path)]; assert.ok(loader);
      return { contents: capture(name), loader, resolveDir: path.dirname(args.path) };
    });
  } }],
});
const run = randomBytes(16).toString('hex'), directory = path.join('D:/sabalanerp-online-qa', 'hr-erasure-' + run);
fs.mkdirSync(directory, { mode: 0o700 });
const bundle = Buffer.from(built.outputFiles[0].contents), entry = path.join(directory, 'fixture.cjs');
fs.writeFileSync(entry, bundle, { flag: 'wx' });
const canonical = 'D:/sabalanerp', compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  return Object.fromEntries(['backend', 'frontend', 'inquiry', 'postgres', ...(native ? ['backend-candidate'] : [])].map(service => {
    const row = rows.find(item => item.Service === service && item.Project === 'sabalanerp-local');
    assert.ok(row && row.State === 'running' && row.Health === 'healthy');
    return [service, { name: row.Name, id: row.ID }];
  }));
}
function inspect(service) {
  const row = verify()[service];
  const [value] = JSON.parse(execFileSync('docker', ['inspect', row.name], { encoding: 'utf8' }));
  assert.equal(value.Config.Labels['com.docker.compose.project'], 'sabalanerp-local'); return value;
}
const observed = Object.fromEntries(['backend', 'frontend', 'inquiry', 'postgres'].map(name => [name, inspect(name)]));
const identities = values => Object.fromEntries(Object.entries(values).map(([name, value]) => [name,
  { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }]));
const before = identities(observed), pg = observed.postgres;
const candidate = native ? inspect('backend-candidate') : null;
if (candidate) {
  assert.ok(candidate.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
  assert.ok(candidate.Mounts.some(mount => mount.Type === 'volume' && mount.RW
    && mount.Name === 'sabalanerp-local_online_runtime_acceptance' && mount.Destination === '/app/online-runtime-acceptance'));
}
assert.equal(pg.NetworkSettings.Ports['5432/tcp'][0].HostIp, '127.0.0.1');
assert.equal(pg.NetworkSettings.Ports['5432/tcp'][0].HostPort, '55432');
const environment = Object.fromEntries(pg.Config.Env.map(value => {
  const offset = value.indexOf('='); return [value.slice(0, offset), value.slice(offset + 1)];
}));
assert.equal(environment.POSTGRES_DB, 'sabalanerp'); assert.equal(environment.POSTGRES_USER, 'postgres');
assert.ok(environment.POSTGRES_PASSWORD);
const postgres = (args, options = {}) => {
  const current = inspect('postgres'); assert.equal(current.Id, pg.Id);
  verify(); return execFileSync('docker', ['exec', ...(options.input ? ['-i'] : []), pg.Id, ...args],
    { maxBuffer: 64 * 1024 * 1024, ...options });
};
const schema = postgres(['pg_dump', '-U', 'postgres', '-d', 'sabalanerp', '--schema-only', '--no-owner', '--no-privileges',
  '--lock-wait-timeout=5s', '--format=custom']);
const database = 'qa_hr_erasure_' + run;
postgres(['createdb', '-U', 'postgres', '--template=template0', database]);
const oid = postgres(['psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
  `SELECT oid FROM pg_database WHERE datname='${database}'`], { encoding: 'utf8' }).trim();
assert.match(oid, /^[0-9]+$/);
const url = new URL('postgresql://127.0.0.1:55432/' + database);
url.username = environment.POSTGRES_USER; url.password = environment.POSTGRES_PASSWORD;
url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '5');
url.searchParams.set('application_name', 'hr-erasure-qa-' + run);
let result, failure, nativeUrl, nativeDirectory;
try {
  postgres(['pg_restore', '-U', 'postgres', '-d', database, '--exit-on-error', '--no-owner', '--no-privileges'], { input: schema });
  if (suite !== 'predecessor') postgres(['psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-1'], { input: migration });
  if (candidate) {
    nativeDirectory = '/app/online-runtime-acceptance/hr-erasure-' + run;
    const setup = `const fs=require('fs'),p=${JSON.stringify(nativeDirectory)};fs.mkdirSync(p,{mode:0o700});
      const fd=fs.openSync(p+'/fixture.cjs','wx',0o400);try{fs.writeFileSync(fd,fs.readFileSync(0));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      const d=fs.openSync(p,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}`;
    verify(); execFileSync('docker', ['exec', '-i', candidate.Id, 'node', '-e', setup], { input: bundle });
    const target = new URL(url.href); target.hostname = 'postgres'; target.port = '5432'; nativeUrl = target.href;
    const bootstrap = `process.umask(0o077);process.chdir(require('path').dirname(process.argv[1]));
      const input=JSON.parse(require('fs').readFileSync(0,'utf8'));process.env.DATABASE_URL=input.databaseUrl;
      Object.defineProperty(globalThis,'__sabalanHrErasureNativeInput',{value:Object.freeze(input),writable:false,configurable:false});require(process.argv[1]);`;
    verify(); result = spawnSync('docker', ['exec', '-i', '-e', 'NODE_PATH=/app/node_modules', candidate.Id,
      'node', '-e', bootstrap, nativeDirectory + '/fixture.cjs'], {
      input: JSON.stringify({ databaseUrl: nativeUrl, migrationSql: migration.toString('utf8') }), encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    });
  } else result = spawnSync(process.execPath, ['--test', entry], { cwd: root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, NODE_PATH: path.join(root, 'backend/node_modules'), DATABASE_URL: url.href, HR_ERASURE_FILE_LOCAL_ACCEPTANCE: '1' } });
} catch (error) { failure = error; }
const redact = text => [url.href, nativeUrl, environment.POSTGRES_PASSWORD, url.password, encodeURIComponent(environment.POSTGRES_PASSWORD)].filter(Boolean)
  .reduce((output, secret) => output.split(secret).join('[LOCAL_DATABASE_SECRET]'), text || '');
const report = { format: 'sabalan-hr-erasure-file-recovery-local/v1', suite, pass: false, productionAdmission: false, nativeDirectory,
  candidateBefore: candidate ? identities({ candidate }).candidate : null,
  sources, bundleSha256: sha(bundle), schemaSha256: sha(schema), database, databaseOid: oid,
  status: result?.status, signal: result?.signal, stdout: redact(result?.stdout), stderr: redact(result?.stderr),
  failure: redact(failure?.message), canonicalBefore: before, isolatedDatabaseRetired: false };
const reportPath = path.join(root, 'reports/qa', 'hr-erasure-file-recovery-' + run + '.json');
const save = () => fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n'); save();
assert.match(report.stdout, native ? /"nativeWorkAndDatabaseClosed":true/ : /HR_ERASURE_TEST_DATABASE_CLIENT_CLOSED/,
  'Retain isolated database until original test client closure is proven: ' + reportPath);
assert.equal(result.signal, null);
assert.equal(postgres(['psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
  `SELECT count(*) FROM pg_stat_activity WHERE datname='${database}'`], { encoding: 'utf8' }).trim(), '0');
assert.equal(postgres(['psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
  `SELECT oid FROM pg_database WHERE datname='${database}'`], { encoding: 'utf8' }).trim(), oid);
postgres(['dropdb', '-U', 'postgres', database]); report.isolatedDatabaseRetired = true; save();
if (failure) throw failure;
assert.equal(result.status, 0, report.stderr + report.stdout);
if (suite === 'native') {
  assert.match(report.stdout, /"nativeDatabaseAndFilesPassed":true/);
  assert.match(report.stdout, /"actualHrRetryRouterPassed":true/); assert.match(report.stdout, /"actualHrRetryHttpClosed":true/);
  assert.match(report.stdout, /"actualHrUploadSafetyPassed":true/);
  assert.match(report.stdout, /"versionedJobApplicationErasurePassed":true/);
  assert.match(report.stdout, /"versionedJobApplicationConcurrencyPassed":true/);
  assert.match(report.stdout, /"versionedJobApplicationObserverClosed":true/);
  assert.match(report.stdout, /"versionedPersonnelErasurePassed":true/);
}
else if (suite === 'profile') assert.match(report.stdout, /"actualHrVersionedProfilePassed":true/);
else { assert.match(report.stdout, /# fail 0\r?\n/); assert.match(report.stdout, /# skipped 0\r?\n/); }
for (const [name, hash] of Object.entries(sources)) assert.equal(sha(fs.readFileSync(path.join(root, name))), hash);
const after = identities(Object.fromEntries(['backend', 'frontend', 'inquiry', 'postgres'].map(name => [name, inspect(name)])));
assert.deepEqual(after, before); report.canonicalAfter = after;
if (candidate) {
  const current = inspect('backend-candidate');
  assert.deepEqual(identities({ candidate: current }).candidate, report.candidateBefore);
  report.candidateAfter = identities({ candidate: current }).candidate;
}
report.pass = true; save();
console.log(JSON.stringify({ pass: true, reportPath }));
