import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {collectApplicationPrismaArtifacts} from './lib/application-native-prisma-artifacts.mjs';
import {collectHostPrismaArtifacts} from './lib/application-native-host-prisma-artifacts.mjs';
import {stableBackendBaseFile} from './lib/production-backend-base-artifacts.mjs';

const root=path.resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const args=process.argv.slice(2);let privateHostReceipt,linuxGenerationReceipt;
if(args.length===1)privateHostReceipt=args[0];
else if(args.length===2&&args[0]==='--linux-generation-receipt')linuxGenerationReceipt=args[1];
else assert.equal(args.length,0,'Provide one private-host receipt OR --linux-generation-receipt <actual extraction receipt>');
const compose=['compose','-f','D:/sabalanerp/docker-compose.local.yml'];
const services=['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained'];
function inspect(){const raw=execFileSync('docker',[...compose,'ps','--format','json'],{encoding:'utf8'});
  let rows;try{const value=JSON.parse(raw);rows=Array.isArray(value)?value:[value];}catch{rows=raw.trim().split(/\r?\n/).map(JSON.parse);}
  assert.equal(rows.length,services.length);assert.equal(new Set(rows.map(row=>row.Service)).size,services.length);
  assert.deepEqual(rows.map(row=>row.Service).sort(),[...services].sort());
  for(const service of services)assert.ok(rows.some(r=>r.Project==='sabalanerp-local'&&r.Service===service&&r.State==='running'&&r.Health==='healthy'));
  return JSON.parse(execFileSync('docker',['inspect',...services.map(s=>rows.find(r=>r.Service===s).Name)],{encoding:'utf8'}));}
const sources={},capture=name=>{const b=fs.readFileSync(path.join(root,name));sources[name]=sha(b);return b;};
const externalSources={},captureExternalSource=file=>{
 file=path.resolve(file);const pinned=stableBackendBaseFile(file),bytes=fs.readFileSync(file);
 assert.equal(sha(bytes),pinned.sha256);assert.deepEqual(stableBackendBaseFile(file),pinned);
 if(externalSources[file])assert.deepEqual(pinned,externalSources[file]);else externalSources[file]=pinned;
 return bytes;
};
function revalidateSources(){
 for(const[n,h]of Object.entries(sources))assert.equal(sha(fs.readFileSync(path.join(root,n))),h,n);
 for(const[file,pinned]of Object.entries(externalSources))assert.deepEqual(stableBackendBaseFile(file),pinned,file);
}
capture('scripts/run-application-prisma-local.mjs');
const files=collectApplicationPrismaArtifacts({repositoryRoot:root,captureSource:capture});
capture('scripts/lib/application-native-host-prisma-artifacts.mjs');
capture('scripts/lib/private-host-prisma-receipt.mjs');
capture('scripts/lib/private-linux-prisma-receipt.mjs');
capture('scripts/lib/prisma-schema-tokens.mjs');
files['prisma-schema-tokens.mjs']=capture('scripts/lib/prisma-schema-tokens.mjs');
Object.assign(files,collectHostPrismaArtifacts({repositoryRoot:root,captureSource:capture,privateHostReceipt,linuxGenerationReceipt,captureExternalSource}));
for(const name of ['backend-runtime-owner.py','online-runtime-scope.py','online-capture-admission.py'])files[name]=capture('deploy/scripts/'+name);
files['qualify.py']=capture('tests/online-deployment/application-prisma-qualification.fixture.py');
files['generate.py']=capture('tests/online-deployment/application-prisma-generate.fixture.py');
files['generation-owner.py']=capture('tests/online-deployment/application-prisma-generation-owner.fixture.py');
revalidateSources();
const before=inspect(),identity=rows=>Object.fromEntries(rows.map(v=>[v.Config.Labels['com.docker.compose.service'],{id:v.Id,image:v.Image,startedAt:v.State.StartedAt}]));
const candidate=before.find(v=>v.Config.Labels['com.docker.compose.service']==='backend-candidate');
const canonical=before.find(v=>v.Config.Labels['com.docker.compose.service']==='backend');
const directory='/app/online-runtime-acceptance/application-prisma-'+randomBytes(16).toString('hex');
const generationDirectory='/tmp/'+path.posix.basename(directory);
function stage(container,target,host=true){inspect();execFileSync('docker',['exec','-i',container,'node','-e',`const fs=require('fs'),p=require('path');process.umask(0o077);const root=${JSON.stringify(target)};fs.mkdirSync(root,{mode:0o700});for(const[name,value]of Object.entries(JSON.parse(fs.readFileSync(0,'utf8')))){if(p.basename(name)!==name)throw Error('UNSAFE_NAME');const fd=fs.openSync(p.join(root,name),'wx',0o400);try{fs.writeFileSync(fd,Buffer.from(value,'base64'));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}const fd=fs.openSync(root,'r');fs.fsyncSync(fd);fs.closeSync(fd);`],{
 input:JSON.stringify(Object.fromEntries(Object.entries(files).filter(([n])=>host||!n.startsWith('host-prisma')).map(([n,b])=>[n,b.toString('base64')])))});
}
stage(candidate.Id,directory,false);stage(canonical.Id,generationDirectory);
const report={format:'sabalan-private-native-prisma-qualification/v1',pass:false,productionAdmission:false,directory,sources,externalSources,before:identity(before)};
const reportPath=path.join(root,'reports/qa',path.basename(directory)+'.json'),save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');save();
async function execute(args){inspect();return new Promise((resolve,reject)=>{const child=spawn('docker',args,{stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.on('data',b=>{stderr+=b;});child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,stdout,stderr}));});save();
}
report.generationDirectory=generationDirectory;
report.generation=await execute(['exec',canonical.Id,'python3','-I','-B',generationDirectory+'/generation-owner.py',generationDirectory]);save();
inspect();
const closure=JSON.parse(execFileSync('docker',['exec',canonical.Id,'cat',generationDirectory+'/generation-coordination/deployment-runtime-native.json'],{encoding:'utf8'}));
report.generationNativeClosure=closure;save();
assert.equal(closure.phase,'QUIESCENT');assert.equal(closure.nativeReaped,true);assert.equal(closure.databaseQuiet,true);assert.equal(closure.stoppedBySignal,false);
assert.deepEqual(identity(inspect()),report.before);report.generationIdentitiesUnchanged=true;
revalidateSources();report.generationSourcesUnchanged=true;save();
assert.equal(report.generation.code,0);assert.equal(report.generation.signal,null);assert.equal(closure.nativeStatus,0);
report.generationResult=JSON.parse(report.generation.stdout);
const receiver=`import os,sys,tarfile,pathlib\nroot=pathlib.Path(sys.argv[1]);total=0;count=0\nwith tarfile.open(fileobj=sys.stdin.buffer,mode='r|') as archive:\n for entry in archive:\n  count+=1;total+=entry.size\n  p=pathlib.PurePosixPath(entry.name)\n  assert count<=4000 and total<=300*1024**2 and not p.is_absolute() and '..' not in p.parts\n  assert p.parts[0] in ['node_modules','private-prisma','generated-prisma-proof.json','database-identity.json']\n  target=root.joinpath(*p.parts)\n  if entry.isdir():\n   target.mkdir(mode=0o700,parents=True,exist_ok=True);continue\n  assert entry.isfile()\n  target.parent.mkdir(mode=0o700,parents=True,exist_ok=True)\n  fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)\n  try:\n   source=archive.extractfile(entry);remaining=entry.size\n   while remaining:\n    b=source.read(min(262144,remaining));assert b;remaining-=len(b);view=memoryview(b)\n    while view:\n     n=os.write(fd,view);assert n>0;view=view[n:]\n   os.fsync(fd)\n  finally:os.close(fd)\nfor parent,dirs,files in os.walk(root,topdown=False):\n fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)\n`;
inspect();
report.transfer=await (async()=>{
 let errors='',outputBoundExceeded=false;
 const observe=child=>{
  let spawnError;child.on('error',error=>{spawnError=error.code??'TRANSFER_SPAWN_ERROR';});
  child.stderr.on('data',bytes=>{if(errors.length+bytes.length<=4*1024**2)errors+=bytes;else outputBoundExceeded=true;});
  return new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal,spawnError})));
 };
 const producer=spawn('docker',['exec',canonical.Id,'tar','-C',generationDirectory,'-cf','-','node_modules','private-prisma','generated-prisma-proof.json','database-identity.json'],{stdio:['ignore','pipe','pipe']});
 const producerDone=observe(producer);let consumerDone;
 try{
  inspect();
  const consumer=spawn('docker',['exec','-i',candidate.Id,'python3','-I','-B','-c',receiver,directory],{stdio:['pipe','pipe','pipe']});
  consumerDone=observe(consumer);consumer.stdout.resume();
  consumer.stdin.on('error',()=>{producer.stdout.unpipe(consumer.stdin);producer.stdout.resume();});producer.stdout.pipe(consumer.stdin);
  return {status:await Promise.all([producerDone,consumerDone]),errors,outputBoundExceeded};
 }catch(error){
  // A failed second pre-action guard cannot abandon the already original tar
  // child. Drain its bytes and await that same child; no kill or replacement.
  producer.stdout.resume();await producerDone;if(consumerDone)await consumerDone;throw error;
 }
})();save();assert.equal(report.transfer.outputBoundExceeded,false);for(const result of report.transfer.status){assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.spawnError,undefined);}
report.execution=await execute(['exec','--env','PRISMA_PRIVATE_CAPSULE_INSTALLED=1',candidate.Id,'python3','-I','-B',directory+'/qualify.py',directory]);save();
assert.equal(report.execution.code,0);assert.equal(report.execution.signal,null);report.result=JSON.parse(report.execution.stdout);assert.equal(report.result.pass,true);
assert.deepEqual(identity(inspect()),report.before);report.identitiesUnchanged=true;
revalidateSources();report.sourcesUnchanged=true;report.pass=true;save();
console.log(JSON.stringify({pass:true,reportPath}));
