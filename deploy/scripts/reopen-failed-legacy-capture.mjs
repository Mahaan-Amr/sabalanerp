/** Incident-only reopening of the unchanged old release after the legacy signal
 * observer failed before any checkpoint. The original failure stays immutable. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {originalServiceConfiguration,originalContainerIdentities,configurationBytes} from './capture-only-release.mjs';
import {validateReconciliationGates,validatePreviousMigrationHistory,validateHistoricalUntrackedSourcePaths,reconciliationComposeArguments} from './reconcile-premutation-capture.mjs';

const roles=['backend','frontend','inquiry','nginx','postgres','clamav'];
const INCIDENT_ID='deploy-20261112T100637Z-b58c53c0f88d-release';
const INCIDENT_GATE_ID='incident-434-20261112T100637Z-b58c53c0f88d-release';
const INCIDENT_SOURCE='b58c53c0f88d2d89da3cb6a45949e6eca97e4308';
const INCIDENT_JOURNAL_SHA='9034e93d1e8e3a2e3d7f9aa9a23d83f35751e4da06cae3691702b6461544586c';
const INCIDENT_SNAPSHOT_SHA='9e71679fa0d549926bc2b2a326e1ef9ff6875dd7d18998f7b12224a2b2e38d86';
const INCIDENT_SIGNAL_PLAN_SHA='c4249d28c726f7416e05073a9a12557fa8e6f0cfb01dd12ab98de8f5bdee2a1d';
const INCIDENT_SIGNAL_INTENT_SHA='f3efed653881bd25be88e7f8c0f0f6dbd83773f9f978b2d552147242dc3f9c50';
const INCIDENT_SIGNAL_RESULT_SHA='c14ccec02c1a44baedc78c651bd1f791b10a8fe6269eb27d4f4a127d9238ebd0';
const INCIDENT_SIGNAL_HELD_SHA='19442e44fb7388a6f652cd84e4bf02a490448e47087117a39db606b4bda33fe4';
const INCIDENT_BACKEND_ID='4bb3a88e376d81038a5650e76b7ce29de9e256538602bb7f678acab09d105b21';
const INCIDENT_NGINX_ID='0274de7f7b3c3f33803829ebeefb5742920b40bd64cf29bce00167c6233db0e0';
const LEGACY_IMAGE='sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3';
const hostEnvironment={PATH:'/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',HOME:'/root',DOCKER_HOST:'unix:///var/run/docker.sock'};
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>value instanceof Date?value.toISOString():Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encoded=value=>Buffer.from(JSON.stringify(canonical(value))+'\n');
const digest=value=>assert.match(value,/^[a-f0-9]{64}$/);
let phase='INITIAL';const progress=value=>{phase=value;process.stderr.write('FAILED_LEGACY_CAPTURE_REOPEN_'+value+'\n');};
const pin=st=>['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'].map(k=>String(st[k])).join(':');
function read(file,expected,mode=0o400,maximum=32*1024**2){
 assert.ok(path.isAbsolute(file)&&fs.realpathSync(file)===file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o777n)===BigInt(mode)&&before.size>0n&&before.size<=BigInt(maximum));const raw=fs.readFileSync(fd);assert.equal(pin(before),pin(fs.fstatSync(fd,{bigint:true})));assert.equal(pin(before),pin(fs.lstatSync(file,{bigint:true})));if(expected){digest(expected);assert.equal(hash(raw),expected);}return raw;}finally{fs.closeSync(fd);}
}
/** A distinct terminal shape: the original owner never reached service drain or checkpoint. */
export function validateFailedLegacyCaptureJournal(raw,deploymentId){
 const entries=raw.toString().trim().split(/\r?\n/).map(line=>JSON.parse(line));let previousHash=null;
 assert.ok(entries.length>=5&&entries[0].event==='deployment-prepared');
 for(const [i,entry] of entries.entries()){
  const {hash:claimed,...unsigned}=entry;assert.equal(entry.sequence,i+1);assert.equal(entry.deploymentId,deploymentId);assert.equal(entry.previousHash,previousHash);assert.equal(hash(Buffer.from(JSON.stringify(unsigned))),claimed);previousHash=claimed;
  assert.ok(['PREFLIGHT','LEASE_ACQUIRED','MAINTENANCE_REQUESTED','TRAFFIC_BLOCKED','RECOVERY_REQUIRED'].includes(entry.phase),'FAILED_LEGACY_CAPTURE_ADVANCED_PAST_TRAFFIC_BLOCKED');
 }
 assert.ok(entries.some(row=>row.phase==='TRAFFIC_BLOCKED'));assert.equal(entries.at(-1).phase,'RECOVERY_REQUIRED');assert.equal(entries.at(-1).event,'deployment-finished');
 return {entries:entries.length,finalHash:previousHash,checkpointReached:false,mutationStarted:false};
}
export function validateFailedLegacySignal(plan,intent,result,held,expected){
 assert.equal(plan.format,'sabalan-legacy-backend-signal/v2');assert.equal(plan.deploymentId,expected.deploymentId);assert.equal(plan.releaseId,expected.releaseId);
 assert.equal(plan.signalDelivered,false);assert.equal(plan.productionMutation,false);assert.equal(plan.snapshot.container.kind,'KNOWN_LEGACY_SHELL');assert.equal(plan.snapshot.container.image,expected.backendImage);
 assert.equal(plan.legacyExternalEffectRisk.ownerAcceptedPossibleDuplicateOrUnknownSms,true);assert.equal(plan.legacyExternalEffectRisk.externalEffectsCompleted,false);assert.equal(plan.legacyExternalEffectRisk.exactlyOnceSmsProven,false);
 assert.equal(plan.legacyExternalEffectRisk.image,plan.snapshot.container.image);assert.equal(plan.legacyExternalEffectRisk.containerId,plan.snapshot.container.containerId);assert.equal(plan.legacyExternalEffectRisk.startedAt,plan.snapshot.container.startedAt);assert.equal(plan.legacyExternalEffectRisk.nodeStartTicks,plan.snapshot.node.startTicks);assert.equal(plan.legacyExternalEffectRisk.taxpayerBrokerEndpointVerifiedAbsentAtPreflight,true);
 assert.equal(intent.deploymentId,plan.deploymentId);assert.equal(intent.releaseId,plan.releaseId);assert.equal(intent.planSha256,expected.planSha256);assert.deepEqual(intent.target,plan.snapshot);assert.equal(intent.signal,'SIGTERM');
 assert.equal(result.deploymentId,plan.deploymentId);assert.equal(result.releaseId,plan.releaseId);assert.equal(result.planSha256,expected.planSha256);assert.equal(result.passResult,false);assert.equal(result.signalAttempted,true);assert.equal(result.signalDelivered,true);assert.equal(result.error,'LEGACY_SIGNAL_OBSERVER_NOT_CLOSED');assert.deepEqual(result.legacyExternalEffectRisk,plan.legacyExternalEffectRisk);
 assert.ok(Array.isArray(result.originalChildren)&&result.originalChildren.length>0&&result.originalChildren.every(row=>row.closed===true&&Number.isInteger(row.code))&&result.originalChildren.some(row=>row.role==='docker-wait'&&row.code!==0&&row.deadlineExceeded===true));
 assert.equal(held.passResult,false);assert.equal(held.deadlineExceeded,true);assert.equal(held.originalOwnerRetained,true);assert.equal(held.nativeCompletionUnknown,true);
 return {signalDelivered:true,observerFailed:true,captureQualified:false,originalContainer:plan.snapshot.container,originalNode:plan.snapshot.node};
}
export function verifyRecoveredPreviousIncarnations({services,identities,currentServices,currentIdentities,facts}){
 assert.deepEqual(currentServices,services,'PREVIOUS_RELEASE_CONFIGURATION_CHANGED');
 for(const role of roles){assert.equal(currentIdentities[role].image,identities[role].image);if(role!=='nginx')assert.deepEqual(currentIdentities[role],identities[role],'UNEXPECTED_PREVIOUS_CONTAINER_REPLACED');}
 assert.notEqual(currentIdentities.nginx.id,identities.nginx.id,'EXPECTED_NGINX_RECREATION_MISSING');assert.ok(Date.parse(currentIdentities.nginx.created)>Date.parse(identities.nginx.created));
 assert.ok(Date.parse(facts.backendCurrentStartedAt)>Date.parse(facts.backendOriginalStartedAt));assert.ok(Date.parse(facts.backendPreviousFinishedAt)>Date.parse(facts.backendOriginalStartedAt));assert.ok(Date.parse(facts.backendCurrentStartedAt)>=Date.parse(facts.backendPreviousFinishedAt));assert.ok(Date.parse(facts.backendCurrentStartedAt)-Date.parse(facts.backendPreviousFinishedAt)<60000);
 assert.equal(facts.oldNodeAbsent,true);assert.equal(facts.oldSqlSessions,0);assert.ok(Number.isSafeInteger(facts.backendRestartCountNow)&&facts.backendRestartCountNow>0);
 return {originalCaptureGuardPassed:false,previousReleaseConfigurationVerified:true,legacyRuntimeReplacedByRestart:true};
}
export function validateCurrentLegacyNode(expected,actual,backendInitPid,old){
 assert.ok(Number.isSafeInteger(expected.pid)&&expected.pid>1);assert.match(String(expected.startTicks),/^[1-9][0-9]*$/);
 assert.equal(actual.pid,expected.pid);assert.equal(actual.ppid,backendInitPid);assert.equal(String(actual.startTicks),String(expected.startTicks));assert.deepEqual(actual.argv,['node','dist/index.js']);
 assert.notEqual(actual.pid,old.pid);assert.notEqual(String(actual.startTicks),String(old.startTicks));
 return expected;
}
/** The owner keeps FD9 while a child is reaped; a deadline never grants success. */
export async function observeBoundedChild(child,timeoutMs,termGraceMs,onEvent=()=>{},{ownedProcessGroup=false}={}){
 assert.ok(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&Number.isSafeInteger(termGraceMs)&&termGraceMs>0);
 let closed=false,deadlineExceeded=false,auditFailed=false,killFailed=false;
 const procStat=pid=>{const raw=fs.readFileSync('/proc/'+pid+'/stat','utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');return {pid,processGroup:Number(fields[2]),session:Number(fields[3]),startTicks:fields[19]};};
 const members=()=>fs.readdirSync('/proc').filter(name=>/^[1-9][0-9]*$/.test(name)).flatMap(name=>{try{const row=procStat(Number(name));return row.processGroup===child.pid&&row.session===child.pid?[row]:[];}catch{return [];}});
 let groupBirth=null;if(ownedProcessGroup){try{groupBirth=procStat(child.pid).startTicks;}catch(error){if(error.code!=='ENOENT')throw error;}}
 let deadlineMembers=[];
 const signal=kind=>{
  if(!ownedProcessGroup)return child.kill(kind);
  assert.ok(groupBirth,'INCIDENT_CHILD_GROUP_BIRTH_UNOBSERVED');
  const current=members();
  if(kind==='SIGTERM'){
   assert.ok(current.some(row=>row.pid===child.pid&&row.startTicks===groupBirth),'INCIDENT_CHILD_GROUP_LEADER_CHANGED');deadlineMembers=current;
  }else assert.ok(current.some(row=>deadlineMembers.some(original=>original.pid===row.pid&&original.startTicks===row.startTicks)),'INCIDENT_CHILD_GROUP_MEMBERSHIP_UNPROVEN');
  process.kill(-child.pid,kind);return true;
 };
 const record=kind=>{try{onEvent(kind);}catch{auditFailed=true;}};
 const completion=new Promise(resolve=>child.once('close',(code,signal)=>{closed=true;resolve({code,signal});}));
 const term=setTimeout(()=>{if(closed)return;deadlineExceeded=true;record('deadline');try{if(!signal('SIGTERM'))killFailed=true;}catch{killFailed=true;}},timeoutMs);
 const force=setTimeout(()=>{if(closed)return;record('force');try{if(!signal('SIGKILL'))killFailed=true;}catch{killFailed=true;}},timeoutMs+termGraceMs);
 try{const result=await completion;return {...result,closed,deadlineExceeded,auditFailed,killFailed};}
 finally{clearTimeout(term);clearTimeout(force);}
}
function lock(){
 const file='/opt/sabalanerp/.deploy-state/deployment.lock',named=fs.lstatSync(file,{bigint:true}),owned=fs.fstatSync(9,{bigint:true});assert.equal(fs.realpathSync(file),file);assert.ok(owned.isFile()&&owned.uid===0n&&owned.nlink===1n&&!(owned.mode&0o022n));assert.equal(owned.dev,named.dev);assert.equal(owned.ino,named.ino);assert.ok([...fs.readFileSync('/proc/self/fdinfo/9','utf8').matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)].some(v=>v[1]===String(owned.ino)));return String(owned.dev)+':'+String(owned.ino);
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.argv.length,4);
 const [file,expected]=process.argv.slice(2),raw=read(file,expected,0o600),plan=JSON.parse(raw),ownedLock=lock();assert.equal(plan.format,'sabalan-failed-legacy-capture-reopen/v1');
 assert.equal(plan.repositoryRoot,'/opt/sabalanerp');assert.match(plan.deploymentId,/^[A-Za-z0-9_-]{8,160}$/);assert.match(plan.targetCommit,/^[a-f0-9]{40}$/);assert.match(plan.controlImage,/^sha256:[a-f0-9]{64}$/);
 assert.equal(plan.deploymentId,INCIDENT_ID);assert.equal(plan.releaseId,INCIDENT_ID.slice('deploy-'.length));assert.equal(plan.targetCommit,INCIDENT_SOURCE);assert.equal(plan.journal.sha256,INCIDENT_JOURNAL_SHA);assert.equal(plan.originalSnapshot.sha256,INCIDENT_SNAPSHOT_SHA);assert.equal(plan.legacySignal.plan.sha256,INCIDENT_SIGNAL_PLAN_SHA);assert.equal(plan.legacySignal.intent.sha256,INCIDENT_SIGNAL_INTENT_SHA);assert.equal(plan.legacySignal.result.sha256,INCIDENT_SIGNAL_RESULT_SHA);assert.equal(plan.legacySignal.held.sha256,INCIDENT_SIGNAL_HELD_SHA);
 assert.equal(plan.environmentFile,'/opt/sabalanerp/deploy/.env.prod');assert.equal(plan.originalSnapshot.file,'/opt/sabalanerp/.deploy-state/capture-only-'+plan.deploymentId+'.json');assert.equal(plan.journal.file,'/opt/sabalanerp/reports/deploy/'+plan.deploymentId+'.journal.jsonl');
 assert.equal(plan.ownerSourceSha256,hash(fs.readFileSync(fileURLToPath(import.meta.url))),'INCIDENT_OWNER_SOURCE_CHANGED');
 assert.equal(plan.controlImage,'sha256:33defd04a0d04e1cde7d4047e7bfaee536d60705bbf4781ae78c40fcb8ba6dcd');
 assert.equal(plan.controlSourceCommit,'75cf7231cdc186875057f9ab88723cf8c2a11685');
 assert.equal(plan.controlSourceHash,'a190a9fccba8c62a9c043587c6a98e1799e54fc34e18f50572507ab6017d76e5');
 const directory=plan.operationDirectory;assert.ok(path.isAbsolute(directory)&&path.dirname(directory)==='/opt/sabalanerp/.deploy-state'&&path.basename(directory).startsWith('failed-legacy-reopen-')&&!fs.existsSync(directory));fs.mkdirSync(directory,{mode:0o700});
 const audit=(name,value)=>{assert.match(name,/^[a-z0-9-]+$/);const target=path.join(directory,name+'.json'),fd=fs.openSync(target,'wx',0o400);try{fs.writeFileSync(fd,encoded(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(directory,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}};
 const children=[];async function run(executable,args,environment={}){
  assert.equal(lock(),ownedLock);assert.equal(hash(read(file,expected,0o600)),expected);const inherited=Array(10).fill('ignore');inherited[1]='pipe';inherited[2]='pipe';inherited[9]=9;const child=spawn(executable,args,{cwd:plan.repositoryRoot,env:{...hostEnvironment,...environment},stdio:inherited,detached:true});const row={pid:child.pid,processGroup:child.pid,closed:false,code:null,signal:null};children.push(row);let count=0,overflow=false;const out=[],err=[];for(const [stream,parts]of [[child.stdout,out],[child.stderr,err]])stream.on('data',b=>{count+=b.length;if(count<=16*1024**2)parts.push(b);else overflow=true;});let failure;child.on('error',error=>{failure=error;});const number=String(children.length).padStart(3,'0'),gate=args.includes('dist/scripts/deployment-gates.js'),observed=await observeBoundedChild(child,gate?300000:60000,15000,kind=>audit('child-'+number+'-'+kind,{pid:child.pid,processGroup:child.pid,kind,deadlineExceeded:true,originalOwnerRetained:true}),{ownedProcessGroup:true});Object.assign(row,observed);
  for(const [name,parts]of [['stdout',out],['stderr',err]]){const bytes=Buffer.concat(parts),target=path.join(directory,'child-'+String(children.length).padStart(3,'0')+'-'+name+'.log'),fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}row[name+'Sha256']=hash(bytes);row[name+'File']=target;}row.outputBoundExceeded=overflow;audit('child-'+String(children.length).padStart(3,'0'),row);
  assert.ifError(failure);assert.equal(row.deadlineExceeded,false,'INCIDENT_CHILD_DEADLINE_EXCEEDED');assert.equal(row.auditFailed,false,'INCIDENT_CHILD_DEADLINE_AUDIT_FAILED');assert.equal(row.killFailed,false,'INCIDENT_CHILD_KILL_FAILED');assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(overflow,false);return Buffer.concat(out);
 }
 const compose=reconciliationComposeArguments(plan.environmentFile);
 const docker=async(args,environment={})=>{await run('docker',[...compose,'ps','--format','json'],environment);return run('docker',args,environment);};
 async function noIncidentTransport(){for(const id of [INCIDENT_ID,INCIDENT_GATE_ID]){const ids=(await docker(['ps','--all','--quiet','--filter','label=io.sabalan.deployment.id='+id])).toString().trim();assert.equal(ids,'','INCIDENT_TRANSIENT_CONTAINER_REMAINS');}}
 const [controlImage]=JSON.parse((await docker(['image','inspect',plan.controlImage])).toString());assert.equal(controlImage.Id,plan.controlImage);assert.equal(controlImage.Config.Labels['io.sabalan.performance.source-commit'],plan.controlSourceCommit);assert.equal(controlImage.Config.Labels['io.sabalan.performance.source-hash'],plan.controlSourceHash);
 const journalRaw=read(plan.journal.file,plan.journal.sha256,0o600),journal=validateFailedLegacyCaptureJournal(journalRaw,plan.deploymentId);
 const snapshotRaw=read(plan.originalSnapshot.file,plan.originalSnapshot.sha256),snapshot=JSON.parse(snapshotRaw);
 const signalBase=path.join(plan.repositoryRoot,'.deploy-state','legacy-backend-drain-'+plan.deploymentId);
 for(const [role,suffix] of [['plan','.json'],['intent','.signal-intent.json'],['result','.signal-result.json'],['held','.observer-deadline.json']])assert.equal(plan.legacySignal[role].file,signalBase+suffix);
 const signalRaw=read(plan.legacySignal.plan.file,plan.legacySignal.plan.sha256),signalPlan=JSON.parse(signalRaw);
 const signalIntent=JSON.parse(read(plan.legacySignal.intent.file,plan.legacySignal.intent.sha256));
 const signalResult=JSON.parse(read(plan.legacySignal.result.file,plan.legacySignal.result.sha256));
 const signalHeld=JSON.parse(read(plan.legacySignal.held.file,plan.legacySignal.held.sha256));
 const signalProof=validateFailedLegacySignal(signalPlan,signalIntent,signalResult,signalHeld,{deploymentId:plan.deploymentId,releaseId:plan.releaseId,planSha256:plan.legacySignal.plan.sha256,backendImage:LEGACY_IMAGE});
 assert.equal(signalProof.originalContainer.containerId,snapshot.originalContainerIdentities.backend.id);
 assert.equal(signalProof.originalContainer.containerId,INCIDENT_BACKEND_ID);
 async function sourceUnchanged(){assert.equal((await run('git',['rev-parse','HEAD'])).toString().trim(),plan.targetCommit);await run('git',['diff','--quiet','HEAD','--']);await run('git',['diff','--cached','--quiet','--']);const raw=await run('git',['ls-files','--others','--exclude-standard','-z']);const actual=raw.toString('utf8').split('\0').filter(Boolean);return validateHistoricalUntrackedSourcePaths(actual,plan.historicalUntrackedSourcePaths);}
 const historicalUntracked=await sourceUnchanged();progress('SOURCE_VERIFIED');
 async function census(){const ids=[];for(const role of roles){const value=(await docker([...compose,'ps','--all','--quiet',role])).toString().trim();assert.match(value,/^[a-f0-9]{64}$/);ids.push(value);}const rows=JSON.parse((await docker(['inspect',...ids])).toString());for(const row of rows)assert.ok(row.State.Running&&row.State.Health?.Status==='healthy');return rows;}
 async function configuration(){
  const rows=await census(),bindings=configurationBytes(rows,plan.environmentFile),currentIdentities=originalContainerIdentities(rows);
  assert.deepEqual(bindings,snapshot.configurationBytes,'PREVIOUS_RELEASE_BIND_BYTES_CHANGED');
  const projected=structuredClone(rows),nginx=projected.find(row=>row.Config.Labels['com.docker.compose.service']==='nginx');
  const order=plan.nginxEnvPermutation;assert.ok(Array.isArray(order)&&order.length===nginx.Config.Env.length&&new Set(order).size===order.length&&order.every((n,i)=>Number.isSafeInteger(n)&&n>=0&&n<order.length));
  nginx.Config.Env=order.map(index=>nginx.Config.Env[index]);
  const services=originalServiceConfiguration(projected);assert.deepEqual(services,snapshot.services,'PREVIOUS_RELEASE_CONFIGURATION_CHANGED');
  for(const role of roles)assert.equal(currentIdentities[role].image,snapshot.originalContainerIdentities[role].image);
  return {rows,services,configurationBytes:bindings,currentIdentities};
 }
 function currentLegacyNode(backend){
  const expected=plan.currentNode,pid=expected.pid;assert.equal(backend.State.Pid,expected.initPid);assert.notEqual(pid,signalProof.originalNode.pid);
  const proc='/proc/'+pid,statRaw=fs.readFileSync(proc+'/stat','utf8'),stat=statRaw.slice(statRaw.lastIndexOf(')')+2).split(' ');
  const argv=fs.readFileSync(proc+'/cmdline').toString().split('\0').filter(Boolean);
  const actual={pid,ppid:Number(stat[1]),startTicks:stat[19],argv};
  assert.equal(fs.readFileSync(proc+'/cgroup','utf8').includes(backend.Id),true,'CURRENT_NODE_CONTAINER_CGROUP_CHANGED');
  assert.equal(fs.readlinkSync(proc+'/exe'),'/usr/local/bin/node');
  return validateCurrentLegacyNode(expected,actual,backend.State.Pid,signalProof.originalNode);
 }
 const original=await configuration();progress('CONFIGURATION_VERIFIED');
 await noIncidentTransport();
 const envRows=fs.readFileSync(plan.environmentFile,'utf8').split(/\r?\n/),setting=key=>{const rows=envRows.filter(v=>v.startsWith(key+'='));assert.equal(rows.length,1);let value=rows[0].slice(key.length+1);if(/^(['"]).*\1$/.test(value))value=value.slice(1,-1);return value;};
 const domains=['DOMAIN','INQUIRY_DOMAIN'].map(key=>setting(key));for(const domain of domains)assert.match(domain,/^[A-Za-z0-9][A-Za-z0-9.-]*$/);
 async function publicMaintenance(){for(const domain of domains){const status=(await run('curl',['-k','-sS','--max-time','30','-o','/dev/null','-w','%{http_code}','https://'+domain+'/'])).toString().trim();assert.equal(status,'503','PUBLIC_MAINTENANCE_UNPROVEN');}return {domains,status:503};}
 const publicBoundary=await publicMaintenance();
 const pg=original.rows.find(row=>row.Config.Labels['com.docker.compose.service']==='postgres');assert.equal(pg.Id,plan.postgresContainerId);const url=new URL(plan.databaseUrl),env=Object.fromEntries(pg.Config.Env.map(row=>{const i=row.indexOf('=');return [row.slice(0,i),row.slice(i+1)];}));assert.equal(url.protocol,'postgresql:');assert.equal(decodeURIComponent(url.username),env.POSTGRES_USER);assert.equal(decodeURIComponent(url.password),env.POSTGRES_PASSWORD);assert.equal(decodeURIComponent(url.pathname.slice(1)),env.POSTGRES_DB);assert.ok(Object.values(pg.NetworkSettings.Networks).some(n=>n.IPAddress===url.hostname));assert.equal(url.port||'5432','5432');url.searchParams.set('connection_limit','1');url.searchParams.set('pool_timeout','10');url.searchParams.set('application_name','sabalan-premutation-reconciliation-'+randomBytes(8).toString('hex'));
 const backendMount=original.rows.find(row=>row.Config.Labels['com.docker.compose.service']==='backend').Mounts.find(row=>row.Destination==='/app/recovery-coordination'&&row.RW===true);assert.ok(backendMount);assert.equal(plan.coordinationRoot,backendMount.Source);
 const token=randomBytes(32).toString('hex'),maint=path.join(plan.coordinationRoot,'deployment-maintenance.json');
 const maintenanceRaw=read(maint,undefined,0o600),maintenance=JSON.parse(maintenanceRaw);assert.equal(maintenance.deploymentId,plan.deploymentId);
 const require=createRequire(import.meta.url),{PrismaClient}=require('./online-release-host-dependencies/node_modules/@prisma/client'),database=new PrismaClient({datasources:{db:{url:url.href}}});let acquired=false,done=false,heartbeat,timerFailure,pulse=Promise.resolve();
 async function advisory(){const rows=await database.$queryRawUnsafe("SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS birth,EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=741936425 AND objsubid=1 AND granted AND mode='ExclusiveLock') AS owned");assert.equal(rows.length,1);assert.equal(rows[0].owned,true);return rows[0];}
 try{
  const [claim]=await database.$queryRawUnsafe('SELECT pg_try_advisory_lock(741936425) AS owned');assert.equal(claim.owned,true);const birth=await advisory();progress('ADVISORY_VERIFIED');
  const baseline=await database.$transaction(async tx=>{
   const rows=await tx.$queryRawUnsafe('SELECT * FROM deployment_operations WHERE id=$1 FOR UPDATE',plan.deploymentId);assert.equal(rows.length,1);const row=rows[0];assert.equal(row.phase,'RECOVERY_REQUIRED');assert.equal(row.targetCommit,plan.targetCommit);assert.equal(row.releaseId,plan.releaseId);assert.ok(row.completedAt);
   const active=await tx.deploymentOperation.findUnique({where:{activeKey:'production'}});assert.equal(active,null,'OTHER_DEPLOYMENT_OWNS_PRODUCTION');assert.equal(row.activeKey,null);assert.equal(row.checkpointJson,null,'FAILED_CAPTURE_UNEXPECTED_CHECKPOINT');
   const [identity]=await tx.$queryRawUnsafe('SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()');assert.equal(identity.name,plan.databaseIdentity.name);assert.equal(identity.systemIdentifier,plan.databaseIdentity.systemIdentifier);assert.equal(identity.oid,plan.databaseIdentity.oid);
   return row;
  });
  const migrationRoot=path.join(plan.repositoryRoot,'backend/prisma/migrations'),checksums={};for(const name of fs.readdirSync(migrationRoot).sort()){const file=path.join(migrationRoot,name,'migration.sql');if(!fs.existsSync(file))continue;assert.equal(fs.realpathSync(file),file);checksums[name]=hash(fs.readFileSync(file));}
  const migrations=await database.$queryRawUnsafe('SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY migration_name,id');const migrationProof=validatePreviousMigrationHistory(migrations,checksums);progress('MIGRATION_LEDGER_VERIFIED');
  const backend=original.rows.find(row=>row.Config.Labels['com.docker.compose.service']==='backend');
  assert.equal(backend.Id,signalProof.originalContainer.containerId);assert.equal(backend.Image,LEGACY_IMAGE);
  assert.equal(backend.State.StartedAt,plan.restartedBackend.startedAt);assert.equal(backend.State.FinishedAt,plan.restartedBackend.previousFinishedAt);assert.equal(backend.RestartCount,plan.restartedBackend.restartCount);
  const currentNodeProof=currentLegacyNode(backend);
  assert.equal(fs.existsSync('/proc/'+signalProof.originalNode.pid),false,'ORIGINAL_LEGACY_NODE_STILL_ALIVE');
  const backendIp=Object.values(backend.NetworkSettings.Networks).map(value=>value.IPAddress).filter(Boolean);assert.equal(backendIp.length,1);
  const oldSql=await database.$queryRawUnsafe('SELECT count(*)::int AS count FROM pg_stat_activity WHERE client_addr=$1::inet AND backend_start <= $2::timestamptz',backendIp[0],backend.State.FinishedAt);
  assert.equal(oldSql[0].count,0,'OLD_BACKEND_SQL_SESSION_REMAINS');
  const currentIdentities=original.currentIdentities;
  const incarnations=verifyRecoveredPreviousIncarnations({services:snapshot.services,identities:snapshot.originalContainerIdentities,currentServices:original.services,currentIdentities,facts:{backendOriginalStartedAt:signalProof.originalContainer.startedAt,backendCurrentStartedAt:backend.State.StartedAt,backendPreviousFinishedAt:backend.State.FinishedAt,oldNodeAbsent:true,oldSqlSessions:oldSql[0].count,backendRestartCountNow:backend.RestartCount}});
  assert.equal(plan.recreatedNginxContainerId,INCIDENT_NGINX_ID);assert.equal(currentIdentities.nginx.id,INCIDENT_NGINX_ID);
  const ownerStat=fs.readFileSync('/proc/self/stat','utf8'),ownerBirth={pid:process.pid,startTicks:ownerStat.slice(ownerStat.lastIndexOf(')')+2).split(' ')[19],kernelBootId:fs.readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()};audit('incident-lease-intent',{deploymentId:plan.deploymentId,ownerBirth,leaseTokenSha256:hash(token),signalProof,incarnations});
  assert.deepEqual(await advisory(),birth);assert.equal(lock(),ownedLock);await database.$transaction(async tx=>{const rows=await tx.$queryRawUnsafe('SELECT * FROM deployment_operations WHERE id=$1 FOR UPDATE',plan.deploymentId);assert.equal(rows.length,1);assert.deepEqual(rows[0],baseline,'INCIDENT_ROW_CHANGED_DURING_READONLY_PROOF');const active=await tx.deploymentOperation.findUnique({where:{activeKey:'production'}});assert.equal(active,null);await tx.deploymentOperation.update({where:{id:plan.deploymentId},data:{activeKey:'production',leaseToken:token,leaseExpiresAt:new Date(Date.now()+120000),heartbeatAt:new Date()}});});acquired=true;audit('incident-lease-acquired',{deploymentId:plan.deploymentId,originalRow:baseline,ownerBirth,leaseTokenSha256:hash(token),originalJournalSha256:plan.journal.sha256,originalJournal:journal,originalSnapshotSha256:plan.originalSnapshot.sha256,legacySignal:plan.legacySignal,failedCapturePreserved:true,publicBoundary});progress('INCIDENT_LEASE_ACQUIRED');
  heartbeat=setInterval(()=>{pulse=pulse.then(async()=>{assert.equal(lock(),ownedLock);assert.deepEqual(await advisory(),birth);const result=await database.deploymentOperation.updateMany({where:{id:plan.deploymentId,phase:'RECOVERY_REQUIRED',activeKey:'production',leaseToken:token},data:{heartbeatAt:new Date(),leaseExpiresAt:new Date(Date.now()+120000)}});assert.equal(result.count,1);}).catch(error=>{timerFailure=error;});},15000);
  const currentEnv=Object.fromEntries(backend.Config.Env.map(row=>{const i=row.indexOf('=');return [row.slice(0,i),row.slice(i+1)];}));
  const gateEnvironment={...currentEnv,DEPLOYMENT_ID:INCIDENT_GATE_ID,DEPLOYMENT_RELEASE_ID:plan.releaseId,DEPLOYMENT_TARGET_COMMIT:plan.targetCommit,DEPLOYMENT_GATE_MODE:'PREVIOUS_UNCHANGED',DEPLOYMENT_CONTROL_IMAGE:plan.controlImage,DEPLOYMENT_BACKEND_IMAGE:plan.controlImage};
  // Every argument is fixed except validated identities. No shell/source eval.
  const args=[...compose,'run','-T','--rm','--no-deps','--label','io.sabalan.deployment.id='+INCIDENT_GATE_ID,'-e','BACKEND_RUNTIME_ROLE=control'];
  for(const key of ['DEPLOYMENT_ID','DEPLOYMENT_RELEASE_ID','DEPLOYMENT_TARGET_COMMIT','DEPLOYMENT_GATE_MODE','DEPLOYMENT_CONTROL_IMAGE','DEPLOYMENT_BACKEND_IMAGE'])args.push('-e',key+'='+gateEnvironment[key]);args.push('deployment','node','dist/scripts/deployment-gates.js');
  progress('GATES_STARTED');const stdout=await docker(args,{...gateEnvironment,DEPLOYMENT_BACKEND_IMAGE:plan.controlImage,BACKEND_DB_CONNECTION_LIMIT:'2',DATABASE_APPLICATION_NAME:'sabalanerp-deployment'});const values=stdout.toString().trim().split(/\r?\n/).flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}}).filter(v=>v.ok===true&&Array.isArray(v.gates));assert.equal(values.length,1);const gates=validateReconciliationGates(values[0],INCIDENT_GATE_ID);progress('GATES_VERIFIED');
  await noIncidentTransport();
  const after=await configuration();assert.deepEqual(after.services,original.services);const births=rows=>rows.map(row=>({id:row.Id,image:row.Image,startedAt:row.State.StartedAt,restarts:row.RestartCount})).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(births(after.rows),births(original.rows),'ORIGINAL_SIX_SERVICE_BIRTH_CHANGED');assert.deepEqual(currentLegacyNode(after.rows.find(row=>row.Config.Labels['com.docker.compose.service']==='backend')),currentNodeProof);assert.deepEqual(await sourceUnchanged(),historicalUntracked);const finalMigrations=await database.$queryRawUnsafe('SELECT migration_name,checksum,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back FROM _prisma_migrations ORDER BY migration_name,id');assert.deepEqual(validatePreviousMigrationHistory(finalMigrations,checksums),migrationProof);await publicMaintenance();clearInterval(heartbeat);heartbeat=undefined;await pulse;assert.ifError(timerFailure);assert.equal(hash(read(plan.journal.file,plan.journal.sha256,0o600)),hash(journalRaw));assert.equal(hash(read(maint,undefined,0o600)),hash(maintenanceRaw));assert.deepEqual(await advisory(),birth);
  assert.equal(fs.existsSync('/proc/'+signalProof.originalNode.pid),false,'ORIGINAL_LEGACY_NODE_REAPPEARED');
  const finalOldSql=await database.$queryRawUnsafe('SELECT count(*)::int AS count FROM pg_stat_activity WHERE client_addr=$1::inet AND backend_start <= $2::timestamptz',backendIp[0],backend.State.FinishedAt);assert.equal(finalOldSql[0].count,0,'OLD_BACKEND_SQL_SESSION_REAPPEARED');
  const [finalDatabaseIdentity]=await database.$queryRawUnsafe('SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()');assert.equal(finalDatabaseIdentity.name,plan.databaseIdentity.name);assert.equal(finalDatabaseIdentity.systemIdentifier,plan.databaseIdentity.systemIdentifier);assert.equal(finalDatabaseIdentity.oid,plan.databaseIdentity.oid);
  for(const item of Object.values(plan.legacySignal))read(item.file,item.sha256);
  await noIncidentTransport();
  const reconciliationProofs=[{name:'original-terminal-journal-no-mutation-or-checkpoint',passed:true,journalSha256:plan.journal.sha256},{name:'failed-legacy-signal-and-restarted-previous-runtime',passed:true,signalPlanSha256:plan.legacySignal.plan.sha256,signalResultSha256:plan.legacySignal.result.sha256,incarnations},{name:'source-database-migration-history-and-previous-images',passed:true,sourceDatabase:plan.databaseIdentity,migrationProof},{name:'canonical-previous-config-and-private-bind-bytes',passed:true,snapshotSha256:plan.originalSnapshot.sha256}];
  audit('verified-before-reopen',{deploymentId:plan.deploymentId,canonicalPreviousGates:gates,reconciliationProofs,historicalUntracked,originalCaptureGuardPassed:false,captureQualified:false,checkpointCreated:false,databaseRestored:false,originalJournalPreserved:true,allOriginalChildrenClosed:children.every(row=>row.closed),children});
  // Do not reset the failed row or pretend it was a successful capture.
  // Normal maintenance semantics: exact owner marker, same inode, unlink.
  await database.$transaction(async tx=>{const owned=await tx.$queryRawUnsafe('SELECT id,"checkpointJson" FROM deployment_operations WHERE id=$1 AND phase=\'RECOVERY_REQUIRED\' AND "activeKey"=\'production\' AND "leaseToken"=$2 AND "leaseExpiresAt">clock_timestamp()+interval \'30 seconds\' FOR UPDATE',plan.deploymentId,token);assert.equal(owned.length,1,'INCIDENT_LEASE_LOST_BEFORE_REOPEN');assert.equal(owned[0].checkpointJson,null,'ORIGINAL_CAPTURE_CHECKPOINT_APPEARED');const [session]=await tx.$queryRawUnsafe("SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS birth,EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=741936425 AND objsubid=1 AND granted AND mode='ExclusiveLock') AS owned");assert.deepEqual(session,birth);assert.equal(lock(),ownedLock);progress('FINAL_VERIFIED');
   const named=fs.lstatSync(maint,{bigint:true});assert.equal(hash(read(maint,undefined,0o600)),hash(maintenanceRaw));assert.equal(pin(named),pin(fs.lstatSync(maint,{bigint:true})));fs.unlinkSync(maint);const d=fs.openSync(plan.coordinationRoot,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}
   const terminal=await tx.deploymentOperation.updateMany({where:{id:plan.deploymentId,phase:'RECOVERY_REQUIRED',activeKey:'production',leaseToken:token},data:{phase:'ABORTED',activeKey:null,completedAt:new Date(),errorCode:'FAILED_LEGACY_CAPTURE_REOPENED_PREVIOUS_RELEASE',errorMessage:'Original signal observer failed before checkpoint; unchanged previous release independently verified.',reportJson:{originalReport:baseline.reportJson,failedLegacyCaptureReopen:{operationDirectory:directory,signalResultSha256:plan.legacySignal.result.sha256,previousGateReport:values[0].reportPath,originalCaptureGuardPassed:false,captureQualified:false,checkpointCreated:false,databaseRestored:false}}}});assert.equal(terminal.count,1);
  },{timeout:15000,maxWait:1000});done=true;audit('reopened',{deploymentId:plan.deploymentId,phase:'ABORTED',captureQualified:false,checkpointCreated:false,originalFailurePreserved:true});progress('REOPENED');process.stdout.write(JSON.stringify({format:'sabalan-failed-legacy-capture-reopen-completion/v1',deploymentId:plan.deploymentId,phase:'ABORTED',previousReleaseReopened:true,canonicalPreviousGates:gates.length,reconciliationProofs:reconciliationProofs.length,originalCaptureGuardPassed:false,captureQualified:false,checkpointCreated:false,databaseRestored:false,operationDirectory:directory})+'\n');
 }finally{
  try{
  if(heartbeat)clearInterval(heartbeat);await pulse;
  if(acquired&&!done){if(!fs.existsSync(maint)){const fd=fs.openSync(maint,'wx',0o600);try{fs.writeFileSync(fd,maintenanceRaw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const d=fs.openSync(plan.coordinationRoot,'r');try{fs.fsyncSync(d);}finally{fs.closeSync(d);}}audit('failed-held',{deploymentId:plan.deploymentId,maintenanceRetained:true,children});}
  }finally{await database.$disconnect();}
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]+$/.test(error.code)?error.code:'FAILED_HELD',name=typeof error?.name==='string'&&/^[A-Za-z][A-Za-z0-9]*$/.test(error.name)?error.name:'Error';process.stderr.write('FAILED_LEGACY_CAPTURE_REOPEN_'+phase+'_'+code+'_'+name+'\n');for(const line of String(error?.stack??'').split('\n').filter(value=>/^\s*at /.test(value)).slice(0,6))process.stderr.write(line+'\n');process.exitCode=1;});
