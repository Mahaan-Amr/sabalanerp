import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

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
const candidateBefore = { id: slot.Id, image: slot.Image, startedAt: slot.State.StartedAt };
assert.ok(slot.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
assert.equal(slot.Image, before.backend.image);
assert.ok(slot.Mounts.some(mount => mount.Type === 'volume' && mount.RW
  && mount.Name === 'sabalanerp-local_online_runtime_acceptance' && mount.Destination === '/app/online-runtime-acceptance'));
const directory = '/app/online-runtime-acceptance/versioned-upload-' + randomBytes(16).toString('hex');
const ts = require('../backend/node_modules/typescript');
const files = { 'fixture.cjs': fs.readFileSync(path.join(root, 'tests/online-deployment/versioned-upload.fixture.cjs')) };
files['reader.worker.py'] = fs.readFileSync(path.join(root, 'tests/online-deployment/versioned-file-reader.worker.py'));
files['recovery-versioned-files.py'] = fs.readFileSync(path.join(root, 'deploy/scripts/recovery-versioned-files.py'));
const sourceHashes = {};
sourceHashes['recovery-versioned-files.py'] = createHash('sha256').update(files['recovery-versioned-files.py']).digest('hex');
for (const name of ['kernelWriteAdmission', 'runtimeBoundaryJournal', 'runtimeTaskAdmission', 'runtimeWorkContext',
  'durableFilePublication', 'versionedFilePublication', 'durableUpload', 'httpRequestLifecycle', 'runtimeWorkBoundary', 'runtimeLeasedWorkContext']) {
  const source = path.join(root, 'backend/src/services', name + '.ts');
  assert.ok(path.isAbsolute(source));
  const bytes = fs.readFileSync(source); sourceHashes[name + '.ts'] = createHash('sha256').update(bytes).digest('hex');
  files[name + '.js'] = Buffer.from(ts.transpileModule(bytes.toString('utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText);
}
const bootstrap = `const fs=require('fs'),path=require('path'),input=JSON.parse(fs.readFileSync(0,'utf8'));
  const root=${JSON.stringify(directory)};fs.mkdirSync(root,{mode:0o700});fs.chmodSync(root,0o700);
  for(const [name,encoded] of Object.entries(input)){if(!new RegExp('^(?:dispatchDocuments/)?[A-Za-z0-9_.-]+$').test(name)||name.includes('..'))throw Error('UNSAFE_SOURCE');
    fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true,mode:0o700});
    const fd=fs.openSync(path.join(root,name),'wx',0o400);try{fs.writeFileSync(fd,Buffer.from(encoded,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}`;
verify(); execFileSync('docker', ['exec', '-i', slot.Id, 'node', '-e', bootstrap], {
  input: JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')]))), encoding: 'utf8',
});
verify();
const output = await new Promise((resolve, reject) => {
  const child = spawn('docker', ['exec', slot.Id, 'node', '--test', directory + '/fixture.cjs'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', bytes => { stdout += bytes; });
  child.stderr.on('data', bytes => { stderr += bytes; });
  child.once('error', reject);
  child.once('close', (code, signal) => {
    if (code === 0 && !signal) { resolve(stdout); return; }
    const reportPath = path.join(root, 'reports/qa', path.basename(directory) + '.failed.json');
    fs.writeFileSync(reportPath, JSON.stringify({ pass: false, code, signal, tap: stdout, stderr,
      workingRoot: directory, sourceHashes,
      sources: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])),
      canonicalServicesBefore: before, canonicalVerification: 'NOT_ACCEPTED', productionAdmission: false }, null, 2) + '\n', { flag: 'wx' });
    reject(Error('VERSIONED_UPLOAD_NATIVE_FIXTURE_FAILED ' + JSON.stringify({ code, signal, reportPath, directory })));
  });
});
assert.match(output, /# fail 0\r?\n/); const report = { format: 'sabalan-versioned-upload-native/v1', pass: true, tap: output, workingRoot: directory };
const reportPath = path.join(root, 'reports/qa', path.basename(directory) + '.json');
const sources = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
// Preserve closed test output before observing shared services. An unrelated
// restart must fail the final gate without losing the expensive diagnostic.
fs.writeFileSync(reportPath.replace(/\.json$/, '.core.json'), JSON.stringify({ ...report, pass: false,
  testAssertionsPassed: true, canonicalVerification: 'PENDING', canonicalServicesBefore: before,
  sourceHashes, sources, productionAdmission: false }, null, 2) + '\n', { flag: 'wx' });
for (const [service, expected] of Object.entries(before)) {
  const value = inspect(service);
  assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, expected);
}
report.canonicalServicesUnchanged = before;
const candidateAfter = inspect('backend-candidate');
assert.deepEqual({ id: candidateAfter.Id, image: candidateAfter.Image, startedAt: candidateAfter.State.StartedAt }, candidateBefore);
report.candidateBefore = candidateBefore;
report.candidateAfter = { id: candidateAfter.Id, image: candidateAfter.Image, startedAt: candidateAfter.State.StartedAt };
report.sourceHashes = sourceHashes;
report.sources = sources;
report.productionAdmission = false;
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: true, reportPath }));
