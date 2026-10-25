import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readQaMemoryProfile as realRead} from '../../scripts/lib/application-native-qa-profile.mjs';
import {negativeCapsuleFormat} from '../../scripts/lib/application-native-negative-capsule-acceptance.mjs';
const source=fs.readFileSync(new URL('../../scripts/lib/application-native-qa-profile.mjs',import.meta.url),'utf8');
const sha=b=>createHash('sha256').update(b).digest('hex'),MiB=1024**2,roles=['backend-candidate','backend-retained'];
function fixture(run){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-profile-mixed-'));
 try{
  const put=(name,value,raw=false)=>{const file=fs.realpathSync(dir)+path.sep+name;fs.writeFileSync(file,raw?value:JSON.stringify(value));return{file,sha256:sha(fs.readFileSync(file))};};
  const origins=new Map(),ports={assert,fs,path,createHash,structuredClone,Object,JSON,Array,Buffer,negativeCapsuleFormat,candidateQaMemoryBytes:1536*MiB,expandedCandidateQaMemoryBytes:2048*MiB,retainedQaMemoryBytes:768*MiB,qaSwapBytes:1536*MiB,
   // Unit-only external verification ports; actual stable reads, branches and recursive rechecks execute unchanged.
   validateQaMemoryTransitionReceipt:()=>{},readNegativeRecoveryHandoff:r=>origins.get(r.file),negativeRecoveryDescriptor:t=>t.descriptor,negativeRecoveryInputs:t=>t.inputs,validateNegativeRecoveryCreatedReceipt:()=>{}};
  const body=source.replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
  const api=new Function(...Object.keys(ports),`${body};return {readExplicitQaMemoryProfile,readQaMemoryProfile,qaMemoryProfileInputs,qaMemoryProfileTransition,inspectUnitPin:(token,file)=>profiles.get(token).inputs.get(file)};`)(...Object.values(ports));
  const ids=n=>Object.fromEntries(roles.map((r,i)=>[r,{id:n+r,image:'image'+i,startedAt:n}]));
  const complete=n=>({format:'sabalan-application-native-candidate/v1',pass:true,phase:'COMPLETE',productionAdmission:false,up:{code:0,signal:null},originalChildren:{allOriginalChildrenClosed:true,interrupted:false},actual:Object.fromEntries(roles.map(r=>[r,{...ids(n)[r],memoryBytes:(r===roles[0]?2048:768)*MiB,memorySwapBytes:(r===roles[0]?2048:1536)*MiB}]))});
  const baseline=(previous,negative=false)=>({format:negative?'sabalan-reobserved-negative-unqualified-slots/v1':'sabalan-reobserved-quiescent-installed-slots/v1',identities:previous,previousIdentities:previous,adoptsOriginalPopen:false,originalNativeClosureInferred:false,birthReasonClaimed:false,productionAdmission:false,qualificationSucceeded:false,historicalPhysicalIdentityClaimed:false,installedBytesVerified:true,nativeAndSqlQuietVerified:true,currentEmptyNamespacesVerified:true});
  const observe=(v,previous,negative=false)=>Object.assign(v,{previous,reobservedBaseline:baseline(previous,negative),reobservedInstalled:Object.fromEntries(roles.map(r=>[r,{originalPid:123,code:0,signal:null}])),reobservedNativeQuiet:Object.fromEntries(roles.map(r=>[r,{originalNativeProcesses:0,adoptsOriginalPopen:false}])),reobservedSqlQuiet:{visible:true,sessions:0,prepared:0,system:'test'},sqlQuiet:{system:'test'}});
  const ancestor=complete('old');ancestor.actual[roles[0]].memoryBytes=1536*MiB;ancestor.actual[roles[0]].memorySwapBytes=1536*MiB;
  const ancestorRef=put('ancestor.json',ancestor),leaf=observe(complete('leaf'),ids('old'));leaf.candidateQaMemoryTransition={format:'sabalan-explicit-local-qa-candidate-memory-transition/v3',predecessor:ancestorRef};leaf.inputs={[ancestorRef.file]:ancestorRef.sha256};const leafRef=put('leaf.json',leaf);
  const binary=put('proof.bin',Buffer.from([0,255,1,128]),true),python=put('policy.py','def verify():\n    return True\n',true),json=put('proof.json',{real:'bytes'});
  function negative(name,history,transition){const handoff=put(name+'-handoff.json',{synthetic:true}),previous=ids(name+'-unqualified');origins.set(handoff.file,{descriptor:{historicalCandidateReplacement:history,identities:previous},inputs:Object.fromEntries([binary,python,json].map(r=>[r.file,r.sha256]))});const v=observe(complete(name),previous,true);v.candidateQaMemoryNegativeRecovery={format:'sabalan-negative-baseline-local-qa-memory-profile/v1',handoff,history,transition};v.inputs={[history.file]:history.sha256};return put(name+'.json',v);}
  const inner=negative('inner',leafRef,leafRef),outer=negative('outer',inner,inner);
  const preserved=observe(complete('preserved'),ids('outer'));preserved.candidateQaMemoryProfile={format:'sabalan-preserved-local-qa-candidate-memory-profile/v1',predecessor:outer,transition:outer};preserved.inputs={[outer.file]:outer.sha256};const preservedRef=put('preserved.json',preserved);
  run({api,put,binary,python,json,leafRef,inner,outer,preservedRef,origins});
 }finally{assert.equal(path.dirname(dir),os.tmpdir());assert.ok(path.basename(dir).startsWith('sabalan-profile-mixed-'));fs.rmSync(dir,{recursive:true,force:true});}
}
test('all three real recursive merge paths preserve mixed binary, Python and JSON inputs',()=>fixture(({api,binary,python,json,inner,outer,preservedRef})=>{
 for(const ref of [inner,outer,preservedRef]){const token=api.readExplicitQaMemoryProfile(ref);assert.equal(api.readQaMemoryProfile(token).candidateBytes,2048*MiB);const inputs=api.qaMemoryProfileInputs(token);for(const r of [binary,python,json])assert.equal(inputs[r.file],r.sha256);assert.ok(api.qaMemoryProfileTransition(token));assert.throws(()=>realRead(token),/ORIGINAL_QA_MEMORY_PROFILE_REQUIRED/);}
}));
test('recursive tokens recheck every original raw byte',()=>fixture(({api,binary,preservedRef})=>{const token=api.readExplicitQaMemoryProfile(preservedRef);fs.writeFileSync(binary.file,Buffer.from([0,254,1,128]));for(const action of [()=>api.readQaMemoryProfile(token),()=>api.qaMemoryProfileInputs(token),()=>api.qaMemoryProfileTransition(token)])assert.throws(action);}));
test('wrong raw hash refuses before profile creation',()=>fixture(({api,python,inner})=>{fs.appendFileSync(python.file,'# altered');assert.throws(()=>api.readExplicitQaMemoryProfile(inner));}));
test('receipt inputs still require valid JSON',()=>fixture(({api,put})=>{const invalid=put('invalid.json','not JSON',true);assert.throws(()=>api.readExplicitQaMemoryProfile(invalid),SyntaxError);}));
test('hard-linked raw evidence remains forbidden',()=>fixture(({api,binary,inner})=>{fs.linkSync(binary.file,binary.file+'.alias');assert.throws(()=>api.readExplicitQaMemoryProfile(inner));}));
test('oversized raw evidence remains forbidden',()=>fixture(({api,binary,inner})=>{fs.truncateSync(binary.file,16*MiB+1);assert.throws(()=>api.readExplicitQaMemoryProfile(inner));}));
test('authenticated empty raw logs are tracked and rechecked; empty receipts remain forbidden',()=>fixture(({api,put,origins,inner})=>{const empty=put('stderr.log',Buffer.alloc(0),true);for(const origin of origins.values())origin.inputs[empty.file]=empty.sha256;const token=api.readExplicitQaMemoryProfile(inner);assert.equal(api.qaMemoryProfileInputs(token)[empty.file],empty.sha256);assert.throws(()=>api.readExplicitQaMemoryProfile(empty));fs.writeFileSync(empty.file,'changed');assert.throws(()=>api.readQaMemoryProfile(token));}));
test('null profile behavior unchanged',()=>fixture(({api})=>{assert.equal(api.readExplicitQaMemoryProfile(null),null);assert.equal(api.readExplicitQaMemoryProfile(undefined),null);}));

test('receipt nonempty classification wins when the same file is also raw evidence',()=>fixture(({api,inner,origins})=>{for(const origin of origins.values())origin.inputs[inner.file]=inner.sha256;const token=api.readExplicitQaMemoryProfile(inner);assert.equal(api.inspectUnitPin(token,inner.file).allowEmpty,false);}));
