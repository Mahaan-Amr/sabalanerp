import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import readline from 'node:readline';

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
  assert.ok(value.Mounts.some(mount => mount.Type === 'bind' && !mount.RW && mount.Destination === '/app/dist'
    && hostSource(mount.Source) === path.join(root, 'backend/dist')));
  const volume = value.Mounts.find(mount => mount.Type === 'volume' && mount.Destination === '/app/online-runtime-acceptance');
  assert.ok(volume?.RW); assert.equal(volume.Name, 'sabalanerp-local_online_runtime_acceptance'); return volume.Name;
});
assert.equal(volumes[0], volumes[1]);
const operation = 'cross-container-' + randomBytes(16).toString('hex');
const directory = '/app/online-runtime-acceptance/' + operation;
const files = Object.fromEntries(['kernelWriteAdmission', 'runtimeBoundaryJournal', 'runtimeTaskAdmission'].map(name =>
  [name + '.js', fs.readFileSync(path.join(backendDist, 'services', name + '.js'))]));
files['worker.cjs'] = fs.readFileSync(path.join(root, 'tests/online-deployment/runtime-cross-container.worker.cjs'));
const scopes = slots.map(value => ({ runtimeId: randomBytes(32).toString('hex'), image: value.Image,
  registrySha256: createHash('sha256').update(value.Id).digest('hex'), generation: 1 }));
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
    fs.writeFileSync(path.join(root,'configuration-'+index+'.json'),JSON.stringify({root,scope}),{flag:'wx',mode:0o400});}
  console.log(JSON.stringify({root,identity}));`;
verify();
const provisioned = JSON.parse(execFileSync('docker', ['exec', '-i', slots[0].Id, 'node', '-e', provision], {
  input: JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')])), scopes }), encoding: 'utf8' }));
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
await call(0, 'acquire', { reference: 'first' }); assert.equal((await call(1, 'exclusive')).acquired, false);
await call(1, 'acquire', { reference: 'second' }); await call(0, 'release', { reference: 'first' });
assert.equal((await call(1, 'exclusive')).acquired, false);
const draining = await workers[1].request({ operation: 'drain', timeoutMs: 25 }); assert.equal(draining.ok, false); assert.equal(draining.code, 'RUNTIME_TASK_DRAIN_UNPROVEN');
assert.equal((await call(1, 'snapshot')).phase, 'ACTIVE'); assert.equal((await call(0, 'exclusive')).acquired, false);
await call(1, 'release', { reference: 'second' }); await call(1, 'drain', { timeoutMs: 1000 });
assert.equal((await call(1, 'exclusive')).acquired, true);
const refused = await workers[0].request({ operation: 'acquire', reference: 'blocked' });
assert.equal(refused.ok, false); assert.equal(refused.code, 'KERNEL_WRITE_GATE_BOUNDARY_ACTIVE');
assert.equal((await call(0, 'snapshot')).phase, 'QUIESCENT');
await call(1, 'unlock'); await call(0, 'acquire', { reference: 'last' }); await call(0, 'release', { reference: 'last' });
await call(0, 'drain', { timeoutMs: 1000 });
const final = await Promise.all([call(0, 'snapshot'), call(1, 'snapshot')]);
assert.deepEqual(final.map(value => [value.phase, value.epoch]), [['QUIESCENT', 2], ['QUIESCENT', 1]]);
await Promise.all([call(0, 'stop'), call(1, 'stop')]);
for (const outcome of await Promise.all(workers.map(value => value.closed))) {
  assert.equal(outcome.signal, null); assert.equal(outcome.code, 0, outcome.stderr);
}
for (const [service, before] of Object.entries(originals)) {
  const value = inspect(service); assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, before);
}
const report = { crossContainerRuntimeBoundaryPassed: true, privateEvidenceRetained: provisioned.root,
  namespaces: final.map(value => value.birth.pidNamespace), final, originals,
  sourceSha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])),
  evidence: workers.map(value => value.evidence) };
const reportPath = path.join(root, 'reports/qa/runtime-cross-container-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + operation.slice(-8) + '.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ crossContainerRuntimeBoundaryPassed: true, reportPath, privateEvidenceRetained: provisioned.root,
  namespaces: report.namespaces, originals }));
