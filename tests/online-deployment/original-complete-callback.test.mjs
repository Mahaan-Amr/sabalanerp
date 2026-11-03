import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {completeCallbackRequest, assertCompleteCallbackAck, assertCompleteWorkerFrames} from '../../scripts/lib/original-complete-callback.mjs';

// Modeled protocol data only: these tests never mint original-owner authority.
const sha = raw => createHash('sha256').update(raw).digest('hex');
const identity = () => ({session:'a'.repeat(64), operation:'b'.repeat(32), sourceCommit:'c'.repeat(40),
  database:{name:'restored_test',oid:'73',systemIdentifier:'12345'}});
const manifest = {format:'sabalan-recovery',packageType:'COMPLETE',components:[]};
function fixture() {
  const binding=identity(),request=completeCallbackRequest(binding,manifest);
  const ack={format:'sabalan-original-complete-callback-ack/v1',...binding,requestSha256:request.sha256,
    callbackDrained:true,productionAdmission:false};
  const frames=[{format:'sabalan-original-active-restored-qa-hr-request/v1',event:'HR_REQUEST',session:binding.session,sequence:1,
    manifest,targetDatabase:binding.database,proof:{database:binding.database,cleanupPending:true,productionAdmission:false}},
    {format:'sabalan-original-active-restored-qa-hr-drained/v1',event:'CALLBACK_DRAINED',session:binding.session,sequence:2},
    {format:'sabalan-original-active-restored-qa-result/v1',event:'RESTORE_RESULT',session:binding.session,sequence:3,
      result:{format:'sabalan-strict-local-complete-validation/v1',strictCompleteValidationSucceeded:true,
        databaseAbsent:true,baseClientFinallyDisconnected:true,financialSchemaQualified:false,productionAdmission:false,
        absence:{visible:true,name:binding.database.name,oid:null,systemIdentifier:binding.database.systemIdentifier,sessions:0,transactions:0,prepared:0}}}];
  return {binding,request,ack,frames,raw:()=>Buffer.from(frames.map(f=>JSON.stringify(f)+'\n').join(''))};
}
test('fixed request and ACK bind the exact session, operation, source, database and manifest bytes',()=>{
  const f=fixture();assert.equal(f.request.sha256,sha(f.request.raw));assert.doesNotThrow(()=>assertCompleteCallbackAck(f.ack,f.request));
  for(const mutate of [v=>v.operation='d'.repeat(32),v=>v.session='d'.repeat(64),v=>v.sourceCommit='d'.repeat(40),
    v=>v.database.oid='74',v=>v.database.systemIdentifier='6789',v=>v.requestSha256='0'.repeat(64),
    v=>v.callbackDrained=false,v=>v.productionAdmission=true,v=>v.extra=true]) {
    const bad=structuredClone(f.ack);mutate(bad);assert.throws(()=>assertCompleteCallbackAck(bad,f.request));
  }
});
test('strict worker frames preserve their original bytes and require actual cleanup/disconnection facts',()=>{
  const f=fixture(),raw=f.raw(),before=Buffer.from(raw),result=assertCompleteWorkerFrames(raw,f.request);
  assert.equal(result.workerStdoutSha256,sha(raw));assert.deepEqual(raw,before);
  assert.equal(result.result.databaseAbsent,true);
  for(const mutate of [v=>v[0].session='f'.repeat(64),v=>v[0].targetDatabase.oid='74',v=>v[0].manifest.components.push({}),
    v=>v[1].event='UNKNOWN',v=>v[1].sequence=1,v=>v[2].result.databaseAbsent=false,
    v=>v[2].result.baseClientFinallyDisconnected=false,v=>v[2].result.absence.sessions=1,
    v=>v[2].result.absence.prepared=1,v=>v[2].result.absence.transactions=1,v=>v[2].result.absence.oid='73']) {
    const g=fixture();mutate(g.frames);assert.throws(()=>assertCompleteWorkerFrames(g.raw(),g.request));
  }
  assert.throws(()=>assertCompleteWorkerFrames(Buffer.concat([raw,Buffer.from('{}\n')]),f.request));
  assert.throws(()=>assertCompleteWorkerFrames(raw.subarray(0,raw.length-1),f.request));
});
