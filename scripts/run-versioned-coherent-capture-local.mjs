import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'backend/package.json'));
const ts = require('typescript');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
process.env.SABALAN_LOCAL_REPOSITORY_ROOT = canonical;
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const name of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === name && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(row => row.Service === service); assert.ok(row);
  const [value] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
  assert.equal(value.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  return value;
}
const before = Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => {
  const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
}));
const slot = inspect('backend-candidate');
assert.ok(slot.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
assert.equal(slot.Image, before.backend.image);
assert.ok(slot.Mounts.some(mount => mount.Type === 'volume' && mount.RW
  && mount.Name === 'sabalanerp-local_online_runtime_acceptance' && mount.Destination === '/app/online-runtime-acceptance'));
const databaseHarnessPath = path.join(root, 'backend/src/services/__tests__/shipmentStatementConcurrency/database.ts');
const harness = new Module(databaseHarnessPath);
harness.filename = databaseHarnessPath;
harness.paths = Module._nodeModulePaths(path.dirname(databaseHarnessPath));
harness._compile(ts.transpileModule(fs.readFileSync(databaseHarnessPath, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText, databaseHarnessPath);
const temporary = await harness.exports.createTemporaryConcurrencyDatabase({ repositoryRoot: root,
  sourceDatabaseUrl: process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL
    || 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10',
  migrateEmptySchema: true });
const client = temporary.client();
let report;
try {
  const [identity] = await client.$queryRawUnsafe('SELECT system_identifier::text AS identity FROM pg_control_system()');
  assert.equal(identity.identity, '7667464637415309346');
  await client.$disconnect();
  const directory = '/app/online-runtime-acceptance/versioned-coherent-' + randomBytes(16).toString('hex');
  const files = Object.fromEntries([
    ['recovery-file-generations.py', 'deploy/scripts/recovery-file-generations.py'],
    ['recovery-database-freeze.py', 'deploy/scripts/recovery-database-freeze.py'],
    ['backend-runtime-owner.py', 'deploy/scripts/backend-runtime-owner.py'],
    ['capture-coherent-components.py', 'deploy/scripts/capture-coherent-components.py'],
    ['fixture.py', 'tests/online-deployment/versioned-coherent-capture.fixture.py'],
    ['publisher.cjs', 'tests/online-deployment/versioned-coherent-capture.fixture.cjs'],
    ['coherent-versioned-file-cuts.py', 'deploy/scripts/coherent-versioned-file-cuts.py'],
    ['recovery-versioned-files.py', 'deploy/scripts/recovery-versioned-files.py'],
  ].map(([name, source]) => [name, fs.readFileSync(path.join(root, source))]));
  const sourceHashes = {};
  for (const name of ['kernelWriteAdmission','runtimeBoundaryJournal','runtimeTaskAdmission','runtimeWorkContext','durableFilePublication','versionedFilePublication']) {
    const bytes=fs.readFileSync(path.join(root,'backend/src/services',name+'.ts'));
    sourceHashes[name+'.ts']=createHash('sha256').update(bytes).digest('hex');
    files[name+'.js']=Buffer.from(ts.transpileModule(bytes.toString('utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
  }
  files['config.json'] = Buffer.from(JSON.stringify({ databaseName: temporary.databaseName, systemIdentifier: identity.identity }));
  const bootstrap = `const fs=require('fs'),path=require('path'),input=JSON.parse(fs.readFileSync(0,'utf8'));
    const root=${JSON.stringify(directory)};fs.mkdirSync(root,{mode:0o700});fs.chmodSync(root,0o700);
    for(const [name,encoded] of Object.entries(input)){if(!/^[A-Za-z0-9_.-]+$/.test(name))throw Error('UNSAFE_SOURCE');
      const fd=fs.openSync(path.join(root,name),'wx',0o400);try{fs.writeFileSync(fd,Buffer.from(encoded,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
    const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}`;
  verify(); execFileSync('docker', ['exec', '-i', slot.Id, 'node', '-e', bootstrap], {
    input: JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')]))), encoding: 'utf8',
  });
  verify();
  const output = await new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', slot.Id, 'python3', '-B', directory + '/fixture.py', directory], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', bytes => { stdout += bytes; });
    child.stderr.on('data', bytes => { stderr += bytes; });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 && !signal ? resolve(stdout)
      : reject(Error('COHERENT_CAPTURE_NATIVE_FAILED ' + JSON.stringify({ code, signal, stderr, directory, databaseName: temporary.databaseName }))));
  });
  report = JSON.parse(output.trim());
  assert.equal(report.format, 'sabalan-versioned-coherent-native/v1');
  assert.equal(report.nativeCompletionProven, true);
  assert.equal(report.pass, true);
  for (const [service, expected] of Object.entries(before)) {
    const value = inspect(service);
    assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, expected);
  }
  report.canonicalServicesUnchanged = before;
  report.sourceHashes = sourceHashes;
  report.sources = Object.fromEntries(Object.entries(files).map(([name, bytes]) =>
    [name, createHash('sha256').update(bytes).digest('hex')]));
  // Exact native actor closure precedes ordinary OID-bound database retirement.
  const [activity] = await client.$queryRawUnsafe('SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid())+(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()) AS count');
  assert.equal(Number(activity.count),0);
  const [databaseIdentity] = await client.$queryRawUnsafe('SELECT oid::text AS oid FROM pg_database WHERE datname=current_database()');
  assert.equal(databaseIdentity.oid, report.sourceDatabaseOid);
  await client.$disconnect();
  await temporary.cleanup();
  report.sourceTemporaryDatabaseDroppedWithoutForce = true;
  const reportPath = path.join(root, 'reports/qa', path.basename(directory) + '.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ pass: true, reportPath, lockedRelations: report.lockedRelations, migrationCount: report.migrationCount }));
} finally {
  await client.$disconnect();
  // Failed native runs are retained; no timeout or unknown result authorizes deletion.
}
