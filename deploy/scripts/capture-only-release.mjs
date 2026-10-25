/** Fixed canonical pre-mutation checkpoint rehearsal. Data validation grants no release admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {validateSelection,validateBinding,selectionBinding,canonical as preservationCanonical,preservationSources} from './preserved-clamav.mjs';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))+'\n'),sha=raw=>createHash('sha256').update(raw).digest('hex');
export function originalServiceConfiguration(rows){
 assert.ok(Array.isArray(rows)&&rows.length===6);const expected=['backend','frontend','inquiry','nginx','postgres','clamav'],out={};
 for(const row of rows){const service=row.Config?.Labels?.['com.docker.compose.service'];assert.ok(expected.includes(service)&&!out[service]&&row.Config.Labels['com.docker.compose.project']==='sabalanerp');assert.match(row.Id,/^[a-f0-9]{64}$/);assert.match(row.Image,/^sha256:[a-f0-9]{64}$/);
  const config=structuredClone(row.Config);delete config.Hostname;delete config.Image;config.Labels=Object.fromEntries(Object.entries(config.Labels).filter(([key])=>!key.startsWith('com.docker.compose.')||['com.docker.compose.project','com.docker.compose.service'].includes(key)));
  out[service]={image:row.Image,configSha256:sha(bytes(config)),hostConfigSha256:sha(bytes(row.HostConfig)),mounts:row.Mounts.map(m=>({type:m.Type,source:m.Source,destination:m.Destination,readWrite:m.RW,propagation:m.Propagation})).sort((a,b)=>a.destination.localeCompare(b.destination)),networks:Object.keys(row.NetworkSettings.Networks).sort()};
 }assert.deepEqual(Object.keys(out).sort(),expected.sort());return canonical(out);
}
export function originalContainerIdentities(rows){
 originalServiceConfiguration(rows);return canonical(Object.fromEntries(rows.map(row=>{assert.equal(typeof row.Created,'string');assert.ok(Number.isFinite(Date.parse(row.Created)));return [row.Config.Labels['com.docker.compose.service'],{id:row.Id,image:row.Image,created:row.Created}];})));
}
export function verifyOriginalCaptureContainers(snapshot,rows,bindings){
 assert.deepEqual(originalContainerIdentities(rows),snapshot.originalContainerIdentities,'ORIGINAL_CAPTURE_CONTAINER_REPLACED');
 assert.deepEqual(originalServiceConfiguration(rows),snapshot.services,'ORIGINAL_CAPTURE_CONFIGURATION_CHANGED');assert.deepEqual(bindings,snapshot.configurationBytes,'ORIGINAL_CAPTURE_BIND_BYTES_CHANGED');
}
/** Starts existing, pinned containers only. The canonical deploy owner retains
 * its lease, advisory session and inherited FD9; this grants no reopen authority. */
export async function startOriginalCaptureServices(snapshot,io,waitSeconds){
 assert.ok(Number.isSafeInteger(waitSeconds)&&waitSeconds>0&&waitSeconds<=300);
 assert.ok(snapshot.originalContainerIdentities,'CAPTURE_ORIGINAL_IDENTITIES_REQUIRED');assert.ok(Number.isFinite(io.overallDeadlineMs),'CAPTURE_ORIGINAL_GLOBAL_BUDGET_REQUIRED');const deadline=Math.min(io.now()+waitSeconds*1000,io.overallDeadlineMs);
 const inspect=async()=>{const rows=await io.inspect();verifyOriginalCaptureContainers(snapshot,rows,await io.bindings(rows));return rows;};
 const healthy=async roles=>{for(;;){const rows=await inspect();assert.ok(io.now()<deadline,'CAPTURE_ORIGINAL_HEALTH_BUDGET_EXCEEDED');if(rows.filter(row=>roles.includes(row.Config.Labels['com.docker.compose.service'])).every(row=>row.State.Running===true&&row.State.Health?.Status==='healthy'))return;await io.sleep(1000);}};
 const first=['postgres','clamav','backend','frontend','inquiry'];await inspect();
 assert.ok(io.now()<deadline,'CAPTURE_ORIGINAL_HEALTH_BUDGET_EXCEEDED');await io.start(first.map(role=>snapshot.originalContainerIdentities[role].id));await healthy(first);
 await inspect();assert.ok(io.now()<deadline,'CAPTURE_ORIGINAL_HEALTH_BUDGET_EXCEEDED');
 // Re-resolve current application addresses without changing nginx Config,
 // image, mounts or identity. No Compose up or recreate is permitted here.
 await io.restart(snapshot.originalContainerIdentities.nginx.id);await healthy([...first,'nginx']);await inspect();
}
export const captureOperationSources=Object.freeze(['deploy/scripts/deploy.sh','deploy/scripts/capture-only-release.mjs',...preservationSources]);
function captureScannerSelection(plan,now,requireFresh=true){
 assert.deepEqual(Object.keys(plan.preservationContext??{}).sort(),['phase','observedAt'].sort());
 assert.equal(plan.preservationContext.phase,'CAPTURE_ONLY','CAPTURE_SCANNER_PHASE_REQUIRED');
 const observed=Date.parse(plan.preservationContext.observedAt);
 assert.ok(typeof plan.preservationContext.observedAt==='string'&&Number.isFinite(observed)&&Number.isFinite(now)
  &&now>=observed&&(!requireFresh||now-observed<=600000),'CAPTURE_SCANNER_PLAN_FRESHNESS_REQUIRED');
 // Issuance freshness never substitutes for the independent canonical health
 // command which deploy.sh runs before maintenance and again before reopen.
 const selection=validateSelection(plan.preservedClamav);assert.ok(Date.parse(selection.startedAt)<=observed,'CAPTURE_SCANNER_INCARNATION_AFTER_PLAN');return selection;
}
export function captureControlPlan(plan,actual,operations,{now=Date.now(),admission=true,binding,planSha256}={}){
 assert.deepEqual(Object.keys(plan).sort(),['controlImage','format','operations','sourceCommit','sourceHash','preservedClamav','preservationContext'].sort());
 assert.equal(plan.format,'sabalan-protected-capture-control-plan/v2');assert.match(plan.controlImage,/^sha256:[a-f0-9]{64}$/);assert.match(plan.sourceCommit,/^[a-f0-9]{40}$/);assert.match(plan.sourceHash,/^[a-f0-9]{64}$/);
 assert.ok(admission===true||admission===false);const selection=captureScannerSelection(plan,now,admission);
 if(!admission){
  // Reinspection is continuation of the same admitted plan, not a new grant.
  // The original deploy owner retains its FD9/DB lease and monotonic pause
  // deadline. Wall-clock issuance TTL is not restarted after checkpoint work.
  const held=validateBinding(binding);assert.match(planSha256,/^[a-f0-9]{64}$/);
  assert.equal(held.planSha256,planSha256,'CAPTURE_SCANNER_ADMITTED_PLAN_CHANGED');
  assert.deepEqual(held.selection,selection,'CAPTURE_SCANNER_ADMITTED_SELECTION_CHANGED');
 }
 assert.deepEqual(Object.keys(operations).sort(),[...captureOperationSources].sort());
 for(const value of Object.values(operations))assert.match(value,/^[a-f0-9]{64}$/);
 assert.deepEqual(plan.operations,operations);assert.equal(actual.length,1);assert.equal(actual[0].Id,plan.controlImage);const labels=actual[0].Config.Labels;
 assert.equal(labels['io.sabalan.performance.source-commit'],plan.sourceCommit);assert.equal(labels['io.sabalan.performance.source-hash'],plan.sourceHash);return plan.controlImage;
}
export function capturePreservationExports(plan,planSha256,actual,operations,{now=Date.now()}={}){
 captureControlPlan(plan,actual,operations,{now});const binding=selectionBinding(plan.preservedClamav,planSha256),hex=Buffer.from(preservationCanonical(binding)).toString('hex');
 return `export DEPLOYMENT_TARGET_BACKEND_IMAGE='${plan.controlImage}'\nexport DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX='${hex}'\n`;
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
function read(file,mode=0o400){const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.uid===0n&&(before.mode&0o777n)===BigInt(mode)&&before.size>0n&&before.size<64n*1024n*1024n);const raw=fs.readFileSync(file),after=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(before[key],after[key]);return raw;}
function save(file,value){const raw=bytes(value),fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}assert.ok(read(file).equals(raw));}
export async function observeOriginalCaptureChild(child,{now,deadline,isInterrupted,onHeld,onClosed}){
 let size=0,overflow=false,error,late=false,auditFailed=false;const chunks=[];
 const timer=setTimeout(()=>{late=true;try{onHeld({originalPid:child.pid,closed:false,deadlineExceeded:true});}catch{auditFailed=true;}},Math.max(0,deadline-now()));
 child.on('error',value=>{error=value;});
 for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{size+=chunk.length;if(size>16*1024**2)overflow=true;else if(stream===child.stdout)chunks.push(chunk);});
 // A deadline or signal never kills/disowns the original native child. Its
 // owner and inherited FD9 remain until the actual close event and pipe EOFs.
 const closed=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));clearTimeout(timer);
 late=late||now()>=deadline;onClosed({originalPid:child.pid,closed:true,...closed,deadlineExceeded:late,interrupted:isInterrupted(),overflow,stdoutSha256:sha(Buffer.concat(chunks))});
 assert.ifError(error);assert.equal(closed.code,0,'CAPTURE_ORIGINAL_DOCKER_CHILD_FAILED');assert.equal(closed.signal,null);assert.equal(overflow,false);
 assert.ok(!late&&!auditFailed&&!isInterrupted(),'CAPTURE_ORIGINAL_CHILD_DEADLINE_OR_INTERRUPTION_HELD');return Buffer.concat(chunks);
}
async function startPinned(file,environmentFile,composeFile,waitSeconds,startedNs,sessionFile){
 const snapshotRaw=read(file),snapshot=JSON.parse(snapshotRaw),snapshotSha256=sha(snapshotRaw);
 environmentFile=fs.realpathSync(environmentFile);composeFile=fs.realpathSync(composeFile);assert.ok(path.isAbsolute(sessionFile)&&fs.realpathSync(sessionFile)===sessionFile);
 assert.match(startedNs,/^[0-9]{1,20}$/);assert.ok(BigInt(startedNs)<=process.hrtime.bigint());
 const now=()=>Number(process.hrtime.bigint()/1000000n),overallDeadlineMs=Number((BigInt(startedNs)+600000000000n)/1000000n),deadline=Math.min(now()+waitSeconds*1000,overallDeadlineMs);
 const intentFile=file+'.startup-intent.json',completionFile=file+'.startup-completion.json',heldFile=file+'.startup-held.json';
 assert.ok(!fs.existsSync(heldFile),'CAPTURE_ORIGINAL_PRIOR_HOLD_REQUIRES_EXPLICIT_RECOVERY');
 const parentPid=process.ppid,boot=fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
 const parentBirth=()=>{assert.equal(process.ppid,parentPid,'CAPTURE_ORIGINAL_PARENT_LOST');const raw=fs.readFileSync('/proc/'+parentPid+'/stat','utf8');return raw.slice(raw.lastIndexOf(')')+2).split(' ')[19];};
 const originalParentBirth=parentBirth(),owner={pid:process.pid,parentPid,parentStartTicks:originalParentBirth,kernelBootId:boot};
 let originalLock,interrupted=false,intentMade=false,passResult=false,activeChild=null,auditFailed=false;const receipts=[];
 const hold=value=>{if(!fs.existsSync(heldFile))save(heldFile,{format:'sabalan-capture-original-start-held/v1',snapshotSha256,owner,originalOwnerRetained:true,pauseQualified:false,...value});};
 const onSignal=signal=>{interrupted=true;try{hold({signal,nativeCompletionUnknown:activeChild!==null,originalPid:activeChild});}catch{auditFailed=true;}};
 const handlers=Object.fromEntries(['SIGTERM','SIGINT','SIGHUP'].map(signal=>[signal,()=>onSignal(signal)]));for(const [signal,handler]of Object.entries(handlers))process.on(signal,handler);
 const lock=()=>{
  assert.equal(parentBirth(),originalParentBirth);assert.equal(fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),boot);
  const name='/opt/sabalanerp/.deploy-state/deployment.lock';assert.equal(fs.realpathSync(name),name);const named=fs.lstatSync(name,{bigint:true}),held=fs.fstatSync(9,{bigint:true});
  assert.ok(held.isFile()&&held.uid===0n&&held.nlink===1n&&!(held.mode&0o022n));const pin=value=>['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'].map(key=>String(value[key])).join(':');assert.equal(pin(held),pin(named));originalLock??=pin(held);assert.equal(pin(held),originalLock);
  assert.ok(fs.readFileSync('/proc/self/fdinfo/9','utf8').split('\n').some(line=>/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/.exec(line)?.[1]===String(held.ino)));
 };
 const execute=async(args,stdin)=>{
  lock();assert.ok(!interrupted&&!auditFailed&&now()<deadline,'CAPTURE_ORIGINAL_ADMISSION_HELD');
  const mutating=['start','restart'].includes(args[0]);if(mutating&&!intentMade){assert.ok(!fs.existsSync(intentFile),'CAPTURE_ORIGINAL_START_ALREADY_ATTEMPTED');save(intentFile,{format:'sabalan-capture-original-start-intent/v1',snapshotSha256,owner,originalContainerIdentities:snapshot.originalContainerIdentities});intentMade=true;}
  if(mutating)await boundary();lock();assert.ok(!interrupted&&!auditFailed&&now()<deadline,'CAPTURE_ORIGINAL_ADMISSION_HELD');
  const stdio=Array(10).fill('ignore');stdio[0]=stdin?'pipe':'ignore';stdio[1]='pipe';stdio[2]='pipe';stdio[9]=9;
  const child=spawn('docker',args,{stdio});activeChild=child.pid;
  if(stdin){child.stdin.on('error',()=>{auditFailed=true;});child.stdin.end(stdin);}
  const result=await observeOriginalCaptureChild(child,{now,deadline:Math.min(deadline,now()+45000),isInterrupted:()=>interrupted,onHeld:row=>hold({...row,nativeCompletionUnknown:true}),onClosed:row=>{receipts.push({...row,mutating});activeChild=null;}});
  lock();assert.ok(!interrupted&&!auditFailed);return result;
 };
 const roles=['backend','frontend','inquiry','nginx','postgres','clamav'],ids=roles.map(role=>snapshot.originalContainerIdentities?.[role]?.id);for(const id of ids)assert.match(id,/^[a-f0-9]{64}$/);assert.equal(new Set(ids).size,6);
 const base=['compose','--env-file',environmentFile,'-f',composeFile,'-p','sabalanerp'];
 const guard=async()=>{const actual=(await execute([...base,'ps','--all','--quiet',...roles])).toString().trim().split(/\s+/);assert.deepEqual(actual.sort(),[...ids].sort(),'CAPTURE_COMPOSE_CONTAINER_REPLACED');assert.ok(read(file).equals(snapshotRaw));};
 const boundary=async()=>{
  const session=JSON.parse(read(sessionFile,0o600));for(const key of ['deploymentId','releaseId','leaseToken','phase'])assert.match(session[key],/^[A-Za-z0-9_-]{8,160}$/);
  assert.equal(session.deploymentId,process.env.DEPLOYMENT_ID);assert.equal(session.releaseId,process.env.DEPLOYMENT_RELEASE_ID);
  assert.ok(['TRAFFIC_BLOCKED','SERVICES_DRAINED','LOCAL_CHECKPOINT_VERIFIED','REMOTE_CHECKPOINT_VERIFIED'].includes(session.phase));
  const mounts=snapshot.services.backend.mounts.filter(m=>m.destination==='/app/recovery-coordination'&&m.readWrite);assert.equal(mounts.length,1);
  const marker=JSON.parse(read(path.join(mounts[0].source,'deployment-maintenance.json'),0o600));assert.equal(marker.deploymentId,session.deploymentId);assert.equal(marker.releaseId,session.releaseId);
  const sql=`SELECT json_build_object('owned',EXISTS(SELECT 1 FROM deployment_operations WHERE id='${session.deploymentId}' AND "releaseId"='${session.releaseId}' AND "leaseToken"='${session.leaseToken}' AND phase='${session.phase}' AND "activeKey"='production' AND "leaseExpiresAt">clock_timestamp()+interval '30 seconds'))::text;\n`;
  const result=await execute([...base,'exec','-T','postgres','sh','-c','exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],Buffer.from(sql));assert.equal(JSON.parse(result).owned,true,'CAPTURE_ORIGINAL_DATABASE_LEASE_LOST');lock();
 };
 const io={now,overallDeadlineMs,sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms)),bindings:rows=>configurationBytes(rows,environmentFile),inspect:async()=>{await guard();return JSON.parse(await execute(['inspect',...ids]));},start:async selected=>{await guard();await execute(['start',...selected]);},restart:async id=>{await guard();await execute(['restart','--time','30',id]);}};
 try{
  if(fs.existsSync(intentFile)){
   const intentRaw=read(intentFile),intent=JSON.parse(intentRaw),completion=JSON.parse(read(completionFile));assert.equal(intent.format,'sabalan-capture-original-start-intent/v1');assert.equal(intent.snapshotSha256,snapshotSha256);assert.deepEqual(intent.originalContainerIdentities,snapshot.originalContainerIdentities);assert.equal(intent.owner.parentPid,parentPid);assert.equal(intent.owner.parentStartTicks,originalParentBirth);assert.equal(intent.owner.kernelBootId,boot);assert.equal(completion.format,'sabalan-capture-original-start-completion/v1');assert.deepEqual(completion.owner,intent.owner);assert.equal(completion.intentSha256,sha(intentRaw));assert.equal(completion.snapshotSha256,snapshotSha256);assert.equal(completion.passResult,true);assert.equal(completion.allOriginalChildrenClosed,true);assert.equal(completion.interrupted,false);assert.ok(Array.isArray(completion.originalChildren)&&completion.originalChildren.length>0);for(const row of completion.originalChildren)assert.ok(row.closed&&row.code===0&&row.signal===null&&!row.deadlineExceeded&&!row.interrupted&&!row.overflow);
   const rows=await io.inspect();verifyOriginalCaptureContainers(snapshot,rows,await io.bindings(rows));assert.ok(rows.every(row=>row.State.Running&&row.State.Health?.Status==='healthy'));await boundary();return;
  }
  await startOriginalCaptureServices(snapshot,io,waitSeconds);lock();assert.ok(!interrupted&&!auditFailed&&now()<deadline);passResult=true;
 }catch(error){try{hold({nativeCompletionUnknown:activeChild!==null,originalPid:activeChild});}catch{auditFailed=true;}throw error;
 }finally{
  try{if(intentMade)save(completionFile,{format:'sabalan-capture-original-start-completion/v1',intentSha256:sha(read(intentFile)),snapshotSha256,owner,passResult:passResult&&!interrupted&&!auditFailed,interrupted,allOriginalChildrenClosed:activeChild===null&&receipts.every(row=>row.closed),originalChildren:receipts});}
  finally{for(const [signal,handler]of Object.entries(handlers))process.removeListener(signal,handler);}
 }
}
export function checkpointCompletion(raw,pauseSeconds,snapshot){
 assert.ok(Number.isSafeInteger(pauseSeconds)&&pauseSeconds>=0);const values=raw.toString().trim().split('\n').map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(v=>v?.ok===true&&v.checkpoint);assert.equal(values.length,1);const point=values[0].checkpoint;
 assert.equal(point.captureMethod,'PROTECTED_MAINTENANCE_COMPLETE');for(const key of ['sourceMachineUuidSha256','sourceKernelBootIdSha256','checksum'])assert.match(point[key],/^[a-f0-9]{64}$/);assert.ok(point.localVerified&&point.remoteVerified&&point.restoreVerified);assert.ok(point.sourceDatabase?.name&&/^[1-9][0-9]*$/.test(point.sourceDatabase.systemIdentifier)&&/^[1-9][0-9]*$/.test(point.sourceDatabase.oid));
 return {format:'sabalan-protected-capture-only-completion/v1',phase:'ABORTED',checkpoint:point,originalConfigurationSha256:sha(bytes(snapshot)),checkpointOutputSha256:sha(raw),pauseSeconds,pauseBudgetSeconds:600,pauseQualified:pauseSeconds<=600,mutationStarted:false,publicReleaseChanged:false,independentRestoreQualified:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);const [command,file,output,pause]=process.argv.slice(2);assert.ok(path.isAbsolute(file)&&fs.realpathSync(path.dirname(file))===path.dirname(file));
 if(command==='snapshot'||command==='verify'||command==='plan'||command==='plan-exports'){let raw='';for await(const chunk of process.stdin){raw+=chunk;assert.ok(Buffer.byteLength(raw)<16*1024*1024);}const rows=JSON.parse(raw);
  if(command==='plan'||command==='plan-exports'){const root=output,operations={};for(const name of captureOperationSources)operations[name]=sha(read(path.join(root,name)));const raw=read(file),plan=JSON.parse(raw);if(command==='plan-exports')process.stdout.write(capturePreservationExports(plan,sha(raw),rows,operations));else{const hex=process.env.DEPLOYMENT_PRESERVED_CLAMAV_BINDING_HEX;assert.match(hex??'',/^(?:[a-f0-9]{2}){1,16384}$/);const binding=JSON.parse(Buffer.from(hex,'hex').toString('utf8'));process.stdout.write(captureControlPlan(plan,rows,operations,{admission:false,binding,planSha256:sha(raw)}));}}
  else {const facts={services:originalServiceConfiguration(rows),configurationBytes:configurationBytes(rows,output),originalContainerIdentities:originalContainerIdentities(rows)};if(command==='snapshot')save(file,facts);else assert.deepEqual(facts,JSON.parse(read(file)));}
 }
 else if(command==='start-original'){assert.equal(process.argv.length,9);await startPinned(file,output,pause,Number(process.argv[6]),process.argv[7],process.argv[8]);}
 else {assert.equal(command,'complete');const report=checkpointCompletion(read(output),Number(pause),JSON.parse(read(file)));save(file+'.completion.json',report);process.stdout.write(JSON.stringify(report)+'\n');if(!report.pauseQualified)process.exitCode=2;}
}
