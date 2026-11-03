import {PassThrough} from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {acquireSerialHostLease,retainOriginalSerialHostLease} from '../../scripts/lib/serial-physical/host-lease.mjs';
const side=process.env.PROPOSAL_BOUNDARY_SIDE??'after';
assert.ok(['before','after'].includes(side));
const repository=process.env.PROPOSAL_TEST_REPOSITORY??path.resolve(import.meta.dirname,'../..');
const overlay=process.env.PROPOSAL_TEST_OVERLAY;
const boundaryFile=path.join(overlay?path.join(overlay,side):repository,'scripts/lib/candidate-rollback-boundary.mjs');
const {runCandidateRollbackBoundary}=await import(pathToFileURL(boundaryFile));
const source=fs.readFileSync(path.join(overlay?path.join(overlay,'after'):repository,'scripts/lib/original-candidate-rollback-owner.mjs'),'utf8');
const capture=source.slice(source.indexOf(' async function capture(){'),source.indexOf(' function verifyInitialInspectionPreparationFailure('));
const witness=source.slice(source.indexOf(' function verifyInitialInspectionPreparationFailure('),source.indexOf(' async function observeCurrentCapsules('));
const closeLine=source.split('\n').find(line=>line.includes('async closeReadOnlyOrRestored(){'));
const entryRaw=fs.readFileSync(repository+'/scripts/lib/native-c3-master-entry.mjs','utf8');
const entry=entryRaw.slice(entryRaw.indexOf('export async function executeNativeC3MasterEntry(')).replace(/^export /,'');

function harness(fault={},real={}){
 const calls=[],records=[];let drift=false;
 const context={pressure:{close:async()=>{}},assert,flags:fault,
  guard(){calls.push('assert-original-lease-and-source');if(drift)throw Error('FROZEN_SOURCE_CHANGED');real.lease?.assertHeld();},
  capacity(){calls.push('initial-capacity-refusal');if(fault.sourceDrift)drift=true;if(fault.unrelatedError)throw Error('UNRELATED');assert.fail('ROLLBACK_BACKING_CAPACITY_FLOOR_REFUSED:C:/');},
  save(name,value){if(fault.proofWrite&&name==='initial-inspection-preparation-closed.json')throw Error('EIO');records.push({name,value});return{file:'modeled-private/'+name,sha256:'a'.repeat(64)};},
  structuredClone,clearInterval(){},cancel(){},process:{off(){}},
  assertFrontendLifecycleClosed:async()=>{calls.push('lifecycle-closed');},
  verifyBaseline:async()=>{throw Error('BASELINE_MUST_NOT_BE_INVENTED');},
  obligation:{close(){calls.push('obligation-closed');real.obligation?.close();}},
  lease:{async release(){calls.push('lease-release');if(fault.leaseClosure)throw Error('LEASE_EOF_UNKNOWN');await real.lease?.release();}},
 };
 const create=vm.compileFunction(`
 let phase='PREPARING',runStarted=true,preparationOnly=true,baseline,initialCapacityFailure=null;
 let lastCapacity={readOnlyPreparation:true,memory:{availableBytes:3000000000},drives:{'C:/':{availableBytes:'13093429248',reserveBytes:'12884901888',workingBytes:'536870912'}}};
 const children=flags.localChild?[{}]:[],activeOriginals=new Set(flags.activeChild?[{}]:[]);
 let unknown=Boolean(flags.unknown),cancelled=false,preUpInputsActive=Boolean(flags.prerequisiteActive);
 let preUpOriginalClosure=flags.noPrerequisiteProof?null:{allOriginalChildrenClosed:!flags.prerequisiteOpen,interrupted:false,childCount:3};
 let masterStarted=false,inquiryMutating=false,inquiryIntent=false,completeBound=false,completeConstructionStarted=false,localDirectory=null;
 let devScope=null,devPending=flags.frontendPending?{}:null,devEvidence=null,devLifecycle=null,devRestored=false,devRestorationObservation=false;
 let operation='modeled-only',released=false,keeper=null;
 ${capture}
 ${witness}
 const close=({${closeLine}}).closeReadOnlyOrRestored;
 return{capture,verify:verifyInitialInspectionPreparationFailure,close,setPhase:v=>{phase=v;},inspect:()=>({phase,released,unknown,masterStarted,cancelled})};
 `,Object.keys(context));
 const root=create(...Object.values(context));
 const port={assertLease:context.guard,captureBaseline:root.capture,
  revalidateBaseline:async()=>{throw Error('UNEXPECTED_BASELINE');},
  attemptReplacement:async()=>{throw Error('INSPECTOR_MUST_NOT_START_AFTER_REFUSAL');},
  assertQuiet:async()=>{throw Error('UNEXPECTED_NATIVE');},restoreBaseline:async()=>{throw Error('NO_RESTORE_ALLOWED');},
  verifyBaseline:context.verifyBaseline,verifyCandidate:async()=>{throw Error('NO_CANDIDATE');},
  persist:async record=>{if(fault.persistFailure)throw Error('PERSIST_EIO');records.push({name:'boundary',value:record});root.setPhase(record.phase);},
  persistIntent(){throw Error('NO_INTENT_ALLOWED');},hold:async record=>{calls.push('held');root.setPhase('HELD');records.push({name:'held',value:record});},
  verifyUnmutatedPreparationFailure:error=>root.verify(fault.changedError?Object.assign(Error(error.message),{code:'ERR_ASSERTION'}):error),
 };
 const owner={freshPreUpPreflight:async()=>({file:'modeled-already-closed-preflight'}),
  async runReplacement(){const result=await runCandidateRollbackBoundary(port,{inspectionOnly:!fault.nativeLane});context.save('result.json',result);return result;},
  inspect:root.inspect,recordEntryFailure(){calls.push('negative-recorded');},
  closeReadOnlyOrRestored:root.close,retainUnclassifiedFailure:async()=>{calls.push('retained-unknown');root.setPhase('HELD');},
 };
 const pseudoProcess={exitCode:0},output=[];
 const entryContext={assert,process:pseudoProcess,JSON,readNativeC3MasterLaunch:()=>({value:{},revalidate(){}}),createOriginalCandidateRollbackOwner:async()=>owner,inspectOriginalCompletePreUpInputs:()=>({modeled:true}),nativeC3ReplacementArguments:()=>['--replace']};
 const execute=vm.compileFunction('return ('+entry+')',Object.keys(entryContext))(...Object.values(entryContext));
 return{calls,records,root,port,pseudoProcess,output,run:()=>execute({},{connectionOnly:true,input:new PassThrough(),output:{write:line=>output.push(JSON.parse(line))}})};
}

test('same entry/boundary/Root proof closes the initial capacity refusal negatively',async()=>{
 const h=harness();await h.run();assert.equal(h.root.inspect().phase,'PREPARATION_FAILED',JSON.stringify({calls:h.calls,records:h.records,output:h.output}));assert.equal(h.root.inspect().released,true);
 assert.equal(h.pseudoProcess.exitCode,1);assert.equal(h.output.at(-1).qualificationSucceeded,false);
 assert.equal(h.records.find(r=>r.name==='result.json').value.preparationFailureClosed,true);
 assert.equal(h.records.find(r=>r.name==='result.json').value.mutationIntent,false);
 assert.ok(h.calls.indexOf('obligation-closed')<h.calls.indexOf('lease-release'));
 assert.ok(!h.calls.includes('held'));assert.ok(!h.calls.includes('retained-unknown'));
});

test('initial refusal closes the actual Windows lease port with natural exit and both EOFs',{skip:process.platform!=='win32'},async()=>{
 const directory=path.join('D:/sabalanerp-online-qa','connection-only-real-lease-'+randomUUID());fs.mkdirSync(directory);
 const file=path.join(directory,'lease.lock'),lease=await acquireSerialHostLease(file),originalPid=lease.originalPid;
 const h=harness({},{lease,obligation:retainOriginalSerialHostLease(lease)});
 await h.run();assert.equal(h.root.inspect().released,true);assert.equal(h.root.inspect().phase,'PREPARATION_FAILED');
 assert.equal(h.pseudoProcess.exitCode,1);assert.equal(h.output.at(-1).qualificationSucceeded,false);
 assert.ok(h.calls.indexOf('obligation-closed')<h.calls.indexOf('lease-release'));
 assert.throws(()=>lease.assertHeld(),/SERIAL_LEASE_ORIGINAL_LOST/);
 // Reopening an existing file read-only proves the original exclusive handle
 // ended; this does not acquire a second lease or delete the original lock.
 const fd=fs.openSync(file,'r');fs.closeSync(fd);
 fs.writeFileSync(path.join(directory,'result.json'),JSON.stringify({originalPid,naturalLeaseReleaseVerified:true,originalExitZeroAndBothEofsRequiredByLeasePort:true,lockPreserved:fs.existsSync(file),negativePreparationPhase:h.root.inspect().phase,qualificationSucceeded:false,modeledCapacityFailure:true,realDockerExecuted:false},null,2)+'\n',{flag:'wx'});
});

for(const fault of ['localChild','activeChild','unknown','prerequisiteActive','prerequisiteOpen','noPrerequisiteProof','frontendPending','changedError','unrelatedError','sourceDrift','proofWrite','persistFailure','nativeLane']){
 test('uncertain or out-of-scope preparation stays HELD: '+fault,async()=>{
  const h=harness({[fault]:true});await h.run();assert.equal(h.root.inspect().phase,'HELD');assert.equal(h.root.inspect().released,false);
  assert.ok(!h.calls.includes('lease-release'));assert.ok(!h.calls.includes('obligation-closed'));assert.equal(h.output.at(-1).qualificationSucceeded,false);
 });
}

test('unknown lease closure never becomes released or successful',async()=>{
 const h=harness({leaseClosure:true});await h.run();assert.equal(h.root.inspect().released,false);assert.equal(h.root.inspect().phase,'HELD');assert.ok(h.calls.includes('retained-unknown'));
});

test('ordinary missing-baseline port without original proof stays held',async()=>{
 const h=harness();delete h.port.verifyUnmutatedPreparationFailure;const result=await runCandidateRollbackBoundary(h.port,{inspectionOnly:true});assert.equal(result.phase,'HELD');assert.equal(result.qualificationSucceeded,false);
});

test('successful inspection still runs the actual supplied inspector and baseline verifier',async()=>{
 const calls=[];const baseline={modeled:true};let records=[];
 const p={assertLease(){},captureBaseline:async()=>baseline,revalidateBaseline:async v=>assert.equal(v,baseline),
  attemptReplacement:async()=>{calls.push('inspector');},assertQuiet(){},restoreBaseline(){throw Error('NO_RESTORE');},verifyBaseline:async v=>{assert.equal(v,baseline);calls.push('baseline-verified');},verifyCandidate(){},persist:async v=>records.push(v),persistIntent(){throw Error('NO_UP');},hold(){throw Error('NO_HOLD');},verifyUnmutatedPreparationFailure(){throw Error('PROOF_NOT_FOR_SUCCESS');}};
 const result=await runCandidateRollbackBoundary(p,{inspectionOnly:true});assert.equal(result.phase,'PREPARED_READ_ONLY');assert.equal(result.inspectionVerified,true);assert.deepEqual(calls,['inspector','baseline-verified']);assert.equal(result.mutationIntent,false);
});
