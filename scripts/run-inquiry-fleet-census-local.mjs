import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

// Reuses the already-running, privately scoped Next diagnostic. Never creates
// a service, settles a journal or changes a consumed grant.
const root = path.resolve(import.meta.dirname, '..');
assert.ok([3, 4].includes(process.argv.length));
const configuration = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const expectedPhase = process.argv[3] || 'ACTIVE';
assert.ok(['ACTIVE', 'QUIESCENT'].includes(expectedPhase));
assert.equal(configuration.format, 'sabalan-private-native-inquiry-next/v1');
assert.match(configuration.operation, /^[a-f0-9]{32}$/);
assert.equal(configuration.directory, '/app/online-runtime-acceptance/inquiry-next-' + configuration.operation);
function verify() {
  const output = execFileSync('docker', ['compose', '-f', 'D:/sabalanerp/docker-compose.local.yml', 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows;
  try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(line => JSON.parse(line)); }
  for (const service of ['backend', 'frontend', 'inquiry', 'postgres']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
  return rows;
}
function inspect(service) {
  const row = verify().find(row => row.Service === service); assert.ok(row);
  return JSON.parse(execFileSync('docker', ['inspect', row.Name], { encoding: 'utf8' }))[0];
}
function identities() {
  return Object.fromEntries(['backend', 'frontend', 'inquiry', 'postgres'].map(service => {
    const value = inspect(service); return [service, { id: value.Id, image: value.Image, startedAt: value.State.StartedAt }];
  }));
}
const before = identities(), issuer = inspect('backend-candidate'), controller = inspect('backend-retained');
verify();
const candidate = JSON.parse(execFileSync('docker', ['inspect', configuration.candidate], { encoding: 'utf8' }))[0];
assert.equal(candidate.Image, configuration.image); assert.equal(candidate.Config.Labels['io.sabalan.online-qa.operation'], configuration.operation);
assert.equal(candidate.State.Status, expectedPhase === 'ACTIVE' ? 'running' : 'exited');
assert.ok(controller.Mounts.some(value => value.Destination === '/run/sabalan-online' && !value.RW));
assert.ok(!controller.Mounts.some(value => value.Name === 'sabalanerp-local_online_runtime_authority' && value.RW));
assert.ok(issuer.Mounts.some(value => value.Destination === '/app/runtime-authority' && value.RW));
const operation = randomBytes(16).toString('hex'), captureId = randomBytes(32).toString('hex');
const directory = configuration.directory + '/fleet-' + operation;
const names = ['online-runtime-owner.py', 'online-runtime-scope.py', 'backend-runtime-owner.py',
  'online-capture-admission.py', 'online-backend-boundary.py', 'recovery-database-freeze.py'];
if (fs.existsSync(path.join(root, 'deploy/scripts/online-inquiry-boundary.py'))) names.push('online-inquiry-boundary.py');
const files = Object.fromEntries(names.map(name => [name, fs.readFileSync(path.join(root, 'deploy/scripts', name))]));
files['fixture.py'] = fs.readFileSync(path.join(root, 'tests/online-deployment/inquiry-fleet-capture.fixture.py'));
const sourceHashes = Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]));
const manifestSha256 = createHash('sha256').update(JSON.stringify(sourceHashes)).digest('hex');
const prepare = `const fs=require('fs'),crypto=require('crypto'),p=JSON.parse(fs.readFileSync(0,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const encode=v=>Buffer.from(JSON.stringify(canonical(v))+'\\n'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const write=(file,bytes,mode=0o400)=>{const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
fs.mkdirSync(p.directory,{mode:0o700});for(const [name,data] of Object.entries(p.files)){if(!/^[a-z.-]+$/.test(name))throw Error('SOURCE_NAME');write(p.directory+'/'+name,Buffer.from(data,'base64'));}
const http=JSON.parse(fs.readFileSync('/app/runtime-authority/'+p.runtimeId+'.json'));
const nativeDirectory=p.coordination+'/online/native/'+p.captureId,boundaryDirectory=p.coordination+'/online/work/'+p.captureId;
fs.mkdirSync(nativeDirectory,{mode:0o700});fs.mkdirSync(boundaryDirectory,{mode:0o700});write(nativeDirectory+'/deployment-runtime-control.lock',Buffer.alloc(0),0o600);
const scope={...http,runtimeId:p.captureId,releaseId:'private-inquiry-fleet-census',manifestSha256:p.manifestSha256,image:p.image,nonce:crypto.randomBytes(32).toString('hex'),purpose:'capture',role:'control',nativeDirectory,boundaryDirectory,worker:JSON.parse(fs.readFileSync(p.coordination+'/online/admission/scope.json')).worker};
const {file,...gate}=scope.gate,namespace='sabalan-rt-'+sha(Buffer.from(p.captureId,'ascii')).slice(0,48);
write(boundaryDirectory+'/scope.json',encode({format:'sabalan-runtime-namespace/v1',scope:{runtimeId:p.captureId,image:scope.image,registrySha256:p.manifestSha256,generation:1,postgresApplicationName:namespace,gate}}),0o600);
const raw=encode(scope);write('/app/runtime-authority/'+p.captureId+'.json',raw);
const fixture={directory:p.directory,runtimeId:p.runtimeId,databaseFile:p.databaseFile,expectedPhase:p.expectedPhase,captureFile:'/run/sabalan-online/'+p.captureId+'.json',captureSha256:sha(raw),coordination:p.coordination};
write(p.directory+'/fixture.json',encode(fixture));
for(const dir of [nativeDirectory,boundaryDirectory,p.coordination+'/online/native',p.coordination+'/online/work',p.directory,p.parent,'/app/runtime-authority']){const fd=fs.openSync(dir,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
console.log(JSON.stringify(fixture));`;
verify();
const prepared = JSON.parse(execFileSync('docker', ['exec', '-i', issuer.Id, '/usr/bin/flock', '--exclusive', '--nonblock',
  configuration.coordination + '/deployment-online-worker.lock', 'node', '-e', prepare], {
  input: JSON.stringify({ directory, parent: configuration.directory, coordination: configuration.coordination,
    runtimeId: configuration.runtimeId, databaseFile: configuration.databaseUrl.slice(5).split('?')[0], expectedPhase,
    captureId, manifestSha256, image: controller.Image,
    files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')])) }), encoding: 'utf8', timeout: 30000,
}));
const launch = `import json,os,sys
from pathlib import Path
r=Path(sys.argv[1]);p=json.loads((r/'fixture.json').read_text())
e={k:v for k,v in os.environ.items() if not k.startswith('BACKEND_')}
assert e['DATABASE_URL'].startswith(('postgres://','postgresql://'))
e.update(BACKEND_RUNTIME_ROLE='control',RECOVERY_COORDINATION_DIR=p['coordination'],BACKEND_ONLINE_SCOPE_FILE=p['captureFile'],BACKEND_ONLINE_SCOPE_SHA256=p['captureSha256'])
os.execve('/usr/bin/python3',['/usr/bin/python3','-I','-B',str(r/'online-runtime-owner.py'),'/usr/bin/python3','-I','-B',str(r/'fixture.py'),str(r)],e)`;
verify();
execFileSync('docker', ['exec', controller.Id, 'python3', '-I', '-B', '-c', launch, directory], { encoding: 'utf8', timeout: 60000, maxBuffer: 16384 });
verify();
const observed = JSON.parse(execFileSync('docker', ['exec', controller.Id, 'node', '-e',
  `console.log(require('fs').readFileSync(${JSON.stringify(directory + '/observed.json')},'utf8'))`], { encoding: 'utf8', timeout: 10000 }));
const after = identities(); assert.deepEqual(after, before);
const report = { operation, directory, captureId, ...observed, sourceHashes, expectedPhase, canonicalUnchanged: after,
  coherentApplicationCapture: false, productionAdmission: false };
fs.writeFileSync(path.join(root, 'reports/qa/inquiry-fleet-' + operation + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(report));
assert.equal(observed.actualFleetCensus, true, observed.failure);
