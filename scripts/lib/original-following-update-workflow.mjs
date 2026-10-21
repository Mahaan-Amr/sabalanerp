/** Drive the existing original server owner. No receipt can substitute for the
 * session capability checked by the fixed transport, or its qualification/WAL
 * callbacks. This function never creates a second owner or restores a database.
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import {sendOriginalProtectedClientControl,assertOriginalFollowingClient} from './original-protected-online-ssh.mjs';

const exact=(value,keys)=>{assert.equal(Object.keys(value).length,keys.length);for(const key of keys)assert.ok(Object.hasOwn(value,key));};
const runtimeId=value=>assert.match(value,/^[a-f0-9]{64}$/);

export async function runOriginalFollowingPromotion(session,{nextCycle,onProgress=()=>{},completeWith='PROMOTION'}){
 assertOriginalFollowingClient(session);
 assert.ok(['PROMOTION','CURRENT_DATA_ROLLBACK'].includes(completeWith));
 exact(nextCycle,['deploymentId','releaseId','targetCommit','prebuiltReleasePlan']);
 for(const key of ['deploymentId','releaseId'])assert.match(nextCycle[key],/^[A-Za-z0-9_-]{8,128}$/);
 assert.match(nextCycle.targetCommit,/^[a-f0-9]{40}$/);
 exact(nextCycle.prebuiltReleasePlan,['file','sha256']);
 assert.match(nextCycle.prebuiltReleasePlan.sha256,/^[a-f0-9]{64}$/);
 assert.equal(typeof nextCycle.prebuiltReleasePlan.file,'string');
 assert.ok(path.isAbsolute(nextCycle.prebuiltReleasePlan.file));
 assert.equal(typeof onProgress,'function');
 const run=async(command,input={})=>{
  const result=await sendOriginalProtectedClientControl(session,{command,input});
  assert.equal(result.command,command);assert.equal(result.status,'COMPLETED');
  assert.equal(result.releaseAcceptanceGranted,false);
  // Progress deliberately contains no scope, nonce, connection string or plan.
  await onProgress({command,completed:true});return result;
 };
 await run('ACQUIRE_NEXT',{input:nextCycle});
 assert.equal((await run('CREATE_CHECKPOINT')).checkpointCommitted,true);
 assert.equal((await run('QUALIFY_NEXT')).originalOnlineQualificationBound,true);
 for(const command of ['PREPARE_EXPANSION','RUN_EXPANSION','REGISTER'])await run(command);
 const {cyclePlan:cycle}=await run('READ_CYCLE_PLAN');
 assert.equal(cycle.releaseId,nextCycle.releaseId);
 assert.notEqual(cycle.previousReleaseId,cycle.releaseId);
 assert.ok(cycle.httpRuntimeIds.length>0&&cycle.jobsRuntimeIds.length===1);
 const ids=[...cycle.httpRuntimeIds,...cycle.jobsRuntimeIds];
 ids.forEach(runtimeId);assert.equal(new Set(ids).size,ids.length);
 assert.equal(typeof cycle.buildIds.erp,'string');assert.equal(typeof cycle.buildIds.inquiry,'string');
 await run('PROVISION_CARRIERS',{input:{releaseId:cycle.releaseId,backendRuntimeIds:ids,buildId:cycle.buildIds.erp}});
 for(const id of cycle.httpRuntimeIds){
  await run('START_RUNTIME',{input:{releaseId:cycle.releaseId,runtimeId:id}});
  await run('WAIT_READY',{runtimeId:id});
 }
 const inquiry=cycle.inquiry;
 exact(inquiry,['kind','buildId','runtimeId','releaseId','image','manifestSha256']);
 assert.equal(inquiry.buildId,cycle.buildIds.inquiry);
 assert.match(inquiry.image,/^sha256:[a-f0-9]{64}$/);assert.match(inquiry.manifestSha256,/^[a-f0-9]{64}$/);
 if(inquiry.kind==='REUSE_ORIGINAL'){
  runtimeId(inquiry.runtimeId);assert.equal(typeof inquiry.releaseId,'string');
 }else{
  assert.equal(inquiry.kind,'PREPARE_NEW');assert.equal(inquiry.runtimeId,null);assert.equal(inquiry.releaseId,cycle.releaseId);
  const prepared=await run('PREPARE_INQUIRY',{input:{releaseId:cycle.releaseId,buildId:inquiry.buildId}});
  runtimeId(prepared.runtimeId);
  await run('START_INQUIRY',{input:{releaseId:cycle.releaseId,runtimeId:prepared.runtimeId}});
 }
 await run('APPEND_EDGE_ENDPOINTS');
 await run('RUN_PRODUCTION_GATES',{input:{releaseId:cycle.releaseId}});
 const {publicationPlan}=await run('BUILD_PUBLICATION_REGISTRY',{input:{releaseId:cycle.releaseId}});
 exact(publicationPlan,['registry','expectedPublicationSha256','releaseId','previousReleaseId','rollback']);
 assert.equal(publicationPlan.releaseId,cycle.releaseId);assert.equal(publicationPlan.previousReleaseId,cycle.previousReleaseId);
 assert.equal(publicationPlan.rollback,false);assert.match(publicationPlan.expectedPublicationSha256,/^[a-f0-9]{64}$/);
 await run('TRANSITION',{nextPhase:'ONLINE_PUBLISHING'});
 await run('PUBLISH',{input:publicationPlan});
 // Publication commits ONLINE_SERVING. Only then may the new worker start;
 // the server independently proves native predecessor closure and worker lock.
 for(const id of cycle.jobsRuntimeIds){
  await run('START_RUNTIME',{input:{releaseId:cycle.releaseId,runtimeId:id}});
  await run('WAIT_READY',{runtimeId:id});
 }
 if(completeWith==='CURRENT_DATA_ROLLBACK'){
  for(const id of cycle.jobsRuntimeIds){
   for(const command of ['PREPARE_DRAIN','WAIT_PREPARED','SHUTDOWN','WAIT_CLOSED'])await run(command,{runtimeId:id});
  }
  await run('TRANSITION',{nextPhase:'ONLINE_ROLLBACK_PUBLISHING'});
  const {rollbackPlan}=await run('PREPARE_RETAINED_ROLLBACK',{input:{releaseId:cycle.previousReleaseId}});
  exact(rollbackPlan,['releaseId','jobsRuntimeIds']);assert.equal(rollbackPlan.releaseId,cycle.previousReleaseId);
  assert.equal(rollbackPlan.jobsRuntimeIds.length,1);rollbackPlan.jobsRuntimeIds.forEach(runtimeId);
  assert.ok(!ids.includes(rollbackPlan.jobsRuntimeIds[0]),'ROLLBACK_WORKER_MUST_BE_FRESH');
  await run('RUN_PRODUCTION_GATES',{input:{releaseId:rollbackPlan.releaseId}});
  const rollback=(await run('BUILD_PUBLICATION_REGISTRY',{input:{releaseId:rollbackPlan.releaseId}})).publicationPlan;
  exact(rollback,['registry','expectedPublicationSha256','releaseId','previousReleaseId','rollback']);
  assert.equal(rollback.rollback,true);assert.equal(rollback.releaseId,cycle.previousReleaseId);assert.equal(rollback.previousReleaseId,cycle.releaseId);
  assert.match(rollback.expectedPublicationSha256,/^[a-f0-9]{64}$/);
  await run('PUBLISH',{input:rollback});
  for(const id of rollbackPlan.jobsRuntimeIds){
   await run('START_RUNTIME',{input:{releaseId:rollbackPlan.releaseId,runtimeId:id}});
   await run('WAIT_READY',{runtimeId:id});
  }
 }
 await run('FINISH_CYCLE');
 return Object.freeze({deploymentId:nextCycle.deploymentId,releaseId:cycle.releaseId,
  servingReleaseId:completeWith==='PROMOTION'?cycle.releaseId:cycle.previousReleaseId,
  applicationUpdateSucceeded:completeWith==='PROMOTION',currentDataRollbackCompleted:completeWith==='CURRENT_DATA_ROLLBACK',
  attemptedWorkflowCompleted:true,clientDetached:false,productionAdmission:false});
}
