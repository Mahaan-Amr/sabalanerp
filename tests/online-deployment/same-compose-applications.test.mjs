import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {runSameComposePhysicalApplications} from '../../scripts/lib/same-compose-physical-applications.mjs';
import {applicationFixture} from './same-compose-applications.fixture.mjs';
const fixture=()=>applicationFixture(fs.mkdtempSync(path.join(os.tmpdir(),'source418-composer-')));
test('fixed physical producer runs actual lifecycle source and constructs output after closure and readback',async()=>{
 const f=fixture(),result=await runSameComposePhysicalApplications(f);
 assert.deepEqual(f.events,['prepare','baseline','initialize','http','probe','close','retained','recheck','observations']);
 assert.equal(result.format,'sabalan-original-physical-applications-output/v1');assert.equal(result.operation,f.input.operation);
 const report=JSON.parse(Buffer.from(result.applicationResult.ownedOutputs.report.rawBase64,'base64'));
 assert.equal(report.lifecycle.probe.authenticated,true);assert.equal(report.inquiryClosure.closure.originalReturncode,128);
 assert.equal(report.inquiryClosure.closure.naturalExitZero,false);assert.equal(report.restoredIncarnation,undefined);
 assert.equal(result.applicationResult.nativeClosures.length,3);assert.equal(result.productionAdmission,false);
});
test('fixed producer closes originals after failed probe and never reads completed observations on negative paths',async()=>{
 for(const fail of ['probe','retained','recheck']){const f=fixture();f.state.fail=fail;await assert.rejects(runSameComposePhysicalApplications(f));
  assert.ok(f.events.includes('close'));assert.ok(f.events.includes('retained'));assert.ok(!f.events.includes('observations'));}
});
test('serialized report, missing physical cut, stale scope and wrong sqlite refuse before application preparation',async()=>{
 for(const mutate of [f=>f.input.report={},f=>f.state.active=false,f=>{const d=f.input.ownedInputs.layout;d.sha256='0'.repeat(64);},f=>{f.input.canonicalReplay={...f.input.canonicalReplay,restorePoint:{...f.input.canonicalReplay.restorePoint,name:'foreign'}};}]){
  const f=fixture();mutate(f);await assert.rejects(runSameComposePhysicalApplications(f));assert.deepEqual(f.events,[]);}
});
