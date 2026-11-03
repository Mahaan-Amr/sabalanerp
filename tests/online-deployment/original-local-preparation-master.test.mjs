import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

async function run(mode){
 const child=spawn(process.execPath,[new URL('./original-local-preparation-master.fixture.mjs',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),mode],{stdio:['pipe','pipe','pipe','ipc'],windowsHide:true});
 let stdout='',stderr='',released=false,late=false;
 child.stdout.on('data',raw=>{stdout+=raw;assert.ok(stdout.length<262144);if(mode==='queue-arrival'&&!late&&stdout.includes('"fixtureFinalizedWaitingForLateRequest":true')){late=true;child.stdin.write(JSON.stringify({command:'RUN_COMPLETE',sequence:4})+'\n');}if(mode!=='known'&&!released&&stdout.includes('"fixtureHeld":true')){released=true;child.send({fixtureOnlyRelease:'owned-unit-chain'});}});
 child.stderr.on('data',raw=>{stderr+=raw;assert.ok(stderr.length<262144);});child.stdin.on('error',()=>{});
 for(const[sequence,request]of [[1,{command:'PREPARE_LOCAL_RUNTIME',nativeOwnerElfReceipt:'fixture'}],[2,{command:'PREPARE_COMPLETE',configurationFile:'fixture',configurationSha256:'a'.repeat(64)}],[3,{command:'RUN_LOCAL',candidateReplacementReceipt:null}]]){
  // The actual bound candidate path is obtained from the fixture child below.
  if(sequence===3)break;child.stdin.write(JSON.stringify({...request,sequence})+'\n');
 }
 return await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal,stdout,stderr,released,late,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded}));
  child.on('message',message=>{if(message?.fixtureCandidateSelection)child.stdin.write(JSON.stringify({command:'RUN_LOCAL',sequence:3,candidateReplacementReceipt:message.fixtureCandidateSelection})+'\n');});
 });
}
test('same actual master/Root raw-preparation negative restores canonically and releases its real private lease/input naturally',async()=>{
 const r=await run('known');assert.equal(r.code,1,r.stderr);assert.equal(r.signal,null);assert.equal(r.released,false);assert.ok(r.stdoutEof&&r.stderrEof);assert.match(r.stdout,/original-master-local-preparation-negative-closed/);assert.match(r.stdout,/"fixtureNormalNegative":true/);assert.match(r.stdout,/"samplerActuallyDrained":true/);assert.match(r.stdout,/"privateLeaseClosed":true/);assert.match(r.stdout,/"qualificationAccepted":false/);
});
for(const mode of ['queue-arrival','inquiry-return-fault','backend-return-fault'])test(mode+' never releases the actual modeled Root or grants a successful milestone',async()=>{
 const r=await run(mode);assert.equal(r.code,77,r.stderr);assert.equal(r.signal,null);assert.equal(r.released,true);assert.ok(r.stdoutEof&&r.stderrEof);assert.doesNotMatch(r.stdout,/"fixtureNormalNegative":true/);assert.match(r.stdout,/"normalRootRelease":false/);if(mode==='queue-arrival'){assert.equal(r.late,true);assert.doesNotMatch(r.stdout,/original-master-local-preparation-negative-closed/);}
});
