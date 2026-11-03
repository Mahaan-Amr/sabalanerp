/** Lifecycle over source-owned Docker/filesystem ports. Returned data is never
 * candidate admission, a portable lease, or a reconstructed process token. */
import {validateQaHostMemoryObservation} from './application-native-qa-memory.mjs';
import {createHash} from 'node:crypto';import assert from 'node:assert/strict';import {ChildProcess} from 'node:child_process';

export async function prepareCandidateUpMemory({prepare,observe,profile,persist,memoryPolicy}){await prepare();const sample=await observe();const result=persist(sample);assert.ok(!result||typeof result.then!=='function','FINAL_UP_SAMPLE_PERSIST_MUST_BE_SYNCHRONOUS');validateQaHostMemoryObservation(sample,profile,Date.now(),{memoryPolicy});return sample;}

export async function runCandidateRollbackBoundary(port,{inspectionOnly=false}={}){
 assert.equal(typeof inspectionOnly,'boolean');
 const diagnosticSources=new Map(['scripts/lib/candidate-rollback-boundary.mjs',...(port.diagnosticSources??[])].filter(p=>p.endsWith('.mjs')).map(p=>{assert.ok(!p.startsWith('/')&&!p.includes('\\')&&!p.split('/').includes('..'));return[new URL('../../'+p,import.meta.url).href,p];}));
 for(const name of ['assertLease','captureBaseline','revalidateBaseline','attemptReplacement','assertQuiet','restoreBaseline','verifyBaseline','verifyCandidate','persist','persistIntent','hold'])assert.equal(typeof port[name],'function');
 let phase='PREPARING',baseline,intent=false,up,upClosed,primaryFailed=false,primaryCode=null,primarySourceLocations=[],primaryFailure=null;
 const originals=[];
 function observe(child,kind){
  assert.ok(child instanceof ChildProcess&&child.stdout&&child.stderr);const owner={child,kind,result:null};let fault=false;const counts={stdout:0,stderr:0},hashes={stdout:createHash('sha256'),stderr:createHash('sha256')};
  for(const name of ['stdout','stderr'])child[name].on('data',raw=>{counts[name]+=raw.length;hashes[name].update(raw);if(counts[name]>(name==='stdout'?8*1024**2:65536))fault=true;});
  child.once('error',()=>{fault=true;});child.stdout.on('error',()=>{fault=true;});child.stderr.on('error',()=>{fault=true;});
  owner.closed=new Promise(resolve=>child.once('close',(code,signal)=>{owner.result={originalPid:child.pid??null,code,signal,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,observationFault:fault,stdoutBytes:counts.stdout,stderrBytes:counts.stderr,stdoutSha256:hashes.stdout.digest('hex'),stderrSha256:hashes.stderr.digest('hex')};if(kind==='up')upClosed=owner.result;resolve();}));
  originals.push(owner);if(kind==='up'&&up===undefined)up=owner.closed;
  try{port.assertLease();assert.ok(originals.length<=256);if(kind==='up'){assert.equal(intent,true);assert.equal(originals.filter(v=>v.kind==='up').length,1);}}catch(error){child.stdout.resume();child.stderr.resume();throw error;}
 }
 async function drain(){for(const owner of originals){if(owner.child.stdin&&!owner.child.stdin.destroyed&&!owner.child.stdin.writableEnded)owner.child.stdin.end();owner.child.stdout.resume();owner.child.stderr.resume();}await Promise.all(originals.map(owner=>owner.closed));}
 const record=extra=>({format:'sabalan-original-candidate-rollback-boundary/v1',phase,primaryFailureObserved:primaryFailed,primaryCode,primarySourceLocations,
  mutationIntent:intent,originalAuxiliaries:originals.filter(v=>v.kind==='aux').map(v=>v.result),originalUp:upClosed??null,qualificationSucceeded:false,productionAdmission:false,...extra});
 async function persist(){port.assertLease();await port.persist(record());port.assertLease();}
 async function held(error){phase='HELD';await port.hold({code:error?.code??error?.name??'THROWN_VALUE',...record()});return record();}
 try{
  port.assertLease();baseline=await port.captureBaseline();port.assertLease();await port.revalidateBaseline(baseline,'BEFORE_UP');await persist();
  async function prepareMutation(){assert.equal(inspectionOnly,false,'INSPECTION_MUTATION_REFUSED');assert.equal(intent,false);port.assertLease();await port.assertQuiet(baseline);await port.revalidateBaseline(baseline,'BEFORE_UP');port.assertLease();phase='READY_FOR_UP';await persist();}
  function markUpIntent(){assert.equal(intent,false);assert.equal(phase,'READY_FOR_UP');port.assertLease();intent=true;phase='UP_INTENT';const value=port.persistIntent(record());assert.ok(!value||typeof value.then!=='function','UP_INTENT_PERSIST_MUST_BE_SYNCHRONOUS');port.assertLease();}
  await port.attemptReplacement({
   prepareMutation,markUpIntent,
   async mutationIntent(){await prepareMutation();markUpIntent();},
   drainOriginalUp:drain,
   originalAuxiliary(child){observe(child,'aux');},
   originalUp(child){observe(child,'up');},
  });
  if(inspectionOnly){
   assert.equal(intent,false);assert.equal(up,undefined);assert.ok(originals.every(v=>v.kind==='aux'));await Promise.all(originals.map(v=>v.closed));port.assertLease();
   for(const v of originals)assert.ok(v.result.code===0&&v.result.signal===null&&v.result.stdoutEof&&v.result.stderrEof&&!v.result.observationFault,'INSPECTION_AUXILIARY_CLOSURE_REQUIRED');
   await port.verifyBaseline(baseline);port.assertLease();phase='PREPARED_READ_ONLY';await persist();return record({inspectionVerified:true});
  }
  assert.ok(intent&&up,'ORIGINAL_UP_NOT_OBSERVED');await Promise.all(originals.map(owner=>owner.closed));port.assertLease();
  for(const owner of originals.filter(v=>v.kind==='aux'))assert.ok(owner.result.code===0&&owner.result.signal===null&&owner.result.stdoutEof&&owner.result.stderrEof&&!owner.result.observationFault,'AUXILIARY_CLOSURE_NOT_SUCCESSFUL');
  assert.equal(upClosed.code,0);assert.equal(upClosed.signal,null);assert.equal(upClosed.stdoutEof,true);assert.equal(upClosed.stderrEof,true);assert.equal(upClosed.observationFault,false);
  await port.verifyCandidate(baseline);port.assertLease();phase='CANDIDATE_VERIFIED';await persist();return record({candidateVerified:true});
 }catch(error){primaryFailure=error;primaryFailed=true;primaryCode=error?.code??error?.name??'THROWN_VALUE';for(const line of String(error?.stack??'').split('\n')){if(!/^\s+at /.test(line))continue;const match=line.match(/(file:\/\/\/[^\s)]+\.mjs):(\d{1,9}):(\d{1,9})\)?$/);if(match&&diagnosticSources.has(match[1]))primarySourceLocations.push(diagnosticSources.get(match[1])+':'+match[2]+':'+match[3]);if(primarySourceLocations.length===12)break;}}
 try{
  await drain();port.assertLease();
  for(const owner of originals)assert.ok(Number.isInteger(owner.result.code)&&owner.result.signal===null&&owner.result.stdoutEof&&owner.result.stderrEof&&!owner.result.observationFault,'ORIGINAL_AUXILIARY_CLOSURE_UNKNOWN');
  await port.beginRecovery?.();
  if(!intent){assert.equal(up,undefined,'UNANNOUNCED_ORIGINAL_UP_HANDLE');
   if(!baseline){assert.equal(inspectionOnly,true,'CURRENT_BASELINE_NOT_CAPTURED');assert.equal(originals.length,0,'INITIAL_PREPARATION_HAS_ORIGINAL_CHILDREN');assert.equal(typeof port.verifyUnmutatedPreparationFailure,'function','CURRENT_BASELINE_NOT_CAPTURED');const preparationClosure=await port.verifyUnmutatedPreparationFailure(primaryFailure);port.assertLease();phase='PREPARATION_FAILED';await persist();return record({preparationFailureClosed:true,baselineCaptured:false,preparationClosure});}
   await port.verifyBaseline(baseline);phase='FAILED_BEFORE_UP';await persist();return record();}
  assert.ok(up&&originals.filter(v=>v.kind==='up').length===1,'UP_INTENT_WITHOUT_SINGLE_ORIGINAL_HANDLE');await up;port.assertLease();
  assert.ok(Number.isInteger(upClosed.code)&&upClosed.signal===null&&upClosed.stdoutEof&&upClosed.stderrEof&&!upClosed.observationFault,'ORIGINAL_UP_CLOSURE_UNKNOWN');
  await port.revalidateBaseline(baseline,'BEFORE_RESTORE');await port.assertQuiet(baseline);port.assertLease();
  phase='RESTORING_BASELINE';await persist();await port.restoreBaseline(baseline);port.assertLease();
  await port.verifyBaseline(baseline);port.assertLease();phase='RESTORED_AFTER_FAILED_UP';await persist();return record();
 }catch(error){return held(error);}
}
