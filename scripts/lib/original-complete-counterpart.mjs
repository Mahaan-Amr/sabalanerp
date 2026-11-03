/** Windows side of the single restored-application observation. The original
 * source controller owns this object; JSON and file paths cannot reconstruct it. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {completeCallbackRequest,assertCompleteWorkerFrames} from './original-complete-callback.mjs';
import {completeOwnedBytes} from './original-complete-join.mjs';
import {assertRestoredInquiryCarrierObservation} from './restored-qa/inquiry-carrier-observation.mjs';
import {assertOriginalPrivateEvidenceDirectory} from './original-private-evidence-directory.mjs';
import {retainOriginalHrChannel} from './original-complete-worker-channel.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value)+'\n');
const borrowed=new WeakMap();
const workers=new WeakMap();
export function assertRetainedCompleteWorkerClosed(token,row,raw){const value=workers.get(token);assert.ok(value,'ORIGINAL_COMPLETE_WORKER_REQUIRED');const c=value.child;assert.equal(c.pid,value.row.originalPid);assert.equal(c.exitCode,0);assert.equal(c.signalCode,null);assert.equal(c.killed,false);assert.equal(c.stdout.readableEnded,true);assert.equal(c.stderr.readableEnded,true);assert.equal(c.stdin.writableFinished,true);assert.deepEqual(row,value.row);assert.ok(Buffer.isBuffer(raw)&&raw.equals(value.raw));}
export function readOriginalCompleteCounterpart(counterpart){const value=borrowed.get(counterpart?.token);assert.ok(value,'ORIGINAL_COMPLETE_COUNTERPART_REQUIRED');value.assertClosed();return structuredClone(value.observation);}
export function readRetainedCompleteWorker(token){
  const value=workers.get(token);assert.ok(value,'ORIGINAL_COMPLETE_WORKER_REQUIRED');
  return {row:structuredClone(value.row),raw:Buffer.from(value.raw)};
}

/** The fixed source controller supplies its reviewed launch binding and original
 * HR issuer. This function owns the spawn and exact transcript; a caller cannot
 * substitute a ChildProcess, closure row, stdout buffer or receipt afterward. */
export async function retainOriginalCompleteWorker({command,session,initial,onRequest,onDrained=()=>{},observeOriginalRaw=()=>{}}){
  const child=spawn(command.executable,command.argv,{shell:false,windowsHide:true,stdio:['pipe','pipe','pipe'],env:command.environment});
  const chunks=[];let count=0;
  try{
    const row=await retainOriginalHrChannel(child,{session,initial,onRequest,onDrained,
      observeRaw:(stream,raw)=>{if(stream==='stdout'){count+=raw.length;assert.ok(count<=8*1024**2,'COMPLETE_WORKER_STDOUT_BOUND');chunks.push(Buffer.from(raw));}observeOriginalRaw(stream,raw);}});
    assert.equal(row.stderrBytes,0);assert.equal(row.observationFault,false);
    const raw=Buffer.concat(chunks);assert.equal(sha(raw),row.stdoutSha256);
    const token=Object.freeze({});workers.set(token,{child,row,raw,closedAt:new Date().toISOString()});return token;
  }finally{for(const chunk of chunks)chunk.fill(0);}
}

/** Original ports, not summaries: inquiry.reader owns its actual source03
 * borrow until the frontend child/HTTP readers really close. The source03 port
 * retains exact ACTIVE/stop/work bytes before retire and the completed tombstone
 * afterward. Failed/unknown closure never returns a positive ACK. */
export function createOriginalCompleteWindowsCounterpart({identity,manifest,assertActive,inquiry,frontend}){
  identity=structuredClone(identity);manifest=structuredClone(manifest);
  assert.equal(typeof inquiry.awaitRetainedClosure,'function');
  const descriptor=completeCallbackRequest(identity,manifest);
  let used=false,readers=0,closed=false,failed=false;
  const token=Object.freeze({});
  const state={descriptor,observation:null,assertClosed(){assert.ok(closed&&!failed&&readers===0,'COMPLETE_COUNTERPART_READERS_OPEN');}};
  borrowed.set(token,state);
  return Object.freeze({token,
    async observe(request){
      assert.ok(!used,'COMPLETE_REQUEST_ALREADY_CONSUMED');used=true;assertActive();
      assert.deepEqual(request.descriptor.raw,descriptor.raw);assert.equal(request.descriptor.sha256,descriptor.sha256);
      assert.deepEqual(request.database,identity.database);assert.deepEqual(request.manifest,manifest);
      let result;
      try{
        readers++;
        if(inquiry.prepare)await inquiry.prepare(request);
        // source03's live borrow encloses every external HTTP/browser reader.
        result=await inquiry.reader(async()=>{
          assertActive();request.assertActive();const observed=await inquiry.observeReady();
          const front=await frontend.observe({endpoint:request.endpoint,inquiry:observed,database:identity.database,manifest,assertActive:request.assertActive});
          assertActive();request.assertActive();
          assert.equal(front.original.code,0);assert.equal(front.original.signal,null);
          assert.equal(front.original.stdoutEof,true);assert.equal(front.original.stderrEof,true);
          assert.equal(front.original.killed,false);assert.equal(front.original.observationFault,null);
          assert.equal(front.original.sha256,sha(front.healthRaw));return front;
        });
      }catch(error){
        failed=true;
        // A failed external reader is still inside source03 custody. Resolve
        // its actual stop/retained-child obligation before propagating failure;
        // unknown closure deliberately leaves this callback pending.
        try{await inquiry.stop();}catch{/* Preserve the first reader failure. */}
        try{await inquiry.awaitRetainedClosure();}catch{/* This port rejects only after actual original closure. */}
        if(inquiry.closeNegativeOriginal)await inquiry.closeNegativeOriginal();
        throw error;
      }finally{readers--;}
      try{
        assert.equal(readers,0);assertActive();await inquiry.stop();await inquiry.awaitRetainedClosure();
        // Capture these before source03 retire deletes requested-stop.json.
        const before=await inquiry.closedRecords();
        await inquiry.retire();const retirement=await inquiry.retirementRecord();
        const evidence={...before,retirement};
        const expected=inquiry.observationBinding();assertRestoredInquiryCarrierObservation(evidence,expected);
        assertActive();request.assertActive();closed=true;
        const observation={ack:{format:'sabalan-original-complete-callback-ack/v1',...structuredClone(identity),requestSha256:descriptor.sha256,
          callbackDrained:true,productionAdmission:false},probe:{database:identity.database,authenticated:result.authenticated,
          businessVerified:result.businessVerified,filesVerified:result.filesVerified,
          originals:[result.original,{role:'inquiry',evidence}],productionAdmission:false},
          healthObservation:completeOwnedBytes(result.healthRaw),inquiryExpected:expected};
        state.observation=structuredClone(observation);return observation;
      }catch(error){failed=true;await inquiry.awaitRetainedClosure();throw error;}
    },
    assertClosed:state.assertClosed,
  });
}

/** Called by the SAME original worker controller after retainOriginalHrChannel
 * resolves and BEFORE its caller can enter transfer/job cleanup. Capture is a
 * data receipt, not a completion token. The outer collector and strict final
 * verifier must still prove actual outer closure and retirement afterward. */
export function captureOriginalCompleteBeforeCleanup({counterpart,workerCompletion,applicationRaw,applicationFile,seed,
  evidenceDirectory,evidenceCustody,workerSourceSha256,controllerSourceSha256}){
  const state=borrowed.get(counterpart.token);assert.ok(state,'ORIGINAL_COMPLETE_COUNTERPART_REQUIRED');state.assertClosed();
  const observation=state.observation;assert.ok(observation);
  const worker=workers.get(workerCompletion);assert.ok(worker,'ORIGINAL_COMPLETE_WORKER_REQUIRED');
  const {child,row:workerOriginal,raw:workerStdout}=worker;
  assert.equal(child.exitCode,0);assert.equal(child.signalCode,null);assert.equal(child.killed,false);
  assert.equal(child.stdout.readableEnded,true);assert.equal(child.stderr.readableEnded,true);
  assert.equal(workerOriginal.originalPid,child.pid);assert.equal(workerOriginal.code,0);assert.equal(workerOriginal.signal,null);
  for(const key of ['stdoutEof','stderrEof','callbackDrained'])assert.equal(workerOriginal[key],true);
  assert.equal(workerOriginal.localInterrupted,false);assert.equal(workerOriginal.observationFault,false);
  assert.equal(workerOriginal.stdoutSha256,sha(workerStdout));assert.equal(workerOriginal.stderrBytes,0);
  assert.equal(workerOriginal.stderrSha256,sha(Buffer.alloc(0)));
  const {frames}=assertCompleteWorkerFrames(workerStdout,state.descriptor);
  const ref=frames[2].result.privateQa.value.coherentQualification;
  assert.equal(ref.file,applicationFile);assert.equal(ref.sha256,sha(applicationRaw));assert.equal(ref.bytes,applicationRaw.length);
  const normalized={format:'sabalan-original-protected-financial-closure/v1',originalPid:child.pid,code:child.exitCode,signal:child.signalCode,
    stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,killed:child.killed,observationFault:null,
    stdoutRawBase64:workerStdout.toString('base64'),stdoutSha256:sha(workerStdout),stderrRawBase64:'',stderrSha256:sha(Buffer.alloc(0)),
    workerSourceSha256,controllerSourceSha256};
  const value={format:'sabalan-original-complete-capture/v1',request:JSON.parse(state.descriptor.raw),requestBytes:completeOwnedBytes(state.descriptor.raw),
    manifestBytes:completeOwnedBytes(state.descriptor.manifestRaw),ack:observation.ack,workerStdout:completeOwnedBytes(workerStdout),workerOriginal:completeOwnedBytes(bytes(normalized)),
    applicationArtifact:completeOwnedBytes(applicationRaw),applicationFile,seed:completeOwnedBytes(bytes(seed)),
    probe:observation.probe,healthObservation:observation.healthObservation,inquiryExpected:observation.inquiryExpected,
    workerClosedAt:worker.closedAt,capturedAt:new Date().toISOString(),workerClosedBeforeCapture:true,cleanupStarted:false,productionAdmission:false};
  const raw=bytes(value);assert.ok(raw.length<=8*1024**2,'COMPLETE_CAPTURE_METADATA_BOUND');
  assertOriginalPrivateEvidenceDirectory(evidenceCustody,evidenceDirectory);
  const file=path.join(evidenceDirectory,'complete-capture.json'),fd=fs.openSync(file,'wx',0o400);
  try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  assert.deepEqual(fs.readFileSync(file),raw);
  return Object.freeze({file,bytes:raw.length,sha256:sha(raw)});
}
