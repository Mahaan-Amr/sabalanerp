/** One original Windows process owns the local and independent qualifications.
 * It stays alive between QA and a later protected install; saved reports cannot
 * recreate either completion token. Passwords arrive only on anonymous stdin.
 */
import {assertOriginalCandidateRollbackOwner,readOriginalLocalPreparationFailure} from './original-candidate-rollback-owner.mjs';
import {readSourceOwnedCompleteBinding} from './original-complete-source-binding.mjs';
import {readOriginalCompleteConstructorPackage} from './original-complete-constructor-package.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeOriginalMasterFailureDiagnostic} from './original-master-failure-diagnostic.mjs';
import {runOriginalRetainedBrowserQualificationRounds,readOriginalRetainedBrowserQualificationCompletion,readOriginalRetainedBrowserClosedFailure,readOriginalRetainedBrowserReturnCustody} from './original-retained-browser-qualification.mjs';
import {inspectOriginalLocalOnlineCheckpointInputs} from './original-local-online-checkpoint.mjs';
import {runOriginalApplicationNativeQualification,readOriginalKnownFailedLocalClosure} from '../run-application-native-local.mjs';
import {runOriginalIndependentRestoreOverSsh,waitOriginalIndependentGuardianClosure} from './independent-full-restore-ssh.mjs';
import {issueOriginalQualificationOrigin,issueOriginalWalWindowVerification,readOriginalWalWindowCertificate,issueOriginalPhysicalCheckpointVerification,issueOriginalPhysicalRepositoryPromotion,issueOriginalPhysicalCheckpointPublication,issueOriginalTerminalWalCoverage} from '../../deploy/scripts/online-qualification-origin-issuer.mjs';
import {startOriginalProtectedOnlineInstall,readOriginalProtectedQualificationRequest,sendOriginalProtectedQualificationPackage,readOriginalProtectedFinancialRequest,sendOriginalProtectedFinancialPackage,sendOriginalProtectedWalWindowCertificate,sendOriginalProtectedPhysicalPointVerification,readOriginalProtectedCheckpointMetadataSource,sendOriginalProtectedCheckpointMetadataCertificate,sendOriginalProtectedTerminalWalCertificate,readOriginalOnlineQualificationRequest,sendOriginalOnlineQualificationPackage,retainOriginalProtectedWalWindowAcknowledgement,sendOriginalProtectedClientControl,finishOriginalProtectedClient,waitOriginalProtectedClientCallbacks} from './original-protected-online-ssh.mjs';
import {prepareOriginalPrivateEvidenceDirectory} from './original-private-evidence-directory.mjs';
import {assembleOriginalProtectedOnlineEvidence,assembleOriginalOnlineEvidence,readOriginalOnlineEvidenceAssembly} from './original-online-evidence-assembler.mjs';
import {runOriginalFollowingPromotion} from './original-following-update-workflow.mjs';
import {runOriginalExistingComposeComplete,isOriginalExistingComposeComplete} from './original-existing-compose-complete.mjs';
import {runOriginalImageRepository,readOriginalImageRepositoryQualification,readOriginalKnownImageRepositoryFailure} from './original-image-repository.mjs';
import {assembleOriginalProtectedCompleteEvidence} from './original-online-evidence-assembler.mjs';
import {assertOriginalSameComposePhysicalCallbacks,runOriginalSameComposePhysical,readOriginalSameComposePhysical} from './original-same-compose-physical.mjs';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const originalMasterKnownRetainedNegatives=new WeakMap();
export const isOriginalMasterKnownRetainedNegative=(token,owner)=>originalMasterKnownRetainedNegatives.get(token)?.owner===owner;
export function readOriginalMasterKnownRetainedNegative(token,owner){
 const held=originalMasterKnownRetainedNegatives.get(token);assert.ok(held&&held.owner===owner,'ORIGINAL_MASTER_RETAINED_NEGATIVE_REQUIRED');return readOriginalRetainedBrowserReturnCustody(held.returnCustody,owner);
}
const originalMasterPreparationNegatives=new WeakMap();
export const isOriginalMasterKnownPreparationNegative=(token,owner)=>originalMasterPreparationNegatives.get(token)?.owner===owner;
export function readOriginalMasterKnownPreparationNegative(token,owner){const row=originalMasterPreparationNegatives.get(token);assert.ok(row&&row.owner===owner,'ORIGINAL_MASTER_PREPARATION_NEGATIVE_REQUIRED');const facts=readOriginalLocalPreparationFailure(row.error,owner);assert.ok(facts);return facts;}
const originalMasterKnownNegatives=new WeakMap();
const originalMasterKnownImageNegatives=new WeakMap();
export const isOriginalMasterKnownImageNegative=(token,owner)=>originalMasterKnownImageNegatives.get(token)?.owner===owner;
export function readOriginalMasterKnownImageNegative(token,owner){
 const held=originalMasterKnownImageNegatives.get(token);assert.ok(held&&held.owner===owner,'ORIGINAL_MASTER_KNOWN_IMAGE_NEGATIVE_REQUIRED');
 assertOriginalCandidateRollbackOwner(owner);const image=readOriginalKnownImageRepositoryFailure(held.error,owner);
 assert.equal(image.retrievalQualified,false);assert.equal(image.productionAdmission,false);
 return{image,local:held.localCompletion,independent:held.independentCompletion};
}
/** Same-process terminal only. JSON or a closed historical report is not custody. */
export function readOriginalMasterKnownNegative(token,owner){
 const row=originalMasterKnownNegatives.get(token);assert.ok(row&&row.owner===owner,'ORIGINAL_MASTER_KNOWN_NEGATIVE_REQUIRED');
 assertOriginalCandidateRollbackOwner(owner);const local=readOriginalKnownFailedLocalClosure(row.error);assert.deepEqual(local,row.local);
 const retained=readOriginalRetainedBrowserQualificationCompletion(row.retained);assert.equal(retained.reportSha256,local.retainedReportSha256);
 return {local,retained};
}
const keys=(value,names)=>assert.deepEqual(Object.keys(value).sort(),[...names].sort());
function pinnedConfiguration(file,digest){
 assert.match(digest,/^[a-f0-9]{64}$/);assert.equal(path.resolve(file),file);
 const before=fs.lstatSync(file,{bigint:true});
 assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=8n*1024n*1024n);
 const raw=fs.readFileSync(file);assert.equal(sha(raw),digest);
 const after=fs.lstatSync(file,{bigint:true});
 for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])assert.equal(after[key],before[key]);
 return JSON.parse(raw);
}
/** This function never accepts a ChildProcess or an already-finished report as
 * ownership. The two original factories below create their own children. */
export async function runOriginalOnlineQualificationMaster({candidateReplacementReceipt,prismaQualificationReceipt,frontendSnapshot,fullCatalogSelection,retainedBrowserPlanFile,retainedBrowserPlanSha256,sameComposePhysicalCallbacks,deferLocal=false,nativeOwner,initialInputBindings,input=process.stdin,output=process.stdout}){
 let financialRequest=null;if(nativeOwner)assertOriginalCandidateRollbackOwner(nativeOwner);
 assert.equal(process.platform,'win32','ORIGINAL_QUALIFICATION_MASTER_WINDOWS_REQUIRED');
 assert.equal(deferLocal,true,'ORIGINAL_MASTER_REQUIRES_PRELOAD_THEN_RUN_LOCAL');
 if(sameComposePhysicalCallbacks)assertOriginalSameComposePhysicalCallbacks(sameComposePhysicalCallbacks);
 const memoryWork=(stage,work)=>nativeOwner?nativeOwner.runWithMemoryPressure(stage,work):work();
 let held=false;
 const signalListeners=['SIGINT','SIGTERM','SIGHUP'].map(name=>{const listener=()=>{held=true;};process.on?.(name,listener);return[name,listener];});
 let local=null,retainedBrowser=null;
 if(retainedBrowserPlanFile){
  assert.ok(retainedBrowserPlanSha256);let closedRetainedError=null,completedRetained=null;
  try{retainedBrowser=await memoryWork('retained-browser',async()=>{try{const completed=await runOriginalRetainedBrowserQualificationRounds({planFile:retainedBrowserPlanFile,planSha256:retainedBrowserPlanSha256,nativeOwner});completedRetained=completed;return completed;}catch(error){if(nativeOwner){try{readOriginalRetainedBrowserClosedFailure(error,nativeOwner);closedRetainedError=error;}catch{/* Unknown closure stays unbranded. */}}throw error;}});if(nativeOwner){assert.equal(held,false,'ORIGINAL_MASTER_SIGNAL_HELD');await nativeOwner.bindOriginalRetainedBrowserReturn(retainedBrowser,()=>assert.equal(held,false,'ORIGINAL_MASTER_SIGNAL_HELD'));assert.equal(held,false,'ORIGINAL_MASTER_SIGNAL_HELD');}}
  catch(error){
   const returnCustody=closedRetainedError??completedRetained;if(!returnCustody||!nativeOwner)throw error;assert.equal(held,false,'ORIGINAL_MASTER_SIGNAL_HELD');readOriginalRetainedBrowserReturnCustody(returnCustody,nativeOwner);assert.equal(held,false,'ORIGINAL_MASTER_SIGNAL_HELD');
   // memoryWork's END may surface the same latched pressure as another Error.
   // Keep custody of the producer's original negative; Root must still drain
   // and validate the sampler before it can restore or release anything.
   for(const[name,listener]of signalListeners)process.off(name,listener);process.exitCode=1;
   const terminal=Object.freeze({});originalMasterKnownRetainedNegatives.set(terminal,{owner:nativeOwner,returnCustody});return terminal;
  }
 }
 if(!deferLocal){assert.ok(candidateReplacementReceipt);local=await runOriginalApplicationNativeQualification({candidateReplacementReceipt,prismaQualificationReceipt,frontendSnapshot,fullCatalogSelection,retainedBrowserCompletion:retainedBrowser});}
 let independent=null,imageRepository=null,independentOptions=null,independentGuardian=null,protectedInstall=null,protectedRequest=null,sequence=0;
 let physical=null,promotion=null,metadata=null,certification=null,physicalCertificate=null,repositoryCertificate=null;
 let bootstrapClientStarted=false,bootstrapHandoff=null;
 let physicalGuardianReady=null;
 let onlineRequest=null;
 let localRuntime=null,completePreparation=null;
 const acknowledgedWindows=[],closedReleasePoints=[],guardians=new Set(),controlTasks=new Set();
 const guardianReady=value=>{independentGuardian=value;guardians.add(value);};
 // Deliberately retained after local completion, EOF, or a later failed request.
 // Neither tokens nor private keys are written into the progress record.
 const keeper=setInterval(()=>{},1000);
 const state=event=>output.write(JSON.stringify({format:'sabalan-original-qualification-master/v1',event,
  sequence,retainedBrowserOriginalClosed:retainedBrowser!==null,localOriginalClosed:local!==null,independentOriginalClosed:independent!==null,localReportPath:local?.reportPath??null,
  productionAdmission:false})+'\n');
 state(local?'LOCAL_QUALIFICATION_CLOSED_RETAINED':retainedBrowser?'RETAINED_BROWSER_CLOSED_RETAINED':'ORIGINAL_MASTER_READY_FOR_LOCAL');
 let pending=Buffer.alloc(0),activeCommand=null;
 try{
  for await(const chunk of input){
   pending=Buffer.concat([pending,Buffer.from(chunk)]);assert.ok(pending.length<=8*1024*1024,'ORIGINAL_MASTER_INPUT_BOUND');
   let newline;
   while((newline=pending.indexOf(10))>=0){
    const raw=pending.subarray(0,newline);pending=pending.subarray(newline+1);
    const request=JSON.parse(raw.toString());if(nativeOwner)assertOriginalCandidateRollbackOwner(nativeOwner);
    assert.ok(raw.length<=65536||(request.command==='FOLLOWING_CONTROL'&&request.control==='PUBLISH'),'ORIGINAL_MASTER_LARGE_INPUT_COMMAND_REFUSED');
    assert.equal(request.sequence,sequence+1);sequence++;activeCommand=request.command;
    if(request.command==='PREPARE_LOCAL_RUNTIME'){
     if(initialInputBindings){assert.ok(nativeOwner);assert.equal(request.nativeOwnerElfReceipt,initialInputBindings.nativeOwnerElfReceipt.file);pinnedConfiguration(request.nativeOwnerElfReceipt,initialInputBindings.nativeOwnerElfReceipt.sha256);}
     keys(request,['command','sequence','nativeOwnerElfReceipt']);assert.ok(!local&&!localRuntime&&!held);assert.equal(typeof request.nativeOwnerElfReceipt,'string');inspectOriginalLocalOnlineCheckpointInputs({nativeOwnerElfReceipt:request.nativeOwnerElfReceipt});localRuntime={nativeOwnerElfReceipt:request.nativeOwnerElfReceipt};state('LOCAL_RUNTIME_CONTENT_BOUND_NO_RUNTIME');
    }else if(request.command==='PREPARE_COMPLETE'){
     keys(request,['command','sequence','configurationFile','configurationSha256']);assert.ok(nativeOwner&&initialInputBindings&&!local&&!independentOptions&&!held);
     const reference={file:request.configurationFile,sha256:request.configurationSha256};assert.deepEqual(reference,initialInputBindings.completeConstructorConfiguration);
     const binding=readSourceOwnedCompleteBinding();assert.equal(binding.value.format,'sabalan-original-complete-source-binding/v2');assert.deepEqual(reference,binding.value.configuration);
     completePreparation=readOriginalCompleteConstructorPackage(reference);binding.revalidate();completePreparation.revalidate();independentOptions={mode:'PROTECTED_COMPLETE_CONSTRUCTOR',configuration:reference};state('COMPLETE_CONSTRUCTOR_BOUND_NO_RUNTIME');
    }else if(request.command==='PREPARE_INDEPENDENT'){
     assert.equal(initialInputBindings,undefined,'NATIVE_C3_REQUIRES_SOURCE_OWNED_COMPLETE_CONSTRUCTOR');
     keys(request,['command','sequence','configurationFile','configurationSha256','password']);assert.ok(!local&&!independentOptions&&!held,'ORIGINAL_INDEPENDENT_CONFIGURATION_ALREADY_BOUND');
     assert.equal(typeof request.password,'string');independentOptions={...pinnedConfiguration(request.configurationFile,request.configurationSha256),password:request.password};state('INDEPENDENT_CONFIGURATION_BOUND_NO_RUNTIME');
    }else if(request.command==='RUN_LOCAL'){
     if(nativeOwner)assert.equal(request.candidateReplacementReceipt,candidateReplacementReceipt,'ORIGINAL_ROOT_REPLACEMENT_SELECTION_REQUIRED');
     keys(request,['command','sequence','candidateReplacementReceipt',...['prismaQualificationReceipt','frontendSnapshot','fullCatalogSelection'].filter(key=>Object.hasOwn(request,key))]);assert.ok(!local&&!held,'ORIGINAL_LOCAL_ALREADY_CREATED');
     assert.ok(independentOptions&&localRuntime,'ORIGINAL_INDEPENDENT_AND_LOCAL_RUNTIME_CONFIGURATION_REQUIRED_BEFORE_LOCAL');
     if(initialInputBindings){assert.ok(completePreparation);completePreparation.revalidate();assert.equal(independentOptions.mode,'PROTECTED_COMPLETE_CONSTRUCTOR');}
     const localOptions={candidateReplacementReceipt:request.candidateReplacementReceipt,prismaQualificationReceipt:request.prismaQualificationReceipt??prismaQualificationReceipt,frontendSnapshot:request.frontendSnapshot??frontendSnapshot,fullCatalogSelection:request.fullCatalogSelection??fullCatalogSelection,retainedBrowserCompletion:retainedBrowser,independentOptions,sameComposePhysicalCallbacks,localQualificationMode:'PROTECTED_COMPLETE',nativeOwner,...localRuntime};
     local=await memoryWork('LOCAL',()=>nativeOwner?nativeOwner.runOriginalLocalPreparation(localOptions,sequence):runOriginalApplicationNativeQualification(localOptions));
     if(nativeOwner)await nativeOwner.bindOriginalLocalCompletion(local.completion);
     state('LOCAL_QUALIFICATION_CLOSED_RETAINED');
    }else if(request.command==='RUN_COMPLETE'){
     if(initialInputBindings){assert.ok(completePreparation);completePreparation.revalidate();assert.deepEqual({file:request.configurationFile,sha256:request.configurationSha256},initialInputBindings.completeConstructorConfiguration);}
     keys(request,['command','sequence','configurationFile','configurationSha256','password']);
     assert.ok(local&&!independent&&!held&&!protectedInstall,'ORIGINAL_COMPLETE_LOCAL_AND_UNUSED_OWNER_REQUIRED');
     assert.equal(typeof request.password,'string');
     let credential=request.password;delete request.password;
     try{independent=await memoryWork('COMPLETE',()=>runOriginalExistingComposeComplete({configurationFile:request.configurationFile,configurationSha256:request.configurationSha256,
      localCompletion:local.completion,nativeOwner,acquireCredential:async()=>{assert.ok(!held,'ORIGINAL_MASTER_HELD');const value=credential;credential=null;return value;},
      onClosed:async row=>{assert.ok(!held&&row.code===0&&row.signal===null&&row.stdoutEof&&row.stderrEof,'ORIGINAL_COMPLETE_CLOSURE_REQUIRED');}}));
     }finally{credential=null;}
     state('COMPLETE_QUALIFICATION_CLOSED_RETAINED');
    }else if(request.command==='RUN_IMAGE_REPOSITORY'){
     keys(request,['command','sequence','password']);assert.ok(nativeOwner&&initialInputBindings&&local&&independent&&!imageRepository&&!held&&!protectedInstall,'IMAGE_REPOSITORY_SAME_ROOT_LOCAL_FULL_REQUIRED');assert.equal(typeof request.password,'string');
     let credential=request.password;delete request.password;
     try{imageRepository=await memoryWork('IMAGE_REPOSITORY',()=>runOriginalImageRepository({nativeOwner,localCompletion:local.completion,independentCompletion:independent,acquireCredential:async()=>{assert.ok(!held,'ORIGINAL_MASTER_HELD');const value=credential;credential=null;return value;}}));}
     finally{credential=null;}
     const result=readOriginalImageRepositoryQualification(imageRepository,nativeOwner);
     output.write(JSON.stringify({format:'sabalan-original-image-repository-qualified-retained/v1',sequence,operation:result.operation,ownerResult:result.ownerResult,localHistorySha256:result.localHistorySha256,fullHistorySha256:result.fullHistorySha256,retrievalQualified:true,productionAdmission:false})+'\n');
     state('IMAGE_REPOSITORY_QUALIFICATION_CLOSED_RETAINED');
    }else if(request.command==='RUN_INDEPENDENT'){
     keys(request,['command','sequence','configurationFile','configurationSha256','password']);
     assert.ok(local,'ORIGINAL_LOCAL_COMPLETION_REQUIRED');assert.equal(independent,null,'ORIGINAL_INDEPENDENT_ALREADY_CREATED');assert.equal(typeof request.password,'string');
     const options=pinnedConfiguration(request.configurationFile,request.configurationSha256);
     // Only the fixed original SSH factory can mint this token. Its own pinned
     // helper/host-key/controller/config protocol remains authoritative.
     independentOptions={...options,password:request.password};
     independent=await runOriginalIndependentRestoreOverSsh({...independentOptions,onOriginalGuardianReady:guardianReady,
      onHeld:()=>{held=true;state('INDEPENDENT_ORIGINAL_HELD');}});
     state('INDEPENDENT_QUALIFICATION_CLOSED_RETAINED');
    }else if(['START_PROTECTED_INSTALL','START_FOLLOWING_CLIENT'].includes(request.command)){
     const following=request.command==='START_FOLLOWING_CLIENT';
     keys(request,['command','sequence','launchPlanFile','launchPlanSha256',...(following?['serviceReference']:[])]);
     assert.ok(independent&&!held&&!protectedInstall,'ORIGINAL_INDEPENDENT_COMPLETION_REQUIRED');
     if(following&&bootstrapClientStarted){
      assert.ok(bootstrapHandoff&&!bootstrapHandoff.consumed,'ORIGINAL_RETAINED_BOOTSTRAP_HANDOFF_REQUIRED');
      assert.deepEqual(request.serviceReference,bootstrapHandoff.serviceReference,'ORIGINAL_RETAINED_BOOTSTRAP_REFERENCE_CHANGED');
      bootstrapHandoff.consumed=true;
     }else if(!following){
      assert.ok(!bootstrapClientStarted&&!bootstrapHandoff,'ORIGINAL_BOOTSTRAP_CLIENT_ALREADY_CREATED');bootstrapClientStarted=true;
     }
     const launchPlan=pinnedConfiguration(request.launchPlanFile,request.launchPlanSha256);
     protectedInstall=startOriginalProtectedOnlineInstall({launchPlan,onFinancialQualificationRequest:async token=>{assert.ok(!financialRequest&&!held,'ORIGINAL_FINANCIAL_REQUEST_ALREADY_BOUND');financialRequest=token;output.write(JSON.stringify({format:'sabalan-original-master-financial-request/v1',request:readOriginalProtectedFinancialRequest(token),productionAdmission:false})+'\n');},...(following?{serviceReference:request.serviceReference}:{}),onOnlineQualificationRequest:async token=>{
      assert.ok(physical&&metadata&&certification&&!onlineRequest&&!held,'ORIGINAL_ONLINE_CERTIFIED_POINT_REQUIRED');onlineRequest=token;
      output.write(JSON.stringify({format:'sabalan-original-master-online-request/v1',request:readOriginalOnlineQualificationRequest(token),productionAdmission:false})+'\n');
     },onPhysicalPointRequest:async sourcePoint=>{
      assert.ok(independentOptions&&!held&&!physical,'ORIGINAL_PHYSICAL_POINT_ALREADY_CREATED');
      assertOriginalSameComposePhysicalCallbacks(sameComposePhysicalCallbacks);
      const api=await import('./independent-full-restore-ssh.mjs');
      const transfer=await api.runOriginalIndependentPhysicalPointTransfer({sourcePoint,options:independentOptions});
      independentOptions={...independentOptions,expected:api.readOriginalIndependentPhysicalPointTransfer(transfer).expected};
      physical=await runOriginalSameComposePhysical({callbackBinding:sameComposePhysicalCallbacks,sourcePoint,pointTransfer:transfer,options:independentOptions});
      promotion=await api.runOriginalIndependentPhysicalRepositoryPromotion({physicalCompletion:physical,options:independentOptions});
      physicalCertificate=await issueOriginalPhysicalCheckpointVerification({independentCompletion:physical});
      repositoryCertificate=await issueOriginalPhysicalRepositoryPromotion({physicalCompletion:physical,repositoryPromotion:promotion});
      await sendOriginalProtectedPhysicalPointVerification(protectedInstall.session,sourcePoint,{physicalCertificate,repositoryCertificate,reportRawBase64:readOriginalSameComposePhysical(physical).ownedOutputs.report.rawBase64});
     },onCheckpointMetadataRequest:async sourceMetadata=>{
      assert.ok(physical&&promotion&&physicalCertificate&&repositoryCertificate&&!metadata&&!held,'ORIGINAL_PHYSICAL_PROMOTION_REQUIRED');
      const api=await import('./independent-full-restore-ssh.mjs'),request=readOriginalProtectedCheckpointMetadataSource(sourceMetadata);
      metadata=await api.runOriginalIndependentPhysicalMetadataPublication({physicalCompletion:physical,repositoryPromotion:promotion,canonicalMetadataRawBase64:request.canonicalMetadataRawBase64,options:independentOptions});
      const publicationCertificate=await issueOriginalPhysicalCheckpointPublication({physicalCompletion:physical,repositoryPromotion:promotion,metadataCompletion:metadata});
      certification=await api.runOriginalIndependentPhysicalCertificateAcknowledgement({physicalCompletion:physical,repositoryPromotion:promotion,metadataCompletion:metadata,physicalCertificate,repositoryCertificate,publicationCertificate,options:independentOptions});
      await sendOriginalProtectedCheckpointMetadataCertificate(protectedInstall.session,sourceMetadata,publicationCertificate);
     },onTerminalWalRequest:async sourceTerminal=>{
      assert.ok(physical&&metadata&&certification&&!held,'ORIGINAL_CERTIFIED_POINT_REQUIRED');
      const terminalCertificate=await issueOriginalTerminalWalCoverage({sourceTerminal,windowAcknowledgements:acknowledgedWindows,metadataCompletion:metadata});
      const api=await import('./independent-full-restore-ssh.mjs');
      await api.runOriginalIndependentTerminalWalCoveragePersistence({physicalCompletion:physical,metadataCompletion:metadata,certificationCompletion:certification,terminalCertificate,options:independentOptions});
      await sendOriginalProtectedTerminalWalCertificate(protectedInstall.session,sourceTerminal,terminalCertificate);
      closedReleasePoints.push({physical,promotion,metadata,certification,physicalCertificate,repositoryCertificate,terminalCertificate,windowAcknowledgements:acknowledgedWindows.splice(0)});
      physical=null;promotion=null;metadata=null;certification=null;physicalCertificate=null;repositoryCertificate=null;
      physicalGuardianReady=null;
     },onWalWindowRequest:async sourceWindow=>{
      assert.ok(independentOptions&&!held,'ORIGINAL_WAL_INDEPENDENT_OPTIONS_REQUIRED');
      const {runOriginalIndependentWalWindowVerification}=await import('./independent-wal-window-ssh.mjs');
      const guardian=physicalGuardianReady?await physicalGuardianReady:independentGuardian;
      const completion=await runOriginalIndependentWalWindowVerification({...independentOptions,sourceWindow,independentGuardian:guardian,onOriginalGuardianReady:guardianReady});
      const certificate=await issueOriginalWalWindowVerification({sourceWindow,independentCompletion:completion});
      const {acknowledgeOriginalIndependentWalWindowVerification}=await import('./independent-wal-window-ssh.mjs');
      await acknowledgeOriginalIndependentWalWindowVerification(completion,readOriginalWalWindowCertificate(certificate));
      await retainOriginalProtectedWalWindowAcknowledgement(sourceWindow,completion);
      acknowledgedWindows.push(completion);
      await sendOriginalProtectedWalWindowCertificate(protectedInstall.session,sourceWindow,certificate);
     }});
     state('ORIGINAL_PROTECTED_INSTALL_STARTED');
     const binding=await protectedInstall.binding;
     if(following&&bootstrapHandoff)for(const key of ['serviceBootIdSha256','launcherPid','launcherBirth'])assert.equal(binding[key],bootstrapHandoff[key],'ORIGINAL_RETAINED_SERVICE_BINDING_CHANGED');
     output.write(JSON.stringify({format:'sabalan-original-master-client-binding/v1',sequence,binding,productionAdmission:false})+'\n');
     if(!following){protectedRequest=await protectedInstall.qualificationRequest;
      const target=readOriginalProtectedQualificationRequest(protectedRequest);
      output.write(JSON.stringify({format:'sabalan-original-master-protected-request/v1',sequence,request:target,productionAdmission:false})+'\n');}
    }else if(['RUN_FOLLOWING_PROMOTION','RUN_FOLLOWING_CURRENT_DATA_ROLLBACK'].includes(request.command)){
     keys(request,['command','sequence','nextCycle']);assert.ok(protectedInstall&&local&&independent&&!held&&controlTasks.size===0,'ORIGINAL_FOLLOWING_WORKFLOW_NOT_READY');
     const workflowSequence=sequence;
     const task=runOriginalFollowingPromotion(protectedInstall.session,{nextCycle:request.nextCycle,completeWith:request.command==='RUN_FOLLOWING_PROMOTION'?'PROMOTION':'CURRENT_DATA_ROLLBACK',
      onProgress:progress=>output.write(JSON.stringify({format:'sabalan-original-master-workflow-progress/v1',sequence:workflowSequence,...progress,productionAdmission:false})+'\n')
     }).then(result=>{assert.ok(!held,'ORIGINAL_MASTER_WORKFLOW_HELD');output.write(JSON.stringify({format:'sabalan-original-master-workflow-completed/v1',sequence:workflowSequence,result,productionAdmission:false})+'\n');});
     controlTasks.add(task);task.then(()=>controlTasks.delete(task),error=>{controlTasks.delete(task);held=true;writeOriginalMasterFailureDiagnostic(error,workflowSequence);state('ORIGINAL_MASTER_WORKFLOW_FAILED_RETAINED');});
    }else if(request.command==='FOLLOWING_CONTROL'){
     keys(request,['command','sequence','control','input']);assert.ok(protectedInstall&&!held&&controlTasks.size===0,'ORIGINAL_CLIENT_REQUIRED');
     // QUALIFY_NEXT/FINISH_CYCLE can wait for a genuine callback response;
     // keep reading ISSUE_ONLINE_ORIGIN while this same original control waits.
     const controlSequence=sequence;
     const task=sendOriginalProtectedClientControl(protectedInstall.session,{command:request.control,input:request.input}).then(result=>{
      output.write(JSON.stringify({format:'sabalan-original-master-control-completed/v1',sequence:controlSequence,command:request.control,result,productionAdmission:false})+'\n');
     });controlTasks.add(task);task.then(()=>controlTasks.delete(task),error=>{controlTasks.delete(task);held=true;writeOriginalMasterFailureDiagnostic(error,controlSequence);state('ORIGINAL_MASTER_CONTROL_FAILED_RETAINED');});
    }else if(request.command==='FINISH_CLIENT'){
     keys(request,['command','sequence','mode']);assert.ok(protectedInstall&&local&&independent&&!held,'ORIGINAL_CLIENT_COMPLETION_REQUIRED');
     if(request.mode==='BOOTSTRAP_RETAIN'){
      assert.ok(bootstrapClientStarted&&!bootstrapHandoff&&protectedRequest&&controlTasks.size===0,'ORIGINAL_BOOTSTRAP_RETAIN_UNAVAILABLE');
      await waitOriginalProtectedClientCallbacks(protectedInstall.session);
      assert.ok(!held&&controlTasks.size===0&&!physical&&!promotion&&!metadata&&!certification&&!onlineRequest&&!physicalGuardianReady
       &&acknowledgedWindows.length===0&&closedReleasePoints.length===0,'ORIGINAL_BOOTSTRAP_RETAIN_PENDING_WORK');
      const closure=await finishOriginalProtectedClient(protectedInstall.session,{mode:'BOOTSTRAP'});
      assert.ok(!held,'ORIGINAL_BOOTSTRAP_RETAIN_HELD');
      // The transport already verified the actual terminal barrier, launcher
      // custody and original SSH EOF. Never mint this handoff from caller JSON.
      const detached=closure.detached;
      assert.equal(detached.mode,'BOOTSTRAP');assert.equal(closure.exit.code,0);assert.equal(closure.exit.signal,null);
      assert.equal(closure.stdoutEof,true);assert.equal(closure.stderrEof,true);
      const serviceReference=Object.freeze(Object.fromEntries(['instanceId','servicePid','serviceBirth','configurationSha256'].map(key=>[key,detached[key]])));
      bootstrapHandoff={serviceReference,serviceBootIdSha256:detached.serviceBootIdSha256,launcherPid:detached.launcherPid,launcherBirth:detached.launcherBirth,consumed:false};
      protectedInstall=null;protectedRequest=null;
      output.write(JSON.stringify({format:'sabalan-original-master-bootstrap-retained/v1',sequence,closure,serviceReference,
       independentGuardiansRetained:guardians.size,productionAdmission:false})+'\n');
      // Keep this SAME master, local/independent tokens, guardian handles,
      // original stdin, keeper and signal listeners for the following client.
      continue;
     }
     await Promise.allSettled([...controlTasks]);assert.ok(!held&&controlTasks.size===0,'ORIGINAL_CLIENT_CONTROL_PENDING');
     await waitOriginalProtectedClientCallbacks(protectedInstall.session);
     assert.ok(!physical&&!promotion&&!metadata&&!certification&&!onlineRequest&&!physicalGuardianReady,'ORIGINAL_CLIENT_PHYSICAL_WORK_PENDING');
     if(request.mode==='FOLLOWING')assert.ok(closedReleasePoints.length>0,'ORIGINAL_CLIENT_TERMINAL_POINT_REQUIRED');
     for(const guardian of guardians)await waitOriginalIndependentGuardianClosure(guardian);
     const closure=await finishOriginalProtectedClient(protectedInstall.session,{mode:request.mode});
     assert.ok(!held,'ORIGINAL_CLIENT_MASTER_HELD');
     output.write(JSON.stringify({format:'sabalan-original-master-client-completed/v1',sequence,closure,independentGuardiansClosed:guardians.size,closedReleasePoints:closedReleasePoints.length,productionAdmission:false})+'\n');
     clearInterval(keeper);for(const[name,listener]of signalListeners)process.off?.(name,listener);return closure;

    }else if(request.command==='ISSUE_ONLINE_ORIGIN'){
     keys(request,['command','sequence','evidenceDirectory']);assert.ok(local&&physical&&onlineRequest&&protectedInstall&&!held,'ORIGINAL_ONLINE_REQUEST_REQUIRED');
     const evidenceCustody=await prepareOriginalPrivateEvidenceDirectory(request.evidenceDirectory);
     const assemblyCompletion=assembleOriginalOnlineEvidence({evidenceCustody,localCompletion:local.completion,independentCompletion:physical,onlineRequest,evidenceDirectory:request.evidenceDirectory});
     const result=await issueOriginalQualificationOrigin({localCompletion:local.completion,independentCompletion:physical,assemblyCompletion});
     await sendOriginalOnlineQualificationPackage(protectedInstall.session,onlineRequest,result.package);onlineRequest=null;
     output.write(JSON.stringify({format:'sabalan-original-online-origin-issued/v1',sequence,file:result.file,sha256:result.sha256,productionAdmission:false})+'\n');
    }else if(request.command==='PREPARE_FINANCIAL'){
     keys(request,['command','sequence','sourceFile','sourceSha256','binding']);assert.ok(independent&&!held&&protectedInstall&&financialRequest&&!protectedRequest,'ORIGINAL_PREDDL_FINANCIAL_REQUEST_REQUIRED');
     await sendOriginalProtectedFinancialPackage(protectedInstall.session,financialRequest,{sourceFile:request.sourceFile,sourceSha256:request.sourceSha256,binding:request.binding});financialRequest=null;state('ORIGINAL_FINANCIAL_PACKAGE_SENT_NO_RELEASE_ACCEPTANCE');
    }else if(request.command==='ISSUE_ORIGIN'){
     keys(request,['command','sequence','evidenceDirectory',...(Object.hasOwn(request,'protectedFinancial')?['protectedFinancial']:[])]);
     assert.ok(independent&&!held&&protectedInstall&&protectedRequest,'ORIGINAL_PROTECTED_REQUEST_REQUIRED');
     readOriginalProtectedQualificationRequest(protectedRequest);
     // The strict issuer also requires every semantic report and proof to be
     // bound to original owned outputs. Caller JSON never supplies a pass bit.
     const evidenceCustody=await prepareOriginalPrivateEvidenceDirectory(request.evidenceDirectory);
     const assemble=isOriginalExistingComposeComplete(independent)?assembleOriginalProtectedCompleteEvidence:assembleOriginalProtectedOnlineEvidence;
     const assemblyCompletion=assemble({evidenceCustody,...(request.protectedFinancial?{protectedFinancial:request.protectedFinancial}:{}),localCompletion:local.completion,independentCompletion:independent,
      protectedRequest,evidenceDirectory:request.evidenceDirectory});
     const assembly=readOriginalOnlineEvidenceAssembly(assemblyCompletion);
     assert.equal(assembly.originalProtectedRequestSha256,sha(Buffer.from(JSON.stringify(sort(readOriginalProtectedQualificationRequest(protectedRequest))))));
     const result=await issueOriginalQualificationOrigin({localCompletion:local.completion,independentCompletion:independent,assemblyCompletion});
     await sendOriginalProtectedQualificationPackage(protectedInstall.session,protectedRequest,result.package);
     output.write(JSON.stringify({format:'sabalan-original-qualification-origin-issued/v1',sequence,
      file:result.file,sha256:result.sha256,productionAdmission:false})+'\n');
    }else throw Error('ORIGINAL_MASTER_FIXED_COMMAND_REQUIRED');
   }
  }
  held=true;state('ORIGINAL_MASTER_INPUT_CLOSED_RETAINED');
 }catch(error){
  let imageNegative=null;try{if(nativeOwner)imageNegative=readOriginalKnownImageRepositoryFailure(error,nativeOwner);}catch{/* Unknown custody stays held. */}
  if(imageNegative&&activeCommand==='RUN_IMAGE_REPOSITORY'&&!held&&local&&independent&&!imageRepository&&nativeOwner&&retainedBrowser&&!independentGuardian&&!protectedInstall&&!protectedRequest
   &&!physical&&!promotion&&!metadata&&!certification&&!physicalCertificate&&!repositoryCertificate&&!physicalGuardianReady&&!onlineRequest
   &&!bootstrapClientStarted&&!bootstrapHandoff&&guardians.size===0&&controlTasks.size===0&&acknowledgedWindows.length===0&&closedReleasePoints.length===0&&pending.length===0){
   assert.equal(imageNegative.retrievalQualified,false);assert.equal(imageNegative.productionAdmission,false);
   output.write(JSON.stringify({format:'sabalan-original-master-known-image-negative-closed/v1',sequence,operation:imageNegative.operation,ownerResult:imageNegative.ownerResult,qualificationSucceeded:false,productionAdmission:false})+'\n');
   clearInterval(keeper);for(const[name,listener]of signalListeners)process.off?.(name,listener);process.exitCode=1;
   const token=Object.freeze({});originalMasterKnownImageNegatives.set(token,{owner:nativeOwner,error,localCompletion:local.completion,independentCompletion:independent});return token;
  }
  const preparationTerminalEligible=()=>activeCommand==='RUN_LOCAL'&&nativeOwner&&!held&&!local&&retainedBrowser&&!independent&&!imageRepository&&!independentGuardian&&!protectedInstall&&!protectedRequest
   &&!physical&&!promotion&&!metadata&&!certification&&!physicalCertificate&&!repositoryCertificate&&!physicalGuardianReady&&!onlineRequest
   &&!bootstrapClientStarted&&!bootstrapHandoff&&guardians.size===0&&controlTasks.size===0&&acknowledgedWindows.length===0&&closedReleasePoints.length===0&&pending.length===0&&(input.readableLength??0)===0;
  if(preparationTerminalEligible()){
   try{const closed=await nativeOwner.finishOriginalLocalPreparationFailure(error,sequence);if(closed){assert.ok(preparationTerminalEligible(),'ORIGINAL_PREPARATION_MASTER_STATE_CHANGED');const facts=readOriginalLocalPreparationFailure(closed,nativeOwner);assert.ok(facts&&facts.sequence===sequence&&facts.localAllocated===false&&facts.allReadOnlyOriginalsClosed&&facts.samplerDrained);output.write(JSON.stringify({format:'sabalan-original-master-local-preparation-negative-closed/v1',sequence,report:facts.report,qualificationSucceeded:false,productionAdmission:false})+'\n');clearInterval(keeper);for(const[name,listener]of signalListeners)process.off?.(name,listener);process.exitCode=1;const terminal=Object.freeze({});originalMasterPreparationNegatives.set(terminal,{owner:nativeOwner,error:closed});return terminal;}}
   catch{/* Unproven preparation custody remains held. */}
  }
  let negative=null;try{negative=readOriginalKnownFailedLocalClosure(error);}catch{/* Unknown or changed original custody stays held. */}
  if(negative&&activeCommand==='RUN_LOCAL'&&!held&&!local&&retainedBrowser&&!independent&&!independentGuardian&&!protectedInstall&&!protectedRequest
   &&!physical&&!promotion&&!metadata&&!certification&&!physicalCertificate&&!repositoryCertificate&&!physicalGuardianReady&&!onlineRequest
   &&!bootstrapClientStarted&&!bootstrapHandoff&&guardians.size===0&&controlTasks.size===0&&acknowledgedWindows.length===0&&closedReleasePoints.length===0&&pending.length===0){
   try{
    assert.equal(negative.format,'sabalan-same-process-known-failed-local-closure/v1');
    assert.equal(negative.allOriginalControllersClosed,true);assert.equal(negative.allOriginalActorsClosed,true);assert.equal(negative.originalCryptoClosed,true);
    assert.equal(negative.qualificationSucceeded,false);assert.equal(negative.productionAdmission,false);
    const retained=readOriginalRetainedBrowserQualificationCompletion(retainedBrowser);assert.equal(retained.reportSha256,negative.retainedReportSha256);
    output.write(JSON.stringify({format:'sabalan-original-master-known-negative-closed/v1',sequence,localReportPath:negative.reportPath,localReportSha256:negative.reportSha256,qualificationSucceeded:false,allLocalOriginalsClosed:true,productionAdmission:false})+'\n');
    clearInterval(keeper);for(const[name,listener]of signalListeners)process.off?.(name,listener);process.exitCode=1;
    if(nativeOwner){const token=Object.freeze({});originalMasterKnownNegatives.set(token,{owner:nativeOwner,error,local:structuredClone(negative),retained:retainedBrowser});return token;}return;
   }catch{/* A failed terminal guard must never discard an unknown owner. */}
  }
  held=true;writeOriginalMasterFailureDiagnostic(error,sequence);state('ORIGINAL_MASTER_REQUEST_FAILED_RETAINED');
 }
 // No successful process exit discards the only authority-bearing tokens.
 await new Promise(()=>{void keeper;void local;void independent;void imageRepository;void protectedInstall;void protectedRequest;void retainedBrowser;});
}
function sort(value){return Array.isArray(value)?value.map(sort):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,sort(value[key])])):value;}
