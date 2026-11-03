/** Final data join over producer bytes. No JSON object can create authority here. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertCompleteCallbackAck,assertCompleteWorkerFrames} from './original-complete-callback.mjs';
import {assertRestoredInquiryCarrierObservation} from './restored-qa/inquiry-carrier-observation.mjs';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value)+'\n');
export const completeOwnedBytes=raw=>({rawBase64:raw.toString('base64'),bytes:raw.length,sha256:sha(raw)});
export function completeRaw(reference,maximum=8*1024**2){
  assert.equal(typeof reference.rawBase64,'string');assert.ok(reference.rawBase64.length<=Math.ceil(maximum/3)*4+4);
  const raw=Buffer.from(reference.rawBase64,'base64');assert.equal(raw.toString('base64'),reference.rawBase64);
  assert.ok(raw.length>0&&raw.length<=maximum);assert.equal(raw.length,reference.bytes);assert.equal(sha(raw),reference.sha256);return raw;
}
const decode=value=>completeRaw({rawBase64:value,bytes:Buffer.from(value,'base64').length,sha256:sha(Buffer.from(value,'base64'))});
const json=value=>JSON.parse(decode(value).toString('utf8'));
function closed(row){
  assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>1);
  for(const key of ['stdoutEof','stderrEof'])assert.equal(row[key],true);
  assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.killed,false);assert.equal(row.observationFault,null);
}
function native(value){
  assert.equal(value.originalReturncode,0);assert.ok(Number.isSafeInteger(value.originalPopenPid)&&value.originalPopenPid>1);
  const n=json(value.nativeRawBase64),w=json(value.workRawBase64),claim=json(value.workClaimRawBase64);
  assert.equal(n.guardian.pid,value.originalPopenPid);assert.equal(n.nativeStatus,0);assert.equal(n.stoppedBySignal,false);
  assert.equal(n.phase,'QUIESCENT');assert.equal(w.phase,'QUIESCENT');assert.equal(n.nativeReaped,true);assert.equal(n.databaseQuiet,true);
  assert.deepEqual(claim.native,{scopeSha256:n.onlineScope.sha256,claimSha256:n.activeClaimSha256});
  return {runtimeId:n.onlineScope.scope.runtimeId,nativeSha256:sha(decode(value.nativeRawBase64)),
    workSha256:sha(decode(value.workRawBase64)),activeClaimSha256:n.activeClaimSha256};
}

/** The seed is a source producer's data template, never a completion. Its full
 * canonical proof is checked by the fixed reader after this join and again by
 * the protected assembler against the actual protected request. */
export function joinOriginalCompleteArtifacts({owner,ownerRaw,captureRaw,completedAt}){
  closed(owner.row);assert.equal(owner.row.interrupted,false);
  assert.equal(owner.row.format,'sabalan-original-complete-owner-closure/v1');
  assert.equal(sha(ownerRaw),owner.resultReference.sha256);
  const result=JSON.parse(ownerRaw.toString('utf8')),capture=JSON.parse(captureRaw.toString('utf8'));
  assert.equal(result.format,'sabalan-owned-complete-transfer-strict-restore/v1');
  for(const key of ['strictCompleteValidationSucceeded','temporaryTransferRetired','localJobRetired','outerOriginalClosurePending'])assert.equal(result[key],true);
  assert.equal(result.productionAdmission,false);
  assert.equal(capture.format,'sabalan-original-complete-capture/v1');assert.equal(capture.productionAdmission,false);
  assert.equal(capture.workerClosedBeforeCapture,true);assert.equal(capture.cleanupStarted,false);
  assert.equal(result.completeCapture.sha256,sha(captureRaw));
  assert.equal(result.operation,capture.request.operation);
  const descriptor={raw:completeRaw(capture.requestBytes),sha256:capture.requestBytes.sha256,manifestRaw:completeRaw(capture.manifestBytes)};
  assert.deepEqual(JSON.parse(descriptor.raw.toString('utf8')),capture.request);assertCompleteCallbackAck(capture.ack,descriptor);
  const workerRaw=completeRaw(capture.workerStdout),workerOriginalRaw=completeRaw(capture.workerOriginal);
  const {frames}=assertCompleteWorkerFrames(workerRaw,descriptor),worker=JSON.parse(workerOriginalRaw.toString('utf8'));closed(worker);
  assert.equal(worker.format,'sabalan-original-protected-financial-closure/v1');
  assert.equal(worker.stdoutRawBase64,workerRaw.toString('base64'));assert.equal(worker.stdoutSha256,sha(workerRaw));
  assert.equal(worker.stderrRawBase64,'');assert.equal(worker.stderrSha256,sha(Buffer.alloc(0)));
  const appRaw=completeRaw(capture.applicationArtifact),app=JSON.parse(appRaw.toString('utf8'));
  const reference=frames[2].result.privateQa.value.coherentQualification;
  assert.equal(reference.format,'sabalan-live-restored-application-reference/v1');assert.equal(reference.sha256,sha(appRaw));assert.equal(reference.bytes,appRaw.length);
  assert.equal(reference.file,capture.applicationFile);
  assert.equal(app.format,'sabalan-live-restored-application-artifacts/v1');
  assert.equal(app.usersObservation.originalUsersAndCredentialsUnchanged,true);assert.equal(app.usersObservation.originalRelationshipsAndPermissionsUnchanged,true);
  const terminal=frames[2].result.privateQa.value.terminalObservation;
  assert.equal(terminal.format,'sabalan-original-complete-terminal-observation/v1');assert.deepEqual(terminal.database,app.database);assert.deepEqual(terminal.sql,{visible:true,sessions:0,prepared:0});assert.equal(terminal.originalInquiryConservationRechecked,true);
  for(const value of [app,app.lifecycle]){assert.equal(value.cleanupPending,true);assert.equal(value.independentPointHealthy,false);assert.equal(value.productionAdmission,false);}
  assert.deepEqual(app.database,capture.request.database);assert.equal(capture.request.sourceCommit,result.protectedFinancialQualification.binding.sourceCommit);
  assert.deepEqual(app.sourceDatabase,result.protectedFinancialQualification.binding.sourceDatabase);
  assert.deepEqual(app.database,result.protectedFinancialQualification.binding.restoredDatabase);
  assert.equal(worker.workerSourceSha256,result.protectedFinancialQualification.binding.workerSourceSha256);
  assert.equal(worker.controllerSourceSha256,result.protectedFinancialQualification.binding.controllerSourceSha256);
  const life=app.lifecycle;
  assert.deepEqual(life.probe,capture.probe);
  assert.deepEqual(life.final.database,app.database);assert.deepEqual(life.final.sql,{visible:true,sessions:0,prepared:0});
  assert.equal(life.final.filesVerified,true);assert.equal(life.final.productionAdmission,false);
  const frontend=life.probe.originals.filter(row=>row.role==='frontend');assert.equal(frontend.length,1);closed(frontend[0]);
  for(const key of ['authenticated','businessVerified','filesVerified'])assert.equal(life.probe[key],true);
  assert.deepEqual(life.probe.database,app.database);assert.equal(life.probe.productionAdmission,false);
  const inquiry=life.probe.originals.filter(row=>row.role==='inquiry');assert.equal(inquiry.length,1);
  assert.deepEqual(assertRestoredInquiryCarrierObservation(inquiry[0].evidence,capture.inquiryExpected),life.inquiryClosure);
  const nativeClosures=[native(life.baseline),native(life.closure.closed)];
  for(const stamp of [owner.row.startedAt,capture.workerClosedAt,capture.capturedAt,result.cleanupStartedAt,owner.row.closedAt,completedAt])assert.ok(typeof stamp==='string'&&Number.isFinite(Date.parse(stamp)));
  assert.ok(Date.parse(owner.row.startedAt)<=Date.parse(capture.workerClosedAt)&&Date.parse(capture.workerClosedAt)<=Date.parse(capture.capturedAt)
    &&Date.parse(capture.capturedAt)<=Date.parse(result.cleanupStartedAt)&&Date.parse(result.cleanupStartedAt)<=Date.parse(owner.row.closedAt)&&Date.parse(owner.row.closedAt)<=Date.parse(completedAt));
  const seed=JSON.parse(completeRaw(capture.seed).toString('utf8')),record=structuredClone(seed.independentRecord),proof=structuredClone(seed.proofSource);
  assert.equal(record.format,'sabalan-live-existing-compose-independent-record/v1');assert.equal(record.productionAdmission,false);
  const baselineRaw=decode(app.baselineRawBase64),baseline=JSON.parse(baselineRaw.toString('utf8'));
  assert.equal(life.baseline.result.manifestSha256,sha(baselineRaw));assert.deepEqual(baseline.restoredQaLineage,app.restoredQaLineage);
  assert.equal(sha(decode(app.completeManifestValueRawBase64)),app.restoredQaLineage.completeManifestSha256);
  assert.equal(sha(decode(app.workingManifestValueRawBase64)),app.restoredQaLineage.workingManifestSha256);
  assert.equal(sha(decode(app.originalNativeHistoryRawBase64)),app.restoredQaLineage.nativeHistorySha256);
  assert.equal(frames[0].proof.rawHistorySha256,app.restoredQaLineage.nativeHistorySha256);
  assert.deepEqual(JSON.parse(decode(app.completeManifestValueRawBase64).toString('utf8')),proof.checkpointMetadata.manifest);
  assert.equal(proof.sourceCommit,capture.request.sourceCommit);assert.deepEqual(proof.restoredDatabase,app.database);
  assert.deepEqual(record.proofDatabase,app.database);assert.deepEqual(record.restoredDatabase,app.database);
  const directory=proof.protectedDirectoryComponents,restore=json(directory.canonicalRestoreOutputRawBase64);
  const inquiryEvidence=inquiry[0].evidence;
  assert.equal(proof.inquiryRuntimeQualified,true);
  proof.inquiryNativeClosure={...life.inquiryClosure,closure:{originalPopenPid:life.inquiryClosure.originalPopenPid,
    originalReturncode:life.inquiryClosure.wrapperStatus,nativeRawBase64:inquiryEvidence.finalNative.rawBase64,
    workRawBase64:inquiryEvidence.work.rawBase64,workClaimRawBase64:inquiryEvidence.workClaim.rawBase64,
    workScopeRawBase64:inquiryEvidence.workScope.rawBase64},evidence:inquiryEvidence};
  directory.format='sabalan-original-live-restored-qa-directory-restore/v1';
  directory.baselineRawBase64=app.baselineRawBase64;directory.baselineSha256=sha(baselineRaw);
  directory.liveFinalJoin={format:'sabalan-original-live-restored-qa-final-join/v1',
    baselineCompletion:life.baseline.result,baselineOriginalRawBase64:bytes(life.baseline).toString('base64'),
    baselineNativeSha256:sha(decode(life.baseline.nativeRawBase64)),
    workerStdoutRawBase64:workerRaw.toString('base64'),workerOriginalRawBase64:workerOriginalRaw.toString('base64'),
    ownerResultRawBase64:ownerRaw.toString('base64'),ownerOriginalRawBase64:bytes(owner.row).toString('base64'),ownerStdoutRawBase64:owner.stdoutRawBase64,
    completeManifestValueRawBase64:app.completeManifestValueRawBase64,workingManifestValueRawBase64:app.workingManifestValueRawBase64};
  Object.assign(restore,{format:'sabalan-original-existing-compose-complete-restore/v1',ok:true,originalBaselineSha256:sha(baselineRaw),
    finalOwnerResultSha256:sha(ownerRaw),finalOwnerClosureSha256:sha(bytes(owner.row)),finalWorkerStdoutSha256:sha(workerRaw)});
  // These success fields arise only after the SAME worker, actual application
  // readers, strict B retirement and outer owner have all closed successfully.
  Object.assign(restore.drill,{format:'sabalan-independent-checkpoint-drill/v1',status:'HEALTHY',phase:'COMPLETE',packageType:'COMPLETE',completedAt,
    stagedPostgresRestore:true,stagedSqliteIntegrity:true,verifiedFiles:true,verifiedApplicationPayloads:true,verifiedBusinessData:true});
  directory.canonicalRestoreOutputRawBase64=bytes(restore).toString('base64');proof.checkpoint.lastDrill=structuredClone(restore.drill);
  const healthRaw=completeRaw(capture.healthObservation),health=JSON.parse(healthRaw.toString('utf8'));
  assert.equal(frontend[0].sha256,sha(healthRaw));
  assert.equal(health.format,'sabalan-original-complete-application-health/v1');assert.deepEqual(health.database,app.database);
  assert.equal(health.productionAdmission,false);assert.deepEqual(Object.keys(health.applications).sort(),['backend','frontend','inquiry']);
  for(const [role,value]of Object.entries(health.applications)){
    const response=Buffer.from(value.responseRawBase64,'base64');assert.equal(response.toString('base64'),value.responseRawBase64);
    assert.ok(response.length>0&&response.length<=1024*1024);assert.equal(sha(response),value.responseSha256);assert.equal(value.status,200);
    assert.equal(value.image,record.images[role]);
    assert.deepEqual(proof.applicationHealth[role],{image:value.image,sourceCommit:value.sourceCommit,status:value.status,
      responseSha256:value.responseSha256,checkpointMetadataSha256:directory.checkpointSha256});
  }
  // The template cannot substitute native facts or producer outputs.
  const original=proof.originalNativeClosures;
  assert.equal(original.length,2);
  for(const value of [life.baseline,life.closure.closed]){
    const runtimeId=json(value.nativeRawBase64).onlineScope.scope.runtimeId;
    const matches=original.filter(row=>row.runtimeId===runtimeId);assert.equal(matches.length,1);assert.equal(matches[0].originalPopenPid,value.originalPopenPid);
    for(const key of ['nativeRawBase64','workRawBase64','workClaimRawBase64','workScopeRawBase64'])assert.equal(matches[0][key],value[key]);
  }
  const proofRaw=bytes(proof);
  Object.assign(record,{format:'sabalan-original-existing-compose-complete/v1',recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE',
    completedAt,outerOriginalClosurePending:false,coherentProofBinding:seed.expected,nativeClosures,
    controllerSourceSha256:worker.controllerSourceSha256,historySha256:owner.row.stdoutSha256,
    originalControllers:[owner.row,worker],finalDatabaseAbsence:frames[2].result.absence});
  record.ownedOutputs={...record.ownedOutputs,coherentQualification:completeOwnedBytes(proofRaw),restoredBaseline:completeOwnedBytes(baselineRaw),
    canonicalRestoreOutput:completeOwnedBytes(bytes(restore)),completeApplication:completeOwnedBytes(appRaw),completeCapture:completeOwnedBytes(captureRaw),
    completeWorker:completeOwnedBytes(workerRaw),completeOwner:completeOwnedBytes(ownerRaw)};
  const report=JSON.parse(completeRaw(record.ownedOutputs.report).toString('utf8'));
  assert.deepEqual(report.baseline,life.baseline);assert.deepEqual(report.backendClosure,life.closure);
  report.healthyDrill=restore.drill;
  report.inquiryClosure=proof.inquiryNativeClosure;
  for(const role of ['backend','frontend','inquiry']){
    const value=health.applications[role];
    assert.equal(report.images[role].sourceCommit,value.sourceCommit);
    assert.deepEqual(report.applicationHealth[role],{image:value.image,declaredSourceCommit:value.sourceCommit,status:value.status,responseSha256:value.responseSha256});
  }
  record.ownedOutputs.report=completeOwnedBytes(bytes(report));
  const namespaces=[life.baseline,life.closure.closed].map(value=>({namespace:json(value.workScopeRawBase64).scope.postgresApplicationName,sessions:0}));
  record.ownedOutputs.namespaceSqlObservation=completeOwnedBytes(bytes({visible:life.final.sql.visible,database:app.database,
    sessions:life.final.sql.sessions,prepared:life.final.sql.prepared,namespaces}));
  record.fileHashes={...record.fileHashes,...Object.fromEntries(Object.entries(record.ownedOutputs).map(([name,ref])=>[name,ref.sha256]))};
  return {record,proof,expected:seed.expected};
}
