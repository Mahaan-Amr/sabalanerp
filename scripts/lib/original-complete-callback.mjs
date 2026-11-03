/** Data-only protocol checks for ticket09. These functions never authenticate
 * a process, create a completion token, sign evidence or grant admission. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const encode=value=>Buffer.from(JSON.stringify(canonical(value))+'\n');
const exact=(value,keys)=>assert.deepEqual(Object.keys(value).sort(),keys.slice().sort());
const MAXIMUM=8*1024*1024;
function identity(value) {
  exact(value,['session','operation','sourceCommit','database']);
  assert.match(value.session,/^[a-f0-9]{64}$/);assert.match(value.operation,/^[a-f0-9]{32}$/);
  assert.match(value.sourceCommit,/^[a-f0-9]{40}$/);
  exact(value.database,['name','oid','systemIdentifier']);
  assert.match(value.database.name,/^[A-Za-z0-9_]{1,63}$/);
  for(const key of ['oid','systemIdentifier'])assert.match(value.database[key],/^[1-9][0-9]*$/);
}
/** Own a serialized copy before any async host exchange can change input. */
export function completeCallbackRequest(binding,manifest) {
  identity(binding);
  assert.equal(manifest.format,'sabalan-recovery');assert.equal(manifest.packageType,'COMPLETE');
  const manifestRaw=Buffer.from(JSON.stringify(manifest));assert.ok(manifestRaw.length<=MAXIMUM);
  const request={format:'sabalan-original-complete-callback-request/v1',...structuredClone(binding),
    manifestSha256:sha(manifestRaw),productionAdmission:false};
  const raw=encode(request);
  return {raw,sha256:sha(raw),manifestRaw,request};
}
function requestValue(descriptor) {
  assert.ok(Buffer.isBuffer(descriptor.raw)&&descriptor.raw.length>0&&descriptor.raw.length<=65536);
  assert.equal(sha(descriptor.raw),descriptor.sha256);
  const request=JSON.parse(descriptor.raw);
  assert.deepEqual(encode(request),descriptor.raw);
  exact(request,['format','session','operation','sourceCommit','database','manifestSha256','productionAdmission']);
  identity(Object.fromEntries(['session','operation','sourceCommit','database'].map(key=>[key,request[key]])));
  assert.equal(request.format,'sabalan-original-complete-callback-request/v1');assert.equal(request.productionAdmission,false);
  assert.ok(Buffer.isBuffer(descriptor.manifestRaw)&&descriptor.manifestRaw.length<=MAXIMUM);
  assert.equal(sha(descriptor.manifestRaw),request.manifestSha256);
  return request;
}
export function assertCompleteCallbackAck(ack,descriptor) {
  const request=requestValue(descriptor);
  exact(ack,['format','session','operation','sourceCommit','database','requestSha256','callbackDrained','productionAdmission']);
  assert.equal(ack.format,'sabalan-original-complete-callback-ack/v1');
  for(const key of ['session','operation','sourceCommit','database'])assert.deepEqual(ack[key],request[key]);
  assert.equal(ack.requestSha256,descriptor.sha256);assert.equal(ack.callbackDrained,true);assert.equal(ack.productionAdmission,false);
}
/** Requires all three untouched HR frames, rather than rebuilding or filtering
 * a transcript to make an expected sequence. Native/outer closure is separate. */
export function assertCompleteWorkerFrames(raw,descriptor) {
  const request=requestValue(descriptor);
  assert.ok(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=MAXIMUM);
  const lines=raw.toString('utf8').split('\n');assert.equal(lines.pop(),'');assert.equal(lines.length,3);
  const frames=lines.map(line=>JSON.parse(line));
  const kinds=[['sabalan-original-active-restored-qa-hr-request/v1','HR_REQUEST'],
    ['sabalan-original-active-restored-qa-hr-drained/v1','CALLBACK_DRAINED'],
    ['sabalan-original-active-restored-qa-result/v1','RESTORE_RESULT']];
  frames.forEach((frame,i)=>{
    assert.equal(frame.format,kinds[i][0]);assert.equal(frame.event,kinds[i][1]);
    assert.equal(frame.session,request.session);assert.equal(frame.sequence,i+1);
  });
  // The HR encoder canonically orders nested JSON; the engine's separately
  // retained manifest value bytes keep their own original serialization.
  assert.deepEqual(frames[0].manifest,JSON.parse(descriptor.manifestRaw));
  assert.deepEqual(frames[0].targetDatabase,request.database);assert.deepEqual(frames[0].proof.database,request.database);
  assert.equal(frames[0].proof.cleanupPending,true);assert.equal(frames[0].proof.productionAdmission,false);
  const result=frames[2].result;
  assert.equal(result.format,'sabalan-strict-local-complete-validation/v1');
  for(const key of ['strictCompleteValidationSucceeded','databaseAbsent','baseClientFinallyDisconnected'])assert.equal(result[key],true);
  assert.equal(result.financialSchemaQualified,false);assert.equal(result.productionAdmission,false);
  assert.deepEqual(result.absence,{visible:true,name:request.database.name,oid:null,
    systemIdentifier:request.database.systemIdentifier,sessions:0,transactions:0,prepared:0});
  return {frames,result,workerStdoutSha256:sha(raw),productionAdmission:false};
}
