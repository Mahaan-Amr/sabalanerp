/** Production registry kernel. Registry creation is not publication or admission.
 * Registry rows cannot mint native/startup authority. The original host keeps
 * its actual locks, key and child/channel history and signs separately only
 * after observing its OWN qualification actors. No signer is exported here.
 */
import type {PrismaClient,Prisma} from '@prisma/client';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {readOnlineReleaseEvidence} from './onlineReleaseEvidence';

export type OnlineRegistrationOwner={deploymentId:string;leaseToken:string;releaseId:string};
type Descriptor={file:string;bytes:number;sha256:string};
export type PreparedRegistration={
 evidenceDirectory:string;manifestSha256:string;acceptanceSha256:string;
 previousReleaseId:string|null;
 scopes:Array<{file:string;sha256:string;scope:{format:string;runtimeId:string;nonce:string;role:string;purpose:string;
   releaseId:string;image:string;sourceCommit:string;manifestSha256:string;database:{name:string;systemIdentifier:string}}}>;
};
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function required(value:unknown,code:string):asserts value{if(!value)throw Error(code);}

/** Same lease-token pattern as applyOnlineExpansion. This fixed operation is
 * callable only by the original controller's private SQL command channel;
 * never route it through Express or an application permission endpoint.
 * ONLINE_ACCEPTING is an explicit NEW online lane, not a fabricated passage
 * through ADR-0039's MAINTENANCE/SERVICES_DRAINED transitions.
 */
export function prepareValidatedOnlineRegistration(owner:OnlineRegistrationOwner,input:PreparedRegistration){
 const accepted=readOnlineReleaseEvidence(input.evidenceDirectory,{
  manifestSha256:input.manifestSha256,acceptanceSha256:input.acceptanceSha256});
 const {manifest,acceptance}=accepted;
 required(manifest.releaseId===owner.releaseId&&acceptance.deploymentId===owner.deploymentId,'ONLINE_REGISTRATION_OWNER_CHANGED');
 required(input.scopes.length>=2&&input.scopes.length<=1024,'ONLINE_REGISTRATION_SCOPES_UNPROVEN');
 const slots=input.scopes.map(({scope,sha256,file})=>{
  required(path.isAbsolute(file)&&fs.realpathSync(file)===file,'ONLINE_REGISTRATION_SCOPE_FILE_UNPROVEN');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {const st=fs.fstatSync(fd,{bigint:true});
   required(st.isFile()&&st.nlink===1n&&st.size>0n&&st.size<=32768n,'ONLINE_REGISTRATION_SCOPE_FILE_UNPROVEN');
   const raw=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true});
   required(st.dev===after.dev&&st.ino===after.ino&&st.mtimeNs===after.mtimeNs&&st.ctimeNs===after.ctimeNs
    &&createHash('sha256').update(raw).digest('hex')===sha256&&hash(JSON.parse(raw.toString()))===hash(scope),
    'ONLINE_REGISTRATION_SCOPE_FILE_CHANGED');
  } finally {fs.closeSync(fd);}
  required(scope.format==='sabalan-online-runtime-scope/v2'&&/^[a-f0-9]{64}$/.test(scope.runtimeId)
   &&/^[a-f0-9]{64}$/.test(scope.nonce)&&sha256===createHash('sha256').update(JSON.stringify(canonical(scope))+'\n').digest('hex')
   &&scope.releaseId===manifest.releaseId&&scope.image===manifest.image&&scope.sourceCommit===manifest.sourceCommit
   &&scope.manifestSha256===manifest.runtimeBundleSha256&&hash(scope.database)===hash(manifest.database)
   &&((scope.purpose==='http'&&scope.role==='serving')||(scope.purpose==='jobs'&&scope.role==='control')),'ONLINE_REGISTRATION_SCOPE_CHANGED');
  return{id:scope.runtimeId,releaseId:owner.releaseId,component:'backend',role:scope.role,phase:'PREPARED',
   nonceSha256:createHash('sha256').update(scope.nonce).digest('hex'),imageIdentity:scope.image};
 });
 required(new Set(slots.map(slot=>slot.id)).size===slots.length&&new Set(slots.map(slot=>slot.nonceSha256)).size===slots.length
  &&input.scopes.filter(item=>item.scope.purpose==='jobs').length===1
  &&input.scopes.some(item=>item.scope.purpose==='http'),'ONLINE_REGISTRATION_DUPLICATE_SCOPE');
 const compatibilityJson={format:'sabalan-online-compatibility-index/v1',
  reports:Object.fromEntries(Object.entries(acceptance.reports as Record<string,Descriptor>)
   .filter(([scope])=>['compatible-migrations','browser-24-hours','single-worker-and-completion','current-domain'].includes(scope)))};
 const recoveryJson={format:'sabalan-online-recovery-index/v1',checkpointSha256:acceptance.checkpointSha256,
  report:acceptance.reports['coherent-independent-restore'],qualification:acceptance.qualification};
 const identityJson={format:'sabalan-online-release-identity/v1',manifestSha256:input.manifestSha256,
  acceptanceSha256:input.acceptanceSha256,compatibilitySha256:hash(compatibilityJson),recoverySha256:hash(recoveryJson)};
 return{accepted,manifest,acceptance,slots,compatibilityJson,recoveryJson,identityJson};
}

export async function registerAcceptedOnlineRelease(database:PrismaClient,owner:OnlineRegistrationOwner,input:PreparedRegistration){
 required(input.previousReleaseId!==null,'ONLINE_REGISTRATION_REQUIRES_PROVEN_BOOTSTRAP_PREDECESSOR');
 const {accepted,manifest,acceptance,slots,compatibilityJson,recoveryJson,identityJson}=prepareValidatedOnlineRegistration(owner,input);
 required(acceptance.qualification.recoveryMode==='ONLINE_COHERENT_WAL','ONLINE_REGISTRATION_COHERENT_WAL_REQUIRED');
 return database.$transaction(async(tx:Prisma.TransactionClient)=>{
  const rows=await tx.$queryRaw<Array<{id:string;releaseId:string;targetCommit:string;phase:string;checkpointJson:any}>>`
   SELECT id,"releaseId","targetCommit",phase,"checkpointJson" FROM deployment_operations
   WHERE id=${owner.deploymentId} AND "leaseToken"=${owner.leaseToken} AND "activeKey"='production'
    AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR UPDATE`;
  required(rows.length===1&&rows[0].releaseId===owner.releaseId&&rows[0].targetCommit===manifest.sourceCommit
   &&rows[0].phase==='ONLINE_ACCEPTING','ONLINE_REGISTRATION_OWNED_ONLINE_LEASE_REQUIRED');
  const checkpoint=rows[0].checkpointJson;
  required(checkpoint&&checkpoint.deploymentId===owner.deploymentId&&checkpoint.releaseId===owner.releaseId
   &&checkpoint.localVerified===true&&checkpoint.remoteVerified===true&&checkpoint.restoreVerified===true
   &&checkpoint.manifestReadable===true&&checkpoint.compatibility?.local?.compatible===true
   &&checkpoint.compatibility?.remote?.compatible===true&&hash(checkpoint)===acceptance.checkpointSha256,
   'ONLINE_REGISTRATION_CHECKPOINT_CHANGED');
  const identities=await tx.$queryRaw<Array<{name:string;systemIdentifier:string;oid:string}>>`
   SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid
   FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()`;
  required(identities.length===1&&hash(identities[0])===hash({...manifest.database,oid:acceptance.qualification.deploymentTargetDatabase.oid}),
   'ONLINE_REGISTRATION_DATABASE_CHANGED');
  if(input.previousReleaseId!==null){
   const previous=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM online_releases
    WHERE id=${input.previousReleaseId} AND phase='SERVING' AND ("retiredAt" IS NULL OR EXISTS(SELECT 1 FROM online_serving_epochs e
      WHERE e."releaseId"=online_releases.id AND e."retiredAt" IS NULL)) FOR SHARE`;
   required(previous.length===1,'ONLINE_REGISTRATION_PREDECESSOR_UNPROVEN');
  }
  accepted.revalidate();
  const existing=await tx.onlineRelease.findUnique({where:{id:owner.releaseId}});
  if(existing){
   required(existing.phase==='ACCEPTING'&&existing.deploymentId===owner.deploymentId
    &&existing.manifestSha256===input.manifestSha256&&hash(existing.identityJson)===hash(identityJson)
    &&hash(existing.acceptanceJson)===hash(acceptance),'ONLINE_REGISTRATION_PREPARATION_CHANGED');
   const actual=await tx.onlineRuntimeSlot.findMany({where:{releaseId:owner.releaseId}});
   const fields=(slot:any)=>({id:slot.id,releaseId:slot.releaseId,component:slot.component,role:slot.role,
    phase:slot.phase,nonceSha256:slot.nonceSha256,imageIdentity:slot.imageIdentity});
   required(hash(actual.map(fields).sort((a,b)=>a.id.localeCompare(b.id)))
    ===hash(slots.map(fields).sort((a,b)=>a.id.localeCompare(b.id))),'ONLINE_REGISTRATION_PREPARED_SLOTS_CHANGED');
   await tx.onlineRelease.update({where:{id:owner.releaseId},data:{phase:'READY'}});
  }else await tx.onlineRelease.create({data:{id:owner.releaseId,deploymentId:owner.deploymentId,
   manifestSha256:input.manifestSha256,sourceCommit:manifest.sourceCommit,identityJson,compatibilityJson,recoveryJson,
   acceptanceJson:acceptance,phase:'READY',previousReleaseId:input.previousReleaseId}});
  if(!existing)await tx.onlineRuntimeSlot.createMany({data:slots});
  await tx.deploymentOperation.update({where:{id:owner.deploymentId},data:{phase:'ONLINE_READY'}});
  return{format:'sabalan-online-owned-registry-registration/v1',releaseId:owner.releaseId,
   phase:'READY',slots:slots.map(slot=>slot.id),manifestSha256:input.manifestSha256,
   acceptanceSha256:input.acceptanceSha256,startupAuthorityIssued:false,publicTrafficPublished:false};
 },{timeout:30000,maxWait:1000});
}
