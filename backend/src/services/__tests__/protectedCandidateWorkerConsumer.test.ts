import {test} from 'node:test';
import assert from 'node:assert/strict';
import {consumeCandidateWorker,negativeCandidateExercise} from './protectedCandidateWorkerConsumer';
import {runProtectedTemporaryDatabase,type ChildRunner} from './protectedTemporaryDatabase';

test('closed worker reports its real exit status',async()=>{
 const ok=await consumeCandidateWorker(process.execPath,['-e','process.stdout.write("ok")']);
 assert.equal(ok.state,'SUCCESS');
 const failed=await consumeCandidateWorker(process.execPath,['-e','process.exitCode=7']);
 assert.equal(failed.state,'FAILURE');
 if(failed.state==='FAILURE')assert.equal(failed.status,7);
});
test('worker unknown marker and excessive output are unknown',async()=>{
 const marker=await consumeCandidateWorker(process.execPath,['-e','process.stderr.write("CANDIDATE_CLI_WORKER_OUTCOME_UNKNOWN")']);
 assert.equal(marker.state,'UNKNOWN');
 const overflow=await consumeCandidateWorker(process.execPath,['-e','process.stdout.write("x".repeat(1100000))']);
 assert.equal(overflow.state,'UNKNOWN');
});
test('failed launch is unknown',async()=>{
 assert.equal((await consumeCandidateWorker('nonexistent-protected-worker-7f3',[])).state,'UNKNOWN');
});
test('the native stage allowance accepts ten minutes but refuses a longer deadline',async()=>{
 assert.equal((await consumeCandidateWorker(process.execPath,['-e',''],undefined,600000)).state,'SUCCESS');
 assert.equal((await consumeCandidateWorker(process.execPath,['-e',''],undefined,600001)).state,'UNKNOWN');
});
test('lifecycle keeps database on unknown worker or changed snapshot',async()=>{
 for(const mode of ['unknown','changed','expected'] as const){
  let dropped=0,reads=0;
  const runner:ChildRunner={
   async create(){return {state:'SUCCESS',value:undefined};},async identity(){return {state:'SUCCESS',value:'1:2'};},
   async setup(){return {state:'SUCCESS',value:'SUCCESS'};},async census(){return {state:'SUCCESS',value:{sessions:0,prepared:0}};},
   async drop(){dropped++;return {state:'SUCCESS',value:undefined};},
  };
  const exercise=negativeCandidateExercise(async()=>mode==='unknown'?{state:'UNKNOWN'}:{state:'FAILURE',status:1,stdout:'',stderr:JSON.stringify({ok:false,code:'CANDIDATE_SOURCE_PROJECTION_UNPROVEN'})},
   async()=>({state:'SUCCESS',value:mode==='changed'&&++reads===2?'changed':'same'}),'CANDIDATE_SOURCE_PROJECTION_UNPROVEN');
  const result=await runProtectedTemporaryDatabase(runner,exercise);
  assert.equal(result.state,mode==='expected'?'CLEANED':'UNKNOWN');assert.equal(dropped,mode==='expected'?1:0);
 }
});
