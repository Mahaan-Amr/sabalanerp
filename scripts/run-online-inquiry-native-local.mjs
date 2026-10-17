import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const ts = createRequire(path.join(root, 'backend/package.json'))('typescript');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const compose = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...compose, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row =>
    row.Project === 'sabalanerp-local' && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(row => row.Service === service); assert.ok(row);
  const [value] = JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }));
  assert.equal(value.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
  return value;
}
function identities() {
  return Object.fromEntries(['backend', 'frontend', 'postgres', 'inquiry'].map(service => {
    const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
  }));
}
const before = identities(), issuer = inspect('backend-candidate'), consumer = inspect('backend-retained');
assert.equal(consumer.Image, before.backend.image);
assert.ok(issuer.Mounts.some(value => value.Destination === '/app/runtime-authority' && value.RW
  && value.Name === 'sabalanerp-local_online_runtime_authority'));
assert.ok(consumer.Mounts.some(value => value.Destination === '/run/sabalan-online' && !value.RW
  && value.Name === 'sabalanerp-local_online_runtime_authority'));
assert.ok(!consumer.Mounts.some(value => value.Name === 'sabalanerp-local_online_runtime_authority' && value.RW));
for (const value of [issuer, consumer]) assert.ok(value.Mounts.some(mount => mount.RW
  && mount.Name === 'sabalanerp-local_online_runtime_acceptance' && mount.Destination === '/app/online-runtime-acceptance'));
const postgres = inspect('postgres');
const inquiry = inspect('inquiry');
verify();
const sqliteClient = execFileSync('docker', ['exec', inquiry.Id, 'tar', '-C', '/app/node_modules', '-czf', '-', '.prisma/client', '@prisma/client'],
  { maxBuffer: 64 * 1024 * 1024, timeout: 30000 });
assert.ok(sqliteClient.length > 1024 && sqliteClient.length < 64 * 1024 * 1024);
verify();
const clientEntries = execFileSync('docker', ['exec', '-i', issuer.Id, 'tar', '-tzf', '-'],
  { input: sqliteClient, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 10000 }).trim().split('\n');
assert.ok(clientEntries.length > 1 && clientEntries.length < 2048);
for (const name of clientEntries) assert.ok(/^(?:\.prisma\/client|@prisma\/client)(?:\/|$)/.test(name)
  && !name.split('/').includes('..') && !name.includes('\\'));
verify();
const systemIdentifier = execFileSync('docker', ['exec', postgres.Id, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atqc',
  'SELECT system_identifier::text FROM pg_control_system()'], { encoding: 'utf8', timeout: 10000 }).trim();
assert.match(systemIdentifier, /^[1-9][0-9]+$/);
const directory = '/app/online-runtime-acceptance/inquiry-native-' + randomBytes(16).toString('hex');
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const files = Object.fromEntries([
  ['online-inquiry-owner.py', 'deploy/scripts/online-inquiry-owner.py'],
  ['online-runtime-scope.py', 'deploy/scripts/online-runtime-scope.py'],
  ['backend-runtime-owner.py', 'deploy/scripts/backend-runtime-owner.py'],
  ['online-capture-admission.py', 'deploy/scripts/online-capture-admission.py'],
  ['inquiry-worker.cjs', 'tests/online-deployment/online-inquiry-native.worker.cjs'],
  ['sqlite-worker.py', 'tests/online-deployment/online-inquiry-sqlite.worker.py'],
  ['fixture.py', 'tests/online-deployment/online-inquiry-native.fixture.py'],
  ['faults.fixture.py', 'tests/online-deployment/online-inquiry-faults.fixture.py'],
  ['prisma-worker.cjs', 'tests/online-deployment/online-inquiry-prisma.worker.cjs'],
].map(([name, file]) => [name, fs.readFileSync(path.join(root, file))]));
files['services/online-runtime-scope.py'] = files['online-runtime-scope.py'];
const bundleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-inquiry-native-bundle-'));
const bundleSource = path.join(bundleRoot, 'source'), bundleOutput = path.join(bundleRoot, 'output');
fs.mkdirSync(bundleSource);
for (const name of ['onlineInquiryWork', 'onlineRuntimeScope', 'onlineCaptureAdmission', 'kernelWriteAdmission',
  'runtimeBoundaryJournal', 'runtimeTaskAdmission', 'runtimeWorkContext']) fs.copyFileSync(path.join(root, 'backend/src/services', name + '.ts'), path.join(bundleSource, name + '.ts'));
fs.copyFileSync(path.join(root, 'deploy/scripts/online-runtime-scope.py'), path.join(bundleSource, 'online-runtime-scope.py'));
execFileSync(process.execPath, [path.join(root, 'scripts/build-inquiry-runtime-bundle.mjs'), bundleSource, bundleOutput], {
  cwd: path.join(root, 'apps/sabalan-inquiry'), encoding: 'utf8', timeout: 30000,
});
for (const name of fs.readdirSync(bundleOutput)) {
  if (name === 'services') for (const service of fs.readdirSync(path.join(bundleOutput, name))) files['online-runtime/services/' + service] = fs.readFileSync(path.join(bundleOutput, name, service));
  else files['online-runtime/' + name] = fs.readFileSync(path.join(bundleOutput, name));
}
for (const name of ['prisma', 'runtime-work']) files['app-lib/' + name + '.js'] = Buffer.from(ts.transpileModule(
  fs.readFileSync(path.join(root, 'apps/sabalan-inquiry/lib', name + '.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText);
for (const name of ['onlineInquiryWork', 'onlineRuntimeScope', 'onlineCaptureAdmission', 'kernelWriteAdmission',
  'runtimeBoundaryJournal', 'runtimeTaskAdmission', 'runtimeWorkContext']) {
  files['services/' + name + '.js'] = Buffer.from(ts.transpileModule(fs.readFileSync(path.join(root, 'backend/src/services', name + '.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText);
}
const setup = `const fs=require('fs'),path=require('path'),crypto=require('crypto');
const input=JSON.parse(fs.readFileSync(0,'utf8'));const root=input.directory;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encode=value=>Buffer.from(JSON.stringify(canonical(value))+'\\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const mkdir=directory=>{fs.mkdirSync(directory,{mode:0o700});};
const write=(file,bytes,mode=0o400)=>{const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const sync=directory=>{const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
mkdir(root);mkdir(root+'/services');mkdir(root+'/app-lib');mkdir(root+'/online-runtime');mkdir(root+'/online-runtime/services');mkdir(root+'/node_modules');
for(const [name,base64]of Object.entries(input.files)){if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.includes('..'))throw Error('SOURCE_PATH_UNSAFE');write(path.join(root,name),Buffer.from(base64,'base64'));}
const coord=root+'/coordination';mkdir(coord);mkdir(coord+'/online');mkdir(coord+'/online/native');mkdir(coord+'/online/work');mkdir(coord+'/online/admission');mkdir(coord+'/online/admission/staging');
const lock=file=>{write(file,Buffer.alloc(0),0o600);const value=fs.statSync(file,{bigint:true});return{file,device:String(value.dev),inode:String(value.ino),ownerUid:Number(value.uid)};};
const gate=lock(coord+'/deployment-write-admission.lock'),interlock=lock(coord+'/deployment-runtime-control.lock'),worker=lock(coord+'/deployment-online-worker.lock');
const database={systemIdentifier:input.systemIdentifier,name:'sabalanerp'};
const definition=encode({format:'sabalan-online-admission-scope/v1',gate,interlock,worker,database});write(coord+'/online/admission/scope.json',definition);
write(coord+'/online/admission/00000000.json',encode({format:'sabalan-online-capture-admission/v1',generation:0,phase:'OPEN',previousSha256:null,capture:null,closureSha256:null}));
const {runtimeBoundaryProvisionBytes,runtimeNativePostgresApplicationName}=require(root+'/services/runtimeBoundaryJournal');
const prepared={};
for(const name of ['normal','lost-node','prisma-actions','stderr-failure','legacy-race']){
 const runtimeId=crypto.randomBytes(32).toString('hex'),nativeDirectory=coord+'/online/native/'+runtimeId,boundaryDirectory=coord+'/online/work/'+runtimeId;
 mkdir(nativeDirectory);mkdir(boundaryDirectory);lock(nativeDirectory+'/deployment-runtime-control.lock');
 const scope={format:'sabalan-online-runtime-scope/v2',runtimeId,releaseId:'private-inquiry-native-diagnostic',manifestSha256:input.manifestSha256,sourceCommit:input.sourceCommit,image:input.image,nonce:crypto.randomBytes(32).toString('hex'),purpose:'http',role:'serving',coordinationDirectory:coord,nativeDirectory,boundaryDirectory,gate,interlock,worker:null,database,admission:{directory:coord+'/online/admission',scopeSha256:sha(definition)}};
 const raw=encode(scope);write('/app/runtime-authority/'+runtimeId+'.json',raw);sync('/app/runtime-authority');
 const {file,...identity}=gate;
 write(boundaryDirectory+'/scope.json',runtimeBoundaryProvisionBytes({runtimeId,image:scope.image,registrySha256:scope.manifestSha256,generation:1,postgresApplicationName:runtimeNativePostgresApplicationName(runtimeId),gate:identity}),0o600);
 sync(nativeDirectory);sync(boundaryDirectory);prepared[name]={runtimeId,file:'/run/sabalan-online/'+runtimeId+'.json',sha256:sha(raw)};
}
write(root+'/prepared.json',encode(prepared));
for(const value of ['services','coordination/online/native','coordination/online/work','coordination/online/admission/staging','coordination/online/admission','coordination/online','coordination',''])sync(path.join(root,value));
console.log(JSON.stringify({prepared:true}));`;
const sourceHashes = Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, createHash('sha256').update(bytes).digest('hex')]));
const sqliteClientArchiveSha256 = createHash('sha256').update(sqliteClient).digest('hex');
const manifestSha256 = createHash('sha256').update(JSON.stringify({ sourceHashes, sqliteClientArchiveSha256 })).digest('hex');
verify();
execFileSync('docker', ['exec', '-i', issuer.Id, 'node', '-e', setup], {
  input: JSON.stringify({ directory, sourceCommit, systemIdentifier, image: consumer.Image, manifestSha256,
    files: Object.fromEntries(Object.entries(files).map(([file, bytes]) => [file, bytes.toString('base64')])) }),
  encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
});
verify();
execFileSync('docker', ['exec', '-i', issuer.Id, 'tar', '-xzf', '-', '-C', directory + '/node_modules'],
  { input: sqliteClient, maxBuffer: 1024 * 1024, timeout: 30000 });
verify();
let evidence;
try {
  evidence = JSON.parse(execFileSync('docker', ['exec', consumer.Id, 'python3', '-I', '-B', directory + '/fixture.py', directory], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024,
  }));
} catch (error) {
  console.error('INQUIRY_DIAGNOSTIC_RETAINED', directory);
  throw error;
}
const after = identities(); assert.deepEqual(after, before);
const report = { ...evidence, directory, sourceCommit, manifestSha256, sourceHashes, canonicalUnchanged: after,
  actualConsumerImage: consumer.Image, actualSQLiteClientImage: inquiry.Image, sqliteClientArchiveSha256, independentRecovery: false };
const file = path.join(root, 'reports/qa', path.basename(directory) + '.json');
fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ report: file, ...evidence }));
