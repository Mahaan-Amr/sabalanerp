import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import Module,{createRequire} from 'node:module';
const require=createRequire(import.meta.url),esbuild=require('../../backend/node_modules/esbuild');
function fixture({negative=false,foreign=false}={}){
 const proof={},scope={},witness={},events=[],database={name:'live_unit_b',oid:'73',systemIdentifier:'123'},
  manifest={format:'sabalan-recovery',packageType:'COMPLETE',components:[]},context={proof:{database},manifest};
 let active=false;
 const sourceOwned={sourceCommit:'a'.repeat(40),config:{sourceCommit:'a'.repeat(40)},hrSession:'b'.repeat(64),operation:'c'.repeat(32),
  issuer:{assertActive:()=>assert.ok(active)},inquiryCarrier:{assertCurrent:()=>assert.ok(active)}};
 const file=path.resolve('scripts/lib/restored-qa/complete-callback.mjs'),m=new Module(file);m.filename=file;
 const nativeRequire=createRequire(file);
 m.require=id=>({
  '/app/dist/services/systemRecoveryEngine.js':{assertActiveStrictRestoreProof:value=>{assert.equal(value,proof);return context;}},
  '/app/dist/services/restoredQaPrivateControlQualification.js':{withRestoredQaPrivateControlQualification:async(p,owner,commit,files,work)=>{
   assert.equal(p,proof);assert.equal(commit,sourceOwned.sourceCommit);active=true;events.push('private-open');try{return{value:await work(scope),proof:{productionAdmission:false}};}finally{active=false;events.push('private-closed');}}},
  './restored-private-broker.mjs':{assertOriginalIndependentQualificationEndpoint:value=>{assert.equal(value,witness);assert.ok(active);return{url:'http://live-original-unit'};}},
  './application-composer.mjs':{qualifyRestoredQaApplications:async options=>{
   assert.equal(options.proof,proof);assert.equal(options.scope,scope);assert.ok(active);events.push('410');
   const probe=await options.exercise({witness,database,manifest,assertActive:()=>assert.ok(active)});assert.equal(probe.authenticated,true);
   return {format:'sabalan-live-restored-application-reference/v1',unitOnly:true};}},
 }[id]??nativeRequire(id));
 const source=fs.readFileSync(file,'utf8').replace('const require=createRequire(import.meta.url);','');
 m._compile(esbuild.transformSync(source,{format:'cjs',target:'node22'}).code,file);
 return {...m.exports,events,options:{proof:foreign?{}:proof,intendedOwner:{releaseId:'unit_release'},files:new Map(),sourceOwned,prepare:async()=>{},
  exchange:async({descriptor,endpoint,assertActive})=>{assert.ok(active);assertActive();assert.equal(endpoint.url,'http://live-original-unit');events.push('windows-closed');
   return {ack:{...descriptor.request,format:'sabalan-original-complete-callback-ack/v1',requestSha256:descriptor.sha256,callbackDrained:!negative},probe:{database,authenticated:true}};
  }}};
}
test('actual callback adapter invokes source410 inside the same active engine/private scope and refuses negative ACK',async()=>{
 for(const negative of [false,true]){
  const f=fixture({negative});
  // ACK is an exact fixed schema; discard request-only fields in the model peer.
  const exchange=f.options.exchange;f.options.exchange=async input=>{const v=await exchange(input);delete v.ack.manifestSha256;return v;};
  if(negative)await assert.rejects(f.qualifyOriginalCompleteCallback(f.options));
  else{const result=await f.qualifyOriginalCompleteCallback(f.options);assert.equal(result.value.coherentQualification.format,'sabalan-live-restored-application-reference/v1');}
  assert.deepEqual(f.events,['private-open','410','windows-closed','private-closed']);
 }
 const f=fixture({foreign:true});await assert.rejects(f.qualifyOriginalCompleteCallback(f.options));assert.deepEqual(f.events,[]);
});
