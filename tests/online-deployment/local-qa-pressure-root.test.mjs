/** Actual Root capture/revalidate/close source and boundary; deterministic Docker
 * ports, real private Windows lease. This is source qualification, not native QA. */
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import vm from 'node:vm';
import {acquireSerialHostLease,retainOriginalSerialHostLease}from'../../scripts/lib/serial-physical/host-lease.mjs';
import {runCandidateRollbackBoundary}from'../../scripts/lib/candidate-rollback-boundary.mjs';
const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8');
test('Root releases its private lease only for proved pre-worker allocation failure',{skip:process.platform!=='win32'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sampler-initialization-')),lease=await acquireSerialHostLease(path.join(dir,'lease.lock')),obligation=retainOriginalSerialHostLease(lease);let closed=false;
 const body=source.slice(source.indexOf(' async function initializeSampler(){'),source.indexOf(' async function run(args,'));
 const failure=new Error('BEFORE_WORKER_ALLOCATED');
 const context={createOriginalLocalQaPressureSampler(){throw failure;},isPressureSamplerBeforeAllocationFailure:error=>error===failure,directory:dir,custody:{},observerCustody:{},save(){},serial:0,unknown:false,obligation:{close(){obligation.close();closed=true;}},lease,process:{off(){}},cancel(){}};
 try{const initialize=vm.compileFunction(body+'return initializeSampler;',Object.keys(context))(...Object.values(context));await assert.rejects(initialize(),error=>error===failure);assert.equal(closed,true);assert.throws(()=>lease.assertHeld());}
 finally{if(!closed){obligation.close();await lease.release();}fs.rmSync(dir,{recursive:true});}
});
test('actual Root returns verified baseline before pressure refusal, then closes the same private lease',{skip:process.platform!=='win32'},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pressure-root-')),file=path.join(dir,'lease.lock'),lease=await acquireSerialHostLease(file),obligation=retainOriginalSerialHostLease(lease),trace=[];
 const slots=['backend-candidate','backend-retained'],base=path.resolve('D:/fixture/base.yml'),configuration={exact:true},sqlite={sha256:'a'.repeat(64)},pin=file=>({file,sha256:'b'.repeat(64)});
 const all=Object.fromEntries(slots.map((service,i)=>[service,{Id:String(i+1),Image:'sha256:'+String(i+1).repeat(64),Config:{Cmd:['node','dist/index.js'],Entrypoint:[],Labels:{'com.docker.compose.project.config_files':base,'com.docker.compose.version':'2.40.0','com.docker.compose.config-hash':'hash'}},HostConfig:{Memory:2048*1024**2,MemorySwap:2048*1024**2,Mounts:[{Target:'/app/runtime-authority',VolumeOptions:{Subpath:'authority'}},{Target:'/app/online-runtime-acceptance',VolumeOptions:{Subpath:'acceptance'}}]}}]));all['frontend-candidate']={Image:'frontend'};
 const model={name:'sabalanerp-local',services:Object.fromEntries(slots.map(s=>[s,{image:all[s].Image,command:all[s].Config.Cmd}]))};
 const context={pressure:{close:async()=>{trace.push('sampler-drained');}},assert,path,process:{env:{},off(){}},clearInterval(){},slots,base,root:'D:/fixture',source:{},lease,obligation,pin,
  guard:()=>lease.assertHeld(),capacity:async({captureOnly=false}={})=>{trace.push(captureOnly?'baseline-observation':'admission-refused');if(!captureOnly)throw Error('QA_MEMORY_PRESSURE_REFUSED');},
  inspectQuiescentInquiry:async stage=>{assert.equal(stage,'baseline');return all;},inspectAll:async()=>all,candidateBeforeUpConfiguration:()=>configuration,sqlite:async()=>sqlite,
  docker:async args=>{if(args[0]==='image')return JSON.stringify([{Id:args[2],Descriptor:{digest:args[2]},Config:{Entrypoint:[]},RepoTags:['tag']}]);if(args.includes('--short'))return'2.40.0';if(args.includes('--hash'))return'service hash';return JSON.stringify(model);},
  validateLocalRollbackModel(){},resources:async()=>{},captureInquiry:async()=>{},captureBrowserRollback:async()=>{},quiet:async()=>{},observeCurrentCapsules:async()=>({same:true}),
  save:(name)=>{trace.push(name);return pin(name);},revalidateC3OperationsSourceReuse(){},images:async()=>{},protectedEqual(){},
  assertFrontendLifecycleClosed:async()=>{},verifyBaseline:async()=>{trace.push('baseline-rechecked');},cancel(){},
 };
 const capture=source.slice(source.indexOf(' async function capture(){'),source.indexOf(' function verifyInitialInspectionPreparationFailure('));
 const revalidate=source.slice(source.indexOf(' async function revalidate('),source.indexOf(' async function quiet('));
 const close=source.split('\n').find(line=>line.includes('async closeReadOnlyOrRestored(){'));
 const root=vm.compileFunction(`let baseline,environment,compose,lastCapacity,initialCapacityFailure=null,preparationOnly=false,devScope=null,unknown=false,recovering=false,inquiryMutating=false,plannedModel;let phase='PREPARING',released=false,runStarted=true,masterStarted=false,devPending=null,devRestored=false,keeper;${capture}${revalidate}return {capture,revalidate,${close}setPhase(value){phase=value;},inspect(){return {phase,released};}};`,Object.keys(context))(...Object.values(context));
 let result;
 try{
  result=await runCandidateRollbackBoundary({assertLease:context.guard,captureBaseline:root.capture,revalidateBaseline:root.revalidate,attemptReplacement(){throw Error('UP_MUST_NOT_START');},assertQuiet(){},restoreBaseline(){throw Error('NO_MUTATION');},verifyBaseline:context.verifyBaseline,verifyCandidate(){throw Error('NO_CANDIDATE');},persist:r=>root.setPhase(r.phase),persistIntent(){throw Error('NO_INTENT');},hold(){throw Error('UNEXPECTED_HELD');}});
  assert.equal(result.phase,'FAILED_BEFORE_UP');assert.equal(result.mutationIntent,false);assert.ok(trace.indexOf('baseline.json')<trace.indexOf('admission-refused'));await root.closeReadOnlyOrRestored();assert.equal(root.inspect().released,true);assert.throws(()=>lease.assertHeld());const fd=fs.openSync(file,'r');fs.closeSync(fd);assert.equal(fs.existsSync(file),true);
 }finally{
  if(!root.inspect().released){obligation.close();await lease.release();}
  assert.equal(path.dirname(dir),fs.realpathSync(os.tmpdir()));fs.rmSync(dir,{recursive:true});
 }
});
