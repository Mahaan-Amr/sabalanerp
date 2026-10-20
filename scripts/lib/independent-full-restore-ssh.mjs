import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {readIndependentCheckpointTransport} from './independent-checkpoint-transport.mjs';
import {validatePhysicalPointProducer} from '../run-independent-full-restore-controller.mjs';

const completed=new WeakMap(),physicalCompleted=new WeakMap(),guardians=new WeakMap(),windowCompleted=new WeakMap(),metadataCompleted=new WeakMap(),repositoryCompleted=new WeakMap(),certificationCompleted=new WeakMap(),terminalCompleted=new WeakMap(),pointTransferred=new WeakMap();
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>assert.deepEqual(a,b);
const ownFile=fileURLToPath(import.meta.url);
const workerFile=fileURLToPath(new URL('../../tests/online-deployment/independent-full-restore-ssh.fixture.py',import.meta.url));
const transferHelperFile=fileURLToPath(new URL('../../tests/online-deployment/independent-image-transfer.fixture.py',import.meta.url));
const transferOrder=['backend','inquiry','frontend'];
const {validateWindow}=createRequire(import.meta.url)('../../tests/online-deployment/independent-wal-window.worker.cjs');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const frame=value=>Buffer.from(JSON.stringify(canonical(value))+'\n');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
const ownedBytes=raw=>({rawBase64:raw.toString('base64'),sha256:sha(raw),bytes:raw.length});
function physicalReport(report,expected){
  const point=expected.onlinePhysicalPoint;
  same(report.sealedSourceCustody,{actualRoot:point.root,sealedFile:point.sealedFile,manifestFile:point.manifestFile});
  same(report.format,'sabalan-original-independent-online-physical-restore/v1');same(report.recoveryMode,'ONLINE_COHERENT_WAL');same(report.continuousWalQualified,false);same(report.physicalReplayQualified,true);same(report.physicalAndThreeApplicationsQualified,true);
  same(report.sealedManifestSha256,point.sealedSha256);same(report.plaintextManifestSha256,point.manifestSha256);
  const raw=value=>{const result=Buffer.from(value,'base64');same(result.toString('base64'),value);return result;};
  const sealedRaw=raw(report.originalSealedManifestRawBase64),manifestRaw=raw(report.originalPlaintextManifestRawBase64),producerRaw=raw(report.originalProducerRawBase64);
  same(sha(sealedRaw),point.sealedSha256);same(sha(manifestRaw),point.manifestSha256);same(sha(producerRaw),point.producerSha256);
  const sealed=JSON.parse(sealedRaw),manifest=JSON.parse(manifestRaw),producer=JSON.parse(producerRaw);
  same(sealed.manifestSha256,point.manifestSha256);same(sealed.operation,point.captureId);same(manifest.operation,point.captureId);same(producer.captureId,point.captureId);same(producer.manifestSha256,point.manifestSha256);validatePhysicalPointProducer(producer,point.captureId,point.manifestSha256);
  same(report.cipherInventorySha256,sha(Buffer.from(JSON.stringify(canonical(sealed.objects.map(row=>({name:row.name,bytes:row.cipherBytes,sha256:row.cipherSha256})))))));
  const decryptedRaw=raw(report.originalComponentDecryption.rawBase64),layoutRaw=raw(report.originalPhysicalLayout.rawBase64),replaySqlRaw=raw(report.originalPhysicalReplaySql.rawBase64);
  for(const [value,content] of [[report.originalComponentDecryption,decryptedRaw],[report.originalPhysicalLayout,layoutRaw],[report.originalPhysicalReplaySql,replaySqlRaw]]){same(value.sha256,sha(content));same(value.originalExitCode,0);assert.ok(value.originalPid>1&&report.originalDockerProcesses.some(row=>row.pid===value.originalPid&&row.code===0&&row.signal===null));}
  const decryption=JSON.parse(decryptedRaw),layout=JSON.parse(layoutRaw);same(decryption,report.decryption);same(layout,report.layout);same(decryption.fullGcmAuthenticated,true);same(decryption.independentRsaDecryptVerified,true);same(decryption.sealedSha256,point.sealedSha256);same(decryption.manifestSha256,point.manifestSha256);same(decryption.captureId,point.captureId);
  same(decryption.components.length,sealed.objects.length);
  for(const row of manifest.sources){const source=sealed.objects.filter(value=>value.name===row.name),actual=decryption.components.filter(value=>value.name===row.name);same(source.length,1);same(actual.length,1);for(const key of ['name','role','bytes','sha256'])same(actual[0][key],row[key]);same(actual[0].cipherSha256,source[0].cipherSha256);same(actual[0].cipherBytes,source[0].cipherBytes);}
  const capturedRaw=raw(report.originalCapturedRawBase64),coverageRaw=raw(report.originalCoverageRawBase64),walRaw=raw(report.originalWalClosureRawBase64),captured=JSON.parse(capturedRaw),coverage=JSON.parse(coverageRaw),wal=JSON.parse(walRaw);
  for(const [role,content] of [['coherent-cut',capturedRaw],['coverage-manifest',coverageRaw],['wal-capture',walRaw]]){const rows=manifest.sources.filter(row=>row.role===role);same(rows.length,1);same(rows[0].sha256,sha(content));same(rows[0].bytes,content.length);}
  same(producer.walClosure,wal);same(producer.captureClosure,coverage.captureClosure);same(layout.coverage.timeline,coverage.timeline);same(layout.sourceDatabase,captured.database);
  same(report.sourceDatabase,{name:captured.database.database,oid:String(captured.database.databaseOid),systemIdentifier:captured.database.systemIdentifier});
  same(report.restorePoint,{name:captured.restorePoint.name,lsn:captured.restorePoint.lsn,requiredWalEndLsn:captured.restorePoint.requiredWalEndLsn,timeline:coverage.timeline});
  same(report.replay,JSON.parse(replaySqlRaw));same(report.replay.inRecovery,false);same(report.replay.systemIdentifier,report.sourceDatabase.systemIdentifier);same(report.replay.sourceDatabaseOid,report.sourceDatabase.oid);
  const lsn=value=>{assert.match(value,/^[0-9A-F]+\/[0-9A-F]+$/);const [a,b]=value.split('/');return BigInt('0x'+a)*0x100000000n+BigInt('0x'+b);};assert.ok(lsn(report.replay.lastReplayLsn)>=lsn(report.restorePoint.lsn)&&lsn(report.replay.lastReplayLsn)<=lsn(report.restorePoint.requiredWalEndLsn));
  same(layout.restoredFileCuts.length,9);same(new Set(layout.restoredFileCuts.map(row=>row.name)).size,9);same(layout.sqlite.sha256,captured.sqliteSnapshot.sha256);same(layout.coordinationHistory.sha256,captured.coordinationHistory.sha256);same(layout.coordinationHistory.archivalOnly,true);same(layout.coordinationHistory.runtimeAdmission,false);
  same(report.originalPgCommands.map(row=>row.role).sort(),['pg_controldata','pg_verifybackup','pg_waldump']);
  for(const row of report.originalPgCommands){same(row.returncode,0);same(row.signal,null);same(sha(raw(row.stdoutRawBase64)),row.stdoutSha256);assert.ok(report.originalDockerProcesses.some(value=>value.pid===row.originalPid&&value.code===0&&value.signal===null));}
  same(report.sourceMachineUuidSha256,point.sourceHost.machineUuidSha256);same(report.sourceKernelBootIdSha256,point.sourceHost.kernelBootIdSha256);same(report.recoveryMachineUuidSha256,expected.recoveryHost.machineUuidSha256);same(report.recoveryKernelBootIdSha256,expected.recoveryHost.kernelBootIdSha256);
  assert.notEqual(report.sourceMachineUuidSha256,report.recoveryMachineUuidSha256);assert.notEqual(report.sourceKernelBootIdSha256,report.recoveryKernelBootIdSha256);assert.ok(Date.parse(report.completedAt)>=Date.parse(report.startedAt));
  return {originalPhysicalRestore:ownedBytes(raw(report.originalPhysicalRestoreOutputRawBase64)),sealedManifest:ownedBytes(sealedRaw),plaintextManifest:ownedBytes(manifestRaw),originalProducer:ownedBytes(producerRaw),decryption:ownedBytes(decryptedRaw),layout:ownedBytes(layoutRaw),replaySql:ownedBytes(replaySqlRaw),captured:ownedBytes(capturedRaw),coverage:ownedBytes(coverageRaw),walClosure:ownedBytes(walRaw)};
}

/** Only a same-process original factory completion is an authority-bearing
 * input. Parsed stdout/report JSON alone can never be converted to this token. */
export function readOriginalIndependentRestoreSshCompletion(token){
  const value=completed.get(token);assert.ok(value,'ORIGINAL_INDEPENDENT_SSH_COMPLETION_UNPROVEN');return value;
}
/** Physical prepublication receipts are a distinct ownership domain. Neither
 * COMPLETE tokens nor parsed physical reports can stand in for the original
 * physical replay + three-app SSH owner. No future checkpoint row is implied. */
export function readOriginalIndependentPhysicalRestoreSshCompletion(token){
  const value=physicalCompleted.get(token);assert.ok(value,'ORIGINAL_INDEPENDENT_PHYSICAL_SSH_COMPLETION_UNPROVEN');return value;
}

function nativeRows(report){
  const values=[report.baseline,report.backendClosure?.closed,report.inquiryClosure?.closure];
  return values.map((value,index)=>{
    assert.ok(value&&typeof value.nativeRawBase64==='string'&&typeof value.workRawBase64==='string');
    const nativeRaw=Buffer.from(value.nativeRawBase64,'base64'),workRaw=Buffer.from(value.workRawBase64,'base64');
    const native=JSON.parse(nativeRaw),work=JSON.parse(workRaw);
    const claimRaw=Buffer.from(value.workClaimRawBase64,'base64'),scopeRaw=Buffer.from(value.workScopeRawBase64,'base64');
    const claim=JSON.parse(claimRaw),scope=JSON.parse(scopeRaw);
    same(work.claimSha256,sha(claimRaw));same(claim.scopeSha256,sha(scopeRaw));same(claim.native,{scopeSha256:native.onlineScope.sha256,claimSha256:native.activeClaimSha256});
    same(scope.scope.runtimeId,native.onlineScope.scope.runtimeId);same(scope.scope.image,native.onlineScope.scope.image);
    same(native.phase,'QUIESCENT');same(work.phase,'QUIESCENT');same(native.nativeReaped,true);
    assert.ok(hex(native.activeClaimSha256));same(native.guardian.pid,value.originalPopenPid);
    if(index<2){same(native.databaseQuiet,true);same(native.nativeStatus,0);same(native.stoppedBySignal,false);same(value.originalReturncode,0);}
    else{same(native.sqliteNativeClosed,true);same(native.nativeStatus,143);same(native.stoppedBySignal,true);same(value.originalReturncode,128);same(value.naturalExitZero,false);}
    assert.ok(hex(native.onlineScope.sha256));assert.ok(hex(native.onlineScope.scope.runtimeId));
    return {runtimeId:native.onlineScope.scope.runtimeId,image:native.onlineScope.scope.image,database:native.onlineScope.scope.database,scopeSha256:native.onlineScope.sha256,nativeSha256:sha(nativeRaw),workSha256:sha(workRaw),
      ownedOutputs:{native:ownedBytes(nativeRaw),work:ownedBytes(workRaw),claim:ownedBytes(claimRaw),scope:ownedBytes(scopeRaw)},
      workClaimSha256:sha(claimRaw),workScopeSha256:sha(scopeRaw),
      activeClaimSha256:native.activeClaimSha256,guardian:native.guardian,nativeStatus:native.nativeStatus,stoppedBySignal:native.stoppedBySignal};
  });
}

/** Data-only strict protocol verifier. It does not mint a completion token. */
export function verifyOriginalIndependentSshProtocol(raw,expected){
  assert.ok(Buffer.isBuffer(raw)&&raw.length>0&&raw.length<=16*1024**2);
  const envelope=JSON.parse(raw);
  same(envelope.format,'sabalan-original-independent-ssh/v1');same(envelope.originalRemoteExitStatus,0);
  same(envelope.remoteControllerSha256,expected.remoteControllerSha256);same(envelope.remoteConfigurationSha256,expected.remoteConfigurationSha256);
  same(envelope.hostKeyBinding,'PINNED_PLINK_ENFORCED');same(envelope.enforcedHostKeySha256,expected.hostKeySha256);
  same(envelope.originalPlinkReturncode,0);assert.ok(Number.isSafeInteger(envelope.originalPlinkPid)&&envelope.originalPlinkPid>1);
  const launchRaw=Buffer.from(envelope.remoteStdoutBase64,'base64');same(launchRaw.toString('base64'),envelope.remoteStdoutBase64);
  const launch=JSON.parse(launchRaw);same(launch.format,'sabalan-original-independent-full-restore-launch/v1');same(launch.pass,true);
  same(launch.originalNodeReturncode,0);same(launch.productionAdmission,false);same(launch.retentionPublished,false);
  assert.ok(Number.isSafeInteger(launch.originalNodePid)&&launch.originalNodePid>1);
  const reportRaw=Buffer.from(launch.reportRawBase64,'base64');same(reportRaw.toString('base64'),launch.reportRawBase64);same(sha(reportRaw),launch.reportSha256);
  const report=JSON.parse(reportRaw);same(report.pass,true);same(report.phase,'COMPLETE');same(report.productionAdmission,false);same(report.retentionPublished,false);
  same(report.operation,expected.remote.operation);same(launch.operation,expected.remote.operation);
  same(report.configurationSha256,expected.remoteConfigurationSha256);let checkpointRaw=null,physicalOutputs=null;
  if(!expected.onlinePhysicalPoint){same(report.checkpointMetadataRawSha256,expected.checkpoint.metadataSha256);
  checkpointRaw=Buffer.from(report.checkpointTransportRawBase64,'base64');same(checkpointRaw.toString('base64'),report.checkpointTransportRawBase64);same(sha(checkpointRaw),expected.checkpoint.metadataSha256);
  const canonicalCheckpoint=readIndependentCheckpointTransport(checkpointRaw);same(report.checkpointMetadata,canonicalCheckpoint.metadata);same(report.checkpointCanonicalMetadataSha256,canonicalCheckpoint.sha256);same(canonicalCheckpoint.sha256,expected.checkpoint.canonicalMetadataSha256);
  same(report.sourceCheckpoint,expected.checkpoint.source);}else physicalOutputs=physicalReport(report,expected);
  same(report.recoveryHost,expected.recoveryHost);
  same(report.controllerSourcePins,expected.controllerSourcePins);same(report.workerSourcePins,expected.workerSourcePins);
  same(report.applicationStageOrder,transferOrder);same(launch.applicationStageOrder,transferOrder);same(envelope.applicationStageOrder,transferOrder);
  same(launch.imageTransfers,report.imageTransfers);const imageSources=expected.imageSources??{};
  const staged=Object.keys(imageSources).length;assert.ok(staged===0||staged===3);
  same(report.imageTransfers.length,staged);same(envelope.imageTransfers.length,staged);
  for(let sequence=0;sequence<staged;sequence++){
    const role=transferOrder[sequence],source=imageSources[role],transfer=expected.images[role].transfer;
    same(source.targetPath,transfer.cipherPath);same(source.bytes,transfer.cipherBytes);same(source.sha256,transfer.cipherSha256);
    const request={event:'IMAGE_TRANSFER_REQUEST',format:'sabalan-original-image-transfer/v1',operation:expected.remote.operation,role,sequence,path:source.targetPath,bytes:source.bytes,sha256:source.sha256};
    same(envelope.imageTransfers[sequence],{role,bytes:source.bytes,sha256:source.sha256,requestSha256:sha(frame(request)),originalSourceFdRetained:true});
    same(report.imageTransfers[sequence],{event:'IMAGE_TRANSFER_STORED',operation:expected.remote.operation,role,sequence,proof:{role,path:source.targetPath,bytes:source.bytes,sha256:source.sha256,fsyncFileAndDirectory:true,fullReadbackVerified:true}});
  }
  same(report.applicationStages,'SEQUENTIAL_SAME_RESTORED_POINT');same(report.applicationHasRecoveryPrivateKeyMount,false);
  same(report.recoveryMode,expected.onlinePhysicalPoint?'ONLINE_COHERENT_WAL':'PROTECTED_MAINTENANCE_COMPLETE');same(report.continuousWalQualified,false);
  same(report.proofDatabase,report.restoredDatabase);same(report.proofDatabase.name,'qa_application_restored_'+expected.remote.operation);
  assert.match(report.proofDatabase.oid,/^[1-9][0-9]*$/);assert.match(report.proofDatabase.systemIdentifier,/^[1-9][0-9]*$/);
  const ownedImageArchiveReceipts={};
  for(const role of ['backend','frontend','inquiry']){
    same(report.images[role].id,expected.images[role].id);same(report.images[role].receiptSha256,expected.images[role].receiptSha256);
    same(report.applicationHealth[role].image,expected.images[role].id);same(report.applicationHealth[role].declaredSourceCommit,expected.images[role].sourceCommit);same(report.applicationHealth[role].status,200);
    for(const key of ['sourceImageId','archiveGraph','archiveReceiptSha256','archiveReceiptBytes'])same(report.images[role][key],expected.images[role][key]);
    const raw=Buffer.from(report.originalImageArchiveReceipts[role],'base64');same(raw.toString('base64'),report.originalImageArchiveReceipts[role]);same(raw.length,expected.images[role].archiveReceiptBytes);same(sha(raw),expected.images[role].archiveReceiptSha256);
    const receipt=JSON.parse(raw);for(const key of ['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'])same(receipt[key],expected.images[role].archiveGraph[key]);
    ownedImageArchiveReceipts[role]=ownedBytes(raw);
  }
  same(report.postgresClosure.normalExit,true);same(report.postgresClosure.containerExitCode,0);same(report.postgresClosure.originalAttachCode,0);
  same(report.finalSql,{sessions:0,prepared:0});same(report.inquiryReadOnlyData.before,report.inquiryReadOnlyData.after);
  assert.ok(report.originalDockerProcesses.length&&report.originalDockerProcesses.every(row=>Number.isSafeInteger(row.pid)&&row.pid>1&&row.signal===null&&
    (row.kind==='REQUIRED_ZERO'?row.code===0:row.kind==='POSTGRES_READINESS'?[0,1,2].includes(row.code):row.kind==='CONTAINER_ATTACH'?[0,143].includes(row.code):false)));
  const rows=nativeRows(report);assert.equal(new Set(rows.map(row=>row.runtimeId)).size,rows.length);
  const canonicalRestoreRaw=Buffer.from(expected.onlinePhysicalPoint?report.originalPhysicalRestoreOutputRawBase64:report.canonicalRestoreOutputRawBase64,'base64'),baselineRaw=Buffer.from(report.restoredBaselineRawBase64,'base64');
  same(canonicalRestoreRaw.toString('base64'),expected.onlinePhysicalPoint?report.originalPhysicalRestoreOutputRawBase64:report.canonicalRestoreOutputRawBase64);same(baselineRaw.toString('base64'),report.restoredBaselineRawBase64);
  same(sha(baselineRaw),report.baseline.result.manifestSha256);same(JSON.parse(baselineRaw).capturedManifest.sha256,sha(canonicalRestoreRaw));
  if(!expected.onlinePhysicalPoint){same(JSON.parse(canonicalRestoreRaw).ok,true);same(JSON.parse(canonicalRestoreRaw).drill.checksum,report.sourceCheckpoint.checksum);}else same(JSON.parse(canonicalRestoreRaw).physicalReplayQualified,true);
  const sqlRaw=Buffer.from(report.originalNamespaceSqlObservation.rawBase64,'base64'),sql=JSON.parse(sqlRaw);
  same(sqlRaw.toString('base64'),report.originalNamespaceSqlObservation.rawBase64);same(sql.visible,true);same(sql.database,report.proofDatabase);same(sql.sessions,0);same(sql.prepared,0);
  same(report.originalNamespaceSqlObservation.originalExitCode,0);same(report.originalNamespaceSqlObservation.originalSignal,null);assert.ok(report.originalNamespaceSqlObservation.originalPid>1);
  same(sql.namespaces.map(row=>row.namespace).sort(),rows.slice(0,2).map(row=>JSON.parse(Buffer.from(row.ownedOutputs.scope.rawBase64,'base64')).scope.postgresApplicationName).sort());assert.ok(sql.namespaces.every(row=>row.sessions===0));
  same(rows[0].image,expected.images.backend.id);same(rows[1].image,expected.images.backend.id);same(rows[2].image,expected.images.inquiry.id);
  for(const row of rows)same(row.database,{name:report.proofDatabase.name,systemIdentifier:report.proofDatabase.systemIdentifier});
  return freeze({report,physicalOutputs,ownedImageArchiveReceipts,ownedCheckpointTransport:checkpointRaw?ownedBytes(checkpointRaw):null,ownedCanonicalRestoreOutput:ownedBytes(canonicalRestoreRaw),ownedRestoredBaseline:ownedBytes(baselineRaw),ownedNamespaceSqlObservation:ownedBytes(sqlRaw),ownedReport:ownedBytes(reportRaw),reportSha256:sha(reportRaw),launchSha256:sha(launchRaw),nativeClosures:rows,remoteOriginalNodePid:launch.originalNodePid,originalPlinkPid:envelope.originalPlinkPid});
}

/** Windows issuer's original SSH owner. It spawns its OWN fixed pinned worker;
 * callers cannot pass a ChildProcess, successful JSON, report path or signer. */
export async function runOriginalIndependentRestoreOverSsh({pythonExecutable,pythonExecutableSha256,profilePath,profileSha256,controllerSourceSha256,workerSourceSha256,expected,password,onHeld=()=>{},onOriginalGuardianReady=()=>{},walStandalone=false,metadataPublication=null,pointTransfer}){
  pythonExecutable=path.resolve(pythonExecutable);profilePath=path.resolve(profilePath);expected=structuredClone(expected);
  if(expected.onlinePhysicalPoint&&!walStandalone&&!metadataPublication){const transferred=readOriginalIndependentPhysicalPointTransfer(pointTransfer);same(expected,transferred.expected);}
  assert.equal(process.platform,'win32');assert.ok(hex(pythonExecutableSha256)&&hex(profileSha256)&&hex(controllerSourceSha256)&&hex(workerSourceSha256));
  for(const file of [pythonExecutable,profilePath,ownFile,workerFile,transferHelperFile])assert.equal(fs.realpathSync(file),file);
  const source=fs.readFileSync(ownFile),worker=fs.readFileSync(workerFile),transferHelper=fs.readFileSync(transferHelperFile);const transferHelperSha256=sha(transferHelper);same(transferHelperSha256,expected.workerSourcePins['independent-image-transfer.py']);same(sha(source),controllerSourceSha256);same(sha(worker),workerSourceSha256);
  same(sha(fs.readFileSync(pythonExecutable)),pythonExecutableSha256);
  const profileRaw=fs.readFileSync(profilePath);same(sha(profileRaw),profileSha256);const profile=JSON.parse(profileRaw);
  same(profile.format,'sabalan-independent-fixed-ssh-profile/v1');same(profile.host,'94.182.177.74');same(profile.user,'root');same(profile.port,22);same(profile.hostKeySha256,expected.hostKeySha256);
  const plink=path.resolve('C:/Program Files/PuTTY/plink.exe');same(profile.plinkExecutable,plink);same(fs.realpathSync(plink),plink);assert.ok(hex(profile.plinkExecutableSha256));same(sha(fs.readFileSync(plink)),profile.plinkExecutableSha256);
  assert.equal(typeof password,'string');assert.ok(password.length>0);assert.equal(typeof onHeld,'function');
  const bootstrap="import hashlib,pathlib,sys; p=pathlib.Path(sys.argv[1]); raw=p.read_bytes(); assert hashlib.sha256(raw).hexdigest()==sys.argv[2]; sys.argv=[str(p)]; exec(compile(raw,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})";
  const child=spawn(pythonExecutable,['-I','-B','-c',bootstrap,workerFile,workerSourceSha256],{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout=[],stderr=[],outBytes=0,errBytes=0,held=null,keeper,lineBuffer=Buffer.alloc(0),guardian;
  assert.equal(typeof walStandalone,'boolean');assert.ok(!metadataPublication||!walStandalone);const live=!metadataPublication&&(!!expected.onlinePhysicalPoint||walStandalone);
  let closeResolve;const normalClosure=new Promise(resolve=>{closeResolve=resolve;});
  function hold(error){if(!held){held=error;if(guardian)guardian.held=error;keeper=setInterval(()=>{void child;},30000);onHeld({phase:'HELD',code:error.message,originalSshPid:child.pid,productionAdmission:false});}}
  function send(value){assert.ok(live&&!held&&child.exitCode===null&&child.signalCode===null&&!child.stdin.destroyed,'ORIGINAL_GUARDIAN_NOT_LIVE');child.stdin.write(frame(value));}
  function event(value){
    if(value.event==='ORIGINAL_GUARDIAN_HELD')throw Error('ORIGINAL_INDEPENDENT_GUARDIAN_HELD');
    if(value.event==='INDEPENDENT_GUARDIAN_READY'){
      assert.ok(live&&!guardian);same(value.operation,expected.remote.operation);for(const key of ['originalGuardianPid','originalPlinkPid'])assert.ok(Number.isInteger(value[key])&&value[key]>1);if(walStandalone){same(value.standalone,true);same(value.originalNodePid,null);}else assert.ok(Number.isInteger(value.originalNodePid)&&value.originalNodePid>1);
      guardian={child,held:null,closing:false,closed:false,standalone:walStandalone,normalClosure,certificateResults:new Map(),identity:freeze({...value,originalOwnerPid:child.pid}),pending:new Map(),send,sourcePins:structuredClone(expected.workerSourcePins)};
      const token=Object.freeze({});guardians.set(token,guardian);onOriginalGuardianReady(token);return;
    }
    assert.ok(guardian&&!held);
    if(value.event==='WAL_WINDOW_RESULT'){
      const row=guardian.pending.get(value.requestSha256);assert.ok(row&&!row.verified);same(value.originalVerifierReturncode,0);same(value.originalVerifierSignal,null);same(value.originalPipesClosed,true);assert.ok(value.originalVerifierPid>1);
      same(value.verifierSourceSha256,guardian.sourcePins['independent-wal-window.worker.cjs']);
      const raw=Buffer.from(value.reportRawBase64,'base64');same(raw.toString('base64'),value.reportRawBase64);same(sha(raw),value.reportSha256);
      const report=JSON.parse(raw);for(const key of ['requestSha256','challenge','windowSha256','sourceIdentity','objects'])same(report[key],key==='requestSha256'?row.source.requestSha256:row.source.request[key]);
      same(report.format,'sabalan-original-independent-wal-window-verification/v1');for(const key of ['independentRsaDecryptVerified','fullGcmAuthenticated','fullCipherReadbackVerified','exactContiguousWalVerified','allCiphertextsRetained'])same(report[key],true);
      const sealed=JSON.parse(Buffer.from(row.source.ownedOutputs.seal.rawBase64,'base64'));same(report.rawObjects,sealed.objects.map(item=>({name:item.name,bytes:item.rawBytes,sha256:item.rawSha256,cipherBytes:item.encryptedBytes,cipherSha256:item.encryptedSha256})));same(report.range,sealed.range);
      same(report.physicalReplayQualified,false);same(report.productionAdmission,false);same(value.remoteDirectory,'/root/sabalan-recovery-private/native-qa/wal-windows/'+row.source.requestSha256);
      const source=row.source,record=freeze({format:'sabalan-original-independent-wal-window-completion/v1',requestSha256:source.requestSha256,request:structuredClone(source.request),challenge:source.request.challenge,windowSha256:source.request.windowSha256,sourceIdentity:structuredClone(source.request.sourceIdentity),objects:structuredClone(source.request.objects),
        ownedOutputs:{report:ownedBytes(raw),seal:structuredClone(source.ownedOutputs.seal),closure:structuredClone(source.ownedOutputs.closure)},
        originalControllers:[{pid:value.originalVerifierPid,code:0,signal:null,role:'independent-wal-verifier'}],parentOriginalLive:true,parentOriginal:guardian.identity,
        controllerSourceSha256,verifierSourceSha256:value.verifierSourceSha256,remoteDirectory:value.remoteDirectory,
        remoteObjects:source.request.objects.map(item=>({...item,path:value.remoteDirectory+'/ciphertexts/'+item.name})),productionAdmission:false});
      const token=Object.freeze({});windowCompleted.set(token,{record,guardian,row});row.verified=true;row.resolve(token);return;
    }
    if(value.event==='WAL_WINDOW_CERTIFICATE_STORED'){
      const row=guardian.pending.get(value.requestSha256);assert.ok(row?.verified&&row.certificate&&!row.acknowledged);
      same(value.certificateSha256,row.certificate.sha256);same(value.certificateBytes,row.certificate.bytes);same(value.fullReadbackVerified,true);same(value.fsyncFileAndDirectory,true);same(value.originalCertificateVerifierReturncode,0);same(value.originalCertificateVerifierSignal,null);assert.ok(value.originalCertificateVerifierPid>1);assert.ok(hex(value.dependencySha256));
      same(value.remoteCertificateFile,'/root/sabalan-recovery-private/native-qa/wal-windows/'+value.requestSha256+'/certificate.json');same(value.remoteDependencyFile,'/root/sabalan-recovery-private/native-qa/wal-windows/'+value.requestSha256+'/dependency.json');
      if(value.repositoryDependencyFile){same(value.repositoryDependencyFile,'/srv/sabalanerp-recovery/checkpoints/online-'+expected.onlinePhysicalPoint.captureId+'/wal-windows/'+value.requestSha256+'/dependency.json');assert.ok(hex(value.repositoryDependencySha256));}
      row.acknowledged=true;guardian.certificateResults.set(value.requestSha256,freeze({...value}));row.ackResolve(freeze({...value}));guardian.pending.delete(value.requestSha256);return;
    }
    if(value.event==='WAL_WINDOW_DRAIN_REQUEST'){same(value.operation,expected.remote.operation);assert.ok(!guardian.closing);guardian.closing=true;send({event:'WAL_WINDOW_PRODUCER_DRAINED'});return;}
    if(value.event==='ORIGINAL_GUARDIAN_INPUT_CLOSE_REQUEST'){assert.ok(guardian.closing&&guardian.pending.size===0);send({event:'ORIGINAL_GUARDIAN_INPUT_CLOSED'});child.stdin.end();return;}
    throw Error('ORIGINAL_GUARDIAN_EVENT_REFUSED');
  }
  child.on('error',hold);child.stdin.on('error',hold);
  child.stdout.on('data',raw=>{try{outBytes+=raw.length;assert.ok(outBytes<=32*1024**2,'ORIGINAL_SSH_OUTPUT_BOUND');lineBuffer=Buffer.concat([lineBuffer,raw]);for(;;){const index=lineBuffer.indexOf(10);if(index<0)break;const line=lineBuffer.subarray(0,index+1);lineBuffer=lineBuffer.subarray(index+1);const value=JSON.parse(line);if(value.event)event(value);else stdout.push(line);}}catch(error){hold(error);}});
  child.stderr.on('data',raw=>{errBytes+=raw.length;if(errBytes>65536){hold(Error('ORIGINAL_SSH_STDERR_BOUND'));return;}stderr.push(raw);});
  const request={profile,password,transferHelperSha256,imageSources:walStandalone||metadataPublication?{}:expected.imageSources??{},remote:expected.remote,remoteControllerSha256:expected.remoteControllerSha256,remoteConfigurationSha256:expected.remoteConfigurationSha256,...(live?{liveGuardian:true}:{}),...(walStandalone?{walStandalone:true}:{}),...(metadataPublication?{metadataPublication}:{})};
  if(live)child.stdin.write(frame(request));else child.stdin.end(frame(request));password=undefined;request.password=undefined;
  const result=await new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  try{
    if(guardian)guardian.closed=true;same(held,null);same(lineBuffer.length,0);same(result,{code:0,signal:null});if(live)assert.ok(guardian&&guardian.closing&&guardian.pending.size===0);same(sha(fs.readFileSync(ownFile)),controllerSourceSha256);same(sha(fs.readFileSync(workerFile)),workerSourceSha256);same(sha(fs.readFileSync(transferHelperFile)),transferHelperSha256);same(sha(fs.readFileSync(profilePath)),profileSha256);same(sha(fs.readFileSync(pythonExecutable)),pythonExecutableSha256);same(sha(fs.readFileSync(plink)),profile.plinkExecutableSha256);
    if(metadataPublication){
      const raw=Buffer.concat(stdout),envelope=JSON.parse(raw);same(envelope.format,'sabalan-original-independent-ssh/v1');same(envelope.originalRemoteExitStatus,0);same(envelope.originalPlinkReturncode,0);assert.ok(envelope.originalPlinkPid>1);
      same(envelope.remoteControllerSha256,expected.remoteControllerSha256);same(envelope.remoteConfigurationSha256,expected.remoteConfigurationSha256);same(envelope.enforcedHostKeySha256,expected.hostKeySha256);same(envelope.hostKeyBinding,'PINNED_PLINK_ENFORCED');same(envelope.imageTransfers,[]);
      const remoteRaw=Buffer.from(envelope.remoteStdoutBase64,'base64');same(remoteRaw.toString('base64'),envelope.remoteStdoutBase64);const report=JSON.parse(remoteRaw);
      if(metadataPublication.format==='sabalan-original-independent-physical-point-transfer-input/v1'){
        const source=metadataPublication;const r=source.request;same(report.format,'sabalan-original-independent-physical-point-transfer/v1');same(report.productionAdmission,false);same(report.requestSha256,source.requestSha256);same(report.challenge,r.challenge);same(report.captureId,r.captureId);same(report.cipherInventorySha256,source.cipherInventorySha256);same(report.sourceOriginalPid,source.sourceOriginalPid);same(report.sourceRuntimeId,source.sourceRuntimeId);same(report.initialWindowBindings.map(({bindingFile,bindingSha256,...row})=>row),source.initialWindows);for(const row of report.initialWindowBindings){assert.ok(hex(row.bindingSha256));same(row.bindingFile,row.dependencyFile.replace(/dependency\.json$/,'point-binding.json'));}same(report.fullCipherReadbackVerified,true);same(report.fsyncFileAndDirectory,true);
        const root='/root/sabalan-recovery-private/native-qa/online-point-'+r.captureId;const point=report.onlinePhysicalPoint;
        same(point,{sourceRuntimeId:source.sourceRuntimeId,captureId:r.captureId,postgresUser:source.postgresUser,root,sealedFile:root+'/sealed.json',manifestFile:root+'/manifest.json',producerFile:root+'/producer.json',sealedSha256:source.ownedOutputs.sealedManifest.sha256,manifestSha256:source.ownedOutputs.plaintextManifest.sha256,producerSha256:source.ownedOutputs.producer.sha256,sourceHost:source.sourceHost,cipherPaths:Object.fromEntries(source.files.map(row=>[row.name,root+'/ciphertexts/'+row.name+'.sabrec']))});
        same(report.transferProofs,source.files.map(row=>({role:row.name,path:point.cipherPaths[row.name],bytes:row.bytes,sha256:row.sha256,fsyncFileAndDirectory:true,fullReadbackVerified:true})));
        const configurationRaw=Buffer.from(report.configurationRawBase64,'base64');same(configurationRaw.toString('base64'),report.configurationRawBase64);same(sha(configurationRaw),report.configurationSha256);same(report.configurationFile,root+'/full-restore-input.json');const cfg=JSON.parse(configurationRaw);same(cfg.operation,source.operation);same(cfg.onlinePhysicalPoint,point);same(cfg.controllerFiles,expected.controllerSourcePins);same(cfg.sourcePins,expected.workerSourcePins);
        for(const role of ['backend','frontend','inquiry']){same(cfg.images[role].id,expected.images[role].id);same(cfg.images[role].archiveGraph,expected.images[role].archiveGraph);same(cfg.images[role].receiptSha256,expected.images[role].receiptSha256);same(cfg.images[role].transfer.cipherPath,'/root/sabalan-recovery-private/native-qa/full-restore-'+source.operation+'/staged-ciphers/'+role+'.sabrec');}
        const record=freeze({...report,controllerSourceSha256,historySha256:sha(raw),ownedOutputs:{report:ownedBytes(remoteRaw),protocol:ownedBytes(raw),configuration:ownedBytes(configurationRaw),...source.ownedOutputs},originalControllers:[{pid:child.pid,code:0,signal:null,role:'ssh-owner'},{pid:envelope.originalPlinkPid,code:0,signal:null,role:'ssh'}]});clearInterval(keeper);return record;
      }
      if(['sabalan-original-physical-certification-input/v1','sabalan-original-terminal-coverage-persistence-input/v1'].includes(metadataPublication.format)){
        const terminal=metadataPublication.format==='sabalan-original-terminal-coverage-persistence-input/v1';same(report.format,terminal?'sabalan-original-independent-terminal-coverage-ack/v1':'sabalan-original-independent-physical-certification-ack/v1');same(report.productionAdmission,false);
        for(const key of ['pointIndexSha256','canonicalMetadataSha256'])same(report[key],metadataPublication[key]);same(report.originalPublicVerifier.code,0);same(report.originalPublicVerifier.signal,null);assert.ok(report.originalPublicVerifier.pid>1);for(const key of ['allIndexedObjectsRehashed','fullReadbackVerified','fsyncFileAndDirectory'])same(report[key],true);
        const target='/srv/sabalanerp-recovery/checkpoints/online-'+expected.onlinePhysicalPoint.captureId;
        let owned;
        if(terminal){same(report.allWindowObjectsRehashed,true);same(report.terminalResultSha256,metadataPublication.terminalResultSha256);same(report.remoteTerminalCoverageFile,target+'/terminal-coverage.json');const receipt=Buffer.from(report.terminalCoverageRawBase64,'base64');same(receipt.toString('base64'),report.terminalCoverageRawBase64);same(sha(receipt),report.terminalCoverageSha256);const accepted=JSON.parse(receipt);same(accepted.format,'sabalan-accepted-online-terminal-coverage/v1');same(accepted.envelope,metadataPublication.envelope);assert.ok(Date.parse(accepted.acceptedAt)>=Date.parse(accepted.envelope.decision.issuedAt)&&Date.parse(accepted.acceptedAt)<Date.parse(accepted.envelope.decision.expiresAt));same([...report.windows].sort((a,b)=>a.requestSha256.localeCompare(b.requestSha256)),[...metadataPublication.envelope.decision.windows].sort((a,b)=>a.requestSha256.localeCompare(b.requestSha256)));owned={terminalCoverage:ownedBytes(receipt)};}
        else{same(report.materialIndexSha256,metadataPublication.materialIndexSha256);same(report.remoteCertificationFile,target+'/certification.json');const receipt=Buffer.from(report.certificationRawBase64,'base64');same(receipt.toString('base64'),report.certificationRawBase64);same(sha(receipt),report.certificationSha256);const certification=JSON.parse(receipt);same(certification.format,'sabalan-online-recovery-point-certification/v1');same(certification.pointIndexSha256,metadataPublication.pointIndexSha256);same(certification.materialIndexSha256,metadataPublication.materialIndexSha256);same(certification.canonicalMetadataSha256,metadataPublication.canonicalMetadataSha256);same(certification.certificates,report.certificates);for(const role of ['physical','repository','metadataPublication']){const descriptor=report.certificates[role],envelope=metadataPublication.certificates[role];same(descriptor.sha256,sha(frame(envelope)));assert.ok(Date.parse(descriptor.acceptedAt)>=Date.parse(envelope.decision.issuedAt)&&Date.parse(descriptor.acceptedAt)<Date.parse(envelope.decision.expiresAt));}owned={certification:ownedBytes(receipt)};}
        const record=freeze({...report,controllerSourceSha256,historySha256:sha(raw),ownedOutputs:{report:ownedBytes(remoteRaw),protocol:ownedBytes(raw),...owned},originalControllers:[{pid:child.pid,code:0,signal:null,role:'ssh-owner'},{pid:envelope.originalPlinkPid,code:0,signal:null,role:'ssh'}]});clearInterval(keeper);return record;
      }
      const promotion=metadataPublication.format==='sabalan-original-physical-repository-promotion-input/v1';same(report.format,promotion?'sabalan-original-independent-physical-repository-promotion/v1':'sabalan-original-independent-physical-metadata-publication/v1');same(report.productionAdmission,false);for(const key of [...(promotion?[]:['canonicalMetadataSha256']),'sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256','physicalCompletionSha256'])same(report[key],metadataPublication[key]);
      for(const key of ['allRetainedCiphertextsRehashed','fsyncFileAndDirectory','fullReadbackVerified'])same(report[key],true);
      const target='/srv/sabalanerp-recovery/checkpoints/online-'+expected.onlinePhysicalPoint.captureId;same(report.repositoryDirectory,target);same(report.productionMountDirectory,'/mnt/sabalanerp-independent-recovery/online-'+expected.onlinePhysicalPoint.captureId);
      const custodyRaw=Buffer.from(report.custodyRawBase64,'base64');same(custodyRaw.toString('base64'),report.custodyRawBase64);same(sha(custodyRaw),report.custodySha256);const custody=JSON.parse(custodyRaw);same(custody.physicalCompletionSha256,metadataPublication.physicalCompletionSha256);same(custody.destinationDirectory,target);
      if(promotion){
        const materialRaw=Buffer.from(report.materialIndexRawBase64,'base64');same(materialRaw.toString('base64'),report.materialIndexRawBase64);same(sha(materialRaw),report.materialIndexSha256);const material=JSON.parse(materialRaw);
        same(material.format,'sabalan-online-recovery-material/v1');same(material.captureId,expected.onlinePhysicalPoint.captureId);same(material.physicalCompletionSha256,metadataPublication.physicalCompletionSha256);same(material.custodySha256,report.custodySha256);same(material.cipherInventorySha256,metadataPublication.cipherInventorySha256);
        same(report.repositoryDescriptor,{format:'sabalan-online-checkpoint-directory/v1',captureId:expected.onlinePhysicalPoint.captureId,repository:'independent-recovery',mountPath:report.productionMountDirectory,sftpPath:'/checkpoints/online-'+expected.onlinePhysicalPoint.captureId,sealedManifestSha256:metadataPublication.sealedManifestSha256,plaintextManifestSha256:metadataPublication.plaintextManifestSha256,cipherInventorySha256:metadataPublication.cipherInventorySha256,materialIndexSha256:report.materialIndexSha256});
        const names=new Set();for(const row of material.objects){assert.ok(typeof row.relativePath==='string'&&!row.relativePath.startsWith('/')&&!row.relativePath.includes('\\')&&!row.relativePath.split('/').some(part=>part==='..'||part===''||part==='.')&&!names.has(row.relativePath));names.add(row.relativePath);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>0&&hex(row.sha256));}
        for(const role of ['backend','frontend','inquiry']){same(material.images[role].archiveGraph,metadataPublication.publicationInputs.imageGraphs[role]);same(material.images[role].cipherSha256,metadataPublication.publicationInputs.imageCipherSources[role].sha256);same(material.images[role].cipherBytes,metadataPublication.publicationInputs.imageCipherSources[role].bytes);}
        const record=freeze({...report,repository:report.repositoryDescriptor,controllerSourceSha256,historySha256:sha(raw),ownedOutputs:{report:ownedBytes(remoteRaw),protocol:ownedBytes(raw),materialIndex:ownedBytes(materialRaw),custody:ownedBytes(custodyRaw)},originalControllers:[{pid:child.pid,code:0,signal:null,role:'ssh-owner'},{pid:envelope.originalPlinkPid,code:0,signal:null,role:'ssh'}]});clearInterval(keeper);return record;
      }
      same(report.repositoryDescriptor,metadataPublication.repositoryDescriptor);same(report.repositoryPromotionSha256,metadataPublication.repositoryPromotionSha256);same(report.materialIndexSha256,metadataPublication.materialIndexSha256);const pointIndexRaw=Buffer.from(report.pointIndexRawBase64,'base64');same(pointIndexRaw.toString('base64'),report.pointIndexRawBase64);same(sha(pointIndexRaw),report.pointIndexSha256);const pointIndex=JSON.parse(pointIndexRaw);same(pointIndex.format,'sabalan-online-recovery-point/v1');same(pointIndex.canonicalMetadataSha256,metadataPublication.canonicalMetadataSha256);same(pointIndex.materialIndexSha256,metadataPublication.materialIndexSha256);same(pointIndex.physicalCompletionSha256,metadataPublication.physicalCompletionSha256);
      same(report.remoteMetadataFile,target+'/canonical-checkpoint.json');const metadataRaw=Buffer.from(report.metadataRawBase64,'base64');same(metadataRaw.toString('base64'),report.metadataRawBase64);same(metadataRaw.length,report.remoteMetadataBytes);same(sha(metadataRaw),report.remoteMetadataSha256);
      const stored=JSON.parse(metadataRaw);same(stored,{...JSON.parse(Buffer.from(metadataPublication.canonicalMetadataRawBase64,'base64')),canonicalMetadata:JSON.parse(Buffer.from(metadataPublication.canonicalMetadataRawBase64,'base64')),canonicalMetadataSha256:metadataPublication.canonicalMetadataSha256});same(stored.canonicalMetadataSha256,metadataPublication.canonicalMetadataSha256);same(stored.canonicalMetadata,JSON.parse(Buffer.from(metadataPublication.canonicalMetadataRawBase64,'base64')));same(sha(Buffer.from(JSON.stringify(canonical(stored.canonicalMetadata)))),stored.canonicalMetadataSha256);
      const record=freeze({...report,controllerSourceSha256,historySha256:sha(raw),ownedOutputs:{report:ownedBytes(remoteRaw),protocol:ownedBytes(raw),metadata:ownedBytes(metadataRaw),pointIndex:ownedBytes(pointIndexRaw),custody:ownedBytes(custodyRaw)},originalControllers:[{pid:child.pid,code:0,signal:null,role:'ssh-owner'},{pid:envelope.originalPlinkPid,code:0,signal:null,role:'ssh'}]});clearInterval(keeper);return record;
    }
    if(walStandalone){
      const raw=Buffer.concat(stdout),envelope=JSON.parse(raw);same(envelope.format,'sabalan-original-independent-ssh/v1');same(envelope.originalRemoteExitStatus,0);same(envelope.originalPlinkReturncode,0);same(envelope.originalPlinkPid,guardian.identity.originalPlinkPid);
      same(envelope.remoteControllerSha256,expected.remoteControllerSha256);same(envelope.remoteConfigurationSha256,expected.remoteConfigurationSha256);same(envelope.enforcedHostKeySha256,expected.hostKeySha256);same(envelope.hostKeyBinding,'PINNED_PLINK_ENFORCED');same(envelope.imageTransfers,[]);
      const remoteRaw=Buffer.from(envelope.remoteStdoutBase64,'base64');same(remoteRaw.toString('base64'),envelope.remoteStdoutBase64);const report=JSON.parse(remoteRaw);
      same(report.format,'sabalan-original-independent-wal-window-launch/v1');same(report.pass,true);same(report.productionAdmission,false);same(report.operation,expected.remote.operation);same(report.originalGuardianPid,guardian.identity.originalGuardianPid);same(report.originalVerifierReturncode,0);same(report.originalCertificateVerifierReturncode,0);
      const certificate=guardian.certificateResults.get(report.requestSha256);assert.ok(certificate&&guardian.certificateResults.size===1);same(report.originalCertificateVerifierPid,certificate.originalCertificateVerifierPid);same(report.certificateSha256,certificate.certificateSha256);same(report.dependencySha256,certificate.dependencySha256);same(report.remoteDependencyFile,certificate.remoteDependencyFile);
      const closed=freeze({format:'sabalan-original-independent-wal-standalone-closure/v1',originalControllers:[{pid:child.pid,code:0,signal:null,role:'ssh-owner'},{pid:envelope.originalPlinkPid,code:0,signal:null,role:'ssh'}],ownedOutput:ownedBytes(raw),remoteOutput:ownedBytes(remoteRaw),productionAdmission:false});guardian.normalClosed=true;guardian.normalClosureRecord=closed;closeResolve(closed);clearInterval(keeper);return closed;
    }
    const raw=Buffer.concat(stdout),value=verifyOriginalIndependentSshProtocol(raw,expected);
    const closureHashes=Object.fromEntries(value.nativeClosures.flatMap(row=>[['original-native/'+row.runtimeId,row.nativeSha256],['original-work/'+row.runtimeId,row.workSha256],['original-work-claim/'+row.runtimeId,row.workClaimSha256],['original-work-scope/'+row.runtimeId,row.workScopeSha256]]));
    const roles=['backend','frontend','inquiry'];
    const physical=!!expected.onlinePhysicalPoint;
    const record=freeze({format:physical?'sabalan-original-independent-physical-ssh-completion/v1':'sabalan-original-independent-ssh-completion/v1',controllerSourceSha256,historySha256:sha(raw),
      originalControllers:[{pid:child.pid,code:0,signal:null,role:'ssh-owner'},{pid:value.originalPlinkPid,code:0,signal:null,role:'ssh'}],fileHashes:{[ownFile]:controllerSourceSha256,[workerFile]:workerSourceSha256,[transferHelperFile]:transferHelperSha256,[profilePath]:profileSha256,[pythonExecutable]:pythonExecutableSha256,[plink]:profile.plinkExecutableSha256,...expected.workerSourcePins,...expected.controllerSourcePins,
        ['original-ssh-protocol/'+expected.remote.operation]:sha(raw),['original-remote-report/'+expected.remote.operation]:value.reportSha256,...(physical?Object.fromEntries(Object.entries(value.physicalOutputs).map(([name,row])=>['original-physical-'+name+'/'+expected.remote.operation,row.sha256])):{['original-checkpoint-transport/'+expected.remote.operation]:value.ownedCheckpointTransport.sha256}),['original-canonical-restore-output/'+expected.remote.operation]:value.ownedCanonicalRestoreOutput.sha256,['original-restored-baseline/'+expected.remote.operation]:value.ownedRestoredBaseline.sha256,['original-namespace-sql/'+expected.remote.operation]:value.ownedNamespaceSqlObservation.sha256,...closureHashes,
        ...Object.fromEntries(roles.map(role=>[expected.images[role].archiveReceiptPath,expected.images[role].archiveReceiptSha256]))},
      nativeClosures:value.nativeClosures,ownedOutputs:{report:value.ownedReport,...(physical?value.physicalOutputs:{checkpointTransport:value.ownedCheckpointTransport,canonicalRestoreOutput:value.ownedCanonicalRestoreOutput}),restoredBaseline:value.ownedRestoredBaseline,namespaceSqlObservation:value.ownedNamespaceSqlObservation,...Object.fromEntries(roles.map(role=>['imageArchiveReceipt-'+role,value.ownedImageArchiveReceipts[role]]))},...(!physical?{checkpointMetadata:value.report.checkpointMetadata}:{sealedManifestSha256:value.report.sealedManifestSha256,plaintextManifestSha256:value.report.plaintextManifestSha256,cipherInventorySha256:value.report.cipherInventorySha256,sourceDatabase:value.report.sourceDatabase,restorePoint:value.report.restorePoint,
        remotePointDirectory:value.report.sealedSourceCustody.actualRoot,remoteSealedManifestFile:value.report.sealedSourceCustody.sealedFile,remotePlaintextManifestFile:value.report.sealedSourceCustody.manifestFile,cipherPaths:structuredClone(expected.onlinePhysicalPoint.cipherPaths)}),
      ...(physical?{imageCipherSources:Object.fromEntries(roles.map(role=>{const t=expected.images[role].transfer;assert.ok(t);return [role,{path:t.cipherPath,bytes:t.cipherBytes,sha256:t.cipherSha256,metadataPath:t.metadataPath,metadataSha256:t.metadataSha256}];}))}:{}),
      recoveryMode:value.report.recoveryMode,proofDatabase:value.report.proofDatabase,restoredDatabase:value.report.restoredDatabase,
      ...(!physical?{checkpoint:{...expected.checkpoint.source,metadataSha256:value.report.checkpointCanonicalMetadataSha256,transportSha256:expected.checkpoint.metadataSha256}}:{}),
      images:Object.fromEntries(roles.map(role=>[role,expected.images[role].id])),sourceImages:Object.fromEntries(roles.map(role=>[role,expected.images[role].sourceImageId])),
      imageGraphs:Object.fromEntries(roles.map(role=>[role,structuredClone(expected.images[role].archiveGraph)])),
      imageArchiveReceipts:Object.fromEntries(roles.map(role=>[role,{file:expected.images[role].archiveReceiptPath,bytes:expected.images[role].archiveReceiptBytes,sha256:expected.images[role].archiveReceiptSha256}])),
      remoteControllerSourceSha256:expected.remoteControllerSha256,remoteConfigurationSha256:expected.remoteConfigurationSha256,
      remoteOriginalNodePid:value.remoteOriginalNodePid,reportSha256:value.reportSha256,originalProtocolSha256:sha(raw),productionAdmission:false});
    const token=Object.freeze({});(physical?physicalCompleted:completed).set(token,record);if(guardian){guardian.normalClosed=true;guardian.normalClosureRecord=freeze({originalControllers:record.originalControllers,historySha256:record.historySha256});}closeResolve({originalControllers:record.originalControllers,historySha256:record.historySha256});clearInterval(keeper);return token;
  }catch(error){hold(error);throw error;}
}
export async function runOriginalIndependentPhysicalRestoreOverSsh(options){
  const transferred=readOriginalIndependentPhysicalPointTransfer(options.pointTransfer);const expected=structuredClone(transferred.expected);
  same(options.expected.remoteControllerSha256,transferred.remoteControllerSourceSha256);same(options.expected.hostKeySha256,expected.hostKeySha256);
  return runOriginalIndependentRestoreOverSsh({...options,expected});
}

async function readOriginalPointSource(token){
 const local=await import('./original-local-online-checkpoint.mjs');
 if(local.isOriginalLocalOnlinePhysicalPointSource(token))return await local.readOriginalLocalOnlinePhysicalPointSource(token);
 return (await import('./original-protected-online-ssh.mjs')).readOriginalProtectedPhysicalPointSource(token);
}
async function readOriginalWindowSource(token){
 const local=await import('./original-local-online-checkpoint.mjs');
 if(local.isOriginalLocalOnlineWalWindowSource(token))return await local.readOriginalLocalOnlineWalWindowSource(token);
 return (await import('./original-protected-online-ssh.mjs')).readOriginalProtectedWalWindowSource(token);
}

/** Only the original physical factory can mint this live guardian token. */
export async function runOriginalIndependentGuardianWalWindow({independentGuardian,sourceWindow}){
  const guardian=guardians.get(independentGuardian);assert.ok(guardian,'ORIGINAL_INDEPENDENT_GUARDIAN_UNPROVEN');
  assertGuardianLive(guardian);assert.ok(!guardian.closing,'ORIGINAL_INDEPENDENT_GUARDIAN_DRAINING');
  const source=await readOriginalWindowSource(sourceWindow);
  const sealRaw=Buffer.from(source.ownedOutputs.seal.rawBase64,'base64'),closureRaw=Buffer.from(source.ownedOutputs.closure.rawBase64,'base64');
  for(const [value,raw]of [[source.ownedOutputs.seal,sealRaw],[source.ownedOutputs.closure,closureRaw]]){same(value.bytes,raw.length);same(value.sha256,sha(raw));same(value.rawBase64,raw.toString('base64'));}
  validateWindow(source.request,sealRaw,closureRaw);same(source.requestSha256,sha(Buffer.from(JSON.stringify(canonical(source.request)))));
  assert.ok(!guardian.pending.has(source.requestSha256));
  const pending=new Promise((resolve,reject)=>guardian.pending.set(source.requestSha256,{source:structuredClone(source),resolve,reject,verified:false,acknowledged:false}));
  assert.ok(Number.isSafeInteger(source.sourceOriginalPid)&&source.sourceOriginalPid>0&&hex(source.sourceRuntimeId));
  guardian.send({event:'WAL_WINDOW_SEND',request:source.request,requestSha256:source.requestSha256,files:source.files,ownedOutputs:source.ownedOutputs,sourceOriginalPid:source.sourceOriginalPid,sourceRuntimeId:source.sourceRuntimeId});return pending;
}
function assertGuardianLive(guardian){assert.ok(!guardian.held&&!guardian.closed&&guardian.child.exitCode===null&&guardian.child.signalCode===null&&!guardian.child.stdin.destroyed,'ORIGINAL_INDEPENDENT_GUARDIAN_CUSTODY_LOST');}
export function readOriginalIndependentGuardianWalWindow(token){const value=windowCompleted.get(token);assert.ok(value,'ORIGINAL_INDEPENDENT_WAL_WINDOW_UNPROVEN');assertGuardianLive(value.guardian);return value.record;}
export async function acknowledgeOriginalIndependentGuardianWalWindow(token,certificate){
  const value=windowCompleted.get(token);assert.ok(value,'ORIGINAL_INDEPENDENT_WAL_WINDOW_UNPROVEN');assertGuardianLive(value.guardian);const row=value.row;assert.ok(row.verified&&!row.certificate&&!row.acknowledged);
  const raw=typeof certificate==='string'?Buffer.from(certificate):Buffer.isBuffer(certificate)?certificate:Buffer.from(JSON.stringify(canonical(certificate)));assert.ok(raw.length>0&&raw.length<=65536);JSON.parse(raw);
  row.certificate=ownedBytes(raw);const pending=new Promise(resolve=>{row.ackResolve=resolve;});value.guardian.send({event:'WAL_WINDOW_CERTIFICATE_ACK',requestSha256:row.source.requestSha256,certificate:row.certificate});const durable=await pending;const closed=value.guardian.standalone?await value.guardian.normalClosure:null;value.acknowledgement=freeze({format:'sabalan-original-independent-wal-window-acknowledgement/v1',...durable,request:row.source.request,requestSha256:row.source.requestSha256,sourceOriginalPid:row.source.sourceOriginalPid,sourceRuntimeId:row.source.sourceRuntimeId,certificate:row.certificate,originalVerifierControllers:value.record.originalControllers,parentOriginal:value.guardian.identity,...(closed?{originalStandaloneClosure:closed}:{parentOriginalLiveAtAcceptance:true}),productionAdmission:false});return value.acknowledgement;
}

export function originalIndependentGuardianAvailability(token){
 const value=guardians.get(token);assert.ok(value,'ORIGINAL_INDEPENDENT_GUARDIAN_UNPROVEN');
 if(value.held)throw Error('ORIGINAL_INDEPENDENT_GUARDIAN_HELD');if(value.closed)assert.ok(value.normalClosed,'ORIGINAL_INDEPENDENT_CLOSURE_NOT_QUALIFIED');
 return {live:!value.closed&&value.child.exitCode===null&&value.child.signalCode===null&&!value.child.stdin.destroyed,draining:value.closing};
}

function publicationSource(physicalCompletion,options){
 const physical=readOriginalIndependentPhysicalRestoreSshCompletion(physicalCompletion);assert.ok(options?.expected?.onlinePhysicalPoint);
 const expected=structuredClone(options.expected),point=expected.onlinePhysicalPoint;
 same(point.root,physical.remotePointDirectory);same(point.sealedFile,physical.remoteSealedManifestFile);same(point.manifestFile,physical.remotePlaintextManifestFile);same(point.sealedSha256,physical.sealedManifestSha256);same(point.manifestSha256,physical.plaintextManifestSha256);same(point.cipherPaths,physical.cipherPaths);
 same(expected.remoteControllerSha256,physical.remoteControllerSourceSha256);same(expected.remoteConfigurationSha256,physical.remoteConfigurationSha256);
 const common={sealedManifestSha256:physical.sealedManifestSha256,plaintextManifestSha256:physical.plaintextManifestSha256,cipherInventorySha256:physical.cipherInventorySha256,physicalCompletionSha256:sha(Buffer.from(JSON.stringify(canonical(physical))))};
 return {physical,expected,common};
}
export async function runOriginalIndependentPhysicalRepositoryPromotion({physicalCompletion,options}){
 const {physical,expected,common}=publicationSource(physicalCompletion,options);
 const material={format:'sabalan-original-physical-repository-promotion-input/v1',...common,publicationInputs:{imageCipherSources:physical.imageCipherSources,images:physical.images,sourceImages:physical.sourceImages,imageGraphs:physical.imageGraphs,imageArchiveReceipts:Object.fromEntries(['backend','frontend','inquiry'].map(role=>[role,physical.ownedOutputs['imageArchiveReceipt-'+role]])),physicalReport:physical.ownedOutputs.report,originalProducer:physical.ownedOutputs.originalProducer,sourceDatabase:physical.sourceDatabase,restorePoint:physical.restorePoint}};
 const record=await runOriginalIndependentRestoreOverSsh({...options,expected,walStandalone:false,metadataPublication:material});const token=Object.freeze({});repositoryCompleted.set(token,record);return token;
}
export function readOriginalIndependentPhysicalRepositoryPromotion(token){const value=repositoryCompleted.get(token);assert.ok(value,'ORIGINAL_PHYSICAL_REPOSITORY_PROMOTION_UNPROVEN');return value;}
export async function runOriginalIndependentPhysicalMetadataPublication({physicalCompletion,repositoryPromotion,canonicalMetadataRawBase64,options}){
 const {physical,expected,common}=publicationSource(physicalCompletion,options),promotion=readOriginalIndependentPhysicalRepositoryPromotion(repositoryPromotion);
 same(promotion.physicalCompletionSha256,common.physicalCompletionSha256);same(promotion.sealedManifestSha256,common.sealedManifestSha256);
 const raw=Buffer.from(canonicalMetadataRawBase64,'base64');same(raw.toString('base64'),canonicalMetadataRawBase64);assert.ok(raw.length>0&&raw.length<=8*1024**2);const metadata=JSON.parse(raw);
 same(metadata.captureMethod,'ONLINE_COHERENT_WAL');same(metadata.physicalPoint,{sealedManifestSha256:physical.sealedManifestSha256,plaintextManifestSha256:physical.plaintextManifestSha256,cipherInventorySha256:physical.cipherInventorySha256,restorePoint:physical.restorePoint});same(metadata.repositoryDirectory,promotion.repositoryDescriptor);same(metadata.remotePath,promotion.repositoryDescriptor.mountPath);
 const material={format:'sabalan-original-physical-metadata-publication-input/v1',...common,canonicalMetadataRawBase64,canonicalMetadataSha256:sha(Buffer.from(JSON.stringify(canonical(metadata)))),repositoryDescriptor:promotion.repositoryDescriptor,materialIndexSha256:promotion.materialIndexSha256,repositoryPromotionSha256:sha(Buffer.from(JSON.stringify(canonical(promotion))))};
 const record=await runOriginalIndependentRestoreOverSsh({...options,expected,walStandalone:false,metadataPublication:material});
 const token=Object.freeze({});metadataCompleted.set(token,record);return token;
}
export function readOriginalIndependentPhysicalMetadataPublication(token){const value=metadataCompleted.get(token);assert.ok(value,'ORIGINAL_PHYSICAL_METADATA_PUBLICATION_UNPROVEN');return value;}

export function readOriginalIndependentGuardianWalWindowAcknowledgement(token,{metadataCompletion}={}){
 const value=windowCompleted.get(token);assert.ok(value?.acknowledgement,'ORIGINAL_INDEPENDENT_WAL_ACKNOWLEDGEMENT_UNPROVEN');const guardian=value.guardian;
 if(!guardian.normalClosed)assertGuardianLive(guardian);assert.ok(!guardian.held);
 let result=value.acknowledgement;
 if(!result.repositoryDependencyFile&&metadataCompletion){
  const metadata=readOriginalIndependentPhysicalMetadataPublication(metadataCompletion),index=JSON.parse(Buffer.from(metadata.ownedOutputs.pointIndex.rawBase64,'base64'));
  const matches=index.initialWalWindows.filter(row=>row.requestSha256===result.requestSha256);same(matches.length,1);const row=matches[0];same(row.originalDependencySha256,result.dependencySha256);same(row.certificateSha256,result.certificate.sha256);
  result={...result,repositoryDependencyFile:metadata.repositoryDirectory+'/'+row.relativeDirectory+'/dependency.json',repositoryDependencySha256:row.sha256,repositoryCustodyCompletionSha256:sha(Buffer.from(JSON.stringify(canonical(metadata))))};
 }
 return freeze({...result,...(guardian.normalClosed?{originalParentClosure:guardian.normalClosureRecord}:{parentOriginalLive:true})});
}

export async function runOriginalIndependentPhysicalCertificateAcknowledgement({physicalCompletion,repositoryPromotion,metadataCompletion,physicalCertificate,repositoryCertificate,publicationCertificate,options}){
 const {physical,expected,common}=publicationSource(physicalCompletion,options),promotion=readOriginalIndependentPhysicalRepositoryPromotion(repositoryPromotion),metadata=readOriginalIndependentPhysicalMetadataPublication(metadataCompletion);
 same(metadata.physicalCompletionSha256,common.physicalCompletionSha256);same(promotion.physicalCompletionSha256,common.physicalCompletionSha256);
 const issuer=await import('../../deploy/scripts/online-qualification-origin-issuer.mjs');
 const certificates={physical:issuer.readOriginalPhysicalCheckpointVerification(physicalCertificate),repository:issuer.readOriginalPhysicalRepositoryPromotion(repositoryCertificate),metadataPublication:issuer.readOriginalPhysicalCheckpointPublication(publicationCertificate)};
 const wanted={...common,sourceDatabase:physical.sourceDatabase,restorePoint:physical.restorePoint,physicalReportSha256:physical.ownedOutputs.report.sha256,repositoryPromotionSha256:sha(Buffer.from(JSON.stringify(canonical(promotion)))),repositoryDescriptor:promotion.repositoryDescriptor,canonicalMetadataSha256:metadata.canonicalMetadataSha256,remoteMetadataFile:metadata.remoteMetadataFile,remoteMetadataSha256:metadata.remoteMetadataSha256};
 const material={format:'sabalan-original-physical-certification-input/v1',pointIndexSha256:metadata.pointIndexSha256,materialIndexSha256:metadata.materialIndexSha256,canonicalMetadataSha256:metadata.canonicalMetadataSha256,certificates,expected:wanted};
 const record=await runOriginalIndependentRestoreOverSsh({...options,expected,walStandalone:false,metadataPublication:material});const token=Object.freeze({});certificationCompleted.set(token,record);return token;
}
export function readOriginalIndependentPhysicalCertificateAcknowledgement(token){const value=certificationCompleted.get(token);assert.ok(value,'ORIGINAL_PHYSICAL_CERTIFICATION_ACKNOWLEDGEMENT_UNPROVEN');return value;}
export async function runOriginalIndependentTerminalWalCoveragePersistence({physicalCompletion,metadataCompletion,certificationCompletion,terminalCertificate,options}){
 const {physical,expected}=publicationSource(physicalCompletion,options),metadata=readOriginalIndependentPhysicalMetadataPublication(metadataCompletion),certification=readOriginalIndependentPhysicalCertificateAcknowledgement(certificationCompletion);
 same(certification.pointIndexSha256,metadata.pointIndexSha256);same(certification.canonicalMetadataSha256,metadata.canonicalMetadataSha256);
 const issuer=await import('../../deploy/scripts/online-qualification-origin-issuer.mjs'),envelope=issuer.readOriginalTerminalWalCoverageCertificate(terminalCertificate),source=issuer.readOriginalTerminalWalCoverageSource(terminalCertificate),raw=Buffer.from(source.rawBase64,'base64');same(raw.toString('base64'),source.rawBase64);same(raw.length,source.bytes);same(sha(raw),source.sha256);
 const terminal=JSON.parse(raw);same(envelope.decision.terminalResultSha256,source.sha256);same(envelope.decision.captureId,expected.onlinePhysicalPoint.captureId);same(envelope.decision.pointIndexSha256,metadata.pointIndexSha256);same(envelope.decision.canonicalMetadataSha256,metadata.canonicalMetadataSha256);same(envelope.decision.sourceDatabase,physical.sourceDatabase);same(envelope.decision.terminalEpochSha256,terminal.terminalEpochSha256);same(envelope.decision.publicationSha256,terminal.publicationSha256);
 const material={format:'sabalan-original-terminal-coverage-persistence-input/v1',pointIndexSha256:metadata.pointIndexSha256,canonicalMetadataSha256:metadata.canonicalMetadataSha256,certificationSha256:certification.certificationSha256,terminalRawBase64:source.rawBase64,terminalBytes:source.bytes,terminalResultSha256:source.sha256,envelope,expected:{captureId:expected.onlinePhysicalPoint.captureId,pointIndexSha256:metadata.pointIndexSha256,canonicalMetadataSha256:metadata.canonicalMetadataSha256,terminalResultSha256:source.sha256,sourceDatabase:physical.sourceDatabase,terminalEpochSha256:terminal.terminalEpochSha256,publicationSha256:terminal.publicationSha256,windows:envelope.decision.windows}};
 const record=await runOriginalIndependentRestoreOverSsh({...options,expected,walStandalone:false,metadataPublication:material});const token=Object.freeze({});terminalCompleted.set(token,record);return token;
}
export function readOriginalIndependentTerminalWalCoveragePersistence(token){const value=terminalCompleted.get(token);assert.ok(value,'ORIGINAL_TERMINAL_WAL_PERSISTENCE_UNPROVEN');return value;}

export async function runOriginalIndependentPhysicalPointTransfer({sourcePoint,options}){
 const source=await readOriginalPointSource(sourcePoint);
 const localSource=await import('./original-local-online-checkpoint.mjs');
 const acknowledgements=localSource.isOriginalLocalOnlinePhysicalPointSource(sourcePoint)
  ?localSource.readOriginalLocalOnlinePointWindowAcknowledgements(sourcePoint)
  :(await import('./original-protected-online-ssh.mjs')).readOriginalProtectedPointWindowAcknowledgements(sourcePoint);
 const initialWindows=acknowledgements.map(token=>{
  const row=readOriginalIndependentGuardianWalWindowAcknowledgement(token);
  same(row.sourceOriginalPid,source.sourceOriginalPid);same(row.sourceRuntimeId,source.sourceRuntimeId);
  return {requestSha256:row.requestSha256,dependencySha256:row.dependencySha256,dependencyFile:row.remoteDependencyFile,certificateSha256:row.certificate.sha256};
 });
 assert.ok(initialWindows.length>0&&new Set(initialWindows.map(row=>row.requestSha256)).size===initialWindows.length,'ORIGINAL_POINT_INITIAL_WINDOWS_REQUIRED');
 assert.ok(source.sourceHost&&/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(source.postgresUser),'ORIGINAL_PHYSICAL_SOURCE_HOST_AND_POSTGRES_USER_REQUIRED');
 for(const key of ['machineUuidSha256','kernelBootIdSha256'])assert.ok(hex(source.sourceHost[key]));
 const producer=JSON.parse(Buffer.from(source.ownedOutputs.producer.rawBase64,'base64')),sealed=JSON.parse(Buffer.from(source.ownedOutputs.sealedManifest.rawBase64,'base64')),manifest=JSON.parse(Buffer.from(source.ownedOutputs.plaintextManifest.rawBase64,'base64'));
 validatePhysicalPointProducer(producer,source.request.captureId,source.plaintextManifestSha256);createRequire(import.meta.url)('../../tests/online-deployment/independent-online-components.worker.cjs').validateOnlineSealedComponents(sealed,manifest,source.request.captureId);
 same(source.files.map(({name,sourcePath,bytes,sha256})=>({name,sourcePath,bytes,sha256})),sealed.objects.map(row=>({name:row.name,sourcePath:row.cipherFile,bytes:row.cipherBytes,sha256:row.cipherSha256})));
 const request={...source.request,objects:source.files.map(({name,sourcePath,bytes,sha256})=>({name,sourcePath,bytes,sha256}))};
 const material={format:'sabalan-original-independent-physical-point-transfer-input/v1',request,requestSha256:sha(Buffer.from(JSON.stringify(canonical(request)))),operation:randomBytes(16).toString('hex'),ownedOutputs:source.ownedOutputs,files:source.files,sourceHost:source.sourceHost,postgresUser:source.postgresUser,sourceOriginalPid:source.sourceOriginalPid,sourceRuntimeId:source.sourceRuntimeId,initialWindows,cipherInventorySha256:source.cipherInventorySha256};
 const record=await runOriginalIndependentRestoreOverSsh({...options,walStandalone:false,metadataPublication:material});
 // Source ownership must still be current at transfer closure, not merely at
 // the first path read. This does not adopt a saved production report.
 await readOriginalPointSource(sourcePoint);
 const expected=structuredClone(options.expected),cfg=JSON.parse(Buffer.from(record.ownedOutputs.configuration.rawBase64,'base64'));expected.onlinePhysicalPoint=record.onlinePhysicalPoint;expected.remote={...expected.remote,operation:cfg.operation,configurationPath:record.configurationFile};expected.remoteConfigurationSha256=record.configurationSha256;expected.images=cfg.images;
 for(const role of ['backend','frontend','inquiry']){assert.ok(expected.imageSources?.[role],'ORIGINAL_FINAL_IMAGE_CIPHER_SOURCE_REQUIRED');expected.imageSources[role].targetPath=cfg.images[role].transfer.cipherPath;}
 const value=freeze({...record,expected,remoteControllerSourceSha256:expected.remoteControllerSha256,sourceOriginalPid:source.sourceOriginalPid,sourceRequestSha256:material.requestSha256});const token=Object.freeze({});pointTransferred.set(token,value);return token;
}
export function readOriginalIndependentPhysicalPointTransfer(token){const value=pointTransferred.get(token);assert.ok(value,'ORIGINAL_PHYSICAL_POINT_TRANSFER_UNPROVEN');return value;}

export async function waitOriginalIndependentGuardianClosure(token){const value=guardians.get(token);assert.ok(value,'ORIGINAL_INDEPENDENT_GUARDIAN_UNPROVEN');if(value.held)throw Error('ORIGINAL_INDEPENDENT_GUARDIAN_HELD');await value.normalClosure;assert.ok(value.normalClosed&&!value.held);}
