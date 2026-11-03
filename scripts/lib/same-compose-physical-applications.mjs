/** Fixed physical application composition. Ports borrow the persistent owner's
 * existing lease/carriers; they cannot provide a report or COMPLETE proof. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runRestoredQaApplicationLifecycle} from './restored-qa/application-lifecycle.mjs';
import {validateOriginalIndependentApplicationClosures} from './independent-full-restore-ssh.mjs';
import {assertIndependentPhysicalReplayObserved} from './independent-physical-replay.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const own=value=>{const raw=Buffer.from(JSON.stringify(value));return{rawBase64:raw.toString('base64'),bytes:raw.length,sha256:sha(raw)};};
function read(ref){const raw=Buffer.from(ref.rawBase64,'base64');assert.equal(raw.toString('base64'),ref.rawBase64);assert.equal(raw.length,ref.bytes);assert.equal(sha(raw),ref.sha256);return JSON.parse(raw);}

/** Config contains physical facts/resources only. Actual baseline, initialization,
 * probes, closures and final readback are obtained inside this invocation. */
export async function runSameComposePhysicalApplications({input,ports}){
 assert.equal(input.format,'sabalan-same-compose-physical-applications-input/v1');
 assert.match(input.operation,/^[a-f0-9]{32}$/);assert.equal(input.productionAdmission,false);
 for(const key of ['report','applicationResult','applicationHealth','nativeClosures','restoredIncarnation'])assert.equal(Object.hasOwn(input,key),false);
 assert.deepEqual(Object.keys(input.ownedInputs).sort(),['captured','coverage','layout','walClosure']);
 for(const name of ['assertActive','prepare','exercise','recheck','inquiryExpected'])assert.equal(typeof ports[name],'function');
 const active=()=>assert.equal(ports.assertActive(),true,'PHYSICAL_APPLICATION_SCOPE_NOT_ACTIVE');active();
 const layout=read(input.ownedInputs.layout),captured=read(input.ownedInputs.captured),coverage=read(input.ownedInputs.coverage),wal=read(input.ownedInputs.walClosure);
 assert.equal(layout.operation,input.operation);assert.equal(layout.captureId,captured.captureId);assert.equal(layout.restoredFileCuts.length,9);
 assert.equal(new Set(layout.restoredFileCuts.map(cut=>cut.name)).size,9);
 assert.deepEqual(layout.sourceDatabase,captured.database);assert.deepEqual(layout.coverage,coverage);
 assert.deepEqual(input.canonicalReplay.restorePoint,{...captured.restorePoint,timeline:coverage.timeline});
 assertIndependentPhysicalReplayObserved(input.canonicalReplay,input.replay);
 assert.equal(layout.sqlite.sha256,captured.sqliteSnapshot.sha256);
 assert.equal(layout.coordinationHistory.sha256,captured.coordinationHistory.sha256);
 assert.equal(layout.coordinationHistory.archivalOnly,true);assert.equal(layout.coordinationHistory.runtimeAdmission,false);
 assert.equal(captured.versionedCuts.length,9);
 for(const cut of captured.versionedCuts){const rows=layout.restoredFileCuts.filter(row=>row.name===cut.name);assert.equal(rows.length,1);assert.equal(rows[0].sourceStoreRoot,cut.storeRoot);assert.equal(rows[0].actual.sealSha256,cut.sha256);}
 const database={name:layout.sourceDatabase.database,oid:String(layout.sourceDatabase.databaseOid),systemIdentifier:layout.sourceDatabase.systemIdentifier};
 await ports.prepare({operation:input.operation,layout:structuredClone(layout),database});active();
 const lifecycle=await runRestoredQaApplicationLifecycle({broker:ports.broker,database,controllerSha256:input.controllerSourceSha256,assertActive:active,
  inquiryExpected:()=>{active();const expected=ports.inquiryExpected();assert.equal(expected.restoredSqliteSha256,layout.sqlite.sha256);return expected;},
  exercise:async witness=>{active();const probe=await ports.exercise({witness,database,layout:structuredClone(layout),assertActive:active});active();return probe;},
  recheck:async()=>{const final=await ports.recheck({database,layout:structuredClone(layout)});active();return final;}});
 active();
 // Health is obtained from the same exercise, not configuration or a report RPC.
 // The port retains only observations until all lifecycle originals have closed.
 assert.equal(typeof ports.readClosedObservations,'function');
 const observations=await ports.readClosedObservations();active();
 assert.deepEqual(Object.keys(observations).sort(),['applicationHealth','ownedOutputs']);
 for(const role of ['backend','frontend','inquiry']){const health=observations.applicationHealth[role];assert.equal(health.status,200);assert.equal(health.image,input.images[role]);assert.equal(health.declaredSourceCommit,input.imageSources[role].sourceCommit);assert.match(health.responseSha256,/^[a-f0-9]{64}$/);}
 const outputs=observations.ownedOutputs;
 for(const key of ['restoredBaseline','namespaceSqlObservation',...['backend','frontend','inquiry'].map(role=>'imageArchiveReceipt-'+role)])assert.ok(outputs[key],key);
 for(const [key,ref]of Object.entries(outputs)){assert.ok(['restoredBaseline','namespaceSqlObservation','imageArchiveReceipt-backend','imageArchiveReceipt-frontend','imageArchiveReceipt-inquiry'].includes(key));read(ref);}
 assert.equal(outputs.restoredBaseline.sha256,lifecycle.baseline.result.manifestSha256);
 const evidence=lifecycle.probe.originals.find(row=>row.role==='inquiry').evidence;
 const native=read(evidence.finalNative);
 const inquiryClosure={closure:{originalPopenPid:native.guardian.pid,originalReturncode:128,naturalExitZero:false,
  nativeRawBase64:evidence.finalNative.rawBase64,workRawBase64:evidence.work.rawBase64,workClaimRawBase64:evidence.workClaim.rawBase64,workScopeRawBase64:evidence.workScope.rawBase64}};
 const report={format:'sabalan-original-same-compose-online-physical-restore/v1',pass:true,phase:'COMPLETE',recoveryMode:'ONLINE_COHERENT_WAL',
  continuousWalQualified:false,productionAdmission:false,physicalReplayQualified:true,physicalAndThreeApplicationsQualified:true,
  ...Object.fromEntries(['sourceHost','replayHost','rsaHost','sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256','decryption','replay'].map(k=>[k,input[k]])),
  layout,restorePoint:input.canonicalReplay.restorePoint,sourceDatabase:database,images:input.imageSources,applicationHealth:observations.applicationHealth,
  baseline:lifecycle.baseline,initializer:lifecycle.initialization,backendClosure:lifecycle.closure,inquiryClosure,lifecycle};
 const nativeClosures=validateOriginalIndependentApplicationClosures(report);
 const applicationResult={...Object.fromEntries(['replayHost','images','sourceImages','imageGraphs','imageArchiveReceipts','imageCipherSources','controllerSourceSha256'].map(k=>[k,input[k]])),
  proofDatabase:database,restoredDatabase:database,nativeClosures,ownedOutputs:{...outputs,...input.ownedInputs,report:own(report)}};
 active();return {format:'sabalan-original-physical-applications-output/v1',operation:input.operation,applicationResult,productionAdmission:false};
}
