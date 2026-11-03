import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))),sha=v=>createHash('sha256').update(v).digest('hex');
const moduleText=name=>fs.readFileSync(new URL('../../'+name,import.meta.url),'utf8');
function declaration(text,name){const start=text.indexOf('export '+name),end=text.indexOf('\n}',start)+2;return text.slice(start,end).replace(/^export /,'').replaceAll('await import(','await load(');}
test('online assembler selects original same-Compose completion and revalidates it with actual request instead of COMPLETE',()=>{
 const token={},local={},independent={recoveryMode:'ONLINE_COHERENT_WAL'},request={format:'sabalan-original-online-qualification-request/v1',generation:2};let reads=0;
 const fn=vm.runInNewContext('('+declaration(moduleText('scripts/lib/original-online-evidence-assembler.mjs'),'function assembleOriginalOnlineEvidence(')+')',{
  same:(a,b)=>assert.deepEqual(a,b),assert,Number,readOriginalRoleQualificationCompletion:()=>local,readOriginalPhysicalCompletion:t=>{assert.equal(t,token);reads++;return independent;},
  readOriginalOnlineQualificationRequest:()=>request,isOriginalSameComposePhysical:t=>t===token,
  assembleOriginalEvidence:options=>{assert.equal(options.local,local);assert.equal(options.physical,true);assert.equal(options.sameCompose,true);options.revalidateRequest();return{modeledAssembly:true};},
 });
 assert.equal(fn({localCompletion:{},independentCompletion:token,onlineRequest:{}}).modeledAssembly,true);assert.equal(reads,2);
});
test('origin uses the same-Compose completion graph at the protected key boundary; it never selects the SSH/COMPLETE reader',async()=>{
 const h='a'.repeat(64),token={},local={originalControllers:[{code:0,signal:null}],nativeClosures:[],fileHashes:{}},images={backend:'unit-image'},database={name:'actual',oid:'1',systemIdentifier:'123'};
 const independent={originalControllers:[{code:0,signal:null}],nativeClosures:[],fileHashes:{},images,imageGraphs:{},sourceDatabase:database,cipherInventorySha256:h,sealedManifestSha256:h,plaintextManifestSha256:h};
 const execution={releaseId:'unit_release',bindings:null,sourceHost:{},executionImages:images};
 const assembly={independentCompletionKind:'EXISTING_COMPOSE_PHYSICAL',originalOnlineRequestSha256:h,originalLocalCompletionSha256:sha(bytes(local)),originalIndependentCompletionSha256:sha(bytes(independent)),
  evidenceDirectory:'unit',manifestSha256:h,acceptanceSha256:h,files:{},originalProductionExecution:execution,originalProductionExecutionSha256:sha(bytes(execution))};
 const accepted={manifest:{releaseId:'unit_release',image:images.backend},acceptance:{qualification:{recoveryMode:'ONLINE_COHERENT_WAL',checkpointArchiveChecksum:h,deploymentTargetDatabase:database,deploymentTargetImages:images},reports:{'coherent-independent-restore':{file:'restore.json',sha256:'report'}}},nativeClosures:[],revalidate(){}};
 const report={proofs:[{file:'proof.json',sha256:'proof'}]},proof={checkpointMetadata:{physicalPoint:{sealedManifestSha256:h,plaintextManifestSha256:h,cipherInventorySha256:h}}};
 const stop=Error('STOP_BEFORE_PRIVATE_KEY'),calls=[];
 const fn=vm.runInNewContext('('+declaration(moduleText('deploy/scripts/online-qualification-origin-issuer.mjs'),'async function issueOriginalQualificationOrigin(')+')',{
  Buffer,JSON,Object,canonical,bytes,sha,path:{join:(...parts)=>parts.join('/')},assert:(v,c)=>assert.ok(v,c),hashes:()=>['report','proof'],
  fs:{readFileSync:file=>bytes(file.endsWith('restore.json')?report:proof)},readOriginalRoleQualificationCompletion:()=>local,
  readOriginalPhysicalCompletion:t=>{assert.equal(t,token);calls.push('same-compose');return independent;},
  readOriginalExistingComposeComplete:()=>assert.fail('wrong COMPLETE reader'),readOriginalIndependentRestoreSshCompletion:()=>assert.fail('wrong SSH reader'),
  assertProtectedKeyAcl:async()=>{calls.push('key-boundary');throw stop;},load:async spec=>spec.includes('assembler')?{readOriginalOnlineEvidenceAssembly:()=>assembly}:{originalOnlineEvidenceReader:()=>({readOnlineReleaseEvidence:()=>accepted,validateProductionExecutionBindings:()=>images})},
 });
 await assert.rejects(fn({localCompletion:{},independentCompletion:token,assemblyCompletion:{}}),e=>e===stop);assert.deepEqual(calls,['same-compose','key-boundary']);
});
test('same original master sends coherent point to same-Compose consumer and keeps independent RSA/WAL transport separate (modeled originals)',async()=>{
 const text=moduleText('scripts/lib/original-online-qualification-master.mjs');
 const fn=text.slice(text.indexOf('export async function runOriginalOnlineQualificationMaster('),text.indexOf('\nfunction sort(')).replace(/^export /,'').replaceAll('await import(','await load(');
 const callbackBinding={},point={},physical={},calls=[],events=[];let callbacks,done;const observed=new Promise(resolve=>{done=resolve;});
 const api={runOriginalIndependentPhysicalPointTransfer:async()=>{calls.push('transfer');return{};},readOriginalIndependentPhysicalPointTransfer:()=>({expected:{}}),
  runOriginalIndependentPhysicalRepositoryPromotion:async()=>{calls.push('repository');return{};},runOriginalIndependentPhysicalRestoreOverSsh:()=>assert.fail('obsolete replay selected')};
 const run=vm.runInNewContext('('+fn+')',{assert,Buffer,Set,Promise,process:{platform:'win32',on(){},off(){}},setInterval:()=>1,clearInterval(){},
  keys:(v,k)=>assert.deepEqual(Object.keys(v).sort(),[...k].sort()),pinnedConfiguration:()=>({expected:{}}),inspectOriginalLocalOnlineCheckpointInputs(){},writeOriginalMasterFailureDiagnostic:e=>{throw e;},
  assertOriginalSameComposePhysicalCallbacks:t=>assert.equal(t,callbackBinding),runOriginalApplicationNativeQualification:async options=>{assert.equal(options.localQualificationMode,'PROTECTED_COMPLETE');return{completion:{}};},
  runOriginalExistingComposeComplete:async()=>({}),startOriginalProtectedOnlineInstall:options=>{callbacks=options;return{session:{},binding:Promise.resolve({}),qualificationRequest:Promise.resolve({})};},readOriginalProtectedQualificationRequest:()=>({}),
  runOriginalSameComposePhysical:async options=>{assert.equal(options.callbackBinding,callbackBinding);assert.equal(options.sourcePoint,point);calls.push('same-compose');return physical;},
  readOriginalSameComposePhysical:t=>{assert.equal(t,physical);return{ownedOutputs:{report:{rawBase64:'actual-report'}}};},
  issueOriginalPhysicalCheckpointVerification:async()=>({}),issueOriginalPhysicalRepositoryPromotion:async()=>({}),
  sendOriginalProtectedPhysicalPointVerification:async(_session,p,r)=>{assert.equal(p,point);assert.equal(r.reportRawBase64,'actual-report');calls.push('reply');},load:async()=>api,
 });
 const frames=[{command:'PREPARE_LOCAL_RUNTIME',nativeOwnerElfReceipt:'model'},{command:'PREPARE_INDEPENDENT',configurationFile:'model',configurationSha256:'a'.repeat(64),password:'model-only'},
  {command:'RUN_LOCAL',candidateReplacementReceipt:'model'},{command:'RUN_COMPLETE',configurationFile:'model',configurationSha256:'a'.repeat(64),password:'model-only'},
  {command:'START_PROTECTED_INSTALL',launchPlanFile:'model',launchPlanSha256:'a'.repeat(64)}];
 async function* input(){let sequence=0;for(const row of frames)yield Buffer.from(JSON.stringify({...row,sequence:++sequence})+'\n');await callbacks.onPhysicalPointRequest(point);}
 void run({deferLocal:true,sameComposePhysicalCallbacks:callbackBinding,input:input(),output:{write:raw=>{const row=JSON.parse(raw);events.push(row);if(row.event==='ORIGINAL_MASTER_INPUT_CLOSED_RETAINED')done();}}});
 await observed;assert.deepEqual(calls,['transfer','same-compose','repository','reply']);assert.ok(events.some(row=>row.event==='COMPLETE_QUALIFICATION_CLOSED_RETAINED'));
});
