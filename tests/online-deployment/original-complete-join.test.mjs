import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {joinOriginalCompleteArtifacts,completeOwnedBytes as ref} from '../../scripts/lib/original-complete-join.mjs';
import {completeFixture,raw} from './original-complete-integration.fixture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
test('actual producer shape joins unchanged baseline/HR bytes and passes the canonical strict consumer',async()=>{
 const f=await completeFixture(),before=structuredClone(f.app);
 const joined=joinOriginalCompleteArtifacts(f);
 assert.doesNotThrow(()=>f.k.assertOnlineQualificationProof('coherent-independent-restore',joined.proof,joined.expected));
 assert.deepEqual(f.app,before);assert.equal(joined.proof.protectedDirectoryComponents.baselineRawBase64,f.app.baselineRawBase64);
 assert.equal(joined.record.outerOriginalClosurePending,false);assert.equal(joined.record.originalControllers[0].stdoutEof,true);
});
test('rehashing negatives cannot admit missing closure, early cleanup, wrong target, absent artifact or predicted health',async()=>{
 const changes=[f=>{f.capture.cleanupStarted=true;},f=>{f.capture.workerClosedBeforeCapture=false;},f=>{f.capture.ack.callbackDrained=false;},
  f=>{f.owner.row.stdoutEof=false;},f=>{f.owner.row.code=1;},f=>{f.result.localJobRetired=false;},f=>{f.result.temporaryTransferRetired=false;},
  f=>{f.capture.capturedAt='2026-10-20T00:05:00Z';},f=>{f.capture.request.database.oid='999';},
  f=>{f.capture.applicationArtifact.sha256='0'.repeat(64);},f=>{f.capture.healthObservation=ref(raw({}));},
  f=>{const w=JSON.parse(Buffer.from(f.capture.workerOriginal.rawBase64,'base64'));w.code=1;f.capture.workerOriginal=ref(raw(w));},
  f=>{const app=JSON.parse(Buffer.from(f.capture.applicationArtifact.rawBase64,'base64'));app.lifecycle.final.sql.sessions=1;f.capture.applicationArtifact=ref(raw(app));}];
 for(const change of changes){const f=await completeFixture();change(f);f.captureRaw=raw(f.capture);f.result.completeCapture.sha256=sha(f.captureRaw);f.ownerRaw=raw(f.result);f.owner.resultReference.sha256=sha(f.ownerRaw);
  assert.throws(()=>joinOriginalCompleteArtifacts(f));}
});
