/** Synthetic parser fixtures only. Never written as operational acceptance. */
import { createHash } from 'node:crypto';
import {checkpointMetadataTransport} from '../../backend/src/services/deploymentCheckpointMetadataIdentity';
import {canonicalRealtimeTargets,realtimeCommandId} from '../../backend/src/services/onlineRealtimeBridgeIdentity';
import type { OnlineQualificationBinding, OnlineQualificationScope, OnlineQualificationRuntimeIdentity } from '../../backend/src/services/onlineQualificationEvidence';
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const bytes = (value: any) => Buffer.from(JSON.stringify(canonical(value)) + '\n');
const hash = (value: any) => createHash('sha256').update(bytes(value)).digest('hex');
export function syntheticQualificationIdentities(binding:Pick<OnlineQualificationBinding,'releaseId'|'sourceCommit'|'runtimeBundleSha256'|'images'|'deploymentTargetImages'|'sourceDatabase'>) {
  const actor=(runtimeId:string,purpose:'http'|'jobs'='http'):OnlineQualificationRuntimeIdentity=>({runtimeId,purpose,releaseId:binding.releaseId,sourceCommit:binding.sourceCommit,image:binding.images.backend,runtimeBundleSha256:binding.runtimeBundleSha256});
  return { proofDatabases:{'compatible-migrations':{...binding.sourceDatabase},'browser-24-hours':{...binding.sourceDatabase},
      'single-worker-and-completion':{name:'unit_local_restored',systemIdentifier:binding.sourceDatabase.systemIdentifier,oid:'88'},
      'current-domain':{name:'unit_local_restored',systemIdentifier:binding.sourceDatabase.systemIdentifier,oid:'88'},
      'coherent-independent-restore':{name:'unit_restored',systemIdentifier:'987',oid:'99'}},
    componentSourceCommits:{backend:binding.sourceCommit,frontend:binding.sourceCommit,inquiry:'f'.repeat(40)},
    runtimeCohorts:{'compatible-migrations':[actor('a'.repeat(64))], 'coherent-independent-restore':[{...actor('9'.repeat(64)),image:binding.deploymentTargetImages.backend}],
      'browser-24-hours':[actor('a'.repeat(64))], 'single-worker-and-completion':[actor('1'.repeat(64)),{...actor('2'.repeat(64)),releaseId:'unit_prior_release',image:'sha256:'+'e'.repeat(64),sourceCommit:'e'.repeat(40),runtimeBundleSha256:'e'.repeat(64)},actor('3'.repeat(64),'jobs'),{...actor('4'.repeat(64),'jobs'),releaseId:'unit_prior_release',image:'sha256:'+'e'.repeat(64),sourceCommit:'e'.repeat(40),runtimeBundleSha256:'e'.repeat(64)}],
      'current-domain':[actor('1'.repeat(64))]} };
}
export function syntheticQualificationImageGraphs(images:OnlineQualificationBinding['images'],deploymentTargetImages:OnlineQualificationBinding['deploymentTargetImages']){
  return Object.fromEntries((['backend','frontend','inquiry'] as const).map(role=>[role,{index:images[role],config:deploymentTargetImages[role],platform:'sha256:'+hash({role,platform:true}),rootfsDiffIds:['sha256:'+hash({role,layer:1})],archiveSha256:hash({role,archive:true}),archiveBytes:1024}])) as OnlineQualificationBinding['imageGraphs'];
}
export function syntheticCheckpointMetadata(binding: Pick<OnlineQualificationBinding,'releaseId'|'checkpointArchiveChecksum'|'deploymentTargetDatabase'|'recoveryMode'|'qualificationCheckpoint'>) {
  if(binding.qualificationCheckpoint)return structuredClone(binding.qualificationCheckpoint.metadata);
  return { id: 'unit-checkpoint', deploymentId: 'unit-checkpoint', releaseId: binding.releaseId,
    checksum: binding.checkpointArchiveChecksum, size: 123, remoteVerified: true, restoreVerified: true,
    sourceDatabase: {...binding.deploymentTargetDatabase},captureMethod:binding.recoveryMode,
    sourceMachineUuidSha256: '1'.repeat(64), sourceKernelBootIdSha256: '2'.repeat(64),
    ...(binding.recoveryMode==='ONLINE_COHERENT_WAL'?{physicalPoint:{sealedManifestSha256:'a'.repeat(64),plaintextManifestSha256:'b'.repeat(64),cipherInventorySha256:'c'.repeat(64),restorePoint:{name:'unit_cut',lsn:'0/100',requiredWalEndLsn:'0/200',timeline:1}}}:{}),
    ...(binding.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE'?{manifest:{format:'sabalan-recovery',packageType:'COMPLETE',components:[
      {path:'database/main.dump',sha256:'a'.repeat(64),size:123},{path:'inquiry/inquiry.db',sha256:'b'.repeat(64),size:123},
      {path:'files/contracts/اصل.pdf',sha256:'c'.repeat(64),size:7}]}}:{}) };
}
export function syntheticQualificationProof(scope: OnlineQualificationScope, binding: OnlineQualificationBinding): any {
  const database = binding.proofDatabases[scope];
  const closure = (identity:OnlineQualificationRuntimeIdentity) => {
  const {runtimeId,purpose}=identity;
  const namespace='sabalan-rt-'+createHash('sha256').update(runtimeId,'ascii').digest('hex').slice(0,48);
  const worker=purpose==='jobs'?{file:'/unit/coordination/worker.lock',device:'1',inode:'3',ownerUid:0}:null;
  const nativeScope = { runtimeId, nonce:runtimeId, purpose,worker, role: purpose === 'http' ? 'serving' : 'control', sourceCommit: identity.sourceCommit,
    releaseId: identity.releaseId, image: identity.image, manifestSha256: identity.runtimeBundleSha256 };
  const scopeSha256 = hash(nativeScope);
  const active = { format: 'sabalan-runtime-native/v1', phase: 'ACTIVE', guardian: { pid: 123,bootId:'11111111-1111-1111-1111-111111111111' },
    ...(worker?{onlineLocks:{worker:{...worker,descriptor:12}}}:{}),
    clusterIdentifier: database.systemIdentifier, initialDatabase: { name: database.name, oid: database.oid },
    onlineScope: { sha256: scopeSha256, scope: nativeScope } };
  const activeClaimSha256 = hash(active), claimNative = { scopeSha256, claimSha256: activeClaimSha256 };
  const native = { ...active, phase: 'QUIESCENT', activeClaimSha256, nativeReaped: true,
    databaseQuiet: true, nativeStatus: 0, stoppedBySignal: false };
  const provision={format:'sabalan-runtime-namespace/v1',scope:{runtimeId,image:identity.image,registrySha256:identity.runtimeBundleSha256,generation:2,postgresApplicationName:namespace,gate:{device:'1',inode:'2',ownerUid:0}}};
  const claim = { format: 'sabalan-runtime-claim/v2', scopeSha256:hash(provision),native: claimNative };
  const work = { format: 'sabalan-runtime-boundary/v1', phase: 'QUIESCENT', claimSha256: hash(claim) };
  return { runtimeId, activeClaimSha256, originalPopenPid: 123, originalReturncode: 0, claimNative,
      nativeRawBase64: bytes(native).toString('base64'), workRawBase64: bytes(work).toString('base64'),
      workClaimRawBase64: bytes(claim).toString('base64'),workScopeRawBase64:bytes(provision).toString('base64'), freshSql: { namespace,visible: true, systemIdentifier: database.systemIdentifier,
        databaseOid: database.oid, namespaceSessions: 0, prepared: 0 } };
  };
  const source: any = { ...binding, format: 'sabalan-application-native/v1', productionAdmission: true, passResult: true,
    executionKind:['compatible-migrations','browser-24-hours'].includes(scope)?'DIAGNOSTIC_SUPPORT':'INSTALLED_RUNTIME',
    proofDatabase:database,originalNativeClosures: binding.runtimeCohorts[scope].map(closure) };
  if (scope === 'compatible-migrations') Object.assign(source, { diagnosticExpansionApplied: false,
    ownedMigration: { financialSchemaQualified: true, steps: [] }, originalHistory: { rows: 437, sha256: 'c'.repeat(64) },
    history: { rows: 437, sha256: 'c'.repeat(64) }, priorMigrationHistorySha256: 'c'.repeat(64) });
  if (scope === 'coherent-independent-restore') Object.assign(source, {
    format: 'sabalan-native-application-coherent-integration/v1', restoredDatabase: database,
    independentHostQualified: true, continuousWalQualified: false, immutableDifferentImagesQualified: true, inquiryRuntimeQualified: true,
    checkpointMetadata: syntheticCheckpointMetadata(binding),
    checkpointTransportRawBase64:bytes(checkpointMetadataTransport(syntheticCheckpointMetadata(binding))).toString('base64'),
    checkpoint: { ...syntheticCheckpointMetadata(binding),
      remoteVerified: true, restoreVerified: true, sourceMachineUuidSha256: '1'.repeat(64), sourceKernelBootIdSha256: '2'.repeat(64),
      lastDrill: { format: 'sabalan-independent-checkpoint-drill/v1', status: 'HEALTHY', phase: 'COMPLETE', packageType: 'COMPLETE',
        operationId: 'drill-unit-checkpoint-123', checkpointId: syntheticCheckpointMetadata(binding).id, releaseId: syntheticCheckpointMetadata(binding).releaseId,
        checksum: syntheticCheckpointMetadata(binding).checksum, size: 123, sourceMachineUuidSha256: '1'.repeat(64), recoveryMachineUuidSha256: '3'.repeat(64),
        sourceKernelBootIdSha256: '2'.repeat(64), recoveryKernelBootIdSha256: '4'.repeat(64),
        startedAt: '2026-10-20T00:00:00.000Z', completedAt: '2026-10-20T00:01:00.000Z',
        stagedPostgresRestore: true, stagedSqliteIntegrity: true, verifiedFiles: true, verifiedApplicationPayloads: true, verifiedBusinessData: true } },
    components: Object.fromEntries(['postgres', 'sqlite', 'files', 'coordination'].map(name => [name,
      { captureId: binding.captureId, sha256: '5'.repeat(64), bytes: 123, restoredSha256: '5'.repeat(64) }])),
    restoredFileRoots: 9, independentlyVerifiedFileCuts: Array.from({ length: 9 }, (_, i) => ({ name: 'unit-' + i })),
    applicationHealth: Object.fromEntries(Object.entries(binding.deploymentTargetImages).map(([name, image]) => [name,
      { image, sourceCommit: binding.componentSourceCommits[name as keyof typeof binding.componentSourceCommits], captureId: binding.captureId, status: 200, responseSha256: '6'.repeat(64) }])) });
  if(scope==='coherent-independent-restore'&&binding.recoveryMode==='ONLINE_COHERENT_WAL'){
    const point=syntheticCheckpointMetadata(binding).physicalPoint!;
    const report={format:'sabalan-original-independent-online-physical-restore/v1',continuousWalQualified:false,...point,sourceMachineUuidSha256:'1'.repeat(64),sourceKernelBootIdSha256:'2'.repeat(64),recoveryMachineUuidSha256:'3'.repeat(64),recoveryKernelBootIdSha256:'4'.repeat(64),startedAt:'2026-10-20T00:00:00Z',completedAt:'2026-10-20T00:01:00Z',sourceDatabase:binding.deploymentTargetDatabase,
      layout:{format:'sabalan-original-independent-online-layout/v1',captureId:binding.captureId,restorePoint:point.restorePoint,coverage:{timeline:1},
       sourceDatabase:{database:binding.deploymentTargetDatabase.name,databaseOid:binding.deploymentTargetDatabase.oid,systemIdentifier:binding.deploymentTargetDatabase.systemIdentifier},
       restoredFileCuts:Array.from({length:9},(_,i)=>({name:'unit-'+i})),sqlite:{sha256:'d'.repeat(64),bytes:123},physicalBase:{backupManifestSha256:'e'.repeat(64),files:1},coordinationHistory:{sha256:'f'.repeat(64)}},
      restorePoint:point.restorePoint,replay:{inRecovery:false,lastReplayLsn:'0/180',systemIdentifier:binding.deploymentTargetDatabase.systemIdentifier,sourceDatabaseOid:binding.deploymentTargetDatabase.oid},
      originalPgCommands:['pg_verifybackup','pg_waldump','pg_controldata'].map((role,i)=>{const raw=Buffer.from('actual test stdout '+role);return {role,originalPid:100+i,returncode:0,signal:null,stdoutRawBase64:raw.toString('base64'),stdoutSha256:createHash('sha256').update(raw).digest('hex')};}),
      decryption:{format:'sabalan-original-independent-online-components/v1',sealedSha256:point.sealedManifestSha256,manifestSha256:point.plaintextManifestSha256,fullGcmAuthenticated:true,independentRsaDecryptVerified:true,
       components:Array.from({length:15},(_,i)=>({name:'object-'+i,sha256:'d'.repeat(64),cipherSha256:'e'.repeat(64),bytes:12,cipherBytes:124}))}};
    source.physicalRestoreRawBase64=bytes(report).toString('base64');
    delete source.checkpoint.lastDrill;
    const request={format:'sabalan-original-wal-window-verification-request/v1',sequence:1,challenge:'7'.repeat(64),deploymentId:'unit-checkpoint',releaseId:binding.releaseId,windowSha256:'8'.repeat(64),startLsn:'0/0',endLsn:'0/300',
      sourceIdentity:{systemIdentifier:binding.deploymentTargetDatabase.systemIdentifier,timeline:1},objects:[{name:'000000010000000000000000',bytes:16777216,sha256:'9'.repeat(64)}]};
    const closure={phase:'COMPLETE',nativeReaped:true,databaseQuiet:true,nativeStatus:0,startLsn:'0/0',endLsn:'0/300',source:{systemIdentifier:binding.deploymentTargetDatabase.systemIdentifier,timeline:1}};
    const seal={format:'sabalan-wal-seal/v1',phase:'SEALED',captureSha256:createHash('sha256').update(bytes(closure)).digest('hex'),range:{startLsn:'0/0',endLsn:'0/300'},objects:request.objects.map(o=>({name:o.name,encryptedBytes:o.bytes,encryptedSha256:o.sha256}))};
    request.windowSha256=createHash('sha256').update(bytes(seal)).digest('hex');
    const decision={format:'sabalan-original-wal-window-verification/v1',requestSha256:createHash('sha256').update(JSON.stringify(canonical(request))).digest('hex'),challenge:request.challenge,independentTokenSha256:'a'.repeat(64),windowSha256:request.windowSha256,sourceIdentity:request.sourceIdentity,objects:request.objects,issuedAt:'2026-10-20T00:01:00Z',expiresAt:'2026-10-20T00:11:00Z'};
    const birth={pid:200,startTicks:'1000',bootId:'11111111-1111-1111-1111-111111111111',pidNamespace:'pid:[123]'};
    source.liveWalCoverage={format:'sabalan-original-live-wal-coverage/v1',phase:'LIVE_ORIGINAL_OWNER',finalIntervalCompletion:false,captureId:binding.captureId,sourceDatabase:binding.deploymentTargetDatabase,timeline:1,
      observedAt:'2026-10-20T00:02:00Z',originalOwner:birth,coveredFromLsn:'0/0',coveredThroughLsn:'0/350',closedWindows:[{startLsn:'0/0',endLsn:'0/300',acceptedAt:'2026-10-20T00:01:01Z',sealRawBase64:bytes(seal).toString('base64'),closureRawBase64:bytes(closure).toString('base64'),requestRawBase64:bytes(request).toString('base64'),certificateRawBase64:bytes({format:'sabalan-signed-original-wal-window-verification/v1',decision,signature:Buffer.alloc(64,1).toString('base64')}).toString('base64')}],
      successor:{originalPid:201,originalDockerPid:9001,segmentBytes:16777216,startLsn:'0/200',endLsn:'0/600',activeRawBase64:bytes({...birth,pid:201,phase:'ACTIVE',configurationSha256:'a'.repeat(64),source:{systemIdentifier:binding.deploymentTargetDatabase.systemIdentifier,timeline:1}}).toString('base64'),sender:{pid:300,backendStart:'2026-10-20T00:01:00Z',state:'streaming',flushLsn:'0/350'}}};
  }
  if (scope === 'browser-24-hours') Object.assign(source, { format: 'sabalan-actual-native-browser/v1', actualCompiledPages: true,
    actualCanonicalAuthorization: true, realElapsed24HoursQualified: false, oldFormSubmittedAfterSwitch: true, newFormSubmittedOnNewSlot: true,
    retainedBuilds: ['erp', 'inquiry'].map(application => ({ application, buildId: 'unit-'+application, image: binding.images[application==='erp'?'frontend':'inquiry'], retiredAt: '2026-10-19T00:00:00.000Z',
      supportUntil: '2026-10-20T00:00:00.000Z', observedAt: '2026-10-19T00:00:01.000Z',
      coverage: application==='erp'?['api','assets','draft-expiry','rsc','sessions','sockets']:['assets','draft-expiry','inquiry-actions','rsc','sessions'], formInventorySha256: '7'.repeat(64),
      exercisedFormInventorySha256: '7'.repeat(64), savedBeforeRequiredRefresh: true, accountIsolationVerified: true })) });
  if(scope==='browser-24-hours') {
    const pair=syntheticQualificationProof('single-worker-and-completion',binding);
    const http=binding.runtimeCohorts['single-worker-and-completion'].filter(actor=>actor.purpose==='http').slice(0,2);
    const builds=http.map((actor,index)=>({id:'installed_'+index,application:'erp',slotId:'frontend_installed_'+index,
      image:index===0?binding.images.frontend:'sha256:'+'d'.repeat(64),manifestSha256:'b'.repeat(64),assets:[],actionIds:[],retiredAt:null,supportUntil:null}));
    const pairedRegistry={format:'sabalan-browser-routing/v2',generation:1,current:{erp:builds[0].id,inquiry:'current_inquiry'},legacy:{erp:builds[1].id,inquiry:null},builds,
      apiBindings:http.map((actor,index)=>({buildId:builds[index].id,browserManifestSha256:builds[index].manifestSha256,slotId:'backend_'+actor.runtimeId,image:actor.image,manifestSha256:actor.runtimeBundleSha256}))};
    const normalized={...pairedRegistry,builds:[...pairedRegistry.builds].sort((a,b)=>a.id.localeCompare(b.id)),apiBindings:[...pairedRegistry.apiBindings].sort((a,b)=>a.buildId.localeCompare(b.buildId))};
    const registryIdentity=createHash('sha256').update(JSON.stringify(canonical(normalized))).digest('hex');
    const publication=bytes({format:'sabalan-browser-publication/v1',generation:1,previousPublicationSha256:null,registryIdentity,registry:pairedRegistry});
    source.installedRouting={format:'sabalan-original-installed-browser-routing/v1',proofDatabase:binding.proofDatabases['single-worker-and-completion'],
      originalNativeClosures:pair.originalNativeClosures.filter((row:any)=>http.some(actor=>actor.runtimeId===row.runtimeId)),
      publicationRawBase64:publication.toString('base64'),publicationSha256:createHash('sha256').update(publication).digest('hex'),
      executions:http.map((actor,index)=>{
        const intent={format:'sabalan-browser-operation/v1',id:String(index+1).repeat(32),instanceId:'e'.repeat(64),generation:1,
          registryIdentity,buildId:builds[index].id,slotId:'backend_'+actor.runtimeId,image:actor.image,manifestSha256:actor.runtimeBundleSha256,method:'POST',startedAt:'2026-10-20T00:00:00.000Z'};
        const intentRaw=bytes(intent),completion=bytes({format:'sabalan-browser-operation-completion/v1',id:intent.id,instanceId:intent.instanceId,intentSha256:createHash('sha256').update(intentRaw).digest('hex'),outcome:'UPSTREAM_ENDED',completedAt:'2026-10-20T00:00:01.000Z'});
        const client=bytes({format:'sabalan-installed-browser-form-response/v1',operationId:intent.id,buildId:intent.buildId,image:builds[index].image,runtimeId:actor.runtimeId,method:'POST',status:201,requestCount:1,automaticNavigation:false,originalClientClosed:true,responseSha256:'a'.repeat(64),storedBusinessReceiptSha256:'b'.repeat(64)});
        return {runtimeId:actor.runtimeId,intentRawBase64:intentRaw.toString('base64'),completionRawBase64:completion.toString('base64'),clientRawBase64:client.toString('base64')};
      })};
    const registry={format:'sabalan-browser-routing/v2',current:{erp:'current-erp',inquiry:'current-inquiry'},builds:[
      ...source.retainedBuilds.map((build:any)=>({...build,id:build.buildId})),
      ...['erp','inquiry'].map(application=>({id:'current-'+application,application,retiredAt:null,image:binding.images[application==='erp'?'frontend':'inquiry']}))]};
    const raw=bytes(registry);source.routingRegistryRawBase64=raw.toString('base64');source.routingRegistrySha256=createHash('sha256').update(raw).digest('hex');
    for(const build of source.retainedBuilds)build.execution={buildId:build.buildId,image:build.image,registrySha256:source.routingRegistrySha256,
      startedAt:'2026-10-19T00:00:00.500Z',completedAt:'2026-10-19T00:00:01.500Z'};
  }
  if (scope === 'single-worker-and-completion') source.singleWorker = { maximumConcurrentOwners: 1, originalHandoffCompleted: true,
    unknownOwners: 0, unresolvedCommands: 0, nativeJobsObserved: true, httpTargetCount: 2,targetRuntimeIds:binding.runtimeCohorts[scope].filter(actor=>actor.purpose==='http').slice(0,2).map(actor=>actor.runtimeId),rowFenceVerified: true };
  if(scope==='single-worker-and-completion'){
    const actors=binding.runtimeCohorts[scope],ids=source.singleWorker.targetRuntimeIds;
    const targets=canonicalRealtimeTargets(ids.map((id:string)=>{const actor=actors.find(actor=>actor.runtimeId===id)!;return {runtimeId:id,nonceSha256:createHash('sha256').update(id).digest('hex'),releaseId:actor.releaseId,imageIdentity:actor.image};}));
    const jobs=actors.find(actor=>actor.purpose==='jobs'&&actor.releaseId===binding.releaseId)!;
    const oldJobs=actors.find(actor=>actor.purpose==='jobs'&&actor.releaseId!==binding.releaseId)!;
    const proofIds={batchIds:['1'.repeat(64),'2'.repeat(64)],outboxId:'unit-outbox',intentId:'unit-intent',personnelId:'unit-person',personnelLastName:'unit-change'};
    const batches=['NOTIFICATION','HR_PERSONNEL_INVALIDATION'].map((kind,index)=>({id:proofIds.batchIds[index],kind,producerRuntimeId:(index===0?oldJobs:jobs).runtimeId,producerNonceSha256:createHash('sha256').update((index===0?oldJobs:jobs).runtimeId).digest('hex'),targetsJson:targets.targets,targetsSha256:targets.sha256}));
    const proof={format:'sabalan-private-pair-bridge-proof/v1',qualificationId:'9'.repeat(64),workerHandoff:{oldJobsRuntimeId:oldJobs.runtimeId,newJobsRuntimeId:jobs.runtimeId,oldNativeSha256:createHash('sha256').update(Buffer.from(source.originalNativeClosures.find((row:any)=>row.runtimeId===oldJobs.runtimeId).nativeRawBase64,'base64')).digest('hex')},ids:proofIds,
      clientObservations:ids.map((runtimeId:string)=>({runtimeId,authenticated:true,originalSocketClosed:true,observedEvents:['notification.created','hr.personnel.changed']})),
      durable:{batches,commands:batches.flatMap(batch=>targets.targets.map(target=>({id:realtimeCommandId(batch.id,target),batchId:batch.id,runtimeId:target.runtimeId,status:'SETTLED',claimToken:'unit-token',startedAt:'2026-10-20T00:00:00Z',settledAt:'2026-10-20T00:00:01Z'}))),
       outbox:{id:proofIds.outboxId,status:'PROCESSED',processedAt:'2026-10-20T00:00:01Z'},intent:{id:proofIds.intentId,originRuntimeId:ids[0],sourceOutcome:'READY',deliveryStatus:'SETTLED',sourceSettledAt:'2026-10-20T00:00:00Z',deliverySettledAt:'2026-10-20T00:00:01Z'},personnel:{id:proofIds.personnelId,lastName:proofIds.personnelLastName}}};
    const raw=bytes(proof);source.bridgeProofRawBase64=raw.toString('base64');source.bridgeAfterDrain={format:'sabalan-private-pair-bridge-after-drain/v1',proofSha256:createHash('sha256').update(raw).digest('hex'),passResult:true,historyUnchanged:true,durableAcknowledgmentsUnchanged:true};
  }
  if(scope==='single-worker-and-completion'){
    const jobs=source.originalNativeClosures.filter((closure:any)=>binding.runtimeCohorts[scope].find(actor=>actor.runtimeId===closure.runtimeId)?.purpose==='jobs');
    jobs.sort((a:any,b:any)=>Number(binding.runtimeCohorts[scope].find(actor=>actor.runtimeId===a.runtimeId)?.releaseId===binding.releaseId)-Number(binding.runtimeCohorts[scope].find(actor=>actor.runtimeId===b.runtimeId)?.releaseId===binding.releaseId));
    source.workerOwnershipIntervals=jobs.map((closure:any,index:number)=>({runtimeId:closure.runtimeId,activeClaimSha256:closure.activeClaimSha256,
      bootId:'11111111-1111-1111-1111-111111111111',admissionRequestedMonotonicNs:String(index*1000+100),exclusiveClaimObservedMonotonicNs:String(index*1000+200),controlClosedMonotonicNs:String(index*1000+900)}));
  }
  if (scope === 'current-domain') Object.assign(source, { writerCoverage: { remaining: [], startupOnly: [] },
    domainCases: ['accounting', 'contracts', 'dispatch', 'hr', 'inquiry', 'personnel-performance', 'security', 'support', 'uploads']
      .map(domain => ({ domain, status: 'COMPLETE', receiptSha256: '8'.repeat(64), actualCanonicalRuntime: true, schemaSha256: binding.schemaSha256 })) });
  if(scope==='coherent-independent-restore'&&binding.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE'){
    const roots=['storage/contracts','storage/hr-hiring','storage/accounting-contracts','storage/dispatch-documents','storage/support-tickets','storage/performance-exports',
      'uploads/images','uploads/security-shift-log','uploads/security-vehicle-pairs'];
    const rootBindings=roots.map((relative,index)=>({name:'root-'+index,sourceLiveRoot:'/app/'+relative,restoredLiveRoot:'/unit/restored/'+relative,
      payloadPrefix:'files/'+relative.replace(/^storage\//,'')}));
    const restoreRaw=bytes({ok:true,drill:source.checkpoint.lastDrill});
    const baseline={format:'sabalan-application-restored-file-baseline/v1',captureSource:'canonical-complete-package',
      capturedManifest:{path:'/unit/original-restore-output.json',sha256:createHash('sha256').update(restoreRaw).digest('hex')},sources:rootBindings.map(row=>({name:row.name,liveRoot:row.restoredLiveRoot,storeRoot:'/unit/versions/'+row.name,directories:[],
        files:source.checkpointMetadata.manifest.components.filter((component:any)=>component.path.startsWith(row.payloadPrefix+'/')).map((component:any)=>({key:component.path.slice(row.payloadPrefix.length+1),bytes:component.size,sha256:component.sha256}))}))};
    const baselineRaw=bytes(baseline),pointSha=binding.qualificationCheckpoint?.metadataSha256??binding.checkpointSha256;
    source.protectedDirectoryComponents={format:'sabalan-original-protected-directory-restore/v1',checkpointSha256:pointSha,
      canonicalRestoreOutputRawBase64:restoreRaw.toString('base64'),baselineRawBase64:baselineRaw.toString('base64'),baselineSha256:createHash('sha256').update(baselineRaw).digest('hex'),rootBindings};
    for(const health of Object.values(source.applicationHealth) as any[])health.checkpointMetadataSha256=pointSha;
  }
  return source;
}
