/** Same live bounded coordinator: prepare -> independent review -> fresh guards -> Inquiry-only UP. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {isDeepStrictEqual} from 'node:util';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';
import {inquiryMaintenanceOverride,validateInquiryMaintenanceTransition} from '../../../scripts/lib/local-inquiry-maintenance-plan.mjs';
const directory=import.meta.dirname,repo=path.resolve(directory,'../../..'),operation=randomBytes(16).toString('hex');
const privateDirectory=path.resolve('D:/sabalanerp-online-qa/inquiry-preservation-up-'+operation),guardRoot='/app/online-runtime-acceptance/issue419-preservation-up-'+operation;
const commands=originalBackendBaseCommands(),sha=b=>createHash('sha256').update(b).digest('hex');
const equal=(a,b,code)=>assert.ok(isDeepStrictEqual(a,b),code);
const lines=createInterface({input:process.stdin,crlfDelay:Infinity}),control=lines[Symbol.asyncIterator]();
let lease,custody,before,baseFiles,guardInput,plans,mutated=false,safe=false;
const report={format:'sabalan-419-original-inquiry-preservation-selection/v1',operation,startedAt:new Date().toISOString(),pass:false,
  maintenanceReady:false,applicationReady:false,runtimeAccepted:false,issue411Accepted:false,issue419Accepted:false,productionAdmission:false,
  masterStarted:false,production:false,push:false,children:[],phase:'PREPARING'};
async function run(executable,args,input){
 const result=await commands.run(executable,args,{input,cwd:repo,maximum:4*1024**2});
 const privateOutput=executable==='docker'&&(args[0]==='inspect'||args[0]==='image'&&args[1]==='inspect'||args.includes('config')&&!args.includes('--hash'));
 const privateResult=privateOutput?save('private-command-'+report.children.length+'.json',result):null;
 report.children.push({executable,args,originalPid:result.originalPid,code:result.code,signal:result.signal,naturalChildClosure:result.naturalChildClosure,
   ...(privateOutput?{privateResult,privateStdoutSha256:sha(result.stdout),privateStderrSha256:sha(result.stderr)}:{stdout:result.stdout,stderr:result.stderr})});
 commands.assertSuccessful(result);return result.stdout;
}
async function status(transition=false){
 lease.assertHeld();const rows=(await run('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json'])).trim().split(/\r?\n/).map(JSON.parse);
 assert.equal(rows.length,10);assert.ok(rows.every(r=>r.Project==='sabalanerp-local'));
 for(const row of rows)if(row.Service!=='inquiry'||!transition){assert.equal(row.State,'running');assert.equal(row.Health,'healthy');}
 if(before)for(const row of rows.filter(r=>r.Service!=='inquiry'))assert.equal(row.ID,before[row.Service].Id,'FOREIGN_CONTAINER_CHANGED');
 return rows;
}
async function docker(args,input,transition=false){await status(transition);return run('docker',args,input);}
async function inspections(transition=false){const rows=await status(transition);return Object.fromEntries(JSON.parse(await run('docker',['inspect',...rows.map(r=>r.ID)])).map(r=>[r.Config.Labels['com.docker.compose.service'],r]));}
function save(name,value){assertOriginalPrivateEvidenceDirectory(custody,privateDirectory);const file=path.join(privateDirectory,name);fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return{file,sha256:sha(fs.readFileSync(file))};}
const compose=files=>['compose',...files.flatMap(f=>['-f',f])];
function capacity(){const backing={};for(const[p,reserve]of[['C:/',12n*1024n**3n],['D:/',16n*1024n**3n]]){const s=fs.statfsSync(p,{bigint:true}),available=s.bavail*s.bsize;assert.ok(available>=reserve+512n*1024n**2n,'BACKING_RESERVE_REFUSED');backing[p]={availableBytes:String(available),retainedReserveBytes:String(reserve),operationWorkspaceBytes:String(512n*1024n**2n)};}
 assert.ok(os.freemem()>=512*1024**2,'MEMORY_RESERVE_REFUSED');return{backing,availableMemoryBytes:os.freemem(),fullAdmission:false};}
const observation=String.raw`import sys,json,hashlib,os,sqlite3
from pathlib import Path
p=json.load(sys.stdin);raw=p['source'].encode();assert hashlib.sha256(raw).hexdigest()==p['sourceSha256']
root=Path(p['root']);baseline=root/'baseline.json';contract=root/'contract.json'
if p.get('prepare'):
 parent=root.parent;v=os.statvfs(parent);assert v.f_bavail*v.f_frsize>=512*1024**2;root.mkdir(mode=0o700)
 for f,body in [(baseline,p['baseline']),(contract,p['contract'])]:
  with f.open('x')as s:s.write(body);s.flush();os.fsync(s.fileno())
  os.chmod(f,0o400)
assert hashlib.sha256(baseline.read_bytes()).hexdigest()==p['baselineSha256'];assert hashlib.sha256(contract.read_bytes()).hexdigest()==p['contractSha256']
namespace={'__name__':'frozen_conservation_guard'};exec(compile(raw,'frozen-local-inquiry-preservation.py','exec'),namespace)
original=Path(p['original']);proof=namespace['verify'](original,json.loads(contract.read_bytes()),baseline)
result={'conservation':proof,'snapshot':namespace['snapshot'](original),'capacity':{'destination':str(root),'device':str(root.stat().st_dev),'availableBytes':os.statvfs(root).f_bavail*os.statvfs(root).f_frsize,'requiredBytes':512*1024**2}}
if p.get('prepare'):
 before=namespace['snapshot'](original);rawcopy=root/'current-original-raw.db'
 with original.open('rb')as incoming,rawcopy.open('xb')as outgoing:
  while part:=incoming.read(1024*1024):outgoing.write(part)
  outgoing.flush();os.fsync(outgoing.fileno())
 os.chmod(rawcopy,0o600);assert hashlib.sha256(rawcopy.read_bytes()).hexdigest()==before['sha256']
 db=sqlite3.connect(original.as_uri()+'?mode=ro&immutable=1',uri=True);destination=root/'current-original-supported-backup.db';out=sqlite3.connect(destination)
 try:db.backup(out);assert out.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
 finally:out.close();db.close()
 os.chmod(destination,0o600)
 with destination.open('rb')as f:os.fsync(f.fileno())
 assert namespace['snapshot'](original)==before
 result['preserved']=[{'file':str(f),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}for f in [rawcopy,destination]]
print(json.dumps(result))`;
async function conserve(prepare=false,transition=false){
 assert.equal(sha(fs.readFileSync(path.join(repo,'deploy/scripts/local-inquiry-preservation.py'),'utf8').replaceAll('\r\n','\n')),guardInput.sourceSha256,'GUARD_SOURCE_CHANGED');
 return JSON.parse(await docker(['exec','-i',before['backend-retained'].Id,'/usr/bin/python3','-I','-B','-c',observation],JSON.stringify({...guardInput,prepare}),transition));
}
const readers=String.raw`const fs=require('fs'),file=process.argv[1],a=fs.statSync(file,{bigint:true});
const locks=fs.readFileSync('/proc/locks','utf8').split('\n').filter(line=>line.includes(':'+String(a.ino)+' '));
const sockets=['/proc/net/tcp','/proc/net/tcp6'].flatMap(p=>fs.readFileSync(p,'utf8').trim().split('\n').slice(1)).map(l=>l.trim().split(/\s+/)).filter(c=>c[3]==='01'&&(parseInt(c[1].split(':')[1],16)===3001||parseInt(c[2].split(':')[1],16)===3001));
if(locks.length||sockets.length)throw Error('ACTIVE_SQLITE_OR_HTTP_READER');console.log(JSON.stringify({sqliteLocks:locks.length,activeInquiryConnections:sockets.length}));`;
async function quiet(transition=false){
 const observations={};const volume=before.inquiry.Mounts.find(r=>r.Destination==='/data').Name;
 for(const[service,row]of Object.entries(await inspections(transition))){const mount=row.Mounts.find(m=>m.Name===volume);if(mount)observations[service]=JSON.parse(await docker(['exec',row.Id,'node','-e',readers,mount.Destination+'/inquiry.db'],undefined,transition));}
 const env=Object.fromEntries(before.postgres.Config.Env.map(s=>{const i=s.indexOf('=');return[s.slice(0,i),s.slice(i+1)];})),user=env.POSTGRES_USER,database=env.POSTGRES_DB||user;
 assert.match(user,/^[A-Za-z0-9_]+$/);assert.match(database,/^[A-Za-z0-9_]+$/);
 const sql=`BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SELECT json_build_object('activeSessions',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND state IN ('active','idle in transaction','idle in transaction (aborted)')),'liveDeployments',(SELECT count(*) FROM deployment_operations WHERE "leaseExpiresAt">clock_timestamp() AND "completedAt" IS NULL),'restoringRecovery',(SELECT count(*) FROM recovery_operations WHERE "restoreStartedAt" IS NOT NULL AND "completedAt" IS NULL AND status NOT IN ('FAILED','CANCELLED','COMPLETED')));COMMIT;`;
 const result=JSON.parse((await docker(['exec',before.postgres.Id,'psql','-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-U',user,'-d',database,'-c',sql],undefined,transition)).trim());
 assert.ok(Object.values(result).every(v=>v===0),'LOCAL_SQL_NOT_QUIET');return{readers:observations,sql:result};
}
async function descriptor(archive,index,expected){
 const code=String.raw`import sys,tarfile,json,hashlib
p=json.load(sys.stdin)
with tarfile.open(p['archive'])as t:
 def blob(d):
  raw=t.extractfile('blobs/sha256/'+d.split(':')[1]).read();assert 'sha256:'+hashlib.sha256(raw).hexdigest()==d;return raw
 rows=[r for r in json.loads(blob(p['index']))['manifests']if r.get('platform')=={'architecture':'amd64','os':'linux'}];assert len(rows)==1;row=rows[0];assert row['digest']==p['expected'];assert len(blob(row['digest']))==row['size'];print(json.dumps(row))`;
 return JSON.parse(await run('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B','-c',code],JSON.stringify({archive,index,expected})));
}
async function verifyMaterial(transition=false){for(const row of report.sourceFiles)assert.equal(sha(fs.readFileSync(row.file)),row.sha256,'PREPARED_SOURCE_CHANGED');for(const plan of Object.values(plans)){assert.equal(sha(fs.readFileSync(plan.file)),plan.fileSha256,'PLAN_BYTES_CHANGED');const value=(await docker([...compose(plan.configFiles),'config','--hash','inquiry'],undefined,transition)).trim().split(/\s+/).at(-1);assert.equal(value,plan.configHash,'COMPOSE_MODEL_CHANGED');}}
async function activate(plan,transition=false){await verifyMaterial(transition);await docker([...compose(plan.configFiles),'up','--no-deps','--no-build','--pull','never','-d','--wait','--wait-timeout','120','inquiry'],undefined,transition);}
async function qualify(plan){
 const actual=await inspections(true);const result=validateInquiryMaintenanceTransition(before.inquiry,actual.inquiry,plan);
 for(const[service,row]of Object.entries(actual).filter(([s])=>s!=='inquiry'))equal({id:row.Id,image:row.Image,startedAt:row.State.StartedAt},report.before[service],'FOREIGN_SERVICE_RESTARTED');
 const original=await conserve(false,true);equal(original.snapshot,report.original.snapshot,'ORIGINAL_SQLITE_CHANGED');
 for(const mount of actual.inquiry.Mounts.filter(m=>m.Name===before.inquiry.Mounts.find(m=>m.Destination==='/data').Name))assert.equal(mount.RW,false,'WRITABLE_ORIGINAL_ALIAS');
 const health=plan.kind==='forward'?['/app/local-inquiry-preservation-carrier.cjs','health']:['-e',plan.healthSource];
 await docker(['exec',actual.inquiry.Id,'/usr/local/bin/node',...health],undefined,true);
 return{transition:result,original,container:{id:actual.inquiry.Id,image:actual.inquiry.Image,startedAt:actual.inquiry.State.StartedAt,nativeDescriptor:actual.inquiry.ImageManifestDescriptor}};
}
async function recover(){try{report.recoveryCapacity=capacity();report.recoveryQuiet=await quiet(true);await activate(plans.fallback,true);report.recovery=await qualify(plans.fallback);report.phase='NEGATIVE_WITH_ORIGINAL_IMAGE_MAINTENANCE_RECOVERY';safe=true;return true;}catch{report.recoveryError='MAINTENANCE_RECOVERY_UNPROVEN';return false;}}
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;
 custody=await prepareOriginalPrivateEvidenceDirectory(privateDirectory);report.privateDirectory=privateDirectory;report.capacityBefore=capacity();
 before=await inspections();report.before=Object.fromEntries(Object.entries(before).map(([s,r])=>[s,{id:r.Id,image:r.Image,startedAt:r.State.StartedAt}]));save('original-inspections.json',before);
 const build=JSON.parse(fs.readFileSync(path.join(directory,'CARRIER-REPAIR-BUILD-651552eec55a98fb321995b20f92b4ef.json'))),abi=JSON.parse(fs.readFileSync(path.join(directory,'CARRIER-REPAIR-ABI-5cda1193ae96929346969664158a372f.json')));assert.ok(build.pass&&abi.pass);
 const proposal=JSON.parse(fs.readFileSync(path.join(directory,'EXISTING-INQUIRY-CARRIER-PROPOSAL.json'))),recipeRaw=fs.readFileSync(build.recipe.file);assert.equal(sha(recipeRaw),build.recipe.sha256);const recipe=JSON.parse(recipeRaw);
 const graph=inspectPrivateDockerArchive(fs.realpathSync(build.archive.file),build.graph.index),rollback=inspectPrivateDockerArchive(fs.realpathSync(proposal.rollbackArchive.file),proposal.rollbackGraph.index);equal(graph,build.graph,'NEW_ARCHIVE_CHANGED');equal(rollback,proposal.rollbackGraph,'ROLLBACK_ARCHIVE_CHANGED');
 assert.equal(before.inquiry.ImageManifestDescriptor.digest,rollback.platform);assert.equal(before.inquiry.Image,rollback.index);
 const images={};for(const[k,g]of[['forward',graph],['fallback',rollback]]){const[row]=JSON.parse(await docker(['image','inspect',g.index]));assert.equal(row.Id,g.index);assert.equal(row.Descriptor.digest,g.index);equal(row.RootFS.Layers,g.rootfsDiffIds,'IMAGE_ROOTFS_CHANGED');images[k]=row;}
 report.graphs={forward:graph,fallback:rollback};
 const contract=fs.readFileSync(path.join(build.privateDirectory,'context/local-inquiry-original.json'),'utf8');assert.equal(sha(contract),build.contractSha256);
 const source=fs.readFileSync(path.join(repo,'deploy/scripts/local-inquiry-preservation.py'),'utf8').replaceAll('\r\n','\n'),baseline=fs.readFileSync(path.join(repo,'backend/src/services/inquiryBaseline.json'),'utf8').replaceAll('\r\n','\n');
 assert.equal(sha(source),recipe.sourcePins['deploy/scripts/local-inquiry-preservation.py'].sha256);assert.equal(sha(baseline),recipe.sourcePins['backend/src/services/inquiryBaseline.json'].sha256);
 const mount=before['backend-retained'].Mounts.find(m=>m.Name===before.inquiry.Mounts.find(m=>m.Destination==='/data').Name);assert.ok(mount&&!mount.RW);
 guardInput={root:guardRoot,source,sourceSha256:sha(source),baseline,baselineSha256:sha(baseline),contract,contractSha256:sha(contract),original:mount.Destination+'/inquiry.db'};
 report.original=await conserve(true);report.quietBefore=await quiet();
 baseFiles=before.inquiry.Config.Labels['com.docker.compose.project.config_files'].split(',').map(f=>path.resolve(f));for(const f of baseFiles)assert.equal(fs.realpathSync(f),f);
 const model=JSON.parse(await docker([...compose(baseFiles),'config','--format','json']));const volume=model.services.inquiry.volumes.find(v=>v.target==='/data');assert.equal(volume.type,'volume');assert.equal(model.volumes[volume.source].name,before.inquiry.Mounts.find(m=>m.Destination==='/data').Name);
 const maintenanceSource=fs.readFileSync(path.join(repo,'deploy/scripts/local-inquiry-preservation-carrier.cjs'),'utf8').replaceAll('\r\n','\n');assert.equal(sha(maintenanceSource),recipe.sourcePins['deploy/scripts/local-inquiry-preservation-carrier.cjs'].sha256);
 const identity=build.contractSha256,serverTail=`\nconst maintenanceServer=serve({identity:'${identity}'});for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>maintenanceServer.close());`;
 const healthTail=`\nhealth('${identity}').catch(()=>{console.error('MAINTENANCE_NOT_READY');process.exitCode=1;});`;
 plans={};for(const kind of ['forward','fallback']){
  const g=kind==='forward'?graph:rollback,command=kind==='forward'?['/app/local-inquiry-preservation-carrier.cjs']:['-e',maintenanceSource+serverTail],healthCommand=kind==='forward'?['/app/local-inquiry-preservation-carrier.cjs','health']:['-e',maintenanceSource+healthTail];
  const override=inquiryMaintenanceOverride(before.inquiry,volume.source,g.index,command,healthCommand),ref=save(kind+'.compose.json',override),configFiles=[...baseFiles,ref.file];
  const rendered=JSON.parse(await docker([...compose(configFiles),'config','--format','json']));equal(rendered.services.inquiry.environment,override.services.inquiry.environment,'RENDERED_ENVIRONMENT_CHANGED');
  const configHash=(await docker([...compose(configFiles),'config','--hash','inquiry'])).trim().split(/\s+/).at(-1);assert.match(configHash,/^[a-f0-9]{64}$/);
  plans[kind]={kind,graph:g,platformDescriptor:await descriptor(kind==='forward'?build.archive.file:proposal.rollbackArchive.file,g.index,g.platform),imageLabels:images[kind].Config.Labels??{},
    command,healthCommand,healthSource:maintenanceSource+healthTail,configFiles,configHash,file:ref.file,fileSha256:ref.sha256};
 }
 report.sourceFiles=[...baseFiles,path.join(repo,'deploy/scripts/local-inquiry-preservation.py'),path.join(repo,'deploy/scripts/local-inquiry-preservation-carrier.cjs'),path.join(repo,'scripts/lib/local-inquiry-maintenance-plan.mjs'),path.join(repo,'reports/qa/issue-419-native-20261026/select-preservation-carrier.mjs')].map(file=>({file,sha256:sha(fs.readFileSync(file))}));
 report.preparedPlans=Object.fromEntries(Object.entries(plans).map(([kind,p])=>[kind,{image:p.graph.index,platformDescriptor:p.platformDescriptor,commandSha256:sha(JSON.stringify(p.command)),healthCommandSha256:sha(JSON.stringify(p.healthCommand)),configFiles:p.configFiles,configHash:p.configHash,privateOverride:{file:p.file,sha256:p.fileSha256},originalDataReadOnly:true,maintenanceReadyOnly:true}]));
 report.phase='PREPARED_AWAITING_INDEPENDENT_REVIEW';const prepared=path.join(directory,'CARRIER-PREPARED-'+operation+'.json');fs.writeFileSync(prepared,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({prepared,operation,phase:report.phase,ownerPid:process.pid,control:'same original stdin; continue only after independent plan/source review'}));
 const instruction=await control.next();assert.ok(!instruction.done&&instruction.value==='continue','PRE_UP_REVIEW_CONTINUATION_REQUIRED');
 report.capacityImmediatelyBeforeUp=capacity();await verifyMaterial();const current=await inspections();for(const[s,row]of Object.entries(current))equal({id:row.Id,image:row.Image,startedAt:row.State.StartedAt},report.before[s],'PREPARED_RESOURCE_CHANGED');
 const latest=await conserve();equal(latest.snapshot,report.original.snapshot,'CURRENT_SQLITE_CHANGED');report.quietImmediatelyBeforeUp=await quiet();
 report.phase='UP_STARTED';mutated=true;await activate(plans.forward);report.selected=await qualify(plans.forward);report.pass=true;report.maintenanceReady=true;report.phase='MAINTENANCE_BASELINE_FROZEN_411_PENDING';safe=true;
}catch{
 report.error='INQUIRY_PRESERVATION_SELECTION_REFUSED';process.exitCode=1;
 if(!mutated)safe=true;
 else if(!await recover()){
  report.phase='HELD_MAINTENANCE_RECOVERY_UNPROVEN';fs.writeFileSync(path.join(directory,'CARRIER-HELD-'+operation+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({phase:report.phase,operation,ownerPid:process.pid,control:'original stdin accepts observe or restore; no replacement owner'}));
  while(!safe){const instruction=await control.next();if(instruction.done){setInterval(()=>{},1000);await new Promise(()=>{});}if(instruction.value==='restore')await recover();else if(instruction.value==='observe'){try{console.log(JSON.stringify({observation:await conserve(false,true)}));}catch{console.log('CONSERVATION_UNPROVEN');}}}
 }
}finally{
 report.originalChildren=await commands.close();if(safe&&lease){await lease.release();report.lease.closed=true;}
 report.completedAt=new Date().toISOString();lines.close();fs.writeFileSync(path.join(directory,'CARRIER-SELECTION-'+operation+'.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({operation,pass:report.pass,phase:report.phase,maintenanceReady:report.maintenanceReady,applicationReady:false,runtimeAccepted:false,leaseClosed:report.lease?.closed??false}));
}
