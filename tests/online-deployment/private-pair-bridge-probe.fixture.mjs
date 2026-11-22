/** Standalone isolated-QA client. Production producers/consumers remain in their original actors. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import readline from 'node:readline';
import {isIPv4} from 'node:net';

const installed=createRequire('/app/package.json');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=()=>new Promise(resolve=>setTimeout(resolve,50));
const bound=async(condition,label)=>{const end=Date.now()+120000;for(;;){const value=await condition();if(value)return value;assert.ok(Date.now()<end,label);await delay();}};
let stdinReader,stdinLines;
const readFrame=async()=>{if(!stdinReader){stdinReader=readline.createInterface({input:process.stdin,crlfDelay:Infinity});stdinLines=stdinReader[Symbol.asyncIterator]();}const next=await stdinLines.next();assert.equal(next.done,false);assert.ok(Buffer.byteLength(next.value)<=16384);return JSON.parse(next.value);};
const readInput=readFrame;

export function validateBridgeProbeInput(input,environment){
  assert.match(input.qualificationId,/^[a-f0-9]{64}$/);
  for(const key of ['httpRuntimeId','jobsRuntimeId','oldJobsRuntimeId','seedSha256'])assert.match(input[key],/^[a-f0-9]{64}$/);
  assert.notEqual(input.httpRuntimeId,input.jobsRuntimeId);assert.notEqual(input.oldJobsRuntimeId,input.jobsRuntimeId);
  assert.ok(Array.isArray(input.httpTargets)&&input.httpTargets.length===2&&new Set(input.httpTargets.map(target=>target.runtimeId)).size===2);
  for(const target of input.httpTargets){assert.match(target.runtimeId,/^[a-f0-9]{64}$/);assert.equal(isIPv4(target.host),true);assert.ok(Number.isInteger(target.port)&&target.port>=1024&&target.port<=65535);}
  assert.equal(input.httpTargets[0].runtimeId,input.httpRuntimeId);assert.equal(input.httpTargets[0].host,input.host);assert.equal(input.httpTargets[0].port,input.port);
  assert.match(input.database,/^qa_application_restored_[a-f0-9]{32}$/);
  assert.match(input.databaseOid,/^[1-9][0-9]*$/);assert.match(input.systemIdentifier,/^[0-9]+$/);
  assert.match(input.host,/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)[0-9.]+$/);
  assert.equal(isIPv4(input.host),true);
  assert.equal(input.host,environment.APPLICATION_NATIVE_BIND_HOST);
  assert.ok(Number.isInteger(input.port)&&input.port>=1024&&input.port<=65535);
  assert.ok(['observe','verify'].includes(input.mode??'observe'));
  const root=path.posix.resolve(input.qualificationRoot);assert.equal(root,input.qualificationRoot);
  assert.match(input.root,/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}$/);
  assert.ok(root.startsWith(input.root+'/'));
  assert.ok(root.endsWith('/private-qualifications/'+input.qualificationId+'/restored-app'));
  const url=new URL(environment.DATABASE_URL);assert.equal(url.protocol,'postgresql:');assert.equal(url.pathname,'/'+input.database);
  if(input.mode==='verify')assert.match(input.proofSha256,/^[a-f0-9]{64}$/);
  return {root,url,namespace:'qa-private-pair-'+input.qualificationId.slice(0,32)};
}

async function run(input){
 const {root,url,namespace}=validateBridgeProbeInput(input,process.env);
 url.searchParams.set('application_name',namespace);url.searchParams.set('connection_limit','2');url.searchParams.set('pool_timeout','10');
 assert.equal(process.env.BACKEND_RUNTIME_ROLE,'standalone');
 assert.equal(process.env.BACKEND_ONLINE_SCOPE_FILE,undefined);
 // This short-lived test process owns ONE installed-client pool, shared with
 // the injected canonical notification primitive; no application actor is adopted.
 process.env.DATABASE_URL=url.toString();
 const {prisma:db,disconnectDatabase}=installed('/app/dist/lib/prisma.js');
 const index=JSON.parse(fs.readFileSync(path.join(input.root,'index.json')));
 const pair=index.privateQualification;
 const config=JSON.parse(fs.readFileSync(path.join(input.root,'config.json')));
 assert.equal(pair.httpGrants.length,2);
 for(const [ordinal,target] of input.httpTargets.entries()){assert.equal(target.runtimeId,pair.httpGrants[ordinal].scope.runtimeId);assert.equal(target.host,config.roleTopology[ordinal===0?'main':'candidate'].host);}assert.equal(pair.qualificationId,input.qualificationId);
 assert.equal(pair.qualificationRoot,root);assert.equal(pair.httpGrant.scope.runtimeId,input.httpRuntimeId);
 assert.equal(pair.jobsGrant.scope.runtimeId,input.jobsRuntimeId);assert.equal(pair.oldJobsGrant.scope.runtimeId,input.oldJobsRuntimeId);
 const {realtimeBatchId,realtimeCommandId,canonicalRealtimeTargets}=installed('/app/dist/services/onlineRealtimeBridgeIdentity.js');
 const sockets=[],eventsByRuntime=new Map();let socketFailure;
 const proofFile=path.join(root,'private-pair-bridge-proof.json');
 const history=()=>db.$queryRawUnsafe('SELECT migration_name,checksum,finished_at,rolled_back_at,applied_steps_count FROM _prisma_migrations ORDER BY started_at,id');
 const exactRows=async(ids)=>{
  const batches=await db.onlineRealtimeBatch.findMany({where:{id:{in:ids.batchIds}},orderBy:{id:'asc'}});
  const commands=await db.onlineRealtimeCommand.findMany({where:{batchId:{in:ids.batchIds}},orderBy:{id:'asc'}});
  assert.equal(batches.length,2);assert.equal(commands.length,4);
  for(const batch of batches){
   const producer=batch.kind==='NOTIFICATION'?pair.oldJobsGrant:pair.jobsGrant;
   assert.equal(batch.producerRuntimeId,producer.scope.runtimeId);assert.equal(batch.producerNonceSha256,sha(producer.scope.nonce));
   assert.equal(batch.targetsJson.length,2);
   assert.deepEqual(batch.targetsJson.map(target=>target.runtimeId).sort(),input.httpTargets.map(target=>target.runtimeId).sort());
   for(const target of batch.targetsJson){const grant=pair.httpGrants.find(grant=>grant.scope.runtimeId===target.runtimeId);assert.ok(grant);
    assert.equal(target.nonceSha256,sha(grant.scope.nonce));assert.equal(target.imageIdentity,grant.scope.image);assert.equal(target.releaseId,grant.scope.releaseId);}
   assert.equal(batch.targetsSha256,canonicalRealtimeTargets(batch.targetsJson).sha256);
   const source=batch.kind==='NOTIFICATION'?{kind:'NOTIFICATION',sourceId:ids.outboxId,notificationId:ids.notificationId,userId:batch.userId}:{kind:'HR_PERSONNEL_INVALIDATION',sourceId:ids.intentId,notificationId:null,userId:null};
   assert.equal(batch.kind,source.kind);assert.equal(batch.sourceId,source.sourceId);
   assert.equal(batch.id,sha(JSON.stringify(['sabalan-private-qualification-batch/v1',input.qualificationId,realtimeBatchId(source)])));
  }
  assert.deepEqual(batches.map(row=>row.kind).sort(),['HR_PERSONNEL_INVALIDATION','NOTIFICATION']);
  for(const command of commands){const batch=batches.find(row=>row.id===command.batchId);assert.ok(batch);assert.equal(command.id,realtimeCommandId(batch.id,batch.targetsJson.find(target=>target.runtimeId===command.runtimeId)));assert.equal(command.status,'SETTLED');assert.ok(input.httpTargets.some(target=>target.runtimeId===command.runtimeId));assert.ok(command.claimToken&&command.startedAt&&command.settledAt);}
  const outbox=await db.notificationOutbox.findUniqueOrThrow({where:{id:ids.outboxId}});assert.equal(outbox.status,'PROCESSED');assert.ok(outbox.processedAt);
  const attempts=await db.notificationDeliveryAttempt.findMany({where:{notificationId:ids.notificationId,channel:'REALTIME'},orderBy:{id:'asc'}});
  assert.equal(attempts.length,1);assert.equal(attempts[0].status,'DELIVERED');
  const intent=await db.onlineHrInvalidationIntent.findUniqueOrThrow({where:{id:ids.intentId}});
  assert.equal(intent.originRuntimeId,input.httpRuntimeId);assert.equal(intent.sourceOutcome,'READY');assert.equal(intent.deliveryStatus,'SETTLED');assert.ok(intent.sourceSettledAt&&intent.deliverySettledAt);
  const person=await db.personnel.findUniqueOrThrow({where:{id:ids.personnelId}});assert.equal(person.lastName,ids.personnelLastName);
  return {batches,commands,outbox,attempts,intent,personnel:{id:person.id,lastName:person.lastName}};
 };
 try{
  const [identity]=await db.$queryRawUnsafe(`SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS system, current_setting('application_name') AS namespace`);
  assert.deepEqual(identity,{name:input.database,oid:input.databaseOid,system:input.systemIdentifier,namespace});
  if(input.mode==='verify'){
   const bytes=fs.readFileSync(proofFile);assert.equal(sha(bytes),input.proofSha256);const proof=JSON.parse(bytes);
   assert.equal(proof.qualificationId,input.qualificationId);assert.equal(proof.databaseOid,input.databaseOid);
   assert.deepEqual(JSON.parse(JSON.stringify(await exactRows(proof.ids))),proof.durable);
   assert.equal(sha(JSON.stringify(await history())),proof.migrationHistorySha256);
   return {format:'sabalan-private-pair-bridge-after-drain/v1',passResult:true,proofSha256:input.proofSha256,historyUnchanged:true,durableAcknowledgmentsUnchanged:true};
  }
  assert.equal(fs.existsSync(proofFile),false);
  const seedBytes=fs.readFileSync(path.join(root,'acceptance-seed.json'));assert.equal(sha(seedBytes),input.seedSha256);const seed=JSON.parse(seedBytes);
  const user=await db.user.findUniqueOrThrow({where:{id:seed.adminId}});assert.equal(user.role,'ADMIN');assert.equal(user.isActive,true);
  const beforeHistory=sha(JSON.stringify(await history()));
  const WebSocket=installed('ws');
  for(const target of input.httpTargets){
   const state={target,events:[],connected:false,closed:false};eventsByRuntime.set(target.runtimeId,state.events);
   const socket=new WebSocket(`ws://${target.host}:${target.port}/socket.io/?EIO=4&transport=websocket`,{headers:{cookie:'sabalan_session='+seed.sessionToken}});state.socket=socket;sockets.push(state);
   socket.on('error',error=>{socketFailure=error;});socket.on('close',()=>{state.closed=true;});
   socket.on('message',bytes=>{try{const text=bytes.toString();if(text.startsWith('0'))socket.send('40'+JSON.stringify({expectedUserId:seed.adminId}));else if(text==='2')socket.send('3');else if(text.startsWith('40'))state.connected=true;else if(text.startsWith('44'))socketFailure=Error('PRIVATE_PAIR_SOCKET_AUTH_REFUSED');else if(text.startsWith('42'))state.events.push(JSON.parse(text.slice(2)));}catch(error){socketFailure=error;}});
  }
  await bound(()=>{if(socketFailure)throw socketFailure;return sockets.every(state=>state.connected);},'PRIVATE_PAIR_SOCKET_NOT_AUTHENTICATED');
  const {publishNotificationEvent}=installed('/app/dist/services/notificationService.js');
  const event=await db.$transaction(tx=>publishNotificationEvent(tx,{type:'SYSTEM_RECOVERY_COMPLETED',deduplicationKey:'private-pair-'+input.qualificationId,recipientIds:[seed.adminId],recipientGroups:{ACTIVE_ADMINS:[seed.adminId]},actorId:seed.adminId,payload:{actorDisplay:'Private restored qualification'}}));assert.ok(event);
  const notification=await db.notification.findFirstOrThrow({where:{eventId:event.id,userId:seed.adminId}});
  const outbox=await db.notificationOutbox.findUniqueOrThrow({where:{eventId:event.id}});
  await bound(()=>{if(socketFailure)throw socketFailure;return sockets.every(state=>state.events.some(([name,payload])=>name==='notification.created'&&payload.id===notification.id));},'PRIVATE_PAIR_NOTIFICATION_WIRE_NOT_OBSERVED');
  // Keep THESE same authenticated clients and source row across the actual
  // old-original-worker closure/new-original-worker startup. No replay.
  const notificationBatch=await bound(async()=>{const rows=await db.onlineRealtimeBatch.findMany({where:{sourceId:outbox.id}});return rows.length===1?rows[0]:false;},'PRIVATE_PAIR_OLD_BATCH_MISSING');
  assert.equal(notificationBatch.producerRuntimeId,input.oldJobsRuntimeId);
  await bound(async()=>{const commands=await db.onlineRealtimeCommand.findMany({where:{batchId:notificationBatch.id}});return commands.length===2&&commands.every(row=>row.status==='SETTLED');},'PRIVATE_PAIR_OLD_ACK_NOT_SETTLED');
  process.stdout.write('SABALAN_PRIVATE_BRIDGE_STAGE '+JSON.stringify({event:'PREDECESSOR_NOTIFICATION_SETTLED',qualificationId:input.qualificationId,oldJobsRuntimeId:input.oldJobsRuntimeId,notificationBatchId:notificationBatch.id})+'\n');
  const handoff=await readFrame();assert.deepEqual(Object.keys(handoff).sort(),['command','newJobsRuntimeId','oldNativeSha256','oldJobsRuntimeId']);
  assert.equal(handoff.command,'ORIGINAL_OLD_JOBS_CLOSED_NEW_JOBS_READY');assert.equal(handoff.oldJobsRuntimeId,input.oldJobsRuntimeId);assert.equal(handoff.newJobsRuntimeId,input.jobsRuntimeId);assert.match(handoff.oldNativeSha256,/^[a-f0-9]{64}$/);
  // Own isolated fixture row; the real HTTP route and its original source reservation mint READY.
  const person=await db.personnel.create({data:{firstName:'Private bridge',lastName:input.qualificationId.slice(0,16),isActive:true}});
  const prior=await db.onlineHrInvalidationIntent.findMany({select:{id:true}});const priorIds=new Set(prior.map(row=>row.id));
  const changed='Qualified '+input.qualificationId.slice(0,16);
  const hrWireBefore=sockets.map(state=>state.events.filter(([name])=>name==='hr.personnel.changed').length);
  const response=await fetch(`http://${input.host}:${input.port}/api/hr/personnel/${encodeURIComponent(person.id)}`,{method:'PUT',headers:{Cookie:'sabalan_session='+seed.sessionToken,'Content-Type':'application/json'},body:JSON.stringify({firstName:person.firstName,lastName:changed,nationalCode:null,employeeNumber:null})});
  assert.equal(response.status,200);assert.equal((await response.json()).success,true);
  const intent=await bound(async()=>{const rows=await db.onlineHrInvalidationIntent.findMany({where:{originRuntimeId:input.httpRuntimeId}});const fresh=rows.filter(row=>!priorIds.has(row.id));assert.ok(fresh.length<=1);return fresh[0]?.sourceOutcome==='READY'?fresh[0]:false;},'PRIVATE_PAIR_HR_SOURCE_NOT_READY');
  await bound(()=>{if(socketFailure)throw socketFailure;return sockets.every((state,index)=>state.events.filter(([name])=>name==='hr.personnel.changed').length>hrWireBefore[index]);},'PRIVATE_PAIR_HR_WIRE_NOT_OBSERVED');
  const batches=await bound(async()=>{const rows=await db.onlineRealtimeBatch.findMany({where:{sourceId:{in:[outbox.id,intent.id]}}});return rows.length===2?rows:false;},'PRIVATE_PAIR_BATCHES_MISSING');
  const ids={batchIds:batches.map(row=>row.id).sort(),outboxId:outbox.id,notificationId:notification.id,intentId:intent.id,personnelId:person.id,personnelLastName:changed};
  const durable=await bound(async()=>{const commands=await db.onlineRealtimeCommand.findMany({where:{batchId:{in:ids.batchIds}}});const source=await db.onlineHrInvalidationIntent.findUniqueOrThrow({where:{id:intent.id}});const o=await db.notificationOutbox.findUniqueOrThrow({where:{id:outbox.id}});return commands.length===4&&commands.every(row=>row.status==='SETTLED')&&source.deliveryStatus==='SETTLED'&&o.status==='PROCESSED'?exactRows(ids):false;},'PRIVATE_PAIR_DURABLE_ACK_NOT_SETTLED');
  assert.equal(sha(JSON.stringify(await history())),beforeHistory);
  for(const state of sockets)state.socket.close();await bound(()=>sockets.every(state=>state.closed),'PRIVATE_PAIR_ORIGINAL_SOCKET_NOT_CLOSED');
  const proof={format:'sabalan-private-pair-bridge-proof/v1',qualificationId:input.qualificationId,databaseOid:input.databaseOid,workerHandoff:{oldJobsRuntimeId:input.oldJobsRuntimeId,newJobsRuntimeId:input.jobsRuntimeId,oldNativeSha256:handoff.oldNativeSha256},ids,durable:JSON.parse(JSON.stringify(durable)),clientObservations:sockets.map(state=>({runtimeId:state.target.runtimeId,authenticated:state.connected,originalSocketClosed:state.closed,observedEvents:['notification.created','hr.personnel.changed']})),migrationHistorySha256:beforeHistory};
  const bytes=Buffer.from(JSON.stringify(proof));const fd=fs.openSync(proofFile,fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_WRONLY|fs.constants.O_NOFOLLOW,0o400);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {format:'sabalan-private-pair-bridge-qualification/v1',passResult:true,qualificationId:input.qualificationId,proofSha256:sha(bytes),ids,authenticatedWireObserved:['notification.created','hr.personnel.changed'],httpTargetCount:2,durableConsumerAcknowledgments:4,clientAckProtocol:false,originalSocketClosed:true,migrationHistoryUnchanged:true,productionAdmission:false};
 }finally{
  for(const state of sockets)if(!state.closed)state.socket.close();
  await bound(()=>sockets.every(state=>state.closed),'PRIVATE_PAIR_ORIGINAL_SOCKET_CLOSE_UNPROVEN');
  await disconnectDatabase();stdinReader?.close();
 }
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(fileURLToPath(import.meta.url))){
 try{const result=await run(await readInput());process.stdout.write(JSON.stringify(result)+'\n');}catch(error){process.stderr.write((error?.stack??String(error))+'\n');process.exitCode=1;}
}
