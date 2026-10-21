/** LOCAL isolated-database fixture authority only. Evidence reads are replaced
 * by the host bundler; SQL, scope files and worker lock metadata stay real. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PrismaClient} from '@prisma/client';
import {execFileSync} from 'node:child_process';
import {registerRetainedOnlineWorker} from '../onlineRetainedWorkerRegistration';
import {applyOnlineExpansion,compileOnlineExpansion,type OnlineExpansionPlan} from '../onlineMigrationPlan';
import {readOnlineGateCatalogIdentity} from '../onlineDeploymentGateContext';
const canonical=(v:any):any=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const raw=(v:any)=>Buffer.from(JSON.stringify(canonical(v))),sha=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
export async function run(input:{databaseUrl:string;schema:string;catalog:Array<{name:string;sql:string}>;migrationLock:string}){
 const url=new URL(input.databaseUrl);assert.equal(process.platform,'linux');assert.equal(process.getuid?.(),0);
 assert.equal(url.hostname,'postgres');assert.equal(url.port,'5432');assert.match(url.pathname,/^\/sabalanerp_concurrency_[a-f0-9]{16}$/);
 const database=new PrismaClient({datasources:{db:{url:input.databaseUrl}}}),root=fs.mkdtempSync(path.join(os.tmpdir(),'retained-worker-native-'));
 const workerFile=path.join(root,'worker.lock');fs.writeFileSync(workerFile,'',{mode:0o600});
 let concurrent:PromiseSettledResult<unknown>[]=[];
 let fixtureStage='READ_DATABASE_IDENTITY';
 let nativeStatus:Record<string,unknown>|null=null;
 try{
  const [identity]=await database.$queryRaw<Array<{name:string;systemIdentifier:string;oid:string}>>`SELECT current_database() AS name,
   (SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`;
  const stat=fs.statSync(workerFile,{bigint:true}),worker={file:'/app/recovery-coordination/deployment-online-worker.lock',device:String(stat.dev),inode:String(stat.ino),ownerUid:0};
  const scope=(runtimeId:string,nonce:string)=>({format:'sabalan-online-runtime-scope/v2',runtimeId,nonce,role:'control',purpose:'jobs',releaseId:'qa-retained-previous',image:'sha256:'+'a'.repeat(64),sourceCommit:'b'.repeat(40),manifestSha256:'c'.repeat(64),database:{name:identity.name,systemIdentifier:identity.systemIdentifier},worker,coordinationDirectory:'/app/recovery-coordination',nativeDirectory:'/app/recovery-coordination/online/native/'+runtimeId,boundaryDirectory:'/app/recovery-coordination/online/work/'+runtimeId});
  const save=(value:ReturnType<typeof scope>)=>{const file=path.join(root,value.runtimeId+'.json'),data=Buffer.concat([raw(value),Buffer.from('\n')]);fs.writeFileSync(file,data,{mode:0o400,flag:'wx'});return {file,sha256:sha(data),scope:value};};
  const previous=save(scope('1'.repeat(64),'2'.repeat(64))),fresh=save(scope('3'.repeat(64),'4'.repeat(64)));
  const owner={deploymentId:'qa-retained-attempt',releaseId:'qa-retained-next',leaseToken:'isolated-owned-fixture-only'};
  const checkpoint={deploymentId:owner.deploymentId,releaseId:owner.releaseId,captureMethod:'ONLINE_COHERENT_WAL',localVerified:true,remoteVerified:true,restoreVerified:true,independentRestoreVerified:true,manifestReadable:true,compatibility:{local:{compatible:true},remote:{compatible:true}}};
  const registration={evidenceDirectory:root,manifestSha256:'6'.repeat(64),acceptanceSha256:'7'.repeat(64),previousReleaseId:'qa-retained-legacy',scopes:[fresh]};
  const request={registration,previousJobsScope:previous,workerHostFile:workerFile,checkpointSha256:sha(raw(checkpoint))};
  // Explicit fixture evidence is not a production origin, signature or report.
  (globalThis as any).__retainedWorkerFixtureEvidence={manifest:{...previous.scope,runtimeBundleSha256:previous.scope.manifestSha256},acceptance:{deploymentId:'qa-retained-original',reports:{},qualification:{deploymentTargetDatabase:{oid:identity.oid}}}};
  fixtureStage='SEED_ISOLATED_LEASE_AND_RELEASES';
  await database.deploymentOperation.createMany({data:[{id:'qa-retained-original',activeKey:null,leaseToken:'old-fixture',releaseId:previous.scope.releaseId,targetCommit:previous.scope.sourceCommit,owner:'isolated-retained-worker-test',phase:'COMPLETED'},
   {id:owner.deploymentId,activeKey:'production',leaseToken:owner.leaseToken,releaseId:owner.releaseId,targetCommit:'d'.repeat(40),owner:'isolated-retained-worker-test',phase:'ONLINE_ROLLBACK_PUBLISHING',checkpointJson:checkpoint}].map(value=>({...value,leaseExpiresAt:new Date(Date.now()+600000),heartbeatAt:new Date(),startedAt:new Date()}))});
  await database.onlineRelease.createMany({data:[{id:previous.scope.releaseId,deploymentId:'qa-retained-original',manifestSha256:registration.manifestSha256,sourceCommit:previous.scope.sourceCommit,identityJson:{acceptanceSha256:registration.acceptanceSha256},compatibilityJson:{},recoveryJson:{},phase:'RETAINED'},
   {id:owner.releaseId,deploymentId:owner.deploymentId,manifestSha256:'8'.repeat(64),sourceCommit:'d'.repeat(40),identityJson:{},compatibilityJson:{},recoveryJson:{},acceptanceJson:{checkpointSha256:request.checkpointSha256},previousReleaseId:previous.scope.releaseId,phase:'SERVING'}]});
  const oldSlot={id:previous.scope.runtimeId,releaseId:previous.scope.releaseId,component:'backend',role:'control',phase:'STOPPED',nonceSha256:sha(Buffer.from(previous.scope.nonce)),imageIdentity:previous.scope.image,stoppedAt:new Date()};
  await database.onlineRuntimeSlot.create({data:oldSlot});
  const history=await database.$queryRaw`SELECT to_jsonb(m) AS row FROM "_prisma_migrations" m ORDER BY migration_name,id`;
  // Both real transactions compete on the same actual lease row. One may
  // enroll; the next must see the resulting PREPARED slot and refuse.
  fixtureStage='RACE_ACTUAL_WORKER_TRANSACTIONS';
  concurrent=await Promise.allSettled([registerRetainedOnlineWorker(database,owner,request),registerRetainedOnlineWorker(database,owner,request)]);
  assert.equal(concurrent.filter(row=>row.status==='fulfilled').length,1);assert.equal(concurrent.filter(row=>row.status==='rejected').length,1);
  const slots=await database.onlineRuntimeSlot.findMany({where:{releaseId:previous.scope.releaseId}});assert.equal(slots.length,2);assert.equal(slots.filter(row=>row.role==='serving').length,0);assert.equal(slots.find(row=>row.id===fresh.scope.runtimeId)?.phase,'PREPARED');
  assert.equal((await database.onlineRuntimeSlot.findUniqueOrThrow({where:{id:previous.scope.runtimeId}})).nonceSha256,oldSlot.nonceSha256);
  // Real registry history is append-only even in the isolated test database.
  // Preserve this never-started fixture preparation and use another fresh ID;
  // do not disable triggers or delete/reset registry rows between scenarios.
  fixtureStage='VERIFY_NATIVE_REGISTRY_IMMUTABILITY';await assert.rejects(database.onlineRuntimeSlot.delete({where:{id:fresh.scope.runtimeId}}),/ONLINE_REGISTRY_HISTORY_CANNOT_BE_DELETED/);
  await assert.rejects(database.onlineRuntimeSlot.update({where:{id:oldSlot.id},data:{phase:'SERVING',stoppedAt:null}}),/ONLINE_STOPPED_RUNTIME_CANNOT_RESTART/);
  await database.onlineRuntimeSlot.update({where:{id:fresh.scope.runtimeId},data:{phase:'STOPPED',stoppedAt:new Date()}});
  registration.scopes=[save(scope('5'.repeat(64),'6'.repeat(64)))];
  fixtureStage='VERIFY_ACTUAL_SQL_NEGATIVES';let expectedSlots=2;const refuse=async()=>{await assert.rejects(registerRetainedOnlineWorker(database,owner,request));assert.equal(await database.onlineRuntimeSlot.count(),expectedSlots);};
  await database.deploymentOperation.update({where:{id:owner.deploymentId},data:{phase:'ONLINE_SERVING'}});await refuse();
  await database.deploymentOperation.update({where:{id:owner.deploymentId},data:{phase:'ONLINE_ROLLBACK_PUBLISHING'}});
  const liveFixture={...oldSlot,id:'7'.repeat(64),nonceSha256:'8'.repeat(64),phase:'SERVING',stoppedAt:null};await database.onlineRuntimeSlot.create({data:liveFixture});expectedSlots++;await refuse();await database.onlineRuntimeSlot.update({where:{id:liveFixture.id},data:{phase:'STOPPED',stoppedAt:new Date()}});
  await database.onlineRelease.update({where:{id:owner.releaseId},data:{acceptanceJson:{checkpointSha256:'f'.repeat(64)}}});await refuse();await database.onlineRelease.update({where:{id:owner.releaseId},data:{acceptanceJson:{checkpointSha256:request.checkpointSha256}}});
  fs.unlinkSync(workerFile);fs.writeFileSync(workerFile,'changed',{mode:0o600});await refuse();
  assert.deepEqual(await database.$queryRaw`SELECT to_jsonb(m) AS row FROM "_prisma_migrations" m ORDER BY migration_name,id`,history);
  // Append a genuine canonical additive expansion; do not edit an existing
  // native history row or simulate Prisma status with a fabricated receipt.
  fixtureStage='APPLY_GENUINE_ADDITIVE_EXPANSION';await database.deploymentOperation.update({where:{id:owner.deploymentId},data:{phase:'ONLINE_EXPANDING'}});
  await database.onlineRelease.update({where:{id:owner.releaseId},data:{phase:'EXPANDING'}});
  await database.$executeRawUnsafe('CREATE TABLE qa_retained_worker_probe (id text PRIMARY KEY)');
  const plan:OnlineExpansionPlan={format:'sabalan-online-expansion/v1',migrationName:'20991021000000_qa_retained_worker_catalog',operations:[{kind:'add-nullable-column',table:'qa_retained_worker_probe',column:'added_value',type:'text'}]},compiled=compileOnlineExpansion(plan);
  await database.onlineMigrationStep.create({data:{id:'qa-retained-worker-expansion',releaseId:owner.releaseId,stepId:plan.migrationName,phase:'expand',operationSha256:compiled.operationSha256,operationJson:plan as any,sourceMigrationName:plan.migrationName}});
  assert.equal((await applyOnlineExpansion(database,owner,plan,Buffer.from(compiled.sql))).applied,true);
  const expanded=await database.$queryRaw<Array<{row:any}>>`SELECT to_jsonb(m) AS row FROM "_prisma_migrations" m ORDER BY migration_name,id`;
  assert.deepEqual(expanded.filter(row=>row.row.migration_name!==plan.migrationName),history);
  assert.ok(input.catalog.length>0&&input.catalog.length<=2000);assert.ok(Buffer.byteLength(input.schema)<1024*1024);
  for(const kind of ['old','current']){const directory=path.join(root,kind),migrations=path.join(directory,'migrations');fs.mkdirSync(migrations,{recursive:true,mode:0o700});fs.writeFileSync(path.join(directory,'schema.prisma'),input.schema);fs.writeFileSync(path.join(migrations,'migration_lock.toml'),input.migrationLock);
   for(const entry of input.catalog){assert.match(entry.name,/^[0-9]{14}_[A-Za-z0-9_]+$/);const target=path.join(migrations,entry.name);fs.mkdirSync(target,{mode:0o700});fs.writeFileSync(path.join(target,'migration.sql'),entry.sql,{flag:'wx'});}
   if(kind==='current'){const target=path.join(migrations,plan.migrationName);fs.mkdirSync(target,{mode:0o700});fs.writeFileSync(path.join(target,'migration.sql'),compiled.sql,{flag:'wx'});}
  }
  const status=(kind:string)=>{let code=0,signal:string|null=null,stdout='',stderr='';try{stdout=execFileSync(process.execPath,['/app/node_modules/prisma/build/index.js','migrate','status','--schema',path.join(root,kind,'schema.prisma')],{env:{...process.env,DATABASE_URL:input.databaseUrl},encoding:'utf8',maxBuffer:2*1024*1024});}catch(error:any){code=error.status;signal=error.signal??null;stdout=String(error.stdout??'');stderr=String(error.stderr??'');}
   nativeStatus={kind,code,signal,upToDate:/up to date/i.test(stdout+'\n'+stderr),stdoutSha256:sha(Buffer.from(stdout)),stderrSha256:sha(Buffer.from(stderr))};assert.ok(Number.isSafeInteger(code)&&code>=0&&signal===null,'ORIGINAL_STATUS_CHILD_NOT_CLOSED');return {code,signal,stdout,stderr};};
  fixtureStage='VERIFY_NATIVE_CATALOG_IDENTITY';const oldCatalog=readOnlineGateCatalogIdentity(path.join(root,'old')),currentCatalog=readOnlineGateCatalogIdentity(path.join(root,'current'));
  assert.equal(oldCatalog.schemaSha256,currentCatalog.schemaSha256);assert.notEqual(oldCatalog.migrationCatalogSha256,currentCatalog.migrationCatalogSha256);
  // Prisma status accepts a database-ahead catalog in the measured CLI. The
  // authenticated current catalog identity must therefore stay independently
  // bound; never treat a bare old "up to date" message as this proof.
  fixtureStage='OBSERVE_OLD_CATALOG_NATIVE_STATUS';const oldStatus=status('old'),oldPrismaAcceptedDatabaseAhead=oldStatus.code===0&&/up to date/i.test(oldStatus.stdout+'\n'+oldStatus.stderr);
  fixtureStage='VERIFY_CURRENT_CATALOG_AND_UNCHANGED_HISTORY';const currentStatus=status('current');assert.equal(currentStatus.code,0);assert.match(currentStatus.stdout,/up to date/i);
  assert.deepEqual(await database.$queryRaw`SELECT to_jsonb(m) AS row FROM "_prisma_migrations" m ORDER BY migration_name,id`,expanded);
  return {format:'sabalan-local-retained-worker-sql-fixture/v1',passed:true,productionAdmission:false,fixtureEvidenceOnly:true,realSqlTransactions:true,realLinuxWorkerPins:true,concurrentWinners:1,refusedCompetingOriginal:1,negativeCases:6,registryHistoryPreserved:true,migrationHistoryUnchanged:true,realAdditiveExpansion:true,oldCatalogIdentityDiffers:true,oldPrismaAcceptedDatabaseAhead,currentCatalogPassed:true,statusDidNotRewriteMigrationHistory:true};
 }catch(error){throw Object.assign(error instanceof Error?error:new Error('NATIVE_FIXTURE_FAILED'),{fixtureStage,nativeStatus});}
 finally{try{await database.$disconnect();}finally{delete (globalThis as any).__retainedWorkerFixtureEvidence;fs.rmSync(root,{recursive:true,force:true});}}
}
