import {assertLocalDevSuspensionCurrent,localDevCaptureScope} from './local-dev-frontend-suspension.mjs';
import {expectedQaCandidateMemory} from './application-native-qa-profile.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateKeyPairSync, randomBytes, createHash, sign} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {readOriginalRetainedBrowserQualificationCompletion} from './original-retained-browser-qualification.mjs';
import {compilePrivateQualificationMaterial,qualificationBytes} from './application-native-private-qualification.mjs';
import {consumeOriginalPrivateLegacyUiCommand,beginOriginalPrivateLegacyUiCarrier,readOriginalPrivateLegacyUiCarrier,restoreOriginalPrivateLegacyUiCarrier,readOriginalPrivateLegacyUiRestoration,readOriginalPrivateLegacyUiComposeEnvironment} from './original-private-legacy-ui-carrier.mjs';
import {createOriginalLocalCheckpointCrypto,readOriginalLocalCheckpointCryptoCompletion} from './original-local-checkpoint-crypto.mjs';
import {createOriginalLocalOnlineCheckpoint,readOriginalLocalOnlineCheckpointCompletion} from './original-local-online-checkpoint.mjs';

const originalQualificationCompletions=new WeakMap();
const originalQualificationPointCompletions=new WeakMap();
export function readOriginalRoleOnlinePointCompletion(token){const value=originalQualificationPointCompletions.get(token);assert.ok(value,'ORIGINAL_ROLE_ONLINE_POINT_COMPLETION_REQUIRED');return value;}
const originalPrivateBrowserControllers=new WeakSet();
const originalOnlineCapturePlans=new WeakMap();
export function readOriginalLocalOnlineCapturePlan(token){const value=originalOnlineCapturePlans.get(token);assert.ok(value,'ORIGINAL_LOCAL_ONLINE_CAPTURE_PLAN_REQUIRED');value.assertLive();return structuredClone(value.plan);}
export function assertOriginalPrivateBrowserRoundController(controller){assert.ok(originalPrivateBrowserControllers.has(controller),'ORIGINAL_PRIVATE_BROWSER_CONTROLLER_REQUIRED');}
export function readOriginalRoleQualificationCompletion(token){
 const value=originalQualificationCompletions.get(token);assert.ok(value,'ORIGINAL_ROLE_COMPLETION_TOKEN_REQUIRED');return structuredClone(value);
}

const PREFIX='SABALAN_ORIGINAL_CONTROL ',FORMAT='sabalan-original-host-controller/v1';
const MAX=8*1024*1024,FRAME=12*1024*1024;
const requiredMemory=Object.freeze({'online-point-inquiry':192*1024**2,'pristine-performance':256*1024**2,migration:384*1024**2,chrome:256*1024**2,
  'restored-baseline':128*1024**2,'restored-inquiry':192*1024**2,'restored-http':256*1024**2,
  'legacy-private-chrome':256*1024**2,'legacy-private-browser-verify':128*1024**2,'private-jobs':384*1024**2,'private-http2':256*1024**2,'full-catalog':384*1024**2,'private-browser-verify':128*1024**2,'private-chrome':256*1024**2,'private-domain':128*1024**2,'private-domain-baseline':128*1024**2,'private-domain-verify':128*1024**2});
const transitions=Object.freeze({VERIFY_PRIVATE_BROWSER_TICKETS:['PRIVATE_BROWSER_TICKETS_VERIFIED','private-browser-verify'],START_PRIVATE_CHROME:['PRIVATE_CHROME_READY','private-chrome'],WAIT_PRIVATE_CHROME_CLOSED:['PRIVATE_CHROME_CLOSED','private-chrome'],RUN_PRIVATE_DOMAIN_BASELINE:['PRIVATE_DOMAIN_BASELINE_DONE','private-domain-baseline'],VERIFY_PRIVATE_DOMAIN_RESTORE:['PRIVATE_DOMAIN_RESTORE_VERIFIED','private-domain-verify'],RUN_PRIVATE_DOMAIN_CASES:['PRIVATE_DOMAIN_DONE','private-domain'],RUN_MIGRATION:['MIGRATION_DONE','migration'],
  RUN_PRISTINE_PERFORMANCE:['PRISTINE_PERFORMANCE_DONE','pristine-performance'],
  START_ONLINE_POINT_INQUIRY:['ONLINE_POINT_INQUIRY_READY','online-point-inquiry'],FINISH_ONLINE_POINT_INQUIRY:['ONLINE_POINT_INQUIRY_DONE','online-point-inquiry'],
  START_PRIVATE_LEGACY_CHROME:['PRIVATE_LEGACY_CHROME_READY','legacy-private-chrome'],WAIT_PRIVATE_LEGACY_CHROME_CLOSED:['PRIVATE_LEGACY_CHROME_CLOSED','legacy-private-chrome'],VERIFY_PRIVATE_LEGACY_BROWSER_TICKETS:['PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED','legacy-private-browser-verify'],
  START_CHROME:['CHROME_READY','chrome'],RUN_RESTORED_BASELINE:['RESTORED_BASELINE_DONE','restored-baseline'],
  RUN_RESTORED_INQUIRY:['RESTORED_INQUIRY_DONE','restored-inquiry'],
  START_RESTORED_HTTP:['RESTORED_HTTP_READY','restored-http'],
  FINISH_RESTORED_HTTP:['RESTORED_HTTP_DONE','restored-http'],WAIT_CHROME_CLOSED:['CHROME_CLOSED','chrome'],
  RUN_FULL_CATALOG:['FULL_CATALOG_DONE','full-catalog'],START_PRIVATE_JOBS:['PRIVATE_JOBS_READY','private-jobs'],
  PREPARE_PRIVATE_JOBS:['PRIVATE_JOBS_PREPARED','private-jobs'],FINISH_PRIVATE_JOBS:['PRIVATE_JOBS_DONE','private-jobs'],
  START_PRIVATE_HTTP2:['PRIVATE_HTTP2_READY','private-http2'],PREPARE_PRIVATE_HTTP2:['PRIVATE_HTTP2_PREPARED','private-http2'],FINISH_PRIVATE_HTTP2:['PRIVATE_HTTP2_DONE','private-http2']});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>assert.deepEqual(a,b);
const sorted=value=>Array.isArray(value)?value.map(sorted):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sorted(value[key])])):value;

/** Negative receipt validation only; this does not mint controller authority.
 * The caller below accepts it only on the enrolled original main stdout. */
export function validateEarlyMainFailedClosure(body,{phase,pending,candidateActorCount,index}){
  same(phase,'ENROLLED');same(pending,null);same(candidateActorCount,0);
  same(body.failureKind,'EARLY_HTTP_STARTUP_CLOSED');validateOriginalMainHttpClosure(body,index,1);
}
export function validateMainAwaitingMigrationClosure(body,{phase,request,index}){
  assert.ok(['ENROLLED','PRISTINE_PERFORMANCE_DONE','PHASE_FAILED','MIGRATION_DONE'].includes(phase));
  same(body.failureKind,'HTTP_CLOSED_AWAITING_ORIGINAL_CANDIDATE');same(body.requestCount,request.ordinal??1);
  same(body.failedReceive,{requestId:request.requestId,command:'RUN_MIGRATION',expected:'MIGRATION_DONE',
    reason:'ORIGINAL_HOST_CHANNEL_EMPTY_READ'});
  same(request.kind,'migration');same(request.expected,'MIGRATION_DONE');
  validateOriginalMainHttpClosure(body,index,0);
}
function validateOriginalMainHttpClosure(body,index,status){
  same(body.originalPass,false);
  same(body.productionAdmission,false);same(body.edgeNeverCreated,true);same(body.originalChromeClosed,false);
  same(body.edgeClosure,null);same(body.owners.length,1);
  validateOriginalMainHttpOwner(body.owners[0],index.grants[0],index,status);
}
function validateOriginalMainHttpOwner(entry,grant,index,status){
  const native=JSON.parse(Buffer.from(entry.nativeRawBase64,'base64'));
  const work=JSON.parse(Buffer.from(entry.workRawBase64,'base64'));
  same(grant.scope.purpose,'http');same(native.onlineScope.scope,grant.scope);
  same(native.onlineScope.sha256,grant.sha256);same(entry.runtimeId,grant.scope.runtimeId);
  same(entry.originalReturncode,status);same(native.nativeStatus,status);same(entry.originalPopenPid,native.guardian.pid);
  assert.ok(Number.isSafeInteger(entry.originalPopenPid)&&entry.originalPopenPid>1);
  same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');same(native.nativeReaped,true);
  same(native.databaseQuiet,true);same(native.stoppedBySignal,false);
  const active=Object.fromEntries(Object.entries(native).filter(([key])=>!['activeClaimSha256','nativeReaped',
    'databaseQuiet','nativeStatus','stoppedBySignal'].includes(key)));active.phase='ACTIVE';
  // The original main also compares the actual durable claim bytes and freshly
  // queries full-visible SQL before this event; a timeout cannot supply it.
  same(sha(Buffer.from(JSON.stringify(sorted(active))+'\n')),native.activeClaimSha256);
  same(entry.claimNative,{scopeSha256:grant.sha256,claimSha256:native.activeClaimSha256});
  same(entry.freshSql,{visible:true,systemIdentifier:grant.scope.database.systemIdentifier,
    databaseOid:index.oid,namespaceSessions:0,prepared:0});
}

/** Diagnostic only. The private key and both original Docker-exec handles never
 * leave this closure. There is deliberately no public arbitrary signer. */
export function createOriginalRoleCoordinator({directory,topology,fileHashes,retainedBrowserCompletion,originalServiceIdentities,independentOptions,nativeOwnerElfReceipt,frontendSnapshot,qaMemoryProfile=null,localDevSuspension,onHeld=()=>{}}){
  assert.match(directory,/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}$/);
  const retained=retainedBrowserCompletion?readOriginalRetainedBrowserQualificationCompletion(retainedBrowserCompletion):null;assert.deepEqual(localDevSuspension??null,retained?.report.localDevSuspension??null,'ORIGINAL_RETAINED_SUSPENSION_SELECTION_REQUIRED');
  for(const role of ['main','candidate']){
    assert.ok(hex(topology[role].containerId));assert.match(topology[role].image,/^sha256:[a-f0-9]{64}$/);
    assert.match(topology[role].host,/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/);
  }
  const {privateKey,publicKey}=generateKeyPairSync('ed25519'),session=randomBytes(32).toString('hex');
  const publicSPKI=publicKey.export({type:'spki',format:'der'}).toString('base64');
  const roles=new Map(),actors=new Map();let pending=null,held=null,phase='NEW',heldKeeper=null,evidenceFailure=null,mainIndex=null;
  let mainRequests=0,firstMigrationRequest=null,migrationTerminal=null;
  const history=[],phaseRefusals=[];let failedCandidateReadyResolve;
  const originalProofObservers=[],completedPhases=new Map();
  const qualificationState={issued:null,http:null,jobsPrepared:false,httpPrepared:false,http2Prepared:false,oldJobs:null,oldJobsPrepared:false,fence:null};
  let mainConfiguration=null;
  const legacyRoundId=randomBytes(32).toString('hex');let legacyCarrier=null,legacyRestoration=null,originalController,localCrypto=null;
  const localCryptoCompletions=[];
  let localCryptoClosed=false;
  let localOnlineOwner=null,localOnlineCompletion=null,originalOnlineInquiry=null;
  const legacyDockerChildren=[];
  function assertLegacyReady(){assert.equal(held,null);assert.ok(qualificationState.http?.ready&&!qualificationState.http.closed&&!qualificationState.httpPrepared);
    const actor=[...actors.values()].find(row=>row.kind==='private-http2');assert.ok(actor&&!actor.closed&&completedPhases.has('PRIVATE_HTTP2_READY')&&!qualificationState.http2Prepared);}
  async function legacyDocker(args,input,maximum,guard=true){
    assertLegacyReady();if(guard)await legacyDocker(['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--format','json'],undefined,1048576,false);
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe'],env:{...process.env,...readOriginalPrivateLegacyUiComposeEnvironment()}}),record={child,closed:false,unknown:false};legacyDockerChildren.push(record);
    const out=[];let size=0,errorSize=0;
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size<=maximum)out.push(chunk);else{record.unknown=true;hold(Error('ORIGINAL_LEGACY_DOCKER_OUTPUT_BOUND'));}});
    child.stderr.on('data',chunk=>{errorSize+=chunk.length;if(errorSize>65536){record.unknown=true;hold(Error('ORIGINAL_LEGACY_DOCKER_STDERR_BOUND'));}});
    child.on('error',error=>{record.unknown=true;hold(error);});child.stdin.on('error',error=>{record.unknown=true;hold(error);});child.stdin.end(input);
    const result=await new Promise(resolve=>child.once('close',(code,signal)=>{record.closed=true;record.code=code;record.signal=signal;resolve({code,signal});}));
    assert.equal(record.unknown,false);assert.deepEqual(result,{code:0,signal:null});return {...result,stdout:Buffer.concat(out).toString(),originalPid:child.pid,originalChildClosed:true};
  }
  const failedCandidateReady=new Promise(resolve=>{failedCandidateReadyResolve=resolve;});
  function record(direction,role,sequence,command,body,raw){
    assert.ok(history.length<4096);history.push(Object.freeze({direction,role,sequence,command,
      ...(hex(body.requestId)?{requestId:body.requestId}:{}),payloadSha256:sha(raw),payloadBytes:raw.length}));
  }
  const enrollment=Object.freeze({format:FORMAT,publicKey:publicSPKI,session,roleTopology:topology});
  function hold(error){if(!held){held=error;
    heldKeeper=setInterval(()=>{void privateKey;void roles;},30000);
    try{onHeld({format:FORMAT,productionAdmission:false,state:'HELD',reason:error.message,...(error.innerHeld?{innerHeld:error.innerHeld}:{}),
      originalControllers:[...roles].map(([role,v])=>({role,pid:v.child.pid,closed:v.closed})),history:[...history]});}
    catch(failure){evidenceFailure=failure.message;}}}
  function send(role,command,body){
    assert.equal(held,null);const owner=roles.get(role);assert.ok(owner&&!owner.closed&&!owner.child.stdin.destroyed);
    const raw=Buffer.from(JSON.stringify(body));assert.ok(raw.length<=MAX);
    const payload=raw.toString('base64'),sequence=++owner.sent;
    const preimage=Buffer.from([FORMAT,session,role,String(sequence),command,payload].join('\0'),'ascii');
    const value={format:FORMAT,session,role,sequence,command,payload,signature:sign(null,preimage,privateKey).toString('base64')};
    const frame=PREFIX+JSON.stringify(value)+'\n';assert.ok(Buffer.byteLength(frame)<=FRAME);
    record('send',role,sequence,command,body,raw);
    owner.child.stdin.write(frame);
  }
  async function originalQualificationScript(name,input){
    assert.equal(held,null);
    if(['private-qualification-observer.py','private-installed-runtime-observer.py'].includes(name)||input.mode==='initialize')assert.ok(!qualificationState.issued);
    else assert.ok(qualificationState.issued&&['fence','close'].includes(input.mode));
    assert.ok(roles.get('main')&&!roles.get('main').closed);
    assert.ok(['private-qualification-observer.py','private-qualification-materialize.py','private-installed-runtime-observer.py'].includes(name));
    assert.ok(hex(fileHashes[name]));
    execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps'],{stdio:'ignore'});
    const bootstrap="import hashlib,runpy,sys; p=sys.argv[1]; expected=sys.argv[2]; assert hashlib.sha256(open(p,'rb').read()).hexdigest()==expected; sys.argv=[p]; runpy.run_path(p,run_name='__main__')";
    const child=spawn('docker',['exec','-i',topology[name==='private-installed-runtime-observer.py'?'candidate':'main'].containerId,'/usr/bin/python3','-I','-B','-c',bootstrap,
      directory+'/'+name,fileHashes[name]],{stdio:['pipe','pipe','pipe']});
    const observer={child,closed:false,stdout:[],stderr:[],bytes:0,errorBytes:0};originalProofObservers.push(observer);
    child.stdout.on('data',bytes=>{observer.bytes+=bytes.length;if(observer.bytes<=MAX)observer.stdout.push(bytes);else hold(Error('PRIVATE_ORIGINAL_OBSERVER_OUTPUT_BOUND'));});
    child.stderr.on('data',bytes=>{observer.errorBytes+=bytes.length;if(observer.errorBytes<=65536)observer.stderr.push(bytes);else hold(Error('PRIVATE_ORIGINAL_OBSERVER_ERROR_BOUND'));});
    child.on('error',hold);child.stdin.on('error',hold);child.stdin.end(JSON.stringify({root:directory,...input}));
    await new Promise(resolve=>child.once('close',(code,signal)=>{observer.closed=true;observer.code=code;observer.signal=signal;resolve();}));
    assert.equal(held,null);same(observer.code,0);same(observer.signal,null);
    return JSON.parse(Buffer.concat(observer.stdout));
  }
  async function issueOriginalQualification(body){
    same(held,null);same(qualificationState.issued,null);assert.ok(pending?.expected==='PRIVATE_QUALIFICATION_ISSUED');
    assert.ok(mainConfiguration&&mainConfiguration.privateQualificationRuntime);
    assert.ok([...actors.values()].every(actor=>actor.closed));
    for(const event of ['MIGRATION_DONE','RESTORED_BASELINE_DONE','RESTORED_INQUIRY_DONE','RESTORED_HTTP_DONE','CHROME_CLOSED','FULL_CATALOG_DONE'])assert.ok(completedPhases.has(event));
    same(Object.keys(body.input).sort(),['sourceClosures']);same(body.input.sourceClosures.length,2);
    const facts=await originalQualificationScript('private-qualification-observer.py',{});
    facts.candidateRuntime=await originalQualificationScript('private-installed-runtime-observer.py',{});
    same(facts.format,'sabalan-original-private-qualification-observation/v1');
    same(facts.originalSqlProbe.returncode,0);same(facts.originalSqlProbe.reaped,true);
    same(facts.sourceSql,{visible:true,sessions:0,prepared:0,databaseOid:String(mainIndex.oid)});
    const originalHttp=mainIndex.grants.filter(grant=>grant.scope.purpose==='http');same(originalHttp.length,2);
    for(const grant of originalHttp){
      const entries=body.input.sourceClosures.filter(entry=>entry.runtimeId===grant.scope.runtimeId);same(entries.length,1);
      validateOriginalMainHttpOwner(entries[0],grant,mainIndex,0);
      const durable=facts.sourceNative[grant.scope.runtimeId];assert.ok(durable);
      same(entries[0].nativeRawBase64,durable.nativeRawBase64);same(entries[0].workRawBase64,durable.workRawBase64);
      same(entries[0].claimNative,durable.claimNative);
    }
    const material=compilePrivateQualificationMaterial({index:mainIndex,config:mainConfiguration,
      baselineCompletion:completedPhases.get('RESTORED_BASELINE_DONE').result,facts,now:new Date()});
    const materials={};
    for(const [id,decision]of Object.entries(material.decisionsByRuntime))materials[id]={artifacts:material.artifactsByRuntime[id],
      decision:{format:'sabalan-signed-online-private-qualification/v1',decision,
        signature:sign(null,Buffer.concat([Buffer.from('sabalan-online-private-qualification/v1\n'),qualificationBytes(decision)]),privateKey).toString('base64')}};
    const initialized=await originalQualificationScript('private-qualification-materialize.py',{mode:'initialize',materials,
      bootstrapSha256:fileHashes['private-qualification-bootstrap.sql']});
    same(initialized.format,'sabalan-original-private-qualification-initializer/v1');same(initialized.mode,'initialize');
    same(initialized.qualificationId,mainIndex.privateQualification.qualificationId);same(initialized.targetsSha256,material.targetsSha256);
    same(initialized.phase,'ACTIVE');same(initialized.productionAdmission,false);same(initialized.targetCount,2);
    assert.ok(initialized.originalSqlChildren.every(child=>child.returncode===0&&child.reaped===true));
    qualificationState.issued={material,materials,initialized,facts};
    send('main','PRIVATE_QUALIFICATION_ISSUED',{requestId:body.requestId,qualificationId:mainIndex.privateQualification.qualificationId,
      targetsSha256:material.targetsSha256,actualHttpTargets:2,initializer:initialized});
    pending=null;phase='PRIVATE_QUALIFICATION_ISSUED';
  }
  function privateControlWire(actor,command){
    assert.equal(held,null);assert.ok(qualificationState.issued&&actor&&!actor.closed);
    assert.ok(['PRIVATE_PREPARE_DRAIN','PRIVATE_SHUTDOWN'].includes(command));
    if(command==='PRIVATE_SHUTDOWN'){if(actor.kind==='private-old-jobs')assert.ok(qualificationState.oldJobsPrepared);else if(actor.kind==='private-jobs')assert.ok(qualificationState.jobsPrepared);else assert.ok(qualificationState.fence&&qualificationState.jobsPrepared&&qualificationState.httpPrepared&&qualificationState.http2Prepared);}
    const sequence=command==='PRIVATE_PREPARE_DRAIN'?1:2;
    same(actor.controlSequence||0,sequence-1);actor.controlSequence=sequence;
    const unsigned={format:'sabalan-private-qualification-control/v1',session,actorId:actor.actorId,
      scopeSha256:actor.scopeSha256,sequence,command};
    const preimage=Buffer.from([unsigned.format,session,actor.actorId,actor.scopeSha256,String(sequence),command].join('\0'),'utf8');
    return JSON.stringify({...unsigned,signature:sign(null,preimage,privateKey).toString('base64')});
  }
  async function privateFence(mode){
    assert.ok(qualificationState.issued&&qualificationState.httpPrepared&&qualificationState.http2Prepared&&qualificationState.jobsPrepared&&qualificationState.oldJobs?.closed);
    if(mode==='fence')assert.equal(qualificationState.fence,null);
    else{same(mode,'close');same(qualificationState.fence.phase,'DRAINING');
      assert.ok(qualificationState.http.closed&&[...actors.values()].filter(a=>a.kind==='private-jobs').every(a=>a.closed));}
    const result=await originalQualificationScript('private-qualification-materialize.py',{mode,
      materials:qualificationState.issued.materials,bootstrapSha256:fileHashes['private-qualification-bootstrap.sql']});
    same(result.format,'sabalan-original-private-qualification-initializer/v1');same(result.mode,mode);
    same(result.qualificationId,mainIndex.privateQualification.qualificationId);
    same(result.targetsSha256,qualificationState.issued.material.targetsSha256);
    same(result.phase,mode==='fence'?'DRAINING':'CLOSED');same(result.productionAdmission,false);
    assert.ok(result.originalSqlChildren.length>0&&result.originalSqlChildren.every(child=>child.returncode===0&&child.reaped===true));
    qualificationState.fence=result;
    return result;
  }
  function privateHttpEvent(event,body){
    assert.ok(qualificationState.issued);same(pending,null);
    const grant=mainIndex.privateQualification.httpGrant;
    if(event==='PRIVATE_HTTP_STARTED'){
      same(qualificationState.http,null);same(body.scopeSha256,grant.sha256);
      const native=JSON.parse(Buffer.from(body.activeNativeRawBase64,'base64'));
      same(native.phase,'ACTIVE');same(native.guardian,body.birth);same(body.originalPopenPid,body.birth.pid);
      same(native.onlineScope.scope,grant.scope);same(native.onlineScope.sha256,grant.sha256);
      same(grant.scope.image,topology.main.image);same(grant.scope.manifestSha256,mainIndex.privateQualification.runtimeBundleSha256);
      assert.ok(hex(body.actorId));qualificationState.http={...body,closed:false};return;
    }
    const actor=qualificationState.http;assert.ok(actor&&!actor.closed);same(body.actorId,actor.actorId);
    if(event==='PRIVATE_HTTP_READY'){
      same(actor.ready,undefined);same(body.result.event,'READY');same(body.result.actorId,actor.actorId);
      same(body.result.scopeSha256,grant.sha256);same(body.result.identity.runtimeId,grant.scope.runtimeId);
      same(body.result.identity.purpose,'http');same(body.result.identity.qualificationId,mainIndex.privateQualification.qualificationId);
      same(body.result.identity.runtimeBundleSha256,mainIndex.privateQualification.runtimeBundleSha256);
      same(body.result.identity.image,topology.main.image);same(body.result.installedEntrySha256,mainConfiguration.privateQualificationRuntime.entrySha256);
      actor.ready=body.result;return;
    }
    if(event==='PRIVATE_HTTP_PREPARED'){
      assert.ok(actor.ready);same(actor.controlSequence,1);same(body.result.event,'PREPARED');same(body.result.sequence,1);
      same(body.result.scopeSha256,grant.sha256);qualificationState.httpPrepared=true;return;
    }
    same(event,'PRIVATE_HTTP_CLOSED');same(actor.controlSequence,2);same(body.result.event,'CLOSED');same(body.result.sequence,2);
    const closure=body.closure,native=JSON.parse(Buffer.from(closure.nativeRawBase64,'base64')),work=JSON.parse(Buffer.from(closure.workRawBase64,'base64'));
    same(closure.originalPopenPid,actor.originalPopenPid);same(closure.originalReturncode,0);same(closure.scopeSha256,grant.sha256);
    same(native.guardian,actor.birth);same(native.activeClaimSha256,sha(Buffer.from(actor.activeNativeRawBase64,'base64')));
    same(native.onlineScope.scope,grant.scope);same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');
    same(native.nativeStatus,0);same(native.nativeReaped,true);same(native.databaseQuiet,true);same(native.stoppedBySignal,false);
    same(closure.sql,{visible:true,system:grant.scope.database.systemIdentifier,oid:String(mainIndex.restoredOid),sessions:0,prepared:0});
    actor.closed=true;actor.closure=closure;
    void privateFence('close').then(fence=>send('main','PRIVATE_QUALIFICATION_CLOSED',{qualificationId:mainIndex.privateQualification.qualificationId,
      originalPairClosed:true,actualHttpTargets:2,fence,productionAdmission:false})).catch(hold);
  }
  function privateOldJobsEvent(event,body){
    assert.ok(qualificationState.issued);same(pending,null);
    const grant=mainIndex.privateQualification.oldJobsGrant;
    if(event==='PRIVATE_OLD_JOBS_STARTED'){
      same(qualificationState.oldJobs,null);same(body.scopeSha256,grant.sha256);
      const native=JSON.parse(Buffer.from(body.activeNativeRawBase64,'base64'));
      same(native.phase,'ACTIVE');same(native.guardian,body.birth);same(body.originalPopenPid,body.birth.pid);
      same(native.onlineScope.scope,grant.scope);same(native.onlineScope.sha256,grant.sha256);
      same(grant.scope.image,topology.main.image);same(grant.scope.manifestSha256,mainIndex.privateQualification.runtimeBundles.main);
      assert.ok(hex(body.actorId));qualificationState.oldJobs={...body,kind:'private-old-jobs',closed:false};return;
    }
    const actor=qualificationState.oldJobs;assert.ok(actor&&!actor.closed);same(body.actorId,actor.actorId);
    if(event==='PRIVATE_OLD_JOBS_READY'){
      same(actor.ready,undefined);same(body.result.event,'READY');same(body.result.actorId,actor.actorId);
      same(body.result.scopeSha256,grant.sha256);same(body.result.identity.runtimeId,grant.scope.runtimeId);
      same(body.result.identity.purpose,'jobs');same(body.result.identity.qualificationId,mainIndex.privateQualification.qualificationId);
      same(body.result.identity.runtimeBundleSha256,mainIndex.privateQualification.runtimeBundles.main);
      same(body.result.identity.image,topology.main.image);same(body.result.installedEntrySha256,mainConfiguration.privateQualificationRuntimes.main.entrySha256);
      actor.ready=body.result;return;
    }
    if(event==='PRIVATE_OLD_JOBS_PREPARED'){
      assert.ok(actor.ready);same(actor.controlSequence,1);same(body.result.event,'PREPARED');same(body.result.sequence,1);
      same(body.result.scopeSha256,grant.sha256);qualificationState.oldJobsPrepared=true;return;
    }
    same(event,'PRIVATE_OLD_JOBS_CLOSED');same(actor.controlSequence,2);same(body.result.event,'CLOSED');same(body.result.sequence,2);
    const closure=body.closure,native=JSON.parse(Buffer.from(closure.nativeRawBase64,'base64')),work=JSON.parse(Buffer.from(closure.workRawBase64,'base64'));
    same(closure.originalPopenPid,actor.originalPopenPid);same(closure.originalReturncode,0);same(closure.scopeSha256,grant.sha256);
    same(native.guardian,actor.birth);same(native.activeClaimSha256,sha(Buffer.from(actor.activeNativeRawBase64,'base64')));
    same(native.onlineScope.scope,grant.scope);same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');
    same(native.nativeStatus,0);same(native.nativeReaped,true);same(native.databaseQuiet,true);same(native.stoppedBySignal,false);
    same(closure.sql,{visible:true,system:grant.scope.database.systemIdentifier,oid:String(mainIndex.restoredOid),sessions:0,prepared:0});
    actor.closed=true;actor.closure=closure;
    same(closure.ownershipInterval.runtimeId,grant.scope.runtimeId);same(closure.ownershipInterval.activeClaimSha256,native.activeClaimSha256);
  }
  function started(body){
    assert.ok(pending&&body.requestId===pending.requestId&&body.kind===pending.kind);
    assert.ok(hex(body.actorId)&&!actors.has(body.actorId)&&Number.isSafeInteger(body.originalPopenPid)&&body.originalPopenPid>1);
    same(body.birth.pid,body.originalPopenPid);assert.match(body.birth.startTicks,/^\d+$/);
    assert.match(body.birth.bootId,/^[a-f0-9-]{36}$/);assert.match(body.birth.pidNamespace,/^pid:\[\d+\]$/);
    if(['legacy-private-chrome','legacy-private-browser-verify','private-chrome','full-catalog','private-domain','private-domain-verify','private-browser-verify'].includes(body.kind)){
      same(body.scopeSha256,null);same(body.activeNativeRawBase64,null);
    }else if(body.kind!=='chrome'){
      assert.ok(hex(body.scopeSha256));const raw=Buffer.from(body.activeNativeRawBase64,'base64'),native=JSON.parse(raw);
      assert.equal(native.phase,'ACTIVE');same(native.guardian,body.birth);
      assert.equal(native.onlineScope.sha256,body.scopeSha256);assert.equal(native.onlineScope.scope.image,topology.candidate.image);
      const grant=body.kind==='online-point-inquiry'?mainIndex.onlinePointInquiryGrant:body.kind==='pristine-performance'?mainIndex.pristinePerformanceGrant:body.kind==='migration'?mainIndex.grants.find(value=>value.scope.purpose==='jobs'):
        body.kind==='restored-baseline'?mainIndex.restoredBaselineGrant:body.kind==='private-domain-baseline'?mainIndex.privateQualification.domainRestore.baselineGrant:
        body.kind==='restored-inquiry'?mainIndex.inquiryGrants.restored:
        body.kind==='private-jobs'?mainIndex.privateQualification.jobsGrant:body.kind==='private-http2'?mainIndex.privateQualification.httpGrants[1]:mainIndex.restoredGrant;
      assert.ok(grant);same(body.scopeSha256,grant.sha256);same(native.onlineScope.scope,grant.scope);
      same(grant.scope.manifestSha256,['online-point-inquiry','pristine-performance','private-jobs','private-http2'].includes(body.kind)
        ?mainIndex.privateQualification.runtimeBundles.candidate:fileHashes['application-worker.cjs']);
      pending.activeHash=sha(raw);
      pending.activeObject=native;
    }
    pending.actor=body;actors.set(body.actorId,body);
  }
  function complete(event,body){
    const failed=event==='PHASE_FAILED',completedEvent=failed?body.failedEvent:event;
    assert.ok(pending&&completedEvent===pending.expected&&body.requestId===pending.requestId);
    if(failed)assert.match(body.qualificationError,/^[A-Za-z0-9_:.-]{1,256}$/);
    const actor=pending.actor||actors.get(body.actorId);assert.ok(actor);same(body.actorId,actor.actorId);
    if(completedEvent==='PRISTINE_PERFORMANCE_DONE'&&!failed){
      const value=body.result,grant=mainIndex.pristinePerformanceGrant;
      same(value.format,'sabalan-installed-pristine-performance-result/v1');same(value.runtimeId,grant.scope.runtimeId);
      same(value.scopeSha256,grant.sha256);same(value.runtimeBundleSha256,mainConfiguration.privateQualificationRuntimes.candidate.distTreeSha256);
      same(value.database,{name:mainIndex.database,oid:String(mainIndex.oid),systemIdentifier:grant.scope.database.systemIdentifier});
      same(value.observerDisconnected,true);assert.ok(hex(value.installedApplicationSha256));
      same(value.result.httpStatus,403);same(value.result.exportRowsMinted,0);same(value.result.liveArtifactChanges,0);
      same(value.result.releasePhaseCreated,false);same(value.result.futureEnabledExportsQualified,false);
    }
    if(['PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED','PRIVATE_DOMAIN_DONE','PRIVATE_DOMAIN_RESTORE_VERIFIED','PRIVATE_BROWSER_TICKETS_VERIFIED'].includes(completedEvent)){
      same(actor.kind,completedEvent==='PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED'?'legacy-private-browser-verify':completedEvent==='PRIVATE_DOMAIN_DONE'?'private-domain':completedEvent==='PRIVATE_DOMAIN_RESTORE_VERIFIED'?'private-domain-verify':'private-browser-verify');same(body.closure.originalPopenPid,actor.originalPopenPid);same(body.closure.birth,actor.birth);
      same(body.closure.scopeSha256,null);same(body.closure.nativeRawBase64,null);same(body.closure.workRawBase64,null);
      same(body.closure.sql.visible,true);same(body.closure.sql.sessions,0);same(body.closure.sql.prepared,0);
      same(body.closure.sql.oid,String(completedEvent!=='PRIVATE_DOMAIN_RESTORE_VERIFIED'?mainIndex.restoredOid:mainIndex.privateQualification.domainRestore.databaseOid));same(body.closure.sql.system,mainIndex.privateQualification.httpGrants[1].scope.database.systemIdentifier);
      assert.match(body.closure.namespace,/^sabalan-rt-[a-f0-9]{48}$/);
      assert.ok(Number.isInteger(body.closure.originalReturncode)&&body.closure.originalReturncode>=0);
      if(!failed){
        same(body.closure.originalReturncode,0);same(JSON.parse(Buffer.from(body.closure.outputRawBase64,'base64')),body.result);
        same(body.result.format,'sabalan-installed-domain-original-result/v1');same(body.result.observerDisconnected,true);
        same(body.result.durableStateReadback,true);same(body.result.independentRestoreVerified,completedEvent==='PRIVATE_DOMAIN_RESTORE_VERIFIED');
        if(['PRIVATE_BROWSER_TICKETS_VERIFIED','PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED'].includes(completedEvent)){assert.equal(body.result.browserReceipts.length,2);}
        else{same(body.result.qualification.runtimeId,mainIndex.privateQualification.httpGrants[1].scope.runtimeId);same(body.result.qualification.image,topology.candidate.image);}
      }else same(body.result.originalKnownClosed,true);
    }else if(completedEvent==='FULL_CATALOG_DONE'){
      same(failed,false);same(actor.kind,'full-catalog');
      same(body.closure.originalPopenPid,actor.originalPopenPid);same(body.closure.birth,actor.birth);
      same(body.closure.originalReturncode,0);same(body.closure.scopeSha256,null);
      same(body.closure.nativeRawBase64,null);same(body.closure.workRawBase64,null);
      same(body.closure.namespace,'qa-catalog-'+mainIndex.catalog.operation);
      same(body.closure.sql.visible,true);same(body.closure.sql.sessions,0);same(body.closure.sql.prepared,0);
      same(body.closure.sql.oid,String(mainIndex.oid));
      same(body.result.passResult,true);same(body.result.allObservedOriginalBrowsersClosed,true);
      same(body.result.sourceFilesUnchanged,true);same(body.result.borrowsOriginalNativeIngress,true);
      same(body.result.operation,mainIndex.catalog.operation);same(body.result.cliCode,0);
      same(body.result.catalogApplicationName,body.closure.namespace);
      same(body.result.nativeDatabase.databaseName,mainIndex.database);
      same(body.result.nativeDatabase.databaseOid,String(mainIndex.oid));
      same(body.result.nativeDatabase.systemIdentifier,mainIndex.grants[0].scope.database.systemIdentifier);
      same(body.result.databaseQuietVerifiedByChild,false);
      assert.ok(Array.isArray(body.result.browserLaunches)&&body.result.browserLaunches.length>0);
      for(const browser of body.result.browserLaunches){same(browser.originalCliDescendant,true);
        assert.ok(browser.originalPidfdExitObserved===true||browser.originalExitObserved===true);
        same(String(browser.exitCode),'0');same(String(browser.exitSignal),'null');}
    }else if(completedEvent==='ONLINE_POINT_INQUIRY_READY'){
      same(failed,false);same(actor.kind,'online-point-inquiry');const value=body.result,grant=mainIndex.onlinePointInquiryGrant;
      same(value.format,'sabalan-original-online-point-inquiry-ready/v1');same(value.runtimeId,grant.scope.runtimeId);same(value.scopeSha256,grant.sha256);
      same(value.originalGuardian,actor.birth);same(value.nativeActiveRawBase64,actor.activeNativeRawBase64);
      same(value.sqlite.file,directory+'/inquiry/restored.db');for(const key of ['device','inode'])assert.match(value.sqlite[key],/^[1-9][0-9]*$/);
      same(value.diagnosticSourceBundle,true);same(value.immutableInstalledApplicationQualified,false);same(value.productionAdmission,false);
      originalOnlineInquiry={actorId:actor.actorId,result:structuredClone(value)};
    }else if(completedEvent==='PRIVATE_JOBS_READY'||completedEvent==='PRIVATE_JOBS_PREPARED'){
      same(failed,false);same(actor.kind,'private-jobs');
      same(body.result.scopeSha256,actor.scopeSha256);same(body.result.actorId,actor.actorId);
      same(body.result.event,completedEvent==='PRIVATE_JOBS_READY'?'READY':'PREPARED');
      if(completedEvent==='PRIVATE_JOBS_READY'){
        same(body.result.identity.runtimeId,mainIndex.privateQualification.jobsGrant.scope.runtimeId);
        same(body.result.identity.purpose,'jobs');same(body.result.identity.image,topology.candidate.image);
        same(body.result.identity.qualificationId,mainIndex.privateQualification.qualificationId);
        same(body.result.identity.runtimeBundleSha256,mainIndex.privateQualification.runtimeBundles.candidate);
      }else same(body.result.sequence,1);
      if(completedEvent==='PRIVATE_JOBS_PREPARED')qualificationState.jobsPrepared=true;
    }else if(['PRIVATE_HTTP2_READY','PRIVATE_HTTP2_PREPARED'].includes(completedEvent)){
      same(failed,false);same(actor.kind,'private-http2');
      const grant=mainIndex.privateQualification.httpGrants[1];
      same(body.result.scopeSha256,grant.sha256);same(body.result.actorId,actor.actorId);
      same(body.result.event,completedEvent==='PRIVATE_HTTP2_READY'?'READY':'PREPARED');
      if(completedEvent==='PRIVATE_HTTP2_READY'){
        same(body.result.identity.runtimeId,grant.scope.runtimeId);same(body.result.identity.purpose,'http');
        same(body.result.identity.image,topology.candidate.image);same(body.result.identity.runtimeBundleSha256,mainIndex.privateQualification.runtimeBundles.candidate);
        same(body.result.installedEntrySha256,mainConfiguration.privateQualificationRuntimes.candidate.entrySha256);
      }else{same(body.result.sequence,1);qualificationState.http2Prepared=true;}
    }else if(['PRIVATE_LEGACY_CHROME_READY','CHROME_READY','PRIVATE_CHROME_READY'].includes(completedEvent)){
      assert.equal(failed,false);
      same(body.originalChromePid,actor.originalPopenPid);same(body.birth,actor.birth);
      same(body.host,topology.candidate.host);same(body.browserOrigin,'http://localhost:3199');
      same(body.profile,directory+'/candidate-original-controller/'+(completedEvent==='CHROME_READY'?'chrome':completedEvent==='PRIVATE_LEGACY_CHROME_READY'?'legacy-private-chrome':'private-chrome')+'/profile');assert.ok(hex(body.controllerId));
      assert.ok(body.ingress&&body.ingress.targetHost===topology.main.host&&body.ingress.host==='127.0.0.1'
        &&body.ingress.port===3199&&body.ingress.targetPort===3199&&body.ingress.originalIngressPid===body.ingress.birth.pid);
      const endpoint=new URL(body.browserWSEndpoint);same(endpoint.protocol,'ws:');same(endpoint.hostname,topology.candidate.host);
      assert.match(endpoint.pathname,/^\/[a-f0-9]{64}\/devtools\/browser\/[a-f0-9-]{36}$/);
      assert.ok(body.proxy&&body.proxy.originalProxyPid===body.proxy.birth.pid&&hex(body.proxy.configSha256));
      same(body.proxy.endpoint,body.browserWSEndpoint);
    }else if(['PRIVATE_LEGACY_CHROME_CLOSED','CHROME_CLOSED','PRIVATE_CHROME_CLOSED'].includes(completedEvent)){
      assert.equal(failed,false);
      same(body.closure.originalPopenPid,actor.originalPopenPid);same(body.closure.originalReturncode,0);
    }else if(completedEvent!=='RESTORED_HTTP_READY'||failed){
      const closure=body.closure;same(closure.originalPopenPid,actor.originalPopenPid);
      if(!failed)same(closure.originalReturncode,['online-point-inquiry','restored-inquiry'].includes(actor.kind)?128:0);
      assert.ok(Number.isInteger(closure.originalReturncode)&&closure.originalReturncode>=0&&closure.originalReturncode<=255);
      same(closure.scopeSha256,actor.scopeSha256);
      const raw=Buffer.from(closure.nativeRawBase64,'base64'),native=JSON.parse(raw),work=JSON.parse(Buffer.from(closure.workRawBase64,'base64'));
      same(native.guardian,actor.birth);same(native.activeClaimSha256,pending.activeHash||sha(Buffer.from(actor.activeNativeRawBase64,'base64')));
      const active=Object.fromEntries(Object.entries(native).filter(([key])=>!['activeClaimSha256','nativeReaped','databaseQuiet',
        'sqliteNativeClosed','nativeStatus','stoppedBySignal'].includes(key)));active.phase='ACTIVE';
      same(active,pending.activeObject||JSON.parse(Buffer.from(actor.activeNativeRawBase64,'base64')));
      same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');same(native.nativeReaped,true);
      if(['online-point-inquiry','restored-inquiry'].includes(actor.kind)){
        const stopped=actor.kind==='online-point-inquiry'?body.result.result:body.result;
        if(actor.kind==='online-point-inquiry'){same(body.result.format,'sabalan-original-online-point-inquiry-closed/v1');same(body.result.diagnosticSourceBundle,true);same(body.result.immutableInstalledApplicationQualified,false);same(body.result.productionAdmission,false);}
        same(native.sqliteNativeClosed,true);same(native.nativeStatus,143);same(stopped.requestedSigterm,true);
        same(stopped.activeClaimSha256,native.activeClaimSha256);same(stopped.nativeSha256,sha(raw));
      }else{same(native.databaseQuiet,true);same(native.nativeStatus,closure.originalReturncode);}
      same(native.stoppedBySignal,['online-point-inquiry','restored-inquiry'].includes(actor.kind));
      same(closure.sql.visible,true);same(closure.sql.sessions,0);same(closure.sql.prepared,0);
    }
    if(!['ONLINE_POINT_INQUIRY_READY','PRIVATE_LEGACY_CHROME_READY','PRIVATE_CHROME_READY','CHROME_READY','RESTORED_HTTP_READY','PRIVATE_JOBS_READY','PRIVATE_JOBS_PREPARED','PRIVATE_HTTP2_READY','PRIVATE_HTTP2_PREPARED'].includes(completedEvent))actor.closed=true;
    const cleanup=pending.failureCleanup;
    if(cleanup){same(completedEvent,'CHROME_CLOSED');assert.ok([...actors.values()].every(value=>value.closed));
      roles.get('main').cleanupClosed=body;}
    if(pending.kind==='migration')migrationTerminal={event,body};
    if(!failed)completedPhases.set(completedEvent,body);
    const mainFailed=roles.get('main').awaitingCandidateClosure;
    if(mainFailed){same(pending.kind,'migration');assert.ok(actor.closed);}
    else send('main',event,body);
    pending=null;phase=mainFailed?'MAIN_AND_PHASE_FAILED_CLOSED':cleanup?'CAPTURE_ABORT_CLOSED':failed?'PHASE_FAILED':event;
    if(mainFailed)failedCandidateReadyResolve(true);
  }
  function event(role,value){
    same(Object.keys(value).sort(),['format','session','role','sequence','event','payload'].sort());
    const owner=roles.get(role);same(value.format,FORMAT);same(value.session,session);same(value.role,role);same(value.sequence,++owner.received);
    assert.equal(typeof value.payload,'string');const raw=Buffer.from(value.payload,'base64');assert.ok(raw.length<=MAX);
    const body=JSON.parse(raw);
    record('receive',role,value.sequence,value.event,body,raw);
    if(value.event==='HELLO'){assert.equal(owner.hello,false);owner.hello=true;owner.readyResolve(body);return;}
    if(value.event==='HELD'){
      const reason=typeof body.reason==='string'&&/^[A-Za-z_][A-Za-z0-9_]*:[A-Za-z0-9_-]{1,192}$/.test(body.reason)?body.reason:null;
      const error=Error('ORIGINAL_INNER_CONTROLLER_HELD');
      error.innerHeld=Object.freeze({role,sequence:value.sequence,event:value.event,reason,
        payloadSha256:sha(raw),payloadBytes:raw.length,reasonRedacted:reason===null});
      throw error;
    }
    if(role==='main'){
      if(['PRIVATE_OLD_JOBS_STARTED','PRIVATE_OLD_JOBS_READY','PRIVATE_OLD_JOBS_PREPARED','PRIVATE_OLD_JOBS_CLOSED'].includes(value.event)){privateOldJobsEvent(value.event,body);return;}
      if(['PRIVATE_HTTP_STARTED','PRIVATE_HTTP_READY','PRIVATE_HTTP_PREPARED','PRIVATE_HTTP_CLOSED'].includes(value.event)){
        privateHttpEvent(value.event,body);return;
      }
      if(value.event==='MAIN_FAILED_CLOSED'){
        if(body.failureKind==='PRIVATE_PAIR_FAILED_CLOSED'){
          same(pending,null);same(body.originalPass,false);same(body.productionAdmission,false);
          assert.ok(qualificationState.http?.closed&&qualificationState.fence?.phase==='CLOSED');
          assert.ok([...actors.values()].every(actor=>actor.closed));
          assert.ok(originalProofObservers.every(observer=>observer.closed&&observer.code===0&&observer.signal===null));
          same(body.originalChromeClosed,true);assert.ok(body.edgeClosure);same(body.edgeClosure.originalReturncode,0);
          same(body.owners.length,2);
          for(const grant of mainIndex.grants.filter(grant=>grant.scope.purpose==='http')){
            const values=body.owners.filter(entry=>entry.runtimeId===grant.scope.runtimeId);same(values.length,1);
            validateOriginalMainHttpOwner(values[0],grant,mainIndex,0);
          }
          owner.failedClosed=body;phase='PRIVATE_PAIR_FAILED_CLOSED';return;
        }
        if(body.failureKind==='HTTP_CLOSED_AWAITING_ORIGINAL_CANDIDATE'){
          same(mainRequests,1);assert.ok(firstMigrationRequest);
          validateMainAwaitingMigrationClosure(body,{phase,request:firstMigrationRequest,index:mainIndex});
          assert.ok(actors.size<=1&&[...actors.values()].every(actor=>actor.kind==='migration'));
          owner.failedClosed=body;owner.awaitingCandidateClosure=true;
          if(pending){same(pending.requestId,firstMigrationRequest.requestId);same(pending.kind,'migration');}
          else{assert.ok(migrationTerminal);assert.ok([...actors.values()].every(actor=>actor.closed));phase='MAIN_AND_PHASE_FAILED_CLOSED';failedCandidateReadyResolve(true);}
          return;
        }
        if(body.failureKind==='EARLY_HTTP_STARTUP_CLOSED'){
          validateEarlyMainFailedClosure(body,{phase,pending,candidateActorCount:actors.size,index:mainIndex});
          owner.failedClosed=body;phase='EARLY_MAIN_FAILED_CLOSED';return;
        }
        assert.ok(['PHASE_FAILED','CAPTURE_ABORT_CLOSED'].includes(phase));same(body.productionAdmission,false);same(body.originalPass,false);
        if(phase==='PHASE_FAILED')same(body.edgeNeverCreated,true);
        else{assert.ok(owner.cleanupClosed);assert.ok(body.edgeClosure&&Number.isSafeInteger(body.edgeClosure.originalPopenPid));
          assert.ok([0,1].includes(body.edgeClosure.originalReturncode));same(body.originalChromeClosed,true);}
        assert.ok(Array.isArray(body.owners)&&body.owners.length>0&&body.owners.length<=2);
        for(const entry of body.owners){
          const native=JSON.parse(Buffer.from(entry.nativeRawBase64,'base64')),work=JSON.parse(Buffer.from(entry.workRawBase64,'base64'));
          const grant=mainIndex.grants.find(item=>item.scope.runtimeId===native.onlineScope.scope.runtimeId);
          assert.ok(grant&&grant.scope.purpose==='http');same(native.onlineScope.scope,grant.scope);same(native.onlineScope.sha256,grant.sha256);
          same(entry.originalReturncode,0);same(entry.originalPopenPid,native.guardian.pid);same(native.nativeStatus,0);
          same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');same(native.nativeReaped,true);same(native.databaseQuiet,true);same(native.stoppedBySignal,false);
        }
        owner.failedClosed=body;return;
      }
      same(value.event,'REQUEST');assert.equal(pending,null);
      assert.equal(owner.failedClosed,undefined);assert.ok(hex(body.requestId));
      if(body.command==='ISSUE_PRIVATE_QUALIFICATION'){
        pending={requestId:body.requestId,expected:'PRIVATE_QUALIFICATION_ISSUED',kind:'private-qualification-issuer'};
        void issueOriginalQualification(body).catch(hold);return;
      }
      if(['ROTATE_PRIVATE_LEGACY_UI','RESTORE_PRIVATE_RETAINED_UI'].includes(body.command)){
        same(body.input,{});assertLegacyReady();
        if(body.command==='ROTATE_PRIVATE_LEGACY_UI'){
          assert.ok(!legacyCarrier&&completedPhases.has('PRIVATE_CHROME_CLOSED'));
          void beginOriginalPrivateLegacyUiCarrier(originalController,frontendSnapshot).then(token=>{legacyCarrier=token;send('main','PRIVATE_LEGACY_UI_ROTATED',{requestId:body.requestId,root:directory,roundId:legacyRoundId,carrier:readOriginalPrivateLegacyUiCarrier(token)});}).catch(hold);
        }else{
          assert.ok(legacyCarrier&&!legacyRestoration);
          void restoreOriginalPrivateLegacyUiCarrier(originalController,legacyCarrier).then(token=>{legacyRestoration=token;send('main','PRIVATE_LEGACY_UI_RESTORED',{requestId:body.requestId,root:directory,roundId:legacyRoundId,restoration:readOriginalPrivateLegacyUiRestoration(token)});}).catch(hold);
        }return;
      }
      if(body.command==='RUN_ORIGINAL_ONLINE_CHECKPOINT'){
        same(body.input,{});assertLegacyReady();assert.ok(independentOptions&&nativeOwnerElfReceipt&&legacyRestoration&&originalOnlineInquiry&&!localOnlineOwner);
        assert.ok(completedPhases.has('PRIVATE_LEGACY_BROWSER_TICKETS_VERIFIED'));
        pending={requestId:body.requestId,expected:'ORIGINAL_ONLINE_CHECKPOINT_DONE',kind:'local-online-checkpoint'};
        void (async()=>{
          if(!localCrypto)localCrypto=await createOriginalLocalCheckpointCrypto({localDevSuspension,directory,topology,scratch:'D:/sabalanerp-online-qa/original-crypto-'+randomBytes(16).toString('hex')});
          const capturePlan=originalController.prepareOriginalLocalOnlineCapturePlan();
          localOnlineOwner=await createOriginalLocalOnlineCheckpoint({capturePlan,coordinator:originalController,cryptoExecutor:localCrypto,independentOptions,nativeOwnerElfReceipt});
          const point=await localOnlineOwner.point();await localOnlineOwner.tick();localOnlineCompletion=await localOnlineOwner.finishPointOnlyQualification();
          const completion=readOriginalLocalOnlineCheckpointCompletion(localOnlineCompletion),raw=Buffer.from(JSON.stringify(completion));
          const result={format:completion.format,operation:completion.operation,productionAdmission:false,continuousWalQualified:false,finalIntervalCompletion:false,
            originalControllers:completion.originalControllers,completionSha256:sha(raw),independentReportSha256:point.independent.ownedOutputs.report.sha256,
            captureId:point.point.producer.captureId,originalPointOnlyClosed:true};
          same(pending.requestId,body.requestId);pending=null;phase='ORIGINAL_ONLINE_CHECKPOINT_DONE';
          send('main','ORIGINAL_ONLINE_CHECKPOINT_DONE',{requestId:body.requestId,result});
        })().catch(hold);return;
      }
      if(['SEAL_LOCAL_CHECKPOINT_COMPONENTS','SEAL_LOCAL_WAL_WINDOW'].includes(body.command)){
        assert.ok(legacyRestoration&&!held,'ORIGINAL_POST_UI_CRYPTO_CONTEXT_REQUIRED');
        void (async()=>{
          if(!localCrypto)localCrypto=await createOriginalLocalCheckpointCrypto({localDevSuspension,directory,topology,scratch:'D:/sabalanerp-online-qa/original-crypto-'+randomBytes(16).toString('hex')});
          const point=body.command==='SEAL_LOCAL_CHECKPOINT_COMPONENTS';
          same(Object.keys(body.input).sort(),point?['componentManifestFile','componentManifestSha256']:['captureSha256','configurationSha256','root']);
          const token=await (point?localCrypto.seal(body.input):localCrypto.sealWal(body.input));localCryptoCompletions.push(token);
          const value=await readOriginalLocalCheckpointCryptoCompletion(token),raw=fs.readFileSync(value.receiptFile);
          assert.ok(raw.length>0&&raw.length<=262144);same(sha(raw),value.receiptSha256);
          send('main',point?'LOCAL_CHECKPOINT_COMPONENTS_SEALED':'LOCAL_WAL_WINDOW_SEALED',{requestId:body.requestId,runtimeReceipt:value.runtimeReceipt,receiptRawBase64:raw.toString('base64'),receiptSha256:value.receiptSha256});
        })().catch(hold);return;
      }
      if(['PREPARE_PRIVATE_HTTP','FINISH_PRIVATE_HTTP','PREPARE_PRIVATE_OLD_JOBS','FINISH_PRIVATE_OLD_JOBS'].includes(body.command)){
        const oldJobs=body.command.includes('OLD_JOBS'),actor=oldJobs?qualificationState.oldJobs:qualificationState.http;assert.ok(actor?.ready&&!actor.closed);
        same(Object.keys(body.input).sort(),['actorId']);same(body.input.actorId,actor.actorId);
        if(body.command==='FINISH_PRIVATE_HTTP')assert.ok([...actors.values()].some(a=>a.kind==='private-jobs'&&a.closed));
        const preparing=body.command.startsWith('PREPARE_'),wire=privateControlWire(actor,preparing?'PRIVATE_PREPARE_DRAIN':'PRIVATE_SHUTDOWN');
        send('main',oldJobs?(preparing?'PRIVATE_OLD_JOBS_PREPARE_AUTHORIZED':'PRIVATE_OLD_JOBS_FINISH_AUTHORIZED'):(preparing?'PRIVATE_HTTP_PREPARE_AUTHORIZED':'PRIVATE_HTTP_FINISH_AUTHORIZED'),
          {requestId:body.requestId,actorId:actor.actorId,wire});return;
      }
      assert.ok(transitions[body.command]);
      assert.equal(owner.failedClosed,undefined);mainRequests++;
      assert.ok(hex(body.requestId));const [expected,kind]=transitions[body.command];
      pending={requestId:body.requestId,expected,kind,actor:body.actorId?actors.get(body.actorId):null};
      if(kind==='pristine-performance'){same(body.input&&Object.keys(body.input),['seedSha256']);assert.ok(hex(body.input.seedSha256));same(completedPhases.size,0);same(actors.size,0);}
      if(kind==='migration'){
        assert.ok(completedPhases.has('PRISTINE_PERFORMANCE_DONE'),'ORIGINAL_PRISTINE_PROFILE_REQUIRED_BEFORE_MIGRATION');
        same(firstMigrationRequest,null);firstMigrationRequest={requestId:body.requestId,expected,kind,ordinal:mainRequests};
      }
      if(body.input?.purpose==='FAILED_CAPTURE_CLEANUP'){
        same(body.command,'WAIT_CHROME_CLOSED');pending.failureCleanup=true;
      }
      if(['WAIT_PRIVATE_LEGACY_CHROME_CLOSED','WAIT_PRIVATE_CHROME_CLOSED','FINISH_RESTORED_HTTP','WAIT_CHROME_CLOSED','PREPARE_PRIVATE_JOBS','FINISH_PRIVATE_JOBS','PREPARE_PRIVATE_HTTP2','FINISH_PRIVATE_HTTP2'].includes(body.command))assert.ok(pending.actor);
      if(body.command==='START_PRIVATE_CHROME'){same(body.input,{});assert.ok(completedPhases.has('PRIVATE_JOBS_DONE')&&completedPhases.has('PRIVATE_DOMAIN_DONE'));}
      if(body.command==='RUN_PRIVATE_DOMAIN_CASES'){
        same(body.input,{});assert.ok(qualificationState.http?.ready&&qualificationState.oldJobs?.closed);
        assert.ok([...actors.values()].some(actor=>actor.kind==='private-http2'&&!actor.closed));
        assert.ok([...actors.values()].some(actor=>actor.kind==='private-jobs'&&!actor.closed));
      }
      if(body.command==='START_PRIVATE_JOBS')assert.ok(qualificationState.http?.ready&&qualificationState.issued&&qualificationState.oldJobs?.closed);
      if(['PREPARE_PRIVATE_JOBS','FINISH_PRIVATE_JOBS','PREPARE_PRIVATE_HTTP2','FINISH_PRIVATE_HTTP2'].includes(body.command)){
        same(Object.keys(body.input).sort(),['actorId']);same(body.input.actorId,pending.actor.actorId);
        const actor=pending.actor;
        if(body.command==='FINISH_PRIVATE_HTTP2'){
          void privateFence('fence').then(()=>send('candidate',body.command,{requestId:body.requestId,
            input:{actorId:actor.actorId,wire:privateControlWire(actor,'PRIVATE_SHUTDOWN')}})).catch(hold);return;
        }
        send('candidate',body.command,{requestId:body.requestId,
          input:{actorId:actor.actorId,wire:privateControlWire(actor,['FINISH_PRIVATE_HTTP2','FINISH_PRIVATE_JOBS'].includes(body.command)?'PRIVATE_SHUTDOWN':'PRIVATE_PREPARE_DRAIN')}});return;
      }
      send('candidate',body.command,{requestId:body.requestId,input:body.input});return;
    }
    if(value.event==='ACTOR_STARTED')started(body);else if(value.event==='CLOSED'){
      assert.equal(pending,null);same(body.requestId,owner.closeRequested);same(body.allOriginalChildrenClosed,true);
      same(body.productionAdmission,false);same(body.qualificationSucceeded,owner.closeMode==='QUALIFIED');
      same(body.createdActorCount,actors.size);assert.ok(Number.isSafeInteger(body.observerCount)&&body.observerCount>=0&&body.observerCount<=4096);
      assert.ok(hex(body.controllerId));owner.closedReceipt=body;
    }else if(value.event==='PHASE_REFUSED'){
      assert.ok(pending&&!pending.actor);same(body.requestId,pending.requestId);same(body.failedEvent,pending.expected);
      same(body.kind,pending.kind);same(body.actorId,null);same(body.noWorkStarted,true);same(body.decision,'NATIVE_ACTOR_NOT_STARTED');
      assert.ok(![...actors.values()].some(actor=>actor.kind===pending.kind));
      same(body.resources.memoryMaximum,expectedQaCandidateMemory(qaMemoryProfile));assert.ok(Number.isSafeInteger(body.resources.memoryCurrent));
      assert.ok(body.resources.memoryCurrent>=0&&body.resources.memoryCurrent<=body.resources.memoryMaximum);
      same(body.resources.memoryAvailable,body.resources.memoryMaximum-body.resources.memoryCurrent);
      same(body.requiredBytes,requiredMemory[pending.kind]);assert.ok(body.resources.memoryAvailable<body.requiredBytes);
      if(!['legacy-private-chrome','legacy-private-browser-verify','private-chrome','chrome','full-catalog','private-domain','private-domain-verify','private-browser-verify'].includes(pending.kind)){
        const grant=pending.kind==='online-point-inquiry'?mainIndex.onlinePointInquiryGrant:pending.kind==='pristine-performance'?mainIndex.pristinePerformanceGrant:pending.kind==='migration'?mainIndex.grants.find(value=>value.scope.purpose==='jobs'):
          pending.kind==='restored-baseline'?mainIndex.restoredBaselineGrant:pending.kind==='private-domain-baseline'?mainIndex.privateQualification.domainRestore.baselineGrant:
          pending.kind==='restored-inquiry'?mainIndex.inquiryGrants.restored:
          pending.kind==='private-jobs'?mainIndex.privateQualification.jobsGrant:pending.kind==='private-http2'?mainIndex.privateQualification.httpGrants[1]:mainIndex.restoredGrant;
        same(body.scopeSha256,grant.sha256);same(body.nativeFileAbsent,true);same(body.claimFileAbsent,true);
      }else same(body.scopeSha256,null);
      // Capacity facts contain no session/content/key material and remain
      // diagnostic negatives. Preserve them after original owners close.
      phaseRefusals.push({requestId:body.requestId,kind:body.kind,scopeSha256:body.scopeSha256,
        requiredBytes:body.requiredBytes,resources:body.resources,noWorkStarted:true});
      if(pending.kind==='migration')migrationTerminal={event:'PHASE_REFUSED',body};
      if(!roles.get('main').awaitingCandidateClosure)send('main','PHASE_REFUSED',body);
      pending=null;phase=roles.get('main').awaitingCandidateClosure?'MAIN_AND_PHASE_FAILED_CLOSED':'PHASE_FAILED';
      if(phase==='MAIN_AND_PHASE_FAILED_CLOSED')failedCandidateReadyResolve(true);
    }else complete(value.event,body);
  }
  function launch(role){
    assert.equal(held,null);assert.ok(!roles.has(role));
    const rows=execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--format','json'],{encoding:'utf8'});
    assert.ok(rows.includes('sabalanerp-local'));
    const [actual]=JSON.parse(execFileSync('docker',['inspect',topology[role].containerId],{encoding:'utf8'}));
    same(actual.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
    same(actual.Config.Labels['com.docker.compose.service'],role==='main'?'backend-retained':'backend-candidate');
    same(actual.Id,topology[role].containerId);same(actual.Image,topology[role].image);
    same(actual.NetworkSettings.Networks['sabalanerp-local_default'].IPAddress,topology[role].host);
    same(actual.State.Running,true);same(actual.State.Health.Status,'healthy');
    const filename=role==='main'?'fixture.py':'application-native-candidate-controller.py';
    assert.ok(hex(fileHashes[filename]));
    const bootstrap="import hashlib,runpy,sys; p=sys.argv[1]; expected=sys.argv[2]; assert hashlib.sha256(open(p,'rb').read()).hexdigest()==expected; sys.argv=[p]+sys.argv[3:]; runpy.run_path(p,run_name='__main__')";
    const args=['exec','-i',topology[role].containerId,'/usr/bin/python3','-I','-B','-c',bootstrap,
      directory+'/'+filename,fileHashes[filename],directory,...(role==='main'?['exercise']:[]),publicSPKI,session];
    const child=spawn('docker',args,{stdio:['pipe','pipe','pipe']});
    let readyResolve,closedResolve;const ready=new Promise(resolve=>{readyResolve=resolve;});
    const closed=new Promise(resolve=>{closedResolve=resolve;});
    const owner={child,sent:0,received:0,hello:false,readyResolve,ready,closed:false,stdout:'',stderr:'',buffer:Buffer.alloc(0)};
    roles.set(role,owner);
    child.stdout.on('data',bytes=>{try{
      owner.buffer=Buffer.concat([owner.buffer,bytes]);assert.ok(owner.buffer.length<=FRAME);
      let offset;while((offset=owner.buffer.indexOf(10))!==-1){const line=owner.buffer.subarray(0,offset).toString('utf8');owner.buffer=owner.buffer.subarray(offset+1);
        if(line.startsWith(PREFIX))event(role,JSON.parse(line.slice(PREFIX.length)));
        else{owner.stdout+=line+'\n';assert.ok(Buffer.byteLength(owner.stdout)<=MAX);}}
    }catch(error){hold(error);}});
    child.stderr.on('data',bytes=>{owner.stderr+=bytes.toString('utf8');if(Buffer.byteLength(owner.stderr)>MAX)hold(Error('ORIGINAL_CONTROLLER_STDERR_BOUND'));});
    child.stdin.on('error',hold);child.on('error',hold);child.on('close',(code,signal)=>{owner.closed=true;owner.result={code,signal,stdout:owner.stdout,stderr:owner.stderr};
      const knownMainWaiting=role==='main'&&owner.awaitingCandidateClosure&&pending?.kind==='migration';
      if(signal||(code!==0&&!(role==='main'&&code===1&&owner.failedClosed))||(pending&&!knownMainWaiting)||owner.buffer.length||(role==='candidate'&&(!owner.closeRequested||!owner.closedReceipt)))
        hold(Error('ORIGINAL_CONTROLLER_CLOSED_UNQUALIFIED'));closedResolve(owner.result);});
    return Object.freeze({ready,closed,pid:child.pid});
  }
  originalController=Object.freeze({enrollment,launch,
    prepareOriginalLocalOnlineCapturePlan:()=>{
      assertLegacyReady();assert.ok(qualificationState.issued&&completedPhases.has('PRIVATE_JOBS_DONE')&&legacyRestoration);
      assert.ok([...actors.values()].filter(actor=>actor.kind==='private-jobs').every(actor=>actor.closed));
      const grant=mainIndex.privateQualification.onlinePointCaptureGrant;assert.ok(grant&&grant.scope.purpose==='capture');
      same(grant.scope.database,{name:mainIndex.restoredDatabase,systemIdentifier:mainIndex.privateQualification.httpGrants[1].scope.database.systemIdentifier});
      same(grant.scope.image,topology.candidate.image);same(grant.scope.manifestSha256,mainConfiguration.privateQualificationRuntimes.candidate.distTreeSha256);
      const facts=qualificationState.issued.facts,token=Object.freeze({});
      assert.ok(originalOnlineInquiry&&!actors.get(originalOnlineInquiry.actorId)?.closed);const inquiry=originalOnlineInquiry.result;
      const birth=originalServiceIdentities['backend-candidate'];assert.ok(birth?.startedAt);same(birth.id,topology.candidate.containerId);same(birth.image,topology.candidate.image);
      const suspensionScope=assertLocalDevSuspensionCurrent(localDevSuspension);const plan={...(localDevSuspension?{localDevSuspension,localDevCaptureScope:localDevCaptureScope(suspensionScope,{runtimeId:grant.scope.runtimeId,scopeSha256:grant.sha256})}:{}),format:'sabalan-original-local-online-capture-plan/v1',database:{...grant.scope.database,oid:String(mainIndex.restoredOid)},
        backend:{...structuredClone(topology.candidate),startedAt:birth.startedAt},grant:structuredClone(grant),qualificationRoot:mainIndex.privateQualification.qualificationRoot,
        roots:structuredClone(facts.roots),ephemeralRoots:structuredClone(facts.ephemeralRoots),originalServiceIdentities:{...structuredClone(originalServiceIdentities),'frontend-retained':structuredClone(readOriginalPrivateLegacyUiRestoration(legacyRestoration).restored)},
        inquiry:{path:inquiry.sqlite.file,device:inquiry.sqlite.device,inode:inquiry.sqlite.inode},inquiryRuntimeIds:[inquiry.runtimeId],
        inquiryGrant:structuredClone(mainIndex.onlinePointInquiryGrant),inquiryNativeActiveRawBase64:inquiry.nativeActiveRawBase64,
        sourceRuntimeId:mainIndex.privateQualification.httpGrants[1].scope.runtimeId,sourceControllerPid:roles.get('main').child.pid};
      originalOnlineCapturePlans.set(token,{plan,assertLive:()=>{assertLegacyReady();assert.ok(!held&&roles.get('main')&&!roles.get('main').closed);}});return token;
    },
    readOriginalPrivateLegacyUiTarget:()=>{assertLegacyReady();assert.ok(originalServiceIdentities);return Object.freeze({...(localDevSuspension?{localDevSuspension}:{}),root:path.resolve(import.meta.dirname,'../..'),project:'sabalanerp-local',composeFile:'D:/sabalanerp/docker-compose.local.yml',browserOverlayFile:path.resolve(import.meta.dirname,'../../docker-compose.application-browser-acceptance.yml'),originalRetained:structuredClone(originalServiceIdentities['frontend-retained']),originalCurrent:structuredClone(originalServiceIdentities['frontend-candidate']),roundId:legacyRoundId});},
    executeOriginalPrivateLegacyUiDockerCommand:async token=>{const value=consumeOriginalPrivateLegacyUiCommand(originalController,token);return legacyDocker(value.args,value.input,value.maximum);},
    assertOriginalPrivateLegacyBrowserClosed:()=>{const legacyActors=[...actors.values()].filter(row=>row.kind==='legacy-private-chrome');assert.ok(completedPhases.has('PRIVATE_LEGACY_CHROME_CLOSED')||(legacyActors.length===0&&phaseRefusals.some(row=>row.kind==='legacy-private-chrome'&&row.noWorkStarted)));assert.ok(legacyDockerChildren.every(row=>row.closed&&!row.unknown&&row.code===0&&row.signal===null));},
    readOriginalPrivateLegacyRestoration:()=>{if(!legacyRestoration)return null;const value=readOriginalPrivateLegacyUiRestoration(legacyRestoration);return Object.freeze({...value.receipt,receiptFile:value.receiptFile,receiptSha256:value.receiptSha256});},
    finishOriginalQualification:()=>{
      same(held,null);same(pending,null);same(roles.size,2);
      assert.ok(!localCrypto||localCryptoClosed,'ORIGINAL_CRYPTO_COMMANDS_NOT_CLOSED');
      assert.ok(localOnlineCompletion,'ORIGINAL_LOCAL_ONLINE_POINT_COMPLETION_REQUIRED');
      assert.ok(legacyRestoration&&legacyDockerChildren.every(row=>row.closed&&!row.unknown&&row.code===0&&row.signal===null),'ORIGINAL_LEGACY_UI_RESTORATION_REQUIRED');
      for(const owner of roles.values()){same(owner.closed,true);same(owner.result.code,0);same(owner.result.signal,null);}
      const candidate=roles.get('candidate');same(candidate.closeMode,'QUALIFIED');same(candidate.closedReceipt.qualificationSucceeded,true);
      assert.ok(originalProofObservers.every(observer=>observer.closed&&observer.code===0&&observer.signal===null));
      assert.ok([...actors.values()].every(actor=>actor.closed));
      same(qualificationState.http?.closed,true);same(qualificationState.fence?.phase,'CLOSED');
      const closures=new Map();
      function remember(value){if(!value?.nativeRawBase64||!value?.workRawBase64)return;
       const native=JSON.parse(Buffer.from(value.nativeRawBase64,'base64'));
       if(!['http','jobs'].includes(native.onlineScope?.scope?.purpose)||native.nativeStatus!==0||native.stoppedBySignal!==false)return;
       const work=JSON.parse(Buffer.from(value.workRawBase64,'base64'));same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');same(native.nativeReaped,true);
       const row={runtimeId:native.onlineScope.scope.runtimeId,scopeSha256:native.onlineScope.sha256,
        nativeSha256:sha(Buffer.from(value.nativeRawBase64,'base64')),workSha256:sha(Buffer.from(value.workRawBase64,'base64')),
        activeClaimSha256:native.activeClaimSha256,guardian:native.guardian};
       const old=closures.get(row.runtimeId);if(old)same(old,row);closures.set(row.runtimeId,row);
      }
      for(const value of Object.values(qualificationState.issued.facts.sourceNative))remember(value);
      for(const body of completedPhases.values())remember(body.closure);
      remember(qualificationState.http.closure);remember(qualificationState.oldJobs?.closure);
      assert.ok(closures.size>=4);
      const resultRaw=Buffer.from(roles.get('main').result.stdout),result=JSON.parse(resultRaw);
      same(result.format,'sabalan-application-native/v1');same(result.passResult,true);same(result.productionAdmission,false);
      same(result.originalDatabaseRetiredWithoutForce,true);same(result.genuinePrivateQualificationPair.originalPairClosed,true);
      same(result.genuinePrivateQualificationPair.actualHttpTargets,2);
      same(result.genuinePrivateQualificationPair.originalHttpClosures.length,2);
      assert.ok(retainedBrowserCompletion,'ORIGINAL_RETAINED_BROWSER_COMPLETION_REQUIRED');
      const retainedFinal=readOriginalRetainedBrowserQualificationCompletion(retainedBrowserCompletion);same(retainedFinal.reportSha256,retained.reportSha256);
      const retainedRaw=fs.readFileSync(retainedFinal.reportFile);same(sha(retainedRaw),retainedFinal.reportSha256);
      const outputFiles={
       'original-local-online-point.json':Buffer.from(JSON.stringify(readOriginalLocalOnlineCheckpointCompletion(localOnlineCompletion))),
       'original-retained-browser-result.json':retainedRaw,
       'original-private-legacy-ui-restoration.json':fs.readFileSync(readOriginalPrivateLegacyUiRestoration(legacyRestoration).receiptFile),
       'original-main-result.json':resultRaw,
       ...Object.fromEntries([...completedPhases].map(([name,body])=>['original-phase-'+name.toLowerCase().replaceAll('_','-')+'.json',Buffer.from(JSON.stringify(body))])),
       'original-private-old-jobs-closure.json':Buffer.from(JSON.stringify(qualificationState.oldJobs.closure)),
       'original-private-http-closure.json':Buffer.from(JSON.stringify(qualificationState.http.closure)),
       'original-private-initializer.json':Buffer.from(JSON.stringify(qualificationState.issued.initialized)),
       'original-private-final-fence.json':Buffer.from(JSON.stringify(qualificationState.fence)),
      };
      const ownedOutputs=Object.fromEntries(Object.entries(outputFiles).map(([file,raw])=>[file,{sha256:sha(raw),bytes:raw.length,rawBase64:raw.toString('base64')} ]));
      const token=Object.freeze({});originalQualificationCompletions.set(token,Object.freeze({
       format:'sabalan-original-role-qualification-completion/v1',controllerSourceSha256:sha(fs.readFileSync(new URL(import.meta.url))),
       originalControllers:[...roles].map(([role,owner])=>({role,originalPid:owner.child.pid,code:owner.result.code,signal:owner.result.signal})),
       fileHashes:{...structuredClone(fileHashes),...Object.fromEntries(Object.entries(ownedOutputs).map(([file,value])=>[file,value.sha256]))},ownedOutputs,nativeClosures:[...closures.values()].sort((a,b)=>a.runtimeId.localeCompare(b.runtimeId)),
       historySha256:sha(Buffer.from(JSON.stringify(history))),retainedBrowser:{reportSha256:retainedFinal.reportSha256,actualProductionLegacy55Qualified:retainedFinal.report.actualProductionLegacy55Qualified===true},productionAdmission:false}));originalQualificationPointCompletions.set(token,localOnlineCompletion);return token;
    },
    enrollCandidate:body=>{assert.equal(phase,'NEW');send('candidate','ENROLL',body);phase='ENROLLED';},
    enrollMain:(body,configurationBytes)=>{assert.equal(phase,'ENROLLED');assert.ok(Buffer.isBuffer(configurationBytes));
      same(sha(configurationBytes),fileHashes['config.json']);mainConfiguration=JSON.parse(configurationBytes);
      same(mainConfiguration.originalHostEnrollment.publicKey,publicSPKI);same(mainConfiguration.originalHostEnrollment.session,session);
      same(mainConfiguration.roleTopology,topology);same(mainConfiguration.image,topology.main.image);
      mainIndex=body.index;send('main','ENROLL',body);},
    closeCandidate:()=>{assert.equal(pending,null);const owner=roles.get('candidate');assert.ok(owner&&!owner.closed);
      assert.ok(originalProofObservers.every(observer=>observer.closed&&observer.code===0&&observer.signal===null));
      assert.ok(qualificationState.http?.closed&&qualificationState.fence?.phase==='CLOSED');
      void (async()=>{if(localCrypto){await localCrypto.close();localCryptoClosed=true;}
        owner.closeMode='QUALIFIED';owner.closeRequested=randomBytes(32).toString('hex');send('candidate','CLOSE',{requestId:owner.closeRequested});})().catch(hold);},
    closeKnownFailedCandidate:()=>{assert.equal(held,null);assert.ok(['PHASE_FAILED','CAPTURE_ABORT_CLOSED','EARLY_MAIN_FAILED_CLOSED','MAIN_AND_PHASE_FAILED_CLOSED','PRIVATE_PAIR_FAILED_CLOSED'].includes(phase));
      assert.ok(roles.get('main')?.closed&&roles.get('main').failedClosed);const owner=roles.get('candidate');
      assert.ok(owner&&!owner.closed);owner.closeMode='FAILED_CLOSED';owner.closeRequested=randomBytes(32).toString('hex');send('candidate','CLOSE_CLOSED',{requestId:owner.closeRequested});},
    knownFailureCanClose:()=>held===null&&['PHASE_FAILED','CAPTURE_ABORT_CLOSED','EARLY_MAIN_FAILED_CLOSED','MAIN_AND_PHASE_FAILED_CLOSED','PRIVATE_PAIR_FAILED_CLOSED'].includes(phase)&&!!roles.get('main')?.failedClosed&&roles.get('main').closed,
    waitKnownFailedCandidate:async()=>{
      if(held===null&&roles.get('main')?.failedClosed&&roles.get('main').awaitingCandidateClosure&&pending)
        await failedCandidateReady;
    },
    allControllersClosed:()=>held===null&&legacyDockerChildren.every(row=>row.closed&&!row.unknown)&&roles.size===2&&[...roles.values()].every(owner=>owner.closed)
      &&!!roles.get('candidate').closedReceipt,
    retainOnFailure:async error=>{hold(error);await new Promise(()=>{void heldKeeper;});},
    status:()=>({phase,held:held?.message??null,evidenceFailure,history:[...history],phaseRefusals:[...phaseRefusals],
      pending:pending?{requestId:pending.requestId,kind:pending.kind,expected:pending.expected,actorStarted:Boolean(pending.actor)}:null,
      controllers:[...roles].map(([role,v])=>({role,pid:v.child.pid,closed:v.closed}))})});
  originalPrivateBrowserControllers.add(originalController);return originalController;
}
