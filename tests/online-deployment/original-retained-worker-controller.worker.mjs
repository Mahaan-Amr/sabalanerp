// Linux filesystem consumer test. The host supplies the CURRENT actual class
// with only construction/native/SQL boundaries replaced. No deployment,
// qualification, application child or database authority is created here.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,createHash} from 'node:crypto';
assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);
const {classSource}=JSON.parse(fs.readFileSync(0,'utf8'));
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))),sha=v=>createHash('sha256').update(v).digest('hex');
const oldId='1'.repeat(64),candidateId='2'.repeat(64),captureId='3'.repeat(64);
function fixture({liveCandidate=false,kernelFailure=false,wrongCapture=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-retained-controller-')),rootIdentity=fs.lstatSync(root,{bigint:true});
 fs.chmodSync(root,0o700);const coord=path.join(root,'coord'),trust=path.join(root,'trust');
 for(const p of [coord,trust])fs.mkdirSync(p,{mode:0o700});
 for(const p of ['online','online/native','online/work'])fs.mkdirSync(path.join(coord,p),{mode:0o700});
 const lock=path.join(coord,'worker.lock');fs.writeFileSync(lock,'',{flag:'wx',mode:0o600});const pin=fs.statSync(lock,{bigint:true});
 const scope={format:'sabalan-online-runtime-scope/v2',runtimeId:oldId,nonce:'4'.repeat(64),purpose:'jobs',role:'control',releaseId:'release_old',image:'sha256:'+'5'.repeat(64),sourceCommit:'6'.repeat(40),manifestSha256:'7'.repeat(64),coordinationDirectory:'/app/coord',
  worker:{file:'/app/coord/worker.lock',device:String(pin.dev),inode:String(pin.ino),ownerUid:0},gate:{device:'1',inode:'2',ownerUid:0},nativeDirectory:'/app/coord/online/native/'+oldId,boundaryDirectory:'/app/coord/online/work/'+oldId};
 const file=path.join(trust,oldId+'.json');fs.writeFileSync(file,Buffer.concat([bytes(scope),Buffer.from('\n')]),{flag:'wx',mode:0o400});
 const previous={file,scope,sha256:sha(fs.readFileSync(file))},original={input:{evidenceDirectory:'/inert-original-evidence',manifestSha256:'8'.repeat(64),acceptanceSha256:'9'.repeat(64),previousReleaseId:null,scopes:[previous]}};
 const row={scope,closed:true,nativeClosureVerified:true,code:0,signal:null};
 const checkpoint={current:'original-checkpoint'},f={root,coord,trust,scope,original,checkpoint,kernelCalls:0,carrierCalls:0,continuityChecks:0,phase:'ONLINE_ROLLBACK_PUBLISHING'};
 const owner={deploymentId:'attempt001',releaseId:'release_new',leaseToken:'inert-fixture'};
 const capture={runtimeId:captureId,owner,scope:{...scope,releaseId:wrongCapture?'another_release':'release_old'},publication:{committed:true},plan:{scopeFile:path.join(trust,captureId+'.json'),coordinationRuntime:'/app/coord',coordinationHost:coord}};
 const nativeRows=[row,{scope:{...scope,runtimeId:candidateId,releaseId:'release_new'},closed:!liveCandidate,nativeClosureVerified:!liveCandidate,code:liveCandidate?null:0,signal:null}];
 const kernel={readOnlineReleaseEvidence:()=>({manifest:{generation:1},revalidate(){}}),async registerRetainedOnlineWorker(database,actualOwner,input){
  f.kernelCalls++;assert.equal(actualOwner.deploymentId,owner.deploymentId);assert.equal(input.previousJobsScope.scope.runtimeId,oldId);assert.equal(input.workerHostFile,lock);
  assert.equal(input.checkpointSha256,sha(bytes(checkpoint)));const fresh=input.registration.scopes[0];
  assert.notEqual(fresh.scope.runtimeId,oldId);assert.notEqual(fresh.scope.nonce,scope.nonce);assert.equal(sha(fs.readFileSync(fresh.file)),fresh.sha256);
  assert.equal(fs.statSync(fresh.file).mode&0o777,0o400);
  const work=path.join(coord,'online/work',fresh.scope.runtimeId),native=path.join(coord,'online/native',fresh.scope.runtimeId);
  assert.equal(fs.statSync(work).mode&0o777,0o700);assert.equal(fs.statSync(native).mode&0o777,0o700);
  assert.equal(fs.statSync(path.join(native,'deployment-runtime-control.lock')).mode&0o777,0o600);
  const namespace=JSON.parse(fs.readFileSync(path.join(work,'scope.json')));assert.equal(namespace.scope.runtimeId,fresh.scope.runtimeId);assert.equal(namespace.scope.registrySha256,scope.manifestSha256);
  if(kernelFailure)throw Error('INERT_SQL_OUTCOME_UNPROVEN');return{releaseId:'release_old',jobsRuntimeIds:[fresh.scope.runtimeId]};
 }};
 const readPrivate=(name,max,mode)=>{assert.equal(fs.realpathSync(name),name);const st=fs.lstatSync(name);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.nlink===1&&st.uid===0&&st.size<=max);assert.equal(st.mode&0o777,mode);return{data:fs.readFileSync(name)};};
 const context={assert:(v,c)=>assert.ok(v,c),Object,Map,Set,Buffer,URL,fs,path,sha,bytes,canonical,randomBytes,structuredClone,readPrivate,require:()=>kernel,
  async provisionOriginalRetainedWorkerCarrier(controller,selection){f.carrierCalls++;const actual=await controller.readOriginalRetainedWorkerCarrierTarget();assert.equal(actual.runtimeId,selection.runtimeId);assert.equal(actual.releaseId,selection.releaseId);return{selection};},
  readOriginalOnlineCarrier:async(controller,token)=>({kind:'backend',runtimeId:token.selection.runtimeId,releaseId:token.selection.releaseId,slotId:'backend_'+token.selection.runtimeId,containerId:'a'.repeat(64)})};
 const C=vm.runInNewContext('(()=>{'+classSource+';return OriginalOnlineReleaseController;})()',context);
 const controller=new C({owner,capture,original,rows:nativeRows,previous,checkpoint,f,drained:[oldId]});
 return{f,controller,previous,cleanup(){assert.equal(fs.realpathSync(root),root);assert.equal(fs.lstatSync(root,{bigint:true}).ino,rootIdentity.ino);assert.ok(root.startsWith(path.join(os.tmpdir(),'sabalan-retained-controller-')));fs.rmSync(root,{recursive:true});}};
}
test('actual controller creates one private fresh jobs namespace and only one original backend carrier',async()=>{
 const t=fixture();try{const oldRaw=fs.readFileSync(t.previous.file),result=await t.controller.prepareOriginalRetainedRollback({releaseId:'release_old'});
  assert.equal(result.releaseId,'release_old');assert.equal(result.jobsRuntimeIds.length,1);assert.notEqual(result.jobsRuntimeIds[0],oldId);
  assert.equal(t.f.kernelCalls,1);assert.equal(t.f.carrierCalls,1);assert.equal(t.f.continuityChecks,1);assert.deepEqual(fs.readFileSync(t.previous.file),oldRaw);
  assert.equal(t.f.original.input.scopes.length,2);assert.equal(t.f.original.input.scopes[0].scope.runtimeId,oldId);
  await assert.rejects(t.controller.prepareOriginalRetainedRollback({releaseId:'release_old'}));assert.equal(t.f.kernelCalls,1);
 }finally{t.cleanup();}
});
test('live candidate jobs or changed captured predecessor refuse before filesystem enrollment',async()=>{
 for(const options of [{liveCandidate:true},{wrongCapture:true}]){const t=fixture(options);try{await assert.rejects(t.controller.prepareOriginalRetainedRollback({releaseId:'release_old'}));assert.equal(t.f.kernelCalls,0);assert.equal(t.f.carrierCalls,0);assert.equal(fs.readdirSync(t.f.trust).length,1);}finally{t.cleanup();}}
});
test('unproven registration retains private evidence and refuses carrier provisioning or retry',async()=>{
 const t=fixture({kernelFailure:true});try{await assert.rejects(t.controller.prepareOriginalRetainedRollback({releaseId:'release_old'}),/INERT_SQL_OUTCOME_UNPROVEN/);assert.equal(t.f.kernelCalls,1);assert.equal(t.f.carrierCalls,0);assert.equal(fs.readdirSync(t.f.trust).length,2);assert.equal(t.controller.__held(),'ONLINE_ORIGINAL_RETAINED_WORKER_PREPARATION_UNPROVEN');}finally{t.cleanup();}
});
