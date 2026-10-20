/** Fixed canonical pre-mutation checkpoint rehearsal. Data validation grants no release admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))+'\n'),sha=raw=>createHash('sha256').update(raw).digest('hex');
export function originalServiceConfiguration(rows){
 assert.ok(Array.isArray(rows)&&rows.length===6);const expected=['backend','frontend','inquiry','nginx','postgres','clamav'],out={};
 for(const row of rows){const service=row.Config?.Labels?.['com.docker.compose.service'];assert.ok(expected.includes(service)&&!out[service]&&row.Config.Labels['com.docker.compose.project']==='sabalanerp');assert.match(row.Id,/^[a-f0-9]{64}$/);assert.match(row.Image,/^sha256:[a-f0-9]{64}$/);
  const config=structuredClone(row.Config);delete config.Hostname;delete config.Image;config.Labels=Object.fromEntries(Object.entries(config.Labels).filter(([key])=>!key.startsWith('com.docker.compose.')||['com.docker.compose.project','com.docker.compose.service'].includes(key)));
  out[service]={image:row.Image,configSha256:sha(bytes(config)),hostConfigSha256:sha(bytes(row.HostConfig)),mounts:row.Mounts.map(m=>({type:m.Type,source:m.Source,destination:m.Destination,readWrite:m.RW,propagation:m.Propagation})).sort((a,b)=>a.destination.localeCompare(b.destination)),networks:Object.keys(row.NetworkSettings.Networks).sort()};
 }assert.deepEqual(Object.keys(out).sort(),expected.sort());return canonical(out);
}
export function captureControlPlan(plan,actual,operations){
 assert.deepEqual(Object.keys(plan).sort(),['controlImage','format','operations','sourceCommit','sourceHash'].sort());assert.equal(plan.format,'sabalan-protected-capture-control-plan/v1');assert.match(plan.controlImage,/^sha256:[a-f0-9]{64}$/);assert.match(plan.sourceCommit,/^[a-f0-9]{40}$/);assert.match(plan.sourceHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(plan.operations,operations);assert.equal(actual.length,1);assert.equal(actual[0].Id,plan.controlImage);const labels=actual[0].Config.Labels;
 assert.equal(labels['io.sabalan.performance.source-commit'],plan.sourceCommit);assert.equal(labels['io.sabalan.performance.source-hash'],plan.sourceHash);return plan.controlImage;
}
export function configurationBytes(rows,env){
 const pins={};let total=0,files=0;
 function walk(file){assert.equal(fs.realpathSync(file),file);const before=fs.lstatSync(file,{bigint:true});assert.ok(before.uid===0n&&(before.mode&0o022n)===0n&&!before.isSymbolicLink());
  if(before.isDirectory()){for(const name of fs.readdirSync(file).sort())walk(path.join(file,name));return;}
  assert.ok(before.isFile()&&before.nlink===1n&&before.size<=32n*1024n*1024n);total+=Number(before.size);assert.ok(++files<=4096&&total<=64*1024*1024);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{const opened=fs.fstatSync(fd,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(before[key],opened[key]);const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs']){assert.equal(before[key],after[key]);assert.equal(before[key],named[key]);}pins[file]={bytes:raw.length,sha256:sha(raw)};}finally{fs.closeSync(fd);}}
 walk(fs.realpathSync(env));
 for(const row of rows)for(const mount of row.Mounts){if(mount.Type!=='bind')continue;
  // These are business/custody data, whose canonical checkpoint owns content.
  // Config and secret bind bytes remain independently pinned across reopen.
  if(['/app/recovery-coordination','/app/recovery-sources','/app/storage','/app/uploads','/app/deployment-reports','/app/deployment-remote','/data','/app/online-edge','/run/sabalan-publications'].some(root=>mount.Destination===root||mount.Destination.startsWith(root+'/')))continue;
  walk(mount.Source);
 }return pins;
}
function read(file){const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.uid===0n&&(before.mode&0o777n)===0o400n&&before.size>0n&&before.size<64n*1024n*1024n);const raw=fs.readFileSync(file),after=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(before[key],after[key]);return raw;}
function save(file,value){const raw=bytes(value),fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}assert.ok(read(file).equals(raw));}
export function checkpointCompletion(raw,pauseSeconds,snapshot){
 assert.ok(Number.isSafeInteger(pauseSeconds)&&pauseSeconds>=0);const values=raw.toString().trim().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(v=>v?.ok===true&&v.checkpoint);assert.equal(values.length,1);const point=values[0].checkpoint;
 assert.equal(point.captureMethod,'PROTECTED_MAINTENANCE_COMPLETE');for(const key of ['sourceMachineUuidSha256','sourceKernelBootIdSha256','checksum'])assert.match(point[key],/^[a-f0-9]{64}$/);assert.ok(point.localVerified&&point.remoteVerified&&point.restoreVerified);assert.ok(point.sourceDatabase?.name&&/^[1-9][0-9]*$/.test(point.sourceDatabase.systemIdentifier)&&/^[1-9][0-9]*$/.test(point.sourceDatabase.oid));
 return {format:'sabalan-protected-capture-only-completion/v1',phase:'ABORTED',checkpoint:point,originalConfigurationSha256:sha(bytes(snapshot)),checkpointOutputSha256:sha(raw),pauseSeconds,pauseBudgetSeconds:600,pauseQualified:pauseSeconds<=600,mutationStarted:false,publicReleaseChanged:false,independentRestoreQualified:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);const [command,file,output,pause]=process.argv.slice(2);assert.ok(path.isAbsolute(file)&&fs.realpathSync(path.dirname(file))===path.dirname(file));
 if(command==='snapshot'||command==='verify'||command==='plan'){let raw='';for await(const chunk of process.stdin){raw+=chunk;assert.ok(Buffer.byteLength(raw)<16*1024*1024);}const rows=JSON.parse(raw);
  if(command==='plan'){const root=output,operations={};for(const name of ['deploy/scripts/deploy.sh','deploy/scripts/capture-only-release.mjs'])operations[name]=sha(fs.readFileSync(path.join(root,name)));process.stdout.write(captureControlPlan(JSON.parse(read(file)),rows,operations));}
  else {const facts={services:originalServiceConfiguration(rows),configurationBytes:configurationBytes(rows,output)};if(command==='snapshot')save(file,facts);else assert.deepEqual(facts,JSON.parse(read(file)));}
 }
 else {assert.equal(command,'complete');const report=checkpointCompletion(read(output),Number(pause),JSON.parse(read(file)));save(file+'.completion.json',report);process.stdout.write(JSON.stringify(report)+'\n');if(!report.pauseQualified)process.exitCode=2;}
}
