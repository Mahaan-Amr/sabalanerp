/** Authorized local-only image selection. No build, production or COMPLETE authority. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
import {inspectPrivateDockerArchive} from '../../../scripts/lib/private-docker-image-archive.mjs';
import {stableBackendBaseFile} from '../../../scripts/lib/production-backend-base-artifacts.mjs';
const root=import.meta.dirname,output=path.join(root,'INQUIRY-SELECTION-EXECUTION-R2.json');assert.ok(!fs.existsSync(output));
const operation=randomBytes(16).toString('hex'),privateDirectory=path.resolve('D:/sabalanerp-online-qa/issue419-inquiry-selection-'+operation);
const selected='sha256:ff0e0b21d2ea6d036946621085f7a6c90437f07b610e5f7129479cd31e4c2740';
const base='D:/sabalanerp/docker-compose.local.yml',commands=originalBackendBaseCommands(),sha=raw=>createHash('sha256').update(raw).digest('hex');
const report={format:'sabalan-419-authorized-local-inquiry-selection/v1',operation,startedAt:new Date().toISOString(),pass:false,
 authorization:'User explicitly authorized existing ff0e0b image for Inquiry only; freeze selected image for #411; no production, #420, build or push.',
 productionAdmission:false,runtimeAccepted:false,issue411Accepted:false,masterStarted:false,build:false,production:false,push:false};
let lease,custody,before,mutation=false,safe=false,selectedFile,rollbackFile;
const ref=file=>{const {bytes,sha256}=stableBackendBaseFile(file);return {file,bytes,sha256};};
async function run(args,input){const row=await commands.run('docker',args,{input,maximum:16*1024**2});report.lastOriginal={args:args.slice(0,4),pid:row.originalPid,code:row.code,signal:row.signal};commands.assertSuccessful(row);return row.stdout;}
function rows(raw){return raw.trim().split(/\r?\n/).map(JSON.parse);}
async function status(transition=false){
 lease.assertHeld();const actual=rows(await run(['compose','-f',base,'ps','--all','--no-trunc','--format','json']));
 assert.equal(actual.filter(row=>row.Service!=='inquiry').length,9);assert.ok(actual.every(row=>row.Project==='sabalanerp-local'));
 for(const row of actual.filter(row=>row.Service!=='inquiry')){assert.equal(row.State,'running');assert.equal(row.Health,'healthy');if(before)assert.equal(row.ID,before[row.Service].Id);}
 const inquiry=actual.filter(row=>row.Service==='inquiry');assert.ok(inquiry.length<2);if(!transition){assert.equal(inquiry.length,1);assert.equal(inquiry[0].State,'running');assert.equal(inquiry[0].Health,'healthy');}return actual;
}
async function docker(args,input,transition=false){await status(transition);return run(args,input);}
async function inspections(transition=false){const actual=await status(transition);return Object.fromEntries(JSON.parse(await run(['inspect',...actual.map(row=>row.ID)])).map(row=>[row.Config.Labels['com.docker.compose.service'],row]));}
function privateWrite(name,value){assertOriginalPrivateEvidenceDirectory(custody,privateDirectory);const file=path.join(privateDirectory,name);fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});return file;}
const mapEnv=rows=>Object.fromEntries(rows.map(value=>{const i=value.indexOf('=');return[value.slice(0,i),value.slice(i+1)];}));
const snapshot=String.raw`const fs=require('fs'),crypto=require('crypto'),p='/data/inquiry.db';
 const stamp=file=>{const a=fs.lstatSync(file,{bigint:true});if(!a.isFile()||a.nlink!==1n)throw Error('SQLITE_FILE_UNSAFE');const raw=fs.readFileSync(file),b=fs.lstatSync(file,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs'])if(a[k]!==b[k])throw Error('SQLITE_CHANGED');return {path:file,device:String(a.dev),inode:String(a.ino),size:String(a.size),mode:String(a.mode),uid:String(a.uid),gid:String(a.gid),mtimeNs:String(a.mtimeNs),ctimeNs:String(a.ctimeNs),sha256:crypto.createHash('sha256').update(raw).digest('hex')};};
 const main=stamp(p),sidecars=['-wal','-shm','-journal'].filter(s=>fs.existsSync(p+s)).map(s=>stamp(p+s));
 const locks=fs.readFileSync('/proc/locks','utf8').split('\n').filter(line=>line.includes(':'+main.inode+' '));
 const tcp=['/proc/net/tcp','/proc/net/tcp6'].flatMap(file=>fs.readFileSync(file,'utf8').trim().split('\n').slice(1)).map(line=>line.trim().split(/\s+/)).filter(cols=>cols[3]==='01'&&(parseInt(cols[1].split(':')[1],16)===3001||parseInt(cols[2].split(':')[1],16)===3001));
 if(locks.length||tcp.length)throw Error('ACTIVE_SQLITE_OR_HTTP_READER');
 console.log(JSON.stringify({main,sidecars,activeSqliteLocks:locks.length,activeHttpConnections:tcp.length}));`;
function invariant(after,old,graph){
 assert.equal(after.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(after.Config.Labels['com.docker.compose.service'],'inquiry');
 assert.equal(after.ImageManifestDescriptor.digest,graph.platform);assert.equal(after.ImageManifestDescriptor.platform.os,'linux');assert.equal(after.ImageManifestDescriptor.platform.architecture,'amd64');
 for(const key of ['Hostname','Entrypoint','Cmd','WorkingDir','User','ExposedPorts','Healthcheck','StopSignal','StopTimeout'])assert.deepEqual(after.Config[key],old.Config[key],'CONFIG_DRIFT:'+key);
 assert.deepEqual(mapEnv(after.Config.Env),mapEnv(old.Config.Env),'ENVIRONMENT_DRIFT');
 assert.deepEqual(after.HostConfig,old.HostConfig,'HOST_CONFIG_DRIFT');assert.deepEqual(after.Mounts,old.Mounts,'MOUNT_DRIFT');assert.deepEqual(after.NetworkSettings.Ports,old.NetworkSettings.Ports,'PORT_DRIFT');
 const network=Object.keys(old.NetworkSettings.Networks);assert.deepEqual(Object.keys(after.NetworkSettings.Networks),network);
 for(const name of network){const a=after.NetworkSettings.Networks[name],b=old.NetworkSettings.Networks[name];assert.equal(a.NetworkID,b.NetworkID);assert.deepEqual(a.Aliases,b.Aliases);}
 assert.equal(after.State.Running,true);assert.equal(after.State.Health.Status,'healthy');
}
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={pid:lease.originalPid};
 await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;
 custody=await prepareOriginalPrivateEvidenceDirectory(privateDirectory);report.privateDirectory=privateDirectory;
 before=await inspections();privateWrite('original-inspections.json',before);
 report.before=Object.fromEntries(Object.entries(before).map(([k,v])=>[k,{id:v.Id,image:v.Image,startedAt:v.State.StartedAt}]));
 const proposal=JSON.parse(fs.readFileSync(path.join(root,'EXISTING-INQUIRY-CARRIER-PROPOSAL.json')));
 assert.equal(proposal.graph.index,selected);
 for(const row of [proposal.archive,proposal.rollbackArchive,proposal.imageReceipt,proposal.archiveReceipt,proposal.expandedGraphProof])assert.deepEqual(ref(row.file),row);
 const graph=inspectPrivateDockerArchive(proposal.archive.file,selected),rollbackGraph=inspectPrivateDockerArchive(proposal.rollbackArchive.file,proposal.rollbackGraph.index);
 assert.deepEqual(graph,proposal.graph);assert.deepEqual(rollbackGraph,proposal.rollbackGraph);assert.equal(before.inquiry.ImageManifestDescriptor.digest,rollbackGraph.platform);
 const [image,rollback]=await Promise.all([docker(['image','inspect',selected]).then(raw=>JSON.parse(raw)[0]),docker(['image','inspect',rollbackGraph.index]).then(raw=>JSON.parse(raw)[0])]);
 assert.equal(image.Id,selected);assert.deepEqual(image.RootFS.Layers,graph.rootfsDiffIds);assert.equal(rollback.Id,rollbackGraph.index);assert.deepEqual(rollback.RootFS.Layers,rollbackGraph.rootfsDiffIds);
 report.graph=graph;report.rollbackGraph=rollbackGraph;report.originalNativeDescriptor=before.inquiry.ImageManifestDescriptor;
 const old=before.inquiry,originalEnv=mapEnv(old.Config.Env);
 const service=id=>({image:id,hostname:old.Config.Hostname,entrypoint:old.Config.Entrypoint,command:old.Config.Cmd,working_dir:old.Config.WorkingDir,environment:originalEnv});
 selectedFile=privateWrite('selected.compose.json',{services:{inquiry:service(selected)}});rollbackFile=privateWrite('rollback.compose.json',{services:{inquiry:service(rollbackGraph.index)}});
 for(const [file,expected]of [[selectedFile,image],[rollbackFile,rollback]]){
  const model=JSON.parse(await docker(['compose','-f',base,'-f',file,'config','--format','json']));assert.equal(model.name,'sabalanerp-local');const wanted=model.services.inquiry;
  assert.equal(wanted.image,expected.Id);assert.deepEqual(wanted.command,old.Config.Cmd);assert.deepEqual(wanted.entrypoint,old.Config.Entrypoint);
  const env={...mapEnv(expected.Config.Env),...wanted.environment};assert.deepEqual(env,originalEnv,'PROPOSED_ENVIRONMENT_DRIFT');
  assert.equal(Number(wanted.mem_limit),old.HostConfig.Memory);assert.equal(Math.round(wanted.cpus*1e9),old.HostConfig.NanoCpus);assert.equal(wanted.read_only??false,old.HostConfig.ReadonlyRootfs);
  assert.equal(wanted.volumes.length,old.Mounts.length);for(const volume of wanted.volumes){const m=old.Mounts.find(row=>row.Destination===volume.target);assert.ok(m);assert.equal(model.volumes[volume.source].name,m.Name);assert.equal(!volume.read_only,m.RW);}
 }
 report.capacity={backing:{},availableMemoryBytes:os.freemem()};assert.ok(report.capacity.availableMemoryBytes>=512*1024**2);
 for(const volume of ['C:/','D:/']){const s=fs.statfsSync(volume,{bigint:true}),available=s.bavail*s.bsize;assert.ok(available>=2n*1024n**3n,'BACKING_STORAGE_RESERVE');report.capacity.backing[volume]={availableBytes:String(available),requiredBytes:String(2n*1024n**3n)};}
 const sqlMount=before['backend-retained'].Mounts.find(m=>m.Name===old.Mounts.find(m=>m.Destination==='/data').Name);assert.ok(sqlMount&&sqlMount.RW);
 const backupRoot='/app/online-runtime-acceptance/issue419-inquiry-selection-'+operation;
 report.sqliteBefore=JSON.parse(await docker(['exec',old.Id,'node','-e',snapshot]));assert.deepEqual(report.sqliteBefore.sidecars,[]);
 const backup=String.raw`import os,sys,json,sqlite3,hashlib
from pathlib import Path
p=json.load(sys.stdin);parent=Path('/app/online-runtime-acceptance');s=parent.stat();v=os.statvfs(parent);required=p['bytes']*4+128*1024**2;assert v.f_bavail*v.f_frsize>=required
root=Path(p['root']);root.mkdir(mode=0o700);source=Path(p['source']);a=source.stat();before=hashlib.sha256(source.read_bytes()).hexdigest();assert before==p['sha256']
db=sqlite3.connect(source.as_uri()+'?mode=ro',uri=True);out=sqlite3.connect(root/'inquiry-backup.db')
try:
 assert db.execute('PRAGMA integrity_check').fetchall()==[('ok',)];db.backup(out);assert out.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
finally:out.close();db.close()
assert hashlib.sha256(source.read_bytes()).hexdigest()==before;b=source.stat();assert(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns)
f=root/'inquiry-backup.db';os.chmod(f,0o600)
with f.open('rb')as stream:os.fsync(stream.fileno())
print(json.dumps({'file':str(f),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'integrity':'ok','sourceUnchanged':True,'capacity':{'parent':str(parent),'device':str(s.st_dev),'inode':str(s.st_ino),'availableBytes':v.f_bavail*v.f_frsize,'requiredBytes':required}}))`;
 report.sqliteBackup=JSON.parse(await docker(['exec','-i',before['backend-retained'].Id,'/usr/bin/python3','-I','-B','-c',backup],JSON.stringify({root:backupRoot,source:sqlMount.Destination+'/inquiry.db',sha256:report.sqliteBefore.main.sha256,bytes:Number(report.sqliteBefore.main.size)})));
 report.sqliteImmediatelyBeforeUp=JSON.parse(await docker(['exec',old.Id,'node','-e',snapshot]));assert.deepEqual(report.sqliteImmediatelyBeforeUp,report.sqliteBefore);
 report.phase='UP_STARTED';mutation=true;lease.assertHeld();
 await docker(['compose','-f',base,'-f',selectedFile,'up','--no-deps','--no-build','--pull','never','-d','--wait','--wait-timeout','120','inquiry']);
 const after=await inspections();invariant(after.inquiry,old,graph);
 for(const k of Object.keys(before).filter(k=>k!=='inquiry'))assert.deepEqual({id:after[k].Id,image:after[k].Image,startedAt:after[k].State.StartedAt},report.before[k]);
 report.sqliteAfter=JSON.parse(await docker(['exec',after.inquiry.Id,'node','-e',snapshot]));assert.deepEqual(report.sqliteAfter,report.sqliteBefore);
 report.after={id:after.inquiry.Id,image:after.inquiry.Image,startedAt:after.inquiry.State.StartedAt,nativeDescriptor:after.inquiry.ImageManifestDescriptor};
 report.selectedConfigurationSha256=sha(JSON.stringify({Config:after.inquiry.Config,HostConfig:after.inquiry.HostConfig,Mounts:after.inquiry.Mounts}));
 report.phase='SELECTED_IMAGE_FROZEN_NATIVE_411_PENDING';report.pass=true;safe=true;
}catch(error){
 report.error={name:error.name,message:String(error.message).slice(0,1200)};
 if(!mutation)safe=true;
 else{
  try{
   const current=await inspections(true);assert.ok(current.inquiry);assert.ok([selected,before.inquiry.Image].includes(current.inquiry.Image)||[report.graph.platform,report.rollbackGraph.platform].includes(current.inquiry.ImageManifestDescriptor?.digest));
   const result=await docker(['compose','-f',base,'-f',rollbackFile,'up','--no-deps','--no-build','--pull','never','-d','--wait','--wait-timeout','120','inquiry'],undefined,true);
   const restored=await inspections();invariant(restored.inquiry,before.inquiry,report.rollbackGraph);
   const sqlite=JSON.parse(await docker(['exec',restored.inquiry.Id,'node','-e',snapshot]));assert.deepEqual(sqlite,report.sqliteBefore);
   report.restoration={verified:true,id:restored.inquiry.Id,nativeDescriptor:restored.inquiry.ImageManifestDescriptor,sqlite};report.phase='FAILED_AFTER_UP_BASELINE_RESTORED';safe=true;
  }catch(restoreError){report.restoration={verified:false,error:{name:restoreError.name,message:String(restoreError.message).slice(0,1200)}};report.phase='HELD_RESTORATION_UNPROVEN';}
 }
 process.exitCode=1;
}finally{
 report.originalChildren=await commands.close();report.completedAt=new Date().toISOString();
 if(safe&&lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}
 fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
 console.log(JSON.stringify({file:output,pass:report.pass,phase:report.phase,error:report.error??null,held:!safe}));
 if(!safe){setInterval(()=>{},1000);await new Promise(()=>{});}
}
