import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { inspectPrivateDockerArchive } from './lib/private-docker-image-archive.mjs';

const root = path.resolve(import.meta.dirname, '..');
assert.equal(process.argv.length, 3, 'Supply the owned diagnostic image receipt');
const receiptFile = fs.realpathSync(process.argv[2]), receipt = JSON.parse(fs.readFileSync(receiptFile, 'utf8'));
assert.equal(receipt.format, 'sabalan-inquiry-native-image-diagnostic/v1');
assert.match(receipt.image, /^sha256:[a-f0-9]{64}$/);
assert.equal(receipt.diagnosticObserverSha256, createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'tests/online-deployment/inquiry-http-observer.fixture.cjs'))).digest('hex'));
const runtimeSources = Object.fromEntries(['onlineInquiryWork', 'onlineRuntimeScope', 'onlineCaptureAdmission', 'kernelWriteAdmission',
  'runtimeBoundaryJournal', 'runtimeTaskAdmission', 'runtimeWorkContext'].map(name => [name + '.ts', createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'backend/src/services', name + '.ts'))).digest('hex')]));
runtimeSources['online-runtime-scope.py'] = createHash('sha256').update(fs.readFileSync(path.join(root, 'deploy/scripts/online-runtime-scope.py'))).digest('hex');
assert.deepEqual(receipt.runtimeSourceHashes, runtimeSources);
const archived = JSON.parse(fs.readFileSync(path.join(path.dirname(receiptFile), 'native-image-archive.json'), 'utf8'));
assert.equal(archived.imageReceiptSha256, createHash('sha256').update(fs.readFileSync(receiptFile)).digest('hex'));
assert.equal(archived.index, receipt.image); assert.match(archived.config, /^sha256:[a-f0-9]{64}$/);
const archiveFile = fs.realpathSync(path.join(path.dirname(receiptFile), 'native-image.docker.tar'));
assert.equal(fs.realpathSync(archived.archive), archiveFile);
const verifiedArchive = inspectPrivateDockerArchive(archiveFile, receipt.image);
for (const key of ['index', 'platform', 'config', 'archiveSha256', 'archiveBytes']) assert.equal(verifiedArchive[key], archived[key]);
assert.equal(verifiedArchive.blobs, archived.blobsVerified);
const build = JSON.parse(fs.readFileSync(receipt.buildReport, 'utf8'));
assert.equal(createHash('sha256').update(fs.readFileSync(receipt.buildReport)).digest('hex'), receipt.buildReportSha256);
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || 'D:/sabalanerp';
const base = ['compose', '-f', path.join(canonical, 'docker-compose.local.yml')];
function verify() {
  const output = execFileSync('docker', [...base, 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const value = JSON.parse(output); rows = Array.isArray(value) ? value : [value]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'postgres', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(value => value.Service === service); assert.ok(row);
  return JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }))[0];
}
const rows = verify(); assert.ok(!rows.some(value => value.Service === 'inquiry-candidate'), 'Do not replace an existing diagnostic owner');
const backend = inspect('backend'), inquiry = inspect('inquiry'), issuer = inspect('backend-candidate'), postgres = inspect('postgres');
for (const [name, value] of [['backend', backend], ['inquiry', inquiry]]) assert.deepEqual({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }, build.canonicalUnchanged[name]);
assert.ok(issuer.Mounts.some(value => value.Name === 'sabalanerp-local_online_runtime_authority' && value.Destination === '/app/runtime-authority' && value.RW));
verify();
const image = JSON.parse(execFileSync('docker', ['image', 'inspect', receipt.tag], { encoding: 'utf8' }))[0];
assert.equal(image.Id, archived.index); assert.equal(image.Config.Labels['io.sabalan.online-qa'], 'inquiry-native-actions');
assert.deepEqual(image.RootFS.Layers, verifiedArchive.rootfsDiffIds);
const imageRef = image.RepoDigests.find(value => value.endsWith('@' + archived.index)); assert.ok(imageRef);
verify();
const systemIdentifier = execFileSync('docker', ['exec', postgres.Id, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atqc',
  'SELECT system_identifier::text FROM pg_control_system()'], { encoding: 'utf8', timeout: 10000 }).trim();
assert.match(systemIdentifier, /^[1-9][0-9]*$/);
verify();
const databaseBytes = execFileSync('docker', ['exec', backend.Id, 'node', '-e', `const fs=require('fs');const file=${JSON.stringify(build.directory + '/build-only.db')};
if(fs.realpathSync(file)!==file)throw Error('PRIVATE_DATABASE_ALIAS');const before=fs.statSync(file,{bigint:true});
if(!before.isFile()||before.nlink!==1n||before.size<1n||before.size>1048576n)throw Error('PRIVATE_DATABASE_BOUND');
const bytes=fs.readFileSync(file),after=fs.statSync(file,{bigint:true});if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.ctimeNs!==after.ctimeNs)throw Error('PRIVATE_DATABASE_CHANGED');process.stdout.write(bytes);`], { maxBuffer: 1048576, timeout: 10000 });
assert.equal(databaseBytes.subarray(0, 16).toString('binary'), 'SQLite format 3\x00');
const operation = randomBytes(16).toString('hex'), runtimeId = randomBytes(32).toString('hex');
const directory = '/app/online-runtime-acceptance/inquiry-next-' + operation, coordination = directory + '/coordination';
const manifestSha256 = createHash('sha256').update(JSON.stringify({ receiptSha256: archived.imageReceiptSha256,
  imageArchiveSha256: archived.archiveSha256, runtimeId, image: archived.index })).digest('hex');
const prepared = { directory, coordination, operation, runtimeId, image: archived.index, manifestSha256,
  sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), systemIdentifier,
  database: databaseBytes.toString('base64'), databaseSha256: createHash('sha256').update(databaseBytes).digest('hex') };
const prepare = `const fs=require('fs'),crypto=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>Buffer.from(JSON.stringify(canonical(v))+'\\n'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const mkdir=d=>fs.mkdirSync(d,{mode:0o700}),write=(f,b,mode=0o400)=>{const fd=fs.openSync(f,'wx',mode);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
mkdir(p.directory);mkdir(p.directory+'/arrivals');mkdir(p.coordination);for(const name of ['online','online/native','online/work','online/admission','online/admission/staging'])mkdir(p.coordination+'/'+name);
const lock=file=>{write(file,Buffer.alloc(0),0o600);const v=fs.statSync(file,{bigint:true});return{file,device:String(v.dev),inode:String(v.ino),ownerUid:Number(v.uid)};};
const gate=lock(p.coordination+'/deployment-write-admission.lock'),interlock=lock(p.coordination+'/deployment-runtime-control.lock'),worker=lock(p.coordination+'/deployment-online-worker.lock');
const database={systemIdentifier:p.systemIdentifier,name:'sabalanerp'},admission=p.coordination+'/online/admission';
const definition=encode({format:'sabalan-online-admission-scope/v1',gate,interlock,worker,database});write(admission+'/scope.json',definition);
write(admission+'/00000000.json',encode({format:'sabalan-online-capture-admission/v1',generation:0,phase:'OPEN',previousSha256:null,capture:null,closureSha256:null}));
write(p.coordination+'/state.json',encode({mode:'NORMAL',updatedAt:new Date().toISOString()}),0o600);
const nativeDirectory=p.coordination+'/online/native/'+p.runtimeId,boundaryDirectory=p.coordination+'/online/work/'+p.runtimeId;mkdir(nativeDirectory);mkdir(boundaryDirectory);lock(nativeDirectory+'/deployment-runtime-control.lock');
const scope={format:'sabalan-online-runtime-scope/v2',runtimeId:p.runtimeId,releaseId:'private-native-inquiry-next',manifestSha256:p.manifestSha256,sourceCommit:p.sourceCommit,image:p.image,nonce:crypto.randomBytes(32).toString('hex'),purpose:'http',role:'serving',coordinationDirectory:p.coordination,nativeDirectory,boundaryDirectory,gate,interlock,worker:null,database,admission:{directory:admission,scopeSha256:sha(definition)}};
const {file,...identity}=gate;const namespace='sabalan-rt-'+crypto.createHash('sha256').update(p.runtimeId,'ascii').digest('hex').slice(0,48);
write(boundaryDirectory+'/scope.json',encode({format:'sabalan-runtime-namespace/v1',scope:{runtimeId:p.runtimeId,image:p.image,registrySha256:p.manifestSha256,generation:1,postgresApplicationName:namespace,gate:identity}}),0o600);
const bytes=Buffer.from(p.database,'base64');if(sha(bytes)!==p.databaseSha256)throw Error('DATABASE_COPY_MISMATCH');write(p.directory+'/inquiry.db',bytes,0o600);
const raw=encode(scope);write('/app/runtime-authority/'+p.runtimeId+'.json',raw);
const result={directory:p.directory,coordination:p.coordination,operation:p.operation,runtimeId:p.runtimeId,scopeFile:'/run/sabalan-online/'+p.runtimeId+'.json',scopeSha256:sha(raw),image:p.image,databaseUrl:'file:'+p.directory+'/inquiry.db?connection_limit=2&pool_timeout=5'};
write(p.directory+'/prepared.json',encode(result));for(const d of [nativeDirectory,boundaryDirectory,admission+'/staging',admission,p.coordination+'/online/native',p.coordination+'/online/work',p.coordination+'/online',p.coordination,p.directory,'/app/runtime-authority']){const fd=fs.openSync(d,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
console.log(JSON.stringify(result));`;
verify();
const configuration = JSON.parse(execFileSync('docker', ['exec', '-i', issuer.Id, 'node', '-e', prepare], {
  input: JSON.stringify(prepared), encoding: 'utf8', timeout: 30000, maxBuffer: 16384,
}));
const environment = { ...process.env, INQUIRY_ACCEPTANCE_IMAGE: imageRef, INQUIRY_ACCEPTANCE_REPOSITORY: root,
  INQUIRY_ACCEPTANCE_BASE_IMAGE: receipt.baseReference, INQUIRY_ACCEPTANCE_DATA: path.dirname(receiptFile),
  INQUIRY_NATIVE_SCOPE_FILE: configuration.scopeFile, INQUIRY_NATIVE_SCOPE_SHA256: configuration.scopeSha256,
  INQUIRY_NATIVE_DATABASE_URL: configuration.databaseUrl, INQUIRY_NATIVE_COORDINATION_DIR: coordination,
  INQUIRY_NATIVE_ARRIVAL_ROOT: directory + '/arrivals', INQUIRY_NATIVE_OPERATION: operation };
const compose = [...base, '-f', path.join(root, 'docker-compose.inquiry-acceptance.yml'), '-f', path.join(root, 'docker-compose.inquiry-native-acceptance.yml'), '--profile', 'inquiry-acceptance'];
verify();
const resolved = JSON.parse(execFileSync('docker', [...compose, 'config', '--format', 'json'], { env: environment, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
const service = resolved.services['inquiry-candidate'];
assert.ok([undefined, '1'].includes(process.env.INQUIRY_QA_DISABLE_CLOSING));
if (process.env.INQUIRY_QA_DISABLE_CLOSING === '1') service.environment.INQUIRY_QA_DISABLE_CLOSING = '1';
assert.equal(resolved.name, 'sabalanerp-local'); assert.ok(service);
assert.equal(Object.keys(service.depends_on || {}).length, 0);
assert.deepEqual(Object.keys(service.networks), ['default']);
assert.equal(service.image, imageRef);
delete service.build;
// Freeze just the already-defined diagnostic service and existing external
// resources. Other services cannot be created/recreated by this invocation.
const serviceFile = path.join(path.dirname(receiptFile), 'native-service-' + operation + '.json');
fs.writeFileSync(serviceFile, JSON.stringify({ name: 'sabalanerp-local', services: { 'inquiry-candidate': service },
  volumes: { online_runtime_acceptance: { external: true, name: 'sabalanerp-local_online_runtime_acceptance' },
    online_runtime_authority: { external: true, name: 'sabalanerp-local_online_runtime_authority' } },
  networks: { default: { external: true, name: 'sabalanerp-local_default' } } }, null, 2) + '\n', { flag: 'wx' });
const ownedCompose = ['compose', '-f', serviceFile, '--profile', 'inquiry-acceptance'];
verify(); execFileSync('docker', [...ownedCompose, 'create', '--no-build', '--no-recreate', 'inquiry-candidate'], { encoding: 'utf8', timeout: 60000 });
verify();
const [candidate] = JSON.parse(execFileSync('docker', ['inspect', 'sabalanerp-local-inquiry-candidate-1'], { encoding: 'utf8' }));
assert.equal(candidate.State.Status, 'created'); assert.equal(candidate.Image, archived.index);
assert.equal(candidate.Config.Labels['io.sabalan.online-qa.operation'], operation); assert.equal(candidate.HostConfig.ReadonlyRootfs, true);
assert.ok(candidate.Mounts.some(value => value.Name === 'sabalanerp-local_online_runtime_authority' && value.Destination === '/run/sabalan-online' && !value.RW));
assert.ok(!candidate.Mounts.some(value => value.Name === 'sabalanerp-local_online_runtime_authority' && value.RW));
assert.ok(candidate.Mounts.every(value => value.Type === 'tmpfs' || ['sabalanerp-local_online_runtime_authority', 'sabalanerp-local_online_runtime_acceptance'].includes(value.Name)));
const result = { format: 'sabalan-private-native-inquiry-next/v1', ...configuration, imageIndex: archived.index,
  imageReceipt: receiptFile, serviceFile, candidate: candidate.Id, url: 'http://127.0.0.1:3102',
  negativeControl: process.env.INQUIRY_QA_DISABLE_CLOSING === '1', productionAdmission: false, browserAcceptance: false };
const resultFile = path.join(root, 'reports/qa', 'inquiry-next-' + operation + '.json');
fs.writeFileSync(resultFile, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
verify(); execFileSync('docker', [...ownedCompose, 'up', '--no-build', '--no-deps', '-d', 'inquiry-candidate'], { encoding: 'utf8', timeout: 60000 });
console.log(JSON.stringify({ report: resultFile, directory, candidate: candidate.Id, url: result.url, browserAcceptance: false }));
