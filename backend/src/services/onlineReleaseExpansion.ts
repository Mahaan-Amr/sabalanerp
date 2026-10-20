import type {PrismaClient,Prisma} from '@prisma/client';
import {createHash,randomUUID} from 'node:crypto';
import {prepareValidatedOnlineRegistration,type PreparedRegistration,type OnlineRegistrationOwner} from './onlineReleaseRegistration';
import {assertOwnedOnlineLease} from './onlineReleaseEpochs';
import {compileOnlineExpansion,applyOnlineExpansion,backfillMirroredColumn,verifyAppliedOnlineExpansion,
 mirroredBackfillOperationSha256,type MirroredBackfillPlan} from './onlineMigrationPlan';
import {deploymentMaintenanceActive} from './deploymentMaintenance';
import {RECOVERY_COORDINATION_DIR} from './recoveryRuntime';

const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function required(v:unknown,code:string):asserts v{if(!v)throw Error(code);}
type Prepared=ReturnType<typeof prepareValidatedOnlineRegistration>;
type Step={stepId:string;phase:string;operationSha256:string;operationJson:any;sourceMigrationName:string|null};
function qualified(input:Prepared){
 required(input.acceptance.qualification.recoveryMode==='ONLINE_COHERENT_WAL','ONLINE_EXPANSION_COHERENT_WAL_REQUIRED');
 const plans=input.accepted.migrationPlans.map(compileOnlineExpansion).sort((a,b)=>a.plan.migrationName.localeCompare(b.plan.migrationName));
 required(new Set(plans.map(plan=>plan.plan.migrationName)).size===plans.length,'ONLINE_EXPANSION_DUPLICATE_QUALIFIED_PLAN');
 const histories=input.accepted.migrationHistories;
 required(histories.length>0&&histories.every(value=>hash(value.before)===hash(histories[0].before)
  &&value.afterRows===value.before.rows+plans.length),'ONLINE_EXPANSION_QUALIFIED_HISTORY_CHANGED');
 const steps:Step[]=[];
 for(const compiled of plans){
  steps.push({stepId:compiled.plan.migrationName,phase:'expand',operationSha256:compiled.operationSha256,
   operationJson:JSON.parse(JSON.stringify(compiled.plan)),sourceMigrationName:compiled.plan.migrationName});
  for(const operation of compiled.plan.operations)if(operation.kind==='mirror-column'){
   const plan:MirroredBackfillPlan={format:'sabalan-mirror-backfill/v1',expansionMigrationName:compiled.plan.migrationName,operation};
   steps.push({stepId:compiled.plan.migrationName+':'+operation.table+':'+operation.column,phase:'backfill',
    operationSha256:mirroredBackfillOperationSha256(plan),operationJson:JSON.parse(JSON.stringify(plan)),sourceMigrationName:null});
  }
 }
 required(new Set(steps.map(step=>step.stepId)).size===steps.length,'ONLINE_EXPANSION_DUPLICATE_STEP');
 return{plans,steps:steps.sort((a,b)=>a.stepId.localeCompare(b.stepId)),history:histories[0].before};
}
async function assertContext(tx:Prisma.TransactionClient,owner:OnlineRegistrationOwner,input:PreparedRegistration,
 prepared:Prepared,phases:string[],releasePhases?:string[]){
 required(!deploymentMaintenanceActive(RECOVERY_COORDINATION_DIR),'ONLINE_EXPANSION_PROTECTED_BOUNDARY');
 await assertOwnedOnlineLease(tx,owner,phases);
 const rows=await tx.$queryRaw<Array<{targetCommit:string;checkpointJson:any}>>`
  SELECT "targetCommit","checkpointJson" FROM deployment_operations WHERE id=${owner.deploymentId}`;
 const checkpoint=rows[0]?.checkpointJson;
 required(rows.length===1&&rows[0].targetCommit===prepared.manifest.sourceCommit
  &&checkpoint&&checkpoint.deploymentId===owner.deploymentId&&checkpoint.releaseId===owner.releaseId
  &&checkpoint.localVerified===true&&checkpoint.remoteVerified===true&&checkpoint.restoreVerified===true
  &&checkpoint.manifestReadable===true&&checkpoint.compatibility?.local?.compatible===true
  &&checkpoint.compatibility?.remote?.compatible===true&&hash(checkpoint)===prepared.acceptance.checkpointSha256,
  'ONLINE_EXPANSION_VERIFIED_CHECKPOINT_REQUIRED');
 const previous=await tx.$queryRaw<Array<{id:string}>>`SELECT r.id FROM online_releases r
  WHERE r.id=${input.previousReleaseId} AND r.phase='SERVING' AND EXISTS(SELECT 1 FROM online_serving_epochs e
   WHERE e."releaseId"=r.id AND e."retiredAt" IS NULL) FOR SHARE`;
 required(previous.length===1,'ONLINE_EXPANSION_PREDECESSOR_CHANGED');
 const identities=await tx.$queryRaw<Array<{name:string;system:string;oid:string}>>`SELECT current_database() AS name,
  (SELECT system_identifier::text FROM pg_control_system()) AS system,
  (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`;
 required(identities.length===1&&identities[0].name===prepared.manifest.database.name
  &&identities[0].system===prepared.manifest.database.systemIdentifier&&identities[0].oid===prepared.acceptance.qualification.deploymentTargetDatabase.oid,
  'ONLINE_EXPANSION_DATABASE_CHANGED');
 if(releasePhases){
  const release=await tx.onlineRelease.findUnique({where:{id:owner.releaseId}});
  required(release&&releasePhases.includes(release.phase)&&release.deploymentId===owner.deploymentId
   &&release.previousReleaseId===input.previousReleaseId&&release.sourceCommit===prepared.manifest.sourceCommit
   &&release.manifestSha256===input.manifestSha256&&hash(release.identityJson)===hash(prepared.identityJson)
   &&hash(release.compatibilityJson)===hash(prepared.compatibilityJson)&&hash(release.recoveryJson)===hash(prepared.recoveryJson)
   &&hash(release.acceptanceJson)===hash(prepared.acceptance),'ONLINE_EXPANSION_PREPARATION_CHANGED');
  prepared.accepted.revalidate();return release;
 }
 prepared.accepted.revalidate();return undefined;
}
async function assertUnchangedPriorHistory(tx:Prisma.TransactionClient,expected:ReturnType<typeof qualified>){
 // Existing PostgreSQL history bytes stay exact. New rows have genuine fresh
 // IDs/timestamps and must never be compared to a restored clone's timestamps.
 const names=expected.plans.map(value=>value.plan.migrationName).join(',');
 const rows=await tx.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value
  FROM public._prisma_migrations t WHERE NOT(migration_name=ANY(string_to_array(${names},',')))`;
 required(rows.length===1&&JSON.parse(rows[0].value).length===expected.history.rows
  &&createHash('sha256').update(rows[0].value).digest('hex')===expected.history.sha256,'ONLINE_EXPANSION_PRIOR_HISTORY_CHANGED');
}
async function assertSteps(tx:Prisma.TransactionClient,owner:OnlineRegistrationOwner,expected:ReturnType<typeof qualified>){
 const actual=await tx.onlineMigrationStep.findMany({where:{releaseId:owner.releaseId},orderBy:{stepId:'asc'}});
 const identity=(step:any)=>({stepId:step.stepId,phase:step.phase,operationSha256:step.operationSha256,
  operationJson:step.operationJson,sourceMigrationName:step.sourceMigrationName??null});
 required(hash(actual.map(identity).sort((a,b)=>a.stepId.localeCompare(b.stepId)))===hash(expected.steps)
  &&actual.every(step=>['PENDING','RUNNING','COMPLETE'].includes(step.state)),'ONLINE_EXPANSION_STEP_LEDGER_CHANGED');
 return actual;
}

/** Independently qualify current data first. Unsupported canonical SQL never
 * enters this lane. Registration starts no runtime and publishes no traffic. */
export async function prepareAcceptedOnlineExpansion(database:PrismaClient,owner:OnlineRegistrationOwner,input:PreparedRegistration){
 required(input.previousReleaseId!==null,'ONLINE_EXPANSION_BOOTSTRAP_REQUIRED');
 const prepared=prepareValidatedOnlineRegistration(owner,input),expected=qualified(prepared);
 await database.$transaction(async tx=>{
  await assertContext(tx,owner,input,prepared,['ONLINE_CHECKPOINTING']);await assertUnchangedPriorHistory(tx,expected);
  const names=expected.plans.map(value=>value.plan.migrationName).join(',');
  const existing=await tx.$queryRaw<Array<{migration_name:string}>>`SELECT migration_name FROM public._prisma_migrations
   WHERE migration_name=ANY(string_to_array(${names},','))`;
  required(existing.length===0,'ONLINE_EXPANSION_FRESH_PLAN_ALREADY_APPLIED');
  const {manifest,acceptance,identityJson,compatibilityJson,recoveryJson,slots}=prepared;
  await tx.onlineRelease.create({data:{id:owner.releaseId,deploymentId:owner.deploymentId,
   manifestSha256:input.manifestSha256,sourceCommit:manifest.sourceCommit,identityJson,compatibilityJson,recoveryJson,
   acceptanceJson:acceptance,phase:'EXPANDING',previousReleaseId:input.previousReleaseId}});
  await tx.onlineRuntimeSlot.createMany({data:slots});
  for(const step of expected.steps)await tx.onlineMigrationStep.create({data:{id:randomUUID(),releaseId:owner.releaseId,...step,state:'PENDING'}});
  prepared.accepted.revalidate();await tx.deploymentOperation.update({where:{id:owner.deploymentId},data:{phase:'ONLINE_EXPANDING'}});
 },{timeout:30000,maxWait:1000});
 return{releaseId:owner.releaseId,qualifiedPlans:expected.plans.length,productionMutationStarted:false,productionAdmission:false};
}

export async function runAcceptedOnlineExpansion(database:PrismaClient,owner:OnlineRegistrationOwner,input:PreparedRegistration){
 required(input.previousReleaseId!==null,'ONLINE_EXPANSION_BOOTSTRAP_REQUIRED');
 const prepared=prepareValidatedOnlineRegistration(owner,input),expected=qualified(prepared);
 const inspect=()=>database.$transaction(async tx=>{
  const release=await assertContext(tx,owner,input,prepared,['ONLINE_EXPANDING'],['EXPANDING','BACKFILLING']);
  await assertUnchangedPriorHistory(tx,expected);await assertSteps(tx,owner,expected);return release!;
 },{timeout:15000,maxWait:1000});
 const release=await inspect();
 if(release.phase==='EXPANDING'){
  for(const compiled of expected.plans){await inspect();prepared.accepted.revalidate();
   await applyOnlineExpansion(database,owner,compiled.plan,Buffer.from(compiled.sql));}
  await database.$transaction(async tx=>{
   await assertContext(tx,owner,input,prepared,['ONLINE_EXPANDING'],['EXPANDING']);await assertUnchangedPriorHistory(tx,expected);
   const steps=await assertSteps(tx,owner,expected);
   required(steps.filter(step=>step.phase==='expand').every(step=>step.state==='COMPLETE'),'ONLINE_EXPANSION_DDL_NOT_COMPLETE');
   await tx.onlineRelease.update({where:{id:owner.releaseId},data:{phase:'BACKFILLING'}});
  },{timeout:15000,maxWait:1000});
 }
 // Resume verifies real applied schema/history without replaying DDL or
 // pretending to move the release back to its former expansion phase.
 for(const compiled of expected.plans){await inspect();await verifyAppliedOnlineExpansion(database,owner,compiled.plan);}
 for(const step of expected.steps.filter(value=>value.phase==='backfill')){
  let complete=false;while(!complete){await inspect();prepared.accepted.revalidate();
   complete=(await backfillMirroredColumn(database,owner,step.stepId,step.operationJson as MirroredBackfillPlan,200)).complete;}
 }
 for(const compiled of expected.plans){await inspect();await verifyAppliedOnlineExpansion(database,owner,compiled.plan);}
 await database.$transaction(async tx=>{
  await assertContext(tx,owner,input,prepared,['ONLINE_EXPANDING'],['BACKFILLING']);await assertUnchangedPriorHistory(tx,expected);
  const steps=await assertSteps(tx,owner,expected);required(steps.every(step=>step.state==='COMPLETE'),'ONLINE_EXPANSION_STEPS_NOT_COMPLETE');
  prepared.accepted.revalidate();await tx.onlineRelease.update({where:{id:owner.releaseId},data:{phase:'ACCEPTING'}});
  await tx.deploymentOperation.update({where:{id:owner.deploymentId},data:{phase:'ONLINE_ACCEPTING'}});
 },{timeout:15000,maxWait:1000});
 return{releaseId:owner.releaseId,phase:'ONLINE_ACCEPTING',qualifiedSchemaVerified:true,productionAdmission:false};
}
