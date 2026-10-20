/** OFFLINE typed source for the existing successful-HR-response invalidation. */
import type { RequestHandler } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { runtimeHttpRequests } from './httpRequestLifecycle';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';
import { assertOnlineComposedRuntime,assertOnlineQualifiedRuntime,type OnlineQualifiedRuntime, type OnlineComposedRuntime } from './onlineRuntimeComposition';
import type { OnlineQualificationRealtimeProducer,OnlineRealtimeProducer } from './onlineRealtimeBridge';
type Runtime=OnlineComposedRuntime|OnlineQualifiedRuntime;
type Family='accepted'|'qualification';
let owner: {family:Family;runtime:Runtime;database:PrismaClient;unresolved:Set<string>}|undefined;
const assertRuntime=(runtime:Runtime,purpose:'http'|'jobs',family:Family)=>family==='accepted'?assertOnlineComposedRuntime(runtime as OnlineComposedRuntime,purpose):assertOnlineQualifiedRuntime(runtime as OnlineQualifiedRuntime,purpose);
const pause=()=>new Promise<void>(resolve=>setTimeout(resolve,100));
const lock=(tx:Prisma.TransactionClient,id:string)=>tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('online-hr-invalidation-v1'),hashtext(${id}))`;

export function configureOnlineHrInvalidation(runtime:OnlineComposedRuntime,database:PrismaClient) {
  return configure(runtime,database,'accepted');
}
export function configurePrivateQualificationHrInvalidation(runtime:OnlineQualifiedRuntime,database:PrismaClient){return configure(runtime,database,'qualification');}
function configure(runtime:Runtime,database:PrismaClient,family:Family){
  assertRuntime(runtime,'http',family);runtimeHttpRequests.assertBeforeFirstRequest();
  if(database!==prisma||owner)throw Error('HR_INVALIDATION_ORIGINAL_OWNER_REQUIRED');
  owner={family,runtime,database,unresolved:new Set()};
}
export function assertOnlineHrInvalidationClosed(){if(owner?.unresolved.size)throw Error('HR_INVALIDATION_SOURCE_OUTCOMES_UNRESOLVED');}
export function hasOnlineHrInvalidationOwner(){return !!owner;}

/** Install only for the SAME mutation paths the old res.finish publisher used.
 * Ordinary unconfigured mode is handled by the unchanged legacy middleware.
 * This typed callback keeps that finish-trigger meaning: it does not pretend
 * to be a transactionally coupled audit of every downstream HR business write. */
export const prepareOnlineHrPersonnelInvalidation:RequestHandler=async(req,res,next)=>{
  const input=loadOnlineRuntimeScope();
  if(!owner||!input||input.scope.purpose!=='http')return next(Error('HR_INVALIDATION_ORIGINAL_OWNER_REQUIRED'));
  const current=owner,runtime=assertRuntime(current.runtime,'http',current.family);runtime.boundary.context.assertActive();
  const id=randomBytes(32).toString('hex'),nonce=createHash('sha256').update(input.scope.nonce).digest('hex');
  const reservation=runtimeHttpRequests.reserveWrite(req);current.unresolved.add(id);
  let prepared=false,consumed=false,desired:'READY'|'CANCELLED'|'UNKNOWN'|undefined;
  const sourceIdentity=(row:{originRuntimeId:string;originNonceSha256:string})=>{
    if(row.originRuntimeId!==input.scope.runtimeId||row.originNonceSha256!==nonce)throw Error('HR_INVALIDATION_SOURCE_OWNER_CHANGED');
  };
  const startSettlement=()=>{
    if(!prepared||!desired||consumed)return;consumed=true;const outcome=desired;
    void reservation.run(async()=>{
      for(;;){
        runtime.boundary.context.assertActive();
        try{
          await current.database.$transaction(async(tx:Prisma.TransactionClient)=>{
            await lock(tx,id);
            const rows=await tx.$queryRaw<Array<{sourceOutcome:string;originRuntimeId:string;originNonceSha256:string}>>`
              SELECT "sourceOutcome","originRuntimeId","originNonceSha256" FROM online_hr_invalidation_intents WHERE id=${id} FOR UPDATE`;
            if(rows.length!==1)throw Error('HR_INVALIDATION_SOURCE_MISSING');sourceIdentity(rows[0]);
            if(rows[0].sourceOutcome==='PREPARED')await tx.$executeRaw`UPDATE online_hr_invalidation_intents
              SET "sourceOutcome"=${outcome},"sourceSettledAt"=clock_timestamp() WHERE id=${id} AND "sourceOutcome"='PREPARED'`;
            else if(rows[0].sourceOutcome!==outcome)throw Error('HR_INVALIDATION_SOURCE_OUTCOME_CHANGED');
          },{timeout:30_000,maxWait:1000});
          current.unresolved.delete(id);return;
        }catch{
          // Retry only the original idempotent SQL transition under the SAME
          // source lock. No notification/callback is repeated by this loop.
          await pause();
        }
      }
    }).catch(()=>{console.error('HR_INVALIDATION_SOURCE_OUTCOME_UNKNOWN');});
  };
  res.once('finish',()=>{desired=res.statusCode>=200&&res.statusCode<300?'READY':'CANCELLED';startSettlement();});
  res.once('close',()=>{if(!res.writableFinished){desired='UNKNOWN';startSettlement();}});
  try{
    let known=false;
    while(!known){
      runtime.boundary.context.assertActive();
      try{
        await current.database.$transaction(async(tx:Prisma.TransactionClient)=>{
          await lock(tx,id);
          const rows=await tx.$queryRaw<Array<{originRuntimeId:string;originNonceSha256:string}>>`
            SELECT "originRuntimeId","originNonceSha256" FROM online_hr_invalidation_intents WHERE id=${id} FOR SHARE`;
          if(rows.length){if(rows.length!==1)throw Error('HR_INVALIDATION_SOURCE_DUPLICATE');sourceIdentity(rows[0]);return;}
          await tx.$executeRaw`INSERT INTO online_hr_invalidation_intents(id,event,"originRuntimeId","originNonceSha256")
            VALUES(${id},'hr.personnel.changed',${input.scope.runtimeId},${nonce})`;
        },{timeout:30_000,maxWait:1000});known=true;
      }catch{await pause();}
    }
    prepared=true;startSettlement();next();
  }catch(error){
    // No invented CANCELLED/READY result after a lost native owner. Its
    // unresolved source reservation and shutdown refusal remain explicit.
    next(error);
  }
};

export function deliverPendingOnlineHrInvalidation(runtime:OnlineComposedRuntime,database:PrismaClient,producer:OnlineRealtimeProducer){return deliver(runtime,database,producer,'accepted');}
export function deliverPendingPrivateQualificationHrInvalidation(runtime:OnlineQualifiedRuntime,database:PrismaClient,producer:OnlineQualificationRealtimeProducer){return deliver(runtime,database,producer,'qualification');}
async function deliver(runtime:Runtime,database:PrismaClient,producer:OnlineRealtimeProducer|OnlineQualificationRealtimeProducer,family:Family){
  assertRuntime(runtime,'jobs',family).boundary.context.assertActive();
  const bridge=await import('./onlineRealtimeBridge');
  const publish=family==='accepted'
   ? (sourceId:string)=>bridge.publishOnlineHrInvalidation(runtime as OnlineComposedRuntime,producer as OnlineRealtimeProducer,sourceId)
   : (sourceId:string)=>bridge.publishOnlineQualificationHrInvalidation(runtime as OnlineQualifiedRuntime,producer as OnlineQualificationRealtimeProducer,sourceId);
  if(family==='accepted')bridge.assertOnlineRealtimeProducer(runtime as OnlineComposedRuntime,producer as OnlineRealtimeProducer);
  else bridge.assertOnlineQualificationRealtimeProducer(runtime as OnlineQualifiedRuntime,producer as OnlineQualificationRealtimeProducer);
  const {prisma}=await import('../lib/prisma');if(database!==prisma)throw Error('HR_INVALIDATION_CANONICAL_DATABASE_REQUIRED');
  const rows=await database.$queryRaw<Array<{id:string}>>`SELECT id FROM online_hr_invalidation_intents
    WHERE "sourceOutcome"='READY' AND "deliveryStatus"='PENDING' ORDER BY "createdAt",id LIMIT 1`;
  if(!rows.length)return false;const id=rows[0].id;
  try{
    await publish(id);
    await database.$executeRaw`UPDATE online_hr_invalidation_intents SET "deliveryStatus"='SETTLED',"deliverySettledAt"=clock_timestamp()
      WHERE id=${id} AND "sourceOutcome"='READY' AND "deliveryStatus"='PENDING'`;return true;
  }catch(error){
    if(error&&typeof error==='object'&&'realtimeOutcomeUnknown'in error&&error.realtimeOutcomeUnknown===true)
      await database.$executeRaw`UPDATE online_hr_invalidation_intents SET "deliveryStatus"='UNKNOWN'
        WHERE id=${id} AND "sourceOutcome"='READY' AND "deliveryStatus"='PENDING'`;
    throw error;
  }
}
