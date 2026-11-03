/** Root retains this actual Worker and drains it before recovery or lease release. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Worker} from 'node:worker_threads';
import {randomBytes} from 'node:crypto';
import {assertOriginalPrivateEvidenceDirectory} from './original-private-evidence-directory.mjs';
import {createLocalQaPressureOwner,observeLocalQaPressure,validateLocalQaPressure,localQaPressurePolicy} from './local-qa-memory-pressure.mjs';
const beforeAllocationFailures=new WeakSet();
export const isPressureSamplerBeforeAllocationFailure=error=>beforeAllocationFailures.has(error);

export function createOriginalLocalQaPressureSampler({directory,custody,persist,onUnknown=()=>{},observerCustody}){
 let allocationAttempted=false;
 try{
 assertOriginalPrivateEvidenceDirectory(custody,directory);
 const flags=new SharedArrayBuffer(8),nonce=randomBytes(16).toString('hex'),s=fs.lstatSync(directory,{bigint:true});
 const data={format:'sabalan-local-qa-pressure-sampler/v1',directory:path.resolve(directory),directoryStamp:['dev','ino','uid','mode'].map(k=>String(s[k])),flags,nonce};
 return retainLocalQaPressureSampler({createWorker:()=>{allocationAttempted=true;return new Worker(new URL('./local-qa-pressure-sampler-worker.mjs',import.meta.url),{workerData:data});},data,guard:()=>assertOriginalPrivateEvidenceDirectory(custody,directory),onUnknown,
  recovery:()=>createLocalQaPressureOwner({observe:()=>observeLocalQaPressure(observerCustody),persist})});
 }catch(error){if(!allocationAttempted)beforeAllocationFailures.add(error);throw error;}
}

export function retainLocalQaPressureSampler({createWorker,data,guard=()=>{},onUnknown=()=>{},recovery,afterSetup=()=>{}}){
 assert.equal(typeof createWorker,'function');const flags=new Int32Array(data.flags),pending=new Map();
 let worker,noWorker=false,request=0,sequence=0,last=null,active=false,draining=false,closed=false,unknown=false,fault=null,recoveryOwner=null,drainResult;
 let readyResolve,readyReject;const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});ready.catch(()=>{});
 function refuse(error){fault??=error;Atomics.store(flags,0,1);}
 function lost(error){unknown=true;Atomics.store(flags,1,1);refuse(error);onUnknown();readyReject(error);for(const row of pending.values())row.reject(error);pending.clear();}
 const onMessage=message=>{
  try{
   guard();
   if(message.event==='READY'){assert.equal(message.nonce,data.nonce);readyResolve();}
   else if(message.event==='FAULT')refuse(new Error(message.reason));
   else if(message.event==='SAMPLE'){
    assert.equal(message.sequence,sequence+1);sequence=message.sequence;
    const value=validateLocalQaPressure(message.value,Date.parse(message.value.observedAt),{admission:false});
    if(last){assert.equal(value.vm.probeContainerId,last.vm.probeContainerId);assert.equal(value.vm.bootId,last.vm.bootId);assert.ok(value.vm.oomKills>=last.vm.oomKills);if(value.vm.oomKills>last.vm.oomKills)refuse(new Error('QA_VM_OOM_OBSERVED'));
     if(message.monitoring){const gap=Date.parse(value.observedAt)-Date.parse(last.observedAt);if(gap<0||gap>localQaPressurePolicy.monitorIntervalMs+localQaPressurePolicy.probeMaximumDurationMs)refuse(new Error('QA_PRESSURE_SAMPLE_GAP'));}}
    last=value;
   }else if(message.event==='REPLY'){
    const row=pending.get(message.id);assert.ok(row);pending.delete(message.id);
    if(message.value?.state?.fault)refuse(new Error(message.value.state.fault));
    if(message.error){refuse(new Error(message.error));row.reject(new Error(message.error));}else row.resolve(message.value);
   }else throw new Error('QA_SAMPLER_PROTOCOL');
  }catch(error){lost(error);}
 };
 let exitResolve;const exit=new Promise(resolve=>{exitResolve=resolve;});
 const onExit=code=>{closed=true;if(!draining||!drainResult||code!==0)lost(new Error('QA_SAMPLER_EXIT_UNKNOWN'));exitResolve(code);};
 async function call(command,extra={}){
  await ready;guard();assert.equal(unknown,false,'QA_SAMPLER_CUSTODY_UNKNOWN');assert.equal(closed,false,'QA_SAMPLER_ALREADY_CLOSED');
  return new Promise((resolve,reject)=>{const id=++request;pending.set(id,{resolve,reject});worker.postMessage({id,command,...extra});});
 }
 function assertAdmission(){
  guard();assert.equal(recoveryOwner,null,'QA_RECOVERY_NOT_ADMISSION');assert.equal(Atomics.load(flags,1),0,'QA_SAMPLER_CUSTODY_UNKNOWN');
  if(fault)throw fault;assert.equal(Atomics.load(flags,0),0,'QA_SAMPLER_LATCHED_FAULT');assert.ok(last,'QA_PRESSURE_OBSERVATION_REQUIRED');return validateLocalQaPressure(last);
 }
 async function close(){
  if(noWorker){closed=true;return{closure:{workerCreated:false,allOriginalChildrenClosed:true,unknownOriginalCustody:false}};}
  if(closed){assert.equal(unknown,false,'QA_SAMPLER_CUSTODY_UNKNOWN');return drainResult;}
  assert.equal(active,false,'QA_WORK_NOT_DRAINED');assert.equal(draining,false);draining=true;
  drainResult=await call('DRAIN');const code=await exit;guard();assert.equal(code,0);assert.equal(unknown,false);
  assert.equal(drainResult.closure.nonce,data.nonce);assert.equal(drainResult.closure.allOriginalChildrenClosed,true);
  if(drainResult.closure.unknownOriginalCustody||Atomics.load(flags,1)){onUnknown();throw new Error('QA_SAMPLER_CUSTODY_UNKNOWN');}
  return drainResult;
 }
 const owner=Object.freeze({
  async sample(stage,admission=true){if(recoveryOwner)return recoveryOwner.sample(stage,admission);const row=await call('SAMPLE',{stage,admission});if(admission)assertAdmission();return row.sample;},assertAdmission,
  async run(stage,work){assert.equal(active,false,'QA_HEAVY_WORK_ALREADY_ACTIVE');assert.equal(recoveryOwner,null);active=true;let started=false;
   try{await call('BEGIN',{stage});started=true;assertAdmission();return await work();}
   finally{try{if(started)await call('END');}finally{active=false;}}
  },
  async enterRecovery(){assert.equal(active,false,'QA_WORK_NOT_DRAINED');await close();assert.equal(typeof recovery,'function');recoveryOwner??=recovery();recoveryOwner.enterRecovery();},
  close,
  inspect(){return{active,recovery:recoveryOwner!==null,fault:fault?.message??(Atomics.load(flags,0)?'QA_SAMPLER_LATCHED_FAULT':null),samples:sequence,closed,unknown};},
 });
 // Preallocate the complete owner, promises and handlers before creating a live
 // worker. Every later error remains reachable through this SAME owner's port.
 try{worker=createWorker();assert.ok(worker instanceof Worker);}
 catch(error){noWorker=true;refuse(error);readyReject(error);return owner;}
 try{worker.on('error',lost);worker.on('message',onMessage);worker.once('exit',onExit);}
 catch(error){lost(error);return owner;}
 try{afterSetup();}catch(error){refuse(error);}
 return owner;
}
