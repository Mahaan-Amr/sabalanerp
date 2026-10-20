import {consumeOriginalCarrierDockerCommand,consumeOriginalCarrierFailure,provisionOriginalOnlineReleaseCarriers,readOriginalOnlineCarrier,acquireOriginalBootstrapLegacyBrowserSource,readOriginalBootstrapLegacyBrowserSource,provisionOriginalBootstrapLegacyFrontend,bindTargetBrowserImage} from './online-release-carriers.mjs';
import {consumeOriginalInquiryCarrierDockerCommand,consumeOriginalInquiryCarrierFailure,provisionOriginalInquiryCarrier,readProvisionedInquiryCarrier,readOriginalInquiryCarrier} from './online-inquiry-carrier.mjs';
import {verifyOriginalPhysicalCheckpointCertificate,verifyOriginalPhysicalCheckpointPublication,verifyOriginalPhysicalRepositoryPromotion,verifyOriginalTerminalCheckpointCoverage,readMountedOriginalCheckpointFile,verifyMountedOriginalCheckpointRepository,originalPhysicalCheckpointMetadata,checkpointCanonicalBytes,checkpointSha} from './online-checkpoint-finalization.mjs';
import {issueOriginalLegacyBrowserDescriptor} from './online-legacy-browser-descriptor.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createPrivateKey,createPublicKey,createHash,sign,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {BrowserRoutingStore,BrowserRoutingPublicationLock} from './browser-routing-store.mjs';
const require=createRequire(import.meta.url);
const PRIVATE_KEY='/etc/sabalan/online/release-controller-private-key.pem';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
const sha=b=>createHash('sha256').update(b).digest('hex');
function qualifiedBrowserBuilds(evidence){return evidence.browserRegistries.flatMap(row=>row.builds).map(build=>{
 const component=build.application==='erp'?'frontend':'inquiry',graph=evidence.imageGraphs?.[component];
 return graph&&build.image===graph.index?bindTargetBrowserImage(build,component,graph,evidence.deploymentTargetImages[component]).build:build;
});}
const assert=(v,code)=>{if(!v)throw Error(code);};
const pin=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].map(String).join(':');
function readPrivate(file,maximum,mode){
 assert(fs.realpathSync(file)===file,'ONLINE_HOST_PATH_ALIAS');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const st=fs.fstatSync(fd,{bigint:true});
  assert(st.isFile()&&st.uid===0n&&st.nlink===1n&&(st.mode&0o777n)===BigInt(mode)&&st.size>0n&&st.size<=BigInt(maximum),'ONLINE_HOST_PRIVATE_FILE');
  const data=fs.readFileSync(fd);assert(pin(st)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(st)===pin(fs.lstatSync(file,{bigint:true})),'ONLINE_HOST_FILE_CHANGED');
  return {data,pin:pin(st)};
 }finally{fs.closeSync(fd);}
}

/** The same original host object owns its SQL client, FD20 publication lock,
 * persistent key and EVERY child until actual terminal closure. Never recreate
 * this object from a status file after a controller failure. */
export class OriginalOnlineReleaseController {
 #checkpointCaptures=new Map();
 #inquiryActors=new Map();#expiredBuildFences=new Map();#retiredCarriers=new Map();
 #originalCreatedCarrierIds=new Set();#originalCarrierCreates=new Set();
 #originalCarrierCensusTail=Promise.resolve();
 #inquiryScopes=new Map();
 #bootstrapObservation=null;
 #bootstrapLegacy=null;
 #productionGates=new Map();#gateControls=new Map();#checkpointJobsDraining=new Set();
 #edge=null;#carriers=new Map();#publicationDirectory;#database;#owner;#lock;#store;#key;#keyPin;#bootstrap=null;#advisory=null;#heartbeat=null;#advisoryPulse=null;#currentServingReleaseId=null;#lastPublicationSha=null;#parentBirth;#composeFile;#project;#databaseUrl;#observers=[];#carrierFailures=[];#accepted;#origins=new Map();#preparedInputs=new Map();#releases=new Map();#children=new Map();#held=null;
 constructor({database,owner,publicationDirectory,publicationLock,composeFile,project,runtimeDatabaseUrl}){
  assert(process.platform==='linux'&&process.getuid()===0&&publicationLock instanceof BrowserRoutingPublicationLock,'ONLINE_ORIGINAL_HOST_REQUIRED');
  this.#parentBirth={pid:process.ppid,stat:fs.readFileSync(`/proc/${process.ppid}/stat`,'utf8').split(') ').slice(1).join(') ').split(' ')[19]};
  publicationLock.assertOwned();
  assert(path.isAbsolute(composeFile)&&fs.realpathSync(composeFile)===composeFile&&/^docker-compose\.(prod|local)\.yml$/.test(path.basename(composeFile))&&/^[a-z0-9_-]+$/.test(project),'ONLINE_COMPOSE_TARGET_REQUIRED');
  this.#publicationDirectory=publicationDirectory;this.#composeFile=composeFile;this.#project=project;this.#databaseUrl=runtimeDatabaseUrl;
  const key=readPrivate(PRIVATE_KEY,4096,0o600);this.#key=createPrivateKey(key.data);this.#keyPin=key.pin;
  assert(this.#key.asymmetricKeyType==='ed25519','ONLINE_HOST_ED25519_REQUIRED');
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{this.#held='ORIGINAL_HOST_INTERRUPTED';void this.hold();});
  this.#database=database;this.#owner=Object.freeze({...owner});this.#lock=publicationLock;
  this.#store=new BrowserRoutingStore({directory:publicationDirectory,publicationLock,
   assertReleaseOwnership:()=>this.assertOwned()});
 }
 async assertOwned(phases=['ONLINE_ACCEPTING','ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING','ONLINE_ROLLBACK_PUBLISHING']){
  assert(!this.#held,'ONLINE_ORIGINAL_CONTROLLER_HELD');this.#lock.assertOwned();
  assert(process.ppid===this.#parentBirth.pid&&fs.readFileSync(`/proc/${process.ppid}/stat`,'utf8').split(') ').slice(1).join(') ').split(' ')[19]===this.#parentBirth.stat,'ONLINE_ORIGINAL_LAUNCHER_CHANGED');
  if(this.#advisory)await this.#assertAdvisory();
  if(this.#bootstrap)phases=[...phases,'MIGRATIONS_APPLIED','RELEASE_STARTED','GATES_PASSED','TRAFFIC_OPENED'];
  assert(readPrivate(PRIVATE_KEY,4096,0o600).pin===this.#keyPin,'ONLINE_PERSISTENT_KEY_CHANGED');
  const {assertOwnedOnlineLease}=require('./online-release-host-kernel.cjs');
  await this.#database.$transaction(tx=>assertOwnedOnlineLease(tx,this.#owner,phases));
 }
 async #assertAdvisory(){
  const rows=await this.#database.$queryRaw`SELECT pg_backend_pid() AS pid,
   (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS birth,
   EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
    AND classid=0 AND objid=741936425 AND objsubid=1 AND granted AND mode='ExclusiveLock') AS owned`;
  assert(rows.length===1&&rows[0].owned&&rows[0].pid===this.#advisory.pid&&rows[0].birth===this.#advisory.birth,
   'ONLINE_ORIGINAL_ADVISORY_SESSION_LOST');
 }
 async followingUpdateReady(){
  assert(!this.#advisory&&!this.#held,'ONLINE_ORIGINAL_FOLLOWING_STATE_CHANGED');this.#lock.assertOwned();
  const rows=await this.#database.$queryRaw`SELECT id FROM deployment_operations WHERE id=${this.#owner.deploymentId}
    AND "leaseToken"=${this.#owner.leaseToken} AND "activeKey" IS NULL AND phase IN ('COMPLETED','ROLLED_BACK')`;
  assert(rows.length===1,'ONLINE_ORIGINAL_INSTALL_NOT_COMPLETED');
  const [lock]=await this.#database.$queryRaw`SELECT pg_try_advisory_lock(741936425) AS owned,pg_backend_pid() AS pid,
   (SELECT backend_start::text FROM pg_stat_activity WHERE pid=pg_backend_pid()) AS birth`;
  assert(lock?.owned,'ONLINE_FOLLOWING_ADVISORY_BUSY');this.#advisory={pid:lock.pid,birth:lock.birth};
  await this.#assertAdvisory();this.#advisoryPulse=setInterval(()=>{void this.#assertAdvisory().catch(()=>{this.#held='ONLINE_ORIGINAL_ADVISORY_LOST';void this.hold();});},15000);return {sameOriginalController:true,originalApplicationHandlesRetained:true};
 }
 async acquireNextCycle(input){
  assert(this.#advisory&&!this.#held,'ONLINE_ORIGINAL_FOLLOWING_CONTROLLER_REQUIRED');await this.#assertAdvisory();
  const {PrismaDeploymentStore,acquireDeploymentLease,transitionDeployment,heartbeatDeployment}=require('./online-release-host-kernel.cjs');
  assert(/^[a-zA-Z0-9_-]{8,128}$/.test(input.deploymentId)&&/^[a-zA-Z0-9_-]{8,128}$/.test(input.releaseId)
   &&/^[a-f0-9]{40}$/.test(input.targetCommit),'ONLINE_NEXT_RELEASE_IDENTITY_REQUIRED');
  const store=new PrismaDeploymentStore(this.#database);
  const lease=await acquireDeploymentLease(store,{...input,owner:'original-online-controller',leaseToken:randomBytes(32).toString('hex'),now:new Date(),leaseMs:120000});
  assert(lease.acquired,'ONLINE_NEXT_LEASE_BUSY');
  const owner={deploymentId:lease.deployment.deploymentId,releaseId:lease.deployment.releaseId,leaseToken:lease.deployment.leaseToken};
  await this.beginNextOwnedLease(owner);
  await transitionDeployment(store,{...owner,nextPhase:'ONLINE_CHECKPOINTING',now:new Date()});
  this.#heartbeat=setInterval(()=>{void (async()=>{try{await this.#assertAdvisory();await heartbeatDeployment(store,{...this.#owner,now:new Date(),leaseMs:120000});}
   catch{this.#held='ONLINE_ORIGINAL_HEARTBEAT_UNPROVEN';void this.hold();}})();},15000);
  return {deploymentId:owner.deploymentId,releaseId:owner.releaseId,phase:'ONLINE_CHECKPOINTING',originalHandlesRetained:true};
 }
 async prepareOriginalCheckpointCapture(){
  await this.assertOwned(['ONLINE_CHECKPOINTING']);
  assert(this.#currentServingReleaseId&&(!this.#bootstrap||this.#bootstrap.finalized),'ONLINE_CHECKPOINT_SERVING_ORIGINAL_REQUIRED');
  const originals=[...this.#children.values()];
  const http=originals.find(row=>row.scope.releaseId===this.#currentServingReleaseId&&row.scope.purpose==='http'
   &&!row.closed&&row.events.some(event=>event.event==='READY'));
  const jobs=originals.filter(row=>row.scope.purpose==='jobs');
  assert(http&&jobs.length>0&&jobs.every(row=>row.closed&&row.nativeClosureVerified),'ONLINE_CHECKPOINT_ORIGINAL_JOBS_NOT_QUIESCENT');
  const worker=jobs.find(row=>row.scope.releaseId===http.scope.releaseId)?.scope.worker;
  assert(worker&&jobs.every(row=>row.scope.coordinationDirectory!==http.scope.coordinationDirectory||sha(bytes(row.scope.worker))===sha(bytes(worker))),
   'ONLINE_CHECKPOINT_WORKER_IDENTITY_CHANGED');
  const carrierToken=this.#carriers.get('backend_'+http.scope.runtimeId);assert(carrierToken,'ONLINE_CHECKPOINT_ORIGINAL_CARRIER_REQUIRED');
  const carrier=await readOriginalOnlineCarrier(this,carrierToken);
  assert(carrier.containerId===http.containerId&&carrier.image===http.scope.image,'ONLINE_CHECKPOINT_ORIGINAL_CARRIER_CHANGED');
  const coordinate=carrier.mounts.filter(row=>!row.readOnly&&row.type!=='tmpfs'
   &&(http.scope.coordinationDirectory===row.target||http.scope.coordinationDirectory.startsWith(row.target+'/')))
   .sort((a,b)=>b.target.length-a.target.length)[0];
  const trust=carrier.mounts.find(row=>row.type==='bind'&&row.target==='/run/sabalan-online'&&row.readOnly);
  assert(coordinate&&trust,'ONLINE_CHECKPOINT_ORIGINAL_MOUNTS_REQUIRED');
  const host=file=>{assert(file===coordinate.target||file.startsWith(coordinate.target+'/'),'ONLINE_CHECKPOINT_COORDINATION_ESCAPE');
   const result=path.join(coordinate.source,path.posix.relative(coordinate.target,file));
   assert(fs.realpathSync(path.dirname(result))===path.dirname(result),'ONLINE_CHECKPOINT_HOST_ALIAS');return result;};
  const runtimeId=randomBytes(32).toString('hex'),scope={...structuredClone(http.scope),runtimeId,nonce:randomBytes(32).toString('hex'),purpose:'capture',role:'control',worker:structuredClone(worker),
   nativeDirectory:http.scope.coordinationDirectory+'/online/native/'+runtimeId,boundaryDirectory:http.scope.coordinationDirectory+'/online/work/'+runtimeId};
  const initialContainerIds=(await this.#docker(['ps','--all','--no-trunc','--filter','label=com.docker.compose.project='+this.#project,'--format','{{.ID}}'])).trim().split('\n').filter(Boolean).sort();
  assert(initialContainerIds.length>0&&initialContainerIds.every(id=>/^[a-f0-9]{64}$/.test(id)),'ONLINE_CHECKPOINT_PROJECT_CENSUS_REQUIRED');
  const state={runtimeId,captureId:randomBytes(32).toString('hex'),scope,originalHttpRuntimeId:http.scope.runtimeId,prepared:false,initialContainerIds,owner:{...this.#owner}};this.#checkpointCaptures.set(runtimeId,state);
  try{
   for(const file of [scope.nativeDirectory,scope.boundaryDirectory])fs.mkdirSync(host(file),{mode:0o700});
   const control=host(scope.nativeDirectory+'/deployment-runtime-control.lock');
   const lock=fs.openSync(control,'wx',0o600);try{fs.fsyncSync(lock);}finally{fs.closeSync(lock);}
   // Scope parser requires sorted ASCII JSON with exactly one trailing LF.
   const raw=Buffer.from(JSON.stringify(canonical(scope)).replace(/[\u007f-\uffff]/g,ch=>'\\u'+ch.charCodeAt(0).toString(16).padStart(4,'0'))+'\n');
   const scopeFile=path.join(trust.source,runtimeId+'.json'),descriptor=fs.openSync(scopeFile,'wx',0o400);
   try{fs.writeFileSync(descriptor,raw);fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}
   assert(readPrivate(scopeFile,16384,0o400).data.equals(raw),'ONLINE_CHECKPOINT_SCOPE_CHANGED');
   const release=this.#releases.get(http.scope.releaseId);assert(release,'ONLINE_CHECKPOINT_ORIGINAL_RELEASE_REQUIRED');
   const evidence=require('./online-release-host-kernel.cjs').readOnlineReleaseEvidence(release.input.evidenceDirectory,release.input);evidence.revalidate();
   const checkpointParent=host(scope.coordinationDirectory+'/online/checkpoints');
   if(!fs.existsSync(checkpointParent))fs.mkdirSync(checkpointParent,{mode:0o700});
   assert(fs.realpathSync(checkpointParent)===checkpointParent&&(fs.lstatSync(checkpointParent).mode&0o777)===0o700,'ONLINE_CHECKPOINT_PARENT_UNSAFE');
   const runtimeRoot=scope.coordinationDirectory+'/online/checkpoints/'+state.captureId,producerRoot=host(runtimeRoot);fs.mkdirSync(producerRoot,{mode:0o700});
   const pgIds=(await this.#docker(['ps','--all','--no-trunc','--filter','label=com.docker.compose.project='+this.#project,'--filter','label=com.docker.compose.service=postgres','--format','{{.ID}}'])).trim().split('\n').filter(Boolean);
   assert(pgIds.length===1,'ONLINE_CHECKPOINT_POSTGRES_IDENTITY_REQUIRED');
   const [postgres]=JSON.parse(await this.#docker(['inspect',pgIds[0]]));
   assert(postgres.Id===pgIds[0]&&postgres.State.Running&&postgres.State.Health?.Status==='healthy'
    &&postgres.Config.Labels['com.docker.compose.project']===this.#project&&postgres.Config.Labels['com.docker.compose.service']==='postgres','ONLINE_CHECKPOINT_POSTGRES_CHANGED');
   const users=postgres.Config.Env.filter(value=>value.startsWith('POSTGRES_USER=')).map(value=>value.slice(14));assert(users.length===1&&/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(users[0]),'ONLINE_CHECKPOINT_POSTGRES_USER_REQUIRED');
   const [database]=await this.#database.$queryRaw`SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()`;
   assert(database&&database.name===scope.database.name&&database.systemIdentifier===scope.database.systemIdentifier,'ONLINE_CHECKPOINT_ACTUAL_DATABASE_CHANGED');
   const entrySha256=(await this.#docker(['exec',carrier.containerId,'node','-e',"const f=require('fs'),c=require('crypto');const p='/app/dist/scripts/sealNativeVersionedFiles.js';const s=f.lstatSync(p);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||f.realpathSync(p)!==p)throw Error('ENTRY_ALIAS');process.stdout.write(c.createHash('sha256').update(f.readFileSync(p)).digest('hex')); "])).trim();assert(/^[a-f0-9]{64}$/.test(entrySha256),'ONLINE_CHECKPOINT_INSTALLED_SEALER_REQUIRED');
   const inquirySource=await this.readOriginalCheckpointInquirySource();
   const compose=JSON.parse(await this.#docker(['compose','-f',this.#composeFile,'config','--format','json']));
   const secrets=compose.services?.deployment?.volumes?.filter(row=>row.type==='bind'&&row.target==='/run/deployment-secrets'&&row.read_only===true);
   assert(secrets?.length===1&&path.isAbsolute(secrets[0].source)&&fs.realpathSync(secrets[0].source)===secrets[0].source,'ONLINE_CHECKPOINT_HOST_CRYPTO_SECRETS_REQUIRED');
   const secretRoot=secrets[0].source;
   const projectContainers=JSON.parse(await this.#docker(['inspect',...initialContainerIds]));
   const applicationMountHosts=[...new Set(projectContainers.filter(row=>row.Config.Labels['com.docker.compose.service']!=='deployment').flatMap(row=>row.Mounts.filter(mount=>mount.Type!=='tmpfs'&&mount.Source).map(mount=>mount.Source)))].sort();
   for(const source of applicationMountHosts)assert(secretRoot!==source&&!secretRoot.startsWith(source+'/')&&!source.startsWith(secretRoot+'/'),'ONLINE_CHECKPOINT_SECRETS_APPLICATION_ALIAS');
   const result={runtimeId,captureId:state.captureId,scope,scopeFile,producerRoot,runtimeRoot,runtimeScopeFile:'/run/sabalan-online/'+runtimeId+'.json',scopeSha256:sha(raw),
    lease:{...this.#owner,advisory:this.#advisory?structuredClone(this.#advisory):null},composeFile:this.#composeFile,project:this.#project,
    nativeDirectoryHost:host(scope.nativeDirectory),boundaryDirectoryHost:host(scope.boundaryDirectory),admissionDirectoryHost:host(scope.admission.directory),
    backend:{containerId:carrier.containerId,image:carrier.image,startedAt:carrier.startedAt,privateAddress:carrier.privateAddress},
    expectedContainerIds:initialContainerIds,coordinationHost:coordinate.source,coordinationRuntime:coordinate.target,
    database:structuredClone(database),databaseUrl:this.#databaseUrl,postgres:{containerId:postgres.Id,image:postgres.Image,startedAt:postgres.State.StartedAt,user:users[0]},
    inquiry:inquirySource.inquiry,inquiryRuntimeIds:inquirySource.inquiryRuntimeIds,sealerEntrySha256:entrySha256,
    hostCrypto:{localKeyFile:path.join(secretRoot,'local-rollback-key'),publicKeyFile:path.join(secretRoot,'remote-recovery-public.pem'),applicationMountHosts},
    sources:evidence.manifest.roots.map((row,index)=>({name:'retained-'+String(index).padStart(2,'0'),path:row.live,device:row.liveDevice,inode:row.liveInode,storeRoot:row.store})),
    sealerStores:evidence.manifest.roots.map((row,index)=>({name:'retained-'+String(index).padStart(2,'0'),device:row.storeDevice,inode:row.storeInode})),
    originalHttpRuntimeId:http.scope.runtimeId,originalJobsRuntimeIds:jobs.map(row=>row.scope.runtimeId),productionAdmission:false};
   state.prepared=true;state.plan=result;return structuredClone(result);
  }catch(error){this.#held='ONLINE_ORIGINAL_CHECKPOINT_PREPARATION_UNPROVEN';throw error;}
 }
 async drainOriginalCurrentJobsForCheckpoint(){
  await this.assertOwned(['ONLINE_CHECKPOINTING']);assert(this.#currentServingReleaseId,'ONLINE_CURRENT_ORIGINAL_RELEASE_REQUIRED');
  const jobs=[...this.#children.values()].filter(row=>row.scope.purpose==='jobs'&&!row.closed);
  assert(jobs.every(row=>row.scope.releaseId===this.#currentServingReleaseId),'ONLINE_FOREIGN_CURRENT_JOBS_REFUSED');
  for(const row of jobs){this.#checkpointJobsDraining.add(row.scope.runtimeId);await this.prepareRuntime(row.scope.runtimeId);
   await this.awaitRuntimePrepared(row.scope.runtimeId);await this.shutdownRuntime(row.scope.runtimeId);await this.awaitRuntimeClosed(row.scope.runtimeId);}
  return {originalJobsClosed:true,runtimeIds:jobs.map(row=>row.scope.runtimeId)};
 }
 async readOriginalCyclePlan(){
  await this.assertOwned(['ONLINE_CHECKPOINTING','ONLINE_EXPANDING','ONLINE_ACCEPTING','ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING','ONLINE_ROLLBACK_PUBLISHING']);
  const input=this.#preparedInputs.get(this.#owner.releaseId)??this.#releases.get(this.#owner.releaseId)?.input
   ??[...this.#checkpointCaptures.values()].find(row=>row.owner.deploymentId===this.#owner.deploymentId)?.qualificationMaterial;
  return {releaseId:this.#owner.releaseId,previousReleaseId:this.#currentServingReleaseId,
   httpRuntimeIds:input?.scopes.filter(row=>row.scope.purpose==='http').map(row=>row.scope.runtimeId)||[],
   jobsRuntimeIds:input?.scopes.filter(row=>row.scope.purpose==='jobs').map(row=>row.scope.runtimeId)||[],
   currentJobsRuntimeIds:[...this.#children.values()].filter(row=>row.scope.purpose==='jobs'&&!row.closed).map(row=>row.scope.runtimeId),
   buildIds:input?this.readCarrierReleaseEvidence(this.#owner.releaseId).browserRegistries.at(-1)?.current:null};
 }
 async readOriginalContinuousCheckpointContext(runtimeId){
  const phases=['ONLINE_CHECKPOINTING','ONLINE_EXPANDING','ONLINE_ACCEPTING','ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING','ONLINE_ROLLBACK_PUBLISHING'];
  await this.assertOwned(phases);const capture=this.#checkpointCaptures.get(runtimeId);
  await Promise.all([...this.#originalCarrierCreates]);await this.assertOwned(phases);
  assert(capture?.prepared&&sha(bytes(capture.owner))===sha(bytes(this.#owner)),'ONLINE_ORIGINAL_CONTINUOUS_OWNER_REQUIRED');
  const rows=await this.#database.$queryRaw`SELECT phase,"targetCommit" FROM deployment_operations WHERE id=${this.#owner.deploymentId}
   AND "releaseId"=${this.#owner.releaseId} AND "leaseToken"=${this.#owner.leaseToken} AND "activeKey"='production'
   AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds'`;
  assert(rows.length===1&&phases.includes(rows[0].phase),'ONLINE_ORIGINAL_CONTINUOUS_LEASE_CHANGED');
  const allowed=new Set([...capture.initialContainerIds,...this.#originalCreatedCarrierIds]);
  for(const token of this.#carriers.values())allowed.add((await readOriginalOnlineCarrier(this,token)).containerId);
  if(this.#edge?.containerId)allowed.add(this.#edge.containerId);
  for(const row of this.#inquiryActors.values())if(row.containerId&&!row.carrierRemoved)allowed.add(row.containerId);
  const actual=await this.#withOriginalCarrierCensus(async()=>{const ids=(await this.#docker(['ps','--all','--no-trunc','--filter','label=com.docker.compose.project='+this.#project,'--format','{{.ID}}'])).trim().split('\n').filter(Boolean).sort();for(const id of this.#originalCreatedCarrierIds)allowed.add(id);return ids;});
  assert(actual.every(id=>allowed.has(id))&&capture.initialContainerIds.every(id=>actual.includes(id)),'ONLINE_ORIGINAL_CONTINUOUS_CENSUS_CHANGED');
  return {format:'sabalan-original-continuous-checkpoint-context/v1',runtimeId,phase:rows[0].phase,targetCommit:rows[0].targetCommit,
   lease:{...this.#owner,advisory:structuredClone(this.#advisory)},expectedContainerIds:actual,
   sourceBackend:structuredClone(capture.plan.backend),scopeSha256:capture.plan.scopeSha256,publicationSha256:this.#lastPublicationSha};
 }
 async prepareOriginalCheckpointPublication(input){
  await this.assertOwned(['ONLINE_CHECKPOINTING']);const state=this.#checkpointCaptures.get(input.runtimeId);
  assert(state?.prepared&&!state.publication,'ONLINE_ORIGINAL_CHECKPOINT_POINT_REQUIRED');
  const reportRaw=Buffer.from(input.reportRawBase64,'base64');assert(reportRaw.length>0&&reportRaw.length<=32*1024*1024&&reportRaw.toString('base64')===input.reportRawBase64,'ONLINE_CHECKPOINT_REPORT_BOUND');
  const report=JSON.parse(reportRaw),producer=JSON.parse(Buffer.from(report.originalProducerRawBase64,'base64')),sealRaw=Buffer.from(report.originalSealedManifestRawBase64,'base64'),seal=JSON.parse(sealRaw);
  const key=readPrivate('/etc/sabalan/online/qualification-public-key.pem',4096,0o444);
  assert(sha(key.data)==='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48','ONLINE_CHECKPOINT_FIXED_QUALIFICATION_KEY_CHANGED');
  const decision=verifyOriginalPhysicalCheckpointCertificate(input.physicalCertificate,key.data,report);
  assert(sha(reportRaw)===decision.reportSha256,'ONLINE_ORIGINAL_PHYSICAL_REPORT_CHANGED');
  const repositoryPromotion=verifyOriginalPhysicalRepositoryPromotion(input.repositoryPromotionCertificate,key.data,decision,state.captureId);
  const mountedReadback=await verifyMountedOriginalCheckpointRepository(repositoryPromotion.repository,decision,state.captureId);
  await this.assertOwned(['ONLINE_CHECKPOINTING']);
  const context=await this.readOriginalContinuousCheckpointContext(input.runtimeId);
  assert(input.liveCoverage?.phase==='LIVE_ORIGINAL_OWNER'&&input.liveCoverage.finalIntervalCompletion===false
   &&input.liveCoverage.captureId===state.captureId&&sha(bytes(input.liveCoverage.sourceDatabase))===sha(bytes(state.plan.database)),'ONLINE_CHECKPOINT_LIVE_OWNER_REQUIRED');
  const hostIdentity=file=>{const v=fs.readFileSync(file,'utf8').trim().toLowerCase();assert(/^[a-f0-9-]{36}$/.test(v)&&!/^[0-]*$/.test(v)&&!/^[f-]*$/.test(v),'ONLINE_CHECKPOINT_SOURCE_HOST_REQUIRED');return sha(Buffer.from(v));};
  const publicationRoot=path.join(state.plan.producerRoot,'canonical-publication');fs.mkdirSync(publicationRoot,{mode:0o700});
  const sourceHost={machineUuidSha256:hostIdentity('/sys/class/dmi/id/product_uuid'),kernelBootIdSha256:hostIdentity('/proc/sys/kernel/random/boot_id')};
  const metadata=originalPhysicalCheckpointMetadata({owner:this.#owner,targetCommit:context.targetCommit,plan:state.plan,producer,seal,sealRawBase64:sealRaw.toString('base64'),report,reportRawBase64:input.reportRawBase64,physicalDecision:decision,
   repositoryPromotion,localManifestFile:path.join(state.plan.producerRoot,'sealed-components/sealed.json'),sourceHost,liveCoverage:input.liveCoverage});
  const raw=checkpointCanonicalBytes(metadata),metadataSha256=checkpointSha(raw),transport={...metadata,canonicalMetadata:metadata,canonicalMetadataSha256:metadataSha256};
  const file=path.join(publicationRoot,'checkpoint-transport.json'),transportRaw=Buffer.concat([bytes(transport),Buffer.from('\n')]);
  const fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,transportRaw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const directory=fs.openSync(publicationRoot,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  state.publication={metadata,metadataSha256,file,transportSha256:sha(transportRaw),decision,keyPin:key.pin,mountedReadback};
  return {format:'sabalan-original-canonical-checkpoint-publication-request/v1',runtimeId:input.runtimeId,canonicalMetadataRawBase64:raw.toString('base64'),canonicalMetadataSha256:metadataSha256,transportRawBase64:transportRaw.toString('base64'),physicalCompletionSha256:decision.originalCompletionSha256};
 }
 async commitOriginalCheckpointPublication(input){
  await this.assertOwned(['ONLINE_CHECKPOINTING']);const state=this.#checkpointCaptures.get(input.runtimeId),pending=state?.publication;
  assert(pending&&!pending.committed,'ONLINE_ORIGINAL_CHECKPOINT_PUBLICATION_REQUIRED');
  const key=readPrivate('/etc/sabalan/online/qualification-public-key.pem',4096,0o444);assert(key.pin===pending.keyPin,'ONLINE_CHECKPOINT_TRUST_CHANGED');
  const certificate=verifyOriginalPhysicalCheckpointPublication(input.certificate,key.data,pending.metadata,pending.decision);
  await verifyMountedOriginalCheckpointRepository(pending.metadata.repositoryDirectory,pending.decision,state.captureId);
  assert(certificate.remoteMetadataSha256===pending.transportSha256&&sha(readPrivate(pending.file,8*1024*1024,0o400).data)===pending.transportSha256,'ONLINE_CHECKPOINT_CANONICAL_TRANSPORT_CHANGED');
  await this.readOriginalContinuousCheckpointContext(input.runtimeId);
  await this.#database.$transaction(async tx=>{
   await require('./online-release-host-kernel.cjs').assertOwnedOnlineLease(tx,this.#owner,['ONLINE_CHECKPOINTING']);
   const rows=await tx.$queryRaw`SELECT "checkpointJson" FROM deployment_operations WHERE id=${this.#owner.deploymentId} FOR UPDATE`;
   assert(rows.length===1&&rows[0].checkpointJson===null,'ONLINE_CHECKPOINT_PREEXISTING_POINT_REFUSED');
   const changed=await tx.$executeRaw`UPDATE deployment_operations SET "checkpointJson"=${JSON.stringify(pending.metadata)}::jsonb WHERE id=${this.#owner.deploymentId} AND "checkpointJson" IS NULL`;
   assert(changed===1,'ONLINE_CHECKPOINT_PUBLICATION_RACE');
  });
  const rows=await this.#database.$queryRaw`SELECT "checkpointJson" FROM deployment_operations WHERE id=${this.#owner.deploymentId}`;
  assert(rows.length===1&&sha(bytes(rows[0].checkpointJson))===pending.metadataSha256,'ONLINE_CHECKPOINT_DATABASE_READBACK_CHANGED');
  pending.committed=true;return {runtimeId:input.runtimeId,checkpointSha256:pending.metadataSha256,checkpointCommitted:true,continuousIntervalCompleted:false,releaseAdmissionGranted:false};
 }
 async observeProtectedBootstrapQualificationRequest(){
  await this.assertOwned(['MIGRATIONS_APPLIED','RELEASE_STARTED']);
  assert(!this.#accepted&&!this.#bootstrap,'ONLINE_BOOTSTRAP_REQUEST_BEFORE_ADMISSION_REQUIRED');
  const rows=await this.#database.$queryRaw`SELECT "targetCommit","checkpointJson" FROM deployment_operations
   WHERE id=${this.#owner.deploymentId} AND "releaseId"=${this.#owner.releaseId} AND "leaseToken"=${this.#owner.leaseToken}
    AND "activeKey"='production' AND phase IN ('MIGRATIONS_APPLIED','RELEASE_STARTED') AND "leaseExpiresAt">clock_timestamp()+interval '20 seconds'`;
  assert(rows.length===1,'ONLINE_BOOTSTRAP_REQUEST_LEASE_REQUIRED');const checkpoint=rows[0].checkpointJson;
  assert(checkpoint?.deploymentId===this.#owner.deploymentId&&checkpoint.releaseId===this.#owner.releaseId
   &&checkpoint.captureMethod==='PROTECTED_MAINTENANCE_COMPLETE'&&checkpoint.localVerified===true&&checkpoint.remoteVerified===true
   &&checkpoint.restoreVerified===true&&checkpoint.manifestReadable===true&&checkpoint.compatibility?.local?.compatible===true
   &&checkpoint.compatibility?.remote?.compatible===true,'ONLINE_BOOTSTRAP_REQUEST_CHECKPOINT_UNPROVEN');
  const identities=await this.#database.$queryRaw`SELECT current_database() AS name,p.system_identifier::text AS "systemIdentifier",d.oid::text AS oid
   FROM pg_control_system() p CROSS JOIN pg_database d WHERE d.datname=current_database()`;
  assert(identities.length===1&&sha(bytes(identities[0]))===sha(bytes(checkpoint.sourceDatabase)),'ONLINE_BOOTSTRAP_REQUEST_DATABASE_CHANGED');
  const ids=(await this.#docker(['ps','--all','--filter','label=com.docker.compose.project='+this.#project,
   '--filter','label=com.docker.compose.service=backend','--format','{{.ID}}'])).trim().split('\n').filter(Boolean);
  assert(ids.length===1,'ONLINE_BOOTSTRAP_REQUEST_ORIGINAL_BACKEND_REQUIRED');
  const [before]=JSON.parse(await this.#docker(['inspect',ids[0]]));
  assert(before?.Config?.Labels?.['com.docker.compose.project']===this.#project,'ONLINE_BOOTSTRAP_REQUEST_PROJECT_CHANGED');
  const mount=before.Mounts.find(row=>row.Destination==='/app/recovery-coordination'&&row.RW);
  assert(mount&&fs.realpathSync(mount.Source)===mount.Source,'ONLINE_BOOTSTRAP_REQUEST_COORDINATION_REQUIRED');
  const operation=sha(Buffer.concat([bytes(this.#owner),Buffer.from('\n')]));
  const original=JSON.parse(readPrivate(path.join(mount.Source,'deployment-file-adoption-native.json'),16384,0o600).data);
  assert(original.format==='sabalan-protected-file-adoption-native/v1'&&original.operation===operation&&original.phase==='QUIESCENT'
   &&original.nativeStatus===0&&original.nativeReaped===true&&original.databaseQuiet===true&&original.failed===false
   &&original.identity.database===identities[0].name&&String(original.identity.oid)===identities[0].oid
   &&original.identity.system===identities[0].systemIdentifier,'ONLINE_BOOTSTRAP_REQUEST_ORIGINAL_ADOPTION_UNPROVEN');
  const raw=readPrivate(path.join(mount.Source,'protected-file-baseline-'+operation+'.json'),1048576,0o400).data,baseline=JSON.parse(raw);
  assert(baseline.format==='sabalan-protected-file-baseline/v1'&&baseline.captureId===operation
   &&baseline.deploymentId===this.#owner.deploymentId&&baseline.releaseId===this.#owner.releaseId
   &&baseline.checkpointChecksum===checkpoint.checksum&&baseline.publicOnlineAdmission===false&&baseline.roots.length===9,
   'ONLINE_BOOTSTRAP_REQUEST_BASELINE_CHANGED');
  const [after]=JSON.parse(await this.#docker(['inspect',before.Id]));
  assert(after.Id===before.Id&&after.Image===before.Image&&after.State.StartedAt===before.State.StartedAt
   &&JSON.stringify(after.Mounts)===JSON.stringify(before.Mounts),'ONLINE_BOOTSTRAP_REQUEST_SOURCE_REPLACED');
  const result={format:'sabalan-original-protected-qualification-request/v1',sequence:1,...{deploymentId:this.#owner.deploymentId,releaseId:this.#owner.releaseId},
   targetCommit:rows[0].targetCommit,database:identities[0],checkpoint,roots:baseline.roots,
   ephemeralRoots:['/app/storage/reports','/app/storage/sales-reports','/app/storage/bi-reports'],adoptionSha256:sha(raw)};
  this.#bootstrapObservation={request:structuredClone(result),coordinationHost:mount.Source,sourceId:before.Id,baselineSha256:sha(raw)};
  return result;
 }
 async observeOriginalOnlineQualificationRequest({runtimeId,liveCoverage}){
  await this.assertOwned(['ONLINE_CHECKPOINTING']);const capture=this.#checkpointCaptures.get(runtimeId),point=capture?.publication;
  assert(point?.committed,'ONLINE_ORIGINAL_QUALIFICATION_COMMITTED_POINT_REQUIRED');
  await this.readOriginalContinuousCheckpointContext(runtimeId);
  assert(liveCoverage?.format==='sabalan-original-live-wal-coverage/v1'&&liveCoverage.phase==='LIVE_ORIGINAL_OWNER'
   &&liveCoverage.finalIntervalCompletion===false&&liveCoverage.captureId===capture.captureId
   &&sha(bytes(liveCoverage.sourceDatabase))===sha(bytes(capture.plan.database)),'ONLINE_ORIGINAL_QUALIFICATION_LIVE_PREFIX_REQUIRED');
  const [operation]=await this.#database.$queryRaw`SELECT "targetCommit","checkpointJson" FROM deployment_operations WHERE id=${this.#owner.deploymentId}`;
  assert(sha(bytes(operation.checkpointJson))===point.metadataSha256,'ONLINE_ORIGINAL_QUALIFICATION_POINT_CHANGED');
  const [epoch]=await this.#database.$queryRaw`SELECT generation FROM online_serving_epochs ORDER BY generation DESC LIMIT 1`;
  assert(Number.isSafeInteger(epoch?.generation)&&epoch.generation>=1,'ONLINE_ORIGINAL_PREDECESSOR_EPOCH_REQUIRED');
  const current=this.#releases.get(this.#currentServingReleaseId);assert(current,'ONLINE_ORIGINAL_SOURCE_RELEASE_REQUIRED');
  const evidence=require('./online-release-host-kernel.cjs').readOnlineReleaseEvidence(current.input.evidenceDirectory,current.input);evidence.revalidate();
  const request={format:'sabalan-original-online-qualification-request/v1',sequence:1,deploymentId:this.#owner.deploymentId,
   releaseId:this.#owner.releaseId,targetCommit:operation.targetCommit,generation:epoch.generation+1,database:capture.plan.database,
   checkpoint:operation.checkpointJson,roots:structuredClone(evidence.manifest.roots),ephemeralRoots:structuredClone(evidence.manifest.ephemeralRoots),
   liveCoverage:structuredClone(liveCoverage)};
  capture.qualificationRequest=structuredClone(request);return request;
 }
 async prepareOriginalBootstrapMaterial({evidenceDirectory,manifestSha256,acceptanceSha256}){
  await this.assertOwned(['MIGRATIONS_APPLIED','RELEASE_STARTED']);
  assert(this.#bootstrapObservation&&!this.#accepted&&!this.#bootstrap,'ONLINE_ORIGINAL_BOOTSTRAP_OBSERVATION_REQUIRED');
  const kernel=require('./online-release-host-kernel.cjs'),origin=kernel.openTrustedOnlineQualification(evidenceDirectory,{manifestSha256,acceptanceSha256});
  const accepted=kernel.readOnlineReleaseEvidence(evidenceDirectory,{manifestSha256,acceptanceSha256}),observed=this.#bootstrapObservation;
  const request=await this.observeProtectedBootstrapQualificationRequest();
  assert(sha(bytes(request))===sha(bytes(observed.request))&&this.#bootstrapObservation.coordinationHost===observed.coordinationHost,
   'ONLINE_BOOTSTRAP_ORIGINAL_REQUEST_CHANGED');
  assert(accepted.manifest.releaseId===request.releaseId&&accepted.manifest.sourceCommit===request.targetCommit
   &&accepted.acceptance.deploymentId===request.deploymentId&&accepted.acceptance.checkpointSha256===sha(bytes(request.checkpoint))
   &&sha(bytes(accepted.manifest.roots))===sha(bytes(request.roots))&&sha(bytes(accepted.manifest.ephemeralRoots))===sha(bytes(request.ephemeralRoots))
   &&sha(bytes(accepted.acceptance.qualification.deploymentTargetDatabase))===sha(bytes(request.database)),'ONLINE_BOOTSTRAP_PACKAGE_TARGET_CHANGED');
  const [counts]=await this.#database.$queryRaw`SELECT (SELECT count(*)::int FROM online_releases) AS releases,
   (SELECT count(*)::int FROM online_serving_epochs) AS epochs`;
  assert(counts?.releases===0&&counts.epochs===0,'ONLINE_BOOTSTRAP_REGISTRY_NOT_EMPTY');origin.revalidate();accepted.revalidate();
  const coordinationHost=observed.coordinationHost,coordinationRuntime='/app/recovery-coordination',trust=path.join(path.dirname(this.#composeFile),'.deploy-state/online-trust');
  assert(fs.realpathSync(trust)===trust&&(fs.lstatSync(trust).mode&0o777)===0o700,'ONLINE_BOOTSTRAP_TRUST_DIRECTORY_REQUIRED');
  const runtime=file=>coordinationRuntime+'/'+path.relative(coordinationHost,file).split(path.sep).join('/');
  const immutable=(file,value)=>{const raw=Buffer.concat([bytes(value),Buffer.from('\n')]),fd=fs.openSync(file,'wx',0o400);
   try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return {file,raw,sha256:sha(raw)};};
  const namedLock=name=>{const file=path.join(coordinationHost,name);if(!fs.existsSync(file)){const fd=fs.openSync(file,'wx',0o600);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
   const st=fs.lstatSync(file,{bigint:true});assert(st.isFile()&&!st.isSymbolicLink()&&st.uid===0n&&st.nlink===1n&&st.size===0n&&!(st.mode&0o077n)&&fs.realpathSync(file)===file,'ONLINE_BOOTSTRAP_LOCK_UNSAFE');
   return {file:runtime(file),device:String(st.dev),inode:String(st.ino),ownerUid:0};};
  try{
   const gate=namedLock('deployment-write-admission.lock'),interlock=namedLock('deployment-runtime-control.lock'),worker=namedLock('deployment-online-worker.lock');
   const online=path.join(coordinationHost,'online');if(!fs.existsSync(online))fs.mkdirSync(online,{mode:0o700});
   assert(fs.realpathSync(online)===online&&(fs.lstatSync(online).mode&0o777)===0o700,'ONLINE_BOOTSTRAP_ONLINE_DIRECTORY_UNSAFE');
   for(const name of ['native','work']){const file=path.join(online,name);if(!fs.existsSync(file))fs.mkdirSync(file,{mode:0o700});
    assert(fs.realpathSync(file)===file&&(fs.lstatSync(file).mode&0o777)===0o700&&fs.readdirSync(file).length===0,'ONLINE_BOOTSTRAP_PRIOR_RUNTIME_UNPROVEN');}
   const admission=path.join(online,'admission');fs.mkdirSync(admission,{mode:0o700});fs.mkdirSync(path.join(admission,'staging'),{mode:0o700});
   const definition=immutable(path.join(admission,'scope.json'),{format:'sabalan-online-admission-scope/v1',gate,interlock,worker,database:accepted.manifest.database});
   immutable(path.join(admission,'00000000.json'),{format:'sabalan-online-capture-admission/v1',generation:0,phase:'OPEN',previousSha256:null,capture:null,closureSha256:null});
   const scopes=[];
   for(const purpose of ['http','http','jobs']){
    const runtimeId=randomBytes(32).toString('hex'),nativeDirectory=path.join(online,'native',runtimeId),boundaryDirectory=path.join(online,'work',runtimeId);
    fs.mkdirSync(nativeDirectory,{mode:0o700});fs.mkdirSync(boundaryDirectory,{mode:0o700});const fd=fs.openSync(path.join(nativeDirectory,'deployment-runtime-control.lock'),'wx',0o600);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    const scope={format:'sabalan-online-runtime-scope/v2',runtimeId,releaseId:request.releaseId,manifestSha256:accepted.manifest.runtimeBundleSha256,
     sourceCommit:accepted.manifest.sourceCommit,image:accepted.manifest.image,nonce:randomBytes(32).toString('hex'),purpose,role:purpose==='http'?'serving':'control',
     coordinationDirectory:coordinationRuntime,nativeDirectory:runtime(nativeDirectory),boundaryDirectory:runtime(boundaryDirectory),gate,interlock,worker:purpose==='http'?null:worker,
     database:accepted.manifest.database,admission:{directory:runtime(admission),scopeSha256:definition.sha256}};
    const namespace={runtimeId,image:scope.image,registrySha256:scope.manifestSha256,generation:accepted.manifest.generation,
     postgresApplicationName:'sabalan-rt-'+sha(Buffer.from(runtimeId,'ascii')).slice(0,48),gate:{device:gate.device,inode:gate.inode,ownerUid:gate.ownerUid}};
    const provisionFile=path.join(boundaryDirectory,'scope.json'),provisionFd=fs.openSync(provisionFile,'wx',0o600);
    try{fs.writeFileSync(provisionFd,Buffer.concat([bytes({format:'sabalan-runtime-namespace/v1',scope:namespace}),Buffer.from('\n')]));fs.fsyncSync(provisionFd);}finally{fs.closeSync(provisionFd);}
    const saved=immutable(path.join(trust,runtimeId+'.json'),scope);scopes.push({file:saved.file,sha256:saved.sha256,scope});
   }
   origin.revalidate();accepted.revalidate();return {registration:{evidenceDirectory,manifestSha256,acceptanceSha256,previousReleaseId:null,scopes},
    paths:{coordinationDirectory:coordinationHost,publicationDirectory:this.#publicationDirectory},httpRuntimes:scopes.filter(row=>row.scope.purpose==='http').map(row=>({runtimeId:row.scope.runtimeId})),
    jobsRuntimeId:scopes.find(row=>row.scope.purpose==='jobs').scope.runtimeId};
  }catch(error){this.#held='ONLINE_ORIGINAL_BOOTSTRAP_MATERIAL_UNPROVEN';throw error;}
 }
 async prepareOriginalOnlineMaterial({runtimeId,evidenceDirectory,manifestSha256,acceptanceSha256}){
  await this.assertOwned(['ONLINE_CHECKPOINTING']);const capture=this.#checkpointCaptures.get(runtimeId),request=capture?.qualificationRequest;
  assert(request&&capture.publication?.committed&&!this.#preparedInputs.has(this.#owner.releaseId),'ONLINE_ORIGINAL_QUALIFICATION_REQUEST_REQUIRED');
  await this.readOriginalContinuousCheckpointContext(runtimeId);
  const kernel=require('./online-release-host-kernel.cjs'),origin=kernel.openTrustedOnlineQualification(evidenceDirectory,{manifestSha256,acceptanceSha256});
  const accepted=kernel.readOnlineReleaseEvidence(evidenceDirectory,{manifestSha256,acceptanceSha256});origin.revalidate();accepted.revalidate();
  assert(accepted.acceptance.qualification.recoveryMode==='ONLINE_COHERENT_WAL'&&accepted.manifest.releaseId===request.releaseId
   &&accepted.manifest.sourceCommit===request.targetCommit&&accepted.manifest.generation===request.generation
   &&accepted.acceptance.deploymentId===request.deploymentId&&accepted.acceptance.checkpointSha256===sha(bytes(request.checkpoint))
   &&sha(bytes(accepted.manifest.roots))===sha(bytes(request.roots))&&sha(bytes(accepted.manifest.ephemeralRoots))===sha(bytes(request.ephemeralRoots))
   &&sha(bytes(accepted.acceptance.qualification.deploymentTargetDatabase))===sha(bytes(request.database)),'ONLINE_ORIGINAL_PACKAGE_TARGET_CHANGED');
  const plan=capture.plan,trust=path.dirname(plan.scopeFile);
  const host=file=>{const relative=path.posix.relative(plan.coordinationRuntime,file);assert(relative&&!relative.startsWith('../')&&!path.posix.isAbsolute(relative),'ONLINE_MATERIAL_COORDINATION_ESCAPE');return path.join(plan.coordinationHost,relative);};
  const scopes=[];
  try{for(const purpose of ['http','http','jobs']){
   const id=randomBytes(32).toString('hex'),scope={...structuredClone(capture.scope),runtimeId:id,releaseId:request.releaseId,
    manifestSha256:accepted.manifest.runtimeBundleSha256,sourceCommit:accepted.manifest.sourceCommit,image:accepted.manifest.image,
    nonce:randomBytes(32).toString('hex'),purpose,role:purpose==='http'?'serving':'control',worker:purpose==='http'?null:structuredClone(capture.scope.worker),
    nativeDirectory:capture.scope.coordinationDirectory+'/online/native/'+id,boundaryDirectory:capture.scope.coordinationDirectory+'/online/work/'+id};
   for(const directory of [scope.nativeDirectory,scope.boundaryDirectory])fs.mkdirSync(host(directory),{mode:0o700});
   const lock=fs.openSync(host(scope.nativeDirectory+'/deployment-runtime-control.lock'),'wx',0o600);try{fs.fsyncSync(lock);}finally{fs.closeSync(lock);}
   const namespace={format:'sabalan-runtime-namespace/v1',scope:{runtimeId:id,image:scope.image,registrySha256:scope.manifestSha256,generation:accepted.manifest.generation,
    postgresApplicationName:'sabalan-rt-'+sha(Buffer.from(id,'ascii')).slice(0,48),gate:{device:scope.gate.device,inode:scope.gate.inode,ownerUid:scope.gate.ownerUid}}};
   for(const [file,value,mode]of [[host(scope.boundaryDirectory+'/scope.json'),namespace,0o600],[path.join(trust,id+'.json'),scope,0o400]]){
    const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,Buffer.concat([bytes(value),Buffer.from('\n')]));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   }
   const file=path.join(trust,id+'.json'),raw=readPrivate(file,16384,0o400).data;scopes.push({scope,file,sha256:sha(raw)});
  }
  const registration={evidenceDirectory,manifestSha256,acceptanceSha256,previousReleaseId:this.#currentServingReleaseId,scopes};
  capture.qualificationMaterial=structuredClone(registration);return {registration,httpRuntimes:scopes.filter(row=>row.scope.purpose==='http').map(row=>({runtimeId:row.scope.runtimeId})),jobsRuntimeId:scopes.find(row=>row.scope.purpose==='jobs').scope.runtimeId};
  }catch(error){this.#held='ONLINE_ORIGINAL_RELEASE_MATERIAL_UNPROVEN';throw error;}
 }
 async prepareOriginalFinishContext(runtimeId){
  const context=await this.readOriginalContinuousCheckpointContext(runtimeId);
  await this.assertOwned(['ONLINE_SERVING','ONLINE_ROLLBACK_PUBLISHING']);
  assert(this.#currentServingReleaseId&&this.#lastPublicationSha,'ONLINE_ORIGINAL_PUBLICATION_REQUIRED');
  const jobs=[...this.#children.values()].filter(value=>value.scope.purpose==='jobs');
  assert(jobs.some(value=>value.scope.releaseId===this.#currentServingReleaseId&&!value.closed&&value.events.some(event=>event.event==='READY'))
   &&jobs.filter(value=>value.scope.releaseId!==this.#currentServingReleaseId).every(value=>value.closed&&value.nativeClosureVerified),
    'ONLINE_ORIGINAL_JOBS_HANDOFF_NOT_COMPLETE');
  const rows=await this.#database.$queryRaw`SELECT id,"releaseId","publicationSha256",generation FROM online_serving_epochs WHERE "releaseId"=${this.#currentServingReleaseId}
    AND "publicationSha256"=${this.#lastPublicationSha} AND "retiredAt" IS NULL`;
  assert(rows.length===1,'ONLINE_ORIGINAL_CURRENT_EPOCH_CHANGED');
  return {context,terminalReady:true,terminalReleaseId:this.#currentServingReleaseId,terminalEpochSha256:sha(bytes(rows[0]))};
 }
 async finishCycle(input){
  const terminal=await this.prepareOriginalFinishContext(input?.runtimeId),audit=input?.terminalAudit;
  assert(audit?.format==='sabalan-original-terminal-wal-coverage/v1'&&audit.phase==='COMPLETE'
   &&audit.finalIntervalCompletion===true&&audit.allOriginalChildrenClosed===true&&audit.captureId===this.#checkpointCaptures.get(input.runtimeId)?.captureId
   &&audit.terminalEpochSha256===terminal.terminalEpochSha256&&audit.terminalReleaseId===terminal.terminalReleaseId
   &&audit.publicationSha256===this.#lastPublicationSha&&audit.terminalPhase===terminal.context.phase,'ONLINE_ORIGINAL_TERMINAL_WAL_REQUIRED');
  const capture=this.#checkpointCaptures.get(input.runtimeId),publication=capture.publication;assert(publication?.committed,'ONLINE_TERMINAL_CERTIFIED_POINT_REQUIRED');
  const repository=publication.metadata.repositoryDirectory,key=readPrivate('/etc/sabalan/online/qualification-public-key.pem',4096,0o444);
  assert(sha(key.data)==='e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48','ONLINE_TERMINAL_TRUST_CHANGED');
  const mountedTerminal=JSON.parse(await readMountedOriginalCheckpointFile(repository,'terminal-coverage.json'));
  assert(mountedTerminal.format==='sabalan-accepted-online-terminal-coverage/v1'&&sha(bytes(mountedTerminal.envelope))===sha(bytes(input.terminalCertificate)),'ONLINE_TERMINAL_REMOTE_ACK_REQUIRED');
  const pointRaw=await readMountedOriginalCheckpointFile(repository,'point.json');
  verifyOriginalTerminalCheckpointCoverage(input.terminalCertificate,key.data,audit,publication.metadata,sha(pointRaw));
  const {PrismaDeploymentStore,finishDeployment}=require('./online-release-host-kernel.cjs');
  const phase=this.#currentServingReleaseId===this.#owner.releaseId?'COMPLETED':'ROLLED_BACK';
  await finishDeployment(new PrismaDeploymentStore(this.#database),{...this.#owner,phase,now:new Date()});
  clearInterval(this.#heartbeat);this.#heartbeat=null;
  return {deploymentId:this.#owner.deploymentId,phase,originalApplicationHandlesRetained:true,terminalWalAuditSha256:sha(bytes(audit))};
 }
 readCarrierProvisioningTarget(){
  assert(!this.#held,'ONLINE_ORIGINAL_CONTROLLER_HELD');this.#lock.assertOwned();
  const onlineOverlayFile=path.join(path.dirname(this.#composeFile),'docker-compose.online.yml');
  assert(fs.realpathSync(onlineOverlayFile)===onlineOverlayFile,'ONLINE_APPROVED_OVERLAY_CHANGED');
  const storageOverlayFile=path.join(path.dirname(this.#composeFile),'docker-compose.online-storage.yml');
  assert(fs.realpathSync(storageOverlayFile)===storageOverlayFile,'ONLINE_APPROVED_STORAGE_OVERLAY_CHANGED');
  return Object.freeze({composeFile:this.#composeFile,onlineOverlayFile,storageOverlayFile,project:this.#project,backendService:'backend',frontendService:'frontend'});
 }
 readCarrierReleaseEvidence(releaseId){
  assert(!this.#held,'ONLINE_ORIGINAL_CONTROLLER_HELD');this.#lock.assertOwned();
  const input=this.#releases.get(releaseId)?.input??this.#preparedInputs.get(releaseId);
  assert(input,'ONLINE_ORIGINAL_RELEASE_EVIDENCE_NOT_REGISTERED');
  const accepted=require('./online-release-host-kernel.cjs').readOnlineReleaseEvidence(input.evidenceDirectory,input);
  accepted.revalidate();return Object.freeze({manifest:accepted.manifest,browserRegistries:accepted.browserRegistries,
   deploymentTargetImages:structuredClone(accepted.acceptance.qualification.deploymentTargetImages),
   imageGraphs:structuredClone(accepted.acceptance.qualification.imageGraphs),
   componentSourceCommits:structuredClone(accepted.acceptance.qualification.componentSourceCommits),
   scopes:Object.freeze(input.scopes.map(value=>Object.freeze({...value,scope:Object.freeze(structuredClone(value.scope))})))});
 }
 readInquiryReleaseEvidence(releaseId){
  const evidence=OriginalOnlineReleaseController.prototype.readCarrierReleaseEvidence.call(this,releaseId);
  const image=evidence.deploymentTargetImages?.inquiry,imageGraph=evidence.imageGraphs?.inquiry,sourceCommit=evidence.componentSourceCommits?.inquiry;
  assert(/^sha256:[a-f0-9]{64}$/.test(image)&&/^[a-f0-9]{40}$/.test(sourceCommit)&&imageGraph?.config===image,'ONLINE_ORIGINAL_INQUIRY_COMPONENT_UNPROVEN');
  const target=this.#releases.get(releaseId)?.input??this.#preparedInputs.get(releaseId),accepted=require('./online-release-host-kernel.cjs').readOnlineReleaseEvidence(target.evidenceDirectory,target);
  const descriptor=accepted.evidenceInventory.find(row=>row.file==='coherent-independent-restore-source.json');assert(descriptor,'ONLINE_INQUIRY_ORIGINAL_RESTORE_SOURCE_REQUIRED');
  const raw=readPrivate(path.join(target.evidenceDirectory,descriptor.file),8*1024*1024,0o400).data;assert(raw.length===descriptor.bytes&&sha(raw)===descriptor.sha256,'ONLINE_INQUIRY_RESTORE_SOURCE_CHANGED');
  const closure=JSON.parse(raw).inquiryNativeClosure,native=closure?.closure?.nativeRawBase64&&JSON.parse(Buffer.from(closure.closure.nativeRawBase64,'base64'));
  assert(closure?.closure?.originalReturncode===128&&native?.phase==='QUIESCENT'&&native.nativeStatus===143&&native.sqliteNativeClosed===true&&native.nativeReaped===true
   &&native.onlineScope.scope.image===image&&native.onlineScope.scope.sourceCommit===sourceCommit&&/^[a-f0-9]{64}$/.test(native.onlineScope.scope.manifestSha256),'ONLINE_INQUIRY_ORIGINAL_IMAGE_RUNTIME_UNPROVEN');
  accepted.revalidate();return Object.freeze({manifest:evidence.manifest,scopes:[...(this.#inquiryScopes.get(releaseId)||[])].map(row=>({file:row.file,sha256:row.sha256,scope:structuredClone(row.scope)})),component:Object.freeze({image,sourceCommit,imageGraph,runtimeBundleSha256:native.onlineScope.scope.manifestSha256}),browserRegistries:evidence.browserRegistries});
 }
 async executeOriginalInquiryCarrierDockerCommand(command){
  await this.assertOwned(['ONLINE_CHECKPOINTING','ONLINE_EXPANDING','ONLINE_ACCEPTING','ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING']);
  return this.#executeOriginalCarrierCommand(consumeOriginalInquiryCarrierDockerCommand(this,command));
 }
 retainOriginalInquiryCarrierFailure(token){
  const facts=consumeOriginalInquiryCarrierFailure(this,token);this.#carrierFailures.push(facts);
  this.#held='ORIGINAL_INQUIRY_CARRIER_PROVISIONING_UNPROVEN';return structuredClone(facts);
 }
 async readOriginalInquiryNativeCapability(token){
  const row=this.#inquiryActors.get(token);
  assert(row&&!this.#held&&!row.closed&&row.ready&&row.child.exitCode===null&&row.child.signalCode===null,'ONLINE_ORIGINAL_INQUIRY_READY_REQUIRED');
  const probe=String.raw`import json,os,sys;from pathlib import Path
p=Path(sys.argv[1]);v=json.loads(p.read_bytes());g=v['guardian'];assert v['phase']=='ACTIVE';s=Path('/proc/'+str(g['pid'])+'/stat').read_text().rsplit(') ',1)[1].split();assert s[0]!='Z' and s[19]==g['startTicks'] and os.readlink('/proc/'+str(g['pid'])+'/ns/pid')==g['pidNamespace'] and Path('/proc/sys/kernel/random/boot_id').read_text().strip()==g['bootId'];print(json.dumps(v))`;
  const native=JSON.parse(await this.#docker(['exec',row.containerId,'/usr/bin/python3','-I','-B','-c',probe,path.posix.join(row.scope.nativeDirectory,'deployment-runtime-native.json')]));
  assert(sha(bytes(native))===sha(bytes(row.started.native)),'ONLINE_ORIGINAL_INQUIRY_ACTIVE_CHANGED');
  return structuredClone(row.ready);
 }
 async prepareInquiryRuntime({releaseId=this.#owner.releaseId,buildId}){
  await this.assertOwned();
  const target=this.#releases.get(releaseId);assert(target,'ONLINE_INQUIRY_REGISTERED_RELEASE_REQUIRED');
  const evidence=this.readInquiryReleaseEvidence(releaseId),builds=evidence.browserRegistries.flatMap(row=>row.builds).filter(row=>row.application==='inquiry'&&row.id===buildId);
  const runtimeBundleSha256=evidence.component.runtimeBundleSha256;
  assert(builds.length>0,'ONLINE_INQUIRY_QUALIFIED_BROWSER_REQUIRED');
  const template=target.input.scopes.find(row=>row.scope.purpose==='http');assert(template,'ONLINE_INQUIRY_COMMON_SCOPE_REQUIRED');
  const backendToken=this.#carriers.get('backend_'+template.scope.runtimeId);assert(backendToken,'ONLINE_INQUIRY_COMMON_CARRIER_REQUIRED');
  const backend=await readOriginalOnlineCarrier(this,backendToken),coordinate=backend.mounts.find(row=>row.target===template.scope.coordinationDirectory&&!row.readOnly);
  const trust=backend.mounts.find(row=>row.target==='/run/sabalan-online'&&row.readOnly&&row.type==='bind');
  const [inspected]=JSON.parse(await this.#docker(['inspect',backend.containerId]));
  const mounted=inspected.Mounts.find(row=>row.Destination===template.scope.coordinationDirectory&&row.RW);
  assert(coordinate&&trust&&mounted&&mounted.Type==='volume'&&mounted.Name===coordinate.source&&fs.realpathSync(mounted.Source)===mounted.Source&&fs.realpathSync(trust.source)===trust.source,'ONLINE_INQUIRY_SHARED_MOUNTS_REQUIRED');
  const host=runtime=>{const relative=path.posix.relative(template.scope.coordinationDirectory,runtime);assert(relative&&!relative.startsWith('..')&&!path.posix.isAbsolute(relative),'ONLINE_INQUIRY_PATH_ESCAPE');return path.join(mounted.Source,...relative.split('/'));};
  for(const lock of [template.scope.gate,template.scope.interlock]){const file=host(lock.file),st=fs.lstatSync(file,{bigint:true});
   assert(fs.realpathSync(file)===file&&st.isFile()&&st.uid===0n&&st.nlink===1n&&st.size===0n&&!(st.mode&0o022n)&&String(st.dev)===lock.device&&String(st.ino)===lock.inode,'ONLINE_INQUIRY_COMMON_LOCK_CHANGED');}
  const runtimeId=randomBytes(32).toString('hex'),scope={...structuredClone(template.scope),runtimeId,releaseId,image:evidence.component.image,sourceCommit:evidence.component.sourceCommit,
   manifestSha256:runtimeBundleSha256,nonce:randomBytes(32).toString('hex'),purpose:'http',role:'serving',worker:null,
   nativeDirectory:template.scope.coordinationDirectory+'/online/native/'+runtimeId,boundaryDirectory:template.scope.coordinationDirectory+'/online/work/'+runtimeId};
  const save=(file,raw,mode=0o400)=>{const fd=fs.openSync(file,'wx',mode);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}};
  try{
   for(const runtime of [scope.nativeDirectory,scope.boundaryDirectory]){const parent=path.dirname(host(runtime)),st=fs.lstatSync(parent);assert(fs.realpathSync(parent)===parent&&st.isDirectory()&&st.uid===0&&!(st.mode&0o077),'ONLINE_INQUIRY_NAMESPACE_PARENT_UNSAFE');fs.mkdirSync(host(runtime),{mode:0o700});}
   save(path.join(host(scope.nativeDirectory),'deployment-runtime-control.lock'),Buffer.alloc(0),0o600);
   const generation=evidence.manifest.generation;assert(Number.isSafeInteger(generation)&&generation>=1,'ONLINE_INQUIRY_GENERATION_REQUIRED');
   const journal={runtimeId,image:scope.image,registrySha256:scope.manifestSha256,generation,gate:{device:scope.gate.device,inode:scope.gate.inode,ownerUid:scope.gate.ownerUid},postgresApplicationName:'sabalan-rt-'+sha(Buffer.from(runtimeId,'ascii')).slice(0,48)};
   save(path.join(host(scope.boundaryDirectory),'scope.json'),Buffer.concat([bytes({format:'sabalan-runtime-namespace/v1',scope:journal}),Buffer.from('\n')]),0o600);
   const raw=Buffer.concat([bytes(scope),Buffer.from('\n')]),file=path.join(trust.source,runtimeId+'.json');save(file,raw);
   const enrolled={scope,file,sha256:sha(raw),runtimeFile:'/run/sabalan-online/'+runtimeId+'.json',buildId,generation,hostNativeDirectory:host(scope.nativeDirectory)};
   const rows=this.#inquiryScopes.get(releaseId)||[];rows.push(enrolled);this.#inquiryScopes.set(releaseId,rows);
   return {runtimeId,releaseId,scopeSha256:enrolled.sha256,prepared:true,publicTrafficPublished:false};
  }catch(error){this.#held='ONLINE_ORIGINAL_INQUIRY_SCOPE_UNPROVEN';throw error;}
 }
 async startInquiryRuntime({runtimeId,releaseId=this.#owner.releaseId}){
  await this.assertOwned();const enrolled=this.#inquiryScopes.get(releaseId)?.find(row=>row.scope.runtimeId===runtimeId);
  assert(enrolled&&![...this.#inquiryActors.values()].some(row=>row.scope.runtimeId===runtimeId),'ONLINE_ORIGINAL_INQUIRY_SCOPE_REQUIRED');
  const token=await provisionOriginalInquiryCarrier(this,{releaseId,buildId:enrolled.buildId,scope:enrolled.scope,scopeFile:enrolled.file,scopeSha256:enrolled.sha256});
  const facts=await readProvisionedInquiryCarrier(this,token),session=randomBytes(32).toString('hex');
  const sourceFile=fileURLToPath(new URL('./online-inquiry-inner-controller.py',import.meta.url)),source=fs.readFileSync(sourceFile,'utf8'),sourceSha256=sha(Buffer.from(source));
  await this.#composePs();
  const child=spawn('docker',['exec','-i',facts.containerId,'/usr/bin/python3','-I','-B','-c',source,enrolled.runtimeFile,enrolled.sha256,session],{stdio:['pipe','pipe','pipe'],shell:false});
  const state={child,scope:enrolled.scope,scopeSha256:enrolled.sha256,session,sequence:0,closed:false,code:null,signal:null,events:[],pending:'',outputBytes:0,
   containerId:facts.containerId,image:facts.image,startedAt:facts.startedAt,carrier:token,sourceFile,sourceSha256,ready:null,nativeClosureVerified:false};this.#inquiryActors.set(token,state);
  child.once('error',()=>{this.#held='ONLINE_ORIGINAL_INQUIRY_SPAWN_UNKNOWN';});child.stdin.on('error',()=>{this.#held='ONLINE_ORIGINAL_INQUIRY_PIPE_UNKNOWN';});
  child.stdout.on('data',chunk=>{state.outputBytes+=chunk.length;if(state.outputBytes>8388608){this.#held='ONLINE_ORIGINAL_INQUIRY_OUTPUT_BOUND';return;}
   state.pending+=chunk.toString();for(let split;(split=state.pending.indexOf('\n'))>=0;){const line=state.pending.slice(0,split);state.pending=state.pending.slice(split+1);
    try{const event=JSON.parse(line);state.events.push(event);if(event.event==='ACTOR_STARTED')state.started=event;if(event.event==='HELD')this.#held='ONLINE_ORIGINAL_INQUIRY_INNER_HELD';}catch{this.#held='ONLINE_ORIGINAL_INQUIRY_FRAME_INVALID';}}});
  child.stderr.on('data',chunk=>{state.outputBytes+=chunk.length;if(state.outputBytes>8388608)this.#held='ONLINE_ORIGINAL_INQUIRY_OUTPUT_BOUND';});
  child.once('close',(code,signal)=>{state.closed=true;state.code=code;state.signal=signal;if(state.pending)this.#held='ONLINE_ORIGINAL_INQUIRY_TRAILING_BYTES';});
  await this.#send(state,'START',{host:facts.privateAddress,port:3001,runtimeBundleSha256:enrolled.scope.manifestSha256,generation:enrolled.generation,sqlite:facts.sqlite});
  while(!state.started||!state.events.some(row=>row.event==='READY')){assert(!this.#held&&!state.closed,'ONLINE_ORIGINAL_INQUIRY_NOT_READY');await new Promise(resolve=>setTimeout(resolve,25));}
  const ready=state.events.find(row=>row.event==='READY'),active=JSON.parse(Buffer.from(ready.nativeRawBase64,'base64'));
  assert(state.started.originalPid===state.started.guardian.pid&&sha(bytes(active))===sha(bytes(state.started.native))
   &&active.phase==='ACTIVE'&&active.onlineScope.sha256===enrolled.sha256&&sha(bytes(active.onlineScope.scope))===sha(bytes(enrolled.scope))
   &&JSON.parse(Buffer.from(ready.workRawBase64,'base64')).phase==='QUIESCENT'&&ready.host===facts.privateAddress&&ready.port===3001
   &&sha(fs.readFileSync(sourceFile))===sourceSha256,'ONLINE_ORIGINAL_INQUIRY_READY_CHANGED');
  state.ready={runtimeId,containerId:facts.containerId,image:facts.image,originalReady:true,sqlite:facts.sqlite,guardian:state.started.guardian,originalDockerCliPid:child.pid};
  await readOriginalInquiryCarrier(this,token);if(this.#edge)await this.appendOriginalCarrierEndpoints();
  return {runtimeId,originalReady:true,publicTrafficPublished:false};
 }
 async readOriginalCheckpointInquirySource(){
  await this.assertOwned(['ONLINE_CHECKPOINTING']);const live=[];
  for(const [token,state]of this.#inquiryActors){if(state.closed)continue;const facts=await readOriginalInquiryCarrier(this,token);live.push(facts);}
  assert(live.length>0,'ONLINE_ORIGINAL_INQUIRY_CAPTURE_SOURCE_REQUIRED');
  const sqlite=live[0].sqlite;assert(live.every(row=>sha(bytes(row.sqlite))===sha(bytes(sqlite))),'ONLINE_ORIGINAL_INQUIRY_SQLITE_SOURCE_CHANGED');
  return {inquiry:{path:sqlite.file,device:sqlite.device,inode:sqlite.inode},inquiryRuntimeIds:live.map(row=>row.runtimeId).sort()};
 }
 async stopInquiryRuntime(runtimeId){
  await this.assertOwned();const state=[...this.#inquiryActors.values()].find(row=>row.scope.runtimeId===runtimeId);
  assert(state?.ready&&!state.closed,'ONLINE_ORIGINAL_INQUIRY_NOT_ACTIVE');
  const publication=await this.#store.readPublication();
  assert(publication.registry.builds.filter(build=>build.application==='inquiry'&&build.slotId==='inquiry_'+runtimeId).every(build=>this.#expiredBuildFences.get(build.id)?.quiescent),'ONLINE_REFERENCED_INQUIRY_RETIREMENT_REFUSED');
  await this.readOriginalInquiryNativeCapability(state.carrier);await this.#send(state,'STOP');
  while(!state.events.some(row=>row.event==='CLOSED')){assert(!this.#held&&!state.closed,'ONLINE_ORIGINAL_INQUIRY_STOP_UNPROVEN');await new Promise(resolve=>setTimeout(resolve,25));}
  const proof=state.events.find(row=>row.event==='CLOSED');assert(proof.allOriginalChildrenClosed&&proof.originalReturncode===128&&proof.requestedStop==='SIGTERM'
   &&proof.native.nativeStatus===143&&proof.native.sqliteNativeClosed===true&&proof.native.nativeReaped===true&&proof.native.stoppedBySignal===true
   &&proof.native.phase==='QUIESCENT'&&proof.native.activeClaimSha256===sha(Buffer.from(proof.activeRawBase64,'base64'))
   &&sha(bytes(proof.native.guardian))===sha(bytes(state.started.guardian))&&JSON.parse(Buffer.from(proof.workRawBase64,'base64')).phase==='QUIESCENT','ONLINE_ORIGINAL_INQUIRY_CLOSURE_UNPROVEN');
  await this.#send(state,'ACK_CLOSED');state.child.stdin.end();while(!state.closed)await new Promise(resolve=>setTimeout(resolve,25));
  assert(state.code===0&&state.signal===null&&!state.pending&&sha(fs.readFileSync(state.sourceFile))===state.sourceSha256,'ONLINE_ORIGINAL_INQUIRY_CONTROLLER_NOT_CLOSED');
  state.nativeClosureVerified=true;state.proof=proof;return {runtimeId,originalControllerStatus:0,nativeStatus:143,sqliteNativeClosed:true};
 }
 async readBootstrapLegacyBrowserSource(){
  await this.assertOwned(['MIGRATIONS_APPLIED','RELEASE_STARTED']);
  assert(this.#bootstrap&&!this.#bootstrap.finalized&&this.#bootstrapLegacy?.source,'ONLINE_ORIGINAL_LEGACY_SOURCE_REQUIRED');
  return readOriginalBootstrapLegacyBrowserSource(this,this.#bootstrapLegacy.source);
 }
 async executeOriginalCarrierDockerCommand(command){
  await this.assertOwned(['ONLINE_CHECKPOINTING','ONLINE_EXPANDING','ONLINE_ACCEPTING','ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING']);
  return this.#executeOriginalCarrierCommand(consumeOriginalCarrierDockerCommand(this,command));
 }
 async #executeOriginalCarrierCommand(args){
  if(args[0]!=='create')return this.#docker(args);
  const original=this.#withOriginalCarrierCensus(async()=>{const raw=await this.#docker(args),id=raw.trim();assert(/^[a-f0-9]{64}$/.test(id),'ONLINE_ORIGINAL_CREATED_ID_REQUIRED');this.#originalCreatedCarrierIds.add(id);return raw;});
  this.#originalCarrierCreates.add(original);
  try{return await original;}catch(error){this.#held='ONLINE_ORIGINAL_CARRIER_CREATE_UNPROVEN';throw error;}
  finally{this.#originalCarrierCreates.delete(original);}
 }
 async #withOriginalCarrierCensus(action){
  const previous=this.#originalCarrierCensusTail;let release;this.#originalCarrierCensusTail=new Promise(resolve=>{release=resolve;});await previous;
  try{return await action();}finally{release();}
 }
 async provisionCarriers(input){
  const result=await provisionOriginalOnlineReleaseCarriers(this,input);
  for(const token of [...result.backends,result.frontend]){const facts=await readOriginalOnlineCarrier(this,token);
   assert(!this.#carriers.has(facts.slotId),'ONLINE_ORIGINAL_CARRIER_ALREADY_ENROLLED');this.#carriers.set(facts.slotId,token);}
  if(this.#edge)await this.appendOriginalCarrierEndpoints();return result;
 }
 async appendOriginalCarrierEndpoints(){
  await this.assertOwned();assert(this.#edge&&!this.#edge.closed,'ONLINE_ORIGINAL_EDGE_REQUIRED');
  const endpoints={ui:[],backend:[]};
  for(const token of this.#carriers.values()){
   const facts=await readOriginalOnlineCarrier(this,token);
   const endpoint={slotId:facts.slotId,host:facts.dnsAlias,port:facts.kind==='frontend'?3000:5000,image:facts.image};
   if(facts.kind==='frontend')endpoints.ui.push(endpoint);
   else {const release=this.#releases.get(facts.releaseId),scope=release?.input.scopes.find(row=>row.scope.runtimeId===facts.runtimeId)?.scope;
    assert(scope,'ONLINE_ORIGINAL_CARRIER_SCOPE_REQUIRED');endpoints.backend.push({...endpoint,manifestSha256:scope.manifestSha256});}
  }
  for(const [token,state]of this.#inquiryActors){if(state.closed||!state.ready)continue;
   const facts=await readOriginalInquiryCarrier(this,token);endpoints.ui.push({slotId:facts.slotId,host:facts.dnsAlias,port:3001,image:facts.image});
  }
  const before=this.#edge.sequence;await this.#send(this.#edge,'APPEND_ENDPOINTS',endpoints);
  await this.#awaitEdge('ENDPOINTS_APPENDED',before+1);return {originalEndpointsAppended:true};
 }
 async startCommonEdge({applicationsByHost}){
  await this.assertOwned();assert(!this.#edge&&this.#accepted,'ONLINE_ORIGINAL_EDGE_ALREADY_STARTED');
  assert(applicationsByHost&&Object.values(applicationsByHost).includes('erp')&&Object.values(applicationsByHost).includes('inquiry')
   &&Object.keys(applicationsByHost).every(host=>/^[a-z0-9.-]+(?::[0-9]+)?$/.test(host))
   &&Object.values(applicationsByHost).every(app=>['erp','inquiry'].includes(app)),'ONLINE_PUBLIC_HOSTS_REQUIRED');
  const listing=await this.#docker(['ps','--filter','label=com.docker.compose.project='+this.#project,'--filter','label=com.docker.compose.service=release-edge','--format','{{.ID}}']);
  const ids=listing.trim().split('\n').filter(Boolean);assert(ids.length===1,'ONLINE_SINGLE_ORIGINAL_EDGE_REQUIRED');
  const [actual]=JSON.parse(await this.#docker(['inspect',ids[0]]));
  assert(actual.Image===this.readCarrierReleaseEvidence(this.#owner.releaseId).manifest.image&&actual.State.Running&&actual.HostConfig.ReadonlyRootfs
   &&!actual.HostConfig.Privileged&&!Object.keys(actual.HostConfig.PortBindings??{}).length,'ONLINE_EDGE_IMMUTABLE_PRIVATE_CONTAINER_REQUIRED');
  const mounts=actual.Mounts;
  assert(mounts.some(m=>m.Destination==='/run/sabalan-publications'&&!m.RW&&m.Source===this.#publicationDirectory)
   &&mounts.some(m=>m.Destination==='/run/sabalan-online'&&!m.RW)
   &&mounts.some(m=>m.Destination==='/app/online-edge'&&m.RW),'ONLINE_EDGE_SCOPED_MOUNTS_REQUIRED');
  const networks=Object.entries(actual.NetworkSettings.Networks);assert(networks.length===1,'ONLINE_EDGE_SINGLE_PROJECT_NETWORK_REQUIRED');
  const [networkName,network]=networks[0];const [networkFacts]=JSON.parse(await this.#docker(['network','inspect',network.NetworkID]));
  assert(networkFacts.Labels?.['com.docker.compose.project']===this.#project&&networkFacts.Name===networkName,'ONLINE_EDGE_PROJECT_NETWORK_REQUIRED');
  const nginxIds=(await this.#docker(['ps','--filter','label=com.docker.compose.project='+this.#project,'--filter','label=com.docker.compose.service=nginx','--format','{{.ID}}'])).trim().split('\n').filter(Boolean);
  assert(nginxIds.length===1,'ONLINE_ORIGINAL_NGINX_REQUIRED');const [nginx]=JSON.parse(await this.#docker(['inspect',nginxIds[0]]));
  const ingress=nginx.NetworkSettings.Networks[networkName];assert(nginx.State.Running&&ingress?.IPAddress,'ONLINE_NGINX_PROJECT_INGRESS_REQUIRED');
  const session=randomBytes(32).toString('hex'),instanceId=randomBytes(32).toString('hex');await this.#composePs();
  const child=spawn('docker',['exec','-i',actual.Id,'/usr/local/bin/node','/app/scripts/online-common-release-edge.mjs',session,instanceId],{stdio:['pipe','pipe','pipe'],shell:false});
  const state={child,session,scopeSha256:instanceId,sequence:0,closed:false,code:null,signal:null,events:[],pending:'',outputBytes:0,containerId:actual.Id,startedAt:actual.State.StartedAt,image:actual.Image,networkId:network.NetworkID};this.#edge=state;
  child.once('error',()=>{this.#held='ORIGINAL_EDGE_SPAWN_UNKNOWN';});
  child.stdout.on('data',data=>{state.outputBytes+=data.length;if(state.outputBytes>8388608){this.#held='ORIGINAL_EDGE_OUTPUT_BOUND';return;}
   state.pending+=data.toString();for(let split;(split=state.pending.indexOf('\n'))>=0;){const raw=state.pending.slice(0,split);state.pending=state.pending.slice(split+1);try{const event=JSON.parse(raw);state.events.push(event);if(event.event==='HELD')this.#held='ORIGINAL_EDGE_HELD';}catch{this.#held='ORIGINAL_EDGE_FRAME_INVALID';}}});
  child.stderr.on('data',data=>{state.outputBytes+=data.length;if(state.outputBytes>8388608)this.#held='ORIGINAL_EDGE_OUTPUT_BOUND';});
  child.once('close',(code,signal)=>{state.closed=true;state.code=code;state.signal=signal;});
  await this.#send(state,'START',{instanceId,host:network.IPAddress,port:3199,publicationDirectory:'/run/sabalan-publications',journalRoot:'/app/online-edge/'+instanceId,
   applicationsByHost,endpoints:{ui:[],backend:[]},trustedProxyIPs:[ingress.IPAddress]});
  await this.#awaitEdge('LISTENING');await this.appendOriginalCarrierEndpoints();
  return {originalEdgeDockerCliPid:child.pid,containerId:actual.Id,privateAddress:network.IPAddress,port:3199,publicAdmissionGranted:false};
 }
 async #assertOriginalUiCarrier(build){
  const token=build&&this.#carriers.get(build.slotId);assert(token,'ONLINE_ORIGINAL_UI_CARRIER_REQUIRED');
  const actual=await readOriginalOnlineCarrier(this,token),qualified=actual.build;
  const semantic=value=>({id:value.id??value.buildId,application:value.application,image:value.image,manifestSha256:value.manifestSha256,assets:value.assets,actionIds:value.actionIds,nativeBuildId:value.nativeBuildId,handoffPolicy:value.handoffPolicy});
  assert(actual.kind==='frontend'&&actual.compiledBytesVerified===true&&actual.slotId===build.slotId
   &&sha(bytes(semantic(qualified)))===sha(bytes(semantic(build))),'ONLINE_ORIGINAL_UI_CARRIER_IDENTITY_CHANGED');
  return actual;
 }
 async #assertOriginalInquiryCarrier(build){
  const entry=[...this.#inquiryActors].find(([,row])=>!row.closed&&row.ready&&'inquiry_'+row.scope.runtimeId===build?.slotId);
  assert(entry,'ONLINE_ORIGINAL_INQUIRY_PUBLICATION_NOT_READY');
  const facts=await readOriginalInquiryCarrier(this,entry[0]);
  const semantic=value=>({id:value.id,application:value.application,image:value.image,manifestSha256:value.manifestSha256,assets:value.assets,actionIds:value.actionIds});
  assert(sha(bytes(semantic(facts.build)))===sha(bytes(semantic(build))),'ONLINE_ORIGINAL_INQUIRY_PUBLICATION_CHANGED');return facts;
 }
 async stopCommonEdge(){
  await this.assertOwned();assert(this.#edge&&!this.#edge.closed,'ONLINE_ORIGINAL_EDGE_REQUIRED');
  await this.#send(this.#edge,'STOP');await this.#awaitEdge('CLOSED');
  while(!this.#edge.closed)await new Promise(resolve=>setTimeout(resolve,25));
  assert(this.#edge.code===0&&this.#edge.signal===null,'ONLINE_ORIGINAL_EDGE_NOT_CLOSED');return {originalEdgeClosed:true,rawUnknownCleared:false};
 }
 async #awaitEdge(event,sequence){
  const state=this.#edge;assert(state,'ONLINE_ORIGINAL_EDGE_REQUIRED');
  while(!state.events.some(row=>row.event===event&&(sequence===undefined||row.sequence===sequence))){assert(!this.#held&&!state.closed,'ONLINE_ORIGINAL_EDGE_OUTCOME_UNPROVEN');await new Promise(resolve=>setTimeout(resolve,25));}
  return state.events.find(row=>row.event===event&&(sequence===undefined||row.sequence===sequence));
 }
 #recordRetirement(value){
  this.#lock.assertOwned();const directory=this.#publicationDirectory+'-retirements';
  if(!fs.existsSync(directory))fs.mkdirSync(directory,{mode:0o700});const stat=fs.lstatSync(directory);
  assert(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700&&fs.realpathSync(directory)===directory,'ONLINE_RETIREMENT_AUDIT_ROOT_REQUIRED');
  const raw=Buffer.concat([bytes({format:'sabalan-original-online-build-retirement/v1',deploymentId:this.#owner.deploymentId,releaseId:this.#owner.releaseId,...value}),Buffer.from('\n')]);
  const file=path.join(directory,randomBytes(32).toString('hex')+'.json'),fd=fs.openSync(file,'wx',0o400);
  try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const dirfd=fs.openSync(directory,'r');try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
  assert(readPrivate(file,8388608,0o400).data.equals(raw),'ONLINE_RETIREMENT_AUDIT_CHANGED');return {file,sha256:sha(raw)};
 }
 async retireExpiredBuilds({buildIds}){
  await this.assertOwned(['ONLINE_SERVING']);assert(Array.isArray(buildIds)&&buildIds.length>0&&buildIds.length<=256&&new Set(buildIds).size===buildIds.length,'ONLINE_EXPIRED_BUILD_SET_REQUIRED');
  const publication=await this.#store.readPublication(),[clock]=await this.#database.$queryRaw`SELECT clock_timestamp() AS now`;
  assert(clock?.now instanceof Date,'ONLINE_ORIGINAL_RETIREMENT_CLOCK_REQUIRED');
  const selected=buildIds.map(id=>{const build=publication.registry.builds.find(row=>row.id===id);
   assert(build&&publication.registry.current[build.application]!==id&&build.retiredAt&&build.supportUntil
    &&Date.parse(build.supportUntil)>=Date.parse(build.retiredAt)+86400000&&clock.now.getTime()>=Date.parse(build.supportUntil),'ONLINE_BUILD_RETENTION_NOT_EXPIRED');return build;});
  assert(selected.every(build=>this.#carriers.has(build.slotId)||this.#retiredCarriers.has(build.slotId)||[...this.#inquiryActors.values()].some(row=>'inquiry_'+row.scope.runtimeId===build.slotId)),'ONLINE_RETIREMENT_ORIGINAL_CARRIER_REQUIRED');
  await this.verifyCommonEdgePublication(publication.publicationSha256);
  const prior=buildIds.map(id=>this.#expiredBuildFences.get(id));let sequence,fence;
  if(prior.every(row=>row&&row.fenceId===prior[0].fenceId&&row.publicationSha256===publication.publicationSha256))fence=prior[0].fence;
  else {sequence=this.#edge.sequence+1;await this.#send(this.#edge,'FENCE_EXPIRED_BUILDS',{buildIds:[...buildIds].sort(),publicationSha256:publication.publicationSha256});fence=await this.#awaitEdge('EXPIRED_BUILDS_FENCED',sequence);}
 assert(fence.publicationSha256===publication.publicationSha256&&sha(bytes([...fence.buildIds].sort()))===sha(bytes([...buildIds].sort()))&&/^[a-f0-9]{64}$/.test(fence.fenceId),'ONLINE_EDGE_RETIREMENT_FENCE_CHANGED');
  for(const build of selected)this.#expiredBuildFences.set(build.id,{fenceId:fence.fenceId,publicationSha256:publication.publicationSha256,quiescent:false,fence});
  sequence=this.#edge.sequence+1;await this.#send(this.#edge,'CLOSE_EXPIRED_POLLING_SESSIONS',{fenceId:fence.fenceId});
  const polling=await this.#awaitEdge('EXPIRED_POLLING_SESSIONS_RECONCILED',sequence);assert(polling.fenceId===fence.fenceId&&sha(bytes(polling.buildIds))===sha(bytes(fence.buildIds)),'ONLINE_POLLING_RETIREMENT_OWNER_CHANGED');
  // Fence admission before asking the SAME original old backend to drain. An
  // idle established WS must close through its real upstream lifecycle first.
  const fenced=id=>this.#expiredBuildFences.get(id)?.publicationSha256===publication.publicationSha256;
  const slotProtected=slot=>publication.registry.apiBindings.some(binding=>binding.slotId===slot&&(Object.values(publication.registry.current).includes(binding.buildId)||!fenced(binding.buildId)));
  const draining=publication.registry.apiBindings.filter(binding=>buildIds.includes(binding.buildId)&&!slotProtected(binding.slotId)).map(binding=>this.#children.get(binding.slotId.replace(/^backend_/,''))).filter(Boolean);
  for(const runtime of new Set(draining)){
   assert(runtime.scope.releaseId!==this.#currentServingReleaseId,'ONLINE_CURRENT_BACKEND_RETIREMENT_REFUSED');
   if(runtime.closed){assert(runtime.nativeClosureVerified,'ONLINE_OLD_NATIVE_CLOSURE_REQUIRED');continue;}
   this.#recordRetirement({phase:'FENCED_NATIVE_DRAIN_INTENT',fenceId:fence.fenceId,runtimeId:runtime.scope.runtimeId,scopeSha256:runtime.scopeSha256});
   if(!runtime.drainingFenceCommitted){await this.prepareRuntime(runtime.scope.runtimeId);await this.awaitRuntimePrepared(runtime.scope.runtimeId);}
   await this.shutdownRuntime(runtime.scope.runtimeId);await this.awaitRuntimeClosed(runtime.scope.runtimeId);
  }
  // The original edge can return pending forever. No clock or caller assertion clears sockets or UNKNOWN journals.
  sequence=this.#edge.sequence+1;await this.#send(this.#edge,'READ_EXPIRED_BUILD_QUIESCENCE',{fenceId:fence.fenceId});
  while(!this.#edge.events.some(row=>row.sequence===sequence&&['EXPIRED_BUILDS_QUIESCENT','EXPIRED_BUILDS_PENDING'].includes(row.event))){assert(!this.#held&&!this.#edge.closed,'ONLINE_EDGE_RETIREMENT_UNKNOWN');await new Promise(resolve=>setTimeout(resolve,25));}
  const proof=this.#edge.events.find(row=>row.sequence===sequence&&['EXPIRED_BUILDS_QUIESCENT','EXPIRED_BUILDS_PENDING'].includes(row.event));
  if(proof.event==='EXPIRED_BUILDS_PENDING')return {retired:false,fenceId:fence.fenceId,counts:proof.counts};
  assert(proof.fenceId===fence.fenceId&&proof.publicationSha256===publication.publicationSha256&&proof.edgeInstanceId===fence.edgeInstanceId
   &&sha(bytes(proof.buildIds))===sha(bytes(fence.buildIds))&&sha(bytes(proof.deadlines))===sha(bytes(fence.deadlines))
   &&Object.keys(proof.counts||{}).sort().join(',')==='active,api,socket,ui,unknown,unselected'&&Object.values(proof.counts).every(value=>value===0),'ONLINE_EDGE_RETIREMENT_PROOF_CHANGED');
  for(const build of selected)this.#expiredBuildFences.get(build.id).quiescent=true;
  const current=await this.#store.readPublication();assert(current.publicationSha256===publication.publicationSha256,'ONLINE_RETIREMENT_PUBLICATION_CHANGED');
  const eligible=id=>this.#expiredBuildFences.get(id)?.quiescent===true;
  const protectedUi=slot=>current.registry.builds.some(build=>build.slotId===slot&&(current.registry.current[build.application]===build.id||!eligible(build.id)));
  const protectedApi=slot=>current.registry.apiBindings.some(binding=>binding.slotId===slot&&(Object.values(current.registry.current).includes(binding.buildId)||!eligible(binding.buildId)));
  const expiredReleaseIds=new Set(current.registry.apiBindings.filter(binding=>selected.some(build=>build.id===binding.buildId)&&!protectedApi(binding.slotId)).map(binding=>this.#children.get(binding.slotId.replace(/^backend_/,''))?.scope.releaseId).filter(Boolean));
  this.#recordRetirement({phase:'FENCED_QUIESCENT',clock:clock.now.toISOString(),fence,proof});
  const removed=[];
  for(const [token,state]of this.#inquiryActors){const slot='inquiry_'+state.scope.runtimeId;if(state.carrierRemoved||protectedUi(slot)||!selected.some(build=>build.slotId===slot))continue;
   if(!state.closed)await this.stopInquiryRuntime(state.scope.runtimeId);assert(state.nativeClosureVerified,'ONLINE_INQUIRY_RETIREMENT_NATIVE_REQUIRED');
   const [actual]=JSON.parse(await this.#docker(['inspect',state.containerId]));assert(actual.Id===state.containerId&&actual.Image===state.image&&actual.State.StartedAt===state.startedAt,'ONLINE_RETIREMENT_CARRIER_REPLACED');
   this.#recordRetirement({phase:'ORIGINAL_CARRIER_REMOVAL_INTENT',fenceId:fence.fenceId,slotId:slot,containerId:actual.Id,image:actual.Image,nativeClosure:state.proof});
   await this.#docker(['stop','--time','-1',actual.Id]);await this.#docker(['rm',actual.Id]);state.carrierRemoved=true;removed.push({slotId:slot,containerId:actual.Id,image:actual.Image});}
  for(const [slot,token]of [...this.#carriers]){if(this.#retiredCarriers.has(slot))continue;const facts=await readOriginalOnlineCarrier(this,token);
   if(facts.kind==='frontend'){if(protectedUi(slot)||!selected.some(build=>build.slotId===slot))continue;}
   else {if(facts.releaseId===this.#currentServingReleaseId||!expiredReleaseIds.has(facts.releaseId)||protectedApi(slot))continue;const runtime=this.#children.get(facts.runtimeId);if(!runtime)continue;
    if(!runtime.closed){await this.prepareRuntime(facts.runtimeId);await this.awaitRuntimePrepared(facts.runtimeId);await this.shutdownRuntime(facts.runtimeId);await this.awaitRuntimeClosed(facts.runtimeId);}
    assert(runtime.nativeClosureVerified,'ONLINE_BACKEND_RETIREMENT_NATIVE_REQUIRED');}
   this.#recordRetirement({phase:'ORIGINAL_CARRIER_REMOVAL_INTENT',fenceId:fence.fenceId,slotId:slot,containerId:facts.containerId,image:facts.image});
   await this.#docker(['stop','--time','-1',facts.containerId]);await this.#docker(['rm',facts.containerId]);
   this.#retiredCarriers.set(slot,{facts,fence,proof,retiredAt:clock.now.toISOString()});this.#carriers.delete(slot);removed.push({slotId:slot,containerId:facts.containerId,image:facts.image});}
  // The canonical image-retention owner also protects checkpoints, rollback and incident holds. Container absence alone cannot authorize image deletion.
  const images=[],imageCleanup='CANONICAL_RETENTION_OWNER_REQUIRED';
  const audit=this.#recordRetirement({phase:'COMPLETED',fenceId:fence.fenceId,buildIds,removed,images,imageCleanup,immutableRoutingHistoryPreserved:true});
  return {retired:true,fenceId:fence.fenceId,buildIds,removed,images,imageCleanup,audit,immutableRoutingHistoryPreserved:true};
 }
 async verifyCommonEdgePublication(publicationSha256){
  await this.assertOwned();assert(this.#edge&&!this.#edge.closed,'ONLINE_ORIGINAL_EDGE_REQUIRED');
  const [actual]=JSON.parse(await this.#docker(['inspect',this.#edge.containerId]));
  assert(actual.State.Running&&actual.State.StartedAt===this.#edge.startedAt&&actual.Image===this.#edge.image,'ONLINE_ORIGINAL_EDGE_REPLACED');
  const sequence=this.#edge.sequence+1;await this.#send(this.#edge,'VERIFY_PUBLICATION',{publicationSha256});
  const observed=await this.#awaitEdge('PUBLICATION_OBSERVED',sequence);assert(observed.publicationSha256===publicationSha256,'ONLINE_EDGE_PUBLICATION_CHANGED');return observed;
 }
 retainOriginalCarrierFailure(token){
  const facts=consumeOriginalCarrierFailure(this,token);this.#carrierFailures.push(facts);
  this.#held='ORIGINAL_CARRIER_PROVISIONING_UNPROVEN';return facts;
 }
 #requireOriginalQualification(input){
  const {openTrustedOnlineQualification}=require('./online-release-host-kernel.cjs');
  const origin=openTrustedOnlineQualification(input.evidenceDirectory,input);
  this.#origins.set(origin.decision.releaseId,origin);return origin;
 }
 async prepareExpansion(input){
  await this.assertOwned(['ONLINE_CHECKPOINTING']);
  this.#requireOriginalQualification(input);
  const {prepareAcceptedOnlineExpansion}=require('./online-release-host-kernel.cjs');
  const result=await prepareAcceptedOnlineExpansion(this.#database,this.#owner,input);
  this.#preparedInputs.set(this.#owner.releaseId,structuredClone(input));return result;
 }
 async runExpansion(input){
  await this.assertOwned(['ONLINE_EXPANDING']);
  const {runAcceptedOnlineExpansion}=require('./online-release-host-kernel.cjs');
  return runAcceptedOnlineExpansion(this.#database,this.#owner,input);
 }
 async register(input){
  await this.assertOwned(['ONLINE_ACCEPTING']);
  this.#requireOriginalQualification(input);
  const {registerAcceptedOnlineRelease}=require('./online-release-host-kernel.cjs');
  const receipt=await registerAcceptedOnlineRelease(this.#database,this.#owner,input);
  this.#accepted={input:structuredClone(input),receipt};this.#releases.set(receipt.releaseId,this.#accepted);return receipt;
 }
 async prepareProtectedBootstrap({registration,paths,httpRuntimes}){
  await this.assertOwned(['MIGRATIONS_APPLIED','RELEASE_STARTED']);
  assert(!this.#accepted&&!this.#bootstrap&&Array.isArray(httpRuntimes)&&httpRuntimes.length>0,'ONLINE_BOOTSTRAP_ORIGINAL_REQUIRED');
  this.#requireOriginalQualification(registration);
  const {prepareProtectedOnlineBootstrap}=require('./online-release-host-kernel.cjs');
  const capability=await prepareProtectedOnlineBootstrap(this.#database,this.#owner,registration,paths);
  this.#bootstrap={capability,activated:new Set(),finalized:false};
  this.#accepted={input:structuredClone(registration),receipt:{releaseId:this.#owner.releaseId}};
  this.#releases.set(this.#owner.releaseId,this.#accepted);
  // Acquire and create the legacy UI carrier BEFORE deploy recreates its old
  // canonical frontend. No legacy backend or jobs process is started/adopted.
  this.#bootstrapLegacy={source:await acquireOriginalBootstrapLegacyBrowserSource(this)};
  const descriptor=await issueOriginalLegacyBrowserDescriptor(this);
  const legacyCarrier=await provisionOriginalBootstrapLegacyFrontend(this,{releaseId:this.#owner.releaseId,descriptor});
  const legacy=await readOriginalOnlineCarrier(this,legacyCarrier);
  assert(legacy.legacyFrontendOnly===true&&legacy.compiledBytesVerified===true,'ONLINE_ORIGINAL_LEGACY_UI_REQUIRED');
  this.#bootstrapLegacy.carrier=legacyCarrier;this.#carriers.set(legacy.slotId,legacyCarrier);
  const qualified=this.readCarrierReleaseEvidence(this.#owner.releaseId),registry=qualified.browserRegistries.at(-1);
  assert(registry?.current?.erp,'ONLINE_BOOTSTRAP_QUALIFIED_UI_REQUIRED');
  await this.provisionCarriers({releaseId:this.#owner.releaseId,backendRuntimeIds:registration.scopes.map(row=>row.scope.runtimeId),buildId:registry.current.erp});
  for(const input of httpRuntimes){
   const scope=registration.scopes.find(item=>item.scope.runtimeId===input.runtimeId)?.scope;
   assert(scope?.purpose==='http','ONLINE_BOOTSTRAP_HTTP_ONLY');
   await this.startRuntime(input);await this.awaitRuntimeReady(input.runtimeId);
  }
  assert(registry.current.inquiry,'ONLINE_BOOTSTRAP_QUALIFIED_INQUIRY_REQUIRED');
  const inquiry=await this.prepareInquiryRuntime({releaseId:this.#owner.releaseId,buildId:registry.current.inquiry});
  await this.startInquiryRuntime({runtimeId:inquiry.runtimeId});this.#bootstrap.inquiryRuntimeId=inquiry.runtimeId;
  return {releaseId:this.#owner.releaseId,originalHttpReady:true,originalInquiryReady:true,inquiryRuntimeId:inquiry.runtimeId,publicTrafficOpened:false};
 }
 async publishProtectedBootstrap(registry){
  await this.assertOwned(['GATES_PASSED']);assert(this.#bootstrap&&!this.#bootstrap.finalized,'ONLINE_ORIGINAL_BOOTSTRAP_REQUIRED');
  await this.#assertOriginalProductionGates(this.#owner.releaseId);
  registry=await this.prepareOriginalPublicationRegistry({releaseId:this.#owner.releaseId});
  const {assertProtectedOnlineBootstrap,finalizeProtectedOnlineBootstrap}=require('./online-release-host-kernel.cjs');
  assertProtectedOnlineBootstrap(this.#bootstrap.capability,this.#database,this.#owner);
  const current=registry.builds.find(value=>value.id===registry.current?.erp);
  const binding=registry.apiBindings.find(value=>value.buildId===current?.id);
  const scope=this.#accepted.input.scopes.find(value=>value.scope.purpose==='http'&&binding?.slotId==='backend_'+value.scope.runtimeId);
  const original=scope&&this.#children.get(scope.scope.runtimeId);
  await this.#assertOriginalUiCarrier(current);
  const inquiryBuild=registry.builds.find(build=>build.application==='inquiry'&&build.id===registry.current?.inquiry);
  assert(inquiryBuild,'ONLINE_INQUIRY_BROWSER_NOT_QUALIFIED');await this.#assertOriginalInquiryCarrier(inquiryBuild);
  assert(original&&!original.closed&&original.events.some(value=>value.event==='READY'),'ONLINE_BOOTSTRAP_ORIGINAL_HTTP_NOT_READY');
  const legacy=await readOriginalOnlineCarrier(this,this.#bootstrapLegacy?.carrier);
  assert(legacy.legacyFrontendOnly===true&&legacy.build?.handoffPolicy==='MANUAL_SAVE_REQUIRED'
   &&!registry.builds.some(build=>build.id===legacy.build.id),'ONLINE_BOOTSTRAP_LEGACY_IDENTITY_CHANGED');
  const [clock]=await this.#database.$queryRaw`SELECT clock_timestamp() AS now`;
  assert(clock?.now instanceof Date&&Number.isFinite(clock.now.getTime()),'ONLINE_BOOTSTRAP_DATABASE_CLOCK_REQUIRED');
  const retiredAt=clock.now.toISOString(),supportUntil=new Date(clock.now.getTime()+86400000).toISOString();
  const legacyBuild={...structuredClone(legacy.build),slotId:legacy.slotId,retiredAt,supportUntil};
  registry={...structuredClone(registry),legacy:{...registry.legacy,erp:legacyBuild.id},
   builds:[...registry.builds,legacyBuild],apiBindings:[...registry.apiBindings,{...binding,
    buildId:legacyBuild.id,browserManifestSha256:legacyBuild.manifestSha256}]};
  await this.#assertOriginalUiCarrier(legacyBuild);
  try{
   const published=await this.#store.publish(registry,null),head=await this.#store.readPublication();
   assert(head.publicationSha256===published.publicationSha256,'ONLINE_BOOTSTRAP_READBACK_CHANGED');
   await this.verifyCommonEdgePublication(head.publicationSha256);
   const receipt=await finalizeProtectedOnlineBootstrap(this.#bootstrap.capability,this.#database,this.#owner,head.publicationSha256);
   this.#bootstrap.finalized=true;this.#currentServingReleaseId=this.#owner.releaseId;this.#lastPublicationSha=head.publicationSha256;return receipt;
  }catch(error){this.#held='BOOTSTRAP_PUBLICATION_OUTCOME_UNPROVEN';throw error;}
 }
 async activateProtectedBootstrap(runtimeId){
  assert(this.#bootstrap?.finalized,'ONLINE_BOOTSTRAP_EPOCH_REQUIRED');
  await this.#control(runtimeId,'ACTIVATE_BOOTSTRAP');const original=this.#children.get(runtimeId);
  while(!original.events.some(value=>value.event==='ACTIVATED')){
   assert(!original.closed&&!this.#held,'ONLINE_BOOTSTRAP_ACTIVATION_UNPROVEN');await new Promise(resolve=>setTimeout(resolve,25));
  }
  await this.#database.$transaction(async tx=>{
   const {assertOwnedOnlineLease}=require('./online-release-host-kernel.cjs');
   await assertOwnedOnlineLease(tx,this.#owner,['GATES_PASSED']);
   const count=await tx.$executeRaw`UPDATE online_runtime_slots SET phase='SERVING' WHERE id=${runtimeId}
     AND "releaseId"=${this.#owner.releaseId} AND phase='READY' AND "stoppedAt" IS NULL`;
   assert(count===1,'ONLINE_BOOTSTRAP_ACTIVATED_SLOT_CHANGED');
  });
  this.#bootstrap.activated.add(runtimeId);return {runtimeId,originalActivated:true,publicTrafficOpened:false};
 }
 async prepareOriginalPublicationRegistry({releaseId=this.#owner.releaseId}={}){
  await this.assertOwned();const target=this.#releases.get(releaseId);assert(target,'ONLINE_ORIGINAL_PUBLICATION_RELEASE_REQUIRED');
  const evidence=this.readCarrierReleaseEvidence(releaseId),qualified=evidence.browserRegistries.at(-1);
  assert(qualified?.current?.erp&&qualified.current.inquiry,'ONLINE_ORIGINAL_PAIRED_BUILD_IDS_REQUIRED');
  let prior=null;try{prior=await this.#store.readPublication();}catch(error){assert(this.#bootstrap&&!this.#bootstrap.finalized&&error.code==='BROWSER_ROUTING_NOT_PUBLISHED','ONLINE_ORIGINAL_PUBLICATION_HEAD_UNPROVEN');}
  const frontend=[];
  for(const token of this.#carriers.values()){const facts=await readOriginalOnlineCarrier(this,token);if(facts.kind==='frontend'&&facts.releaseId===releaseId&&facts.build?.id===qualified.current.erp)frontend.push(facts);}
  assert(frontend.length===1,'ONLINE_ORIGINAL_CURRENT_FRONTEND_AMBIGUOUS');
  const inquiry=[];
  for(const [token,state]of this.#inquiryActors){if(!state.closed&&state.ready&&state.scope.releaseId===releaseId){const facts=await readOriginalInquiryCarrier(this,token);if(facts.build.id===qualified.current.inquiry)inquiry.push(facts);}}
  assert(inquiry.length===1,'ONLINE_ORIGINAL_CURRENT_INQUIRY_AMBIGUOUS');
  const backend=[...this.#children.values()].filter(row=>row.scope.releaseId===releaseId&&row.scope.purpose==='http'&&!row.closed&&row.events.some(event=>event.event==='READY'));
  assert(backend.length>0,'ONLINE_ORIGINAL_CURRENT_HTTP_REQUIRED');
  const [clock]=await this.#database.$queryRaw`SELECT clock_timestamp() AS now`;assert(clock?.now instanceof Date,'ONLINE_ORIGINAL_PUBLICATION_CLOCK_REQUIRED');
  const retiredAt=clock.now.toISOString(),supportUntil=new Date(clock.now.getTime()+86400000).toISOString();
  const current={erp:frontend[0].build.id,inquiry:inquiry[0].build.id},builds=structuredClone(prior?.registry.builds||[]);
  for(const build of builds)if(prior.registry.current[build.application]===build.id&&build.id!==current[build.application]&&build.retiredAt===null){build.retiredAt=retiredAt;build.supportUntil=supportUntil;}
  for(const carrier of [frontend[0],inquiry[0]]){
   const value={...structuredClone(carrier.build),slotId:carrier.slotId,retiredAt:null,supportUntil:null},old=builds.findIndex(build=>build.id===value.id);
   if(old<0)builds.push(value);else{assert(builds[old].image===value.image&&builds[old].manifestSha256===value.manifestSha256,'ONLINE_ORIGINAL_RETAINED_BROWSER_BYTES_CHANGED');builds[old]=value;}
  }
  const apiBindings=structuredClone(prior?.registry.apiBindings||[]).filter(binding=>binding.buildId!==current.erp),scope=backend[0].scope;
  apiBindings.push({buildId:current.erp,browserManifestSha256:frontend[0].build.manifestSha256,slotId:'backend_'+scope.runtimeId,image:scope.image,manifestSha256:scope.manifestSha256});
  return {format:'sabalan-browser-routing/v2',generation:prior?prior.generation+1:1,current,
   legacy:prior?{erp:prior.registry.current.erp,inquiry:prior.registry.current.inquiry}:{erp:null,inquiry:null},builds,apiBindings};
 }
 async registerRetainedIncarnations(input){
  await this.assertOwned(['ONLINE_ROLLBACK_PUBLISHING','ONLINE_SERVING']);
  const {registerRetainedOnlineIncarnations}=require('./online-release-host-kernel.cjs');
  const result=await registerRetainedOnlineIncarnations(this.#database,this.#owner,input);
  const original=this.#releases.get(result.releaseId);assert(original,'ONLINE_RETAINED_ORIGINAL_HISTORY_ABSENT');
  original.input.scopes.push(...structuredClone(input.scopes));return result;
 }
 async transition(nextPhase){
  await this.assertOwned();
  const {PrismaDeploymentStore,transitionDeployment}=require('./online-release-host-kernel.cjs');
  return transitionDeployment(new PrismaDeploymentStore(this.#database),{...this.#owner,nextPhase,now:new Date()});
 }
 async beginNextOwnedLease(owner){
  assert(!this.#held,'ONLINE_ORIGINAL_CONTROLLER_HELD');this.#lock.assertOwned();
  const previous=this.#owner;
  await this.#database.$transaction(async tx=>{
   const rows=await tx.$queryRaw`SELECT id FROM deployment_operations WHERE id=${previous.deploymentId}
    AND "leaseToken"=${previous.leaseToken} AND "activeKey" IS NULL AND phase IN ('COMPLETED','ROLLED_BACK') FOR SHARE`;
   assert(rows.length===1,'ONLINE_PREVIOUS_LEASE_NOT_COMPLETED');
   const {assertOwnedOnlineLease}=require('./online-release-host-kernel.cjs');
   await assertOwnedOnlineLease(tx,owner,['LEASE_ACQUIRED','ONLINE_ACCEPTING']);
  });
  this.#owner=Object.freeze({...owner});this.#accepted=null;this.#bootstrap=null;
 }
 publicKey(){return createPublicKey(this.#key).export({type:'spki',format:'pem'});}
 async startRuntime({runtimeId,releaseId=this.#owner.releaseId,httpIngress=null}){
  await this.assertOwned(['ONLINE_READY','ONLINE_SERVING']);
  assert(this.#accepted,'ONLINE_REGISTERED_TYPED_EVIDENCE_REQUIRED');
  const target=this.#releases.get(releaseId);assert(target,'ONLINE_TARGET_NOT_ORIGINALLY_REGISTERED');
  const enrolled=target.input.scopes.find(item=>item.scope.runtimeId===runtimeId);
  assert(enrolled&&!this.#children.has(runtimeId),'ONLINE_ORIGINAL_SCOPE_NOT_ENROLLED');
  const {scope}=enrolled;
  const carrierToken=this.#carriers.get('backend_'+runtimeId);assert(carrierToken,'ONLINE_ORIGINAL_BACKEND_CARRIER_REQUIRED');
  const carrier=await readOriginalOnlineCarrier(this,carrierToken);
  assert(carrier.kind==='backend'&&carrier.runtimeId===runtimeId&&carrier.releaseId===scope.releaseId&&carrier.image===scope.image,'ONLINE_ORIGINAL_BACKEND_CARRIER_CHANGED');
  enrolled.containerId=carrier.containerId;
  const trust=carrier.mounts.find(mount=>mount.type==='bind'&&mount.target==='/run/sabalan-online'&&mount.readOnly);
  assert(trust,'ONLINE_ORIGINAL_SCOPE_TRUST_MOUNT_REQUIRED');
  const mountedScope=path.join(trust.source,runtimeId+'.json'),scopeRaw=fs.readFileSync(enrolled.file);
  assert(sha(scopeRaw)===enrolled.sha256,'ONLINE_ORIGINAL_SCOPE_CHANGED');
  if(!fs.existsSync(mountedScope)){const fd=fs.openSync(mountedScope,'wx',0o400);try{fs.writeFileSync(fd,scopeRaw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
  assert(readPrivate(mountedScope,262144,0o400).data.equals(scopeRaw),'ONLINE_MOUNTED_SCOPE_CHANGED');enrolled.runtimeFile='/run/sabalan-online/'+runtimeId+'.json';
  if(scope.purpose==='http')httpIngress={bindHost:carrier.privateAddress,port:5000};else assert(httpIngress===null,'ONLINE_JOBS_INGRESS_REFUSED');
  const origin=this.#origins.get(scope.releaseId);assert(origin,'ONLINE_ORIGINAL_QUALIFICATION_CERTIFICATE_REQUIRED');origin.revalidate();
  assert(scope.purpose==='http'||scope.purpose==='jobs','ONLINE_RUNTIME_PURPOSE');
  // Jobs cannot be duplicated during private READY. Its existing worker lock
  // and native predecessor closure are independently enforced by owner.py.
  if(scope.purpose==='jobs'){
    if(this.#bootstrap){
      const rows=await this.#database.$queryRaw`SELECT id FROM deployment_operations WHERE id=${this.#owner.deploymentId}
       AND \"leaseToken\"=${this.#owner.leaseToken} AND phase='TRAFFIC_OPENED' AND \"activeKey\"='production' AND \"leaseExpiresAt\">clock_timestamp()+interval '20 seconds'`;
      assert(rows.length===1,'ONLINE_BOOTSTRAP_JOBS_DEFERRED_UNTIL_REOPEN');
    }else await this.assertOwned(['ONLINE_SERVING']);
  }
  const accepted=require('./online-release-host-kernel.cjs').readOnlineReleaseEvidence(
   target.input.evidenceDirectory,target.input);
  accepted.revalidate();
  await this.#database.$transaction(async tx=>{
   const {assertOwnedOnlineLease}=require('./online-release-host-kernel.cjs');
   await assertOwnedOnlineLease(tx,this.#owner,this.#bootstrap
     ?(scope.purpose==='http'?['MIGRATIONS_APPLIED','RELEASE_STARTED','GATES_PASSED']:['TRAFFIC_OPENED'])
     :[scope.purpose==='http'?'ONLINE_READY':'ONLINE_SERVING']);
   const count=await tx.$executeRaw`UPDATE online_runtime_slots SET phase='STARTING' WHERE id=${runtimeId}
    AND "releaseId"=${scope.releaseId} AND phase='PREPARED' AND "stoppedAt" IS NULL`;
   assert(count===1,'ONLINE_RUNTIME_SLOT_NOT_PREPARED');
  });
  const now=Date.now();
  const decision={format:'sabalan-online-startup-decision/v2',purpose:'online-runtime-startup',scopeSha256:enrolled.sha256,
   runtimeId,nonceSha256:sha(Buffer.from(scope.nonce)),runtimePurpose:scope.purpose,role:scope.role,
   releaseId:scope.releaseId,image:scope.image,sourceCommit:scope.sourceCommit,runtimeBundleSha256:scope.manifestSha256,
   manifestSha256:target.input.manifestSha256,acceptanceSha256:target.input.acceptanceSha256,
   database:scope.database,httpIngress,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
  const envelope={format:'sabalan-signed-online-startup/v2',decision,
   signature:sign(null,Buffer.concat([Buffer.from('sabalan-online-runtime-startup/v2\n'),bytes(decision)]),this.#key).toString('base64')};
  require('./online-release-host-kernel.cjs').verifyOnlineStartupDecision(bytes(envelope),Buffer.from(this.publicKey()));
  assert(/^[a-f0-9]{64}$/.test(enrolled.containerId)&&typeof enrolled.runtimeFile==='string'
   &&path.isAbsolute(enrolled.runtimeFile),'ONLINE_ENROLLED_CONTAINER_REQUIRED');
  const inspected=JSON.parse(await this.#docker(['inspect',enrolled.containerId]));
  assert(inspected.length===1&&inspected[0].Id===enrolled.containerId&&inspected[0].Image===scope.image
   &&inspected[0].State.Running&&inspected[0].Config.Labels['com.docker.compose.project']===this.#project,
   'ONLINE_IMMUTABLE_RUNTIME_CONTAINER_CHANGED');
  assert(!inspected[0].HostConfig.Privileged&&inspected[0].HostConfig.PidMode!=='host','ONLINE_RUNTIME_HOST_ISOLATION_REQUIRED');
  assert(inspected[0].Mounts.every(mount=>{const relative=path.relative(mount.Source,PRIVATE_KEY);
    return relative!==''&&(relative==='..'||relative.startsWith('../')||path.isAbsolute(relative));}),
    'ONLINE_HOST_SIGNER_EXPOSED_TO_RUNTIME');
  const session=sha(Buffer.from(scope.nonce+Date.now()+runtimeId));
  await this.#composePs();
  const child=spawn('docker',['exec','-i',enrolled.containerId,'/usr/bin/python3','-I','-B',
   '/app/scripts/online-release-inner-controller.py',enrolled.runtimeFile,enrolled.sha256,session],
   {stdio:['pipe','pipe','pipe'],shell:false});
  const state={child,scope,scopeSha256:enrolled.sha256,session,sequence:0,closed:false,code:null,signal:null,
   events:[],stdoutBytes:0,stderrBytes:0,pending:'',runtimePending:'',containerId:enrolled.containerId};
  this.#children.set(runtimeId,state);
  child.once('error',()=>{this.#held='SPAWN_OUTCOME_UNKNOWN';});
  child.stdout.on('data',data=>{state.stdoutBytes+=data.length;
   if(state.stdoutBytes>8388608){this.#held='CONTROL_OUTPUT_BOUND';return;}
   state.pending+=data.toString();let offset;
   while((offset=state.pending.indexOf('\n'))>=0){const line=state.pending.slice(0,offset);state.pending=state.pending.slice(offset+1);
    try{const event=JSON.parse(line);state.events.push(event);if(event.event==='ACTOR_STARTED')state.guardian=event.guardian;
      if(event.event==='HELD')this.#held='ORIGINAL_INNER_HELD';}catch{this.#held='CONTROL_FRAME_INVALID';}}
  });
  child.stderr.on('data',data=>{state.stderrBytes+=data.length;if(state.stderrBytes>8388608){this.#held='RUNTIME_STDERR_BOUND';return;}
   state.runtimePending+=data.toString();let offset;
   while((offset=state.runtimePending.indexOf('\n'))>=0){const line=state.runtimePending.slice(0,offset);state.runtimePending=state.runtimePending.slice(offset+1);
    if(line.startsWith('SABALAN_ONLINE_RUNTIME ')){try{state.events.push(JSON.parse(line.slice(23)));}catch{this.#held='RUNTIME_FRAME_INVALID';}}}
  });
  child.once('close',(code,signal)=>{state.closed=true;state.code=code;state.signal=signal;});
  let protectedBootstrap=null;
  if(this.#bootstrap&&!this.#bootstrap.finalized&&scope.purpose==='http'){
   const {assertProtectedOnlineBootstrap}=require('./online-release-host-kernel.cjs');
   const proof=assertProtectedOnlineBootstrap(this.#bootstrap.capability,this.#database,this.#owner);
   const bootstrapDecision={format:'sabalan-protected-online-bootstrap/v1',purpose:'private-http-bootstrap',
    deploymentId:this.#owner.deploymentId,releaseId:scope.releaseId,runtimeId,startupDecisionSha256:sha(bytes(decision)),
    checkpointSha256:accepted.acceptance.checkpointSha256,maintenanceSha256:proof.maintenanceSha256,
    issuedAt:decision.issuedAt,expiresAt:decision.expiresAt};
   protectedBootstrap={format:'sabalan-signed-protected-online-bootstrap/v1',decision:bootstrapDecision,
    signature:sign(null,Buffer.concat([Buffer.from('sabalan-protected-online-bootstrap/v1\n'),bytes(bootstrapDecision)]),this.#key).toString('base64')};
  }
  const evidenceFiles=accepted.evidenceInventory.map(row=>{const raw=fs.readFileSync(path.join(target.input.evidenceDirectory,row.file));assert(raw.length===row.bytes&&sha(raw)===row.sha256,'ONLINE_ORIGINAL_EVIDENCE_CHANGED');return {file:row.file,sha256:row.sha256,rawBase64:raw.toString('base64')};});
  const provenance=readPrivate(path.join(target.input.evidenceDirectory,'qualification-provenance.json'),65536,0o400).data;
  evidenceFiles.push({file:'qualification-provenance.json',sha256:sha(provenance),rawBase64:provenance.toString('base64')});
  assert(Buffer.byteLength(JSON.stringify(evidenceFiles))<=48*1024*1024,'ONLINE_EVIDENCE_INSTALL_BOUND');
  accepted.revalidate();await this.#send(state,'START',{databaseUrl:this.#databaseUrl,startupDecision:envelope,protectedBootstrap,evidenceFiles});
  return Object.freeze({runtimeId,originalDockerCliPid:child.pid,startupAuthorityIssued:true,publicTrafficPublished:false});
 }
 async #observe(args,input=null,environment=null){
  const child=spawn('docker',args,{stdio:[input===null?'ignore':'pipe','pipe','pipe'],shell:false,...(environment?{env:{...process.env,...environment}}:{})});
  const state={child,closed:false,stdout:[],stderr:[],bytes:0,overflow:false};this.#observers.push(state);
  child.stdout.on('data',chunk=>{state.bytes+=chunk.length;if(state.bytes<=8388608)state.stdout.push(chunk);else state.overflow=true;});
  child.stderr.on('data',chunk=>{state.bytes+=chunk.length;if(state.bytes<=8388608)state.stderr.push(chunk);else state.overflow=true;});
  if(input!==null){child.stdin.on('error',()=>{this.#held='OBSERVER_INPUT_CLOSURE_UNKNOWN';});child.stdin.end(input);}
  const result=await new Promise(resolve=>{child.once('error',()=>{this.#held='OBSERVER_SPAWN_UNKNOWN';});
   child.once('close',(code,signal)=>{state.closed=true;resolve({code,signal});});});
  assert(result.code===0&&result.signal===null&&!state.overflow,'ONLINE_ORIGINAL_DOCKER_OBSERVER_FAILED');
  return Buffer.concat(state.stdout).toString();
 }
 async #composePs(){return this.#observe(['compose','-p',this.#project,'-f',this.#composeFile,'ps','--format','json']);}
 async #docker(args,input=null,environment=null){await this.#composePs();return this.#observe(args,input,environment);}
 async #send(state,command,input={}){
  const decision={format:'sabalan-online-original-control/v1',session:state.session,scopeSha256:state.scopeSha256,
   sequence:++state.sequence,command,input};
  const signature=sign(null,Buffer.concat([Buffer.from('sabalan-online-original-control/v1\n'),bytes(decision)]),this.#key).toString('base64');
  const wire=JSON.stringify({decision,signature})+'\n';
  await new Promise((resolve,reject)=>state.child.stdin.write(wire,error=>error?reject(error):resolve()));
 }
 async awaitRuntimeReady(runtimeId){
  const original=this.#children.get(runtimeId);assert(original,'ONLINE_ORIGINAL_RUNTIME_ABSENT');
  while(!original.events.some(event=>event.event==='READY')||!original.events.some(event=>event.event==='ACTOR_STARTED')){
   assert(!original.closed&&!this.#held,'ONLINE_ORIGINAL_STARTUP_NOT_READY');
   await new Promise(resolve=>setTimeout(resolve,25));
  }
  await this.assertOwned();
  const started=original.events.find(event=>event.event==='ACTOR_STARTED');
  assert(started&&started.native.phase==='ACTIVE'&&started.originalPid===started.guardian.pid
    &&sha(bytes(started.native.onlineScope.scope))===sha(bytes(original.scope)),
    'ONLINE_ORIGINAL_NATIVE_ACTIVE_UNPROVEN');
  await this.#database.$transaction(async tx=>{
   const {assertOwnedOnlineLease}=require('./online-release-host-kernel.cjs');await assertOwnedOnlineLease(tx,this.#owner,this.#bootstrap?['MIGRATIONS_APPLIED','RELEASE_STARTED','GATES_PASSED','TRAFFIC_OPENED']:['ONLINE_READY','ONLINE_SERVING']);
   const count=await tx.$executeRaw`UPDATE online_runtime_slots SET phase=${original.scope.purpose==='jobs'?'SERVING':'READY'} WHERE id=${runtimeId}
    AND phase='STARTING' AND "stoppedAt" IS NULL`;
   assert(count===1,'ONLINE_ORIGINAL_READY_SLOT_CHANGED');
  });
  return {runtimeId,ready:true,publicTrafficPublished:false};
 }
 async prepareRuntime(runtimeId){return this.#control(runtimeId,'PREPARE_DRAIN');}
 async awaitRuntimePrepared(runtimeId){
  const original=this.#children.get(runtimeId);assert(original,'ONLINE_ORIGINAL_RUNTIME_ABSENT');
  while(!original.events.some(event=>event.event==='PREPARED')){
   assert(!original.closed&&!this.#held,'ONLINE_ORIGINAL_PREPARE_UNPROVEN');await new Promise(resolve=>setTimeout(resolve,25));
  }
  await this.assertOwned(this.#checkpointJobsDraining.has(runtimeId)?['ONLINE_CHECKPOINTING']:undefined);
  await this.#database.$transaction(async tx=>{
   const {assertOwnedOnlineLease}=require('./online-release-host-kernel.cjs');
   await assertOwnedOnlineLease(tx,this.#owner,this.#checkpointJobsDraining.has(runtimeId)?['ONLINE_CHECKPOINTING']:['ONLINE_READY','ONLINE_PUBLISHING','ONLINE_SERVING','ONLINE_ROLLBACK_PUBLISHING']);
   const count=await tx.$executeRaw`UPDATE online_runtime_slots SET phase='DRAINING' WHERE id=${runtimeId}
     AND "releaseId"=${original.scope.releaseId} AND phase IN ('READY','SERVING') AND "stoppedAt" IS NULL`;
   assert(count===1,'ONLINE_ORIGINAL_DRAIN_FENCE_CHANGED');
  });
  original.drainingFenceCommitted=true;
  return {runtimeId,drainingFenceCommitted:true,originalPrepared:true};
 }
 async shutdownRuntime(runtimeId){return this.#control(runtimeId,'SHUTDOWN');}
 async awaitRuntimeClosed(runtimeId){
  const original=this.#children.get(runtimeId);assert(original,'ONLINE_ORIGINAL_RUNTIME_ABSENT');
  await this.#send(original,'WAIT_CLOSED');
  while(!original.closed)await new Promise(resolve=>setTimeout(resolve,25));
  const proof=original.events.find(event=>event.event==='CLOSED');
  assert(proof&&proof.allOriginalChildrenClosed&&proof.native.phase==='QUIESCENT'&&proof.native.nativeReaped
   &&proof.native.databaseQuiet&&proof.work.phase==='QUIESCENT'
   &&sha(bytes(proof.native.guardian))===sha(bytes(original.guardian))
   &&sha(bytes(proof.native.onlineScope.scope))===sha(bytes(original.scope))
   &&proof.sql.visible&&proof.sql.sessions===0&&proof.sql.prepared===0,'ONLINE_ORIGINAL_NATIVE_CLOSURE_UNPROVEN');
  original.nativeClosureVerified=true;
  assert(original.code===0&&original.signal===null&&proof.originalReturncode===0&&proof.native.nativeStatus===0
   &&proof.native.stoppedBySignal===false,'ONLINE_ORIGINAL_RUNTIME_FAILED_CLOSED');
  await this.assertOwned(this.#checkpointJobsDraining.has(runtimeId)?['ONLINE_CHECKPOINTING']:undefined);
  const count=await this.#database.$executeRaw`UPDATE online_runtime_slots SET phase='STOPPED',"stoppedAt"=clock_timestamp()
   WHERE id=${runtimeId} AND phase='DRAINING' AND "stoppedAt" IS NULL`;
  assert(count===1,'ONLINE_ORIGINAL_STOPPED_SLOT_CHANGED');
  original.nativeClosureVerified=true;
  return {runtimeId,originalReturncode:original.code,nativeQuiescent:true,workQuiescent:true,sqlQuiet:true};
 }
 async #control(runtimeId,command){
  await this.assertOwned(this.#checkpointJobsDraining.has(runtimeId)?['ONLINE_CHECKPOINTING']:undefined);const state=this.#children.get(runtimeId);
  assert(state&&!state.closed&&state.child.stdin.writable,'ONLINE_ORIGINAL_RUNTIME_NOT_ALIVE');
  if(command==='SHUTDOWN')assert(state.drainingFenceCommitted,'ONLINE_ORIGINAL_DRAIN_FENCE_REQUIRED');
  const expected=command==='SHUTDOWN'?'PREPARED':'READY';
  assert(state.events.some(event=>event.event===expected),'ONLINE_ORIGINAL_RUNTIME_STATE_UNPROVEN');
  await this.#send(state,command);
  return {runtimeId,command,sequence:state.sequence,completed:false};
 }
 async runOriginalProductionGates({releaseId=this.#owner.releaseId}={}){
  await this.assertOwned(['ONLINE_READY','ONLINE_PUBLISHING','ONLINE_ROLLBACK_PUBLISHING']);
  const target=this.#releases.get(releaseId);assert(target,'ONLINE_GATE_ORIGINAL_RELEASE_REQUIRED');
  const registry=await this.prepareOriginalPublicationRegistry({releaseId});
  const erp=registry.builds.find(build=>build.id===registry.current.erp),inquiryBuild=registry.builds.find(build=>build.id===registry.current.inquiry);
  const front=await this.#assertOriginalUiCarrier(erp),inquiry=await this.#assertOriginalInquiryCarrier(inquiryBuild);
  const binding=registry.apiBindings.find(row=>row.buildId===erp.id),runtimeId=binding?.slotId.slice('backend_'.length),actor=this.#children.get(runtimeId);
  assert(actor&&!actor.closed&&actor.events.some(row=>row.event==='READY')&&!actor.drainingFenceCommitted,'ONLINE_GATE_ORIGINAL_HTTP_READY_REQUIRED');
  const backend=await readOriginalOnlineCarrier(this,this.#carriers.get(binding.slotId));
  const nginxIds=(await this.#docker(['ps','--filter','label=com.docker.compose.project='+this.#project,'--filter','label=com.docker.compose.service=nginx','--format','{{.ID}}'])).trim().split('\n').filter(Boolean);
  assert(nginxIds.length===1,'ONLINE_GATE_ORIGINAL_NGINX_REQUIRED');const [nginx]=JSON.parse(await this.#docker(['inspect',nginxIds[0]]));
  const addresses=Object.values(nginx.NetworkSettings.Networks).map(row=>row.IPAddress).filter(Boolean);assert(addresses.length===1,'ONLINE_GATE_NGINX_NETWORK_AMBIGUOUS');
  const facts=(row,port,suffix='/')=>({containerId:row.containerId,image:row.image,startedAt:row.startedAt,url:'http://'+row.privateAddress+':'+port+suffix});
  const targets={backend:facts(backend,5000,'/api/ready'),frontend:facts(front,3000),inquiry:facts(inquiry,3001),
   nginx:{containerId:nginx.Id,image:nginx.Image,startedAt:nginx.State.StartedAt,url:'http://'+addresses[0]+':80/healthz'}};
  const accepted=require('./online-release-host-kernel.cjs').readOnlineReleaseEvidence(target.input.evidenceDirectory,target.input);accepted.revalidate();
  const [operation]=await this.#database.$queryRaw`SELECT "checkpointJson" FROM deployment_operations WHERE id=${this.#owner.deploymentId}`;
  assert(operation?.checkpointJson,'ONLINE_GATE_CURRENT_DATA_CHECKPOINT_REQUIRED');const checkpointSha256=sha(bytes(operation.checkpointJson));
  const now=Date.now(),decision={format:'sabalan-original-online-deployment-gates/v1',deploymentId:this.#owner.deploymentId,releaseId,
   manifestSha256:target.input.manifestSha256,checkpointSha256,targets,issuedAt:new Date(now).toISOString(),expiresAt:new Date(now+600000).toISOString()};
  const envelope={format:'sabalan-signed-online-deployment-gates/v1',decision,signature:sign(null,Buffer.concat([Buffer.from('sabalan-original-online-deployment-gates/v1\n'),bytes(decision)]),this.#key).toString('base64')};
  const directory=actor.scope.coordinationDirectory+'/online/gates-'+randomBytes(32).toString('hex');
  assert(this.#project==='sabalanerp','ONLINE_PRODUCTION_GATE_CONTROL_RUNNER_REQUIRED');
  const provisioning=OriginalOnlineReleaseController.prototype.readCarrierProvisioningTarget.call(this);
  const compose=['compose','-p',this.#project,'-f',provisioning.composeFile,'-f',provisioning.onlineOverlayFile,'-f',provisioning.storageOverlayFile];
  const environment={DEPLOYMENT_BACKEND_IMAGE:backend.image};
  const resolved=JSON.parse(await this.#docker([...compose,'config','--format','json'],null,environment)),service=resolved.services?.deployment;
  assert(service?.image===backend.image&&service.environment?.BACKEND_RUNTIME_ROLE==='control','ONLINE_GATE_FIXED_CONTROL_IMAGE_REQUIRED');
  const name='online-gates-'+randomBytes(32).toString('hex');
  const gateControl={name,containerId:null,closed:false};this.#gateControls.set(name,gateControl);
  const keeper="import signal,sys,time;signal.signal(signal.SIGTERM,lambda *_:sys.exit(0));time.sleep(2147483647)";
  const controlId=await this.#withOriginalCarrierCensus(async()=>{const id=(await this.#docker([...compose,'run','--detach','--no-deps','--name',name,'--entrypoint','/usr/bin/python3','deployment','-I','-B','-c',keeper],null,environment)).trim();
    assert(/^[a-f0-9]{64}$/.test(id),'ONLINE_GATE_ORIGINAL_CONTROL_ID_REQUIRED');this.#originalCreatedCarrierIds.add(id);return id;});
  const [control]=JSON.parse(await this.#docker(['inspect',controlId]));assert(control.Id===controlId&&control.Image===backend.image&&control.State.Running,'ONLINE_GATE_CONTROL_INCARNATION_CHANGED');
  gateControl.containerId=controlId;
  assert(control.Mounts.some(row=>row.Destination==='/run/sabalan-online'&&!row.RW)
    &&control.Mounts.some(row=>row.Destination===service.environment.DEPLOYMENT_REMOTE_MOUNT),'ONLINE_GATE_CONTROL_MOUNTS_REQUIRED');
  const wrapper="import os,sys,json\np=json.load(sys.stdin)\nos.mkdir(p['directory'],0o700)\nf=p['directory']+'/context.json'\nfd=os.open(f,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o400)\nwith os.fdopen(fd,'w') as s: s.write(p['context']);s.flush();os.fsync(s.fileno())\nos.environ.update(p['environment'])\nos.environ['DEPLOYMENT_ONLINE_GATE_CONTEXT']=f\nos.environ['DEPLOYMENT_REPORT_DIR']=p['directory']\nos.chdir('/app')\nos.execvp('node',['node','/app/dist/scripts/deployment-gates.js'])";
  const output=await this.#docker(['exec','-i',controlId,'/usr/bin/python3','-I','-B','-c',wrapper],Buffer.from(JSON.stringify({directory,context:JSON.stringify(envelope),environment:{
   BACKEND_RUNTIME_ROLE:'control',DATABASE_URL:this.#databaseUrl,DEPLOYMENT_ID:this.#owner.deploymentId,DEPLOYMENT_RELEASE_ID:releaseId,
   DEPLOYMENT_TARGET_COMMIT:accepted.manifest.sourceCommit,DEPLOYMENT_GATE_MODE:'RELEASE',RECOVERY_COORDINATION_DIR:actor.scope.coordinationDirectory,
   DEPLOYMENT_REMOTE_MOUNT:service.environment.DEPLOYMENT_REMOTE_MOUNT,INQUIRY_RECOVERY_SOURCE_DIR:'/data'}})));
  const response=JSON.parse(output.trim().split('\n').at(-1)),report=response.report;
  const required=['postgres-query-and-isolated-write','migration-history','shipment-statement-runtime-state','contract-financial-evidence','inquiry-sqlite-integrity','backend-readiness','frontend-health','inquiry-health','nginx-health','contracts-storage','hr-storage','accounting-storage','support-storage','performance-export-storage','uploads-storage','database-file-references','checkpoint-manifest','database-connection-capacity'];
  assert(response.ok===true&&report?.format==='sabalan-deployment-report'&&report.mode==='RELEASE'&&report.deploymentId===this.#owner.deploymentId
   &&report.releaseId===releaseId&&report.manifestSha256===target.input.manifestSha256&&report.checkpointSha256===checkpointSha256
   &&report.originalGateContextSha256===sha(Buffer.from(JSON.stringify(envelope)))&&sha(bytes(report.originalTargets))===sha(bytes(targets))
   &&report.gates?.length===required.length&&new Set(report.gates.map(row=>row.name)).size===required.length
   &&required.every(name=>report.gates.some(row=>row.name===name&&row.passed===true)),'ONLINE_ORIGINAL_PRODUCTION_GATES_FAILED');
  await this.assertOwned(['ONLINE_READY','ONLINE_PUBLISHING','ONLINE_ROLLBACK_PUBLISHING']);
  await this.#docker(['stop','--time','-1',controlId]);const exit=(await this.#docker(['wait',controlId])).trim();assert(exit==='0','ONLINE_GATE_CONTROL_CLOSE_UNPROVEN');
  await this.#docker(['rm',controlId]);
  gateControl.closed=true;
  this.#productionGates.set(releaseId,{report:structuredClone(report),sha256:sha(bytes(report)),targets:structuredClone(targets),runtimeId,expiresAt:decision.expiresAt});
  return {releaseId,originalProductionGatesPassed:true,reportSha256:sha(bytes(report)),publicTrafficQualified:false};
 }
 async #assertOriginalProductionGates(releaseId){
  const row=this.#productionGates.get(releaseId),target=this.#releases.get(releaseId);assert(row&&target,'ONLINE_ORIGINAL_PRODUCTION_GATES_REQUIRED');
  assert(Date.now()<Date.parse(row.expiresAt),'ONLINE_ORIGINAL_PRODUCTION_GATES_EXPIRED');
  const [operation]=await this.#database.$queryRaw`SELECT "reportJson","checkpointJson" FROM deployment_operations WHERE id=${this.#owner.deploymentId}`;
  assert(sha(bytes(operation?.reportJson))===row.sha256&&sha(bytes(operation?.checkpointJson))===row.report.checkpointSha256,'ONLINE_ORIGINAL_GATE_DATABASE_READBACK_CHANGED');
  for(const expected of Object.values(row.targets)){
   const [actual]=JSON.parse(await this.#docker(['inspect',expected.containerId]));
   assert(actual.Id===expected.containerId&&actual.Image===expected.image&&actual.State.StartedAt===expected.startedAt&&actual.State.Running,'ONLINE_GATE_TARGET_BIRTH_CHANGED');
  }
  const actor=this.#children.get(row.runtimeId);assert(actor&&!actor.closed&&!actor.drainingFenceCommitted&&actor.events.some(event=>event.event==='READY'),'ONLINE_GATE_HTTP_CUSTODY_CHANGED');
 }
 async publish({registry,expectedPublicationSha256,releaseId,previousReleaseId,rollback=false}){
  await this.assertOwned([rollback?'ONLINE_ROLLBACK_PUBLISHING':'ONLINE_PUBLISHING']);
  assert(this.#accepted,'ONLINE_REGISTERED_TYPED_EVIDENCE_REQUIRED');
  const target=this.#releases.get(releaseId);assert(target,'ONLINE_TARGET_NOT_ORIGINALLY_REGISTERED');
  await this.#assertOriginalProductionGates(releaseId);
  const accepted=require('./online-release-host-kernel.cjs').readOnlineReleaseEvidence(
    target.input.evidenceDirectory,target.input);
  accepted.revalidate();
  const prior=await this.#store.readPublication();
  assert(prior.publicationSha256===expectedPublicationSha256,'ONLINE_PUBLICATION_PREDECESSOR_CHANGED');
  const current=registry.builds.find(build=>build.id===registry.current?.erp);
  const qualified=qualifiedBrowserBuilds({browserRegistries:accepted.browserRegistries,imageGraphs:accepted.acceptance.qualification.imageGraphs,deploymentTargetImages:accepted.acceptance.qualification.deploymentTargetImages});
  const semantic=build=>({id:build.id,application:build.application,image:build.image,
    manifestSha256:build.manifestSha256,assets:build.assets,actionIds:build.actionIds});
  const stable=build=>({id:build.id,application:build.application,slotId:build.slotId,image:build.image,
    manifestSha256:build.manifestSha256,assets:build.assets,actionIds:build.actionIds});
  assert(current&&qualified.some(build=>sha(bytes(semantic(build)))===sha(bytes(semantic(current)))),
    'ONLINE_PAIRED_UI_NOT_QUALIFIED');
  await this.#assertOriginalUiCarrier(current);
  const inquiryBuild=registry.builds.find(build=>build.application==='inquiry'&&build.id===registry.current?.inquiry);
  assert(inquiryBuild&&qualified.some(build=>sha(bytes(semantic(build)))===sha(bytes(semantic(inquiryBuild)))),'ONLINE_INQUIRY_BROWSER_NOT_QUALIFIED');
  await this.#assertOriginalInquiryCarrier(inquiryBuild);
  const binding=registry.apiBindings?.find(value=>value.buildId===current.id);
  const runtime=target.input.scopes.find(value=>value.scope.releaseId===releaseId&&value.scope.purpose==='http'
    &&binding?.slotId==='backend_'+value.scope.runtimeId&&binding.image===value.scope.image
    &&binding.manifestSha256===value.scope.manifestSha256);
  const original=runtime&&this.#children.get(runtime.scope.runtimeId);
  assert(runtime&&original&&!original.closed&&original.events.some(event=>event.event==='READY')
    &&binding.browserManifestSha256===current.manifestSha256,'ONLINE_PAIRED_ORIGINAL_BACKEND_NOT_READY');
  // Every retained build remains paired to its exact original backend binding.
  for(const build of prior.registry.builds){
    assert(registry.builds.some(next=>sha(bytes(stable(next)))===sha(bytes(stable(build)))),
      'ONLINE_RETAINED_UI_IDENTITY_CHANGED');
    if(build.id!==current.id){const old=prior.registry.apiBindings.find(value=>value.buildId===build.id);
      if(old)assert(registry.apiBindings.some(next=>sha(bytes(next))===sha(bytes(old))),'ONLINE_RETAINED_API_CHANGED');}
  }
  // SQL generation changes only after the SAME store's durable readback.
  try{
   const result=await this.#store.publish(registry,expectedPublicationSha256);
   const observed=await this.#store.readPublication();
   assert(result.publicationSha256===observed.publicationSha256&&result.generation===observed.generation,'ONLINE_PUBLICATION_READBACK_CHANGED');
   await this.verifyCommonEdgePublication(observed.publicationSha256);
   const {recordOwnedOnlinePublication}=require('./online-release-host-kernel.cjs');
   const receipt=await recordOwnedOnlinePublication(this.#database,this.#owner,{releaseId,previousReleaseId,rollback,
    generation:result.generation,publicationSha256:result.publicationSha256});
   this.#currentServingReleaseId=releaseId;this.#lastPublicationSha=result.publicationSha256;return receipt;
  }catch(error){this.#held='PUBLICATION_OUTCOME_REQUIRES_SAME_ORIGINAL_OWNER';throw error;}
 }
 assertAllOriginalChildrenClosed(){
  assert([...this.#gateControls.values()].every(row=>row.closed),'ONLINE_ORIGINAL_GATE_CONTROL_CUSTODY_UNRESOLVED');
  assert(this.#carrierFailures.length===0,'ONLINE_ORIGINAL_CARRIER_CUSTODY_UNRESOLVED');
  assert(!this.#edge||(this.#edge.closed&&this.#edge.code===0&&this.#edge.signal===null&&this.#edge.events.some(row=>row.event==='CLOSED')),'ONLINE_ORIGINAL_EDGE_NOT_CLOSED');
  assert(this.#observers.every(state=>state.closed)&&[...this.#children.values(),...this.#inquiryActors.values()].every(state=>state.closed&&state.nativeClosureVerified),'ONLINE_ORIGINAL_CHILDREN_NOT_CLOSED');
  return {originalChildren:[...this.#children].map(([runtimeId,s])=>({runtimeId,pid:s.child.pid,code:s.code,signal:s.signal})),
   qualificationSucceeded:false,nativeClosureVerified:false};
 }
 retainOriginalContextFailure(){this.#held='ONLINE_ORIGINAL_CONTINUITY_CHANNEL_UNKNOWN';return this.hold();}
 async hold(){await new Promise(()=>{setInterval(()=>{},1000);});}
}
