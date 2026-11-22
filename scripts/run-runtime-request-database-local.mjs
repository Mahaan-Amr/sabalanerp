import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import readline from 'node:readline';
import { createRequire } from 'node:module';
const { Client } = createRequire(import.meta.url)('pg');

const root = path.resolve(import.meta.dirname, '..');
const backendDist = process.env.ONLINE_ACCEPTANCE_BACKEND_DIST || path.join(root, 'backend/dist');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['postgres', 'backend', 'frontend', 'inquiry', 'backend-candidate', 'backend-retained']) {
    assert.ok(rows.some(row => row.Project === 'sabalanerp-local' && row.Service === service
      && row.State === 'running' && row.Health === 'healthy'), `${service} must already be healthy in sabalanerp-local`);
  }
  return rows;
}
function inspect(service) {
  const row = verify().find(row => row.Service === service);
  const [value] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
  assert.equal(value.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  assert.equal(value.Config.Labels['com.docker.compose.service'], service);
  return value;
}
const originals = Object.fromEntries(['backend', 'frontend', 'inquiry', 'postgres'].map(service => {
  const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
}));
const slots = ['backend-candidate', 'backend-retained'].map(inspect);
assert.notEqual(slots[0].Id, slots[1].Id);
const hostSource = source => path.resolve(process.platform === 'win32'
  ? source.replace(/^\/run\/desktop\/mnt\/host\/([a-z])\//, (_match, drive) => drive.toUpperCase() + ':/') : source);
const volumes = slots.map(value => {
  assert.ok(value.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(value.Image));
  assert.equal(value.Image, originals.backend.image);
  assert.ok(value.Mounts.some(mount => mount.Type === 'bind' && !mount.RW && mount.Destination === '/app/dist'
    && hostSource(mount.Source) === path.join(root, 'backend/dist')));
  const volume = value.Mounts.find(mount => mount.Type === 'volume' && mount.Destination === '/app/online-runtime-acceptance');
  assert.ok(volume?.RW); assert.equal(volume.Name, 'sabalanerp-local_online_runtime_acceptance'); return volume.Name;
});
assert.equal(volumes[0], volumes[1]);
const operation = 'request-database-' + randomBytes(16).toString('hex');
const directory = '/app/online-runtime-acceptance/' + operation;
const files = Object.fromEntries(['kernelWriteAdmission', 'runtimeBoundaryJournal', 'runtimeTaskAdmission', 'runtimeWorkContext', 'runtimeLeasedWorkContext', 'httpRequestLifecycle', 'runtimeWorkBoundary', 'runtimeDatabaseBoundary'].map(name =>
  [name + '.js', fs.readFileSync(path.join(backendDist, 'services', name + '.js'))]));
files['worker.cjs'] = fs.readFileSync(path.join(root, 'tests/online-deployment/runtime-request-database.worker.cjs'));
const scopes = slots.map(value => ({ runtimeId: randomBytes(32).toString('hex'), image: value.Image,
  registrySha256: createHash('sha256').update(value.Id).digest('hex'), generation: 1 }));
// No business schema/data copy and no additional PostgreSQL service.
const sourceUrl = new URL(process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL ||
  'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?connection_limit=2&pool_timeout=10');
assert.equal(sourceUrl.protocol, 'postgresql:');
assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(sourceUrl.host)); assert.equal(sourceUrl.pathname, '/sabalanerp');
assert.equal(sourceUrl.searchParams.get('connection_limit'), '2'); assert.equal(sourceUrl.searchParams.get('pool_timeout'), '10');
assert.equal(sourceUrl.searchParams.has('options'), false);
const databaseName = 'sabalanerp_concurrency_' + randomBytes(8).toString('hex');
sourceUrl.pathname = '/postgres'; sourceUrl.searchParams.set('application_name', 'sabalan-request-probe-admin');
const administrator = new Client({ connectionString: sourceUrl.toString() });
sourceUrl.pathname = '/' + databaseName; sourceUrl.searchParams.set('application_name', 'sabalan-request-probe-observer');
const observer = new Client({ connectionString: sourceUrl.toString() });
let provenClosed = false;
let report, reportPath;
try {
await administrator.connect();
await administrator.query(`CREATE DATABASE "${databaseName}"`);
await observer.connect();
await observer.query('CREATE TABLE runtime_request_probe (id text PRIMARY KEY, runtime_id text NOT NULL, amount numeric(24,8) NOT NULL, quantity numeric(24,8) NOT NULL)');
const provision = `const fs=require('fs'),path=require('path');const input=JSON.parse(fs.readFileSync(0,'utf8'));
  const root=${JSON.stringify(directory)};fs.mkdirSync(root,{mode:0o700});fs.chmodSync(root,0o700);
  for(const[name,source]of Object.entries(input.files)){if(path.basename(name)!==name)throw Error('UNSAFE_SOURCE');
    fs.writeFileSync(path.join(root,name),Buffer.from(source,'base64'),{flag:'wx',mode:0o400});}
  const gate=path.join(root,'deployment-write-admission.lock');fs.writeFileSync(gate,'',{mode:0o600,flag:'wx'});
  const stat=fs.statSync(gate,{bigint:true}),identity={device:String(stat.dev),inode:String(stat.ino),ownerUid:Number(stat.uid)};
  const {runtimeBoundaryProvisionBytes,runtimePostgresApplicationName}=require(path.join(root,'runtimeBoundaryJournal'));
  for(let index=0;index<input.scopes.length;index++){const scope={...input.scopes[index],gate:identity,
    postgresApplicationName:runtimePostgresApplicationName(input.scopes[index].runtimeId)};
    fs.mkdirSync(path.join(root,scope.runtimeId),{mode:0o700});
    fs.writeFileSync(path.join(root,scope.runtimeId,'scope.json'),runtimeBoundaryProvisionBytes(scope),{flag:'wx',mode:0o600});
    fs.writeFileSync(path.join(root,'configuration-'+index+'.json'),JSON.stringify({root,scope,databaseName:input.databaseName}),{flag:'wx',mode:0o400});}
  console.log(JSON.stringify({root,identity}));`;
verify();
const provisioned = JSON.parse(execFileSync('docker', ['exec', '-i', slots[0].Id, 'node', '-e', provision], {
  input: JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')])), scopes, databaseName }), encoding: 'utf8' }));
function worker(index) {
  verify();
  const child = spawn('docker', ['exec', '-i', slots[index].Id, 'node', directory + '/worker.cjs', directory + '/configuration-' + index + '.json'],
    { stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map(); let sequence = 0, bytes = 0, readyResolve, readyReject;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const lines = readline.createInterface({ input: child.stdout });
  const evidence = [];
  lines.on('line', line => {
    bytes += Buffer.byteLength(line); if (bytes > 1024 * 1024) { readyReject(Error('EVIDENCE_BOUND_EXCEEDED')); return; }
    let value; try { value = JSON.parse(line); } catch { readyReject(Error('FIXTURE_PROTOCOL_INVALID')); return; }
    evidence.push(value);
    if (value.ready) readyResolve(value.snapshot);
    else if (value.failed) readyReject(Error(value.code));
    else { const waiter = pending.get(value.id); pending.delete(value.id); waiter?.resolve(value); }
  });
  let stderr = ''; child.stderr.on('data', chunk => { if (stderr.length < 8192) stderr += chunk.toString(); });
  child.stdin.on('error', () => {});
  const closed = new Promise((resolve, reject) => {
    child.on('error', error => { readyReject(error); reject(error); });
    child.on('close', (code, signal) => {
      const outcome = { code, signal, stderr }; readyReject(Error('WORKER_ENDED_BEFORE_READY'));
      for (const waiter of pending.values()) waiter.reject(Error('WORKER_ENDED_BEFORE_COMPLETION'));
      resolve(outcome);
    });
  });
  const request = command => new Promise((resolve, reject) => {
    const id = ++sequence; pending.set(id, { resolve, reject }); child.stdin.write(JSON.stringify({ ...command, id }) + '\n');
  });
  return { ready, request, closed, evidence };
}
const workers = [worker(0), worker(1)];
const [first, second] = await Promise.all(workers.map(value => value.ready));
assert.notEqual(first.birth.pidNamespace, second.birth.pidNamespace);
assert.equal(first.birth.bootId, second.birth.bootId); assert.deepEqual(first.scope.gate, second.scope.gate);
const call = async (index, operation, extra = {}) => {
  const response = await workers[index].request({ operation, ...extra }); assert.equal(response.ok, true, JSON.stringify(response)); return response.value;
};
const rows = async () => (await observer.query('SELECT id, runtime_id, amount::text, quantity::text FROM runtime_request_probe ORDER BY id')).rows;
await call(0, 'begin', { reference: 'early-response', mode: 'early' });
assert.equal((await call(1, 'exclusive')).acquired, false);
await call(0, 'begin', { reference: 'lost-response', mode: 'disconnect' });
await call(1, 'begin', { reference: 'background', mode: 'background' });
assert.deepEqual(await rows(), []);
await call(0, 'finish', { reference: 'early-response' });
assert.equal((await rows()).length, 1); assert.equal((await call(1, 'exclusive')).acquired, false);
await call(1, 'finish', { reference: 'background' });
assert.equal((await rows()).length, 2); assert.equal((await call(1, 'snapshot')).phase, 'QUIESCENT');
assert.equal((await call(1, 'exclusive')).acquired, false);
const draining = await workers[0].request({ operation: 'drain', timeoutMs: 25 });
assert.equal(draining.ok, false); assert.ok(['HTTP_REQUEST_DRAIN_TIMEOUT', 'RUNTIME_TASK_DRAIN_UNPROVEN'].includes(draining.code));
assert.equal((await call(0, 'snapshot')).phase, 'ACTIVE');
await call(0, 'refused-http', { reference: 'retiring-refused' });
assert.equal((await rows()).length, 2); assert.equal((await call(1, 'exclusive')).acquired, false);
await call(0, 'finish', { reference: 'lost-response' }); await call(0, 'drain', { timeoutMs: 1000 });
assert.equal((await rows()).length, 3); assert.equal((await call(1, 'exclusive')).acquired, true);
const waiting = await call(1, 'waiting-http', { reference: 'fresh-response' });
assert.equal(waiting.handlerEntered, false); assert.equal(waiting.answered, false);
assert.equal(waiting.snapshot.phase, 'QUIESCENT'); assert.equal((await rows()).length, 3);
await call(1, 'unlock');
await call(1, 'await-http-entry', { reference: 'fresh-response' }); await call(1, 'finish', { reference: 'fresh-response' });
await call(1, 'drain', { timeoutMs: 1000 });
const expected = [
  { id: 'background', runtime_id: second.scope.runtimeId, amount: '123456789.12345678', quantity: '0.00000001' },
  { id: 'early-response', runtime_id: first.scope.runtimeId, amount: '123456789.12345678', quantity: '0.00000001' },
  { id: 'fresh-response', runtime_id: second.scope.runtimeId, amount: '123456789.12345678', quantity: '0.00000001' },
  { id: 'lost-response', runtime_id: first.scope.runtimeId, amount: '123456789.12345678', quantity: '0.00000001' },
];
const committedRows = await rows(); assert.deepEqual(committedRows, expected);
const final = await Promise.all([call(0, 'snapshot'), call(1, 'snapshot')]);
assert.deepEqual(final.map(value => [value.phase, value.epoch]), [['QUIESCENT', 1], ['QUIESCENT', 2]]);
await Promise.all([call(0, 'stop'), call(1, 'stop')]);
for (const outcome of await Promise.all(workers.map(value => value.closed))) {
  assert.equal(outcome.signal, null); assert.equal(outcome.code, 0, outcome.stderr);
}
const remaining = await observer.query('SELECT application_name FROM pg_stat_activity WHERE datname = $1 AND application_name = ANY($2::text[])',
  [databaseName, final.map(value => value.scope.postgresApplicationName)]);
assert.deepEqual(remaining.rows, []);
assert.equal((await observer.query('SELECT count(*)::text AS count FROM pg_prepared_xacts WHERE database = current_database()')).rows[0].count, '0');
provenClosed = true;
for (const [service, before] of Object.entries(originals)) {
  const value = inspect(service); assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, before);
}
report = { crossContainerRequestDatabasePassed: true, privateEvidenceRetained: provisioned.root,
  slots: slots.map(value => ({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt })),
  committedRows, databaseName, namespaces: final.map(value => value.birth.pidNamespace), final, originals,
  sourceSha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])),
  evidence: workers.map(value => value.evidence) };
reportPath = path.join(root, 'reports/qa/runtime-request-database-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + operation.slice(-8) + '.json');

} finally {
  await observer.end();
  try {
    // Never FORCE, terminate sessions, cancel SQL, or delete failed evidence.
    if (provenClosed) { verify(); await administrator.query(`DROP DATABASE "${databaseName}"`); }
  } finally { await administrator.end(); }
}
assert.equal(provenClosed, true); report.temporaryDatabaseDroppedWithoutForce = true;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ crossContainerRequestDatabasePassed: true, reportPath,
  privateEvidenceRetained: report.privateEvidenceRetained, namespaces: report.namespaces, originals }));
