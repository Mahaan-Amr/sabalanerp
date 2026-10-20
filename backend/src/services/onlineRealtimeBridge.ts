/** OFFLINE candidate only; actual paired native acceptance is still required. */
import type { PrismaClient, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { assertOnlineComposedRuntime,assertOnlineQualifiedRuntime,type OnlineQualifiedRuntime, type OnlineComposedRuntime } from './onlineRuntimeComposition';
import { loadOnlineRuntimeScope } from './onlineRuntimeScope';
import { executeRealtimeCallback } from './onlineRuntimeWork';
import type { RealtimeNotificationPublisher } from './notificationService';
import { canonicalRealtimeTargets, realtimeBatchId, realtimeCommandId, type RealtimeTarget, type RealtimeSource } from './onlineRealtimeBridgeIdentity';
import {assertOriginalOnlinePrivateQualification} from './onlinePrivateQualificationAuthority';
import {privateQualificationCensus,assertPrivateQualificationConsumerPhase} from './onlineQualificationRoster';
type Runtime=OnlineComposedRuntime|OnlineQualifiedRuntime;
type Family='accepted'|'qualification';
type Batch = RealtimeSource & { id: string; producerRuntimeId: string; producerNonceSha256: string;
  targetsSha256: string; targetsJson: RealtimeTarget[] };
type Command = RealtimeTarget & RealtimeSource & { id: string; batchId: string; status: string; claimToken: string | null };
const fail = (code: string, realtimeOutcomeUnknown = false) => Object.assign(Error(code), { code, realtimeOutcomeUnknown });
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 100));
const producers = new WeakSet<Runtime>(), consumers = new WeakSet<Runtime>();
declare const producerBrand: unique symbol;
export type OnlineRealtimeProducer = Readonly<{ [producerBrand]: true; publishNotification: RealtimeNotificationPublisher; stopAndDrain():Promise<void> }>;
declare const qualificationProducerBrand:unique symbol;
export type OnlineQualificationRealtimeProducer=Readonly<{[qualificationProducerBrand]:true;publishNotification:RealtimeNotificationPublisher;stopAndDrain():Promise<void>}>;
type Producer=OnlineRealtimeProducer|OnlineQualificationRealtimeProducer;
const producerOwners=new WeakMap<object,{runtime:Runtime;family:Family;publish(source:RealtimeSource):Promise<void>}>();
function producerOwner(runtime:Runtime,producer:Producer,family:Family){
 const owner=producerOwners.get(producer);if(!owner||owner.runtime!==runtime||owner.family!==family)throw fail('REALTIME_ORIGINAL_PRODUCER_REQUIRED');
 scope(runtime,'jobs',family);return owner;
}
export function assertOnlineRealtimeProducer(runtime:OnlineComposedRuntime,producer:OnlineRealtimeProducer){producerOwner(runtime,producer,'accepted');}
export function assertOnlineQualificationRealtimeProducer(runtime:OnlineQualifiedRuntime,producer:OnlineQualificationRealtimeProducer){producerOwner(runtime,producer,'qualification');}
export async function publishOnlineHrInvalidation(runtime:OnlineComposedRuntime,producer:OnlineRealtimeProducer,sourceId:string){
 const owner=producerOwner(runtime,producer,'accepted');scope(runtime,'jobs','accepted').owner.boundary.context.assertActive();
 await owner.publish({kind:'HR_PERSONNEL_INVALIDATION',sourceId,notificationId:null,userId:null});
}
export async function publishOnlineQualificationHrInvalidation(runtime:OnlineQualifiedRuntime,producer:OnlineQualificationRealtimeProducer,sourceId:string){
 const owner=producerOwner(runtime,producer,'qualification');scope(runtime,'jobs','qualification').owner.boundary.context.assertActive();
 await owner.publish({kind:'HR_PERSONNEL_INVALIDATION',sourceId,notificationId:null,userId:null});
}
function scope(runtime:Runtime,purpose:'http'|'jobs',family:Family){
 const owner=family==='accepted'?assertOnlineComposedRuntime(runtime as OnlineComposedRuntime,purpose):assertOnlineQualifiedRuntime(runtime as OnlineQualifiedRuntime,purpose);
 const input=loadOnlineRuntimeScope();if(!input||input.scope.purpose!==purpose)throw fail('REALTIME_NATIVE_SCOPE_REQUIRED');
 const qualificationId=family==='qualification'?assertOriginalOnlinePrivateQualification((owner as ReturnType<typeof assertOnlineQualifiedRuntime>).qualification).decision.qualificationId:undefined;
 return {owner,input,qualificationId,nonce:createHash('sha256').update(input.scope.nonce).digest('hex')};
}
async function actualClient(runtime:Runtime,database:PrismaClient,purpose:'http'|'jobs',family:Family) {
  scope(runtime,purpose,family); const { prisma } = await import('../lib/prisma');
  if (database !== prisma) throw fail('REALTIME_CANONICAL_DATABASE_REQUIRED');
}
function targetsOf(batch: Batch, source: RealtimeSource,expectedId=realtimeBatchId(source)) {
  const canonical = canonicalRealtimeTargets(batch.targetsJson);
  if (batch.id !== expectedId || batch.kind !== source.kind || batch.sourceId !== source.sourceId
    || batch.notificationId !== source.notificationId || batch.userId !== source.userId
    || canonical.sha256 !== batch.targetsSha256) throw fail('REALTIME_DURABLE_TARGET_CENSUS_CHANGED',true);
  return canonical.targets;
}
const batchLock = (tx: Prisma.TransactionClient, id: string) =>
  tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('online-realtime-v2'),hashtext(${id}))`;

export function createOnlineRealtimeProducer(runtime:OnlineComposedRuntime,database:PrismaClient){return createProducer(runtime,database,'accepted') as Promise<OnlineRealtimeProducer>;}
export function createOnlineQualificationRealtimeProducer(runtime:OnlineQualifiedRuntime,database:PrismaClient){return createProducer(runtime,database,'qualification') as Promise<OnlineQualificationRealtimeProducer>;}
async function createProducer(runtime:Runtime,database:PrismaClient,family:Family){
  await actualClient(runtime,database,'jobs',family);
  if (producers.has(runtime)) throw fail('REALTIME_ORIGINAL_PRODUCER_ALREADY_BOUND');
  producers.add(runtime); const original = scope(runtime,'jobs',family);
  let stopping=false;const publications=new Set<Promise<void>>(),unresolvedBatches=new Set<string>();
  async function publishOwned(source: RealtimeSource) {
    const { owner, input, nonce } = scope(runtime,'jobs',family); owner.boundary.context.assertActive();
    if (input !== original.input) throw fail('REALTIME_ORIGINAL_JOBS_OWNER_CHANGED',true);
    const id = original.qualificationId?createHash('sha256').update(JSON.stringify(['sabalan-private-qualification-batch/v1',original.qualificationId,realtimeBatchId(source)])).digest('hex'):realtimeBatchId(source);unresolvedBatches.add(id);
    let batch: Batch;
    try {
      batch = await database.$transaction(async (tx: Prisma.TransactionClient) => {
        await batchLock(tx,id);
        if (source.kind === 'NOTIFICATION') {
          const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT o.id FROM notification_outbox o
            JOIN security_notifications n ON n."eventId"=o."eventId" WHERE o.id=${source.sourceId}
              AND n.id=${source.notificationId} AND n."userId"=${source.userId} AND o.status='PROCESSING' FOR SHARE OF o,n`;
          if (rows.length !== 1) throw fail('REALTIME_ORIGINAL_OUTBOX_REQUIRED');
        } else {
          const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM online_hr_invalidation_intents
            WHERE id=${source.sourceId} AND event='hr.personnel.changed' AND "sourceOutcome"='READY' AND "deliveryStatus"='PENDING' FOR SHARE`;
          if (rows.length !== 1) throw fail('REALTIME_COMMITTED_HR_SOURCE_REQUIRED');
        }
        const existing = await tx.$queryRaw<Batch[]>`SELECT * FROM online_realtime_batches WHERE id=${id} FOR SHARE`;
        if (existing.length === 1) { targetsOf(existing[0],source,id); return existing[0]; }
        const census = family==='qualification'?await privateQualificationCensus(tx,runtime as OnlineQualifiedRuntime):canonicalRealtimeTargets(await tx.$queryRaw<RealtimeTarget[]>`WITH moment AS MATERIALIZED
          (SELECT clock_timestamp() AS now) SELECT s.id AS "runtimeId",s."nonceSha256",s."releaseId",s."imageIdentity"
          FROM online_runtime_slots s JOIN online_releases r ON r.id=s."releaseId" CROSS JOIN moment m
          WHERE s.component='backend' AND s.role='serving' AND s.phase='SERVING' AND s."stoppedAt" IS NULL
            AND ((r.phase='SERVING' AND ((r."retiredAt" IS NULL AND r."browserSupportUntil" IS NULL)
              OR EXISTS (SELECT 1 FROM online_serving_epochs e WHERE e."releaseId"=r.id AND e."retiredAt" IS NULL)))
              OR (r.phase='RETAINED' AND r."retiredAt"<=m.now AND r."browserSupportUntil">m.now
                AND r."browserSupportUntil">=r."retiredAt"+interval '24 hours'))
          ORDER BY s.id LIMIT 1025 FOR SHARE OF s,r`);
        const proposed: Batch = { ...source, id, producerRuntimeId: input.scope.runtimeId, producerNonceSha256: nonce,
          targetsSha256: census.sha256, targetsJson: [...census.targets] };
        await tx.$executeRaw`INSERT INTO online_realtime_batches(id,kind,"sourceId","notificationId","userId",
          "producerRuntimeId","producerNonceSha256","targetsSha256","targetsJson") VALUES
          (${id},${source.kind},${source.sourceId},${source.notificationId},${source.userId},${input.scope.runtimeId},
           ${nonce},${census.sha256},${JSON.stringify(census.targets)}::jsonb)`;
        const commands = census.targets.map(target => ({ ...target, id: realtimeCommandId(id,target), batchId: id }));
        await tx.$executeRaw`INSERT INTO online_realtime_commands(id,"batchId","runtimeId","nonceSha256","releaseId","imageIdentity")
          SELECT id,"batchId","runtimeId","nonceSha256","releaseId","imageIdentity" FROM jsonb_to_recordset(${JSON.stringify(commands)}::jsonb)
          AS x(id text,"batchId" text,"runtimeId" text,"nonceSha256" text,"releaseId" text,"imageIdentity" text)`;
        return proposed;
      }, { timeout: 30_000, maxWait: 1000 });
    } catch (error) {
      // SAME logical lock proves the original transaction ended before outcome
      // resolution. Absence from an unrelated unlocked read is not rollback.
      let resolved: Batch[] | undefined;
      while (!resolved) {
        original.owner.boundary.context.assertActive();
        try { resolved = await database.$transaction(async (tx: Prisma.TransactionClient) => {
          await batchLock(tx,id);
          return tx.$queryRaw<Batch[]>`SELECT * FROM online_realtime_batches WHERE id=${id} FOR SHARE`;
        }, { timeout:30_000,maxWait:1000 }); } catch { await pause(); }
      }
      if (resolved.length !== 1) {unresolvedBatches.delete(id);throw error;}
      batch = resolved[0]; targetsOf(batch,source,id);
    }
    const expected = new Set(targetsOf(batch,source,id).map(target => realtimeCommandId(id,target)));
    for (;;) {
      original.owner.boundary.context.assertActive();
      let commands: Array<{ id:string;status:string }>;
      try { commands = await database.$queryRaw<Array<{ id:string;status:string }>>`SELECT id,status FROM online_realtime_commands WHERE "batchId"=${id}`; }
      catch { await pause(); continue; }
      if (commands.length !== expected.size || commands.some(command=>!expected.has(command.id))) throw fail('REALTIME_COMMAND_SET_CHANGED',true);
      if (commands.every(command=>command.status==='SETTLED')) {unresolvedBatches.delete(id);return;}
      if (batch.producerRuntimeId!==input.scope.runtimeId || batch.producerNonceSha256!==nonce) throw fail('REALTIME_PRIOR_JOBS_OUTCOME_NOT_SETTLED',true);
      if (commands.every(command=>command.status==='SETTLED'||command.status==='UNKNOWN')) throw fail('REALTIME_TARGET_OUTCOME_UNKNOWN',true);
      // No 30s return/5min lease recovery while any original target is pending.
      await pause();
    }
  }
  async function track(work:()=>Promise<void>){
    scope(runtime,'jobs',family).owner.boundary.context.assertActive();
    if(stopping)throw fail('REALTIME_PRODUCER_STOPPING');
    const task=work();publications.add(task);
    try{await task;}finally{publications.delete(task);}
  }
  const publish=(source:RealtimeSource)=>track(()=>publishOwned(source));
  const publishNotification: RealtimeNotificationPublisher = (userId,notification) => track(async()=>{
    const rows = await database.$queryRaw<Array<{id:string}>>`SELECT o.id FROM notification_outbox o
      JOIN security_notifications n ON n."eventId"=o."eventId" WHERE n.id=${notification.id}
        AND n."eventId"=${notification.eventId} AND n."userId"=${userId} AND o.status='PROCESSING'`;
    if(rows.length!==1) throw fail('REALTIME_ORIGINAL_OUTBOX_REQUIRED');
    await publishOwned({kind:'NOTIFICATION',sourceId:rows[0].id,notificationId:notification.id,userId});
  });
  const producer=Object.freeze({publishNotification,async stopAndDrain(){scope(runtime,'jobs',family);stopping=true;
    await Promise.allSettled([...publications]);
    if(unresolvedBatches.size)throw fail('REALTIME_ORIGINAL_PRODUCER_OUTCOMES_UNRESOLVED',true);
  }});
  producerOwners.set(producer,{runtime,family,publish});return producer;
}

export function createOnlineRealtimeConsumer(runtime:OnlineComposedRuntime,application:unknown){return createConsumer(runtime,application,'accepted');}
export function createOnlineQualificationRealtimeConsumer(runtime:OnlineQualifiedRuntime,application:unknown){return createConsumer(runtime,application,'qualification');}
async function createConsumer(runtime:Runtime,application:unknown,family:Family){
  // Jobs producer never imports the complete HTTP route graph. Only the actual
  // HTTP consumer resolves the canonical constructor-owned WeakMap.
  const canonical=await import('../application');
  const assertApplication=(value:unknown)=>family==='accepted'?canonical.assertOnlineApplicationRealtimeOwner(value,runtime as OnlineComposedRuntime):canonical.assertPrivateQualificationApplicationRealtimeOwner(value,runtime as OnlineQualifiedRuntime);
  const actual=assertApplication(application), {database,lifecycle}=actual;
  await actualClient(runtime,database,'http',family);
  if(consumers.has(runtime))throw fail('REALTIME_ORIGINAL_CONSUMER_ALREADY_BOUND');
  consumers.add(runtime);const original=scope(runtime,'http',family);let stopping=false,draining=false,active:Promise<boolean>|undefined,stopPromise:Promise<void>|undefined;
  const unresolved=new Set<string>();
  const assertOwner=()=>{
    original.owner.boundary.context.assertActive();
    if(loadOnlineRuntimeScope()!==original.input)throw fail('REALTIME_ORIGINAL_HTTP_OWNER_LOST',true);
    return original;
  };
  async function execute(){return executeRealtimeCallback(async()=>{
    const {input,nonce}=assertOwner(),token=randomBytes(32).toString('hex');
    // An uncertain claim COMMIT keeps a local unknown marker even before the
    // returned row is available. stop cannot falsely declare this owner clear.
    unresolved.add(token);
    const command=await database.$transaction(async(tx:Prisma.TransactionClient)=>{
      const rows=await tx.$queryRaw<Command[]>`SELECT c.*,b.kind,b."sourceId",b."notificationId",b."userId"
        FROM online_realtime_commands c JOIN online_realtime_batches b ON b.id=c."batchId"
        WHERE c.status='PENDING' AND c."runtimeId"=${input.scope.runtimeId} AND c."nonceSha256"=${nonce}
          AND c."releaseId"=${input.scope.releaseId} AND c."imageIdentity"=${input.scope.image}
        ORDER BY c."createdAt",c.id LIMIT 1 FOR UPDATE OF c SKIP LOCKED`;
      if(!rows.length)return null;const command=rows[0];
      const batches=await tx.$queryRaw<Batch[]>`SELECT * FROM online_realtime_batches WHERE id=${command.batchId} FOR SHARE`;
      if(batches.length!==1)throw fail('REALTIME_BATCH_MISSING',true);
      const expectedBatchId=original.qualificationId?createHash('sha256').update(JSON.stringify(['sabalan-private-qualification-batch/v1',original.qualificationId,realtimeBatchId(command)])).digest('hex'):realtimeBatchId(command);
      const target=targetsOf(batches[0],command,expectedBatchId).find(value=>value.runtimeId===input.scope.runtimeId&&value.nonceSha256===nonce);
      if(!target||realtimeCommandId(command.batchId,target)!==command.id||target.imageIdentity!==input.scope.image
        ||target.releaseId!==input.scope.releaseId)throw fail('REALTIME_COMMAND_IDENTITY_UNPROVEN',true);
      await tx.$executeRaw`UPDATE online_realtime_commands SET status='RUNNING',"startedAt"=clock_timestamp(),"claimToken"=${token}
        WHERE id=${command.id} AND status='PENDING'`;return command;
    },{timeout:30_000,maxWait:1000});
    if(!command){unresolved.delete(token);return false;}
    let callbackError:unknown;
    try{
      assertOwner();if(family==='qualification'){await database.$transaction(tx=>assertPrivateQualificationConsumerPhase(tx,runtime as OnlineQualifiedRuntime));}
      else {const eligible=await database.$queryRaw<Array<{id:string}>>`SELECT s.id FROM online_runtime_slots s JOIN online_releases r ON r.id=s."releaseId"
        WHERE s.id=${input.scope.runtimeId} AND s."nonceSha256"=${nonce} AND s."releaseId"=${input.scope.releaseId}
          AND s."imageIdentity"=${input.scope.image} AND s.component='backend' AND s.role='serving'
          AND s.phase IN ('SERVING','DRAINING') AND s."stoppedAt" IS NULL AND r.phase IN ('SERVING','RETAINED')`;
      if(eligible.length!==1)throw fail('REALTIME_TARGET_NO_LONGER_ELIGIBLE',true);}
      if(command.kind==='NOTIFICATION')await lifecycle.notify(command.userId!,command.notificationId!);
      else if(command.kind==='HR_PERSONNEL_INVALIDATION')await lifecycle.invalidate('hr.personnel.changed');
      else throw fail('REALTIME_COMMAND_KIND_REFUSED',true);
    }catch(error){callbackError=error;}
    const desired=callbackError?'UNKNOWN':'SETTLED';
    try{await database.$executeRaw`UPDATE online_realtime_commands SET status=${desired},
      "settledAt"=CASE WHEN ${desired}='SETTLED' THEN clock_timestamp() ELSE NULL END
      WHERE id=${command.id} AND status='RUNNING' AND "claimToken"=${token}`;}catch{/* Resolve exact completion below; never re-emit. */}
    assertOwner();const final=await database.$queryRaw<Array<{status:string;claimToken:string}>>`SELECT status,"claimToken" FROM online_realtime_commands WHERE id=${command.id}`;
    if(final.length!==1||final[0].claimToken!==token||final[0].status!==desired)throw fail('REALTIME_COMPLETION_OUTCOME_UNKNOWN',true);
    if(desired==='UNKNOWN')throw fail('REALTIME_TARGET_CALLBACK_FAILED',true);
    unresolved.delete(token);return true;
  });}
  async function drainOwned(){
    // The original protected controller commits DRAINING under the SAME row
    // lock as the producer census before calling this. Its UPDATE waits for
    // earlier FOR SHARE censuses; all subsequent censuses exclude this slot.
    draining=true;if(active)await active;
    for(;;){
      const pending=await executeRealtimeCallback(async()=>{
        const {input,nonce}=assertOwner();
        if(family==='qualification'){await database.$transaction(tx=>assertPrivateQualificationConsumerPhase(tx,runtime as OnlineQualifiedRuntime,true));}
        else {const rows=await database.$queryRaw<Array<{id:string}>>`SELECT s.id FROM online_runtime_slots s
          WHERE s.id=${input.scope.runtimeId} AND s."nonceSha256"=${nonce} AND s."releaseId"=${input.scope.releaseId}
            AND s."imageIdentity"=${input.scope.image} AND s.phase='DRAINING' AND s."stoppedAt" IS NULL`;
        if(rows.length!==1)throw fail('REALTIME_ORIGINAL_DRAINING_FENCE_REQUIRED',true);}
        const [commands]=await database.$queryRaw<Array<{pending:boolean;unknown:boolean}>>`SELECT
          EXISTS(SELECT 1 FROM online_realtime_commands WHERE "runtimeId"=${input.scope.runtimeId}
            AND "nonceSha256"=${nonce} AND status='PENDING') AS pending,
          EXISTS(SELECT 1 FROM online_realtime_commands WHERE "runtimeId"=${input.scope.runtimeId}
            AND "nonceSha256"=${nonce} AND status IN ('RUNNING','UNKNOWN')) AS unknown`;
        if(!commands||unresolved.size||commands.unknown)throw fail('REALTIME_ORIGINAL_OUTCOMES_UNRESOLVED',true);
        return commands.pending;
      });
      if(!pending)break;
      active=execute().finally(()=>{active=undefined;});await active;
    }
    stopping=true;
  }
  return Object.freeze({drainOnce(){scope(runtime,'http',family);
    if(assertApplication(application)!==actual||stopping||draining||active)throw fail('REALTIME_CONSUMER_NOT_AVAILABLE');
    active=execute().finally(()=>{active=undefined;});return active;},
    drainAndStop(){return stopPromise??=drainOwned();}
  });
}
