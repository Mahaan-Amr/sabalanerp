/** Private rollback source A and its SAME active native restore B. This is
 * neither a B backup nor a healthy independent point or production grant. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {assertActiveStrictRestoreProof,withSystemRecoveryDatabaseClient} from './systemRecoveryEngine';
import {assertRecoveryBusinessProof} from './deploymentRecoveryDataProof';
import {assertRestoredQaWorkingMaterial,restoredQaMaterialPath,type RestoredQaWorkingMaterial} from './restoredQaWorkingMaterial';
import {assertRestoredQaHistoricalAnchor,type RestoredQaHistoricalAnchor} from './protectedRestoredQaHrAnchor';
import type {RestoredQaAdoptionCompletion} from './restoredQaFileAdoptionAuthority';

type Owner=Readonly<{deploymentId:string;releaseId:string;leaseToken:string}>;
declare const brand:unique symbol;
export type RestoredQaMigrationBaseline=Readonly<{[brand]:true}>;
const intended=(owner:Readonly<{deploymentId:string;releaseId:string}>)=>({deploymentId:owner.deploymentId,releaseId:owner.releaseId});
const digest=(raw:string|Buffer)=>createHash('sha256').update(raw).digest('hex');
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.uid,s.mode,s.nlink,s.size,s.mtimeNs,s.ctimeNs].join(':');
type Context=ReturnType<typeof assertActiveStrictRestoreProof>;
type MigrationRun=Awaited<ReturnType<typeof import('../scripts/deployment-owned-migrations').runRestoredQaDeploymentOwnedMigrations>>;
function immutableSnapshot<T>(value:T):T{
 const copy=JSON.parse(JSON.stringify(value))as T;let nodes=0;
 function freeze(v:unknown,depth:number){assert.ok(++nodes<=25000&&depth<=64);if(v&&typeof v==='object'){for(const item of Object.values(v))freeze(item,depth+1);Object.freeze(v);}}
 freeze(copy,0);return copy;
}
type State={active:boolean;initializing:boolean;privateClosed:boolean;proof:unknown;material:RestoredQaWorkingMaterial;anchor:RestoredQaHistoricalAnchor;
 owner:Owner;context:Context;boundary:()=>void;descriptor:RestoredQaMigrationBaselineDescriptor;migrationEvidence?:Readonly<Pick<MigrationRun,'run'|'historyRaw'|'native'>>};
export type RestoredQaMigrationBaselineDescriptor=Readonly<{
 format:'sabalan-verified-complete-source-and-native-restore-b/v1';deploymentId:string;releaseId:string;
 checksum:string;sourceDatabase:Context['proof']['database'];targetDatabase:Context['proof']['database'];
 sourceCheckpoint:ReturnType<typeof assertRestoredQaHistoricalAnchor>['decision']['sourceCheckpoint'];
 independentRestoreClaimed:false;cleanupPending:true;productionAdmission:false;
}>;
const states=new WeakMap<RestoredQaMigrationBaseline,State>();
function stateFor(baseline:RestoredQaMigrationBaseline,owner:Owner){
 const s=states.get(baseline);assert.ok(s?.active&&!s.privateClosed,'RESTORED_QA_BASELINE_NOT_ACTIVE');assert.deepEqual(s.owner,owner);
 assert.equal(assertActiveStrictRestoreProof(s.proof),s.context);const material=assertRestoredQaWorkingMaterial(s.material,owner);
 assert.deepEqual(material.database,s.context.proof.database);const accepted=assertRestoredQaHistoricalAnchor(s.anchor,intended(owner));
 assert.equal(accepted.context,s.context);assert.deepEqual(accepted.decision.targetDatabase,material.database);
 assert.notDeepEqual(accepted.decision.sourceDatabase,material.database);s.boundary();return s;
}
export function assertRestoredQaMigrationBaseline(baseline:RestoredQaMigrationBaseline,owner:Owner){return stateFor(baseline,owner).descriptor;}

/** No point booleans supplied by a caller are used. The genuine QA row owns a
 * real protected lease, while the distinct typed baseline remains in-process. */
export async function assertRestoredQaMigrationLease(tx:Prisma.TransactionClient,baseline:RestoredQaMigrationBaseline,owner:Owner){
 const s=stateFor(baseline,owner);
 const rows=await tx.$queryRaw<Array<{id:string;checkpoint:unknown}>>`SELECT id,"checkpointJson" AS checkpoint FROM deployment_operations
  WHERE id=${owner.deploymentId} AND "releaseId"=${owner.releaseId} AND "leaseToken"=${owner.leaseToken}
  AND "activeKey"='production' AND phase=${s.initializing?'LEASE_ACQUIRED':'MUTATION_STARTED'} AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR SHARE`;
 assert.equal(rows.length,1,'RESTORED_QA_PROTECTED_LEASE_UNPROVEN');assert.equal(rows[0].checkpoint,null,'RESTORED_QA_GENERIC_CHECKPOINT_FORBIDDEN');
 const identities=await tx.$queryRaw<Array<{name:string;oid:string;systemIdentifier:string}>>`SELECT current_database() AS name,
  (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`;
 assert.deepEqual(identities,[s.context.proof.database]);stateFor(baseline,owner);return s.descriptor;
}
function verifyFile(file:string,expected:{size:number;sha256:string}){
 assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&!(before.mode&0o022n));assert.equal(before.size,BigInt(expected.size));
  const hash=createHash('sha256'),buffer=Buffer.alloc(512*1024);let count=0;
  for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;count+=n;assert.ok(count<=expected.size);hash.update(buffer.subarray(0,n));}
  assert.equal(count,expected.size);assert.equal(hash.digest('hex'),expected.sha256);assert.equal(pin(before),pin(fs.fstatSync(fd,{bigint:true})));assert.equal(pin(before),pin(fs.lstatSync(file,{bigint:true})));
 }finally{fs.closeSync(fd);}
}
function verifyWorkingFiles(context:Context,view:ReturnType<typeof assertRestoredQaWorkingMaterial>){
 for(const component of context.manifest.components){
  if(!component.path.startsWith('files/')&&!component.path.startsWith('inquiry/'))continue;
  verifyFile(path.join(view.root,restoredQaMaterialPath(component.path)),component);
 }
}
/** Source-owned setup for the private B operation. A captured source lease is
 * neither adopted nor deleted: only the canonical expired-lease replacement
 * runs, after this actual restored database's complete recovery preflight. */
export async function withRestoredQaPrivateOperation<T>(proof:unknown,material:RestoredQaWorkingMaterial,
 anchor:RestoredQaHistoricalAnchor,intendedOwner:Readonly<{deploymentId:string;releaseId:string}>,targetCommit:string,
 work:(baseline:RestoredQaMigrationBaseline,owner:Owner)=>Promise<T>){
 assert.match(targetCommit,/^[a-f0-9]{40}$/);
 const context=assertActiveStrictRestoreProof(proof),view=assertRestoredQaWorkingMaterial(material,intendedOwner),accepted=assertRestoredQaHistoricalAnchor(anchor,intendedOwner);
 assert.equal(accepted.context,context);assert.deepEqual(accepted.decision.targetDatabase,view.database);assert.deepEqual(view.database,context.proof.database);assert.notDeepEqual(accepted.decision.sourceDatabase,view.database);
 const marker=path.join(view.roots['recovery-coordination'],'deployment-maintenance.json');assert.equal(fs.existsSync(marker),false,'RESTORED_QA_PRIVATE_MARKER_ALREADY_PRESENT');verifyWorkingFiles(context,view);
 const owner=Object.freeze({...intendedOwner,leaseToken:randomBytes(32).toString('hex')});
 const {acquireDeploymentLease,PrismaDeploymentStore}=await import('./deploymentControl');
 await withSystemRecoveryDatabaseClient(view.database.name,async db=>{
  await db.$transaction(async tx=>{
   const identities=await tx.$queryRaw<Array<{name:string;oid:string;systemIdentifier:string}>>`SELECT current_database() AS name,
    (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`;assert.deepEqual(identities,[view.database]);
   const rows=await tx.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(h ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations h`;
   assert.equal(rows.length,1);assert.equal(digest(rows[0].value),context.proof.rawHistorySha256);assert.equal(rows[0].value,context.proof.rawHistoryJson);
   await assertRecoveryBusinessProof(tx,context.businessDataProof);verifyWorkingFiles(context,view);
   const [quiet]=await tx.$queryRaw<Array<{foreignSessions:number;prepared:number}>>`SELECT
    (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend') AS "foreignSessions",
    (SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared`;assert.deepEqual(quiet,{foreignSessions:0,prepared:0});
  },{maxWait:1000,timeout:15000});
  assert.equal(assertActiveStrictRestoreProof(proof),context);assertRestoredQaWorkingMaterial(material,intendedOwner);assertRestoredQaHistoricalAnchor(anchor,intendedOwner);
  const result=await acquireDeploymentLease(new PrismaDeploymentStore(db),{...owner,targetCommit,owner:'RESTORED_QA_PRIVATE_CONTROL',now:new Date(),leaseMs:600000,recoveryPreflightPassed:true});
  assert.equal(result.acquired,true,'RESTORED_QA_CANONICAL_LEASE_NOT_ACQUIRED');
 });
 const {activateDeploymentMaintenance}=await import('./deploymentMaintenance');assert.equal(fs.existsSync(marker),false);
 await activateDeploymentMaintenance(view.roots['recovery-coordination'],{deploymentId:owner.deploymentId,releaseId:owner.releaseId,message:'RESTORED_QA_PRIVATE_CONTROL',activatedAt:new Date()});
 const fd=fs.openSync(marker,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd,{bigint:true});assert.ok(st.isFile()&&st.uid===0n&&st.nlink===1n&&(st.mode&0o777n)===0o600n&&st.size>0n&&st.size<=8192n);assert.equal(pin(st),pin(fs.lstatSync(marker,{bigint:true})));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const directory=fs.openSync(view.roots['recovery-coordination'],fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
 return withRestoredQaMigrationBaseline(proof,material,anchor,owner,b=>work(b,owner));
}
/** Must run before auth fixtures, HTTP business writes or the first B DDL.
 * Only control/lease/version-store metadata may differ from source A. */
export async function withRestoredQaMigrationBaseline<T>(proof:unknown,material:RestoredQaWorkingMaterial,
 anchor:RestoredQaHistoricalAnchor,owner:Owner,work:(baseline:RestoredQaMigrationBaseline)=>Promise<T>){
 const context=assertActiveStrictRestoreProof(proof),view=assertRestoredQaWorkingMaterial(material,owner),accepted=assertRestoredQaHistoricalAnchor(anchor,intended(owner));
 assert.equal(accepted.context,context);assert.deepEqual(view.database,context.proof.database);assert.deepEqual(accepted.decision.targetDatabase,view.database);assert.notDeepEqual(accepted.decision.sourceDatabase,view.database);
 const {protectedBoundary}=await import('./protectedBridgeMigrations');const boundary=protectedBoundary(owner);boundary();
 // Database was independently restored; coordination is this new control
 // owner's own state. Neither is presented as an unchanged business file.
 verifyWorkingFiles(context,view);
 const descriptor=Object.freeze({format:'sabalan-verified-complete-source-and-native-restore-b/v1' as const,
  deploymentId:owner.deploymentId,releaseId:owner.releaseId,checksum:accepted.decision.sourceCheckpoint.checksum,
  sourceDatabase:accepted.decision.sourceDatabase,targetDatabase:view.database,sourceCheckpoint:accepted.decision.sourceCheckpoint,
  independentRestoreClaimed:false as const,cleanupPending:true as const,productionAdmission:false as const});
 const token=Object.freeze({})as RestoredQaMigrationBaseline,s:State={active:true,initializing:true,privateClosed:false,proof,material,anchor,owner:Object.freeze({...owner}),context,boundary,descriptor};states.set(token,s);
 try{
  await withSystemRecoveryDatabaseClient(view.database.name,async db=>{
   await db.$transaction(async tx=>{
    await assertRestoredQaMigrationLease(tx,token,owner);
    const rows=await tx.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(h ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations h`;
    assert.equal(rows.length,1);assert.equal(digest(rows[0].value),context.proof.rawHistorySha256);assert.equal(JSON.parse(rows[0].value).length,440);
    await assertRecoveryBusinessProof(tx,context.businessDataProof);stateFor(token,owner);
    // This is a private restored database control operation, not a production
    // deployment phase traversal or a claim of local/remote B backup creation.
    const updated=await tx.deploymentOperation.updateMany({where:{id:owner.deploymentId,releaseId:owner.releaseId,leaseToken:owner.leaseToken,
     activeKey:'production',phase:'LEASE_ACQUIRED',leaseExpiresAt:{gt:new Date(Date.now()+20000)}},data:{phase:'MUTATION_STARTED',
     reportJson:{inspectionTarget:'RESTORED_QA',baseline:descriptor,cleanupPending:true,independentPointHealthy:false,productionAdmission:false}}});
    assert.equal(updated.count,1,'RESTORED_QA_INITIALIZATION_LEASE_LOST');
   },{maxWait:1000,timeout:15000});
  });
  s.initializing=false;
  return await work(token);
 }finally{s.active=false;states.delete(token);}
}

declare const normalBrand:unique symbol;
export type RestoredQaPrivateNormal=Readonly<{[normalBrand]:true}>;
const normalStates=new WeakMap<RestoredQaPrivateNormal,State>();
/** Only the SAME original HTTP owner may consume this in-process result. It
 * grants no production phase, public traffic, financial qualification or DDL. */
export function assertRestoredQaPrivateNormal(normal:RestoredQaPrivateNormal,material:RestoredQaWorkingMaterial,
 owner:Readonly<{deploymentId:string;releaseId:string}>){
 const s=normalStates.get(normal);assert.ok(s?.active&&s.privateClosed&&s.material===material,'RESTORED_QA_PRIVATE_NORMAL_UNPROVEN');
 assert.equal(s.owner.deploymentId,owner.deploymentId);assert.equal(s.owner.releaseId,owner.releaseId);assert.equal(assertActiveStrictRestoreProof(s.proof),s.context);
 const view=assertRestoredQaWorkingMaterial(material,owner);assert.deepEqual(view.database,s.context.proof.database);
 assert.equal(fs.existsSync(path.join(view.roots['recovery-coordination'],'deployment-maintenance.json')),false);
 assert.ok(s.migrationEvidence,'RESTORED_QA_VERIFIED_MIGRATION_EVIDENCE_MISSING');
 return Object.freeze({database:view.database,root:view.root,classification:'RESTORED_QA_PRIVATE_CONTROL_CLOSED_WITHOUT_PUBLICATION' as const,
  migrationEvidence:s.migrationEvidence,cleanupPending:true as const,independentPointHealthy:false as const,productionAdmission:false as const});
}
export async function completeRestoredQaPrivateControl(baseline:RestoredQaMigrationBaseline,owner:Owner,
 files:ReadonlyMap<string,Buffer>,migration:MigrationRun,adoption:RestoredQaAdoptionCompletion){
 const s=stateFor(baseline,owner),view=assertRestoredQaWorkingMaterial(s.material,owner);
 const {assertRestoredQaAdoptionCompletion}=await import('./restoredQaFileAdoptionAuthority');assertRestoredQaAdoptionCompletion(adoption,baseline,owner);
 const {compileProtectedFinancialMigrationPlan,verifyProtectedFinancialNativeRun}=await import('./protectedFinancialMigrationEvidence');
 const {verifyExistingRestoredQaProtectedBridgeMigration}=await import('./protectedBridgeMigrations');
 const sourceFiles=new Map(s.context.proof.pendingMigrations.map(name=>{const bytes=files.get(name);assert.ok(bytes);return[name,bytes]as const;}));
 const plan=compileProtectedFinancialMigrationPlan(sourceFiles);assert.equal(migration.historyRaw.before,s.context.proof.rawHistoryJson);
 const marker=path.join(view.roots['recovery-coordination'],'deployment-maintenance.json');assert.equal(fs.realpathSync(marker),marker);
 const markerFd=fs.openSync(marker,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let markerBefore:fs.BigIntStats,markerRaw:Buffer;
 try{markerBefore=fs.fstatSync(markerFd,{bigint:true});assert.ok(markerBefore.isFile()&&markerBefore.uid===0n&&markerBefore.nlink===1n&&(markerBefore.mode&0o777n)===0o600n&&markerBefore.size>0n&&markerBefore.size<=8192n);
  markerRaw=fs.readFileSync(markerFd);assert.equal(BigInt(markerRaw.length),markerBefore.size);assert.equal(pin(markerBefore),pin(fs.fstatSync(markerFd,{bigint:true})));assert.equal(pin(markerBefore),pin(fs.lstatSync(marker,{bigint:true})));
 }finally{fs.closeSync(markerFd);}
 assert.equal(JSON.parse(markerRaw.toString()).deploymentId,owner.deploymentId);assert.equal(JSON.parse(markerRaw.toString()).releaseId,owner.releaseId);
 let native:ReturnType<typeof verifyProtectedFinancialNativeRun>|undefined;
 await withSystemRecoveryDatabaseClient(view.database.name,async db=>{
  for(const [name,bytes]of sourceFiles)await verifyExistingRestoredQaProtectedBridgeMigration(db,owner,name,bytes,baseline);
  await db.$transaction(async tx=>{
   await assertRestoredQaMigrationLease(tx,baseline,owner);
   const [lock]=await tx.$queryRaw<Array<{owned:boolean}>>`SELECT pg_try_advisory_xact_lock(741936426::bigint) AS owned`;assert.equal(lock?.owned,true);
   const rows=await tx.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations t`;
   assert.equal(rows.length,1);assert.equal(rows[0].value,migration.historyRaw.after);
   const beforeIds=new Set((JSON.parse(s.context.proof.rawHistoryJson)as Array<{id:string}>).map(r=>r.id));
   const newIds=(JSON.parse(rows[0].value)as Array<{id:string}>).filter(r=>!beforeIds.has(r.id)).map(r=>r.id);assert.equal(newIds.length,5);
   const prior=await tx.$queryRaw<Array<{value:string}>>`SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json)::text AS value FROM public._prisma_migrations t WHERE NOT(id=ANY(string_to_array(${newIds.join(',')},',')))`;
   assert.equal(prior.length,1);assert.equal(prior[0].value,migration.historyRaw.prior);native=verifyProtectedFinancialNativeRun(plan,migration.run,s.context.proof.rawHistoryJson,rows[0].value,prior[0].value);
   await assertRecoveryBusinessProof(tx,s.context.businessDataProof);verifyWorkingFiles(s.context,view);stateFor(baseline,owner);assertRestoredQaAdoptionCompletion(adoption,baseline,owner);
   // Source-owned defensive snapshot; only the exact opaque NORMAL cap exposes it.
   s.migrationEvidence=immutableSnapshot({run:migration.run,historyRaw:migration.historyRaw,native});
   const changed=await tx.deploymentOperation.updateMany({where:{id:owner.deploymentId,releaseId:owner.releaseId,leaseToken:owner.leaseToken,
    activeKey:'production',phase:'MUTATION_STARTED',leaseExpiresAt:{gt:new Date(Date.now()+20000)}},data:{phase:'ABORTED',activeKey:null,
    completedAt:new Date(),errorCode:'RESTORED_QA_PRIVATE_CONTROL_CLOSED_WITHOUT_PUBLICATION',reportJson:{inspectionTarget:'RESTORED_QA',
     classification:'RESTORED_QA_PRIVATE_CONTROL_CLOSED_WITHOUT_PUBLICATION',native,cleanupPending:true,independentPointHealthy:false,
     productionAdmission:false,financialSchemaQualified:false,publicTrafficOpened:false}}});assert.equal(changed.count,1);
  },{maxWait:1000,timeout:15000});
 });
 s.privateClosed=true;
 // Release only this private B marker after its owned QA lease is terminal.
 // On uncertain filesystem completion, restore the exact bytes fail-closed.
 try{assert.equal(pin(markerBefore),pin(fs.lstatSync(marker,{bigint:true})));assert.equal(digest(fs.readFileSync(marker)),digest(markerRaw));fs.unlinkSync(marker);
  const fd=fs.openSync(view.roots['recovery-coordination'],fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 }catch(error){if(!fs.existsSync(marker)){const fd=fs.openSync(marker,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.writeFileSync(fd,markerRaw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   const directory=fs.openSync(view.roots['recovery-coordination'],fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}}
  throw error;}
 const normal=Object.freeze({})as RestoredQaPrivateNormal;normalStates.set(normal,s);assertRestoredQaPrivateNormal(normal,s.material,owner);
 return Object.freeze({normal,proof:Object.freeze({format:'sabalan-restored-qa-private-control-closed/v1' as const,phase:'ABORTED' as const,
  classification:'RESTORED_QA_PRIVATE_CONTROL_CLOSED_WITHOUT_PUBLICATION' as const,database:view.database,native,
  cleanupPending:true as const,httpOriginalClosurePending:true as const,independentPointHealthy:false as const,productionAdmission:false as const,
  financialSchemaQualified:false as const,publicTrafficOpened:false as const})});
}
