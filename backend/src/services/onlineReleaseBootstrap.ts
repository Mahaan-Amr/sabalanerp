/** First ONLINE-capable release is installed inside ADR-0039 maintenance.
 * This is not adoption of the legacy runtime. Only the original controller
 * retaining the returned opaque capability can complete generation one.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import type {PrismaClient,Prisma} from '@prisma/client';
import {prepareValidatedOnlineRegistration,type PreparedRegistration,type OnlineRegistrationOwner} from './onlineReleaseRegistration';
import {DEPLOYMENT_MAINTENANCE_FILE} from './deploymentMaintenance';
import {assertProtectedBootstrapCheckpointLineage} from './onlineBootstrapCheckpointLineage';
import {validateProductionExecutionBindings} from './onlineImageExecutionBinding';

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
 ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const pin=(st:fs.BigIntStats)=>[process.platform==='win32'?0n:st.dev,st.ino,st.size,st.mtimeNs,st.ctimeNs,st.uid,st.mode,st.nlink].map(String).join(':');
function requireProof(value:unknown,code:string):asserts value{if(!value)throw Error(code);}
function directoryPin(directory:string){
 requireProof(path.isAbsolute(directory)&&fs.realpathSync(directory)===directory,'ONLINE_BOOTSTRAP_PRIVATE_DIRECTORY_REQUIRED');
 const st=fs.lstatSync(directory,{bigint:true});
 requireProof(st.isDirectory()&&!st.isSymbolicLink()&&(process.platform==='win32'||(st.mode&0o077n)===0n)
  &&(!process.getuid||st.uid===BigInt(process.getuid())),'ONLINE_BOOTSTRAP_PRIVATE_DIRECTORY_REQUIRED');
 return[st.dev,st.ino,st.uid,st.mode].map(String).join(':');
}
function readPrivate(file:string,maximum:number){
 requireProof(path.isAbsolute(file)&&fs.realpathSync(file)===file,'ONLINE_BOOTSTRAP_PRIVATE_PATH_REQUIRED');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const st=fs.fstatSync(fd,{bigint:true});
  requireProof(st.isFile()&&st.nlink===1n&&st.size>0n&&st.size<=BigInt(maximum)
   &&(process.platform==='win32'||(st.mode&0o077n)===0n)
   &&(!process.getuid||st.uid===BigInt(process.getuid())),'ONLINE_BOOTSTRAP_PRIVATE_FILE_REQUIRED');
  const raw=fs.readFileSync(fd);
  requireProof(pin(st)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(st)===pin(fs.lstatSync(file,{bigint:true})),
   'ONLINE_BOOTSTRAP_FILE_CHANGED');
  return{raw,pin:pin(st),sha256:createHash('sha256').update(raw).digest('hex'),value:JSON.parse(raw.toString('utf8'))};
 }finally{fs.closeSync(fd);}
}
function maintenance(directory:string,owner:OnlineRegistrationOwner){
 const observed=readPrivate(path.join(directory,DEPLOYMENT_MAINTENANCE_FILE),16384);
 requireProof(observed.value.deploymentId===owner.deploymentId&&observed.value.releaseId===owner.releaseId
  &&typeof observed.value.message==='string'&&Number.isFinite(Date.parse(observed.value.activatedAt)),
  'ONLINE_BOOTSTRAP_OWNED_MAINTENANCE_REQUIRED');
 return observed;
}
type Validated=ReturnType<typeof prepareValidatedOnlineRegistration>;
declare const bootstrapBrand:unique symbol;
export type ProtectedOnlineBootstrap=Readonly<{[bootstrapBrand]:true}>;
type State={database:PrismaClient;owner:OnlineRegistrationOwner;input:PreparedRegistration;validated:Validated;
 coordinationDirectory:string;publicationDirectory:string;coordinationPin:string;publicationPin:string;maintenancePin:string;completed:boolean};
const operations=new WeakMap<ProtectedOnlineBootstrap,State>();

async function assertBoundary(tx:Prisma.TransactionClient,state:State,phases:string[]){
 requireProof(directoryPin(state.coordinationDirectory)===state.coordinationPin&&directoryPin(state.publicationDirectory)===state.publicationPin,
  'ONLINE_BOOTSTRAP_DIRECTORY_CHANGED');
 const observed=maintenance(state.coordinationDirectory,state.owner);
 requireProof(observed.pin===state.maintenancePin,'ONLINE_BOOTSTRAP_MAINTENANCE_CHANGED');
 const rows=await tx.$queryRaw<Array<{releaseId:string;targetCommit:string;phase:string;checkpointJson:any}>>`
  SELECT "releaseId","targetCommit",phase,"checkpointJson" FROM deployment_operations
  WHERE id=${state.owner.deploymentId} AND "leaseToken"=${state.owner.leaseToken} AND "activeKey"='production'
   AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds' FOR UPDATE`;
 const {manifest,acceptance}=state.validated;
 requireProof(rows.length===1&&rows[0].releaseId===state.owner.releaseId&&rows[0].targetCommit===manifest.sourceCommit
  &&phases.includes(rows[0].phase),'ONLINE_BOOTSTRAP_PROTECTED_LEASE_REQUIRED');
 const checkpoint=rows[0].checkpointJson;
 requireProof(checkpoint&&checkpoint.deploymentId===state.owner.deploymentId&&checkpoint.releaseId===manifest.releaseId
  &&checkpoint.localVerified===true&&checkpoint.remoteVerified===true&&checkpoint.restoreVerified===true
  &&checkpoint.manifestReadable===true&&checkpoint.compatibility?.local?.compatible===true
  &&checkpoint.compatibility?.remote?.compatible===true&&hash(checkpoint)===acceptance.checkpointSha256,
  'ONLINE_BOOTSTRAP_VERIFIED_CHECKPOINT_REQUIRED');
 assertProtectedBootstrapCheckpointLineage(acceptance,checkpoint);
 const identities=await tx.$queryRaw<Array<{name:string;systemIdentifier:string;oid:string}>>`
  SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid
  FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()`;
 requireProof(identities.length===1&&hash(identities[0])===hash({...manifest.database,oid:acceptance.qualification.deploymentTargetDatabase.oid}),
  'ONLINE_BOOTSTRAP_DATABASE_CHANGED');
 state.validated.accepted.revalidate();
 requireProof(maintenance(state.coordinationDirectory,state.owner).pin===state.maintenancePin,'ONLINE_BOOTSTRAP_MAINTENANCE_CHANGED');
}

/** Fixed controller-only operation: full semantic evidence is validated by the
 * same production registration validator. No startup or public admission is
 * granted by these rows. The deployment stays in its REAL protected phase. */
export async function prepareProtectedOnlineBootstrap(database:PrismaClient,owner:OnlineRegistrationOwner,
 input:PreparedRegistration,paths:{coordinationDirectory:string;publicationDirectory:string}):Promise<ProtectedOnlineBootstrap>{
 requireProof(input.previousReleaseId===null,'ONLINE_BOOTSTRAP_MUST_HAVE_NO_PREDECESSOR');
 const validated=prepareValidatedOnlineRegistration(owner,input);
 requireProof(validated.acceptance.qualification.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE','ONLINE_BOOTSTRAP_PROTECTED_COMPLETE_REQUIRED');
 requireProof(validated.manifest.generation===1,'ONLINE_BOOTSTRAP_GENERATION_ONE_REQUIRED');
 const observed=maintenance(paths.coordinationDirectory,owner);
 const state:State={database,owner:Object.freeze({...owner}),input:structuredClone(input),validated,...paths,
  coordinationPin:directoryPin(paths.coordinationDirectory),publicationPin:directoryPin(paths.publicationDirectory),maintenancePin:observed.pin,completed:false};
 await database.$transaction(async tx=>{
  await assertBoundary(tx,state,['MIGRATIONS_APPLIED','RELEASE_STARTED']);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(741936426)`;
  const prior=await tx.$queryRaw<Array<{releases:number;epochs:number}>>`SELECT
   (SELECT count(*)::int FROM online_releases) AS releases,(SELECT count(*)::int FROM online_serving_epochs) AS epochs`;
  requireProof(prior.length===1&&prior[0].releases===0&&prior[0].epochs===0,'ONLINE_BOOTSTRAP_REGISTRY_NOT_EMPTY');
  requireProof(fs.readdirSync(state.publicationDirectory).length===0,'ONLINE_BOOTSTRAP_PUBLICATION_ALREADY_EXISTS');
  const {manifest,acceptance,identityJson,compatibilityJson,recoveryJson,slots}=validated;
  await tx.onlineRelease.create({data:{id:owner.releaseId,deploymentId:owner.deploymentId,
   manifestSha256:input.manifestSha256,sourceCommit:manifest.sourceCommit,identityJson,compatibilityJson,recoveryJson,
   acceptanceJson:acceptance,phase:'READY',previousReleaseId:null}});
  await tx.onlineRuntimeSlot.createMany({data:slots});
  await assertBoundary(tx,state,['MIGRATIONS_APPLIED','RELEASE_STARTED']);
 },{timeout:30000,maxWait:1000});
 const capability=Object.freeze({}) as ProtectedOnlineBootstrap;operations.set(capability,state);return capability;
}

/** Host-local access only. A reconstructed token, another pool or another
 * owner cannot restart an interrupted bootstrap or adopt its live children. */
export function assertProtectedOnlineBootstrap(capability:ProtectedOnlineBootstrap,database:PrismaClient,owner:OnlineRegistrationOwner){
 const state=operations.get(capability);
 requireProof(state&&!state.completed&&state.database===database&&hash(state.owner)===hash(owner),'ONLINE_ORIGINAL_BOOTSTRAP_REQUIRED');
 requireProof(directoryPin(state.coordinationDirectory)===state.coordinationPin&&directoryPin(state.publicationDirectory)===state.publicationPin,
  'ONLINE_BOOTSTRAP_DIRECTORY_CHANGED');
 requireProof(maintenance(state.coordinationDirectory,state.owner).pin===state.maintenancePin,'ONLINE_BOOTSTRAP_MAINTENANCE_CHANGED');
 state.validated.accepted.revalidate();
 return{input:structuredClone(state.input),coordinationDirectory:state.coordinationDirectory,
  publicationDirectory:state.publicationDirectory,maintenanceSha256:maintenance(state.coordinationDirectory,state.owner).sha256};
}

/** Called ONLY by that original host after its real store.publish/readback and
 * original native HTTP readiness. Independently reread the first paired head;
 * a caller JSON object or receipt boolean cannot seed an epoch. */
export async function finalizeProtectedOnlineBootstrap(capability:ProtectedOnlineBootstrap,database:PrismaClient,
 owner:OnlineRegistrationOwner,expectedPublicationSha256:string){
 assertProtectedOnlineBootstrap(capability,database,owner);const state=operations.get(capability)!;
 requireProof(/^[a-f0-9]{64}$/.test(expectedPublicationSha256),'ONLINE_BOOTSTRAP_PUBLICATION_HASH_REQUIRED');
 const head=readPrivate(path.join(state.publicationDirectory,'published-00000001.json'),4*1024*1024),record=head.value;
 requireProof(head.sha256===expectedPublicationSha256&&record.format==='sabalan-browser-publication/v1'
  &&record.generation===1&&record.previousPublicationSha256===null&&record.registry?.generation===1
  &&head.raw.equals(Buffer.from(JSON.stringify(canonical(record))+'\n'))
  &&fs.readdirSync(state.publicationDirectory).join(',')==='published-00000001.json','ONLINE_BOOTSTRAP_FIRST_PUBLICATION_UNPROVEN');
 const current=record.registry.builds?.find((build:any)=>build.id===record.registry.current?.erp);
 // Location is separately bound to the original controller's freshly inspected
 // immutable carrier; qualification binds the identical compiled UI bytes.
 const stable=(build:any)=>({id:build.id,application:build.application,image:build.image,
  manifestSha256:build.manifestSha256,assets:build.assets,actionIds:build.actionIds});
 const graph=state.validated.accepted.acceptance.qualification.imageGraphs.frontend;
 const qualification=state.validated.accepted.acceptance.qualification;
 const execution=validateProductionExecutionBindings(qualification.productionExecutionBindings,{...qualification,releaseId:state.owner.releaseId});
 // The accepted archive index and the runtime CONFIG are separate identities.
 // readOnlineReleaseEvidence already authenticated this exact full graph.
 const qualifiedStable=(build:any)=>stable({...build,image:build.image===graph.index?execution.frontend:build.image});
 requireProof(current&&state.validated.accepted.browserRegistries.some(registry=>registry.builds.some((build:any)=>hash(qualifiedStable(build))===hash(stable(current)))),
  'ONLINE_BOOTSTRAP_UI_NOT_QUALIFIED');
 const binding=record.registry.apiBindings?.find((value:any)=>value.buildId===current.id);
 const runtime=state.input.scopes.find(value=>value.scope.purpose==='http'&&binding?.slotId==='backend_'+value.scope.runtimeId
  &&binding.image===value.scope.image&&binding.manifestSha256===value.scope.manifestSha256);
 requireProof(runtime&&binding.browserManifestSha256===current.manifestSha256,'ONLINE_BOOTSTRAP_PAIRED_BACKEND_UNPROVEN');
 const receipt=await database.$transaction(async tx=>{
  await assertBoundary(tx,state,['GATES_PASSED']);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(741936426)`;
  const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM online_runtime_slots
   WHERE id=${runtime.scope.runtimeId} AND "releaseId"=${owner.releaseId} AND phase='READY' AND "stoppedAt" IS NULL FOR UPDATE`;
  requireProof(rows.length===1,'ONLINE_BOOTSTRAP_ORIGINAL_READY_REQUIRED');
  const releases=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM online_releases WHERE id=${owner.releaseId}
   AND phase='READY' AND "previousReleaseId" IS NULL FOR UPDATE`;
  const epochs=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM online_serving_epochs FOR UPDATE`;
  requireProof(releases.length===1&&epochs.length===0,'ONLINE_BOOTSTRAP_HEAD_ALREADY_EXISTS');
  requireProof(readPrivate(path.join(state.publicationDirectory,'published-00000001.json'),4*1024*1024).pin===head.pin,
   'ONLINE_BOOTSTRAP_PUBLICATION_CHANGED');
  const epochId=randomUUID();
  await tx.$executeRaw`INSERT INTO online_serving_epochs(id,"releaseId","deploymentId",generation,"publicationSha256","servedAt")
   VALUES (${epochId},${owner.releaseId},${owner.deploymentId},1,${head.sha256},clock_timestamp())`;
  await tx.$executeRaw`UPDATE online_releases SET phase='SERVING',"servedAt"=clock_timestamp(),"updatedAt"=clock_timestamp()
   WHERE id=${owner.releaseId} AND phase='READY'`;
  await assertBoundary(tx,state,['GATES_PASSED']);
  return Object.freeze({epochId,releaseId:owner.releaseId,generation:1,publicationSha256:head.sha256,
   deploymentPhase:'GATES_PASSED',publicTrafficOpened:false,legacyReleaseAdopted:false});
 },{timeout:30000,maxWait:1000});
 state.completed=true;return receipt;
}

/** Independent final protected-deploy gate. An IPC completion response is not
 * enough to reopen traffic; the same live lease must own the real first epoch. */
export async function assertProtectedOnlineBootstrapFinalized(database:PrismaClient,owner:OnlineRegistrationOwner,coordinationDirectory:string){
 maintenance(coordinationDirectory,owner);
 const rows=await database.$queryRaw<Array<any>>`SELECT r.*,d."targetCommit",d."checkpointJson",e.generation,e."publicationSha256",
  (SELECT count(*)::int FROM online_releases) AS "releaseCount",(SELECT count(*)::int FROM online_serving_epochs) AS "epochCount"
  FROM online_releases r JOIN deployment_operations d ON d.id=r."deploymentId"
  JOIN online_serving_epochs e ON e."releaseId"=r.id AND e."deploymentId"=d.id
  WHERE d.id=${owner.deploymentId} AND d."releaseId"=${owner.releaseId} AND d."leaseToken"=${owner.leaseToken}
   AND d."activeKey"='production' AND d.phase='GATES_PASSED' AND d."leaseExpiresAt">clock_timestamp()+interval '20 seconds'
   AND r.id=${owner.releaseId} AND r.phase='SERVING' AND r."previousReleaseId" IS NULL
   AND e.generation=1 AND e."retiredAt" IS NULL
   AND EXISTS(SELECT 1 FROM online_runtime_slots s WHERE s."releaseId"=r.id AND s.role='serving'
    AND s.phase='SERVING' AND s."stoppedAt" IS NULL)`;
 requireProof(rows.length===1,'ONLINE_BOOTSTRAP_FINAL_EPOCH_REQUIRED');const row=rows[0],identity=row.identityJson;
 requireProof(row.releaseCount===1&&row.epochCount===1&&row.sourceCommit===row.targetCommit
  &&/^[a-f0-9]{64}$/.test(row.publicationSha256)&&identity?.manifestSha256===row.manifestSha256
  &&hash(row.compatibilityJson)===identity.compatibilitySha256&&hash(row.recoveryJson)===identity.recoverySha256
  &&row.acceptanceJson?.manifestSha256===row.manifestSha256&&row.acceptanceJson?.deploymentId===owner.deploymentId
  &&row.acceptanceJson?.checkpointSha256===hash(row.checkpointJson),'ONLINE_BOOTSTRAP_FINAL_IDENTITY_CHANGED');
 maintenance(coordinationDirectory,owner);
 return{format:'sabalan-protected-online-bootstrap-final-gate/v1',releaseId:owner.releaseId,generation:1,
  publicationSha256:row.publicationSha256,publicTrafficOpened:false};
}
