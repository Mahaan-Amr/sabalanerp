import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(root, 'backend/package.json'));
const ts = require('typescript');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const captureAdmission = process.env.ONLINE_ACCEPTANCE_CAPTURE_ADMISSION === '1';
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
const retained = inspect('backend-retained');
assert.ok(retained.Mounts.some(m => m.Destination === '/run/sabalan-online' && !m.RW));
assert.ok(!retained.Mounts.some(m => m.Destination === '/app/runtime-authority'));
const directory = '/app/online-runtime-acceptance/online-native-' + randomBytes(16).toString('hex');
const files = Object.fromEntries([
  ['backend-runtime-owner.py', 'deploy/scripts/backend-runtime-owner.py'],
  ['online-runtime-owner.py', 'deploy/scripts/online-runtime-owner.py'],
  ['online-runtime-scope.py', 'deploy/scripts/online-runtime-scope.py'],
  ['online-capture-admission.py', 'deploy/scripts/online-capture-admission.py'],
  ['online-backend-boundary.py', 'deploy/scripts/online-backend-boundary.py'],
  ['online-inquiry-boundary.py', 'deploy/scripts/online-inquiry-boundary.py'],
  ['recovery-file-generations.py', 'deploy/scripts/recovery-file-generations.py'],
  ['capture-coherent-components.py', 'deploy/scripts/capture-coherent-components.py'],
  ['recovery-database-freeze.py', 'deploy/scripts/recovery-database-freeze.py'],
  ['with-backend-control-ownership.sh', 'deploy/scripts/with-backend-control-ownership.sh'],
  ['protected-bootstrap-state.py', 'deploy/scripts/protected-bootstrap-state.py'],
  ['worker.cjs', 'tests/online-deployment/online-scoped-work.worker.cjs'],
  ['native-worker.cjs', 'tests/online-deployment/online-native-owner.worker.cjs'],
  ['fixture.py', 'tests/online-deployment/online-native-owner.fixture.py'],
  ['records.fixture.py', 'tests/online-deployment/native-record-refusal.fixture.py'],
  ['capture.fixture.py', 'tests/online-deployment/online-native-capture.fixture.py'],
  ['admission.fixture.cjs', 'tests/online-deployment/online-capture-admission.fixture.cjs'],
  ['capacity.fixture.py', 'tests/online-deployment/online-capture-capacity.fixture.py'],
].map(([name, source]) => [name, fs.readFileSync(path.join(root, source))]));
const deploymentSource = fs.readFileSync(path.join(root, 'deploy/scripts/deploy.sh'), 'utf8');
const closureFunction = deploymentSource.match(/assert_native_runtime_closed\(\) \{[\s\S]+?\n\}\n\ndrain_current_services\(\)/)?.[0]
  .replace(/\n\ndrain_current_services\(\)$/, '');
assert.ok(closureFunction, 'actual protected release/rollback boundary function must be tested');
files['streamed-closure.fixture.sh'] = Buffer.from('run_backend() { "$@"; }\n' + closureFunction + '\nassert_native_runtime_closed\n');
files['deploy/scripts/backend-runtime-owner.py'] = files['backend-runtime-owner.py'];
for (const [name, source] of [[ 'services/onlineRuntimeWork.js', 'backend/src/services/onlineRuntimeWork.ts'],
  ...['onlineCaptureAdmission', 'kernelWriteAdmission', 'runtimeBoundaryJournal', 'runtimeTaskAdmission', 'runtimeWorkContext', 'runtimeLeasedWorkContext', 'runtimeWorkBoundary', 'httpRequestLifecycle', 'durableUpload', 'durableFilePublication', 'versionedFilePublication', 'recoveryRuntime', 'recoveryCoordinationState', 'recoveryOperationAdmission', 'deploymentMaintenance'].map(name => ['services/' + name + '.js', 'backend/src/services/' + name + '.ts']),
  ['lib/prisma.js', 'backend/src/lib/prisma.ts'],
  ['services/runtimeControlOwnership.js', 'backend/src/services/runtimeControlOwnership.ts'],
  ['services/onlineRuntimeScope.js', 'backend/src/services/onlineRuntimeScope.ts'],
  ['services/runtimeNativeAuthority.js', 'backend/src/services/runtimeNativeAuthority.ts']]) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, source), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  });
  files[name] = Buffer.from(output.outputText);
}
files['services/online-runtime-scope.py'] = files['online-runtime-scope.py'];
const bootstrap = `const fs=require('fs'),path=require('path');const input=JSON.parse(fs.readFileSync(0,'utf8'));
  const root=${JSON.stringify(directory)};fs.mkdirSync(root,{mode:0o700});fs.chmodSync(root,0o700);
  for(const [name,encoded] of Object.entries(input)){if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.includes('..'))throw Error('UNSAFE_SOURCE');
    const target=path.join(root,name);fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    const fd=fs.openSync(target,'wx',0o400);try{fs.writeFileSync(fd,Buffer.from(encoded,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}`;
verify();
execFileSync('docker', ['exec', '-i', slot.Id, 'node', '-e', bootstrap], {
  input: JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')]))),
  encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
});
verify();
const recordOutput = execFileSync('docker', ['exec', retained.Id, 'python3', '-I', '-B', directory + '/records.fixture.py', directory],
  { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
const recordRefusals = JSON.parse(recordOutput);
assert.equal(recordRefusals.passResult, true);
verify();
const prepared = execFileSync('docker', ['exec', slot.Id, 'python3', '-I', '-B', directory + '/fixture.py', directory, captureAdmission ? 'prepare-admission' : 'prepare'],
  { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
assert.equal(JSON.parse(prepared).prepared, true);
let admissionReaders;
let admissionCapacity;
if (captureAdmission) {
  verify();
  admissionCapacity = JSON.parse(execFileSync('docker', ['exec', retained.Id, 'python3', '-I', '-B', directory + '/capacity.fixture.py', directory],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024 }));
  assert.equal(admissionCapacity.passResult, true);
  verify();
  admissionReaders = JSON.parse(execFileSync('docker', ['exec', retained.Id, 'node', directory + '/admission.fixture.cjs', directory],
    { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 }));
  assert.equal(admissionReaders.pass, true);
}
verify();
const output = execFileSync('docker', ['exec', retained.Id, 'python3', '-I', '-B', directory + '/fixture.py', directory, 'scoped-exercise'],
  { encoding: 'utf8', timeout: 90_000, maxBuffer: 1024 * 1024 });
const report = JSON.parse(output.trim());
assert.equal(report.format, 'sabalan-online-native-acceptance/v1');
for (const [service, identity] of Object.entries(before)) {
  const value = inspect(service);
  assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, identity);
}
report.canonicalServicesUnchanged = before;
report.unknownRecordRefusals = recordRefusals;
if (admissionReaders) report.admissionReaders = admissionReaders;
if (admissionCapacity) report.admissionCapacity = admissionCapacity;
report.sources = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
const reportPath = path.join(root, 'reports/qa', path.basename(directory) + '.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ pass: true, reportPath, ...report }));
