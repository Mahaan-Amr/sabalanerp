'use strict';
/** Control-only standalone QA process: no HTTP, jobs, publication or grants. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{randomBytes}=require('node:crypto'),{createInterface}=require('node:readline');
const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function validateInput(v){
 assert.deepEqual(Object.keys(v).sort(),['database','format','runtimeId','scopeSha256','targetCommit']);
 assert.equal(v.format,'sabalan-original-local-checkpoint-controller/v1');assert.match(v.database,/^qa_application_(native|restored)_[a-f0-9]{32}$/);assert.ok(hex(v.runtimeId)&&hex(v.scopeSha256));assert.match(v.targetCommit,/^[a-f0-9]{40}$/);return v;
}
exports.validateInput=validateInput;
let diagnosticStep='startup';
function safeDiagnostic(error){const rawName=String(error?.name??'Error'),rawCode=String(error?.code??'');const name=/^(?:Error|TypeError|RangeError|AssertionError|Prisma[A-Za-z]+Error)$/.test(rawName)?rawName:'Error',code=/^(?:E[A-Z0-9_]+|P[0-9]{4})$/.test(rawCode)?rawCode:'';const location=String(error?.stack??'').match(/([A-Za-z0-9_.-]+[.](?:cjs|mjs|js)):([0-9]+):[0-9]+/);return {step:diagnosticStep,name,code,firstLocation:location?location[1]+':'+location[2]:null,message:code==='ENOENT'?'Required file is absent':'Failure at '+diagnosticStep}}
exports.safeDiagnostic=safeDiagnostic;
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(process.argv.length,2);assert.ok(fs.fstatSync(0).isFIFO());
 const inputIdentity=()=>{const s=fs.fstatSync(0);assert.ok(s.isFIFO());return [s.dev,s.ino,s.rdev,s.mode]};
 const parent={kind:process.ppid===0?'DOCKER_EXEC_PRIVATE_FIFO':'VISIBLE_PARENT',pid:process.ppid,birth:process.ppid>0?fs.readFileSync('/proc/'+process.ppid+'/stat','utf8').split(') ')[1].split(' ')[19]:null,input:inputIdentity()};
 const lines=createInterface({input:process.stdin,crlfDelay:Infinity})[Symbol.asyncIterator]();let sequence=0,db,store,owner,advisory,heartbeat,busy=Promise.resolve(),held=false,finished=false;
 diagnosticStep='load-kernel';const kernel=require('/app/dist/scripts/online-release-host-kernel.js'),{PrismaClient}=require('/app/node_modules/@prisma/client');
 const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');
 const retain=error=>{if(held)return;held=true;emit({event:'HELD',reason:error?.code??error?.name??'OWNERSHIP_UNKNOWN',productionAdmission:false});setInterval(()=>{},10000)};
 async function original(){
  assert.equal(held,false);assert.equal(process.ppid,parent.pid);assert.deepEqual(inputIdentity(),parent.input);if(parent.pid>0)assert.equal(fs.readFileSync(`/proc/${process.ppid}/stat`,'utf8').split(') ')[1].split(' ')[19],parent.birth);
  const [row]=await db.$queryRaw`SELECT pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS birth,EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory' AND classid=0 AND objid=741936425 AND objsubid=1 AND granted AND mode='ExclusiveLock') AS owned`;
  assert.ok(row?.owned);assert.equal(row.pid,advisory.pid);assert.equal(row.birth,advisory.birth);await db.$transaction(tx=>kernel.assertOwnedOnlineLease(tx,owner,['ONLINE_CHECKPOINTING']));
 }
 function serialized(fn){const next=busy.then(fn);busy=next.catch(()=>{});return next}
 try{
  diagnosticStep='read-private-input';const first=await lines.next();assert.equal(first.done,false);assert.ok(first.value.length<4096);const input=validateInput(JSON.parse(first.value));const source=new URL(process.env.DATABASE_URL);assert.equal(source.hostname,'postgres');assert.equal(source.pathname,'/sabalanerp');source.pathname='/'+input.database;source.search='connection_limit=1&pool_timeout=10&application_name=qa-local-checkpoint-owner';
  diagnosticStep='create-sql-client';db=new PrismaClient({datasources:{db:{url:source.href}}});
  diagnosticStep='query-database-identity';const [identity]=await db.$queryRaw`SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()`;assert.equal(identity.name,input.database);
  diagnosticStep='acquire-original-advisory';const [lock]=await db.$queryRaw`SELECT pg_try_advisory_lock(741936425) AS owned,pg_backend_pid() AS pid,(SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS birth`;assert.ok(lock?.owned);advisory={pid:lock.pid,birth:lock.birth};
  diagnosticStep='acquire-canonical-lease';store=new kernel.PrismaDeploymentStore(db);const acquired=await kernel.acquireDeploymentLease(store,{deploymentId:'qa_checkpoint_'+randomBytes(16).toString('hex'),releaseId:'qa_capture_'+randomBytes(16).toString('hex'),targetCommit:input.targetCommit,owner:'original-isolated-local-checkpoint-owner',leaseToken:randomBytes(32).toString('hex'),now:new Date(),leaseMs:120000});assert.equal(acquired.acquired,true);owner={deploymentId:acquired.deployment.deploymentId,releaseId:acquired.deployment.releaseId,leaseToken:acquired.deployment.leaseToken};diagnosticStep='transition-online-checkpointing';await kernel.transitionDeployment(store,{...owner,nextPhase:'ONLINE_CHECKPOINTING',now:new Date()});await original();
  heartbeat=setInterval(()=>{void serialized(async()=>{if(finished)return;await original();await kernel.heartbeatDeployment(store,{...owner,now:new Date(),leaseMs:120000})}).catch(retain)},10000);
  const context=()=>({format:'sabalan-original-local-checkpoint-sql-context/v1',runtimeId:input.runtimeId,scopeSha256:input.scopeSha256,database:identity,phase:'ONLINE_CHECKPOINTING',lease:{...owner,advisory},originalControllerPid:process.pid,parentKind:parent.kind,productionAdmission:false});emit({event:'LEASE_READY',sequence:0,context:context()});
  for(;;){const line=await lines.next();assert.equal(line.done,false);assert.ok(line.value.length<1024);const request=JSON.parse(line.value);assert.deepEqual(Object.keys(request).sort(),['command','runtimeId','sequence']);assert.equal(request.sequence,++sequence);assert.equal(request.runtimeId,input.runtimeId);assert.ok(['READ_CONTEXT','CLOSE_ABORTED'].includes(request.command));
   await serialized(async()=>{await original();if(request.command==='READ_CONTEXT'){emit({event:'CONTEXT_OBSERVED',sequence,context:context()});return}
    clearInterval(heartbeat);await kernel.finishDeployment(store,{...owner,phase:'ABORTED',now:new Date()});const [unlocked]=await db.$queryRaw`SELECT pg_advisory_unlock(741936425) AS unlocked`;assert.equal(unlocked.unlocked,true);const rows=await db.$queryRaw`SELECT phase,"activeKey" FROM deployment_operations WHERE id=${owner.deploymentId}`;assert.equal(rows.length,1);assert.equal(rows[0].phase,'ABORTED');assert.equal(rows[0].activeKey,null);finished=true;emit({event:'CLOSED_ABORTED',sequence,phase:'ABORTED',productionAdmission:false});});if(finished)break;
  }
 }catch(error){if(owner){retain(error);await new Promise(()=>{})}throw error}
 finally{if(finished||!owner){clearInterval(heartbeat);if(db)await db.$disconnect()}}
}
if(require.main===module)main().catch(error=>{process.stderr.write(JSON.stringify({event:'LOCAL_CHECKPOINT_CONTROLLER_FAILED',diagnostic:safeDiagnostic(error)})+'\n');process.exitCode=1});