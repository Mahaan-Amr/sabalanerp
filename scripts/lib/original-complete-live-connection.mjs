/** One executable connection for the selected closed-financial controller.
 * The generated immutable binding supplies configuration, never master stdin.
 * Every probe/material child and observation reader stays in this ownership. */
import assert from'node:assert/strict';
import{retainOriginalCompleteReaderClient,readOriginalCompleteLiveContext}from'./original-complete-reader-client.mjs';
import{createOriginalCompleteMaterialExecutor,createOriginalCompleteMaterialBinding}from'./original-complete-material-reader.mjs';
import{createOriginalCompleteInquiryReader}from'./original-complete-inquiry-reader.mjs';
import{createOriginalCompleteFrontendReader}from'./original-complete-frontend-reader.mjs';
import{buildOriginalCompleteLiveSeed}from'./original-complete-live-seed.mjs';
import{bindOriginalCompleteImage}from'./original-complete-image-selection.mjs';
import{createOriginalInquiryCurrentPort}from'./original-inquiry-current-port.mjs';
import{InquiryCarrierIncarnation}from'../../deploy/scripts/local-inquiry-carrier.mjs';

export function createOriginalCompleteLiveConnection({configuration,evidenceDirectory,evidenceCustody,assertOriginalControllerActive}){
 const c=structuredClone(configuration);assert.equal(c.format,'sabalan-original-complete-live-connection/v1');assert.match(c.operation,/^[a-f0-9]{32}$/);assert.match(c.targetCommit,/^[a-f0-9]{40}$/);assert.equal(c.productionAdmission,false);
 let initialized=false,client,contextToken,material,materialBinding,inquiry,frontend,currentPort,closing;
 const active=()=>assertOriginalControllerActive();
 const current=async()=>{active();assert.ok(client);await client.assertOriginalCurrent();active();};
 const connection=Object.freeze({
  operation:c.operation,targetCommit:c.targetCommit,releaseId:c.releaseId,evidenceDirectory,evidenceCustody,
  workerSourceSha256:c.workerSourceSha256,controllerSourceSha256:c.controllerSourceSha256,
  assertActive:active,revalidate:active,
  async bindOriginalInitial(initial,{session}){
   assert.equal(initialized,false,'ORIGINAL_COMPLETE_CONNECTION_ALREADY_BOUND');initialized=true;active();assert.deepEqual(Object.keys(initial).sort(),['applicationKeys','passphrase']);assert.match(session,/^[a-f0-9]{64}$/);
   client=await retainOriginalCompleteReaderClient({operation:c.operation,passphrase:initial.passphrase,port:c.readerPort,assertOriginalWorkerActive:active});
   contextToken=await client.retainLiveSeedContext();const context=readOriginalCompleteLiveContext(contextToken);assert.equal(context.applicationSourceCommit,c.targetCommit);assert.equal(context.operation,c.operation);
   material=createOriginalCompleteMaterialExecutor({operation:c.operation,leaf:c.materialReader,evidenceDirectory,evidenceCustody,assertOriginalCurrent:current,assertMemoryWorkAdmission:()=>client.assertMemoryWorkAdmission(),artifacts:c.artifacts,liveContext:context});
   materialBinding=createOriginalCompleteMaterialBinding({operation:c.operation,executor:material,evidenceDirectory,evidenceCustody,assertActive:active});
   const images={},executionImages={};for(const [role,service]of Object.entries({backend:'backend-candidate',frontend:'frontend-candidate',inquiry:'inquiry'})){
    const container=await material.inspectCurrentService(service);images[role]=bindOriginalCompleteImage({graph:c.seedInputs.imageGraphs[role],container,sourceCommit:c.componentSourceCommits[role],store:c.imageStore});executionImages[role]=container.Image;
   }
   assert.equal(images.backend.sourceCommit,c.targetCommit);assert.equal(executionImages.backend,context.candidateImage);
   inquiry=createOriginalCompleteInquiryReader({operation:c.operation,material,...c.inquiry,assertOriginalCurrent:current});
   frontend=createOriginalCompleteFrontendReader({material,images,executionImages,frontendAsset:c.frontendAsset,assertOriginalCurrent:current});
   const initialInspection=await material.inspectCurrentInquiry(),carrier=new InquiryCarrierIncarnation(initialInspection),handle=carrier.acquire();
   currentPort=await createOriginalInquiryCurrentPort({operation:c.operation,session,passphrase:initial.passphrase,carrier,handle,initialInspection,inspectCurrent:()=>material.inspectCurrentInquiry(),assertOwnerActive:active,readProbeBinding:async()=>{const{scope,inputSqlite,originalDatabase}=inquiry.observationBinding();return{scope,inputSqlite,originalDatabase};},port:c.inquiryPort});
   assert.equal(currentPort.endpoint.incarnation,c.inquiryIncarnation,'ORIGINAL_INQUIRY_PACKAGED_INCARNATION_CHANGED');
   c.seedInputs.imageBindings=images;await current();
  },
  async originalObservationPorts(request,live){assert.ok(initialized&&materialBinding&&currentPort&&inquiry&&frontend);assert.ok(live());assert.equal(request.session,currentPort.endpoint.session);assert.equal(request.intendedOwner.releaseId,c.releaseId);assert.equal(request.manifest.packageType,'COMPLETE');await current();currentPort.assertActive();return{inquiry,frontend};},
  startFixedExchange(observe){assert.ok(materialBinding);return materialBinding.startFixedExchange(observe);},
  captureOriginalApplication(reference,options){assert.ok(materialBinding);return materialBinding.captureOriginalApplication(reference,options);},
  buildOriginalSeed(applicationRaw,{workerCompletion,counterpart,finalized}){assert.ok(contextToken);active();return buildOriginalCompleteLiveSeed({liveContext:contextToken,workerCompletion,counterpart,applicationRaw,inputs:c.seedInputs,finalized});},
  awaitOriginalReaderClosure(){return closing??=(async()=>{
   // The strict Linux worker has already closed before this success path.
   // On a negative path the SAME native session remains owed until real EOF.
   let fault;const records={};
   if(material)try{records.material=await material.close();}catch(error){fault??=error;}
   if(currentPort)try{records.inquiryObservation=await currentPort.close();currentPort.assertClosed();}catch(error){fault??=error;}
   if(client)try{records.rootObservation=client.close();}catch(error){fault??=error;}
   if(fault)throw fault;
   return{allOriginalChildrenClosed:records.material?.allOriginalChildrenClosed??true,interrupted:records.material?.interrupted??false,
    failed:(records.material?.failed??false)||(records.rootObservation?.failed??false)||(records.inquiryObservation?.fault??null)!==null,
    readers:records,productionAdmission:false};
  })();},
 });return connection;
}
