import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {openInheritedReadonlyTransportRetirementChannel,consumeReadonlyTransportRetirement,
  readReadonlyTransportRetirementCertificate,readOriginalReadonlyTransportChannelIdentity,
  readOriginalCaptureAbortControl} from '../../deploy/scripts/readonly-transport-retirement.mjs';
import {readOriginalSocketStoppedEvidence} from '../../deploy/scripts/socket-release-proxy.mjs';

const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function writeExclusive(file,value){
  const text=JSON.stringify(canonical(value)).replace(/[^\x00-\x7f]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  const raw=Buffer.from(text+'\n');assert.ok(raw.length<=8*1024*1024);
  const handle=await fs.open(file,'wx',0o600);
  try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  const directory=await fs.open(path.dirname(file),'r');
  try{await directory.sync();}finally{await directory.close();}return sha(raw);
}
/** Called at ORIGINAL edge startup, before the factory receives requests. */
export const enrollOriginalReadonlyTransportChannel=()=>openInheritedReadonlyTransportRetirementChannel();
/** Actual browser/Socket assertions run first. The edge stays alive here while
 * its original Python parent completes coherent capture and original backend
 * native retirement. No timeout, replacement edge or business-success rewrite. */
export async function holdOriginalStoppedEdgeForReadonlyRetirement({root,edge,channel,businessStage}){
  assert.match(root,/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}$/);
  assert.equal(await fs.realpath(root),root);
  edge.beginDrain();
  await new Promise((resolve,reject)=>edge.server.close(error=>error?reject(error):resolve()));
  const stopped=await edge.readStoppedTransport();
  assert.equal(stopped.ui.pendingOperations.length,0);
  assert.equal(stopped.api.pendingOperations.length,0);
  const socket=await readOriginalSocketStoppedEvidence(stopped.socket);
  assert.ok(socket.pendingEvidence.length>0,'fixture requires actual ordinary abrupt-disconnect UNKNOWN');
  await assert.rejects(edge.assertDrained());
  const substituted=JSON.parse(JSON.stringify(stopped.socket));
  substituted.pendingEvidence[0].intentSha256='0'.repeat(64);
  await assert.rejects(consumeReadonlyTransportRetirement(channel,substituted),/SOCKET_ORIGINAL_STOPPED_EVIDENCE_UNPROVEN/);
  const stage={format:'sabalan-original-edge-readonly-retirement-stage/v1',productionAdmission:false,
    socketInstanceId:socket.socketInstanceId,journalInstanceId:socket.journalInstanceId,
    pendingEvidence:socket.pendingEvidence,businessStage,uiMutationPending:0,apiMutationPending:0,
    originalOperationOutcome:'UNKNOWN',buildOrImageGcEligible:false,substitutedStoppedIntentRefused:true};
  const stageSha256=await writeExclusive(path.join(root,'readonly-transport-stopped.json'),stage);
  const opaque=await consumeReadonlyTransportRetirement(channel,stopped.socket);
  const certificate=readReadonlyTransportRetirementCertificate(opaque);
  const after=await readOriginalSocketStoppedEvidence(stopped.socket);
  assert.deepEqual(after.pendingEvidence,socket.pendingEvidence);
  await assert.rejects(edge.assertDrained(),'raw UNKNOWN must continue to fail ordinary drain');
  return {stageSha256,readonlyPendingRetained:after.pendingEvidence.length,originalOperationOutcome:'UNKNOWN',
    uiMutationPending:0,apiMutationPending:0,certificate,productionAdmission:false,buildOrImageGcEligible:false};
}

/** The real Chrome and authenticated Socket remain alive inside the caller's
 * onIdle callback until THIS original parent finishes the coherent restore. */
export async function publishOriginalBrowserBusinessReadyAndWaitCapture({root,channel,businessStage}){
  assert.match(root,/^\/app\/online-runtime-acceptance\/application-native-[a-f0-9]{32}$/);
  assert.equal(await fs.realpath(root),root);
  const identity=readOriginalReadonlyTransportChannelIdentity(channel),operation=path.basename(root);
  const value={format:'sabalan-original-browser-business-stage/v1',operation,originalEdgePid:process.pid,
    enrollmentId:identity.enrollmentId,businessStage,productionAdmission:false};
  const readySha256=await writeExclusive(path.join(root,'browser-business-ready.json'),value);
  const expected={format:'sabalan-original-browser-capture-finished/v1',operation,enrollmentId:identity.enrollmentId,readySha256};
  for(;;){
    if(readOriginalCaptureAbortControl(channel,readySha256))throw new Error('ORIGINAL_PARENT_CAPTURE_ABORT_QUALIFICATION_FALSE');
    let handle;
    try{handle=await fs.open(path.join(root,'browser-finish.json'),'r');}
    catch(error){if(error.code==='ENOENT'){await new Promise(resolve=>setTimeout(resolve,20));continue;}throw error;}
    try{
      const before=await handle.stat({bigint:true});
      assert.ok(before.isFile()&&before.nlink===1n&&before.uid===BigInt(process.getuid())
        &&(before.mode&0o777n)===0o400n&&before.size>0n&&before.size<=16384n);
      const bytes=await handle.readFile(),named=await fs.lstat(path.join(root,'browser-finish.json'),{bigint:true});
      for(const current of [await handle.stat({bigint:true}),named])for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','nlink','uid'])assert.equal(current[key],before[key]);
      assert.deepEqual(JSON.parse(bytes.toString('utf8')),expected);
      readOriginalReadonlyTransportChannelIdentity(channel);return {readySha256};
    }finally{await handle.close();}
  }
}
