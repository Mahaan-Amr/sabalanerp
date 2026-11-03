import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture as inquiryFixture} from './restored-inquiry-carrier-observation.fixture.mjs';
import {runRestoredQaApplicationLifecycle} from '../../scripts/lib/restored-qa/application-lifecycle.mjs';

// Simulated native/carrier ports: no processes, SQL, endpoint capability or
// accepted recovery proof is manufactured by these source lifecycle tests.
function fixture(){
 const events=[],database={name:'sabalan_checkpoint_verify_012345abcdef',oid:'12',systemIdentifier:'34'};
 const state={phase:'ENROLLED',active:true,fail:null};
 const original={originalPid:123,code:0,signal:null,stdoutEof:true,stderrEof:true,killed:false,observationFault:null,sha256:'c'.repeat(64)};
 const broker={inspect:()=>({phase:state.phase}),
  async runBaseline(){events.push('baseline');return{event:'CLOSED',result:{runtimeId:'a'.repeat(64)}};},
  async initialize(){events.push('initialize');return{initializer:{phase:'ACTIVE',originalSqlChildren:[{returncode:0,reaped:true}]},observation:{originalSqlProbe:{pid:123,returncode:0,reaped:true}}};},
  async startHttp(){events.push('http');state.phase='HTTP_READY';},
  httpEndpointWitness(){assert.equal(state.phase,'HTTP_READY');return Object.freeze({});},
  async closeHttp(){events.push('drain');state.phase='CLOSED';if(state.fail==='close')throw Error('close');return{productionAdmission:false};},
  async awaitRetainedClosure(){events.push('originals-closed');if(state.fail==='retained')throw Error('held');},
 };
 const inquiry=inquiryFixture();
 const input={broker,database,inquiryExpected:()=>inquiry.expected,controllerSha256:'b'.repeat(64),assertActive(){assert.ok(state.active);},
  async exercise(witness){assert.deepEqual(witness,{});events.push('authenticated-probe');if(state.fail==='probe')throw Error('probe');return{database,authenticated:true,businessVerified:true,filesVerified:true,originals:[{...original,role:'frontend'},{role:'inquiry',evidence:inquiry.evidence}],productionAdmission:false};},
  async recheck(){events.push('final-readback');if(state.fail==='recheck')throw Error('readback');return{database,sql:{visible:true,sessions:0,prepared:0},filesVerified:true,productionAdmission:false};},
 };
 return{input,state,events};
}
test('source lifecycle returns closed observations only after authenticated probe, drain and final readback',async()=>{
 const f=fixture(),result=await runRestoredQaApplicationLifecycle(f.input);
 assert.deepEqual(f.events,['baseline','initialize','http','authenticated-probe','drain','originals-closed','final-readback']);
 assert.equal(result.initialization.observation.originalSqlProbe.reaped,true);assert.equal(result.initialization.initializer.originalSqlChildren[0].returncode,0);
 assert.equal(result.inquiryClosure.wrapperStatus,128);assert.equal(result.inquiryClosure.naturalExitZero,false);
 assert.equal(result.cleanupPending,true);assert.equal(result.independentPointHealthy,false);assert.equal(result.productionAdmission,false);
});
test('probe failure still drains and waits for original closure before rejecting',async()=>{
 const f=fixture();f.state.fail='probe';await assert.rejects(runRestoredQaApplicationLifecycle(f.input),/probe/);
 assert.deepEqual(f.events.slice(-2),['drain','originals-closed']);assert.ok(!f.events.includes('final-readback'));
});
test('expired proof refuses all native work',async()=>{
 const f=fixture();f.state.active=false;await assert.rejects(runRestoredQaApplicationLifecycle(f.input));assert.deepEqual(f.events,[]);
});

test('failed native closure or final readback never produces a completed application observation',async()=>{
 for(const fail of ['close','retained','recheck']){const f=fixture();f.state.fail=fail;await assert.rejects(runRestoredQaApplicationLifecycle(f.input));assert.ok(f.events.includes('originals-closed'));if(fail!=='recheck')assert.ok(!f.events.includes('final-readback'));}
});
test('foreign, unauthenticated or unclosed carriers refuse and still drain the private HTTP owner',async()=>{
 for(const change of [p=>p.database.oid='99',p=>p.authenticated=false,p=>p.originals.pop(),p=>p.originals[0].code=1,p=>p.originals[0].stdoutEof=false,p=>p.originals[0].killed=true,p=>p.originals[0].sha256='bad',p=>p.cookie='forbidden']){
  const f=fixture(),exercise=f.input.exercise;f.input.exercise=async w=>{const p=structuredClone(await exercise(w));change(p);return p;};
  await assert.rejects(runRestoredQaApplicationLifecycle(f.input));assert.deepEqual(f.events.slice(-2),['drain','originals-closed']);
 }
});

import {encodeRestoredQaApplicationArtifact} from '../../scripts/lib/restored-qa/application-composer.mjs';
import {assertOriginalIndependentQualificationEndpoint} from '../../scripts/lib/restored-qa/restored-private-broker.mjs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url);
test('coherent application encoding keeps the unchanged bound and refuses future health claims',()=>{
 const artifact={format:'sabalan-live-restored-application-artifacts/v1',cleanupPending:true,independentPointHealthy:false,productionAdmission:false};
 assert.equal(JSON.parse(encodeRestoredQaApplicationArtifact(artifact)).cleanupPending,true);
 for(const field of ['independentPointHealthy','productionAdmission'])assert.throws(()=>encodeRestoredQaApplicationArtifact({...artifact,[field]:true}));
 assert.throws(()=>encodeRestoredQaApplicationArtifact({...artifact,padding:'x'.repeat(8*1024*1024)}),/ARTIFACT_BOUND/);
});
test('restored broker rejects serialized, foreign and copied endpoint observations',()=>{
 for(const value of [{},{pid:123,url:'http://127.0.0.1:33179'},{phase:'HTTP_READY'},null])assert.throws(()=>assertOriginalIndependentQualificationEndpoint(value),/ORIGINAL_INDEPENDENT_HTTP_ENDPOINT_REQUIRED/);
});
test('source lineage hashes the original COMPLETE and history values without canonicalizing them',()=>{
 const {produce}=require('../../scripts/lib/restored-qa/lineage.cjs'),sha=b=>createHash('sha256').update(b).digest('hex');
 const manifest={packageType:'COMPLETE',format:'sabalan-recovery',components:[]},history=JSON.stringify(Array.from({length:440},(_,id)=>({id}))),view={database:{name:'b',oid:'1',systemIdentifier:'2'},sourceDatabase:{name:'a',oid:'3',systemIdentifier:'4'},sourceManifestValueSha256:sha(JSON.stringify(manifest))};
 const sources=Array.from({length:9},(_,n)=>({name:'root-'+n,files:[],directories:[]}));
 const result=produce(manifest,view,history,sources);
 assert.equal(result.completeManifestValueRaw.toString(),JSON.stringify(manifest));assert.equal(result.lineage.nativeHistorySha256,sha(history));
 assert.throws(()=>produce({...manifest,packageType:'SANITIZED_TEST'},view,history,sources));
 assert.throws(()=>produce(manifest,{...view,sourceManifestValueSha256:'0'.repeat(64)},history,sources));
});

test('legacy natural-zero Inquiry rows are refused while backend originals still close',async()=>{
 const f=fixture(),exercise=f.input.exercise;
 f.input.exercise=async witness=>{const p=await exercise(witness);p.originals[1]={...p.originals[0],role:'inquiry'};return p;};
 await assert.rejects(runRestoredQaApplicationLifecycle(f.input));
 assert.deepEqual(f.events.slice(-2),['drain','originals-closed']);assert.ok(!f.events.includes('final-readback'));
});
