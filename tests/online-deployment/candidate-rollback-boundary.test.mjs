import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';
import {runCandidateRollbackBoundary,prepareCandidateUpMemory} from '../../scripts/lib/candidate-rollback-boundary.mjs';
function fixture(mode='failed-up'){
 const events=[];let restored=0,held=false;
 const port={assertLease(){events.push('lease');},captureBaseline:async()=>({identity:'actual-test-baseline'}),revalidateBaseline:async(_,phase)=>{if(mode==='changed-before-restore'&&phase==='BEFORE_RESTORE')throw Error('sqlite-changed');},
  async attemptReplacement({mutationIntent,originalUp}){
   if(mode==='pre-up')throw Error('preflight');await mutationIntent();
   const code=mode==='slow-up'?"setTimeout(()=>process.exit(1),180)":"process.exit(1)";
   const child=spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','pipe']});originalUp(child);child.stdout.resume();child.stderr.resume();
   throw Error('post-up');
  },assertQuiet:async()=>{events.push('quiet');},
  restoreBaseline:async()=>{events.push('restore');restored++;if(mode==='rollback-failure')throw Error('restore-failed');},
  verifyBaseline:async()=>{events.push('verify');if(mode==='changed-baseline')throw Error('conservation');},
  verifyCandidate:async()=>{},persistIntent:row=>events.push(row.phase),persist:async row=>events.push(row.phase),hold:async()=>{held=true;},
 };
 return{port,events,get restored(){return restored;},get held(){return held;}};
}

test('inspection consumes actual original auxiliary EOF and unchanged baseline without any UP or acceptance',async()=>{
 const f=fixture();f.port.attemptReplacement=async({originalAuxiliary})=>{const c=spawn(process.execPath,['-e',"process.stdout.write('inspection-original')"],{stdio:['ignore','pipe','pipe']});originalAuxiliary(c);};
 const r=await runCandidateRollbackBoundary(f.port,{inspectionOnly:true});assert.equal(r.phase,'PREPARED_READ_ONLY');assert.equal(r.inspectionVerified,true);assert.equal(r.originalAuxiliaries.length,1);assert.equal(r.originalAuxiliaries[0].stdoutEof,true);assert.equal(r.originalAuxiliaries[0].stderrEof,true);assert.equal(r.mutationIntent,false);assert.equal(r.originalUp,null);assert.equal(r.qualificationSucceeded,false);assert.equal(f.restored,0);assert.ok(f.events.includes('verify'));
});
test('inspection refuses mutation hooks and preserves the failed attempt as negative',async()=>{const f=fixture();f.port.attemptReplacement=async h=>h.mutationIntent();const r=await runCandidateRollbackBoundary(f.port,{inspectionOnly:true});assert.equal(r.phase,'FAILED_BEFORE_UP');assert.equal(r.primaryFailureObserved,true);assert.equal(r.mutationIntent,false);assert.equal(r.inspectionVerified,undefined);assert.equal(f.restored,0);});
test('inspection failed auxiliary never qualifies and exception values do not enter source locations',async()=>{const f=fixture();f.port.attemptReplacement=async({originalAuxiliary})=>{const c=spawn(process.execPath,['-e','process.exit(1)'],{stdio:['ignore','pipe','pipe']});originalAuxiliary(c);};const r=await runCandidateRollbackBoundary(f.port,{inspectionOnly:true});assert.equal(r.phase,'FAILED_BEFORE_UP');assert.equal(r.inspectionVerified,undefined);assert.equal(r.qualificationSucceeded,false);assert.ok(r.primarySourceLocations.every(v=>v.startsWith('scripts/')&&/\.mjs:\d+:\d+$/.test(v)));});
test('unannounced original UP handle stays held even in inspection mode',async()=>{const f=fixture();f.port.attemptReplacement=async({originalUp})=>{const c=spawn(process.execPath,['-e','process.exit(0)'],{stdio:['ignore','pipe','pipe']});originalUp(c);};const r=await runCandidateRollbackBoundary(f.port,{inspectionOnly:true});assert.equal(r.phase,'HELD');assert.equal(r.originalUp.stdoutEof,true);assert.equal(r.inspectionVerified,undefined);assert.equal(f.restored,0);});
test('failure diagnostics retain only source locations, never assertion operands or messages',async()=>{const f=fixture();f.port.attemptReplacement=async()=>{const error=Error('PRIVATE_ASSERTION_OPERAND');error.stack='Error: PRIVATE_ASSERTION_OPERAND file:///SECRET.mjs:1:2\n    at f ('+new URL('../../scripts/lib/candidate-rollback-boundary.mjs',import.meta.url).href+':12:34)\n    at other (file:///outside/SECRET.mjs:1:2)';throw error;};const r=await runCandidateRollbackBoundary(f.port,{inspectionOnly:true});assert.deepEqual(r.primarySourceLocations,['scripts/lib/candidate-rollback-boundary.mjs:12:34']);assert.ok(!JSON.stringify(r).includes('PRIVATE_ASSERTION_OPERAND'));});
test('post-UP failure remains negative and restores only after same finite child and both EOFs',async()=>{
 const f=fixture();const result=await runCandidateRollbackBoundary(f.port);
 assert.equal(result.phase,'RESTORED_AFTER_FAILED_UP');assert.equal(result.qualificationSucceeded,false);assert.equal(result.primaryFailureObserved,true);assert.equal(f.restored,1);assert.equal(f.held,false);
 assert.ok(f.events.indexOf('quiet')<f.events.indexOf('restore'));assert.ok(f.events.indexOf('restore')<f.events.indexOf('verify'));
});
test('an open original keeps restoration pending until its actual natural closure',async()=>{
 const f=fixture('slow-up'),pending=runCandidateRollbackBoundary(f.port);await new Promise(r=>setTimeout(r,40));assert.equal(f.restored,0);
 const result=await pending;assert.equal(result.originalUp.code,1);assert.equal(result.originalUp.stdoutEof,true);assert.equal(result.originalUp.stderrEof,true);
});
test('pre-UP rejection verifies unchanged baseline without performing a restore',async()=>{
 const f=fixture('pre-up'),result=await runCandidateRollbackBoundary(f.port);assert.equal(result.phase,'FAILED_BEFORE_UP');assert.equal(f.restored,0);assert.equal(f.held,false);
});
for(const mode of ['rollback-failure','changed-baseline'])test(mode+' stays HELD and cannot claim safe restoration',async()=>{
 const f=fixture(mode),result=await runCandidateRollbackBoundary(f.port);assert.equal(result.phase,'HELD');assert.equal(result.qualificationSucceeded,false);assert.equal(f.held,true);
});

test('changed SQLite/baseline before restore refuses mutation and retains HELD',async()=>{const f=fixture('changed-before-restore'),result=await runCandidateRollbackBoundary(f.port);assert.equal(result.phase,'HELD');assert.equal(f.restored,0);assert.equal(f.held,true);});
test('lease loss just after spawn still retains the same slow original before reporting HELD',async()=>{
 const f=fixture();let lost=false,child;const assertLease=f.port.assertLease;f.port.assertLease=()=>{if(lost)throw Error('lease-lost');assertLease();};
 f.port.attemptReplacement=async({mutationIntent,originalUp})=>{await mutationIntent();child=spawn(process.execPath,['-e','setTimeout(()=>process.exit(1),170)'],{stdio:['ignore','pipe','pipe']});lost=true;originalUp(child);};
 const pending=runCandidateRollbackBoundary(f.port);await new Promise(r=>setTimeout(r,35));assert.equal(child.exitCode,null);assert.equal(f.held,false);assert.equal(f.restored,0);
 const result=await pending;assert.equal(result.phase,'HELD');assert.equal(result.originalUp.code,1);assert.equal(result.originalUp.stdoutEof,true);assert.equal(result.originalUp.stderrEof,true);assert.equal(f.restored,0);
});

for(const failed of [false,true])test('one actual UP and a separately owned auxiliary '+(failed?'failure':'success')+' keep distinct custody',async()=>{
 const f=fixture();f.port.attemptReplacement=async({mutationIntent,originalUp,originalAuxiliary})=>{
  await mutationIntent();const up=spawn(process.execPath,['-e','process.exit(0)'],{stdio:['ignore','pipe','pipe']});originalUp(up);await new Promise(r=>up.once('close',r));
  const aux=spawn(process.execPath,['-e',failed?'process.stdin.resume();process.stdin.on("end",()=>process.exit(1));':'console.log("verified")'],{stdio:['pipe','pipe','pipe']});originalAuxiliary(aux);
  if(failed)throw Error('auxiliary-setup-failed-before-stdin-end');aux.stdin.end();await new Promise(r=>aux.once('close',r));
 };
 const result=await runCandidateRollbackBoundary(f.port);assert.equal(result.originalUp.code,0);assert.equal(result.originalAuxiliaries.length,1);assert.notEqual(result.originalUp.originalPid,result.originalAuxiliaries[0].originalPid);
 assert.equal(result.phase,failed?'RESTORED_AFTER_FAILED_UP':'CANDIDATE_VERIFIED');assert.equal(result.originalAuxiliaries[0].code,failed?1:0);assert.equal(result.originalAuxiliaries[0].stdoutEof,true);assert.equal(result.originalAuxiliaries[0].stderrEof,true);
});

test('memory lost during the preparation hook is sampled afterward and forbids UP',async()=>{
 let available=3*1024**3,started=0,persisted;await assert.rejects((async()=>{await prepareCandidateUpMemory({prepare:async()=>{available=1024**3;},observe:()=>({platform:'win32',availableBytes:available,observedAt:new Date().toISOString()}),profile:'preserve-v3',persist:value=>{persisted=structuredClone(value);}});started++;})(),/LOCAL_QA_HOST_MEMORY_FLOOR_REFUSED/);assert.equal(started,0);assert.equal(persisted.availableBytes,1024**3);
});
test('final sample persistence failure cannot reach the original UP marker',async()=>{for(const persist of [()=>{throw Error('durability-failed');},()=>Promise.resolve()]){let marked=false;await assert.rejects((async()=>{await prepareCandidateUpMemory({prepare:async()=>{},observe:()=>({platform:'win32',availableBytes:3*1024**3,observedAt:new Date().toISOString()}),profile:'preserve-v3',persist});marked=true;})());assert.equal(marked,false);}});

for(const mode of ['signal','stream-fault','finite-failure'])test('Inquiry auxiliary '+mode+' uses the original restoration boundary',async()=>{
 const f=fixture();
 f.port.attemptReplacement=async({mutationIntent,originalUp,originalAuxiliary})=>{
  await mutationIntent();const first=spawn(process.execPath,['-e','process.exit(0)'],{stdio:['ignore','pipe','pipe']});originalUp(first);await new Promise(r=>first.once('close',r));
  const inquiry=spawn(process.execPath,['-e',mode==='signal'?'setTimeout(()=>process.exit(1),10000)':'setTimeout(()=>process.exit(1),40)'],{stdio:['ignore','pipe','pipe']});originalAuxiliary(inquiry);
  if(mode==='signal')inquiry.once('spawn',()=>inquiry.kill('SIGTERM'));
  if(mode==='stream-fault')inquiry.stdout.emit('error',new Error('unit-observation-fault'));
  await new Promise(r=>inquiry.once('close',r));throw Error('inquiry-transition-failed');
 };
 const result=await runCandidateRollbackBoundary(f.port);
 assert.equal(result.phase,mode==='finite-failure'?'RESTORED_AFTER_FAILED_UP':'HELD');
 assert.equal(f.restored,mode==='finite-failure'?1:0);assert.equal(result.qualificationSucceeded,false);
 assert.equal(result.originalAuxiliaries.length,1);
});
