/** Same original master, independent RSA, same existing Compose replay.
 * This table is intentionally unrelated to COMPLETE or physical SSH tokens. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {readOriginalPhysicalPointSource,readOriginalIndependentPhysicalPointTransfer,
 runOriginalIndependentComponents,readOriginalIndependentComponents} from './independent-full-restore-ssh.mjs';
import {readOriginalSerialPhysicalPlan,runOriginalSerialPhysicalBinding,readOriginalSerialPhysicalCompletion,
 readOriginalSerialRestoredIncarnation,bindOriginalSerialPhysicalMaterial} from './serial-physical/native-binding.mjs';
import {validatePhysicalPointProducer} from '../run-independent-full-restore-controller.mjs';
import {assertIndependentPhysicalReplayObserved} from './independent-physical-replay.mjs';
import {assertOriginalComponentDecryption} from './independent-components-evidence.mjs';
const completed=new WeakMap(),callbacks=new WeakMap();
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
const own=raw=>({bytes:raw.length,sha256:sha(raw),rawBase64:raw.toString('base64')});
function output(d){assert.ok(d&&Number.isSafeInteger(d.bytes)&&d.bytes>0&&d.bytes<=32*1024**2);const raw=Buffer.from(d.rawBase64,'base64');assert.equal(raw.toString('base64'),d.rawBase64);assert.equal(raw.length,d.bytes);assert.equal(sha(raw),d.sha256);return raw;}

/** Programmatic source-owned coordinator seam, never master stdin JSON. The
 * factory must create the actual ticket08 native binding under the SAME lease.
 * A plan or callback-returned PASS cannot substitute for that private binding. */
export function createOriginalSameComposePhysicalCallbacks({createSerialBinding}){
 assert.equal(typeof createSerialBinding,'function');const token=Object.freeze({});callbacks.set(token,{createSerialBinding});return token;
}
export function assertOriginalSameComposePhysicalCallbacks(token){assert.ok(callbacks.has(token),'ORIGINAL_SAME_COMPOSE_CALLBACKS_REQUIRED');}
export function isOriginalSameComposePhysical(token){return completed.has(token);}
export function readOriginalSameComposePhysical(token){const held=completed.get(token);assert.ok(held,'ORIGINAL_SAME_COMPOSE_PHYSICAL_REQUIRED');held.revalidate();return structuredClone(held.record);}

/** Content graph join; its output remains data and cannot be read as authority.
 * The source-owned runner below is the sole completion producer. */
export function joinOriginalSameComposePhysical({source,transfer,rsa,serial,plan,incarnation,startedAt,completedAt}){
 assert.equal(serial.originalClusterRestored,true);assert.equal(serial.operation,plan.operation);
 assert.deepEqual(serial.restoredIncarnation,incarnation);
 assert.equal(incarnation.project,'sabalanerp-local');assert.equal(incarnation.service,'postgres');
 assert.equal(incarnation.systemIdentifier,plan.originalSystemIdentifier);
 const producer=JSON.parse(output(source.ownedOutputs.producer));
 const manifest=JSON.parse(output(source.ownedOutputs.plaintextManifest));
 const sealed=JSON.parse(output(source.ownedOutputs.sealedManifest));
 validatePhysicalPointProducer(producer,source.request.captureId,source.plaintextManifestSha256);
 assert.equal(manifest.operation,source.request.captureId);assert.equal(sealed.operation,manifest.operation);
 const decryptionRaw=assertOriginalComponentDecryption(rsa,{captureId:manifest.operation,sourceHost:source.sourceHost,
  sealedSha256:source.sealedManifestSha256,manifestSha256:source.plaintextManifestSha256,ownedOutputs:source.ownedOutputs});
 const app=serial.applicationResult;assert.ok(app,'ORIGINAL_PHYSICAL_APPLICATION_OUTPUTS_REQUIRED');
 const report=JSON.parse(output(app.ownedOutputs.report));
 assert.equal(report.format,'sabalan-original-same-compose-online-physical-restore/v1');
 assert.equal(report.pass,true);assert.equal(report.phase,'COMPLETE');assert.equal(report.recoveryMode,'ONLINE_COHERENT_WAL');
 assert.equal(report.continuousWalQualified,false);assert.equal(report.productionAdmission,false);
 assert.deepEqual(report.replayHost,app.replayHost);assert.deepEqual(report.rsaHost,rsa.rsaHost);
 for(const host of [report.replayHost,report.rsaHost]){assert.deepEqual(Object.keys(host).sort(),['kernelBootIdSha256','machineUuidSha256']);for(const value of Object.values(host))assert.match(value,/^[a-f0-9]{64}$/);}
 assert.notEqual(report.rsaHost.machineUuidSha256,source.sourceHost.machineUuidSha256);
 assert.deepEqual(report.sourceHost,source.sourceHost);
 for(const key of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'])assert.equal(report[key],source[key]);
 const layout=JSON.parse(output(app.ownedOutputs.layout));assert.deepEqual(report.layout,layout);
 assert.equal(layout.captureId,source.request.captureId);assert.deepEqual(layout.sourceDatabase,{database:plan.canonicalReplay.sourceDatabase,databaseOid:plan.canonicalReplay.sourceDatabaseOid,systemIdentifier:plan.canonicalReplay.systemIdentifier});
 assert.equal(layout.restoredFileCuts.length,9);assert.equal(new Set(layout.restoredFileCuts.map(x=>x.name)).size,9);
 assert.equal(layout.physicalBase.backupManifestSha256,rsa.physicalBaseFacts.backup_manifest);
 assert.deepEqual(report.restorePoint,plan.canonicalReplay.restorePoint);assert.deepEqual(report.replay,serial.replay);
 assertIndependentPhysicalReplayObserved(plan.canonicalReplay,report.replay);
 assert.deepEqual(report.decryption,JSON.parse(decryptionRaw));
 assert.equal(Object.hasOwn(report,'restoredIncarnation'),false,'APPLICATION_CANNOT_PREDICT_RESTORATION');
 const db={name:layout.sourceDatabase.database,oid:String(layout.sourceDatabase.databaseOid),systemIdentifier:layout.sourceDatabase.systemIdentifier};
 assert.deepEqual(report.sourceDatabase,db);
 for(const [name,role] of [['captured','coherent-cut'],['coverage','coverage-manifest'],['walClosure','wal-capture']]){
  const raw=output(app.ownedOutputs[name]),rows=manifest.sources.filter(x=>x.role===role);assert.equal(rows.length,1);
  assert.equal(sha(raw),rows[0].sha256);assert.equal(raw.length,rows[0].bytes);
 }
 const captured=JSON.parse(output(app.ownedOutputs.captured)),coverage=JSON.parse(output(app.ownedOutputs.coverage)),wal=JSON.parse(output(app.ownedOutputs.walClosure));
 assert.equal(captured.captureId,manifest.operation);assert.deepEqual(captured.database,layout.sourceDatabase);
 assert.deepEqual({...captured.restorePoint,timeline:coverage.timeline},report.restorePoint);
 assert.deepEqual(producer.walClosure,wal);assert.deepEqual(producer.captureClosure,coverage.captureClosure);
 assert.deepEqual(layout.coverage,coverage);assert.equal(layout.sqlite.sha256,captured.sqliteSnapshot.sha256);
 assert.equal(layout.coordinationHistory.sha256,captured.coordinationHistory.sha256);
 assert.equal(layout.coordinationHistory.archivalOnly,true);assert.equal(layout.coordinationHistory.runtimeAdmission,false);
 assert.equal(captured.versionedCuts.length,9);
 for(const cut of captured.versionedCuts){const rows=layout.restoredFileCuts.filter(row=>row.name===cut.name);assert.equal(rows.length,1);
  const restored=rows[0];assert.equal(restored.sourceStoreRoot,cut.storeRoot);assert.equal(restored.actual.sealSha256,cut.sha256);
  assert.ok(['sabalan-versioned-file-restore/v1','sabalan-versioned-file-restore/v2'].includes(restored.actual.format));
  for(const row of manifest.sources.filter(row=>row.role==='versioned-file-object'&&row.path.startsWith(cut.storeRoot+'/')))
   assert.ok(restored.actual.files.some(file=>file.sha256===row.sha256&&file.bytes===row.bytes));
 }
 const base=manifest.sources.filter(row=>row.role==='physical-base');assert.equal(base.length,1);
 assert.equal(base[0].sha256,coverage.physicalBaseProof.archiveSha256);assert.equal(base[0].bytes,coverage.physicalBaseProof.archiveBytes);
 for(const role of ['backend','frontend','inquiry']){
  const health=report.applicationHealth[role];assert.equal(health.status,200);assert.equal(health.image,app.images[role]);
  assert.equal(health.declaredSourceCommit,report.images[role].sourceCommit);assert.match(health.responseSha256,/^[a-f0-9]{64}$/);
 }
 assert.equal(report.physicalReplayQualified,true);assert.equal(report.physicalAndThreeApplicationsQualified,true);
 assert.ok(serial.originalControllers.length>0&&rsa.originalControllers.length>0&&app.originalControllers.length>0);
 for(const row of [...serial.originalControllers,...rsa.originalControllers,...app.originalControllers]){assert.equal(row.code,0);assert.equal(row.signal,null);}
 for(const row of app.originalControllers){assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);}
 assert.ok(Number.isFinite(Date.parse(startedAt))&&Date.parse(completedAt)>=Date.parse(startedAt));
 assert.equal(transfer.sourceOriginalPid,source.sourceOriginalPid);
 assert.equal(transfer.expected.onlinePhysicalPoint.captureId,source.request.captureId);
 assert.ok(Array.isArray(transfer.initialWindowBindings)&&transfer.initialWindowBindings.length>0,'ORIGINAL_POINT_INITIAL_WINDOWS_REQUIRED');
 assert.equal(new Set(transfer.initialWindowBindings.map(row=>row.requestSha256)).size,transfer.initialWindowBindings.length);
 for(const row of transfer.initialWindowBindings)for(const key of ['requestSha256','dependencySha256','certificateSha256','bindingSha256'])assert.match(row[key],/^[a-f0-9]{64}$/);
 const originalPgCommands=[['VERIFY_BACKUP','pg_verifybackup'],['VERIFY_WAL','pg_waldump'],['PHYSICAL_CONTROLDATA','pg_controldata']].map(([phase,role])=>{
  const rows=serial.originalControllers.filter(row=>row.phase===phase);assert.equal(rows.length,1);const row=rows[0];
  const raw=fs.readFileSync(row.stdoutFile);assert.equal(raw.length,row.stdoutBytes);assert.equal(sha(raw),row.stdoutSha256);
  return {role,originalPid:row.originalPid,returncode:row.code,signal:row.signal,stdoutRawBase64:raw.toString('base64'),stdoutSha256:row.stdoutSha256};
 });
 const finalReport={...report,originalPgCommands,restoredIncarnation:incarnation,originalApplicationReport:app.ownedOutputs.report,
  originalSerialRestoration:{operation:serial.operation,originalControllers:serial.originalControllers,originalClusterRestored:true},
  startedAt,completedAt};
 const ownedOutputs={...app.ownedOutputs,applicationReport:app.ownedOutputs.report,report:own(bytes(finalReport)),originalProducer:source.ownedOutputs.producer,plaintextManifest:source.ownedOutputs.plaintextManifest,
  sealedManifest:source.ownedOutputs.sealedManifest,decryption:own(decryptionRaw)};
 // Custody paths are actual independent transfer outputs. They do not pretend
 // that replay/application originals ran on that independent RSA host.
 const custody=transfer.expected.onlinePhysicalPoint;
 return {format:'sabalan-original-same-compose-physical-completion/v1',recoveryMode:'ONLINE_COHERENT_WAL',
  ...Object.fromEntries(['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'].map(k=>[k,source[k]])),
  sourceDatabase:db,restorePoint:report.restorePoint,replayHost:report.replayHost,rsaHost:rsa.rsaHost,restoredIncarnation:incarnation,
  ownedOutputs,fileHashes:Object.fromEntries(Object.entries(ownedOutputs).map(([k,v])=>[k,v.sha256])),
  originalControllers:[...serial.originalControllers,...rsa.originalControllers,...app.originalControllers],nativeClosures:app.nativeClosures,
  ...Object.fromEntries(['images','sourceImages','imageGraphs','imageArchiveReceipts','imageCipherSources','proofDatabase','restoredDatabase','controllerSourceSha256'].map(k=>[k,app[k]])),
  rsaCustody:{root:custody.root,sealedFile:custody.sealedFile,manifestFile:custody.manifestFile,cipherPaths:custody.cipherPaths,
   remoteControllerSourceSha256:transfer.expected.remoteControllerSha256,remoteConfigurationSha256:transfer.expected.remoteConfigurationSha256},
  historySha256:sha(bytes({source:source.ownedOutputs,serial,rsa,applicationOutputs:app.ownedOutputs})),productionAdmission:false};
}

export async function runOriginalSameComposePhysical({callbackBinding,sourcePoint,pointTransfer,options}){
 assertOriginalSameComposePhysicalCallbacks(callbackBinding);const startedAt=new Date().toISOString();
 const source=await readOriginalPhysicalPointSource(sourcePoint),transfer=readOriginalIndependentPhysicalPointTransfer(pointTransfer);
 assert.deepEqual(transfer.expected,options.expected);
 const rsaToken=await runOriginalIndependentComponents({sourcePoint,pointTransfer,options}),rsa=readOriginalIndependentComponents(rsaToken);
 const binding=await callbacks.get(callbackBinding).createSerialBinding({sourcePoint,source:structuredClone(source),rsaCompletion:rsaToken,pointTransfer});
 const plan=readOriginalSerialPhysicalPlan(binding);
 const captured=JSON.parse(output(rsa.materialFacts['coherent-cut'])),coverage=JSON.parse(output(rsa.materialFacts['coverage-manifest']));
 assert.equal(plan.canonicalReplay.sourceDatabase,captured.database.database);assert.equal(plan.canonicalReplay.sourceDatabaseOid,String(captured.database.databaseOid));
 assert.equal(plan.canonicalReplay.systemIdentifier,captured.database.systemIdentifier);
 assert.deepEqual(plan.canonicalReplay.restorePoint,{...captured.restorePoint,timeline:coverage.timeline});
 bindOriginalSerialPhysicalMaterial(binding,rsaToken);
 const {completion,incarnation}=await runOriginalSerialPhysicalBinding(binding);
 const record=joinOriginalSameComposePhysical({source,transfer,rsa,plan,serial:readOriginalSerialPhysicalCompletion(completion),
  incarnation:readOriginalSerialRestoredIncarnation(incarnation),startedAt,completedAt:new Date().toISOString()});
 await readOriginalPhysicalPointSource(sourcePoint);
 const revalidate=()=>{readOriginalSerialPhysicalCompletion(completion);readOriginalSerialRestoredIncarnation(incarnation);readOriginalIndependentComponents(rsaToken);};
 revalidate();const token=Object.freeze({});completed.set(token,{record,revalidate});return token;
}
