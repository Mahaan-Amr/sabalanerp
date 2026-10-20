/** PRIVATE qualification roster only; never consults/creates accepted slots. */
import type {Prisma} from '@prisma/client';
import {assertOnlineQualifiedRuntime,type OnlineQualifiedRuntime} from './onlineRuntimeComposition';
import {assertOriginalOnlinePrivateQualification} from './onlinePrivateQualificationAuthority';
import {canonicalRealtimeTargets,type RealtimeTarget} from './onlineRealtimeBridgeIdentity';
const fail=():never=>{throw Error('PRIVATE_QUALIFICATION_ORIGINAL_ROSTER_UNPROVEN');};
export async function readPrivateQualificationRoster(tx:Prisma.TransactionClient,runtime:OnlineQualifiedRuntime){
 const owner=assertOnlineQualifiedRuntime(runtime);
 const {artifacts,decision}=assertOriginalOnlinePrivateQualification(owner.qualification);
 owner.boundary.context.assertActive();
 const rows=await tx.$queryRaw<Array<RealtimeTarget&{scopeSha256:string;targetsSha256:string;phase:string}>>`
  SELECT "runtimeId","nonceSha256","releaseId","imageIdentity","scopeSha256","targetsSha256",phase
  FROM private_qualification_runtime_targets WHERE "qualificationId"=${decision.qualificationId} ORDER BY "runtimeId" FOR SHARE`;
 const expected=[...artifacts.targets].sort((a,b)=>a.runtimeId.localeCompare(b.runtimeId));
 if(rows.length!==expected.length||rows.some((row,index)=>{
  const target=expected[index];return row.runtimeId!==target.runtimeId||row.nonceSha256!==target.nonceSha256||row.releaseId!==target.releaseId
   ||row.imageIdentity!==target.imageIdentity||row.scopeSha256!==target.scopeSha256||row.targetsSha256!==artifacts.targetsSha256
   ||!['ACTIVE','DRAINING','CLOSED'].includes(row.phase);
 }))fail();
 return {rows,decision,artifacts};
}
export async function privateQualificationCensus(tx:Prisma.TransactionClient,runtime:OnlineQualifiedRuntime){
 const {rows}=await readPrivateQualificationRoster(tx,runtime);
 return canonicalRealtimeTargets(rows.filter(row=>row.phase==='ACTIVE'));
}
export async function assertPrivateQualificationConsumerPhase(tx:Prisma.TransactionClient,runtime:OnlineQualifiedRuntime,draining=false){
 const {rows,decision}=await readPrivateQualificationRoster(tx,runtime);
 const own=rows.filter(row=>row.runtimeId===decision.runtimeId&&row.nonceSha256===decision.nonceSha256);
 if(own.length!==1||(draining?own[0].phase!=='DRAINING':!['ACTIVE','DRAINING'].includes(own[0].phase)))fail();
}
