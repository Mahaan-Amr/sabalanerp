import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn}from'node:child_process';
import {validateLocalQaPressure,createLocalQaPressureOwner,drainLocalQaPressureObserver,validateLocalDevFrontendMemory}from'../../scripts/lib/local-qa-memory-pressure.mjs';

test('pressure fault inspection preserves the allowlisted refusal separately from assertion code',async()=>{
 let value={...frame(),lowMemory:true};const owner=createLocalQaPressureOwner({observe:()=>structuredClone(value),persist(){}});
 await assert.rejects(owner.sample('actual-low-memory-boundary'),/QA_MEMORY_PRESSURE_REFUSED/);
 assert.equal(owner.inspect().fault,'QA_MEMORY_PRESSURE_REFUSED');assert.equal(owner.inspect().faultCode,'ERR_ASSERTION');
 value={...frame(),lowMemory:false};await owner.sample('later-observation',false);
 assert.throws(()=>owner.assertAdmission(),/QA_MEMORY_PRESSURE_REFUSED/);
 assert.equal(owner.inspect().fault,'QA_MEMORY_PRESSURE_REFUSED');
 let incarnation=frame();const changed=createLocalQaPressureOwner({observe:()=>structuredClone(incarnation),persist(){}});
 await changed.sample('original-probe');incarnation.vm.probeContainerId='b'.repeat(64);
 await assert.rejects(changed.sample('changed-probe'),/QA_PRESSURE_PROBE_CONTAINER_CHANGED/);
 assert.equal(changed.inspect().fault,'QA_PRESSURE_PROBE_CONTAINER_CHANGED');assert.equal(changed.inspect().faultCode,'ERR_ASSERTION');
 const unknown=createLocalQaPressureOwner({observe:frame,persist(){throw Object.assign(new Error('QA_UNREVIEWED_REASON'),{code:'ERR_ASSERTION'});}});
 await assert.rejects(unknown.sample('unreviewed'));assert.equal(unknown.inspect().fault,'ERR_ASSERTION');
 const nonString=createLocalQaPressureOwner({observe:frame,persist(){throw{code:'EIO',message:42};}});
 await assert.rejects(nonString.sample('non-string'));assert.equal(nonString.inspect().fault,'EIO');
});
import {runCandidateRollbackBoundary}from'../../scripts/lib/candidate-rollback-boundary.mjs';
const frame=()=>({format:'sabalan-local-qa-pressure/v1',platform:'win32',observedAt:new Date().toISOString(),availableBytes:256*1024**2,commitTotalBytes:8*1024**3,commitLimitBytes:16*1024**3,lowMemory:false,vm:{probeContainerId:'a'.repeat(64),bootId:'11111111-1111-1111-1111-111111111111',fullAvg10:0,someAvg10:0,oomKills:0},probe:{durationMs:50,children:[{originalPid:100,code:0,stdoutEof:true,stderrEof:true},{originalPid:101,code:0,stdoutEof:true,stderrEof:true}]}});
test('healthy system pressure can admit below old2GiB, without cache/swap credit',()=>{assert.equal(validateLocalQaPressure(frame()).availableBytes,256*1024**2);});
test('OS low-memory, commit exhaustion and VM thrashing refuse independently',()=>{
 for(const edit of[v=>v.lowMemory=true,v=>v.commitTotalBytes=Math.floor(v.commitLimitBytes*.95),v=>v.vm.fullAvg10=6,v=>v.vm.someAvg10=21]){const v=frame();edit(v);assert.throws(()=>validateLocalQaPressure(v),/QA_MEMORY_PRESSURE_REFUSED/);}
});
test('stale/malformed/unclosed/late observer never becomes an admission',()=>{
 for(const edit of[v=>v.observedAt=new Date(Date.now()-5001).toISOString(),v=>v.probe.children[1].stdoutEof=false,v=>v.probe.children[0].code=137,v=>v.probe.durationMs=2501,v=>v.commitLimitBytes=0,v=>v.cacheCredit=1]){const v=frame();edit(v);assert.throws(()=>validateLocalQaPressure(v));}
});
test('VM incarnation/OOM events latch even if next sample looks healthy',async()=>{
 for(const edit of[v=>v.vm.oomKills++,v=>v.vm.bootId='22222222-2222-2222-2222-222222222222',v=>v.vm.probeContainerId='b'.repeat(64)]){
  let v=frame();const owner=createLocalQaPressureOwner({observe:()=>structuredClone(v),persist(){}});await owner.sample('first');edit(v);await assert.rejects(owner.sample('changed'));v=frame();assert.throws(()=>owner.assertAdmission());
 }
});
function originalChild(exitCode=0){
 const child=spawn(process.execPath,['-e',`process.stdout.write('ready\\n');process.stdin.resume();process.stdin.once('data',()=>process.exit(${exitCode}));`],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 const ready=new Promise(resolve=>child.stdout.once('data',resolve));const closed=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded})));
 child.stdout.resume();child.stderr.resume();return {child,ready,closed};
}
test('alarm never races a still-open original; one lane drains before recovery',async()=>{
 let v=frame(),tick;const rows=[],owner=createLocalQaPressureOwner({observe:()=>structuredClone(v),persist:r=>rows.push(r),setTimer:fn=>{tick=fn;return 1;},clearTimer(){}});
 const c=originalChild();let settled=false;const work=owner.run('LOCAL',async()=>{await c.ready;return c.closed;});const observed=work.then(()=>{settled=true;},()=>{settled=true;});
 try{await c.ready;await assert.rejects(owner.run('parallel',async()=>{}),/QA_HEAVY_WORK_ALREADY_ACTIVE/);v.lowMemory=true;tick();await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.throws(()=>owner.enterRecovery(),/QA_WORK_NOT_DRAINED/);c.child.stdin.end('finish');await assert.rejects(work,/QA_MEMORY_PRESSURE_REFUSED/);await observed;assert.equal((await c.closed).stdoutEof,true);owner.enterRecovery();assert.equal((await owner.sample('restore',false)).lowMemory,true);assert.throws(()=>owner.assertAdmission(),/QA_RECOVERY_NOT_ADMISSION/);assert.ok(rows.some(r=>r.observation.lowMemory));}
 finally{if(c.child.exitCode===null&&c.child.signalCode===null)c.child.stdin.end('finish');await c.closed;}
});
test('low-memory refusal before UP verifies baseline and never creates a child',async()=>{
 let v=frame(),up=false,recovered=false;v.lowMemory=true;const owner=createLocalQaPressureOwner({observe:()=>v,persist(){}}),baseline={samePrivateBaseline:true};
 const p={assertLease(){},captureBaseline:async()=>baseline,revalidateBaseline:async()=>{await owner.sample('pre-up');return owner.assertAdmission();},attemptReplacement:async()=>{up=true;},assertQuiet(){},restoreBaseline(){throw Error('NO_MUTATION_NO_RESTORE');},verifyBaseline:async b=>{assert.equal(b,baseline);assert.equal(recovered,true);},persist(){},persistIntent(){throw Error('NO_UP');},verifyCandidate(){throw Error('NO_CANDIDATE');},hold(){throw Error('UNEXPECTED_HOLD');},beginRecovery(){owner.enterRecovery();recovered=true;}};
 const r=await runCandidateRollbackBoundary(p);assert.equal(r.phase,'FAILED_BEFORE_UP');assert.equal(up,false);assert.equal(r.mutationIntent,false);
});
test('real closed failed UP restores only private configuration, data bytes preserved despite pressure',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-pressure-')),configuration=path.join(dir,'config'),data=path.join(dir,'business-data');fs.writeFileSync(configuration,'baseline');const original=Buffer.from('protected original data');fs.writeFileSync(data,original);
 let v=frame(),tick,recovering=false,c;const owner=createLocalQaPressureOwner({observe:()=>structuredClone(v),persist(){},setTimer:fn=>{tick=fn;return 1;},clearTimer(){}});
 const p={assertLease(){},captureBaseline:async()=>({config:'baseline'}),revalidateBaseline:async(_,stage)=>{if(stage==='BEFORE_RESTORE')assert.equal(recovering,true);else{await owner.sample('pre-up');owner.assertAdmission();}},
  attemptReplacement:async h=>owner.run('UP',async()=>{await h.mutationIntent();fs.writeFileSync(configuration,'candidate');c=originalChild(137);h.originalUp(c.child);await c.ready;v.lowMemory=true;tick();c.child.stdin.end('finish');await c.closed;}),
  assertQuiet(){assert.ok(!c||c.child.exitCode!==null);},beginRecovery(){owner.enterRecovery();recovering=true;},restoreBaseline:async b=>{assert.equal(recovering,true);assert.equal((await owner.sample('restore',false)).lowMemory,true);fs.writeFileSync(configuration,b.config);},verifyBaseline:async()=>{assert.equal(fs.readFileSync(configuration,'utf8'),'baseline');assert.deepEqual(fs.readFileSync(data),original);},verifyCandidate(){throw Error('NO_POSITIVE_ADMISSION');},persist(){},persistIntent(){},hold(){throw Error('UNEXPECTED_HOLD');}};
 try{const r=await runCandidateRollbackBoundary(p);assert.equal(r.phase,'RESTORED_AFTER_FAILED_UP');assert.equal(r.qualificationSucceeded,false);assert.equal(r.originalUp.code,137);assert.equal(r.originalUp.stdoutEof,true);assert.equal(r.originalUp.stderrEof,true);}
 finally{if(c&&c.child.exitCode===null&&c.child.signalCode===null)c.child.stdin.end('finish');if(c)await c.closed;assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true});}
});
test('signalled original stays HELD; telemetry persistence failure never becomes PASS',async()=>{
 const owner=createLocalQaPressureOwner({observe:frame,persist(){throw Error('PERSIST_FAILED');}});await assert.rejects(owner.run('UP',async()=>{}),/PERSIST_FAILED/);
 let c,held=false,restored=false;const p={assertLease(){},captureBaseline:async()=>({}),revalidateBaseline(){},attemptReplacement:async h=>{await h.mutationIntent();c=originalChild();h.originalUp(c.child);await c.ready;c.child.kill('SIGTERM');await c.closed;throw Error('ORIGINAL_INTERRUPTED');},assertQuiet(){},restoreBaseline(){restored=true;},verifyBaseline(){},verifyCandidate(){},persist(){},persistIntent(){},hold(){held=true;}};
 const r=await runCandidateRollbackBoundary(p);assert.equal(r.phase,'HELD');assert.equal(held,true);assert.equal(restored,false);assert.equal(r.qualificationSucceeded,false);
});

test('overflow drains the actual observer naturally; no timeout or automatic signal',async()=>{
 const child=spawn(process.execPath,['-e',"process.stdout.write('x'.repeat(70000));process.stdin.resume();process.stdin.once('data',()=>process.exit(0));"],{stdio:['pipe','pipe','pipe'],windowsHide:true});let closed=false,receipt;
 const outcome=drainLocalQaPressureObserver(child,{onClosed:(_,row)=>{receipt=row;closed=true;}});const check=assert.rejects(outcome,/QA_PRESSURE_OBSERVER_FAILED/);
 await new Promise(resolve=>child.stdout.once('data',resolve));assert.equal(closed,false);assert.equal(child.killed,false);child.stdin.end('finish');await check;assert.equal(receipt.code,0);assert.equal(receipt.signal,null);assert.equal(receipt.stdoutEof,true);assert.equal(receipt.stderrEof,true);
});
test('known OOM latches admission but observation remains available for private recovery',async()=>{
 let value=frame();const p=createLocalQaPressureOwner({observe:()=>structuredClone(value),persist(){}});await p.sample('before');value.vm.oomKills++;await assert.rejects(p.sample('oom'),/QA_VM_OOM_OBSERVED/);p.enterRecovery();assert.equal((await p.sample('restore',false)).vm.oomKills,1);assert.throws(()=>p.assertAdmission());
});

import {validateQaHostMemoryObservation}from'../../scripts/lib/application-native-qa-memory.mjs';
import {admitOriginalRoleMemoryRequest}from'../../scripts/lib/application-native-role-coordinator.mjs';
test('historical memory schema cannot accept replacement pressure frames without explicit policy selection',()=>{
 assert.throws(()=>validateQaHostMemoryObservation(frame(),'preserve-v3'));validateQaHostMemoryObservation(frame(),'preserve-v3',Date.now(),{memoryPolicy:'local-qa-pressure-v1'});assert.throws(()=>validateQaHostMemoryObservation(frame(),'preserve-v3',Date.now(),{memoryPolicy:'other'}));
});
test('next actual role request is refused while authenticated drain and restoration stay available',()=>{
 const denied=[],port={assertAdmission(){throw Error('QA_MEMORY_PRESSURE_REFUSED');},refuse:row=>denied.push(row)};
 assert.equal(admitOriginalRoleMemoryRequest({command:'START_PRIVATE_CHROME',requestId:'a'.repeat(64)},port),false);assert.equal(denied[0].failedEvent,'PRIVATE_CHROME_READY');assert.equal(denied[0].noWorkStarted,true);assert.equal(denied[0].actorId,null);assert.equal(denied[0].resources,undefined);
 for(const command of ['FINISH_PRIVATE_HTTP','WAIT_CHROME_CLOSED','PREPARE_PRIVATE_JOBS','RESTORE_PRIVATE_RETAINED_UI'])assert.equal(admitOriginalRoleMemoryRequest({command},port),true);assert.equal(denied.length,1);
});
test('sampling gaps latch and forbid another admission',async()=>{
 let time=Date.now(),v=frame(),tick;v.observedAt=new Date(time).toISOString();const p=createLocalQaPressureOwner({observe:()=>structuredClone(v),persist(){},now:()=>time,setTimer:fn=>{tick=fn;},clearTimer(){}});
 await assert.rejects(p.run('work',async()=>{time+=5000;v.observedAt=new Date(time).toISOString();tick();await new Promise(r=>setImmediate(r));}),/QA_PRESSURE_SAMPLE_GAP/);assert.throws(()=>p.assertAdmission(),/QA_PRESSURE_SAMPLE_GAP/);
});

test('healthy new phase after idle establishes a new sampling window',async()=>{
 let time=Date.now();const p=createLocalQaPressureOwner({observe:()=>({...frame(),observedAt:new Date(time).toISOString()}),now:()=>time,persist(){},setTimer(){},clearTimer(){}});await p.run('first',async()=>{});time+=60000;assert.equal(await p.run('next',async()=>42),42);
});
test('last outstanding observer fault is drained and cannot return work success',async()=>{
 let calls=0,tick,finish;const pending=new Promise(resolve=>{finish=resolve;}),p=createLocalQaPressureOwner({observe:async()=>{calls++;if(calls===2){await pending;return{...frame(),lowMemory:true};}return frame();},persist(){},setTimer:fn=>{tick=fn;return 1;},clearTimer(){}});
 const work=p.run('late-fault',async()=>{tick();await new Promise(r=>setImmediate(r));finish();return 'not accepted';});await assert.rejects(work,/QA_MEMORY_PRESSURE_REFUSED/);assert.equal(p.inspect().active,false);
});

import {validateRetainedBrowserCapacity,runOriginalRetainedBrowserQualificationRounds}from'../../scripts/lib/original-retained-browser-qualification.mjs';
test('selected retained browser uses pressure while cgroup/OOM and Linux reserve remain mandatory',()=>{
 const M=1024**2,v={stage:'BEFORE_SLOT_MUTATION',hostPressure:frame(),hostFree:256*M,linuxMemAvailable:1536*M,cgroups:{'backend-candidate':{maximum:1536*M,current:1152*M,events:{}},'frontend-retained':{maximum:512*M,current:256*M,events:{}},'frontend-candidate':{maximum:512*M,current:256*M,events:{}}}},selected={memoryPolicy:'local-qa-pressure-v1'};
 validateRetainedBrowserCapacity(v,null,selected);assert.throws(()=>validateRetainedBrowserCapacity(v));for(const change of [v=>v.hostPressure.lowMemory=true,v=>v.linuxMemAvailable--,v=>v.cgroups['backend-candidate'].events.oom_kill=1,v=>v.cgroups['frontend-candidate'].current++]){const bad=structuredClone(v);change(bad);assert.throws(()=>validateRetainedBrowserCapacity(bad,null,selected));}
});

test('retained-browser selection rejects fabricated or JSON owners before plan IO or policy callbacks',async()=>{
 for(const nativeOwner of [null,{},JSON.parse('{"operation":"fake"}'),{assertHeld(){throw Error('NOT_A_REAL_OWNER');},observeLocalMemoryPressure(){throw Error('CALLBACK_MUST_NOT_RUN');}}])await assert.rejects(runOriginalRetainedBrowserQualificationRounds({nativeOwner,planFile:'MUST_NOT_READ',planSha256:'invalid'}),/ORIGINAL_NATIVE_ROLLBACK_OWNER_REQUIRED/);
});

test('lifecycle memory frames keep Windows/VM/cgroup scopes separate and label stopped frontend unavailable',()=>{
 const cg={stat:{anon:123,file:456},includesMeasurementProbe:true},windows={availableBytes:22,commitTotalBytes:33,commitLimitBytes:99,lowMemory:false},guest={bootId:'11111111-1111-1111-1111-111111111111',vmBytes:Object.fromEntries(['MemTotal','MemAvailable','AnonPages','Cached','Buffers','Shmem','SReclaimable','SwapTotal','SwapFree','SwapCached'].map(k=>[k,1024])),cgroup:cg};
 const value={format:'sabalan-local-dev-frontend-memory/v1',durationMs:40,windowsBefore:windows,windowsAfter:windows,frontend:{id:'a'.repeat(64),running:true,pid:2},probeService:'frontend',probeContainerId:'a'.repeat(64),guest,frontendCgroup:cg,memoryFreedClaimed:false,productionAdmission:false,originalChildren:[1,2,3,4].map(originalPid=>({originalPid,code:0,stdoutEof:true,stderrEof:true}))};validateLocalDevFrontendMemory(value);
 const stopped={...value,frontend:{...value.frontend,running:false,pid:0},probeService:'backend-candidate',probeContainerId:'b'.repeat(64),frontendCgroup:null};validateLocalDevFrontendMemory(stopped);
 for(const change of [v=>v.guest.vmBytes.AnonPages=null,v=>v.guest.cgroup.stat.anon=NaN,v=>v.durationMs=15001,v=>v.originalChildren[0].stderrEof=false,v=>v.frontendCgroup=cg,v=>v.memoryFreedClaimed=true]){const v=structuredClone(stopped);change(v);assert.throws(()=>validateLocalDevFrontendMemory(v));}
});

import vm from 'node:vm';import {stabilizeQaHostMemory}from'../../scripts/lib/application-native-qa-memory.mjs';
test('passive post-stop stabilization waits for two good pressure samples and never clears an OOM latch',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/lib/original-candidate-rollback-owner.mjs',import.meta.url),'utf8'),method=source.split('\n').find(line=>line.includes('async suspendDevelopmentFrontend(evidence){')).replace("await import('../run-local-dev-frontend-suspension.mjs')",'lifecycle');
 for(const oom of [false,true]){let time=Date.now(),calls=0;const saved=[],pressure=createLocalQaPressureOwner({observe:()=>{const value=frame();value.observedAt=new Date(time).toISOString();value.lowMemory=++calls<=2;if(oom&&calls>=2)value.vm.oomKills=1;return value;},persist(){},now:()=>time});
  const context={assert,owner:{assertPreparingCurrent(){}},guard(){},lifecycle:{suspendOriginalLocalDevFrontend:async()=>({file:'modeled-stop-only'})},pressure,localQaPressurePolicy:{version:'local-qa-pressure-v1'},save:(name,value)=>saved.push({name,value}),stabilizeQaHostMemory:options=>stabilizeQaHostMemory({...options,now:()=>time},'preserve-v3',{memoryPolicy:'local-qa-pressure-v1'}),setTimeout:fn=>{time+=2000;fn();}};
  const run=vm.compileFunction('return ({'+method+'}).suspendDevelopmentFrontend;',Object.keys(context))(...Object.values(context));if(oom){await assert.rejects(run({}),/QA_VM_OOM_OBSERVED/);assert.ok(!saved.some(row=>row.name==='post-stop-host-memory-passed.json'));}else{await run({});assert.equal(calls,4);assert.equal(pressure.inspect().fault,null);assert.ok(saved.some(row=>row.name==='post-stop-host-memory-passed.json'));}
 }
});

// Projection of actual f282/retained-browser frames142..150. Timestamps and
// pressure flags are measured; identities below are isolated fixture values.
test('continuous measured low-memory frames preserve primary refusal instead of manufacturing a gap',async()=>{
 const trace=[['2026-11-01T16:33:55.542719Z',false],['2026-11-01T16:33:57.547066Z',true],['2026-11-01T16:33:59.555062Z',true],['2026-11-01T16:34:01.542278Z',false],['2026-11-01T16:34:03.545476Z',true],['2026-11-01T16:34:05.544640Z',true],['2026-11-01T16:34:07.559539Z',true],['2026-11-01T16:34:09.573083Z',true],['2026-11-01T16:34:11.586734Z',false]];
 let current=0,primary;const observed=[],rows=[],p=createLocalQaPressureOwner({observe:()=>({...frame(),observedAt:trace[current][0],lowMemory:trace[current][1]}),now:()=>Date.parse(trace[current][0]),persist:row=>rows.push(row),onValidated:v=>observed.push(v),setTimer:()=>1,clearTimer(){}});
 await assert.rejects(p.run('retained-browser',async()=>{for(current=1;current<trace.length;current++){try{await p.sample('retained-browser');assert.fail('latched refusal must stay negative');}catch(error){primary??=error;assert.equal(error,primary,'later continuity processing must preserve the first actual pressure failure');}}current--;}),error=>error===primary);
 assert.match(primary.message,/QA_MEMORY_PRESSURE_REFUSED/);assert.equal(rows.length,trace.length);assert.equal(observed.length,trace.length,'closed structurally valid observations retain continuity even when admission is refused');assert.throws(()=>p.assertAdmission(),error=>error===primary);
});
