/** Local admission only. Never changes a container limit or grants restoration. */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import policy from './local-qa-pressure-policy.json' with {type:'json'};
export const localQaPressurePolicy=Object.freeze(policy);
// AssertionError.code describes the JavaScript mechanism, not the pressure
// condition. Preserve only the fixed semantic reasons across Worker replies.
const pressureFaultReasons=new Set(['QA_PRESSURE_STALE','QA_PRESSURE_INVALID_NUMBER','QA_COMMIT_INVALID','QA_VM_PRESSURE_INVALID',
 'QA_PRESSURE_PROBE_LATE','QA_PRESSURE_PROBE_NOT_CLOSED','QA_MEMORY_PRESSURE_REFUSED','QA_PRESSURE_OBSERVER_FAILED',
 'QA_PRESSURE_TELEMETRY_BOUND','QA_PRESSURE_SAMPLE_GAP','QA_PRESSURE_PROBE_CONTAINER_CHANGED','QA_VM_RESTARTED',
 'QA_VM_OOM_COUNTER_REGRESSED','QA_VM_OOM_OBSERVED']);
const pressureFaultReason=error=>{const reason=typeof error?.message==='string'?error.message.split(/\r?\n/,1)[0]:null;return pressureFaultReasons.has(reason)?reason:error?.code??error?.message??null;};
export function validateLocalQaPressure(value,now=Date.now(),{admission=true}={}){
 assert.deepEqual(Object.keys(value).sort(),['format','platform','observedAt','availableBytes','commitTotalBytes','commitLimitBytes','lowMemory','vm','probe'].sort());
 assert.equal(value.format,'sabalan-local-qa-pressure/v1');assert.equal(value.platform,'win32');
 const age=now-Date.parse(value.observedAt);assert.ok(age>=0&&age<=policy.sampleMaximumAgeMs,'QA_PRESSURE_STALE');
 for(const key of ['availableBytes','commitTotalBytes','commitLimitBytes'])assert.ok(Number.isSafeInteger(value[key])&&value[key]>=0,'QA_PRESSURE_INVALID_NUMBER');
 assert.ok(value.commitLimitBytes>0&&value.commitTotalBytes<=value.commitLimitBytes,'QA_COMMIT_INVALID');
 assert.deepEqual(Object.keys(value.vm).sort(),['probeContainerId','bootId','fullAvg10','someAvg10','oomKills'].sort());assert.deepEqual(Object.keys(value.probe).sort(),['durationMs','children'].sort());assert.equal(typeof value.lowMemory,'boolean');assert.match(value.vm.probeContainerId,/^[a-f0-9]{64}$/);assert.match(value.vm.bootId,/^[a-f0-9-]{36}$/);
 for(const key of ['someAvg10','fullAvg10'])assert.ok(Number.isFinite(value.vm[key])&&value.vm[key]>=0&&value.vm[key]<=100,'QA_VM_PRESSURE_INVALID');
 assert.ok(Number.isSafeInteger(value.vm.oomKills)&&value.vm.oomKills>=0);
 assert.ok(value.probe.durationMs>=0&&value.probe.durationMs<=policy.probeMaximumDurationMs,'QA_PRESSURE_PROBE_LATE');
 assert.equal(value.probe.children.length,2);
 for(const c of value.probe.children)assert.ok(Number.isSafeInteger(c.originalPid)&&c.originalPid>0&&c.code===0&&c.stdoutEof===true&&c.stderrEof===true,'QA_PRESSURE_PROBE_NOT_CLOSED');
 if(admission)assert.ok(!value.lowMemory&&value.commitTotalBytes/value.commitLimitBytes<=policy.maximumCommitPercent/100&&value.vm.fullAvg10<=policy.maximumVmFullAvg10&&value.vm.someAvg10<=policy.maximumVmSomeAvg10,'QA_MEMORY_PRESSURE_REFUSED');
 return value;
}
export async function observeLocalQaPressure({onOriginal=()=>{},onClosed=()=>{}}={}){
 assert.equal(process.platform,'win32');
 const child=spawn('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',
  ['-I','-B',fileURLToPath(new URL('../../deploy/scripts/local-qa-pressure.py',import.meta.url))],
  {stdio:['ignore','pipe','pipe'],windowsHide:true});
 return drainLocalQaPressureObserver(child,{onOriginal,onClosed});
}
/** Four event-driven lifecycle observations, not a polling collector or gate. */
export async function observeLocalDevFrontendMemory(options={}){
 assert.equal(process.platform,'win32');
 const child=spawn('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',
  ['-I','-B',fileURLToPath(new URL('../../deploy/scripts/local-qa-pressure.py',import.meta.url)),'--frontend-memory'],
  {stdio:['ignore','pipe','pipe'],windowsHide:true});
 const value=await drainLocalQaPressureObserver(child,options);return validateLocalDevFrontendMemory(value);
}
export function validateLocalDevFrontendMemory(value){
 assert.equal(value.format,'sabalan-local-dev-frontend-memory/v1');assert.ok(value.durationMs>=0&&value.durationMs<=15000,'FRONTEND_MEMORY_OBSERVATION_LATE');
 for(const windows of [value.windowsBefore,value.windowsAfter]){for(const key of ['availableBytes','commitTotalBytes','commitLimitBytes'])assert.ok(Number.isSafeInteger(windows[key])&&windows[key]>=0);assert.ok(windows.commitLimitBytes>0&&windows.commitTotalBytes<=windows.commitLimitBytes);assert.equal(typeof windows.lowMemory,'boolean');}
 assert.match(value.frontend.id,/^[a-f0-9]{64}$/);assert.match(value.probeContainerId,/^[a-f0-9]{64}$/);assert.match(value.guest.bootId,/^[a-f0-9-]{36}$/);
 for(const key of ['MemTotal','MemAvailable','AnonPages','Cached','Buffers','Shmem','SReclaimable','SwapTotal','SwapFree','SwapCached'])assert.ok(Number.isSafeInteger(value.guest.vmBytes[key])&&value.guest.vmBytes[key]>=0,'FRONTEND_VM_MEMORY_UNPROVEN');
 for(const key of ['anon','file'])assert.ok(Number.isSafeInteger(value.guest.cgroup.stat[key])&&value.guest.cgroup.stat[key]>=0);assert.equal(value.guest.cgroup.includesMeasurementProbe,true);
 if(value.frontend.running){assert.equal(value.probeService,'frontend');assert.equal(value.probeContainerId,value.frontend.id);assert.deepEqual(value.frontendCgroup,value.guest.cgroup);assert.ok(value.frontend.pid>0);}else{assert.equal(value.probeService,'backend-candidate');assert.notEqual(value.probeContainerId,value.frontend.id);assert.equal(value.frontendCgroup,null);assert.equal(value.frontend.pid,0);}
 assert.equal(value.memoryFreedClaimed,false);assert.equal(value.productionAdmission,false);assert.equal(value.originalChildren.length,4);
 for(const row of value.originalChildren)assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>0&&row.code===0&&row.stdoutEof&&row.stderrEof,'FRONTEND_MEMORY_CHILD_NOT_CLOSED');return value;
}
/** Retain the actual child and both readers. Overflow discards output, never kills. */
export async function drainLocalQaPressureObserver(child,{onOriginal=()=>{},onClosed=()=>{}}={}){
 let fault=false,bytes=0,out='';
 child.on('error',()=>{fault=true;});
 for(const stream of [child.stdout,child.stderr])stream.on('error',()=>{fault=true;});
 child.stdout.on('data',raw=>{bytes+=raw.length;if(bytes<=65536)out+=raw.toString('utf8');else fault=true;});
 child.stderr.on('data',()=>{fault=true;});
 const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({originalPid:child.pid??null,code,signal,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,observationFault:fault})));
 try{onOriginal(child);}catch{fault=true;}
 const receipt=await closed;await onClosed(child,receipt);
 assert.ok(!fault&&receipt.code===0&&receipt.signal===null&&receipt.stdoutEof&&receipt.stderrEof,'QA_PRESSURE_OBSERVER_FAILED');
 return JSON.parse(out);
}
/** One owner, one heavy lane. A fault latches; it never races/kills the work.
 * Work must settle through its existing original-child/reader closure path.
 * Recovery can observe pressure, but cannot obtain a new admission from it. */
export function createLocalQaPressureOwner({observe=observeLocalQaPressure,persist,now=Date.now,onFault=()=>{},onValidated=()=>{},maximumSamples=policy.maximumSamples,
 setTimer=setInterval,clearTimer=clearInterval}={}){
 assert.equal(typeof persist,'function');let fault=null,previous=null,count=0,active=false,recovery=false,monitoring=false,timer,pending=null,queue=Promise.resolve();
 assert.ok(Number.isInteger(maximumSamples)&&maximumSamples>0&&maximumSamples<=policy.maximumSamples,'QA_PRESSURE_BOUND_CANNOT_INCREASE');
 function sample(stage,admission=true){const next=queue.then(()=>collect(stage,admission));queue=next.catch(()=>{});return next;}
 function latch(error){fault??=error;onFault(fault);return fault;}
 async function collect(stage,admission=true){
  try{
   assert.ok(count<maximumSamples,'QA_PRESSURE_TELEMETRY_BOUND');const sequence=++count;
   const value=await observe();persist({stage,sequence,policy:policy.version,observation:value,recovery});
   // A fresh, structurally valid closed observation still proves continuity
   // when it denies admission. Never turn skipped bad-pressure frames into gaps.
   validateLocalQaPressure(value,now(),{admission:false});
   if(previous){if(monitoring){const gap=Date.parse(value.observedAt)-Date.parse(previous.observedAt);assert.ok(gap>=0&&gap<=policy.monitorIntervalMs+policy.probeMaximumDurationMs,'QA_PRESSURE_SAMPLE_GAP');}assert.equal(value.vm.probeContainerId,previous.vm.probeContainerId,'QA_PRESSURE_PROBE_CONTAINER_CHANGED');assert.equal(value.vm.bootId,previous.vm.bootId,'QA_VM_RESTARTED');assert.ok(value.vm.oomKills>=previous.vm.oomKills,'QA_VM_OOM_COUNTER_REGRESSED');if(value.vm.oomKills>previous.vm.oomKills){latch(new Error('QA_VM_OOM_OBSERVED'));}}
   previous=value;onValidated(value);
   if(admission&&!recovery){if(fault)throw fault;validateLocalQaPressure(value,now());}return value;
  }catch(error){throw latch(error);}
 }
 return Object.freeze({
  sample,
  enterRecovery(){assert.equal(active,false,'QA_WORK_NOT_DRAINED');recovery=true;},
  assertAdmission(){assert.equal(recovery,false,'QA_RECOVERY_NOT_ADMISSION');if(fault)throw fault;assert.ok(previous,'QA_PRESSURE_OBSERVATION_REQUIRED');return validateLocalQaPressure(previous,now());},
  async run(stage,work){
   assert.equal(active,false,'QA_HEAVY_WORK_ALREADY_ACTIVE');assert.equal(recovery,false,'QA_RECOVERY_NOT_ADMISSION');
   active=true;
   try{if(fault)throw fault;await sample(stage);monitoring=true;
    timer=setTimer(()=>{if(count>=maximumSamples){latch(new Error('QA_PRESSURE_TELEMETRY_BOUND'));clearTimer(timer);return;}if(!pending)pending=sample(stage).catch(()=>{}).finally(()=>{pending=null;});},policy.monitorIntervalMs);
    const result=await work();clearTimer(timer);if(pending)await pending;if(fault)throw fault;await sample(stage);if(fault)throw fault;return result;
   }finally{clearTimer(timer);if(pending)await pending;monitoring=false;active=false;}
  },
  inspect(){return{active,recovery,fault:pressureFaultReason(fault),...(fault?.code?{faultCode:fault.code}:{}),samples:count};},
 });
}
