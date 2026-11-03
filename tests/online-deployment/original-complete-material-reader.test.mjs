/** Real finite worker protocol; modeled domain payload, never native acceptance. */
import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {retainOriginalCompleteWorker} from '../../scripts/lib/original-complete-counterpart.mjs';
import {captureOriginalCompleteApplication} from '../../scripts/lib/original-complete-material-reader.mjs';
const operation='a'.repeat(32),session='b'.repeat(64),file='/app/runtime-authority/application-native-'+operation+'/restored-complete-app/coherent-private/coherent-application-artifacts.json',raw=Buffer.from('{"componentOnly":true}\n'),sha=b=>createHash('sha256').update(b).digest('hex');
async function worker(){
 const frames=[{format:'sabalan-original-active-restored-qa-hr-request/v1',session,sequence:1,event:'HR_REQUEST',proof:{},manifest:{},businessDataProof:{},inquiryBusinessProof:{},targetDatabase:{name:'modeled'},intendedOwner:{releaseId:'modeled-only'}},{format:'sabalan-original-active-restored-qa-hr-drained/v1',session,sequence:2,event:'CALLBACK_DRAINED'},{format:'sabalan-original-active-restored-qa-result/v1',session,sequence:3,event:'RESTORE_RESULT',result:{privateQa:{value:{coherentQualification:{format:'sabalan-live-restored-application-reference/v1',file,sha256:sha(raw),bytes:raw.length}}}}}];
 const code="const f="+JSON.stringify(frames)+";let n=0;require('readline').createInterface({input:process.stdin}).on('line',()=>console.log(JSON.stringify(f[n++===0?0:1])));process.stdin.on('end',()=>console.log(JSON.stringify(f[2])));";
 return retainOriginalCompleteWorker({command:{executable:process.execPath,argv:['-e',code],environment:process.env},session,initial:Buffer.from('{}'),onRequest:async()=>Buffer.from('component-certificate')});
}
test('artifact reader consumes only the same genuine closed worker third-frame ref',async()=>{
 const token=await worker();let reads=0;const readOriginalApplication=async()=>{reads++;return Buffer.from(raw);};
 assert.ok((await captureOriginalCompleteApplication({workerCompletion:token,operation,readOriginalApplication,assertActive:()=>{}})).equals(raw));assert.equal(reads,1);
 await assert.rejects(captureOriginalCompleteApplication({workerCompletion:{},operation,readOriginalApplication,assertActive:()=>{}}),/ORIGINAL_COMPLETE_WORKER_REQUIRED/);assert.equal(reads,1);
 await assert.rejects(captureOriginalCompleteApplication({workerCompletion:token,operation:'c'.repeat(32),readOriginalApplication,assertActive:()=>{}}),/APPLICATION_PATH/);assert.equal(reads,1);
 await assert.rejects(captureOriginalCompleteApplication({workerCompletion:token,operation,readOriginalApplication:async()=>Buffer.from('changed'),assertActive:()=>{}}),/APPLICATION_BYTES/);
});
