import type {PrismaClient, Prisma} from '@prisma/client';
import {randomUUID} from 'node:crypto';
import type {OnlineRegistrationOwner} from './onlineReleaseRegistration';

function requireProof(value: unknown, code: string): asserts value { if (!value) throw new Error(code); }
export async function assertOwnedOnlineLease(tx: Prisma.TransactionClient, owner: OnlineRegistrationOwner, phases: string[]) {
  const rows=await tx.$queryRaw<Array<{releaseId:string;phase:string}>>`SELECT "releaseId",phase FROM deployment_operations
    WHERE id=${owner.deploymentId} AND "leaseToken"=${owner.leaseToken} AND "activeKey"='production'
      AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR UPDATE`;
  requireProof(rows.length===1 && rows[0].releaseId===owner.releaseId && phases.includes(rows[0].phase),'ONLINE_ORIGINAL_LEASE_LOST');
  return rows[0];
}

/** Called by the original paired publisher only after its own store.publish AND
 * durable readback. A SQL receipt never independently proves publication.
 * Failure after publication leaves the original publisher held for recovery.
 * Rollback changes code epochs on the CURRENT database; it never restores SQL.
 */
export async function recordOwnedOnlinePublication(database:PrismaClient, owner:OnlineRegistrationOwner, publication:{
  releaseId:string;previousReleaseId:string;generation:number;publicationSha256:string;rollback:boolean;
}) {
  requireProof(/^[a-f0-9]{64}$/.test(publication.publicationSha256) && Number.isSafeInteger(publication.generation)
    && publication.generation>1 && publication.releaseId!==publication.previousReleaseId,'ONLINE_PUBLICATION_IDENTITY_REQUIRED');
  return database.$transaction(async tx=>{
    await assertOwnedOnlineLease(tx,owner,[publication.rollback?'ONLINE_ROLLBACK_PUBLISHING':'ONLINE_PUBLISHING']);
    const rows=await tx.$queryRaw<Array<{id:string;phase:string}>>`SELECT id,phase FROM online_releases
      WHERE id IN (${publication.releaseId},${publication.previousReleaseId}) ORDER BY id FOR UPDATE`;
    requireProof(rows.length===2 && rows.some(r=>r.id===publication.previousReleaseId && r.phase==='SERVING')
      && rows.some(r=>r.id===publication.releaseId && r.phase===(publication.rollback?'RETAINED':'READY')),
      'ONLINE_PUBLICATION_PREDECESSOR_CHANGED');
    const current=await tx.$queryRaw<Array<{id:string;releaseId:string;generation:number}>>`SELECT id,"releaseId",generation
      FROM online_serving_epochs WHERE "retiredAt" IS NULL FOR UPDATE`;
    // Initial legacy installation needs its own rehearsed bootstrap; do not
    // fabricate an epoch from a build label or a fresh timestamp here.
    requireProof(current.length===1 && current[0].releaseId===publication.previousReleaseId
      && current[0].generation+1===publication.generation,'ONLINE_PUBLICATION_BOOTSTRAP_OR_HEAD_UNPROVEN');
    const [time]=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
    const until=new Date(time.now.getTime()+86400000);
    await tx.$executeRaw`UPDATE online_serving_epochs SET "retiredAt"=${time.now},"supportUntil"=${until} WHERE id=${current[0].id}`;
    await tx.$executeRaw`UPDATE online_releases SET phase='RETAINED',"retiredAt"=coalesce("retiredAt",${time.now}),
      "browserSupportUntil"=greatest("browserSupportUntil",${until}),"updatedAt"=${time.now} WHERE id=${publication.previousReleaseId}`;
    const ready=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM online_runtime_slots
      WHERE "releaseId"=${publication.releaseId} AND role='serving' AND phase IN ('READY','SERVING')
        AND "stoppedAt" IS NULL FOR UPDATE`;
    requireProof(ready.length>0,'ONLINE_PUBLICATION_READY_HTTP_REQUIRED');
    await tx.$executeRaw`UPDATE online_runtime_slots SET phase='SERVING' WHERE "releaseId"=${publication.releaseId}
      AND role='serving' AND phase='READY' AND "stoppedAt" IS NULL`;
    const epochId=randomUUID();
    await tx.$executeRaw`INSERT INTO online_serving_epochs(id,"releaseId","deploymentId",generation,"publicationSha256","servedAt")
      VALUES (${epochId},${publication.releaseId},${owner.deploymentId},${publication.generation},${publication.publicationSha256},${time.now})`;
    await tx.$executeRaw`UPDATE online_releases SET phase='SERVING',"servedAt"=coalesce("servedAt",${time.now}),"updatedAt"=${time.now}
      WHERE id=${publication.releaseId}`;
    await tx.$executeRaw`UPDATE deployment_operations SET phase='ONLINE_SERVING'
      WHERE id=${owner.deploymentId}`;
    return Object.freeze({epochId,releaseId:publication.releaseId,generation:publication.generation,
      publicationSha256:publication.publicationSha256,retainedUntil:until.toISOString(),databaseRestored:false});
  },{timeout:30000,maxWait:1000});
}

/** A stopped runtime can never be restarted. Current-data rollback enrolls a
 * fresh incarnation against the ORIGINAL immutable accepted image/evidence,
 * while the CURRENT deployment retains its own lease. */
export async function registerRetainedOnlineIncarnations(database:PrismaClient,owner:OnlineRegistrationOwner,
 input:import('./onlineReleaseRegistration').PreparedRegistration){
 const {prepareValidatedOnlineRegistration}=await import('./onlineReleaseRegistration');
 const {readOnlineReleaseEvidence}=await import('./onlineReleaseEvidence');
 const accepted=readOnlineReleaseEvidence(input.evidenceDirectory,input);
 const targetOwner={...owner,releaseId:accepted.manifest.releaseId,deploymentId:accepted.acceptance.deploymentId};
 const prepared=prepareValidatedOnlineRegistration(targetOwner,input);
 requireProof(targetOwner.releaseId!==owner.releaseId,'ONLINE_RETAINED_RELEASE_REQUIRED');
 return database.$transaction(async tx=>{
  await assertOwnedOnlineLease(tx,owner,['ONLINE_ROLLBACK_PUBLISHING','ONLINE_SERVING']);
  const rows=await tx.$queryRaw<Array<{id:string;manifestSha256:string;identityJson:any}>>`SELECT id,"manifestSha256","identityJson"
   FROM online_releases WHERE id=${targetOwner.releaseId} AND phase IN ('SERVING','RETAINED') FOR UPDATE`;
  requireProof(rows.length===1&&rows[0].manifestSha256===input.manifestSha256
   &&rows[0].identityJson?.acceptanceSha256===input.acceptanceSha256,'ONLINE_RETAINED_ACCEPTANCE_CHANGED');
  const [identity]=await tx.$queryRaw<Array<{database:string;system:string;oid:string}>>`SELECT current_database() AS database,
   (SELECT system_identifier::text FROM pg_control_system()) AS system,
   (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`;
  requireProof(identity?.database===accepted.manifest.database.name&&identity.system===accepted.manifest.database.systemIdentifier
   &&identity.oid===accepted.acceptance.qualification.deploymentTargetDatabase.oid,'ONLINE_RETAINED_DATABASE_CHANGED');
  accepted.revalidate();await tx.onlineRuntimeSlot.createMany({data:prepared.slots});
  return {releaseId:targetOwner.releaseId,runtimeIds:prepared.slots.map(slot=>slot.id),phase:'PREPARED'};
 },{timeout:30000,maxWait:1000});
}
