/** Fixed entry for the engine's awaited COMPLETE callback. The coordinator
 * supplies the existing carrier and its original issuer; no shared service,
 * master, credentials or read-only trust mount is changed by this module. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createRestoredQaOriginalBroker} from './restored-private-broker.mjs';
import {runRestoredQaApplicationLifecycle} from './application-lifecycle.mjs';
import {assertOriginalIssuerResources} from './original-issuer-material.mjs';
const require=createRequire(import.meta.url);
const {createLayout}=require('./coherent-layout.cjs');
const {prepareOriginalInquiryStage,readOriginalInquiryStage}=require('./inquiry-stage.cjs');
const {prepareOriginalCompleteUsers}=require('./complete-users.cjs');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value)+'\n');
const LIMIT=8*1024*1024;

/** Data encoding only; never evidence admission. The final consumer retains its
 * own unchanged total-proof bound after joining the outer original closures. */
export function encodeRestoredQaApplicationArtifact(artifact){
  assert.equal(artifact.format,'sabalan-live-restored-application-artifacts/v1');
  assert.equal(artifact.cleanupPending,true);assert.equal(artifact.independentPointHealthy,false);assert.equal(artifact.productionAdmission,false);
  const raw=bytes(artifact);assert.ok(raw.length>0&&raw.length<=LIMIT,'RESTORED_QA_ARTIFACT_BOUND');return raw;
}

export async function qualifyRestoredQaApplications({proof,scope,sourceOwned,prepare,exercise,onHeld}){
  // Authenticate the engine object BEFORE touching scopes, files or originals.
  const {assertActiveStrictRestoreProof}=require('/app/dist/services/systemRecoveryEngine.js');
  const context=assertActiveStrictRestoreProof(proof);
  const {assertRestoredQaPrivateNormal,recheckRestoredQaPrivateApplications}=require('/app/dist/services/restoredQaMigrationBaseline.js');
  const {assertRestoredQaWorkingMaterial}=require('/app/dist/services/restoredQaWorkingMaterial.js');
  const {measureInstalledRestoredQaCurrentGraph}=require('/app/dist/services/restoredQaInstalledRuntimeFiles.js');
  const normal=assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner);
  const inquiryComponent=context.manifest.components.filter(row=>row.path==='inquiry/inquiry.db');
  assert.equal(inquiryComponent.length,1,'RESTORED_INQUIRY_COMPONENT_REQUIRED');
  const carrier=sourceOwned.inquiryCarrier;
  assert.equal(typeof carrier.assertCurrent,'function');assert.equal(typeof carrier.observationBinding,'function');
  const view=assertRestoredQaWorkingMaterial(scope.material,scope.owner);
  assert.equal(context.proof,proof);assert.deepEqual(context.proof.database,normal.database);
  assert.deepEqual(view.database,normal.database);
  assert.equal(sourceOwned.checkpointChecksum,normal.sourceCheckpoint.checksum);
  assert.equal(sourceOwned.releaseId,scope.owner.releaseId);
  const assertActive=()=>{
    assert.equal(assertActiveStrictRestoreProof(proof),context);
    carrier.assertCurrent();
    assertRestoredQaPrivateNormal(scope.normal,scope.material,scope.owner);
    assertRestoredQaWorkingMaterial(scope.material,scope.owner);
  };
  await assertOriginalIssuerResources(sourceOwned.issuer,assertActive);
  const installed=measureInstalledRestoredQaCurrentGraph(view.root);
  const layout=createLayout({context,view,sourceDatabase:normal.sourceDatabase,sourceOwned,assertActive});
  const inquiryStage=await prepareOriginalInquiryStage({root:view.root,layoutRoot:layout.root,sourceFile:fs.realpathSync(view.roots.inquiry+'/inquiry.db'),operation:sourceOwned.operation,component:inquiryComponent[0],archiveSha256:sourceOwned.checkpointChecksum,assertActive});
  const config=structuredClone(sourceOwned.config);
  assert.equal(config.image,sourceOwned.image);assert.equal(config.sourceCommit,sourceOwned.sourceCommit);
  assert.deepEqual(config.privateQualificationRuntime,sourceOwned.runtime);assert.deepEqual(config.sourcePins,sourceOwned.sourcePins);
  const broker=createRestoredQaOriginalBroker({proof,scope,root:layout.root,index:layout.index,config,
    sourcePins:sourceOwned.sourcePins,python:sourceOwned.python,issuer:sourceOwned.issuer,onHeld});
  const baselineInput=layout.save('independent-baseline-input.json',bytes(layout.baselineInput));
  Object.assign(config,{baselineInputSha256:baselineInput.sha256,publicKey:broker.enrollment.publicKey,
    session:broker.enrollment.session,actorId:broker.enrollment.actorId,
    originalHostEnrollment:{publicKey:broker.enrollment.publicKey,session:broker.enrollment.session}});
  layout.save('config.json',bytes(config));const indexRef=layout.save('index.json',bytes(layout.index));
  const controller=layout.save('independent-controller.json',bytes({...config,format:'sabalan-original-independent-private-controller/v1',indexSha256:indexRef.sha256}));
  // File-only provisioning port, owned by the coordinator: copy pinned helpers
  // and publish these exact public scopes through the EXISTING RO authority
  // channel. It must not start actors, rebuild images or replace the trust key.
  await prepare({root:layout.root,publicGrants:layout.publicGrants,enrollment:broker.enrollment});
  assertActive();
  let userOwner=await prepareOriginalCompleteUsers({scope,layoutRoot:layout.root,assertActive}),usersObservation,lifecycle;
  try{lifecycle=await runRestoredQaApplicationLifecycle({broker,database:view.database,
    controllerSha256:controller.sha256,assertActive,
    inquiryExpected:()=>{assertActive();const staged=readOriginalInquiryStage(inquiryStage);assert.equal(staged.source.sha256,inquiryComponent[0].sha256);return{...structuredClone(carrier.observationBinding()),restoredSqliteSha256:staged.target.sha256};},
    exercise:async witness=>exercise({witness,database:view.database,manifest:context.manifest,inquiryStage:inquiryStage.reference,assertActive}),
    recheck:async()=>{
      usersObservation=await userOwner.closeAfterReaders();userOwner=null;
      await inquiryStage.revalidate();
      layout.revalidate();
      const final=await recheckRestoredQaPrivateApplications(scope.normal,scope.material,scope.owner);
      assert.deepEqual(measureInstalledRestoredQaCurrentGraph(view.root),installed);
      layout.revalidate();return final;
    }});}finally{if(userOwner)await userOwner.closeAfterReaders();}
  const completeRaw=fs.readFileSync(layout.complete.path),workingRaw=fs.readFileSync(layout.working.path);
  assert.equal(sha(completeRaw),layout.complete.sha256);assert.equal(sha(workingRaw),layout.working.sha256);
  const baselineRaw=fs.readFileSync(layout.root+'/restored-file-baseline.json');
  assert.equal(sha(baselineRaw),lifecycle.baseline.result.manifestSha256);
  const artifact={format:'sabalan-live-restored-application-artifacts/v1',database:view.database,
    sourceDatabase:normal.sourceDatabase,restoredQaLineage:layout.index.restoredQaLineage,
    completeManifestValueRawBase64:completeRaw.toString('base64'),workingManifestValueRawBase64:workingRaw.toString('base64'),
    originalNativeHistoryRawBase64:Buffer.from(context.proof.rawHistoryJson).toString('base64'),inquiryStage:readOriginalInquiryStage(inquiryStage),
    baselineRawBase64:baselineRaw.toString('base64'),installed,lifecycle,usersObservation,cleanupPending:true,independentPointHealthy:false,productionAdmission:false};
  const raw=encodeRestoredQaApplicationArtifact(artifact);
  assertActive();const reference=layout.save('coherent-application-artifacts.json',raw);layout.revalidate();assertActive();
  return Object.freeze({format:'sabalan-live-restored-application-reference/v1',file:reference.path,
    sha256:reference.sha256,bytes:raw.length,cleanupPending:true,independentPointHealthy:false,productionAdmission:false});
}
