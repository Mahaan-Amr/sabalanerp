/** SAME-Root post-FULL image content/retrieval owner. No bootstrap/install. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {assertOriginalCandidateRollbackOwner} from './original-candidate-rollback-owner.mjs';
import {readOriginalCompleteRetirementFor,readOriginalExistingComposeComplete} from './original-existing-compose-complete.mjs';
import {readOriginalRoleQualificationCompletion} from './application-native-role-coordinator.mjs';
import {readOriginalDeploymentImageContent} from './original-deployment-image-content.mjs';
import {completePlanReader,writeCompletePlanFile} from './original-complete-plan-files.mjs';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from './original-private-evidence-directory.mjs';
import {originalBackendBaseCommands} from './production-backend-base-process.mjs';
import {collectOriginalCompleteProductionInputs,readOriginalCompleteProductionInputs,readOriginalClosedProductionInputRefusal} from './original-complete-production-inputs.mjs';
import {collectOriginalCompleteOwner,readOriginalImageRepositoryOwner,readOriginalImageCallbackRefusal,assertOriginalImageRepositoryReadyOwner,assertOriginalImageRepositoryActiveOwner,assertOriginalImageRepositoryClosedOwnerFor} from './original-existing-compose-owner.mjs';

const qualified=new WeakMap(),failures=new WeakMap(),Q=path.resolve('D:/sabalanerp-online-qa');
const python={file:path.resolve('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe'),sha256:'7ca24f26d6e3f463419ee4f537ddd3acd312c38fe45e678cce08572f26a8bd1a'};
const files={custody:'original-image-owner-custody.py',backendSource:'original-c3-backend-stream-source.py',backendOwner:'original-c3-backend-stream-owner.py',backendMaterial:'original-c3-backend-stream-material.py',repositorySource:'original-image-repository-source.py',repositoryChannel:'original-image-repository-channel.py',repositoryRemote:'original-image-repository-remote.py',repositoryTransport:'original-image-repository-transport.py'};
const bootstrap=(reference,args)=>['-I','-B','-c',"import hashlib,pathlib,sys;p=pathlib.Path(sys.argv.pop(1));r=p.read_bytes();assert len(r)<=2097152 and hashlib.sha256(r).hexdigest()==sys.argv.pop(1);sys.argv[0]=str(p);exec(compile(r,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})",reference.file,reference.sha256,...args];

export function readOriginalImageRepositoryQualification(token,nativeOwner){
 const held=qualified.get(token);assert.ok(held&&held.nativeOwner===nativeOwner,'ORIGINAL_IMAGE_REPOSITORY_QUALIFICATION_REQUIRED');held.revalidate();return structuredClone(held.record);
}
export function readOriginalKnownImageRepositoryFailure(error,nativeOwner){
 const held=failures.get(error);assert.ok(held&&held.nativeOwner===nativeOwner,'ORIGINAL_KNOWN_IMAGE_REPOSITORY_FAILURE_REQUIRED');held.revalidate();return structuredClone(held.record);
}

export async function runOriginalImageRepository({nativeOwner,localCompletion,independentCompletion,acquireCredential,signal}){
 // No process, directory, credential or mutable resource before genuine tokens.
 const retirement=readOriginalCompleteRetirementFor(independentCompletion,nativeOwner,localCompletion);
 assertOriginalCandidateRollbackOwner(nativeOwner);
 const local=readOriginalRoleQualificationCompletion(localCompletion),full=readOriginalExistingComposeComplete(independentCompletion);
 const operation=randomBytes(16).toString('hex'),capacityRefusals=new WeakSet();
 const capacity=async()=>{await nativeOwner.assertCompleteCurrent();try{await nativeOwner.assertImageRepositoryCapacity();nativeOwner.assertMemoryWorkAdmission();}catch(error){assertOriginalCandidateRollbackOwner(nativeOwner);assert.equal(nativeOwner.inspect().unknown,false);capacityRefusals.add(error);throw error;}};
 const isKnownCallbackRefusal=error=>{if(capacityRefusals.has(error))return true;try{readOriginalClosedProductionInputRefusal(error,nativeOwner);return true;}catch{return false;}};
 const noStartedFailure=error=>{
  assert.ok(isKnownCallbackRefusal(error));assertOriginalCandidateRollbackOwner(nativeOwner);assert.equal(nativeOwner.inspect().unknown,false);
  const record={format:'sabalan-original-image-repository-qualification/v1',operation,rootOperation:nativeOwner.operation,localHistorySha256:local.historySha256,fullHistorySha256:full.historySha256,retirement,ownerNotStarted:true,ownerResult:null,originalClosure:null,repository:null,retrievalQualified:false,productionAdmission:false};
  failures.set(error,{nativeOwner,record,revalidate(){assertOriginalCandidateRollbackOwner(nativeOwner);assert.deepEqual(readOriginalCompleteRetirementFor(independentCompletion,nativeOwner,localCompletion),retirement);}});throw error;
 };
 try{await capacity();}catch(error){if(isKnownCallbackRefusal(error))noStartedFailure(error);throw error;}
 const context=await nativeOwner.readImageRepositoryOwnerContext();assert.equal(context.rootPid,process.pid);assert.equal(context.rootOperation,nativeOwner.operation);
 const content=readOriginalDeploymentImageContent(),reader=completePlanReader();reader.read(python,32*1024**2);
 for(const ref of Object.values(context.sources))reader.read(ref,2*1024**2);
 const commands=originalBackendBaseCommands();let facts,queryClosure;
 try{
  const row=await commands.run(python.file,bootstrap(context.sources['original-image-owner-custody.py'],['--root-lease-facts',String(process.pid),String(context.leaseProviderPid)]),{maximum:65536});
  commands.assertSuccessful(row);assert.equal(row.stderr,'');assert.ok(row.stdoutEof&&row.stderrEof&&!row.killed);facts=JSON.parse(row.stdout);
 }finally{queryClosure=await commands.close();}
 assert.equal(queryClosure.allOriginalChildrenClosed,true);assert.equal(queryClosure.interrupted,false);
 assert.equal(facts.format,'sabalan-image-owner-parent-facts/v1');assert.equal(facts.signalsSent,0);assert.equal(facts.leaseAcquired,false);assert.equal(facts.nativeActionsExecuted,false);
 assert.equal(facts.parent.root.pid,process.pid);assert.equal(facts.parent.lease.pid,context.leaseProviderPid);assert.equal(path.resolve(facts.parent.lockFile),path.resolve(context.leaseFile));
 await nativeOwner.assertCompleteCurrent();nativeOwner.assertMemoryWorkAdmission();reader.revalidate();content.revalidate();
 const sourceDirectory=path.join(Q,'419-image-repository-source-'+operation),auditDirectory=path.join(Q,'419-image-repository-'+operation);
 const sourceCustody=await prepareOriginalPrivateEvidenceDirectory(sourceDirectory),auditCustody=await prepareOriginalPrivateEvidenceDirectory(auditDirectory);
 const configuration={format:'sabalan-c3-image-repository-owner-input/v1',operation,rootOperation:context.rootOperation,parent:facts.parent,sources:Object.fromEntries(Object.entries(files).map(([key,name])=>[key,context.sources[name]])),auditDirectory,retirement,content:content.content,productionAdmission:false};
 const configurationReference=writeCompletePlanFile(sourceDirectory,'configuration.json',Buffer.from(JSON.stringify(configuration)+'\n'));reader.read(configurationReference);
 let readyOwner,closed;
 const revalidate=()=>{
  assertOriginalCandidateRollbackOwner(nativeOwner);reader.revalidate();content.revalidate();assertOriginalPrivateEvidenceDirectory(sourceCustody,sourceDirectory);assertOriginalPrivateEvidenceDirectory(auditCustody,auditDirectory);
  assert.deepEqual(readOriginalCompleteRetirementFor(independentCompletion,nativeOwner,localCompletion),retirement);
 };
 const current=async()=>{revalidate();await capacity();};
 let ownerToken;
 try{ownerToken=await collectOriginalCompleteOwner({purpose:'IMAGE_REPOSITORY',operation,signal,isKnownClosedCallbackRefusal:isKnownCallbackRefusal,
  command:{executable:python.file,argv:bootstrap(context.sources['original-image-repository-owner.py'],[configurationReference.file,configurationReference.sha256])},
  beforeCredential:current,acquireCredential,
  onOriginalReady:async token=>{assert.equal(assertOriginalImageRepositoryReadyOwner(token),operation);readyOwner=token;},
  onImageRepositoryRequest:async(request,token)=>{
   assert.equal(token,readyOwner);assert.equal(assertOriginalImageRepositoryActiveOwner(token),operation);await current();
   const productionToken=await collectOriginalCompleteProductionInputs(nativeOwner,{localCompletion,independentCompletion}),inputs=readOriginalCompleteProductionInputs(productionToken,nativeOwner);
   assert.equal(inputs.value.beforeLocal,false);await current();
   const reference=writeCompletePlanFile(sourceDirectory,'phase-'+request.sequence+'.json',Buffer.from(JSON.stringify({format:'sabalan-c3-image-repository-phase-input/v1',operation,rootOperation:context.rootOperation,stage:request.stage,productionInputs:inputs.value,productionAdmission:false})+'\n'));reader.read(reference);
   inputs.revalidate();await current();assert.equal(assertOriginalImageRepositoryActiveOwner(token),operation);
   return{format:'sabalan-image-repository-phase-plan/v1',operation,stage:request.stage,configuration:{file:reference.file,sha256:reference.sha256},productionAdmission:false};
  },onClosed:async row=>{closed=row;await nativeOwner.persistCompleteOwnerClosure(operation,row,{purpose:'IMAGE_REPOSITORY',productionAdmission:false});},
 });}catch(error){if(!readyOwner&&isKnownCallbackRefusal(error))noStartedFailure(error);throw error;}
 assertOriginalImageRepositoryClosedOwnerFor(ownerToken,readyOwner);
 const original=readOriginalImageRepositoryOwner(ownerToken);assert.deepEqual(original.row,closed);assert.equal(original.resultReference.file,path.join(auditDirectory,'owner-result.json'));
 const result=JSON.parse(reader.read(original.resultReference));assert.equal(result.format,'sabalan-c3-image-repository-owner/v1');assert.equal(result.operation,operation);assert.equal(result.rootOperation,context.rootOperation);assert.deepEqual(result.retirement,retirement);assert.equal(result.productionAdmission,false);assert.equal(result.outerOriginalClosurePending,true);
 assert.equal(result.originalCustodyKnown,true,'IMAGE_REPOSITORY_ORIGINAL_CUSTODY_NOT_PROVEN');
 let callbackRefusal=null;try{callbackRefusal=readOriginalImageCallbackRefusal(ownerToken);}catch{/* Ordinary completed owner. */}
 if(callbackRefusal){assert.ok(isKnownCallbackRefusal(callbackRefusal));assert.equal(result.retrievalQualified,false);}
 revalidate();await nativeOwner.assertCompleteCurrent();
 const record={format:'sabalan-original-image-repository-qualification/v1',operation,rootOperation:context.rootOperation,localHistorySha256:local.historySha256,fullHistorySha256:full.historySha256,retirement,ownerResult:{file:original.resultReference.file,sha256:original.resultReference.sha256},originalClosure:closed,queryClosure,retrievalQualified:result.retrievalQualified,backendComponent:result.backendComponent,repository:result.repository,productionAdmission:false};
 if(!result.retrievalQualified){const error=Error('ORIGINAL_IMAGE_REPOSITORY_CLOSED_NEGATIVE');failures.set(error,{nativeOwner,record,revalidate});throw error;}
 assert.equal(original.resultReference.retrievalQualified,true);assert.equal(result.phases.length,3);assert.equal(result.repository.retrievalQualified,true);assert.equal(result.repository.remoteOriginalsClosed,true);assert.equal(result.repository.original.actualOriginalClosed,true);
 assert.equal(result.repository.remote.fullOperation,retirement.operation);assert.equal(result.repository.remote.imageImported,false);assert.equal(result.repository.remote.productionAdmission,false);
 try{await current();}catch(error){
  if(isKnownCallbackRefusal(error)){record.unitRetrievalQualified=true;record.retrievalQualified=false;record.negativeGate='CAPACITY_AFTER_ORIGINAL_CLOSED';failures.set(error,{nativeOwner,record,revalidate});}
  throw error;
 }
 const token=Object.freeze({});qualified.set(token,{nativeOwner,record,revalidate});return token;
}
