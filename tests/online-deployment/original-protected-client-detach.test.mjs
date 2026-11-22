import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES} from '../../deploy/scripts/online-production-gates.mjs';
const require=createRequire(path.resolve('backend/package.json')),ts=require('typescript');
const source=fs.readFileSync(new URL('../../scripts/lib/original-protected-online-ssh.mjs',import.meta.url),'utf8');
const tree=ts.createSourceFile('client.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const functions=['validateClientBinding','validateClientBarrier','trackClientCallback','assertOriginalWalCycleCanAcquire','observeOriginalWalCycleControl','bindOriginalWalWindowCycle','bindOriginalPhysicalPointCycle','assertClientRepliesClosed','assertOriginalFollowingClient','startOriginalProtectedOnlineInstall','waitOriginalProtectedClientCallbacks','finishOriginalProtectedClient','sendOriginalProtectedClientControl','sort'];
const declarations=functions.map(name=>tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name).getText(tree).replace(/^export\s+/,''));
const vars=['bindingKeys','clientControls'].map(name=>tree.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(tree)===name)).getText(tree));
const digest=value=>createHash('sha256').update(value).digest('hex'),hex='a'.repeat(64);
const binding={format:'sabalan-original-client-bound/v1',instanceId:hex,servicePid:12,serviceBirth:'100',serviceBootIdSha256:hex,configurationSha256:hex,launcherPid:13,launcherBirth:'101',clientNonce:'b'.repeat(64)};
const request={deploymentId:'deployment',releaseId:'release123',targetCommit:'c'.repeat(40),checkpoint:{verifiedOriginalFixture:true}};
function barrier(mode='BOOTSTRAP'){return{format:'sabalan-original-client-terminal-barrier/v1',mode,deploymentId:request.deploymentId,releaseId:request.releaseId,servingReleaseId:request.releaseId,targetCommit:request.targetCommit,phase:'COMPLETED',activeKey:null,publicationSha256:hex,generation:1,gateReportSha256:hex,requiredGateNames:[...ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES],checkpointSha256:digest(Buffer.from(JSON.stringify(request.checkpoint))),terminalWal:null,originalController:{pid:14,birth:'102'},originalLauncher:{pid:13,stat:'101'},liveOriginals:[...['http','jobs','inquiry','edge'].map((kind,i)=>({kind,runtimeId:kind==='edge'?null:'d'.repeat(64),releaseId:kind==='edge'?null:request.releaseId,originalPid:15+i,originalBirth:String(103+i),containerId:'e'.repeat(64)})),{kind:'frontend',buildId:'fixture-build',containerId:'f'.repeat(64),image:'sha256:'+hex,startedAt:'2026-10-21T00:00:00Z'}],closedOriginals:[],closedObservers:[],terminalObservation:{format:'sabalan-original-client-terminal-observation/v1',maintenanceAbsent:true,readOnly:true,endpoints:['backend','frontend','inquiry','nginx'].map(name=>({name,status:200,bodySha256:hex}))},releaseAdmissionGranted:false};}
function fixture({serviceReference}={}){
 const child=new EventEmitter();child.pid=300;child.stdout=new PassThrough();child.stderr=new PassThrough();const written=[],spawned=[];
 child.stdin=new Writable({write(raw,encoding,done){written.push(JSON.parse(raw.toString()));done();}});
 const profile={format:'sabalan-fixed-production-original-ssh/v1',host:'94.182.85.254',user:'root',port:22,repositoryRoot:'/opt/sabalanerp',privateKeyPath:'C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519',knownHostsPath:'C:/Users/mahan/.ssh/known_hosts',sshExecutable:'fixture-ssh',sshExecutableSha256:hex,privateKeySha256:hex,knownHostsSha256:hex,hostKeySha256:digest(Buffer.from('key'))};
 const scope={ORIGINAL_ONLINE_PRODUCTION_GATE_NAMES,assert,Buffer,Promise,Set,Object,Number,JSON,createHash,structuredClone,randomBytes:()=>Buffer.alloc(16),process:{platform:'win32'},path,fs:{},spawn:(...args)=>{spawned.push(args);return child;},setInterval:()=>1,clearInterval:()=>{},PROFILE:'fixture-profile',PROFILE_SHA:hex,PREFIX:'SABALAN_ORIGINAL_QUALIFICATION_REQUEST ',fixedFile:file=>Buffer.from(file==='fixture-profile'?JSON.stringify(profile):file===profile.knownHostsPath?'host ssh-ed25519 '+Buffer.from('key').toString('base64'):'bytes'),sha:digest,exact:(value,keys)=>assert.deepEqual(Object.keys(value).sort(),[...keys].sort()),verifyProtectedQualificationRequest:value=>value};
 const api=vm.runInNewContext(`(()=>{const sessions=new WeakMap(),requests=new WeakMap(),walSources=new WeakMap(),terminalSources=new WeakMap(),pointSources=new WeakMap(),metadataSources=new WeakMap(),onlineRequests=new WeakMap();${vars.join(';')};${declarations.join('\n')};return {startOriginalProtectedOnlineInstall,finishOriginalProtectedClient,sendOriginalProtectedClientControl,assertOriginalFollowingClient,trackClientCallback,sessions,requests,onlineRequests,terminalSources};})()`,scope);
 const plan={launcherPath:'/opt/sabalanerp/.deploy-state/online-host-pack-'+'d'.repeat(32)+'/deploy/scripts/online-release-launcher.py',launcherSha256:hex,configurationPath:'/opt/sabalanerp/.deploy-state/online-control-'+'e'.repeat(32)+'/launcher-config.json',configurationSha256:hex};
 const owner=api.startOriginalProtectedOnlineInstall({launchPlan:plan,serviceReference});
 const emit=(prefix,value)=>child.stdout.write(prefix+' '+JSON.stringify(value)+'\n');emit('SABALAN_ORIGINAL_CLIENT_BOUND',binding);
 if(!serviceReference)emit('SABALAN_ORIGINAL_QUALIFICATION_REQUEST',request);
 const state=api.sessions.get(owner.session);state.submitted=!serviceReference;
 const detach=(change=value=>value)=>{const value={...binding,format:'sabalan-original-client-detached/v1',mode:'BOOTSTRAP',barrier:barrier(),launcherCustody:{deployOriginalCode:0,pendingMasterReplies:0,checkpointProducerAbsent:true,continuousOwnerAbsent:true,checkpointContextAbsent:true,launcherPid:13,launcherBirth:'101',configurationSha256:hex}};emit('SABALAN_ORIGINAL_CLIENT_DETACHED',change(value));};
 const close=async(code=0)=>{child.stdout.end();child.stderr.end();await new Promise(done=>setImmediate(done));child.emit('close',code,null);};
 return{api,owner,state,child,written,spawned,detach,close,emit};
}
test('actual factory finish waits original callback and actual native EOF after matching acknowledgment',async()=>{
 const f=fixture();let settle;f.api.trackClientCallback(f.state,()=>new Promise(done=>{settle=done;}),{},'failed');let closed=false;
 const result=f.api.finishOriginalProtectedClient(f.owner.session,{mode:'BOOTSTRAP'}).then(value=>{closed=true;return value;});await new Promise(done=>setImmediate(done));assert.equal(f.written.length,0);settle();await new Promise(done=>setImmediate(done));assert.equal(f.written[0].format,'sabalan-original-client-detach/v1');f.detach();assert.equal(closed,false);await f.close();assert.equal((await result).originalSshPid,300);
});
test('early SSH EOF and nonzero SSH closure never qualify',async()=>{
 for(const mode of ['early','nonzero']){const f=fixture();const pending=f.api.finishOriginalProtectedClient(f.owner.session,{mode:'BOOTSTRAP'});await new Promise(done=>setImmediate(done));if(mode!=='early')f.detach();await f.close(mode==='early'?0:1);await assert.rejects(pending,/DETACH_UNPROVEN/);}
});
test('changed nonce, missing gate, false launcher custody and injected barrier fields refuse detach',async()=>{
 for(const mutate of [v=>{v.clientNonce='f'.repeat(64);},v=>{v.barrier.requiredGateNames.pop();},v=>{v.launcherCustody.checkpointProducerAbsent=false;},v=>{v.barrier.approved=true;},v=>{v.barrier.requiredGateNames[0]='unknown';},v=>{v.barrier.checkpointSha256='f'.repeat(64);},v=>{v.barrier.liveOriginals=v.barrier.liveOriginals.filter(row=>row.kind!=='jobs');},v=>{v.barrier.closedObservers=[{pid:40,code:1,signal:null}];},v=>{v.barrier.terminalObservation.endpoints[0].status=503;},v=>{v.barrier.terminalObservation.maintenanceAbsent=false;}]){const f=fixture();const pending=f.api.finishOriginalProtectedClient(f.owner.session,{mode:'BOOTSTRAP'});await new Promise(done=>setImmediate(done));f.detach(v=>{mutate(v);return v;});await f.close();await assert.rejects(pending,/DETACH_UNPROVEN/);}
});
test('unanswered source reply refuses before detach write; failed callbacks remain negative',async()=>{
 for(const failure of [false,true]){const f=fixture();if(failure)f.api.trackClientCallback(f.state,async()=>{throw Error('test');},{},'failed');else f.state.pendingPoint={replied:false};await assert.rejects(f.api.finishOriginalProtectedClient(f.owner.session,{mode:'BOOTSTRAP'}));assert.equal(f.written.length,0);}
});
test('following factory selects only original service client path and control completes on exact live frame',async()=>{
 const f=fixture({serviceReference:{instanceId:hex,servicePid:12,serviceBirth:'100',configurationSha256:hex}});
 const result=f.api.sendOriginalProtectedClientControl(f.owner.session,{command:'ACQUIRE_NEXT',input:{input:{deploymentId:'next0001',releaseId:'nextrel1',targetCommit:'c'.repeat(40),prebuiltReleasePlan:{file:'/private/plan.json',sha256:hex}}}});await new Promise(done=>setImmediate(done));assert.equal(f.written[0].format,'sabalan-original-client-control/v1');
 f.emit('SABALAN_ORIGINAL_CLIENT_CONTROL_COMPLETED',{sequence:1,command:'ACQUIRE_NEXT',result:{status:'COMPLETED',command:'ACQUIRE_NEXT',releaseAcceptanceGranted:false}});assert.equal((await result).command,'ACQUIRE_NEXT');
 const command=f.spawned[0][1].at(-1),encoded=command.match(/base64\.b64decode\('([^']+)'\)/)[1],bootstrap=Buffer.from(encoded,'base64').toString();assert.match(bootstrap,/--client/);assert.match(bootstrap,/online-owner-service\.py/);assert.doesNotMatch(bootstrap,/execv\([^\n]+p\['launcherPath'\]/);
 await assert.rejects(f.api.sendOriginalProtectedClientControl(f.owner.session,{command:'CLOSE',input:{}}));
});
test('following admission requires the actual live WeakMap owner; publication control preserves typed input authority',async()=>{
 const initial=fixture();assert.throws(()=>initial.api.assertOriginalFollowingClient(initial.owner.session),/FOLLOWING_CLIENT_REQUIRED/);
 const f=fixture({serviceReference:{instanceId:hex,servicePid:12,serviceBirth:'100',configurationSha256:hex}});f.api.assertOriginalFollowingClient(f.owner.session);assert.throws(()=>f.api.assertOriginalFollowingClient({}),/FOLLOWING_CLIENT_REQUIRED/);
 for(const key of ['sequence','command','clientSequence'])await assert.rejects(f.api.sendOriginalProtectedClientControl(f.owner.session,{command:'BUILD_PUBLICATION_REGISTRY',input:{[key]:1}}));
 const pending=f.api.sendOriginalProtectedClientControl(f.owner.session,{command:'BUILD_PUBLICATION_REGISTRY',input:{}});await new Promise(done=>setImmediate(done));assert.throws(()=>f.api.assertOriginalFollowingClient(f.owner.session),/FOLLOWING_CLIENT_REQUIRED/);
 const publicationPlan={registry:{generation:2},expectedPublicationSha256:hex,releaseId:request.releaseId,previousReleaseId:'previous123',rollback:false};f.emit('SABALAN_ORIGINAL_CLIENT_CONTROL_COMPLETED',{sequence:1,command:'BUILD_PUBLICATION_REGISTRY',result:{status:'COMPLETED',command:'BUILD_PUBLICATION_REGISTRY',publicationPlan}});assert.equal((await pending).publicationPlan.registry.generation,2);
 const rollback=f.api.sendOriginalProtectedClientControl(f.owner.session,{command:'PREPARE_RETAINED_ROLLBACK',input:{input:{releaseId:'previous123'}}});await new Promise(done=>setImmediate(done));assert.equal(f.written.at(-1).command,'PREPARE_RETAINED_ROLLBACK');f.emit('SABALAN_ORIGINAL_CLIENT_CONTROL_COMPLETED',{sequence:2,command:'PREPARE_RETAINED_ROLLBACK',result:{status:'COMPLETED',command:'PREPARE_RETAINED_ROLLBACK',rollbackPlan:{releaseId:'previous123',jobsRuntimeIds:['f'.repeat(64)]}}});assert.equal((await rollback).rollbackPlan.jobsRuntimeIds[0],'f'.repeat(64));
 f.state.closed=true;assert.throws(()=>f.api.assertOriginalFollowingClient(f.owner.session),/FOLLOWING_CLIENT_REQUIRED/);
});
import os from 'node:os';
import path from 'node:path';
test('actual native-tool reader admits exactly two hardlinks while private inputs remain single-link',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'original-client-tool-fixture-'));
 try{
  const file=path.join(root,'tool.bin'),link=path.join(root,'tool-link.bin'),raw=Buffer.from('finite harmless native-tool fixture');fs.writeFileSync(file,raw);fs.linkSync(file,link);
  const text=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='fixedFile').getText(tree);
  const read=vm.runInNewContext('('+text+')',{assert,fs,path,process,sha:digest,BigInt});
  assert.equal(read(file,digest(raw),1024,2n).toString(),raw.toString());assert.throws(()=>read(file,digest(raw),1024));fs.linkSync(file,path.join(root,'third-link.bin'));assert.throws(()=>read(file,digest(raw),1024,2n));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

function followingFixture(rollback=false){
 const f=fixture({serviceReference:{instanceId:hex,servicePid:12,serviceBirth:'100',configurationSha256:hex}}),online={},terminal={};
 assert.equal(f.state.submitted,false);f.api.onlineRequests.set(online,{session:f.state,body:{...request,generation:2},replied:true});f.state.onlineRequest=online;
 const b=barrier('FOLLOWING');b.generation=rollback?3:2;if(rollback){b.servingReleaseId='previous123';b.phase='ROLLED_BACK';b.liveOriginals.find(row=>row.kind==='jobs').releaseId=b.servingReleaseId;}
 const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const raw=value=>Buffer.from(JSON.stringify(canonical(value))),epoch={id:'original-epoch',releaseId:b.servingReleaseId,publicationSha256:hex,generation:b.generation};
 const audit={terminalReleaseId:b.servingReleaseId,terminalEpochSha256:digest(raw(epoch)),terminalPhase:'ONLINE_SERVING',publicationSha256:hex},auditRaw=raw(audit);
 const sourceRequest={terminalRawBase64:auditRaw.toString('base64'),terminalResultSha256:digest(auditRaw),pointIndexSha256:hex,canonicalMetadataSha256:hex};
 const certificate={decision:{terminalResultSha256:sourceRequest.terminalResultSha256,pointIndexSha256:hex,canonicalMetadataSha256:hex,terminalEpochSha256:audit.terminalEpochSha256,publicationSha256:hex},signature:'issued-original-fixture'};
 b.terminalWal={auditSha256:digest(auditRaw),certificateSha256:digest(raw(certificate)),publicationSha256:hex,epoch};
 f.api.terminalSources.set(terminal,{session:f.state,replied:true,request:sourceRequest,certificate});f.state.terminal=terminal;
 return {f,b};
}
test('following finish binds original terminal audit and issued certificate for completed and rolled-back serving epochs',async()=>{
 for(const rollback of [false,true]){const {f,b}=followingFixture(rollback);
 const pending=f.api.finishOriginalProtectedClient(f.owner.session,{mode:'FOLLOWING'});await new Promise(done=>setImmediate(done));
 f.detach(v=>{v.mode='FOLLOWING';v.barrier=b;return v;});
 await f.close();assert.equal((await pending).detached.mode,'FOLLOWING');
 await assert.rejects(f.api.finishOriginalProtectedClient(JSON.parse(JSON.stringify(binding)),{mode:'BOOTSTRAP'}),/FINISH_UNAVAILABLE/);
 }
});
test('rollback detach rejects substituted phase, release, generation, checkpoint, certificate and epoch',async()=>{
 for(const mutate of [b=>b.phase='COMPLETED',b=>b.servingReleaseId='unrelated123',b=>b.generation=2,b=>b.checkpointSha256='f'.repeat(64),b=>b.terminalWal.certificateSha256='f'.repeat(64),b=>b.terminalWal.epoch.id='unrelated-epoch',b=>b.requiredGateNames.pop(),b=>b.terminalWal.auditSha256='f'.repeat(64)]){const {f,b}=followingFixture(true);const pending=f.api.finishOriginalProtectedClient(f.owner.session,{mode:'FOLLOWING'});await new Promise(done=>setImmediate(done));mutate(b);f.detach(v=>{v.mode='FOLLOWING';v.barrier=b;return v;});await f.close();await assert.rejects(pending,/DETACH_UNPROVEN/);}
});
import {spawnSync} from 'node:child_process';
test('actual sealed bootstrap is valid Python and pins service from the immutable hostpack before execution',()=>{
 const f=fixture(),command=f.spawned[0][1].at(-1),encoded=command.match(/base64\.b64decode\('([^']+)'\)/)[1],raw=Buffer.from(encoded,'base64');
 const parsed=spawnSync('python',['-B','-c',"import sys;compile(sys.stdin.buffer.read(),'<actual-client-bootstrap>','exec')"],{input:raw,encoding:'utf8'});assert.equal(parsed.status,0,parsed.stderr);assert.equal(parsed.signal,null);
 assert.match(raw.toString(),/immutable\(root\/'host-pack-receipt\.json',config\['hostPackReceiptSha256'\]/);assert.match(raw.toString(),/ref=receipt\['outputs'\]\['deploy\/scripts\/online-owner-service\.py'\]/);
});
