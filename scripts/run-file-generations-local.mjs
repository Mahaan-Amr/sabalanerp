import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
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
const directory = '/app/online-runtime-acceptance/file-generations-' + randomBytes(16).toString('hex');
const files = Object.fromEntries([
  ['recovery-file-generations.py', 'deploy/scripts/recovery-file-generations.py'],
  ['fixture.py', 'tests/online-deployment/file-generations-native.fixture.py'],
].map(([name, source]) => [name, fs.readFileSync(path.join(root, source))]));
if (process.env.ONLINE_FILE_GENERATIONS_SOURCE_REF) {
  const reference = process.env.ONLINE_FILE_GENERATIONS_SOURCE_REF;
  assert.match(reference, /^[a-f0-9]{40}$/);
  files['recovery-file-generations.py'] = execFileSync('git', ['show', reference + ':deploy/scripts/recovery-file-generations.py'], {
    cwd: root, maxBuffer: 1024 * 1024,
  });
}
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
    : reject(Error('FILE_GENERATION_NATIVE_FIXTURE_FAILED ' + JSON.stringify({ code, signal, stderr, directory }))));
});
const report = JSON.parse(output.trim());
assert.equal(report.format, 'sabalan-file-generations-native/v1'); assert.equal(report.pass, true);
for (const [service, expected] of Object.entries(before)) {
  const value = inspect(service);
  assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, expected);
}
report.canonicalServicesUnchanged = before;
report.sources = Object.fromEntries(Object.entries(files).map(([name, bytes]) =>
  [name, createHash('sha256').update(bytes).digest('hex')]));
const reportPath = path.join(root, 'reports/qa', path.basename(directory) + '.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: true, reportPath, nativeChildSignal: report.nativeChildSignal }));
