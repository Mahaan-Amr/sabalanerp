import { createHash } from 'node:crypto';
import { hasHealthyIndependentCheckpointDrill } from './deploymentCheckpointPolicy';
import { snapshotOnlineSupportWindow } from './onlineReleaseSupportWindow';
import { compileOnlineExpansion } from './onlineMigrationPlan';
import {canonicalRealtimeTargets,realtimeCommandId} from './onlineRealtimeBridgeIdentity';
import { runtimeNativePostgresApplicationName } from './runtimeBoundaryJournal';
import {assertOriginalIndependentPhysicalPoint} from './onlinePhysicalCheckpointEvidence';
import {readCanonicalCheckpointMetadata} from './deploymentCheckpointMetadataIdentity';
import {validateProductionExecutionBindings,type ProductionImageExecutionBindings} from './onlineImageExecutionBinding';
import {assertProtectedFinancialQualificationSource,type ProtectedFinancialQualificationBinding,type ProtectedFinancialQualificationArtifacts} from './protectedFinancialQualificationProvenance';

export type OnlineQualificationScope = 'compatible-migrations' | 'coherent-independent-restore'
  | 'browser-24-hours' | 'single-worker-and-completion' | 'current-domain';
export type OnlineQualificationRuntimeIdentity = { runtimeId:string;releaseId:string;sourceCommit:string;
  image:string;runtimeBundleSha256:string;purpose:'http'|'jobs' };
export type OnlineQualificationBinding = {
  manifestSha256: string; checkpointSha256: string; checkpointArchiveChecksum: string; releaseId: string; sourceCommit: string;
  runtimeBundleSha256: string; schemaSha256: string; captureId: string;
  sourceDatabase: { name: string; systemIdentifier: string; oid: string };
  recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE'|'ONLINE_COHERENT_WAL';
  qualificationCheckpoint?: {metadataSha256:string;metadata:Record<string,any>};
  proofDatabases: Record<OnlineQualificationScope,{ name: string; systemIdentifier: string; oid: string }>;
  deploymentTargetDatabase: { name: string; systemIdentifier: string; oid: string };
  images: { backend: string; frontend: string; inquiry: string };
  deploymentTargetImages: {backend:string;frontend:string;inquiry:string};
  productionExecutionBindings?:ProductionImageExecutionBindings;
  imageGraphs: Record<'backend'|'frontend'|'inquiry',{index:string;platform:string;config:string;rootfsDiffIds:string[];archiveSha256:string;archiveBytes:number}>;
  componentSourceCommits: {backend:string;frontend:string;inquiry:string};
  runtimeCohorts: Record<OnlineQualificationScope, OnlineQualificationRuntimeIdentity[]>;
  protectedFinancial?:ProtectedFinancialQualificationBinding;
};
function fail():never { throw Error('ONLINE_QUALIFICATION_SEMANTICS_UNPROVEN'); }
const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function validDatabase(value:any, oid:boolean) {
  return value && same(Object.keys(value).sort(), oid?['name','oid','systemIdentifier']:['name','systemIdentifier'])
    && typeof value.name==='string' && /^[A-Za-z0-9_]{1,63}$/.test(value.name)
    && typeof value.systemIdentifier==='string' && /^[1-9][0-9]*$/.test(value.systemIdentifier)
    && (!oid || typeof value.oid==='string' && /^[1-9][0-9]*$/.test(value.oid));
}
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))
  .replace(/[\u007f-\uffff]/g, character => '\\u' + character.charCodeAt(0).toString(16).padStart(4, '0')) + '\n').digest('hex');
const checkpointMetadataHash = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const nonempty = (value: any): value is any[] => Array.isArray(value) && value.length > 0 && value.length <= 1024;
function rawJson(value: unknown, maximum = 65536) {
  if (typeof value !== 'string' || !value.length || value.length > maximum) fail();
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) fail();
  return JSON.parse(bytes.toString('utf8'));
}

/** Data-only join. The original owner/origin issuer still authenticates the
 * actual handles; no receipt JSON can mint an admission or original token. */
function liveRestoredDirectoryJoin(source:any,proof:any,baseline:any,restore:any,baselineRaw:Buffer){
  const join=proof.liveFinalJoin;
  const exact=(v:any,keys:string[])=>v&&typeof v==='object'&&!Array.isArray(v)&&same(Object.keys(v).sort(),keys.slice().sort());
  const sha=(raw:Buffer|string)=>createHash('sha256').update(raw).digest('hex');
  const decode=(v:any,max:number)=>{if(typeof v!=='string'||v.length>Math.ceil(max/3)*4+4)fail();const b=Buffer.from(v,'base64');if(b.length<1||b.length>max||b.toString('base64')!==v)fail();return b;};
  const json=(v:any,max:number)=>JSON.parse(decode(v,max).toString('utf8'));
  if(!exact(join,['format','baselineCompletion','baselineOriginalRawBase64','baselineNativeSha256','workerStdoutRawBase64','workerOriginalRawBase64','ownerResultRawBase64','ownerOriginalRawBase64','ownerStdoutRawBase64','completeManifestValueRawBase64','workingManifestValueRawBase64'])
    ||join.format!=='sabalan-original-live-restored-qa-final-join/v1'
    ||baseline.captureSource!=='live-verified-complete-restored-qa'
    ||!exact(baseline.restoredQaLineage,['format','sourceDatabase','targetDatabase','completeManifestSha256','nativeHistorySha256','workingManifestSha256','cleanupPending','independentPointHealthy','productionAdmission']))fail();
  const lineage=baseline.restoredQaLineage;
  const completeValueRaw=decode(join.completeManifestValueRawBase64,8*1024*1024),workingValueRaw=decode(join.workingManifestValueRawBase64,8*1024*1024);
  const completeValue=JSON.parse(completeValueRaw.toString('utf8')),workingValue=JSON.parse(workingValueRaw.toString('utf8'));
  if(JSON.stringify(completeValue)!==completeValueRaw.toString('utf8')||JSON.stringify(workingValue)!==workingValueRaw.toString('utf8')
    ||!same(completeValue,source.checkpointMetadata.manifest)
    ||!same(workingValue,{database:lineage.targetDatabase,sources:baseline.sources.map((r:any)=>({name:r.name,files:r.files,directories:r.directories}))}))fail();
  if(lineage.format!=='sabalan-live-restored-qa-private-lineage/v1'||lineage.cleanupPending!==true
    ||lineage.independentPointHealthy!==false||lineage.productionAdmission!==false
    ||!same(lineage.sourceDatabase,source.checkpointMetadata.sourceDatabase)||!same(lineage.targetDatabase,source.restoredDatabase)
    ||lineage.sourceDatabase.systemIdentifier===lineage.targetDatabase.systemIdentifier
    ||lineage.completeManifestSha256!==sha(completeValueRaw)
    ||baseline.capturedManifest?.sha256!==lineage.completeManifestSha256
    ||lineage.workingManifestSha256!==sha(workingValueRaw))fail();
  const completion=join.baselineCompletion;
  if(completion?.event!=='restored-file-baseline-complete'||completion.manifestSha256!==sha(baselineRaw)
    ||completion.capturedManifestSha256!==lineage.completeManifestSha256||completion.productionAdmission!==false
    ||!Array.isArray(completion.proofs)||completion.proofs.length!==9)fail();
  const original=source.originalNativeClosures.filter((c:any)=>c.runtimeId===completion.runtimeId);
  if(original.length!==1||sha(Buffer.from(original[0].nativeRawBase64,'base64'))!==join.baselineNativeSha256)fail();
  const baselineNative=rawJson(original[0].nativeRawBase64);
  if(baselineNative.onlineScope?.scope?.purpose!=='jobs'||baselineNative.onlineScope.scope.role!=='control')fail();
  const baselineOriginal=json(join.baselineOriginalRawBase64,8*1024*1024);
  if(baselineOriginal.format!=='sabalan-original-independent-private-runtime/v1'||baselineOriginal.event!=='CLOSED'
    ||baselineOriginal.mode!=='baseline'||!same(baselineOriginal.result,completion)
    ||baselineOriginal.originalPopenPid!==original[0].originalPopenPid||baselineOriginal.originalReturncode!==0
    ||['nativeRawBase64','workRawBase64','workClaimRawBase64','workScopeRawBase64'].some(k=>baselineOriginal[k]!==original[0][k]))fail();
  const names=new Set<string>();for(const row of completion.proofs){
    if(typeof row.name!=='string'||names.has(row.name)||row.publicOnlineAdmission!==false||!digest(row.sha256)
      ||baseline.sources.filter((s:any)=>s.name===row.name).length!==1)fail();names.add(row.name);
  }
  const workerRaw=decode(join.workerStdoutRawBase64,8*1024*1024),lines=workerRaw.toString('utf8').split('\n');
  if(lines.pop()!==''||lines.length!==3)fail();const frames=lines.map((line:string)=>JSON.parse(line));
  for(let i=0;i<3;i++)if(frames[i].sequence!==i+1||frames[i].session!==frames[0].session||!digest(frames[i].session))fail();
  if(frames[0].event!=='HR_REQUEST'||frames[0].format!=='sabalan-original-active-restored-qa-hr-request/v1'
    ||frames[1].event!=='CALLBACK_DRAINED'||frames[1].format!=='sabalan-original-active-restored-qa-hr-drained/v1'
    ||frames[2].event!=='RESTORE_RESULT'||frames[2].format!=='sabalan-original-active-restored-qa-result/v1'
    ||!same(frames[0].manifest,source.checkpointMetadata.manifest)||!same(frames[0].targetDatabase,lineage.targetDatabase)
    ||!same(frames[0].proof?.database,lineage.targetDatabase)||frames[0].proof.cleanupPending!==true
    ||frames[0].proof.productionAdmission!==false||frames[0].proof.sourceAuthorityAuthenticated!==false
    ||frames[0].proof.format!=='sabalan-private-native-complete-ledger439-proof/v1'
    ||frames[0].proof.nativeRowsCompared!==440||frames[0].proof.activeRows!==439||frames[0].proof.rollbackRows!==1
    ||frames[0].proof.sourceCatalogMigrations!==444||typeof frames[0].proof.rawHistoryJson!=='string'
    ||sha(frames[0].proof.rawHistoryJson)!==lineage.nativeHistorySha256
    ||frames[0].proof.rawHistorySha256!==lineage.nativeHistorySha256)fail();
  if(!Array.isArray(JSON.parse(frames[0].proof.rawHistoryJson))||JSON.parse(frames[0].proof.rawHistoryJson).length!==440)fail();
  const pg=frames[0].proof.originalRestore;
  if(pg?.format!=='sabalan-owned-native-recovery-command/v1'||pg.code!==0||pg.signal!==null
    ||pg.stdoutEof!==true||pg.stderrEof!==true||pg.killed!==false||pg.observationFault!==undefined)fail();
  const result=frames[2].result,absence=result?.absence;
  if(result?.format!=='sabalan-strict-local-complete-validation/v1'||result.strictCompleteValidationSucceeded!==true
    ||result.databaseAbsent!==true||result.baseClientFinallyDisconnected!==true||result.productionAdmission!==false
    ||result.financialSchemaQualified!==false||absence?.visible!==true||absence.name!==lineage.targetDatabase.name
    ||absence.oid!==null||absence.systemIdentifier!==lineage.targetDatabase.systemIdentifier
    ||['sessions','transactions','prepared'].some(k=>absence[k]!==0))fail();
  const worker=json(join.workerOriginalRawBase64,8*1024*1024),owner=json(join.ownerOriginalRawBase64,131072);
  const closed=(v:any)=>Number.isSafeInteger(v.originalPid)&&v.originalPid>1&&v.code===0&&v.signal===null
    &&v.stdoutEof===true&&v.stderrEof===true&&v.observationFault===null&&v.killed===false;
  if(!closed(owner)||owner.format!=='sabalan-original-existing-compose-complete-owner/v1'||owner.interrupted!==false
    ||!closed(worker)||worker.format!=='sabalan-original-protected-financial-closure/v1'
    ||worker.stdoutSha256!==sha(workerRaw)||worker.stdoutRawBase64!==workerRaw.toString('base64')
    ||worker.stderrRawBase64!==''||worker.stderrSha256!==sha(Buffer.alloc(0)))fail();
  const ownerRaw=decode(join.ownerResultRawBase64,8*1024*1024),ownerResult=JSON.parse(ownerRaw.toString('utf8'));
  const ownerStdout=decode(join.ownerStdoutRawBase64,131072),ownerReference=JSON.parse(ownerStdout.toString('utf8'));
  if(owner.stdoutSha256!==sha(ownerStdout)||owner.stdoutBytes!==ownerStdout.length||owner.stderrBytes!==0
    ||owner.stderrSha256!==sha(Buffer.alloc(0))||ownerReference.sha256!==sha(ownerRaw)
    ||ownerResult.format!=='sabalan-owned-complete-transfer-strict-restore/v1'
    ||ownerResult.strictCompleteValidationSucceeded!==true||ownerResult.temporaryTransferRetired!==true
    ||ownerResult.localJobRetired!==true||ownerResult.productionAdmission!==false
    ||!same(ownerResult.protectedFinancialQualification?.binding?.sourceDatabase,lineage.sourceDatabase)
    ||!same(ownerResult.protectedFinancialQualification?.binding?.restoredDatabase,lineage.targetDatabase)
    ||ownerResult.protectedFinancialQualification.binding.sourceCommit!==source.sourceCommit
    ||worker.workerSourceSha256!==ownerResult.protectedFinancialQualification.binding.workerSourceSha256
    ||worker.controllerSourceSha256!==ownerResult.protectedFinancialQualification.binding.controllerSourceSha256
    ||restore.format!=='sabalan-original-existing-compose-complete-restore/v1'
    ||restore.originalBaselineSha256!==sha(baselineRaw)||restore.finalOwnerResultSha256!==sha(ownerRaw)
    ||restore.finalOwnerClosureSha256!==sha(decode(join.ownerOriginalRawBase64,131072))
    ||restore.finalWorkerStdoutSha256!==sha(workerRaw))fail();
  for(const stamp of [owner.startedAt,owner.closedAt,restore.drill?.completedAt])if(typeof stamp!=='string'||!Number.isFinite(Date.parse(stamp)))fail();
  if(Date.parse(owner.closedAt)<Date.parse(owner.startedAt)||Date.parse(restore.drill.completedAt)<Date.parse(owner.closedAt))fail();
}

function protectedDirectoryRestore(source:any,checkpointSha256:string){
  const proof=source.protectedDirectoryComponents,metadata=source.checkpointMetadata;
  const live=proof?.format==='sabalan-original-live-restored-qa-directory-restore/v1';
  if(!proof||(!live&&proof.format!=='sabalan-original-protected-directory-restore/v1')||proof.checkpointSha256!==checkpointSha256
    ||!digest(proof.baselineSha256)||!nonempty(proof.rootBindings)||proof.rootBindings.length!==9)fail();
  const restore=rawJson(proof.canonicalRestoreOutputRawBase64,8*1024*1024),baseline=rawJson(proof.baselineRawBase64,8*1024*1024);
  const restoreSha=createHash('sha256').update(Buffer.from(proof.canonicalRestoreOutputRawBase64,'base64')).digest('hex');
  if(createHash('sha256').update(Buffer.from(proof.baselineRawBase64,'base64')).digest('hex')!==proof.baselineSha256
    ||restore.ok!==true||!hasHealthyIndependentCheckpointDrill({...source.checkpoint,lastDrill:restore.drill})
    ||baseline.format!=='sabalan-application-restored-file-baseline/v1'||baseline.captureSource!==(live?'live-verified-complete-restored-qa':'canonical-complete-package')
    ||(!live&&baseline.capturedManifest?.sha256!==restoreSha)||!Array.isArray(baseline.sources)||baseline.sources.length!==9
    ||metadata.manifest?.format!=='sabalan-recovery'||metadata.manifest.packageType!=='COMPLETE'
    ||!Array.isArray(metadata.manifest.components)||metadata.manifest.components.length>250000)fail();
  if(live)liveRestoredDirectoryJoin(source,proof,baseline,restore,Buffer.from(proof.baselineRawBase64,'base64'));
  const finalDrill=source.checkpoint.lastDrill;
  for(const key of ['operationId','checkpointId','releaseId','checksum','size','sourceMachineUuidSha256','sourceKernelBootIdSha256','recoveryMachineUuidSha256','recoveryKernelBootIdSha256','startedAt'])
    if(!same(restore.drill[key],finalDrill[key]))fail();
  if(Date.parse(restore.drill.completedAt)>Date.parse(finalDrill.completedAt))fail();
  const relative=(value:any)=>typeof value==='string'&&value.length>0&&!value.startsWith('/')&&!/[\\\0]/.test(value)
    &&value.split('/').every((part:string)=>part!==''&&part!=='.'&&part!=='..');
  const components=metadata.manifest.components,paths=new Set<string>();
  for(const row of components){if(!relative(row.path)||paths.has(row.path)||!digest(row.sha256)||!Number.isSafeInteger(row.size)||row.size<0)fail();paths.add(row.path);}
  if(!paths.has('database/main.dump')||!paths.has('inquiry/inquiry.db'))fail();
  const retained=['storage/contracts','storage/hr-hiring','storage/accounting-contracts','storage/dispatch-documents','storage/support-tickets','storage/performance-exports',
    'uploads/images','uploads/security-shift-log','uploads/security-vehicle-pairs'];
  const names=new Set<string>(),roots=new Set<string>(),restoredRoots=new Set<string>();
  for(const binding of proof.rootBindings){
    const relativeRoot=typeof binding.sourceLiveRoot==='string'?binding.sourceLiveRoot.slice('/app/'.length):'';
    if(!binding.sourceLiveRoot?.startsWith('/app/')||!retained.includes(relativeRoot)||roots.has(relativeRoot)||names.has(binding.name)
      ||binding.payloadPrefix!=='files/'+relativeRoot.replace(/^storage\//,'')||!binding.restoredLiveRoot?.startsWith('/')||restoredRoots.has(binding.restoredLiveRoot)
      ||binding.restoredLiveRoot.slice(1).split('/').some((part:string)=>part===''||part==='.'||part==='..')||binding.restoredLiveRoot.includes('\\'))fail();
    names.add(binding.name);roots.add(relativeRoot);restoredRoots.add(binding.restoredLiveRoot);
    const matches=baseline.sources.filter((row:any)=>row.name===binding.name&&row.liveRoot===binding.restoredLiveRoot);
    if(matches.length!==1)fail();const actual=matches[0];
    if(!Array.isArray(actual.files)||actual.files.length>10000||!Array.isArray(actual.directories)||actual.directories.length>10000
      ||new Set(actual.directories).size!==actual.directories.length||actual.directories.some((value:any)=>!relative(value)))fail();
    const expected=components.filter((row:any)=>row.path.startsWith(binding.payloadPrefix+'/'))
      .map((row:any)=>({key:row.path.slice(binding.payloadPrefix.length+1),bytes:row.size,sha256:row.sha256})).sort((a:any,b:any)=>a.key<b.key?-1:a.key>b.key?1:0);
    if(!same(actual.files,expected))fail();
    for(const file of actual.files){if(!relative(file.key))fail();const segments=file.key.split('/');
      for(let length=1;length<segments.length;length++)if(!actual.directories.includes(segments.slice(0,length).join('/')))fail();}
  }
  if(roots.size!==9||source.restoredFileRoots!==9)fail();
}

/** Reuse the original guardian/work/SQL receipt fields, rather than accepting
 * a summary saying that a process disappeared or a timeout elapsed. This is a
 * data verifier; the original host must still own/observe these actual handles. */
function originalClosures(source: any, expected: OnlineQualificationBinding, scopeName:OnlineQualificationScope) {
  if (!nonempty(source.originalNativeClosures)) fail();
  const cohort=expected.runtimeCohorts[scopeName];
  if(!nonempty(cohort)||source.originalNativeClosures.length!==cohort.length)fail();
  const ids = new Set<string>();
  const purposes: Array<{purpose:string;runtimeId:string;candidate:boolean;native:any;closure:any}> = [];
  for (const closure of source.originalNativeClosures) {
    const identities=cohort.filter(value=>value.runtimeId===closure.runtimeId);
    if(identities.length!==1)fail();const expectedRuntime=identities[0];
    if (!digest(closure.runtimeId) || ids.has(closure.runtimeId)
      || !Number.isSafeInteger(closure.originalPopenPid) || closure.originalPopenPid < 1
      || closure.originalReturncode !== 0 || !digest(closure.activeClaimSha256)) fail();
    ids.add(closure.runtimeId);
    const native = rawJson(closure.nativeRawBase64), work = rawJson(closure.workRawBase64), claim = rawJson(closure.workClaimRawBase64);
    const provision=rawJson(closure.workScopeRawBase64);
    const scope = native.onlineScope?.scope;
    if (native.format !== 'sabalan-runtime-native/v1' || native.phase !== 'QUIESCENT'
      || native.nativeReaped !== true || native.databaseQuiet !== true || native.nativeStatus !== 0
      || native.stoppedBySignal !== false || native.guardian?.pid !== closure.originalPopenPid
      || native.activeClaimSha256 !== closure.activeClaimSha256
      || native.clusterIdentifier !== expected.sourceDatabase.systemIdentifier
      || native.initialDatabase?.name !== expected.sourceDatabase.name || String(native.initialDatabase?.oid) !== expected.sourceDatabase.oid
      || scope?.runtimeId !== closure.runtimeId || scope.sourceCommit !== expectedRuntime.sourceCommit
      || scope.releaseId!==expectedRuntime.releaseId || scope.purpose!==expectedRuntime.purpose
      || scope.image !== expectedRuntime.image || scope.manifestSha256 !== expectedRuntime.runtimeBundleSha256
      || native.onlineScope?.sha256 !== hash(scope)
      || !((scope.purpose === 'http' && scope.role === 'serving') || (scope.purpose === 'jobs' && scope.role === 'control'))) fail();
    purposes.push({purpose:scope.purpose,runtimeId:closure.runtimeId,native,closure,
      candidate:[expected.images.backend,expected.deploymentTargetImages.backend].includes(expectedRuntime.image)
        &&expectedRuntime.sourceCommit===expected.sourceCommit&&expectedRuntime.runtimeBundleSha256===expected.runtimeBundleSha256});
    const active = { ...native, phase: 'ACTIVE' };
    for (const key of ['activeClaimSha256', 'nativeReaped', 'databaseQuiet', 'nativeStatus', 'stoppedBySignal']) delete active[key];
    if (hash(active) !== closure.activeClaimSha256 || work.format !== 'sabalan-runtime-boundary/v1'
      || work.phase !== 'QUIESCENT' || work.claimSha256 !== hash(claim) || claim.format !== 'sabalan-runtime-claim/v2'
      || provision.format!=='sabalan-runtime-namespace/v1' || claim.scopeSha256!==hash(provision)
      || provision.scope?.runtimeId!==closure.runtimeId || provision.scope.image!==expectedRuntime.image
      || provision.scope.registrySha256!==expectedRuntime.runtimeBundleSha256
      || provision.scope.postgresApplicationName!==runtimeNativePostgresApplicationName(closure.runtimeId)
      || !same(claim.native, closure.claimNative)
      || !same(closure.claimNative, { scopeSha256: native.onlineScope.sha256, claimSha256: closure.activeClaimSha256 })
      || closure.freshSql?.visible !== true || closure.freshSql.systemIdentifier !== expected.sourceDatabase.systemIdentifier
      || closure.freshSql.namespace!==runtimeNativePostgresApplicationName(closure.runtimeId)
      || String(closure.freshSql.databaseOid) !== expected.sourceDatabase.oid
      || closure.freshSql.namespaceSessions !== 0 || closure.freshSql.prepared !== 0) fail();
  }
  return purposes;
}

function bridgeFanout(source:any, purposes:ReturnType<typeof originalClosures>) {
  const proof=rawJson(source.bridgeProofRawBase64,2*1024*1024);
  const raw=Buffer.from(source.bridgeProofRawBase64,'base64'),proofSha=createHash('sha256').update(raw).digest('hex');
  const targetIds=source.singleWorker.targetRuntimeIds;
  if(proof.format!=='sabalan-private-pair-bridge-proof/v1'||!digest(proof.qualificationId)
    || !nonempty(targetIds)||targetIds.length!==source.singleWorker.httpTargetCount||new Set(targetIds).size!==targetIds.length
    || !digest(source.bridgeAfterDrain?.proofSha256)||source.bridgeAfterDrain.proofSha256!==proofSha
    || source.bridgeAfterDrain.format!=='sabalan-private-pair-bridge-after-drain/v1'
    || source.bridgeAfterDrain.passResult!==true||source.bridgeAfterDrain.durableAcknowledgmentsUnchanged!==true
    || source.bridgeAfterDrain.historyUnchanged!==true)fail();
  const actors=targetIds.map((id:string)=>purposes.find(actor=>actor.runtimeId===id&&actor.purpose==='http'));
  if(actors.some((actor:any)=>!actor)||!actors.some((actor:any)=>actor.candidate)
    ||new Set(actors.map((actor:any)=>actor.native.onlineScope.scope.image)).size<2)fail();
  const observations=proof.clientObservations,durable=proof.durable,ids=proof.ids;
  if(!nonempty(observations)||observations.length!==targetIds.length
    || !same(observations.map((row:any)=>row.runtimeId).sort(),[...targetIds].sort())
    || observations.some((row:any)=>row.originalSocketClosed!==true||row.authenticated!==true
      || !same(row.observedEvents,['notification.created','hr.personnel.changed'])))fail();
  if(!nonempty(durable?.batches)||durable.batches.length!==2||!nonempty(durable.commands)
    || durable.commands.length!==targetIds.length*2||!same(durable.batches.map((row:any)=>row.kind).sort(),['HR_PERSONNEL_INVALIDATION','NOTIFICATION'])
    || !ids||!same([...ids.batchIds].sort(),durable.batches.map((row:any)=>row.id).sort()))fail();
  const handoff=proof.workerHandoff;
  const oldJobs=purposes.find(actor=>actor.runtimeId===handoff?.oldJobsRuntimeId&&actor.purpose==='jobs'&&!actor.candidate);
  const newJobs=purposes.find(actor=>actor.runtimeId===handoff?.newJobsRuntimeId&&actor.purpose==='jobs'&&actor.candidate);
  if(!oldJobs||!newJobs||handoff.oldNativeSha256!==createHash('sha256').update(Buffer.from(oldJobs.closure.nativeRawBase64,'base64')).digest('hex'))fail();
  const nonce=(actor:any)=>createHash('sha256').update(actor.native.onlineScope.scope.nonce,'utf8').digest('hex');
  const commandIds=new Set<string>();
  for(const batch of durable.batches){
    const jobs=batch.kind==='NOTIFICATION'?oldJobs:newJobs;
    if(batch.producerRuntimeId!==jobs.runtimeId||batch.producerNonceSha256!==nonce(jobs)
      || !nonempty(batch.targetsJson)||batch.targetsJson.length!==targetIds.length
      || !same(batch.targetsJson.map((target:any)=>target.runtimeId).sort(),[...targetIds].sort()))fail();
    if(batch.targetsSha256!==canonicalRealtimeTargets(batch.targetsJson).sha256)fail();
    for(const target of batch.targetsJson){
      const actor=actors.find((row:any)=>row.runtimeId===target.runtimeId)!;
      const scope=actor.native.onlineScope.scope;
      if(target.nonceSha256!==nonce(actor)||target.imageIdentity!==scope.image||target.releaseId!==scope.releaseId)fail();
      const commands=durable.commands.filter((row:any)=>row.batchId===batch.id&&row.runtimeId===target.runtimeId);
      if(commands.length!==1)fail();const command=commands[0];
      if(command.id!==realtimeCommandId(batch.id,target)||commandIds.has(command.id)||command.status!=='SETTLED'||!command.claimToken||!command.startedAt||!command.settledAt)fail();commandIds.add(command.id);
    }
  }
  if(durable.outbox?.id!==ids.outboxId||durable.outbox.status!=='PROCESSED'||!durable.outbox.processedAt
    || durable.intent?.id!==ids.intentId||!targetIds.includes(durable.intent.originRuntimeId)
    || durable.intent.sourceOutcome!=='READY'||durable.intent.deliveryStatus!=='SETTLED'
    ||!durable.intent.sourceSettledAt||!durable.intent.deliverySettledAt
    ||durable.personnel?.id!==ids.personnelId||durable.personnel.lastName!==ids.personnelLastName)fail();
}

/** Diagnostic UI observations support the form inventory, but only the actual
 * installed pair can prove public routing to the new application. These bytes
 * are emitted by the original browser/edge owners and bound by the origin
 * issuer; a diagnostic bundle is never renamed to an installed runtime. */
function installedBrowserRouting(source:any,expected:OnlineQualificationBinding){
  const proof=source.installedRouting;
  if(proof?.format!=='sabalan-original-installed-browser-routing/v1'
    ||!same(proof.proofDatabase,expected.proofDatabases['single-worker-and-completion']))fail();
  const cohort=expected.runtimeCohorts['single-worker-and-completion'].filter(actor=>actor.purpose==='http');
  const actors=originalClosures(proof,{...expected,sourceDatabase:proof.proofDatabase,
    runtimeCohorts:{...expected.runtimeCohorts,'browser-24-hours':cohort}},'browser-24-hours');
  if(actors.length!==2||!actors.some(actor=>actor.candidate)
    ||new Set(actors.map(actor=>actor.native.onlineScope.scope.image)).size!==2)fail();
  const publication=rawJson(proof.publicationRawBase64,8*1024*1024);
  const raw=Buffer.from(proof.publicationRawBase64,'base64');
  if(publication.format!=='sabalan-browser-publication/v1'||!Number.isSafeInteger(publication.generation)
    ||publication.generation<1||publication.registry?.format!=='sabalan-browser-routing/v2'
    ||publication.registry.generation!==publication.generation
    ||proof.publicationSha256!==createHash('sha256').update(raw).digest('hex')
    ||!nonempty(publication.registry.builds)||!nonempty(publication.registry.apiBindings)
    ||!nonempty(proof.executions)||proof.executions.length!==2)fail();
  const current=publication.registry.builds.find((build:any)=>build.id===publication.registry.current?.erp);
  if(current?.image!==expected.images.frontend)fail();
  const registry=publication.registry;
  const normalized={format:registry.format,generation:registry.generation,current:registry.current,legacy:registry.legacy,
    builds:registry.builds.map((build:any)=>({...build,actionIds:[...build.actionIds].sort(),assets:[...build.assets].sort((a:any,b:any)=>a.path.localeCompare(b.path))})).sort((a:any,b:any)=>a.id.localeCompare(b.id)),
    apiBindings:[...registry.apiBindings].sort((a:any,b:any)=>a.buildId.localeCompare(b.buildId))};
  if(publication.registryIdentity!==checkpointMetadataHash(normalized))fail();
  const seen=new Set<string>(),builds=new Set<string>();
  for(const execution of proof.executions){
    const actor=actors.find(actor=>actor.runtimeId===execution.runtimeId);
    if(!actor||seen.has(actor.runtimeId))fail();seen.add(actor.runtimeId);
    const intent=rawJson(execution.intentRawBase64),completion=rawJson(execution.completionRawBase64),client=rawJson(execution.clientRawBase64);
    const scope=actor.native.onlineScope.scope;
    const build=publication.registry.builds.find((build:any)=>build.id===intent.buildId);
    const bindings=publication.registry.apiBindings.filter((binding:any)=>binding.buildId===intent.buildId);
    if(!build||build.application!=='erp'||bindings.length!==1)fail();const binding=bindings[0];
    if(builds.has(build.id)||binding.slotId!=='backend_'+scope.runtimeId||binding.image!==scope.image
      ||binding.manifestSha256!==scope.manifestSha256||binding.browserManifestSha256!==build.manifestSha256
      ||intent.format!=='sabalan-browser-operation/v1'||intent.generation!==publication.generation||intent.registryIdentity!==publication.registryIdentity
      ||intent.slotId!==binding.slotId||intent.image!==scope.image||intent.manifestSha256!==scope.manifestSha256||intent.method!=='POST'
      ||completion.format!=='sabalan-browser-operation-completion/v1'||completion.id!==intent.id
      ||completion.instanceId!==intent.instanceId||completion.outcome!=='UPSTREAM_ENDED'
      ||completion.intentSha256!==createHash('sha256').update(Buffer.from(execution.intentRawBase64,'base64')).digest('hex')
      ||client.format!=='sabalan-installed-browser-form-response/v1'||client.operationId!==intent.id
      ||client.buildId!==build.id||client.image!==build.image||client.runtimeId!==scope.runtimeId
      ||client.method!=='POST'||client.status!==201||client.requestCount!==1||client.automaticNavigation!==false
      ||client.originalClientClosed!==true||!digest(client.responseSha256)||!digest(client.storedBusinessReceiptSha256))fail();
    builds.add(build.id);
  }
  if(!builds.has(current.id))fail();
}

/** Scope-specific semantics for immutable raw receipts. No signer, issuer or
 * runtime admission is exposed. Existing diagnostic receipts remain diagnostic;
 * none currently supplies all the production evidence required here. */
export function assertOnlineQualificationProof(scope: OnlineQualificationScope, source: any, expected: OnlineQualificationBinding, financialArtifacts?:ProtectedFinancialQualificationArtifacts,financialCertificate?:Buffer) {
  validateProductionExecutionBindings(expected.productionExecutionBindings,expected);
  if (![expected.manifestSha256, expected.checkpointSha256, expected.checkpointArchiveChecksum, expected.runtimeBundleSha256, expected.schemaSha256, expected.captureId].every(digest)
    || !/^[a-f0-9]{40}$/.test(expected.sourceCommit) || !/^[A-Za-z0-9_-]{8,128}$/.test(expected.releaseId)
    || !validDatabase(expected.sourceDatabase, true) || !validDatabase(expected.deploymentTargetDatabase, true)
    ||!['PROTECTED_MAINTENANCE_COMPLETE','ONLINE_COHERENT_WAL'].includes(expected.recoveryMode)
    || !same(Object.keys(expected.images).sort(), ['backend', 'frontend', 'inquiry'])
    || Object.values(expected.images).some(image => !/^sha256:[a-f0-9]{64}$/.test(image))) fail();
  if(!same(Object.keys(expected.deploymentTargetImages).sort(),['backend','frontend','inquiry'])
    ||!same(Object.keys(expected.imageGraphs).sort(),['backend','frontend','inquiry']))fail();
  for(const role of ['backend','frontend','inquiry'] as const){
    const graph=expected.imageGraphs[role];
    if(!graph||!same(Object.keys(graph).sort(),['archiveBytes','archiveSha256','config','index','platform','rootfsDiffIds'])
      ||graph.index!==expected.images[role]||graph.config!==expected.deploymentTargetImages[role]
      || ![graph.index,graph.platform,graph.config].every(value=>/^sha256:[a-f0-9]{64}$/.test(value))
      ||!digest(graph.archiveSha256)||!Number.isSafeInteger(graph.archiveBytes)||graph.archiveBytes<1
      ||!nonempty(graph.rootfsDiffIds)||graph.rootfsDiffIds.length>128||graph.rootfsDiffIds.some(value=>!/^sha256:[a-f0-9]{64}$/.test(value)))fail();
  }
  if(!same(Object.keys(expected.componentSourceCommits).sort(),['backend','frontend','inquiry'])
    || Object.values(expected.componentSourceCommits).some(value=>!/^[a-f0-9]{40}$/.test(value))
    || expected.componentSourceCommits.backend!==expected.sourceCommit
    || !same(Object.keys(expected.runtimeCohorts).sort(),['browser-24-hours','coherent-independent-restore','compatible-migrations','current-domain','single-worker-and-completion']))fail();
  if(!expected.proofDatabases||!same(Object.keys(expected.proofDatabases).sort(),Object.keys(expected.runtimeCohorts).sort())
    ||Object.values(expected.proofDatabases).some(database=>!validDatabase(database,true))
    ||!same(expected.proofDatabases['compatible-migrations'],expected.sourceDatabase)
    ||!same(expected.proofDatabases['browser-24-hours'],expected.sourceDatabase)
    ||same(expected.proofDatabases['coherent-independent-restore'],expected.sourceDatabase))fail();
  for(const [cohortName,cohort] of Object.entries(expected.runtimeCohorts)){
    if(!nonempty(cohort)||new Set(cohort.map(actor=>actor.runtimeId)).size!==cohort.length)fail();
    // Qualification actors retain their actual QA/restore release IDs. The
    // future deployment release ID binds the acceptance, not their raw scopes.
    if(!['compatible-migrations','browser-24-hours'].includes(cohortName)&&!cohort.some(actor=>[expected.images.backend,expected.deploymentTargetImages.backend].includes(actor.image)&&actor.sourceCommit===expected.sourceCommit
      &&actor.runtimeBundleSha256===expected.runtimeBundleSha256))fail();
    for(const actor of cohort)if(!digest(actor.runtimeId)||!digest(actor.runtimeBundleSha256)
      || !/^[a-f0-9]{40}$/.test(actor.sourceCommit)||!/^sha256:[a-f0-9]{64}$/.test(actor.image)
      || !/^[A-Za-z0-9_-]{8,128}$/.test(actor.releaseId)||!['http','jobs'].includes(actor.purpose))fail();
  }
  // The independently closed production-A -> restored-B finite rehearsal is
  // separate evidence. Ordinary online actors/expansion semantics below retain
  // their existing scopes and may never be fabricated for these HTTP originals.
  if(scope==='compatible-migrations'&&source?.format==='sabalan-protected-financial-qualification/v1'){
    const b=expected.protectedFinancial,point=expected.qualificationCheckpoint;
    if(!b||expected.recoveryMode!=='PROTECTED_MAINTENANCE_COMPLETE'||!point
      ||b.sourceCheckpointMetadataSha256!==point.metadataSha256||b.sourceCheckpointChecksum!==point.metadata.checksum
      ||!same(b.sourceDatabase,expected.deploymentTargetDatabase)||b.sourceCommit!==expected.sourceCommit
      ||b.currentExecutionImage!==expected.deploymentTargetImages.backend
)fail();
    return assertProtectedFinancialQualificationSource(source,b,financialArtifacts!,financialCertificate!);
  }
  if (!source || source.productionAdmission !== true || source.passResult !== true
    ||source.executionKind!==(['compatible-migrations','browser-24-hours'].includes(scope)?'DIAGNOSTIC_SUPPORT':'INSTALLED_RUNTIME')
    || source.manifestSha256 !== expected.manifestSha256 || source.checkpointSha256 !== expected.checkpointSha256
    || source.releaseId !== expected.releaseId || source.sourceCommit !== expected.sourceCommit
    || source.runtimeBundleSha256 !== expected.runtimeBundleSha256 || source.schemaSha256 !== expected.schemaSha256
    || source.captureId !== expected.captureId || !same(source.sourceDatabase, expected.sourceDatabase)
    ||source.recoveryMode!==expected.recoveryMode
    || !same(source.proofDatabase,expected.proofDatabases[scope])
    || !same(source.deploymentTargetDatabase, expected.deploymentTargetDatabase) || !same(source.images, expected.images)
    || !same(source.deploymentTargetImages,expected.deploymentTargetImages)||!same(source.imageGraphs,expected.imageGraphs)
    || !same(source.productionExecutionBindings,expected.productionExecutionBindings)) fail();
  let purposes: ReturnType<typeof originalClosures>;
  if (scope === 'coherent-independent-restore') {
    const restored = source.restoredDatabase;
    if (!validDatabase(restored,true)||!same(restored,expected.proofDatabases[scope])||same(restored, expected.sourceDatabase)) fail();
    purposes = originalClosures(source, { ...expected, sourceDatabase: restored },scope);
  } else purposes = originalClosures(source, {...expected,sourceDatabase:expected.proofDatabases[scope]},scope);
  switch (scope) {
    case 'compatible-migrations': {
      if (source.format !== 'sabalan-application-native/v1' || source.diagnosticExpansionApplied !== false
        || source.ownedMigration?.financialSchemaQualified !== true || !Array.isArray(source.ownedMigration.steps)
        || source.ownedMigration.steps.length > 1024
        || !digest(source.originalHistory?.sha256) || !digest(source.history?.sha256)
        || !Number.isSafeInteger(source.originalHistory.rows) || source.originalHistory.rows < 1) fail();
      const names = new Set<string>();
      for (const step of source.ownedMigration.steps) {
        const compiled = compileOnlineExpansion(step.plan);
        if (names.has(compiled.plan.migrationName) || step.sqlSha256 !== compiled.sqlSha256
          || step.operationSha256 !== compiled.operationSha256 || step.state !== 'COMPLETE'
          || step.oldAndNewWritersObserved !== true || step.pendingRows !== 0 || step.conflictingRows !== 0) fail();
        names.add(compiled.plan.migrationName);
      }
      if (source.history.rows !== source.originalHistory.rows + names.size
        || source.priorMigrationHistorySha256 !== source.originalHistory.sha256
        || (!names.size && source.history.sha256 !== source.originalHistory.sha256)) fail();
      break;
    }
    case 'coherent-independent-restore': {
      const point=expected.qualificationCheckpoint;
      if(point&&expected.recoveryMode!=='PROTECTED_MAINTENANCE_COMPLETE')fail();
      const checkpointSha256=point?.metadataSha256??expected.checkpointSha256;
      const checkpointChecksum=point?.metadata.checksum??expected.checkpointArchiveChecksum;
      const checkpointReleaseId=point?.metadata.releaseId??expected.releaseId;
      if(point&&(!digest(point.metadataSha256)||checkpointMetadataHash(point.metadata)!==point.metadataSha256
        ||!same(point.metadata,source.checkpointMetadata)))fail();
      const transport=rawJson(source.checkpointTransportRawBase64,8*1024*1024);
      const canonicalMetadata=readCanonicalCheckpointMetadata(transport);
      if(canonicalMetadata.sha256!==checkpointSha256||!same(canonicalMetadata.metadata,source.checkpointMetadata))fail();
      if (source.format !== 'sabalan-native-application-coherent-integration/v1' || source.independentHostQualified !== true
        || source.continuousWalQualified !== false || source.immutableDifferentImagesQualified !== true
        || source.inquiryRuntimeQualified !== true || (expected.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE'&&!hasHealthyIndependentCheckpointDrill(source.checkpoint))
        || source.checkpoint.releaseId !== checkpointReleaseId || source.checkpoint.checksum !== checkpointChecksum
        || !source.checkpointMetadata || checkpointMetadataHash(source.checkpointMetadata) !== checkpointSha256
        ||source.checkpointMetadata.captureMethod!==expected.recoveryMode
        || source.checkpointMetadata.checksum !== checkpointChecksum
        || source.checkpointMetadata.id !== source.checkpoint.id || source.checkpointMetadata.releaseId !== checkpointReleaseId
        || source.checkpointMetadata.size !== source.checkpoint.size
        || !validDatabase(source.checkpointMetadata.sourceDatabase, true)
        || !same(source.checkpointMetadata.sourceDatabase, expected.deploymentTargetDatabase)
        || source.checkpointMetadata.sourceMachineUuidSha256 !== source.checkpoint.sourceMachineUuidSha256
        || source.checkpointMetadata.sourceKernelBootIdSha256 !== source.checkpoint.sourceKernelBootIdSha256
        || source.checkpoint.remoteVerified !== true || source.checkpoint.restoreVerified !== true) fail();
      let recoveryMachineUuidSha256:string|undefined;
      if(expected.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE')protectedDirectoryRestore(source,checkpointSha256);
      else{
      const physicalReport=assertOriginalIndependentPhysicalPoint(source,expected);
      recoveryMachineUuidSha256=physicalReport.recoveryMachineUuidSha256;
      const components = source.components;
      if (!components || !same(Object.keys(components).sort(), ['coordination', 'files', 'postgres', 'sqlite'])) fail();
      for (const component of Object.values(components) as any[]) if (component.captureId !== expected.captureId
        || !digest(component.sha256) || !Number.isSafeInteger(component.bytes) || component.bytes < 1
        || component.restoredSha256 !== component.sha256) fail();
      if (source.restoredFileRoots !== 9 || !nonempty(source.independentlyVerifiedFileCuts)
        || source.independentlyVerifiedFileCuts.length !== 9
        || new Set(source.independentlyVerifiedFileCuts.map((cut: any) => cut.name)).size !== 9) fail();
      }
      if(expected.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE')recoveryMachineUuidSha256=source.checkpoint.lastDrill?.recoveryMachineUuidSha256;
      if(expected.productionExecutionBindings&&!digest(recoveryMachineUuidSha256))fail();
      validateProductionExecutionBindings(expected.productionExecutionBindings,{...expected,sourceHost:{
        machineUuidSha256:source.checkpointMetadata.sourceMachineUuidSha256,
        kernelBootIdSha256:source.checkpointMetadata.sourceKernelBootIdSha256},recoveryMachineUuidSha256});
      for (const name of ['backend', 'frontend', 'inquiry'] as const) {
        const health = source.applicationHealth?.[name];
        if (health?.image !== expected.deploymentTargetImages[name] || health.sourceCommit !== expected.componentSourceCommits[name]
          || (expected.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE'?health.checkpointMetadataSha256!==checkpointSha256:health.captureId !== expected.captureId)
          || health.status !== 200 || !digest(health.responseSha256)) fail();
      }
      break;
    }
    case 'browser-24-hours': {
      installedBrowserRouting(source,expected);
      if (source.format !== 'sabalan-actual-native-browser/v1' || source.actualCompiledPages !== true
        || source.actualCanonicalAuthorization !== true
        || source.oldFormSubmittedAfterSwitch !== true || source.newFormSubmittedOnNewSlot !== true
        || !nonempty(source.retainedBuilds)) fail();
      const registry = rawJson(source.routingRegistryRawBase64, 6 * 1024 * 1024);
      if (registry.format !== 'sabalan-browser-routing/v2' || !Array.isArray(registry.builds)
        || !digest(source.routingRegistrySha256)
        || createHash('sha256').update(Buffer.from(source.routingRegistryRawBase64,'base64')).digest('hex') !== source.routingRegistrySha256) fail();
      for (const application of ['erp','inquiry']) {
        const current = registry.builds.find((build:any)=>build.id===registry.current?.[application]);
        if (!current || current.application !== application || current.retiredAt !== null
          || current.image !== expected.images[application==='erp'?'frontend':'inquiry']) fail();
      }
      const applications = new Set<string>();
      for (const build of source.retainedBuilds) {
        const registered = registry.builds.filter((value:any)=>value.id===build.buildId);
        const manual=registered.length===1&&registered[0].handoffPolicy==='MANUAL_SAVE_REQUIRED';
        const required=(build.application==='erp'?['api','assets','rsc','sessions','sockets']:['assets','inquiry-actions','rsc','sessions']);
        required.push(manual?'manual-save-expiry':'draft-expiry');required.sort();
        const retired = Date.parse(build.retiredAt), until = Date.parse(build.supportUntil), tested = Date.parse(build.observedAt);
        if (!['erp', 'inquiry'].includes(build.application) || typeof build.buildId !== 'string' || !build.buildId
          || ![retired, until, tested].every(Number.isFinite) || until - retired < 86_400_000
          || tested < retired || tested >= until || !same([...build.coverage].sort(), required)
          || !digest(build.formInventorySha256) || build.exercisedFormInventorySha256 !== build.formInventorySha256
          || (manual?(build.manualRefreshNeverForced!==true||build.manualSaveRequiredAfterExpiry!==true):build.savedBeforeRequiredRefresh!==true)
          || build.accountIsolationVerified !== true) fail();
        const execution=build.execution, started=Date.parse(execution?.startedAt),completed=Date.parse(execution?.completedAt);
        if (registered.length!==1 || registered[0].application!==build.application || registered[0].image!==build.image
          || registered[0].retiredAt!==build.retiredAt || registered[0].supportUntil!==build.supportUntil
          || !/^sha256:[a-f0-9]{64}$/.test(build.image) || execution?.buildId!==build.buildId
          || execution?.image!==build.image || execution?.registrySha256!==source.routingRegistrySha256
          || ![started,completed].every(Number.isFinite) || started<retired || completed<started
          || tested<started || tested>completed || completed>=until) fail();
        // Execute the canonical database-clock policy at exact boundaries.
        // These injected clocks prove duration semantics, not literal elapsed time.
        const row=(now:number)=>({phase:'RETAINED',now:new Date(now),retiredAt:new Date(retired),browserSupportUntil:new Date(until)});
        snapshotOnlineSupportWindow(row(retired));
        snapshotOnlineSupportWindow(row(retired+86_400_000-1));
        snapshotOnlineSupportWindow(row(until-1));
        for(const at of [until,until+1]) {let refused=false;try{snapshotOnlineSupportWindow(row(at));}catch{refused=true;}if(!refused)fail();}
        snapshotOnlineSupportWindow(row(tested));
        applications.add(build.application);
      }
      if (applications.size !== 2) fail();
      break;
    }
    case 'single-worker-and-completion': {
      if (source.format !== 'sabalan-application-native/v1' || source.singleWorker?.unknownOwners !== 0
        || source.singleWorker.unresolvedCommands !== 0 || source.singleWorker.nativeJobsObserved !== true
        || !Number.isSafeInteger(source.singleWorker.httpTargetCount) || source.singleWorker.httpTargetCount < 2
        || source.singleWorker.rowFenceVerified !== true
        ) fail();
      bridgeFanout(source,purposes);
      const jobs=purposes.filter(actor=>actor.purpose==='jobs'),intervals=source.workerOwnershipIntervals;
      if(jobs.length<2||!jobs.some(actor=>actor.candidate)||!jobs.some(actor=>!actor.candidate)
        ||!nonempty(intervals)||intervals.length!==jobs.length)fail();
      const seen=new Set<string>();let lock:unknown,boot:unknown;
      const ordered=intervals.map((interval:any)=>{
        const actor=jobs.find(value=>value.runtimeId===interval.runtimeId);
        if(!actor||seen.has(interval.runtimeId))fail();seen.add(interval.runtimeId);
        const worker=actor.native.onlineLocks?.worker,issued=actor.native.onlineScope.scope.worker;
        if(!worker||worker.descriptor!==12||!issued||!same(worker,{...issued,descriptor:12})
          ||!/^([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/.test(actor.native.guardian.bootId)
          ||interval.bootId!==actor.native.guardian.bootId||interval.activeClaimSha256!==actor.closure.activeClaimSha256)fail();
        if(lock!==undefined&&(!same(lock,issued)||boot!==interval.bootId))fail();lock=issued;boot=interval.bootId;
        const values=[interval.admissionRequestedMonotonicNs,interval.exclusiveClaimObservedMonotonicNs,interval.controlClosedMonotonicNs];
        if(values.some(value=>typeof value!=='string'||!/^\d{1,30}$/.test(value)))fail();
        const [requested,acquired,closed]=values.map(value=>BigInt(value));
        if(requested>acquired||acquired>closed)fail();
        return {actor,requested,acquired,closed};
      }).sort((a,b)=>a.requested<b.requested?-1:a.requested>b.requested?1:0);
      let handoff=false;
      for(let index=1;index<ordered.length;index++){
        const previous=ordered[index-1],next=ordered[index];
        if(previous.closed>next.requested)fail();
        if(!previous.actor.candidate&&next.actor.candidate)handoff=true;
      }
      if(!handoff)fail();
      break;
    }
    case 'current-domain': {
      const required = ['accounting', 'contracts', 'dispatch', 'hr', 'inquiry', 'personnel-performance', 'security', 'support', 'uploads'];
      if (source.format !== 'sabalan-application-native/v1' || !nonempty(source.domainCases)
        || !same(source.domainCases.map((row: any) => row.domain).sort(), required)
        || source.writerCoverage?.remaining?.length !== 0 || source.writerCoverage?.startupOnly?.length !== 0) fail();
      for (const row of source.domainCases) if (row.status !== 'COMPLETE' || !digest(row.receiptSha256)
        || row.actualCanonicalRuntime !== true || row.schemaSha256 !== expected.schemaSha256) fail();
      break;
    }
    default: fail();
  }
}
