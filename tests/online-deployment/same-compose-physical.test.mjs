import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';
import {physicalFixture,owned} from './same-compose-physical.fixture.mjs';
import {joinOriginalSameComposePhysical,readOriginalSameComposePhysical,createOriginalSameComposePhysicalCallbacks,runOriginalSameComposePhysical} from '../../scripts/lib/original-same-compose-physical.mjs';
import {readOriginalPhysicalCompletion} from '../../scripts/lib/original-physical-completion.mjs';
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'source418-'));
function model(){return physicalFixture(temporary());}
test('exact graph joins distinct replay/RSA hosts and post-restoration incarnation; content never becomes authority',()=>{
 const input=model(),before=structuredClone(input.serial.applicationResult.ownedOutputs.report);
 const result=joinOriginalSameComposePhysical(input);assert.equal(result.format,'sabalan-original-same-compose-physical-completion/v1');
 assert.deepEqual(result.replayHost,input.report.replayHost);assert.deepEqual(result.rsaHost,input.rsa.rsaHost);
 assert.deepEqual(result.restoredIncarnation,input.incarnation);assert.equal(result.productionAdmission,false);
 assert.deepEqual(input.serial.applicationResult.ownedOutputs.report,before);
 const report=JSON.parse(Buffer.from(result.ownedOutputs.report.rawBase64,'base64'));
 assert.equal(report.originalPgCommands.length,3);assert.deepEqual(report.originalApplicationReport,before);
 assert.throws(()=>readOriginalSameComposePhysical(result),/ORIGINAL_SAME_COMPOSE_PHYSICAL_REQUIRED/);
 assert.throws(()=>readOriginalPhysicalCompletion(result),/UNPROVEN/);
});
test('missing/corrupt WAL, wrong identity, incomplete base/files, application failures, live originals and predicted incarnation refuse',()=>{
 for(const mutate of [v=>v.transfer.initialWindowBindings=[],v=>v.serial.originalClusterRestored=false,v=>v.incarnation.systemIdentifier='333',v=>v.rsa.originalControllers[0].code=7,
  v=>v.serial.originalControllers[0].code=7,v=>v.serial.applicationResult.originalControllers[0].stdoutEof=false,
  v=>v.report.replay.lastReplayLsn='0/201',v=>v.report.replay.systemIdentifier='333',v=>v.report.applicationHealth.backend.status=503,
  v=>v.report.layout.restoredFileCuts.pop(),v=>v.report.layout.physicalBase.backupManifestSha256='f'.repeat(64),
  v=>v.report.restoredIncarnation=v.incarnation,v=>v.report.rsaHost=v.source.sourceHost,
  v=>v.serial.applicationResult.ownedOutputs.walClosure.sha256='f'.repeat(64),v=>v.report.decryption.fullGcmAuthenticated=false]){
  const value=model();mutate(value);value.serial.applicationResult.ownedOutputs.report=owned(value.report);
  // Layout is a separately retained original output, never inferred from report.
  assert.throws(()=>joinOriginalSameComposePhysical(value));
 }
});
test('source callback consumer crosses RSA, actual serial binding and final original join in one master (modeled ports only)',async()=>{
 const text=fs.readFileSync(new URL('../../scripts/lib/original-same-compose-physical.mjs',import.meta.url),'utf8');
 const fn=text.slice(text.indexOf('export async function runOriginalSameComposePhysical(')).replace(/^export /,'');
 const value=model(),callbackBinding={},binding={},rsaToken={},completion={},incarnation={},pointTransfer={},options={expected:value.transfer.expected},calls=[];
 const callbacks=new WeakMap([[callbackBinding,{createSerialBinding:async()=>{calls.push('binding');return binding;}}]]),completed=new WeakMap();
 const run=vm.runInNewContext('('+fn+')',{assert:{...assert,deepEqual:(a,b)=>assert.deepEqual(structuredClone(a),structuredClone(b))},Date,JSON,Object,structuredClone,callbacks,completed,output:d=>Buffer.from(d.rawBase64,'base64'),joinOriginalSameComposePhysical,
  assertOriginalSameComposePhysicalCallbacks:t=>assert.equal(t,callbackBinding),readOriginalPhysicalPointSource:async()=>{calls.push('source');return value.source;},
  readOriginalIndependentPhysicalPointTransfer:()=>value.transfer,runOriginalIndependentComponents:async()=>{calls.push('rsa');return rsaToken;},readOriginalIndependentComponents:t=>{assert.equal(t,rsaToken);return value.rsa;},
  readOriginalSerialPhysicalPlan:t=>{assert.equal(t,binding);return value.plan;},bindOriginalSerialPhysicalMaterial:(b,r)=>{assert.equal(b,binding);assert.equal(r,rsaToken);calls.push('material');},
  runOriginalSerialPhysicalBinding:async t=>{assert.equal(t,binding);calls.push('serial');return{completion,incarnation};},
  readOriginalSerialPhysicalCompletion:t=>{assert.equal(t,completion);return value.serial;},readOriginalSerialRestoredIncarnation:t=>{assert.equal(t,incarnation);return value.incarnation;},
 });
 const token=await run({callbackBinding,sourcePoint:{},pointTransfer,options});assert.ok(completed.has(token));
 assert.ok(calls.indexOf('rsa')<calls.indexOf('binding'));assert.ok(calls.indexOf('material')<calls.indexOf('serial'));
 assert.throws(()=>readOriginalSameComposePhysical(token),/ORIGINAL_SAME_COMPOSE_PHYSICAL_REQUIRED/,'model tokens never enter real runtime authority');
});
test('source callback registry is programmatic and a fabricated native binding is refused before a native command',async()=>{
 const callbackBinding=createOriginalSameComposePhysicalCallbacks({createSerialBinding:async()=>({})});
 await assert.rejects(runOriginalSameComposePhysical({callbackBinding,sourcePoint:{},pointTransfer:{},options:{}}),/ORIGINAL_PHYSICAL_POINT_SOURCE_REQUIRED/);
});
