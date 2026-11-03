/** Same Root's finite, no-delete two-host capacity observation. */
import assert from 'node:assert/strict';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {assertOriginalCandidateRollbackOwner} from './original-candidate-rollback-owner.mjs';
import {completePlanReader,writeCompletePlanFile} from './original-complete-plan-files.mjs';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from './original-private-evidence-directory.mjs';
import {originalBackendBaseCommands} from './production-backend-base-process.mjs';
import {collectOriginalCompleteOwner,readOriginalReadOnlyStorageOwner,readOriginalReadOnlyStorageCallbackRefusal,assertOriginalReadOnlyStorageReadyOwner} from './original-existing-compose-owner.mjs';
import {readOriginalPrivatePreflightRefusal} from './original-private-preflight-input.mjs';
import {readOriginalCompleteRetirementFor} from './original-existing-compose-complete.mjs';
import {readOriginalDeploymentImageContent} from './original-deployment-image-content.mjs';

const Q=path.resolve('D:/sabalanerp-online-qa'),negatives=new WeakMap();
const python={file:path.resolve('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe'),sha256:'7ca24f26d6e3f463419ee4f537ddd3acd312c38fe45e678cce08572f26a8bd1a'};
const files={custody:'deploy/scripts/original-image-owner-custody.py',backendSource:'deploy/scripts/original-c3-backend-stream-source.py',imageSource:'deploy/scripts/original-image-repository-source.py',readonlySource:'deploy/scripts/original-readonly-storage-source.py',sourceRemote:'deploy/scripts/original-readonly-storage-source-remote.py',sourceReadiness:'deploy/scripts/original-source-runtime-diagnostics.py',backupRemote:'deploy/scripts/original-readonly-storage-backup-remote.py',backupHost:'deploy/scripts/original-image-repository-remote.py',channel:'deploy/scripts/original-image-repository-channel.py',canonicalStorage:'deploy/scripts/storage-preflight.mjs',canonicalInventory:'scripts/deployment-storage.mjs'};
const bootstrap=(ref,args)=>['-I','-B','-c',"import hashlib,pathlib,sys;p=pathlib.Path(sys.argv.pop(1));r=p.read_bytes();assert len(r)<=2097152 and hashlib.sha256(r).hexdigest()==sys.argv.pop(1);sys.argv[0]=str(p);exec(compile(r,str(p),'exec'),{'__name__':'__main__','__file__':str(p)})",ref.file,ref.sha256,...args];

export function readOriginalReadOnlyStorageRefusal(error,owner){const held=negatives.get(error);assert.ok(held?.owner===owner,'ORIGINAL_READONLY_STORAGE_CLOSED_REFUSAL_REQUIRED');held.revalidate();return structuredClone(held.record);}

export async function collectOriginalReadOnlyStoragePreflight(owner,{runtime,admission,beforeLocal=false,localCompletion,independentCompletion}){
 assertOriginalCandidateRollbackOwner(owner);assert.equal(typeof beforeLocal,'boolean');
 const current=async()=>{assertOriginalCandidateRollbackOwner(owner);if(beforeLocal)owner.assertPreparingCurrent();else await owner.assertCompleteCurrent();};
 await current();
 const operation=randomBytes(16).toString('hex'),reader=completePlanReader(),capacityRefusals=new WeakSet();
 try{await owner.prepareReadOnlyStorageAdmission({beforeLocal});}catch(error){
  assertOriginalCandidateRollbackOwner(owner);assert.equal(owner.inspect().unknown,false);
  negatives.set(error,{owner,record:{operation,ownerNotStarted:true,remoteActorsStarted:false,preflightSucceeded:false,productionAdmission:false},revalidate(){assertOriginalCandidateRollbackOwner(owner);}});throw error;
 }
 let retirement=null;
 if(independentCompletion!==undefined){assert.equal(beforeLocal,false);retirement=readOriginalCompleteRetirementFor(independentCompletion,owner,localCompletion);}else assert.equal(localCompletion,undefined);
 const content=readOriginalDeploymentImageContent();
 // Backend GCM framing/wrapped key allowance; accepted role ciphers unchanged.
 const capacity={rootOperation:owner.operation,purpose:retirement?'IMAGE_STAGING':'COMPLETE_FULL',cipherBytes:1242945672,imageCipherUpperBoundBytes:content.content.images.backend.gzip.bytes+1024**2+content.content.images.frontend.cipher.bytes+content.content.images.inquiry.cipher.bytes,...(retirement?{retirement}:{})};
 const context=await owner.readReadOnlyStorageOwnerContext({beforeLocal});assert.equal(context.rootPid,process.pid);assert.equal(context.rootOperation,owner.operation);
 reader.read(python,32*1024**2);reader.read(runtime);reader.read(admission);
 for(const file of Object.values(files))assert.ok(context.sources[file],'READONLY_STORAGE_REQUIRED_SOURCE_NOT_BOUND:'+file);
 for(const ref of Object.values(context.sources))reader.read(ref,2*1024**2);
 const commands=originalBackendBaseCommands();let facts,queryClosure;
 try{
  const row=await commands.run(python.file,bootstrap(context.sources[files.custody],['--root-lease-facts',String(process.pid),String(context.leaseProviderPid)]),{maximum:65536});
  commands.assertSuccessful(row);assert.equal(row.stderr,'');assert.ok(row.stdoutEof&&row.stderrEof&&!row.killed);facts=JSON.parse(row.stdout);
 }finally{queryClosure=await commands.close();}
 assert.equal(queryClosure.allOriginalChildrenClosed,true);assert.equal(queryClosure.interrupted,false);
 assert.equal(facts.format,'sabalan-image-owner-parent-facts/v1');assert.equal(facts.signalsSent,0);assert.equal(facts.leaseAcquired,false);assert.equal(facts.nativeActionsExecuted,false);
 assert.equal(facts.parent.root.pid,process.pid);assert.equal(facts.parent.lease.pid,context.leaseProviderPid);assert.equal(path.resolve(facts.parent.lockFile),path.resolve(context.leaseFile));
 const directory=path.join(Q,'419-readonly-storage-source-'+operation),auditDirectory=path.join(Q,'419-readonly-storage-'+operation);
 const custody=await prepareOriginalPrivateEvidenceDirectory(directory),audit=await prepareOriginalPrivateEvidenceDirectory(auditDirectory);
 const config={format:'sabalan-readonly-storage-preflight-input/v1',operation,rootOperation:owner.operation,parent:facts.parent,sources:Object.fromEntries(Object.entries(files).map(([key,file])=>[key,context.sources[file]])),runtime,admission,auditDirectory,capacity,productionAdmission:false};
 const reference=writeCompletePlanFile(directory,'configuration.json',Buffer.from(JSON.stringify(config)+'\n'));reader.read(reference);
 const revalidate=()=>{assertOriginalCandidateRollbackOwner(owner);reader.revalidate();content.revalidate();assertOriginalPrivateEvidenceDirectory(custody,directory);assertOriginalPrivateEvidenceDirectory(audit,auditDirectory);if(retirement)assert.deepEqual(readOriginalCompleteRetirementFor(independentCompletion,owner,localCompletion),retirement);};
 const beforeCredential=async()=>{revalidate();await current();try{await owner.prepareReadOnlyStorageAdmission({beforeLocal});}catch(error){assert.equal(owner.inspect().unknown,false);capacityRefusals.add(error);throw error;}};
 const knownRefusal=error=>{if(capacityRefusals.has(error))return true;try{readOriginalPrivatePreflightRefusal(error,owner);return true;}catch{return false;}};
 let readyOwner,closed,token;
 try{
  token=await collectOriginalCompleteOwner({purpose:'READONLY_STORAGE_PREFLIGHT',operation,
   command:{executable:python.file,argv:bootstrap(context.sources['deploy/scripts/original-readonly-storage-preflight.py'],[reference.file,reference.sha256])},
   beforeCredential,acquireCredential:()=>owner.acquirePrivatePreflightCredential(),isKnownClosedCallbackRefusal:knownRefusal,
   onOriginalReady:async value=>{assert.equal(assertOriginalReadOnlyStorageReadyOwner(value),operation);readyOwner=value;},
   onClosed:async row=>{closed=row;await owner.persistReadOnlyStorageClosure(operation,row);},
  });
 }catch(error){
  if(!readyOwner&&knownRefusal(error)){negatives.set(error,{owner,record:{operation,ownerNotStarted:true,remoteActorsStarted:false,preflightSucceeded:false,productionAdmission:false},revalidate});throw error;}
  await owner.retainUnclassifiedFailure(error);throw error;
 }
 const original=readOriginalReadOnlyStorageOwner(token);assert.deepEqual(original.row,closed);assert.equal(original.resultReference.file,path.join(auditDirectory,'owner-result.json'));
 const result=JSON.parse(reader.read(original.resultReference));
 try{
  assert.equal(result.format,'sabalan-readonly-storage-preflight-owner/v1');assert.equal(result.operation,operation);assert.equal(result.rootOperation,owner.operation);assert.equal(result.runtimeSpecSha256,runtime.sha256);
  assert.equal(result.deletionApplied,false);assert.equal(result.storagePolicyChanged,false);assert.equal(result.productionAdmission,false);assert.equal(result.originalCustodyKnown,true,'READONLY_STORAGE_ORIGINAL_CUSTODY_NOT_PROVEN');
  if(result.preflightSucceeded){
   assert.equal(result.source.recoveryReadiness.length,3,'THREE_CURRENT_SOURCE_RECOVERY_OBSERVATIONS_REQUIRED');
   for(const sample of result.source.recoveryReadiness){
    assert.ok(Number.isFinite(Date.parse(sample.observedAt)));const value=sample.metadata;
    assert.equal(value.clear,true);assert.equal(value.transactionReadOnly,true);assert.equal(value.contentsReturned,false);
    assert.equal(value.state.mode,'NORMAL');assert.equal(value.state.operationPresent,false);
    assert.deepEqual(Object.keys(value.markers).sort(),['deployment-maintenance.json','inquiry-stopped','pending-restore.json','restart-inquiry']);assert.ok(Object.values(value.markers).every(v=>v===false));
    assert.deepEqual(Object.keys(value.activeCounts).sort(),['CREATING','RESTORING','VALIDATING']);assert.ok(Object.values(value.activeCounts).every(v=>v===0));
   }
  }
 }catch(error){await owner.retainUnclassifiedFailure(error);throw error;}
 revalidate();await current();
 const record={operation,result:original.resultReference,originalClosure:closed,queryClosure,preflightSucceeded:result.preflightSucceeded,remoteActorsStarted:result.remoteActorsStarted,productionAdmission:false};
 let callbackRefusal;try{callbackRefusal=readOriginalReadOnlyStorageCallbackRefusal(token);}catch{/* Ordinary result. */}
 if(callbackRefusal||!result.preflightSucceeded){
  if(callbackRefusal)assert.ok(knownRefusal(callbackRefusal));
  const error=callbackRefusal??Error('ORIGINAL_READONLY_STORAGE_CAPACITY_OR_HEALTH_REFUSED');negatives.set(error,{owner,record,revalidate});throw error;
 }
 assert.equal(original.resultReference.preflightSucceeded,true);
 for(const side of ['source','backup']){assert.equal(result[side].preflightSucceeded,true);assert.equal(result[side].operation,operation);assert.equal(result[side].allOriginalChildrenClosed,true);assert.equal(result[side].deletionApplied,false);}
 assert.equal(result.source.productionCommitBefore,result.source.productionCommitAfter);
 assert.equal(result.backup.FD9AndFD10HeldThroughPreflight,true);
 const report={observedAt:new Date().toISOString(),sshExitCode:0,stdout:JSON.stringify({exitCode:0,lockHeldThroughBothHostPreflight:true,productionCommitBefore:result.source.productionCommitBefore,productionCommitAfter:result.source.productionCommitAfter,stdout:[result.source.source,result.backup.backup].map(row=>JSON.stringify(row)).join('\n'),deletionApplied:false,storagePolicyChanged:false,originalOwner:record,backupBudget:result.backup.budget,backupFilesystem:result.backup.filesystem})};
 // Existing strict receipt consumer stays unchanged.
 return{report,record,revalidate};
}
