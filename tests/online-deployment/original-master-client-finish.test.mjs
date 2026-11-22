import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('../../backend/node_modules/typescript');
const source=fs.readFileSync(new URL('../../scripts/run-original-online-qualification-master.mjs',import.meta.url),'utf8'),tree=ts.createSourceFile('master.mjs',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const declaration=tree.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='runOriginalOnlineQualificationMaster').getText(tree).replace(/^export\s+/,'');
async function exercise({pendingControl=false,extraFinish={},signalDuringFirst=false}={}){
 const order=[],events=[],listeners=new Map();let settleControl,resolveHeld;const held=new Promise(resolve=>{resolveHeld=resolve;});
 const context={assert,Buffer,Set,Promise,process:{platform:'win32',on:(name,fn)=>listeners.set(name,fn),off:name=>listeners.delete(name)},setInterval:()=>1,clearInterval:()=>order.push('keeper-closed'),keys:(v,k)=>assert.deepEqual(Object.keys(v).sort(),[...k].sort()),writeOriginalMasterFailureDiagnostic:()=>{},pinnedConfiguration:()=>({}),inspectOriginalLocalOnlineCheckpointInputs:()=>{},
 runOriginalRetainedBrowserQualificationRounds:async()=>{assert.ok(listeners.has('SIGTERM'));listeners.get('SIGTERM')();order.push('first-original-closed');return{};},runOriginalApplicationNativeQualification:async()=>({completion:{},reportPath:'fixture'}),runOriginalIndependentRestoreOverSsh:async options=>{options.onOriginalGuardianReady('actual-fixture-guardian');return{};},waitOriginalIndependentGuardianClosure:async token=>{assert.equal(token,'actual-fixture-guardian');order.push('guardian-closed');},
 startOriginalProtectedOnlineInstall:()=>({session:{},binding:Promise.resolve({}),qualificationRequest:Promise.resolve({})}),readOriginalProtectedQualificationRequest:()=>({}),
 waitOriginalProtectedClientCallbacks:async()=>{order.push('callbacks-closed');},finishOriginalProtectedClient:async()=>{order.push('ssh-native-closed');return{fixtureOnly:true};},
 sendOriginalProtectedClientControl:()=>new Promise(resolve=>{settleControl=()=>{order.push('control-closed');resolve({});};})};
 const master=vm.runInNewContext('('+declaration+')',context);
 const frames=[{command:'PREPARE_LOCAL_RUNTIME',nativeOwnerElfReceipt:'fixture'},{command:'PREPARE_INDEPENDENT',configurationFile:'fixture',configurationSha256:'a'.repeat(64),password:'fixture-only'},{command:'RUN_LOCAL',candidateReplacementReceipt:'fixture'},{command:'RUN_INDEPENDENT',configurationFile:'fixture',configurationSha256:'a'.repeat(64),password:'fixture-only'},{command:'START_PROTECTED_INSTALL',launchPlanFile:'fixture',launchPlanSha256:'a'.repeat(64)}];
 if(pendingControl)frames.push({command:'FOLLOWING_CONTROL',control:'FINISH_CYCLE',input:{}});
 frames.push({command:'FINISH_CLIENT',mode:'BOOTSTRAP',...extraFinish});
 async function* input(){let seq=0;for(const row of frames){yield Buffer.from(JSON.stringify({...row,sequence:++seq})+'\n');if(row.command==='FOLLOWING_CONTROL'){await new Promise(done=>setImmediate(done));assert.equal(order.includes('ssh-native-closed'),false);setImmediate(()=>settleControl());}}}
 const run=master({deferLocal:true,...(signalDuringFirst?{retainedBrowserPlanFile:'fixture',retainedBrowserPlanSha256:'a'.repeat(64)}:{}),input:input(),output:{write(raw){const event=JSON.parse(raw);events.push(event);if(event.event==='ORIGINAL_MASTER_REQUEST_FAILED_RETAINED')resolveHeld();}}});
 if(Object.keys(extraFinish).length||signalDuringFirst)await held;else await run;
 return{order,events,listeners};
}
test('actual master FINISH_CLIENT waits outstanding same-service control, callbacks and guardian before SSH closure and keeper release',async()=>{const result=await exercise({pendingControl:true});assert.deepEqual(result.order,['control-closed','callbacks-closed','guardian-closed','ssh-native-closed','keeper-closed']);assert.equal(result.events.at(-1).format,'sabalan-original-master-client-completed/v1');assert.equal(result.listeners.size,0);});
test('actual strict FINISH_CLIENT parser rejects caller pass bits without discarding original keeper',async()=>{const result=await exercise({extraFinish:{approved:true}});assert.equal(result.events.at(-1).event,'ORIGINAL_MASTER_REQUEST_FAILED_RETAINED');assert.equal(result.order.includes('ssh-native-closed'),false);assert.equal(result.order.includes('keeper-closed'),false);assert.equal(result.listeners.size,3);});

test('normal signal during first retained original await is recorded before any later owner can start',async()=>{const result=await exercise({signalDuringFirst:true});assert.equal(result.order[0],'first-original-closed');assert.equal(result.events.at(-1).event,'ORIGINAL_MASTER_REQUEST_FAILED_RETAINED');assert.equal(result.order.includes('ssh-native-closed'),false);assert.equal(result.order.includes('keeper-closed'),false);assert.equal(result.listeners.size,3);});
