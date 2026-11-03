import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {assembleOriginalProtectedCompleteEvidence} from '../../scripts/lib/original-online-evidence-assembler.mjs';
import {readOriginalExistingComposeComplete} from '../../scripts/lib/original-existing-compose-complete.mjs';
const source=fs.readFileSync(new URL('../../scripts/run-original-online-qualification-master.mjs',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('export async function runOriginalOnlineQualificationMaster('),source.indexOf('\nfunction sort(')).replace(/^export /,'');
async function masterRun(complete){
 const token={},legacy={},events=[],order=[];
 const frames=[{command:'PREPARE_LOCAL_RUNTIME',nativeOwnerElfReceipt:'unit'},
  {command:'PREPARE_INDEPENDENT',configurationFile:'unit',configurationSha256:'a'.repeat(64),password:'unit-ephemeral'},
  {command:'RUN_LOCAL',candidateReplacementReceipt:'unit'},
  {command:complete?'RUN_COMPLETE':'RUN_INDEPENDENT',configurationFile:'unit',configurationSha256:'a'.repeat(64),password:'unit-ephemeral'},
  {command:'START_PROTECTED_INSTALL',launchPlanFile:'unit',launchPlanSha256:'a'.repeat(64)},
  {command:'ISSUE_ORIGIN',evidenceDirectory:'unit'},{command:'FINISH_CLIENT',mode:'BOOTSTRAP'}];
 const context={assert,Buffer,Set,Promise,process:{platform:'win32',on:()=>{},off:()=>{}},setInterval:()=>1,clearInterval:()=>order.push('keeper-closed'),
  keys:(v,k)=>assert.deepEqual(Object.keys(v).sort(),[...k].sort()),pinnedConfiguration:()=>({}),inspectOriginalLocalOnlineCheckpointInputs:()=>{},writeOriginalMasterFailureDiagnostic:e=>{throw e;},
  runOriginalApplicationNativeQualification:async()=>({completion:'unit-local'}),
  runOriginalExistingComposeComplete:async o=>{assert.equal(o.localCompletion,'unit-local');assert.equal(await o.acquireCredential(),'unit-ephemeral');order.push('complete');return token;},
  runOriginalIndependentRestoreOverSsh:async()=>{order.push('ssh');return legacy;},isOriginalExistingComposeComplete:t=>t===token,
  startOriginalProtectedOnlineInstall:()=>({session:'unit-session',binding:Promise.resolve({}),qualificationRequest:Promise.resolve({id:'original-request'})}),
  readOriginalProtectedQualificationRequest:t=>t,prepareOriginalPrivateEvidenceDirectory:async()=>({}),
  assembleOriginalProtectedCompleteEvidence:o=>{assert.equal(o.independentCompletion,token);order.push('assemble-complete');return 'unit-assembly';},
  assembleOriginalProtectedOnlineEvidence:o=>{assert.equal(o.independentCompletion,legacy);order.push('assemble-ssh');return 'unit-assembly';},
  readOriginalOnlineEvidenceAssembly:()=>({originalProtectedRequestSha256:createHash('sha256').update(JSON.stringify({id:'original-request'})).digest('hex')}),
  sha:r=>createHash('sha256').update(r).digest('hex'),sort:v=>v,
  issueOriginalQualificationOrigin:async o=>{assert.equal(o.independentCompletion,complete?token:legacy);order.push('origin');return{package:'unit-package',file:'unit-file',sha256:'a'.repeat(64)};},
  sendOriginalProtectedQualificationPackage:async(s,r,p)=>{assert.equal(p,'unit-package');order.push('package');},
  waitOriginalProtectedClientCallbacks:async()=>{},finishOriginalProtectedClient:async()=>{order.push('finish');return{unitOnly:true};},
  waitOriginalIndependentGuardianClosure:async()=>{},
 };
 const master=vm.runInNewContext('('+declaration+')',context);
 async function* input(){let sequence=0;for(const f of frames)yield Buffer.from(JSON.stringify({...f,sequence:++sequence})+'\n');}
 await master({deferLocal:true,input:input(),output:{write:raw=>events.push(JSON.parse(raw))}});
 return {events,order};
}
test('master selects distinct COMPLETE assembler/origin and preserves ordinary SSH dispatch',async()=>{
 const complete=await masterRun(true);assert.deepEqual(complete.order,['complete','assemble-complete','origin','package','finish','keeper-closed']);
 const legacy=await masterRun(false);assert.deepEqual(legacy.order,['ssh','assemble-ssh','origin','package','finish','keeper-closed']);
});
test('protected COMPLETE assembler refuses JSON completions and does not adopt legacy-shaped receipts',()=>{
 for(const value of [{},{format:'sabalan-original-existing-compose-complete/v1'},JSON.parse('{}')])assert.throws(()=>readOriginalExistingComposeComplete(value),/COMPOSE_COMPLETE_REQUIRED/);
 assert.throws(()=>assembleOriginalProtectedCompleteEvidence({localCompletion:{},independentCompletion:{},protectedRequest:{}}),/ROLE_COMPLETION_TOKEN_REQUIRED/);
});
