import type {PrismaClient} from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {assertOwnedOnlineLease} from './onlineReleaseEpochs';
import {readOnlineReleaseEvidence} from './onlineReleaseEvidence';
import {prepareValidatedRetainedWorkerRegistration,type OnlineRegistrationOwner,type PreparedRegistration} from './onlineReleaseRegistration';

type ScopeFile=PreparedRegistration['scopes'][number];
export type RetainedWorkerRegistration={registration:PreparedRegistration;previousJobsScope:ScopeFile;
 workerHostFile:string;checkpointSha256:string};
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
function need(v:unknown,code:string):asserts v{if(!v)throw Error(code);}
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.nlink,s.uid,s.gid,s.mode,s.size,s.mtimeNs,s.ctimeNs].map(String).join(':');

/** Enroll one fresh jobs incarnation for current-data rollback. The original
 * controller supplies its closed predecessor scope; HTTP/browser slots are
 * never inserted, rewritten or restarted by this entry. Native startup still
 * requires the original controller and the unchanged worker flock. */
export async function registerRetainedOnlineWorker(database:PrismaClient,owner:OnlineRegistrationOwner,input:RetainedWorkerRegistration){
 const registration=input.registration,accepted=readOnlineReleaseEvidence(registration.evidenceDirectory,registration);
 const targetOwner={...owner,releaseId:accepted.manifest.releaseId,deploymentId:accepted.acceptance.deploymentId};
 need(targetOwner.releaseId!==owner.releaseId&&/^[a-f0-9]{64}$/.test(input.checkpointSha256),'ONLINE_RETAINED_WORKER_TARGET_REQUIRED');
 const prepared=prepareValidatedRetainedWorkerRegistration(targetOwner,registration);
 const previous=prepareValidatedRetainedWorkerRegistration(targetOwner,{...registration,scopes:[input.previousJobsScope]});
 const fresh=registration.scopes[0].scope as ScopeFile['scope']&Record<string,any>,old=input.previousJobsScope.scope as typeof fresh;
 const stable=(scope:typeof fresh)=>Object.fromEntries(Object.entries(scope).filter(([key])=>!['runtimeId','nonce','nativeDirectory','boundaryDirectory'].includes(key)));
 need(fresh.runtimeId!==old.runtimeId&&fresh.nonce!==old.nonce&&hash(stable(fresh))===hash(stable(old)), 'ONLINE_RETAINED_WORKER_SCOPE_CHANGED');
 need(fresh.nativeDirectory!==old.nativeDirectory&&fresh.boundaryDirectory!==old.boundaryDirectory,'ONLINE_RETAINED_WORKER_NAMESPACE_REUSED');
 need(path.posix.isAbsolute(fresh.coordinationDirectory)&&fresh.nativeDirectory===path.posix.join(fresh.coordinationDirectory,'online/native',fresh.runtimeId)
  &&fresh.boundaryDirectory===path.posix.join(fresh.coordinationDirectory,'online/work',fresh.runtimeId),'ONLINE_RETAINED_WORKER_NAMESPACE_CHANGED');
 const worker=old.worker;
 need(worker&&path.isAbsolute(input.workerHostFile)&&fs.realpathSync(input.workerHostFile)===input.workerHostFile,'ONLINE_RETAINED_WORKER_LOCK_REQUIRED');
 const fd=fs.openSync(input.workerHostFile,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true});
  const checkWorker=()=>{const actual=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(input.workerHostFile,{bigint:true});
   need(actual.isFile()&&actual.uid===0n&&actual.nlink===1n&&actual.size===0n&&(actual.mode&0o077n)===0n
    &&String(actual.dev)===worker.device&&String(actual.ino)===worker.inode&&worker.ownerUid===0
    &&pin(actual)===pin(before)&&pin(named)===pin(before),'ONLINE_RETAINED_WORKER_LOCK_CHANGED');};
  checkWorker();
  return await database.$transaction(async tx=>{
   await assertOwnedOnlineLease(tx,owner,['ONLINE_ROLLBACK_PUBLISHING']);
   const [operation]=await tx.$queryRaw<Array<{checkpointJson:any}>>`SELECT "checkpointJson" FROM deployment_operations WHERE id=${owner.deploymentId}`;
   const checkpoint=operation?.checkpointJson;
   need(checkpoint?.deploymentId===owner.deploymentId&&checkpoint.releaseId===owner.releaseId&&checkpoint.captureMethod==='ONLINE_COHERENT_WAL'
    &&checkpoint.localVerified===true&&checkpoint.remoteVerified===true&&checkpoint.restoreVerified===true&&checkpoint.independentRestoreVerified===true
    &&checkpoint.manifestReadable===true&&checkpoint.compatibility?.local?.compatible===true&&checkpoint.compatibility?.remote?.compatible===true
    &&hash(checkpoint)===input.checkpointSha256,'ONLINE_RETAINED_WORKER_CHECKPOINT_CHANGED');
   const attempts=await tx.$queryRaw<Array<{previousReleaseId:string;acceptanceJson:any}>>`SELECT "previousReleaseId","acceptanceJson" FROM online_releases WHERE id=${owner.releaseId} FOR SHARE`;
   need(attempts.length===1&&attempts[0].previousReleaseId===targetOwner.releaseId
    &&attempts[0].acceptanceJson?.checkpointSha256===input.checkpointSha256,'ONLINE_RETAINED_WORKER_PREDECESSOR_CHANGED');
   const targets=await tx.$queryRaw<Array<{manifestSha256:string;identityJson:any}>>`SELECT "manifestSha256","identityJson" FROM online_releases
    WHERE id=${targetOwner.releaseId} AND phase='RETAINED' FOR UPDATE`;
   need(targets.length===1&&targets[0].manifestSha256===registration.manifestSha256&&targets[0].identityJson?.acceptanceSha256===registration.acceptanceSha256,'ONLINE_RETAINED_WORKER_ACCEPTANCE_CHANGED');
   const prior=await tx.$queryRaw<Array<{id:string;releaseId:string;role:string;component:string;phase:string;stoppedAt:Date|null;nonceSha256:string;imageIdentity:string}>>`SELECT id,"releaseId",role,component,phase,"stoppedAt","nonceSha256","imageIdentity"
    FROM online_runtime_slots WHERE "releaseId"=${targetOwner.releaseId} AND role='control' FOR UPDATE`;
   const slot=prior.find(row=>row.id===old.runtimeId),expected=previous.slots[0];
   need(slot&&slot.releaseId===targetOwner.releaseId&&slot.role===expected.role&&slot.component===expected.component&&slot.imageIdentity===expected.imageIdentity
    &&slot.nonceSha256===expected.nonceSha256&&prior.every(row=>row.phase==='STOPPED'&&row.stoppedAt instanceof Date),'ONLINE_RETAINED_WORKER_PREDECESSOR_NOT_CLOSED');
   const [identity]=await tx.$queryRaw<Array<{database:string;system:string;oid:string}>>`SELECT current_database() AS database,
    (SELECT system_identifier::text FROM pg_control_system()) AS system,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`;
   need(identity?.database===accepted.manifest.database.name&&identity.system===accepted.manifest.database.systemIdentifier
    &&identity.oid===accepted.acceptance.qualification.deploymentTargetDatabase.oid,'ONLINE_RETAINED_WORKER_DATABASE_CHANGED');
   accepted.revalidate();prepared.accepted.revalidate();previous.accepted.revalidate();checkWorker();
   const inserted=await tx.onlineRuntimeSlot.createMany({data:prepared.slots});need(inserted.count===1,'ONLINE_RETAINED_WORKER_INSERT_CHANGED');
   return {releaseId:targetOwner.releaseId,jobsRuntimeIds:prepared.slots.map(slot=>slot.id)};
  },{timeout:30000,maxWait:1000});
 }finally{fs.closeSync(fd);}
}
