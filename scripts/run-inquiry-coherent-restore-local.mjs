import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createHash, randomBytes } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..');
const closed=child=>new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
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
assert.equal(consumer.Image,before.backend.image);
assert.ok(issuer.Mounts.some(value => value.Destination === '/app/runtime-authority' && value.RW
  && value.Name === 'sabalanerp-local_online_runtime_authority'));
assert.ok(consumer.Mounts.some(value => value.Destination === '/run/sabalan-online' && !value.RW
  && value.Name === 'sabalanerp-local_online_runtime_authority'));
assert.ok(!consumer.Mounts.some(value => value.Name === 'sabalanerp-local_online_runtime_authority' && value.RW));
for (const value of [issuer, consumer]) assert.ok(value.Mounts.some(mount => mount.RW
  && mount.Name === 'sabalanerp-local_online_runtime_acceptance' && mount.Destination === '/app/online-runtime-acceptance'));

const sourceBuild=JSON.parse(fs.readFileSync(path.join(root,'reports/qa/sabalan-inquiry-build-6845a85e262d24f606a8ee9eca510173.json')));
assert.deepEqual(sourceBuild.result,{code:0,signal:null});
const artifact=JSON.parse(fs.readFileSync(path.join(root,'reports/qa/inquiry-native-next-image-20261018.json'))).imageReceipt;
const codeArchive=fs.readFileSync(path.join(artifact.directory,'inquiry-build.tar.gz'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(codeArchive),artifact.archiveSha256);
for(const[name,hash]of Object.entries(sourceBuild.sourceHashes))assert.equal(sha(fs.readFileSync(path.join(root,'apps/sabalan-inquiry',name))),hash);
const source=inspect('inquiry');
assert.deepEqual({id:source.Id,image:source.Image,startedAt:source.State.StartedAt},before.inquiry);
// Measured filesystem capacity before copying any dependency tree.
for(const target of [source,issuer,consumer]){verify();const free=BigInt(execFileSync('docker',['exec',target.Id,'node','-e',"const fs=require('fs'),s=fs.statfsSync('/app',{bigint:true});console.log(String(s.bavail*s.bsize))"],{encoding:'utf8'}).trim());assert.ok(free>3n*BigInt(sourceBuild.dependencyInventory.bytes)+2n*1024n**3n);}
const pg=inspect('postgres');verify();const systemIdentifier=execFileSync('docker',['exec',pg.Id,'psql','-X','-U','postgres','-d','postgres','-Atqc','SELECT system_identifier::text FROM pg_control_system()'],{encoding:'utf8'}).trim();
const reuseDependencies=process.argv[2]==='--reuse-dependencies';
const resume=process.argv[2]==='--prepared';if(process.argv.length>2)assert.ok((resume&&process.argv.length===4)||(reuseDependencies&&process.argv.length===3));
const retainedDependencies='/app/online-runtime-acceptance/inquiry-coherent-7878c93646acd9ac37cef95e27a4029d/app/node_modules';
let dependencyReuse=null;
const directory=resume?process.argv[3]:'/app/online-runtime-acceptance/inquiry-coherent-'+randomBytes(16).toString('hex');
if(resume)assert.equal(directory,'/app/online-runtime-acceptance/inquiry-coherent-7878c93646acd9ac37cef95e27a4029d');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const files=Object.fromEntries([
 ['fixture.py','tests/online-deployment/inquiry-coherent-restore.fixture.py'],
 ['capture.py','tests/online-deployment/inquiry-coherent-restore.capture.py'],
 ['requested-stop.py','tests/online-deployment/inquiry-requested-stop.fixture.py'],
 ['client.cjs','tests/online-deployment/inquiry-coherent-restore.client.cjs'],
 ['observer.cjs','tests/online-deployment/inquiry-coherent-restore.observer.cjs'],
 ...['online-inquiry-owner.py','online-runtime-owner.py','online-runtime-scope.py','backend-runtime-owner.py','online-capture-admission.py'].map(name=>[name,'deploy/scripts/'+name]),
].map(([name,file])=>[name,fs.readFileSync(path.join(root,file))]));
files['services/online-runtime-scope.py']=files['online-runtime-scope.py'];
files['code.tar.gz']=codeArchive;
for(const name of ['onlineInquiryWork','onlineRuntimeScope','onlineCaptureAdmission','kernelWriteAdmission','runtimeBoundaryJournal','runtimeTaskAdmission','runtimeWorkContext']){
 const bytes=fs.readFileSync(path.join(root,'backend/src/services',name+'.ts'));
 const output=Buffer.from(ts.transpileModule(bytes.toString('utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText);
 files['services/'+name+'.js']=output;files['app/online-runtime/services/'+name+'.js']=output;
}
files['app/online-runtime/services/online-runtime-scope.py']=files['online-runtime-scope.py'];
files['app/online-runtime/entry.cjs']=Buffer.from("'use strict';const {loadOnlineRuntimeScope}=require('./services/onlineRuntimeScope');const {createScopedInquiryWork}=require('./services/onlineInquiryWork');exports.initialize=async generation=>{const input=loadOnlineRuntimeScope();if(!input)throw Error('INQUIRY_NATIVE_OWNERSHIP_UNPROVEN');return createScopedInquiryWork({registrySha256:input.scope.manifestSha256,generation});};\n");
const sourceHashes=Object.fromEntries(Object.entries(files).map(([file,bytes])=>[file,sha(bytes)]));
const manifestSha256=sha(Buffer.from(JSON.stringify(sourceHashes)));
const setup = `const fs=require('fs'),path=require('path'),crypto=require('crypto');
const input=JSON.parse(fs.readFileSync(0,'utf8'));const root=input.directory;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encode=value=>Buffer.from(JSON.stringify(canonical(value))+'\\n');
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const mkdir=directory=>{fs.mkdirSync(directory,{mode:0o700});};
const write=(file,bytes,mode=0o400)=>{const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const sync=directory=>{const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
mkdir(root);mkdir(root+'/services');mkdir(root+'/app');if(input.retainedDependencies)fs.symlinkSync(input.retainedDependencies,root+'/app/node_modules');else mkdir(root+'/app/node_modules');mkdir(root+'/app/online-runtime');mkdir(root+'/app/online-runtime/services');
for(const [name,base64]of Object.entries(input.files)){if(!/^[A-Za-z0-9_./-]+$/.test(name)||name.includes('..'))throw Error('SOURCE_PATH_UNSAFE');write(path.join(root,name),Buffer.from(base64,'base64'));}
const coord=root+'/coordination';mkdir(coord);mkdir(coord+'/online');mkdir(coord+'/online/native');mkdir(coord+'/online/work');mkdir(coord+'/online/admission');mkdir(coord+'/online/admission/staging');
const lock=file=>{write(file,Buffer.alloc(0),0o600);const value=fs.statSync(file,{bigint:true});return{file,device:String(value.dev),inode:String(value.ino),ownerUid:Number(value.uid)};};
write(coord+'/state.json',encode({mode:'NORMAL',updatedAt:new Date().toISOString()}),0o600);
const gate=lock(coord+'/deployment-write-admission.lock'),interlock=lock(coord+'/deployment-runtime-control.lock'),worker=lock(coord+'/deployment-online-worker.lock');
const database={systemIdentifier:input.systemIdentifier,name:'sabalanerp'};
const definition=encode({format:'sabalan-online-admission-scope/v1',gate,interlock,worker,database});write(coord+'/online/admission/scope.json',definition);
write(coord+'/online/admission/00000000.json',encode({format:'sabalan-online-capture-admission/v1',generation:0,phase:'OPEN',previousSha256:null,capture:null,closureSha256:null}));
const {runtimeBoundaryProvisionBytes,runtimeNativePostgresApplicationName}=require(root+'/services/runtimeBoundaryJournal');
const prepared={};
for(const name of ['source','restored','capture']){
 const runtimeId=crypto.randomBytes(32).toString('hex'),nativeDirectory=coord+'/online/native/'+runtimeId,boundaryDirectory=coord+'/online/work/'+runtimeId;
 mkdir(nativeDirectory);mkdir(boundaryDirectory);lock(nativeDirectory+'/deployment-runtime-control.lock');
 const scope={format:'sabalan-online-runtime-scope/v2',runtimeId,releaseId:'private-inquiry-native-diagnostic',manifestSha256:input.manifestSha256,sourceCommit:input.sourceCommit,image:input.image,nonce:crypto.randomBytes(32).toString('hex'),purpose:name==='capture'?'capture':'http',role:name==='capture'?'control':'serving',coordinationDirectory:coord,nativeDirectory,boundaryDirectory,gate,interlock,worker:name==='capture'?worker:null,database,admission:{directory:coord+'/online/admission',scopeSha256:sha(definition)}};
 const raw=encode(scope);write('/app/runtime-authority/'+runtimeId+'.json',raw);sync('/app/runtime-authority');
 const {file,...identity}=gate;
 write(boundaryDirectory+'/scope.json',runtimeBoundaryProvisionBytes({runtimeId,image:scope.image,registrySha256:scope.manifestSha256,generation:1,postgresApplicationName:runtimeNativePostgresApplicationName(runtimeId),gate:identity}),0o600);
 sync(nativeDirectory);sync(boundaryDirectory);prepared[name]={runtimeId,file:'/run/sabalan-online/'+runtimeId+'.json',sha256:sha(raw),nativeDirectory,boundaryDirectory};
}
prepared.sessionSecret=crypto.randomBytes(32).toString('hex');write(root+'/prepared.json',encode(prepared));
for(const value of ['services','coordination/online/native','coordination/online/work','coordination/online/admission/staging','coordination/online/admission','coordination/online','coordination',''])sync(path.join(root,value));
console.log(JSON.stringify({prepared:true}));`;


let dependencyArchiveSha256;
if(reuseDependencies){
 const closurePath=path.join(root,'reports/qa/inquiry-restored-continuation-f86e6b783a3fb12f5079750e1b66d85e.json');
 const closureBytes=fs.readFileSync(closurePath),closure=JSON.parse(closureBytes);assert.equal(closure.pass,true);assert.equal(closure.originalRunPassed,false);
 const code=fs.readFileSync(path.join(root,'tests/online-deployment/inquiry-dependency-inventory.fixture.cjs'),'utf8');
 verify();const original=JSON.parse(execFileSync('docker',['exec',source.Id,'node','-e',code,'/app/node_modules'],{encoding:'utf8',maxBuffer:16384}));
 const closureCheck=`import fcntl,json,os,sys,hashlib
from pathlib import Path
root=Path(${JSON.stringify(retainedDependencies)}).parent.parent
expected=json.loads(sys.argv[1]);config=json.loads((root/'prepared.json').read_bytes());fds=[]
for name in ['deployment-online-worker.lock','deployment-runtime-control.lock','deployment-write-admission.lock']:
 fd=os.open(root/'coordination'/name,os.O_RDONLY|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);fds.append(fd)
for name in ['source','capture','restored']:
 raw=(Path(config[name]['nativeDirectory'])/'deployment-runtime-native.json').read_bytes();record=json.loads(raw)
 assert record['phase']=='QUIESCENT' and record['nativeReaped'] is True
 assert record.get('sqliteNativeClosed') is True if name!='capture' else record.get('databaseQuiet') is True
 assert hashlib.sha256(raw).hexdigest()==expected[name]
 assert not Path('/proc/'+str(record['guardian']['pid'])).exists()
 if name!='capture':assert json.loads((Path(config[name]['boundaryDirectory'])/'state.json').read_bytes())['phase']=='QUIESCENT'
print('ORIGINAL_COHORT_CLOSED')`;
 verify();execFileSync('docker',['exec',consumer.Id,'python3','-I','-B','-c',closureCheck,JSON.stringify({...closure.originalClosureSha256,restored:closure.restoredClosureSha256})],{maxBuffer:16384});
 verify();const retained=JSON.parse(execFileSync('docker',['exec',consumer.Id,'node','-e',code,retainedDependencies],{encoding:'utf8',maxBuffer:16384}));
 assert.deepEqual(retained,original);assert.equal(original.bytes,sourceBuild.dependencyInventory.bytes);
 dependencyReuse={retainedDependencies,...retained,originalSourceContainer:before.inquiry,originalClosureReportSha256:sha(closureBytes),inventoryHelperSha256:sha(Buffer.from(code)),retentionRequired:true,dependencyOnly:true};
}

if(!resume){
verify();execFileSync('docker',['exec','-i',issuer.Id,'node','-e',setup],{input:JSON.stringify({directory,sourceCommit,systemIdentifier,image:consumer.Image,manifestSha256,retainedDependencies:reuseDependencies?retainedDependencies:null,files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytes.toString('base64')]))}),maxBuffer:1024*1024});
const extract=`import os,tarfile,posixpath
from pathlib import Path
root=Path(${JSON.stringify(directory)});target=root/'app'
with tarfile.open(root/'code.tar.gz','r:gz') as archive:
 members=archive.getmembers();assert 1<len(members)<20000;assert sum(m.size for m in members)<268435456
 for m in members:
  n=m.name;assert not n.startswith('/') and '..' not in n.split('/') and (m.isdir() or m.isfile() or (m.issym() and n=='.next/node_modules/@prisma/client-2c3a283f134fdcb6' and m.linkname=='../../../node_modules/@prisma/client'))
 for m in members:
  p=target/m.name
  if m.isdir():p.mkdir(parents=True,exist_ok=True,mode=0o700)
  elif m.issym():
   p.parent.mkdir(parents=True,exist_ok=True,mode=0o700);os.symlink(m.linkname,p)
  else:
   p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
   with archive.extractfile(m) as source,p.open('xb') as output:
    while block:=source.read(262144):output.write(block)
    output.flush();os.fsync(output.fileno())
`;
verify();execFileSync('docker',['exec',issuer.Id,'python3','-B','-c',extract],{maxBuffer:16384});
if(reuseDependencies){
 dependencyArchiveSha256=sourceBuild.dependencyArchiveSha256;
 verify();execFileSync('docker',['exec','-i',issuer.Id,'node','-e',"const fs=require('fs'),p=process.argv[1]+'/dependency-retention-reference.json',fd=fs.openSync(p,'wx',0o400);try{fs.writeFileSync(fd,fs.readFileSync(0));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(process.argv[1],'r');fs.fsyncSync(d);fs.closeSync(d);",directory],{input:JSON.stringify(dependencyReuse)+'\n'});
}else{
// Same-host stream, both actual Docker exec outcomes consumed; no shell pipeline.
verify();const reader=spawn('docker',['exec',source.Id,'tar','-C','/app/node_modules','-czf','-','.'],{stdio:['ignore','pipe','pipe']});
verify();const writer=spawn('docker',['exec','-i',issuer.Id,'tar','-xzf','-','-C',directory+'/app/node_modules'],{stdio:['pipe','ignore','pipe']});

const readClosed=closed(reader),writeClosed=closed(writer),hash=createHash('sha256');let bytes=0;
reader.stdout.on('data',b=>{hash.update(b);bytes+=b.length;});reader.stderr.on('data',()=>{});writer.stderr.on('data',()=>{});writer.stdin.on('error',()=>{});reader.stdout.pipe(writer.stdin);
assert.deepEqual(await readClosed,{code:0,signal:null});assert.deepEqual(await writeClosed,{code:0,signal:null});
assert.ok(bytes>1024&&bytes<512*1024*1024);dependencyArchiveSha256=hash.digest('hex');assert.equal(dependencyArchiveSha256,sourceBuild.dependencyArchiveSha256);
}

}else{
 const refusal=JSON.parse(fs.readFileSync(path.join(root,'reports/qa/inquiry-coherent-preparation-refusal-7878c93646acd9ac37cef95e27a4029d.json')));
 assert.equal(refusal.workingRoot,directory);assert.equal(refusal.nativeActorLaunched,false);assert.equal(refusal.sqliteInitialized,false);
 dependencyArchiveSha256=refusal.dependencyArchiveSha256;assert.equal(dependencyArchiveSha256,sourceBuild.dependencyArchiveSha256);
 const baseline=JSON.parse(fs.readFileSync(path.join(root,'reports/qa/application-coherent-7b6ea307a2b606f615f2a803a4d90f34.json'))).canonicalServicesUnchanged;
 assert.deepEqual(before,baseline);
 assert.equal(issuer.Id,'c5b29f5da7c57885f7af69191b753eaf8d994e57c76c38dd8369b95651ce37ea');
 assert.equal(consumer.Id,'f23b77c6ccf8509eb46d8b7df8bdac29640393efdccdb2eaa9a9ce6d068bef26');
 const inspectPrepared=`const fs=require('fs'),path=require('path'),crypto=require('crypto');const p=JSON.parse(fs.readFileSync(0,'utf8')),root=p.root;const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 for(const [name,hash]of Object.entries(p.sourceHashes))if(sha(fs.readFileSync(path.join(root,name)))!==hash)throw Error('PREPARED_SOURCE_CHANGED:'+name);
 for(const name of ['native.log','source.db','restored.db','capture-proof.json','native-proof.json','action-delayed','release-action'])if(fs.existsSync(path.join(root,name)))throw Error('PREPARED_OPERATION_ALREADY_STARTED');
 const config=JSON.parse(fs.readFileSync(root+'/prepared.json'));
 for(const name of ['source','restored','capture']){const scope=config[name];if(JSON.stringify(fs.readdirSync(scope.nativeDirectory).sort())!==JSON.stringify(['deployment-runtime-control.lock']))throw Error('NATIVE_OPERATION_EXISTS');if(JSON.stringify(fs.readdirSync(scope.boundaryDirectory).sort())!==JSON.stringify(['scope.json']))throw Error('WORK_OPERATION_EXISTS');const raw=fs.readFileSync('/app/runtime-authority/'+scope.runtimeId+'.json');if(sha(raw)!==scope.sha256||JSON.parse(raw).manifestSha256!==p.manifestSha256)throw Error('PREPARED_GRANT_CHANGED');}
 const admission=root+'/coordination/online/admission';if(JSON.stringify(fs.readdirSync(admission).sort())!==JSON.stringify(['00000000.json','scope.json','staging']))throw Error('CAPTURE_ALREADY_ATTEMPTED');if(JSON.parse(fs.readFileSync(admission+'/00000000.json')).phase!=='OPEN'||fs.readdirSync(admission+'/staging').length)throw Error('CAPTURE_PENDING');
 console.log(JSON.stringify({preparedSha256:sha(fs.readFileSync(root+'/prepared.json')),originalUnusedPreparation:true}));`;
 verify();const checked=JSON.parse(execFileSync('docker',['exec','-i',issuer.Id,'/usr/bin/flock','--exclusive','--nonblock',directory+'/coordination/deployment-online-worker.lock','/usr/bin/flock','--exclusive','--nonblock',directory+'/coordination/deployment-runtime-control.lock','/usr/bin/flock','--exclusive','--nonblock',directory+'/coordination/deployment-write-admission.lock','node','-e',inspectPrepared],{input:JSON.stringify({root:directory,sourceHashes,manifestSha256}),encoding:'utf8'}));
 fs.writeFileSync(path.join(root,'reports/qa','inquiry-coherent-prepared-resume-'+randomBytes(8).toString('hex')+'.json'),JSON.stringify({...checked,directory,dependencyArchiveSha256,canonicalBefore:before,productionAdmission:false})+'\n',{flag:'wx'});
}
const launchId=randomBytes(16).toString('hex');
const durableLauncher=`import hashlib,json,os,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]);token=sys.argv[2]
assert root==Path(${JSON.stringify(directory)}) and len(token)==32
os.umask(0o077)
def durable(name,value):
 with (root/name).open('x') as f:
  json.dump(value,f,sort_keys=True);f.flush();os.fsync(f.fileno())
 d=os.open(root,os.O_RDONLY|os.O_DIRECTORY);os.fsync(d);os.close(d)
stdout=os.open(root/('launch-'+token+'.stdout'),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
stderr=os.open(root/('launch-'+token+'.stderr'),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
os.fsync(stdout);os.fsync(stderr)
durable('launch-'+token+'.active.json',{'phase':'LAUNCHING','fixtureSha256':hashlib.sha256((root/'fixture.py').read_bytes()).hexdigest(),'launcherPid':os.getpid()})
child=subprocess.Popen(['/usr/bin/python3','-I','-B',str(root/'fixture.py'),str(root)],stdout=stdout,stderr=stderr)
status=child.wait()
os.fsync(stdout);os.fsync(stderr);os.close(stdout);os.close(stderr)
durable('launch-'+token+'.terminal.json',{'phase':'ROOT_PROCESS_EXITED','rootProcessExitCode':status,'rootProcessPid':child.pid,'allNativeWorkClosed':False})
sys.exit(0)
`;
verify();const actor=spawn('docker',['exec',consumer.Id,'python3','-I','-B','-c',durableLauncher,directory,launchId],{stdio:['ignore','pipe','pipe']});
let transportStdout='',transportStderr='';actor.stdout.on('data',b=>{transportStdout+=b;});actor.stderr.on('data',b=>{transportStderr+=b;});const outcome=await closed(actor);
verify();const actual=JSON.parse(execFileSync('docker',['exec',consumer.Id,'python3','-c',`import json,sys
from pathlib import Path
p=Path(sys.argv[1]);t=sys.argv[2]
print(json.dumps({'terminal':json.loads((p/('launch-'+t+'.terminal.json')).read_bytes()),'stdout':(p/('launch-'+t+'.stdout')).read_text(),'stderr':(p/('launch-'+t+'.stderr')).read_text()}))`,directory,launchId],{encoding:'utf8',maxBuffer:1024*1024}));
const stdout=actual.stdout,stderr=actual.stderr;
const reportPath=path.join(root,'reports/qa',path.basename(directory)+'.json');
const envelope={format:'sabalan-inquiry-coherent-next-restore-run/v1',pass:false,directory,outcome,launchId,durableTerminal:actual.terminal,stdout,stderr,sourceHashes,manifestSha256,codeArchiveSha256:artifact.archiveSha256,dependencyArchiveSha256,dependencyReuse,canonicalBefore:before,productionAdmission:false};
fs.writeFileSync(reportPath.replace('.json','.core.json'),JSON.stringify(envelope,null,2)+'\n',{flag:'wx'});
assert.deepEqual(outcome,{code:0,signal:null});assert.equal(actual.terminal.rootProcessExitCode,0);const proof=JSON.parse(stdout.trim());assert.equal(proof.pass,true);
assert.deepEqual(identities(),before);
if(dependencyReuse){
 const code=fs.readFileSync(path.join(root,'tests/online-deployment/inquiry-dependency-inventory.fixture.cjs'),'utf8');
 assert.equal(sha(Buffer.from(code)),dependencyReuse.inventoryHelperSha256);
 verify();const finalInventory=JSON.parse(execFileSync('docker',['exec',consumer.Id,'node','-e',code,retainedDependencies],{encoding:'utf8',maxBuffer:16384}));
 assert.deepEqual(finalInventory,{entries:dependencyReuse.entries,bytes:dependencyReuse.bytes,inventorySha256:dependencyReuse.inventorySha256});
 dependencyReuse.postRunInventoryVerified=true;
}
for(const[name,bytes]of Object.entries(files))assert.equal(sha(bytes),sourceHashes[name]);
fs.writeFileSync(reportPath,JSON.stringify({...envelope,...proof,pass:true,canonicalUnchanged:before},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({pass:true,reportPath}));
