/** Point replay and live interval coverage have different completion boundaries.
 * The fixed original issuer owns these raw outputs; a parser never mints custody. */
import {createHash} from 'node:crypto';
const fail=():never=>{throw Error('ONLINE_PHYSICAL_CHECKPOINT_UNPROVEN');};
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const same=(a:any,b:any)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
const digest=(v:any)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const hash=(v:any)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const lsn=(v:any):bigint=>{if(typeof v!=='string'||!/^(?:0|[1-9A-F][0-9A-F]{0,7})\/(?:0|[1-9A-F][0-9A-F]{0,7})$/.test(v))fail();const [a,b]=v.split('/');return BigInt('0x'+a)*0x100000000n+BigInt('0x'+b);};
function rawBytes(v:any,maximum=8*1024*1024,allowEmpty=false){if(typeof v!=='string'||v.length>maximum*4/3+4)fail();const b=Buffer.from(v,'base64');if((!b.length&&!allowEmpty)||b.length>maximum||b.toString('base64')!==v)fail();return {bytes:b,sha256:createHash('sha256').update(b).digest('hex')};}
function raw(v:any,maximum=8*1024*1024){const result=rawBytes(v,maximum);return {...result,value:JSON.parse(result.bytes.toString())};}
function birth(v:any){if(!v||!Number.isSafeInteger(v.pid)||v.pid<1||!/^[1-9][0-9]*$/.test(v.startTicks)||!/^pid:\[[1-9][0-9]*\]$/.test(v.pidNamespace)||!/^[a-f0-9-]{36}$/.test(v.bootId))fail();}
export function assertOriginalLiveWalCoverage(value:any,point:any,database:any,captureId:string){
 if(!value||value.format!=='sabalan-original-live-wal-coverage/v1'||value.phase!=='LIVE_ORIGINAL_OWNER'
  ||value.finalIntervalCompletion!==false||value.captureId!==captureId||!same(value.sourceDatabase,database)
  ||!Number.isSafeInteger(value.timeline)||value.timeline<1||value.timeline!==point.timeline
  ||!Number.isFinite(Date.parse(value.observedAt))||!Array.isArray(value.closedWindows)||value.closedWindows.length<1||value.closedWindows.length>4096)fail();
 birth(value.originalOwner);
 let end:bigint|undefined;
 for(const window of value.closedWindows){
  const start=lsn(window.startLsn),next=lsn(window.endLsn);if(start>=next||end!==undefined&&start>end)fail();
  const request=raw(window.requestRawBase64,1024*1024),certificate=raw(window.certificateRawBase64,1024*1024).value;
  const seal=raw(window.sealRawBase64,1024*1024),closure=raw(window.closureRawBase64,1024*1024);
  if(seal.value.format!=='sabalan-wal-seal/v1'||seal.value.phase!=='SEALED'||seal.value.captureSha256!==closure.sha256
   ||closure.value.phase!=='COMPLETE'||closure.value.nativeReaped!==true||closure.value.databaseQuiet!==true||closure.value.nativeStatus!==0
   ||closure.value.startLsn!==window.startLsn||closure.value.endLsn!==window.endLsn
   ||closure.value.source?.systemIdentifier!==database.systemIdentifier||closure.value.source?.timeline!==value.timeline)fail();
  const r=request.value,d=certificate.decision;
  if(r.format!=='sabalan-original-wal-window-verification-request/v1'||!digest(r.challenge)||!digest(r.windowSha256)
   ||r.sourceIdentity?.systemIdentifier!==database.systemIdentifier||r.sourceIdentity?.timeline!==value.timeline
   ||!Array.isArray(r.objects)||r.objects.length<1||r.objects.length>16
   ||r.objects.some((o:any)=>typeof o.name!=='string'||!/^[A-Za-z0-9_.-]{1,160}$/.test(o.name)||!Number.isSafeInteger(o.bytes)||o.bytes<1||!digest(o.sha256))
   ||r.windowSha256!==seal.sha256||!same(r.objects,seal.value.objects?.map((o:any)=>({name:o.name,bytes:o.encryptedBytes,sha256:o.encryptedSha256})))
   ||certificate.format!=='sabalan-signed-original-wal-window-verification/v1'||d?.format!=='sabalan-original-wal-window-verification/v1'
   ||d.requestSha256!==hash(r)||d.challenge!==r.challenge||d.windowSha256!==r.windowSha256||!digest(d.independentTokenSha256)
   ||!same(d.sourceIdentity,r.sourceIdentity)||!same(d.objects,r.objects)
   ||!Number.isFinite(Date.parse(d.issuedAt))||!Number.isFinite(Date.parse(d.expiresAt))
   ||Date.parse(d.expiresAt)<=Date.parse(d.issuedAt)||Date.parse(d.expiresAt)-Date.parse(d.issuedAt)>600000
   ||typeof certificate.signature!=='string'||Buffer.from(certificate.signature,'base64').length!==64
   ||Buffer.from(certificate.signature,'base64').toString('base64')!==certificate.signature)fail();
  if(!Number.isFinite(Date.parse(window.acceptedAt))||Date.parse(window.acceptedAt)<Date.parse(d.issuedAt)||Date.parse(window.acceptedAt)>=Date.parse(d.expiresAt)
   ||Date.parse(window.acceptedAt)>Date.parse(value.observedAt)||seal.value.range?.startLsn!==window.startLsn||seal.value.range?.endLsn!==window.endLsn)fail();
  end=end===undefined||next>end?next:end;
 }
 const successor=value.successor,active=raw(successor?.activeRawBase64,65536).value;
 if(!successor||!Number.isSafeInteger(successor.originalDockerPid)||successor.originalDockerPid<1||!Number.isSafeInteger(successor.originalPid)||successor.originalPid<1||active.phase!=='ACTIVE'||active.pid!==successor.originalPid
  ||active.source?.systemIdentifier!==database.systemIdentifier||active.source?.timeline!==value.timeline||!digest(active.configurationSha256))fail();
 birth({...active,pid:successor.originalPid});
 const segment=successor.segmentBytes;if(!Number.isSafeInteger(segment)||segment<1048576||segment>1073741824||(BigInt(segment)&(BigInt(segment)-1n))!==0n)fail();
 if(value.coveredFromLsn!==value.closedWindows[0].startLsn||!Number.isSafeInteger(successor.sender?.pid)||successor.sender.pid<1||successor.sender.state!=='streaming'
  ||!Number.isFinite(Date.parse(successor.sender.backendStart))||lsn(successor.startLsn)/BigInt(segment)*BigInt(segment)>end!
  ||lsn(successor.endLsn)<=lsn(successor.startLsn)||lsn(value.coveredFromLsn)>lsn(point.lsn)
  ||end!<lsn(point.requiredWalEndLsn)||lsn(value.coveredThroughLsn)<lsn(point.requiredWalEndLsn)
  ||lsn(value.coveredThroughLsn)>lsn(successor.sender.flushLsn)||lsn(value.coveredThroughLsn)>lsn(successor.endLsn))fail();
 return value;
}
export function assertOriginalIndependentPhysicalPoint(source:any,expected:any){
 const report=raw(source.physicalRestoreRawBase64,32*1024*1024).value,metadata=source.checkpointMetadata;
 if(report.format!=='sabalan-original-independent-online-physical-restore/v1'||report.continuousWalQualified!==false
  ||!digest(report.sealedManifestSha256)||!digest(report.plaintextManifestSha256)||!digest(report.cipherInventorySha256)
  ||!same(report.sourceDatabase,expected.deploymentTargetDatabase)
  ||report.sourceMachineUuidSha256!==metadata.sourceMachineUuidSha256||report.sourceKernelBootIdSha256!==metadata.sourceKernelBootIdSha256
  ||!digest(report.recoveryMachineUuidSha256)||report.recoveryMachineUuidSha256===report.sourceMachineUuidSha256
  ||!digest(report.recoveryKernelBootIdSha256)||report.recoveryKernelBootIdSha256===report.sourceKernelBootIdSha256
  ||!Number.isFinite(Date.parse(report.startedAt))||!Number.isFinite(Date.parse(report.completedAt))||Date.parse(report.completedAt)<Date.parse(report.startedAt)
  ||metadata.physicalPoint?.sealedManifestSha256!==report.sealedManifestSha256
  ||metadata.physicalPoint?.plaintextManifestSha256!==report.plaintextManifestSha256
  ||metadata.physicalPoint?.cipherInventorySha256!==report.cipherInventorySha256
  ||!same(metadata.physicalPoint?.restorePoint,report.restorePoint))fail();
 const layout=report.layout,replay=report.replay,point=report.restorePoint;
 if(!layout||layout.format!=='sabalan-original-independent-online-layout/v1'||layout.captureId!==expected.captureId
  ||!same({...layout.restorePoint,timeline:point.timeline},point)||layout.coverage?.timeline!==point.timeline||layout.sourceDatabase?.systemIdentifier!==expected.deploymentTargetDatabase.systemIdentifier
  ||layout.sourceDatabase?.database!==expected.deploymentTargetDatabase.name||String(layout.sourceDatabase?.databaseOid)!==expected.deploymentTargetDatabase.oid
  ||!Array.isArray(layout.restoredFileCuts)||layout.restoredFileCuts.length!==9||new Set(layout.restoredFileCuts.map((v:any)=>v.name)).size!==9
  ||!digest(layout.sqlite?.sha256)||!Number.isSafeInteger(layout.sqlite.bytes)||layout.sqlite.bytes<1
  ||!digest(layout.physicalBase?.backupManifestSha256)||!Number.isSafeInteger(layout.physicalBase.files)||layout.physicalBase.files<1
  ||!layout.coordinationHistory||!digest(layout.coordinationHistory.sha256))fail();
 if(typeof point?.name!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(point.name)||!Number.isSafeInteger(point.timeline)||point.timeline<1
  ||replay?.inRecovery!==false||replay.systemIdentifier!==expected.deploymentTargetDatabase.systemIdentifier
  ||replay.sourceDatabaseOid!==expected.deploymentTargetDatabase.oid||lsn(replay.lastReplayLsn)<lsn(point.lsn)||lsn(replay.lastReplayLsn)>lsn(point.requiredWalEndLsn))fail();
 const commands=report.originalPgCommands;
 if(!Array.isArray(commands)||!['pg_verifybackup','pg_waldump','pg_controldata'].every(role=>commands.filter((v:any)=>v.role===role).length===1)
  ||commands.some((v:any)=>!Number.isSafeInteger(v.originalPid)||v.originalPid<1||v.returncode!==0||v.signal!==null||rawBytes(v.stdoutRawBase64,1024*1024,true).sha256!==v.stdoutSha256))fail();
 const decrypt=report.decryption;
 if(decrypt?.format!=='sabalan-original-independent-online-components/v1'||decrypt.sealedSha256!==report.sealedManifestSha256
  ||decrypt.manifestSha256!==report.plaintextManifestSha256||decrypt.fullGcmAuthenticated!==true||decrypt.independentRsaDecryptVerified!==true
  ||!Array.isArray(decrypt.components)||decrypt.components.length<15||decrypt.components.some((v:any)=>!digest(v.sha256)||!digest(v.cipherSha256)||!Number.isSafeInteger(v.bytes)||v.bytes<0||!Number.isSafeInteger(v.cipherBytes)||v.cipherBytes<1))fail();
 assertOriginalLiveWalCoverage(source.liveWalCoverage,point,expected.deploymentTargetDatabase,expected.captureId);
 return report;
}
