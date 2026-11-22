import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../../scripts/run-original-online-qualification-master.mjs',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('export async function runOriginalOnlineQualificationMaster('),source.indexOf('\nfunction sort(')).replace(/^export /,'');
const hex='a'.repeat(64),reference={instanceId:hex,servicePid:123,serviceBirth:'456',configurationSha256:hex};
const detached={...reference,serviceBootIdSha256:hex,launcherPid:124,launcherBirth:'457',mode:'BOOTSTRAP'};
async function exercise({mode='normal',referenceChange=false,bindingChange=false}={}){
 const events=[],order=[],listeners=new Map();let done,resolveCallbacks;const observed=new Promise(resolve=>done=resolve),pendingCallbacks=new Promise(resolve=>resolveCallbacks=resolve);
 let clients=0;const context={assert,Buffer,Set,Promise,process:{platform:'win32',on:(name,fn)=>listeners.set(name,fn),off:name=>listeners.delete(name)},setInterval:()=>1,clearInterval:()=>order.push('keeper-closed'),keys:(v,k)=>assert.deepEqual(Object.keys(v).sort(),[...k].sort()),writeOriginalMasterFailureDiagnostic:()=>{},pinnedConfiguration:()=>({}),inspectOriginalLocalOnlineCheckpointInputs:()=>{},
 runOriginalApplicationNativeQualification:async()=>({completion:{original:true}}),runOriginalIndependentRestoreOverSsh:async options=>{options.onOriginalGuardianReady('retained-original-guardian');return{original:true};},waitOriginalIndependentGuardianClosure:async()=>{order.push('guardian-closed');},
 startOriginalProtectedOnlineInstall:()=>{clients++;order.push('client-'+clients);return{session:{id:clients},binding:Promise.resolve({...detached,...(clients===2&&bindingChange?{launcherBirth:'999'}:{})}),qualificationRequest:Promise.resolve({})};},readOriginalProtectedQualificationRequest:()=>({}),
 waitOriginalProtectedClientCallbacks:async()=>{order.push('callbacks');if(mode==='callbacks'){setImmediate(()=>{assert.ok(!order.includes('ssh-closed'));resolveCallbacks();});await pendingCallbacks;order.push('callbacks-closed');}},
 finishOriginalProtectedClient:async(token,{mode:actual})=>{assert.equal(actual,'BOOTSTRAP');order.push('ssh-closed');return{detached,exit:{code:0,signal:null},stdoutEof:mode!=='bad-eof',stderrEof:true};},sendOriginalProtectedClientControl:()=>new Promise(()=>{})};
 const master=vm.runInNewContext('('+declaration+')',context);
 const frames=[{command:'PREPARE_LOCAL_RUNTIME',nativeOwnerElfReceipt:'fixture'},{command:'PREPARE_INDEPENDENT',configurationFile:'fixture',configurationSha256:hex,password:'fixture-only'},{command:'RUN_LOCAL',candidateReplacementReceipt:'fixture'},{command:'RUN_INDEPENDENT',configurationFile:'fixture',configurationSha256:hex,password:'fixture-only'},{command:'START_PROTECTED_INSTALL',launchPlanFile:'fixture',launchPlanSha256:hex}];
 if(mode==='pending')frames.push({command:'FOLLOWING_CONTROL',control:'FINISH_CYCLE',input:{}});
 frames.push({command:'FINISH_CLIENT',mode:'BOOTSTRAP_RETAIN'});
 if(mode==='twice')frames.push({command:'FINISH_CLIENT',mode:'BOOTSTRAP_RETAIN'});
 else frames.push({command:'START_FOLLOWING_CLIENT',launchPlanFile:'fixture',launchPlanSha256:hex,serviceReference:{...reference,...(referenceChange?{serviceBirth:'999'}:{})}});
 async function* input(){let sequence=0;for(const row of frames){if(mode==='held'&&row.mode==='BOOTSTRAP_RETAIN')listeners.get('SIGTERM')();yield Buffer.from(JSON.stringify({...row,sequence:++sequence})+'\n');}}
 void master({deferLocal:true,input:input(),output:{write(raw){const event=JSON.parse(raw);events.push(event);if(['ORIGINAL_MASTER_REQUEST_FAILED_RETAINED','ORIGINAL_MASTER_INPUT_CLOSED_RETAINED'].includes(event.event))done();}}});
 await observed;return{events,order,listeners,clients};
}
test('actual master bootstrap detach retains tokens, stdin, guardians, keeper and rebinds same actual service once',async()=>{
 const result=await exercise();assert.equal(result.clients,2);assert.ok(result.events.some(x=>x.format==='sabalan-original-master-bootstrap-retained/v1'&&x.independentGuardiansRetained===1));assert.ok(!result.order.includes('guardian-closed'));assert.ok(!result.order.includes('keeper-closed'));assert.equal(result.listeners.size,3);assert.equal(result.events.at(-1).event,'ORIGINAL_MASTER_INPUT_CLOSED_RETAINED');
});
test('changed caller reference or actual rebound launcher rejects and retains master',async()=>{for(const options of [{referenceChange:true},{bindingChange:true}]){const result=await exercise(options);assert.equal(result.events.at(-1).event,'ORIGINAL_MASTER_REQUEST_FAILED_RETAINED');assert.equal(result.clients,options.referenceChange?1:2);assert.ok(!result.order.includes('keeper-closed'));}});
test('held, outstanding control, repeated detach and missing original EOF never permit handoff',async()=>{for(const mode of ['held','pending','twice','bad-eof']){const result=await exercise({mode});assert.equal(result.events.at(-1).event,'ORIGINAL_MASTER_REQUEST_FAILED_RETAINED');assert.equal(result.clients,1);assert.ok(!result.order.includes('keeper-closed'));if(['held','pending'].includes(mode))assert.ok(!result.order.includes('ssh-closed'));}});
test('actual callback wait completes before retained detach, without disposing independent guardians',async()=>{const result=await exercise({mode:'callbacks'});assert.ok(result.order.indexOf('callbacks-closed')<result.order.indexOf('ssh-closed'));assert.ok(!result.order.includes('guardian-closed'));});
