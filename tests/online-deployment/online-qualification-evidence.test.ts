import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import { assertOnlineQualificationProof, type OnlineQualificationBinding, type OnlineQualificationScope } from '../../backend/src/services/onlineQualificationEvidence';
import { syntheticQualificationProof, syntheticCheckpointMetadata, syntheticQualificationIdentities,syntheticQualificationImageGraphs } from './online-qualification-evidence.fixture';
const fixtureBase = { manifestSha256: '1'.repeat(64), checkpointSha256: '2'.repeat(64), checkpointArchiveChecksum: 'f'.repeat(64),
  releaseId: 'unit_release', sourceCommit: '3'.repeat(40), runtimeBundleSha256: '4'.repeat(64), schemaSha256: '5'.repeat(64),
  captureId: '6'.repeat(64), sourceDatabase: { name: 'unit_source', systemIdentifier: '123', oid: '42' },
  deploymentTargetDatabase: {name:'production_database',systemIdentifier:'456',oid:'77'},recoveryMode:'ONLINE_COHERENT_WAL' as const,
  deploymentTargetImages:{backend:'sha256:'+'a'.repeat(64),frontend:'sha256:'+'b'.repeat(64),inquiry:'sha256:'+'c'.repeat(64)},
  images: { backend: 'sha256:' + '7'.repeat(64), frontend: 'sha256:' + '8'.repeat(64), inquiry: 'sha256:' + '9'.repeat(64) } };
const binding:OnlineQualificationBinding={...fixtureBase,imageGraphs:syntheticQualificationImageGraphs(fixtureBase.images,fixtureBase.deploymentTargetImages),...syntheticQualificationIdentities(fixtureBase)};
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
binding.checkpointSha256=createHash('sha256').update(JSON.stringify(canonical(syntheticCheckpointMetadata(binding)))).digest('hex');
assert.notEqual(binding.checkpointSha256,binding.checkpointArchiveChecksum);

test('protected bootstrap independently restored point retains its own release and checksum instead of adopting the future activation point',()=>{
 const protectedBinding=structuredClone(binding);protectedBinding.recoveryMode='PROTECTED_MAINTENANCE_COMPLETE';
 const metadata={...syntheticCheckpointMetadata(protectedBinding),releaseId:'earlier_rehearsal',checksum:'e'.repeat(64)};
 protectedBinding.qualificationCheckpoint={metadataSha256:createHash('sha256').update(JSON.stringify(canonical(metadata))).digest('hex'),metadata};
 const source=syntheticQualificationProof('coherent-independent-restore',protectedBinding);
 assert.notEqual(source.checkpoint.releaseId,protectedBinding.releaseId);
 assert.notEqual(source.checkpoint.checksum,protectedBinding.checkpointArchiveChecksum);
 assert.doesNotThrow(()=>assertOnlineQualificationProof('coherent-independent-restore',source,protectedBinding));
 assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',source,{...protectedBinding,recoveryMode:'ONLINE_COHERENT_WAL'}));
 const relabeled=structuredClone(source);relabeled.checkpoint.releaseId=protectedBinding.releaseId;
 assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',relabeled,protectedBinding));
});

test('protected COMPLETE directories bind actual archive files and original restored baseline rather than inventing v3 cuts',()=>{
 const protectedBinding=structuredClone(binding);protectedBinding.recoveryMode='PROTECTED_MAINTENANCE_COMPLETE';
 const metadata=syntheticCheckpointMetadata(protectedBinding);
 protectedBinding.checkpointSha256=createHash('sha256').update(JSON.stringify(canonical(metadata))).digest('hex');
 const source=syntheticQualificationProof('coherent-independent-restore',protectedBinding);
 assert.doesNotThrow(()=>assertOnlineQualificationProof('coherent-independent-restore',source,protectedBinding));
 for(const alter of [(s:any)=>delete s.protectedDirectoryComponents,(s:any)=>s.protectedDirectoryComponents.rootBindings.pop(),
  (s:any)=>s.protectedDirectoryComponents.rootBindings[0].payloadPrefix='files/unrelated',
  (s:any)=>s.protectedDirectoryComponents.rootBindings[1].restoredLiveRoot=s.protectedDirectoryComponents.rootBindings[0].restoredLiveRoot,
  (s:any)=>delete s.applicationHealth.backend.checkpointMetadataSha256,
  (s:any)=>{const baseline=JSON.parse(Buffer.from(s.protectedDirectoryComponents.baselineRawBase64,'base64').toString());
    baseline.sources[0].files[0].sha256='d'.repeat(64);const raw=Buffer.from(JSON.stringify(baseline));
    s.protectedDirectoryComponents.baselineRawBase64=raw.toString('base64');s.protectedDirectoryComponents.baselineSha256=createHash('sha256').update(raw).digest('hex');}]){
   const invalid=structuredClone(source);alter(invalid);assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',invalid,protectedBinding));
 }
 const online=syntheticQualificationProof('coherent-independent-restore',binding);online.protectedDirectoryComponents=source.protectedDirectoryComponents;delete online.components;
 assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',online,binding));
});
test('qualification preserves isolated source identity and separately binds the deployment checkpoint target',()=>{
  const source=syntheticQualificationProof('compatible-migrations',binding);
  const originalRaw=source.originalNativeClosures[0].nativeRawBase64;
  assert.notEqual(binding.sourceDatabase.systemIdentifier,binding.deploymentTargetDatabase.systemIdentifier);
  assert.doesNotThrow(()=>assertOnlineQualificationProof('compatible-migrations',source,binding));
  assert.equal(source.originalNativeClosures[0].nativeRawBase64,originalRaw);
  for(const invalid of [
    {...source,sourceDatabase:binding.deploymentTargetDatabase},
    {...source,deploymentTargetDatabase:binding.sourceDatabase},
    {...source,deploymentTargetDatabase:{...binding.deploymentTargetDatabase,oid:'999'}},
  ]) assert.throws(()=>assertOnlineQualificationProof('compatible-migrations',invalid,binding));
  const restored=syntheticQualificationProof('coherent-independent-restore',binding);
  restored.checkpointMetadata.sourceDatabase={...binding.sourceDatabase};
  const altered=structuredClone(binding);
  altered.checkpointSha256=createHash('sha256').update(JSON.stringify(canonical(restored.checkpointMetadata))).digest('hex');
  restored.checkpointSha256=altered.checkpointSha256;
  assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',restored,altered));
});
test('original, local restored and independent restored databases remain distinct proof domains without rewriting native bytes',()=>{
 const worker=syntheticQualificationProof('single-worker-and-completion',binding),raw=worker.originalNativeClosures[0].nativeRawBase64;
 assert.notDeepEqual(worker.proofDatabase,binding.sourceDatabase);
 assert.notDeepEqual(worker.proofDatabase,binding.proofDatabases['coherent-independent-restore']);
 assert.doesNotThrow(()=>assertOnlineQualificationProof('single-worker-and-completion',worker,binding));
 assert.equal(worker.originalNativeClosures[0].nativeRawBase64,raw);
 for(const database of [binding.sourceDatabase,binding.deploymentTargetDatabase,binding.proofDatabases['coherent-independent-restore']]){
  assert.throws(()=>assertOnlineQualificationProof('single-worker-and-completion',{...worker,proofDatabase:database},binding));
  const altered=structuredClone(binding);altered.proofDatabases['single-worker-and-completion']={...database};
  assert.throws(()=>assertOnlineQualificationProof('single-worker-and-completion',worker,altered));
 }
});
test('actual QA release identity is retained separately from the future production deployment release',()=>{
 const actual=structuredClone(binding);actual.runtimeCohorts['compatible-migrations'][0].releaseId='actual_qa_release';
 const source=syntheticQualificationProof('compatible-migrations',actual);
 const raw=source.originalNativeClosures[0].nativeRawBase64;
 assert.doesNotThrow(()=>assertOnlineQualificationProof('compatible-migrations',source,actual));
 assert.equal(JSON.parse(Buffer.from(raw,'base64').toString()).onlineScope.scope.releaseId,'actual_qa_release');
 assert.throws(()=>assertOnlineQualificationProof('compatible-migrations',source,binding));
 const forged=structuredClone(actual);forged.runtimeCohorts['compatible-migrations'][0].image='sha256:'+'0'.repeat(64);
 assert.throws(()=>assertOnlineQualificationProof('compatible-migrations',source,forged));
});
test('diagnostic support is explicit and can never replace the mandatory installed candidate routing proof',()=>{
 const observed=structuredClone(binding);
 for(const scope of ['compatible-migrations','browser-24-hours'] as const)
  observed.runtimeCohorts[scope]=observed.runtimeCohorts[scope].map(actor=>({...actor,image:'sha256:'+'e'.repeat(64),runtimeBundleSha256:'e'.repeat(64),releaseId:'actual_diagnostic_release'}));
 const migration=syntheticQualificationProof('compatible-migrations',observed);
 assert.equal(migration.executionKind,'DIAGNOSTIC_SUPPORT');
 assert.doesNotThrow(()=>assertOnlineQualificationProof('compatible-migrations',migration,observed));
 const browser=syntheticQualificationProof('browser-24-hours',observed);
 assert.doesNotThrow(()=>assertOnlineQualificationProof('browser-24-hours',browser,observed));
 for(const mutate of [
  (value:any)=>{delete value.installedRouting;},
  (value:any)=>{value.executionKind='INSTALLED_RUNTIME';},
  (value:any)=>{value.installedRouting.executions.pop();},
  (value:any)=>{value.installedRouting.proofDatabase={...binding.sourceDatabase};},
  (value:any)=>{const receipt=JSON.parse(Buffer.from(value.installedRouting.executions[0].clientRawBase64,'base64').toString());receipt.requestCount=2;value.installedRouting.executions[0].clientRawBase64=Buffer.from(JSON.stringify(receipt)).toString('base64');},
 ]){const bad=structuredClone(browser);mutate(bad);assert.throws(()=>assertOnlineQualificationProof('browser-24-hours',bad,observed));}
});
test('protected maintenance recovery cannot be called online WAL and keeps the actual checkpoint capture method',()=>{
 const bootstrap=structuredClone(binding);bootstrap.recoveryMode='PROTECTED_MAINTENANCE_COMPLETE';
 bootstrap.checkpointSha256=createHash('sha256').update(JSON.stringify(canonical(syntheticCheckpointMetadata(bootstrap)))).digest('hex');
 const proof=syntheticQualificationProof('coherent-independent-restore',bootstrap);
 assert.equal(proof.continuousWalQualified,false);
 assert.doesNotThrow(()=>assertOnlineQualificationProof('coherent-independent-restore',proof,bootstrap));
 assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',{...proof,continuousWalQualified:true},bootstrap));
 assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',proof,binding));
});
const scopes: OnlineQualificationScope[] = ['compatible-migrations', 'coherent-independent-restore', 'browser-24-hours', 'single-worker-and-completion', 'current-domain'];
for (const scope of scopes) test(scope + ': synthetic complete parser fixture passes; booleans, diagnostic scope and wrong bindings refuse', () => {
  const source = syntheticQualificationProof(scope, binding);
  assert.doesNotThrow(() => assertOnlineQualificationProof(scope, source, binding));
  for (const invalid of [{ passResult: true }, { ...source, productionAdmission: false },
    { ...source, sourceCommit: 'a'.repeat(40) }, { ...source, schemaSha256: 'a'.repeat(64) },
    { ...source, captureId: 'a'.repeat(64) }, { ...source, sourceDatabase: { ...binding.sourceDatabase, oid: '43' } },
    { ...source, images: { ...binding.images, inquiry: binding.images.frontend } },
    { ...source, originalNativeClosures: [] }, { ...source, originalNativeClosures: [{ ...source.originalNativeClosures[0], originalReturncode: 1 }] }]) {
    assert.throws(() => assertOnlineQualificationProof(scope, invalid, binding));
  }
});
test('restore requires complete coherent components, independent drill and all three actual application health results', () => {
  for (const mutate of [
    (s: any) => delete s.components.sqlite,
    (s: any) => { s.checkpoint.checksum = binding.checkpointSha256; },
    (s: any) => { s.checkpointMetadata.size++; },
    (s: any) => { s.checkpointMetadata.releaseId='other'; },
    (s: any) => { s.components.coordination.captureId = 'a'.repeat(64); },
    (s: any) => delete s.physicalRestoreRawBase64,
    (s: any) => delete s.applicationHealth.inquiry,
    (s: any) => { s.applicationHealth.frontend.status = 503; },
    (s: any) => { s.independentHostQualified = false; },
  ]) { const source = syntheticQualificationProof('coherent-independent-restore', binding); mutate(source);
    assert.throws(() => assertOnlineQualificationProof('coherent-independent-restore', source, binding)); }
});
test('browser admission refuses partial forms, retirement-based short support and missing Inquiry or transport coverage', () => {
  for (const mutate of [
    (s: any) => { s.retainedBuilds[0].execution.completedAt=s.retainedBuilds[0].supportUntil; },
    (s: any) => { s.retainedBuilds[0].execution.registrySha256='a'.repeat(64); },
    (s: any) => { s.retainedBuilds[0].supportUntil = '2026-10-19T23:59:59.000Z'; },
    (s: any) => { s.retainedBuilds[0].coverage.pop(); },
    (s: any) => { s.retainedBuilds[0].exercisedFormInventorySha256 = 'a'.repeat(64); },
    (s: any) => { s.retainedBuilds.pop(); },
  ]) { const source = syntheticQualificationProof('browser-24-hours', binding); mutate(source);
    assert.throws(() => assertOnlineQualificationProof('browser-24-hours', source, binding)); }
});
test('native closure rejects raw ACTIVE work, mismatched SQL identity and a replaced original guardian', () => {
  for (const mutate of [
    (c: any) => { c.freshSql.prepared = 1; },
    (c: any) => { c.freshSql.namespace = 'sabalan-rt-'+'f'.repeat(48); },
    (c: any) => { c.freshSql.systemIdentifier = '456'; },
    (c: any) => { c.originalPopenPid++; },
    (c: any) => { const raw = JSON.parse(Buffer.from(c.workRawBase64, 'base64').toString()); raw.phase = 'ACTIVE'; c.workRawBase64 = Buffer.from(JSON.stringify(raw)).toString('base64'); },
  ]) { const source = syntheticQualificationProof('single-worker-and-completion', binding); mutate(source.originalNativeClosures[0]);
    assert.throws(() => assertOnlineQualificationProof('single-worker-and-completion', source, binding)); }
});

test('actual signed cohort can bind prior and candidate code separately while Inquiry keeps its own source commit',()=>{
  const mixed=structuredClone(binding);
  mixed.runtimeCohorts['compatible-migrations'].push({...mixed.runtimeCohorts['compatible-migrations'][0],
    runtimeId:'e'.repeat(64),releaseId:'unit_prior_release',sourceCommit:'e'.repeat(40),image:'sha256:'+'e'.repeat(64),runtimeBundleSha256:'e'.repeat(64)});
  const proof=syntheticQualificationProof('compatible-migrations',mixed);
  assert.doesNotThrow(()=>assertOnlineQualificationProof('compatible-migrations',proof,mixed));
  assert.throws(()=>assertOnlineQualificationProof('compatible-migrations',proof,binding));
  assert.notEqual(mixed.componentSourceCommits.inquiry,mixed.sourceCommit);
  const restored=syntheticQualificationProof('coherent-independent-restore',mixed);
  assert.doesNotThrow(()=>assertOnlineQualificationProof('coherent-independent-restore',restored,mixed));
  restored.applicationHealth.inquiry.sourceCommit=mixed.sourceCommit;
  assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',restored,mixed));
});
test('domain and worker summaries cannot omit domains, leave unexercised writers, or call one HTTP target a fanout proof', () => {
  const domain = syntheticQualificationProof('current-domain', binding);domain.domainCases.pop();
  assert.throws(() => assertOnlineQualificationProof('current-domain', domain, binding));
  const startup = syntheticQualificationProof('current-domain', binding);startup.writerCoverage.startupOnly.push('performance-export');
  assert.throws(() => assertOnlineQualificationProof('current-domain', startup, binding));
  const worker = syntheticQualificationProof('single-worker-and-completion', binding);worker.singleWorker.httpTargetCount = 1;
  assert.throws(() => assertOnlineQualificationProof('single-worker-and-completion', worker, binding));
});

test('retirement-based 24-hour support is qualified with real overlap timestamps and executed clock boundaries, without literal wall waiting',()=>{
  const source=syntheticQualificationProof('browser-24-hours',binding);
  assert.equal(source.realElapsed24HoursQualified,false);
  assert.doesNotThrow(()=>assertOnlineQualificationProof('browser-24-hours',source,binding));
  source.retainedBuilds[0].observedAt=source.retainedBuilds[0].supportUntil;
  assert.throws(()=>assertOnlineQualificationProof('browser-24-hours',source,binding));
});

test('handoff proves sequential original FD12 ownership and accepts extra old HTTP actors without counting them as new fanout',()=>{
  const mixed=structuredClone(binding);const current=mixed.runtimeCohorts['single-worker-and-completion'][0];
  mixed.runtimeCohorts['single-worker-and-completion'].push({...current,runtimeId:'e'.repeat(64),releaseId:'unit_prior_release',image:'sha256:'+'e'.repeat(64),sourceCommit:'e'.repeat(40),runtimeBundleSha256:'e'.repeat(64)},
    {...current,runtimeId:'f'.repeat(64),releaseId:'unit_prior_release',image:'sha256:'+'e'.repeat(64),sourceCommit:'e'.repeat(40),runtimeBundleSha256:'e'.repeat(64)});
  const source=syntheticQualificationProof('single-worker-and-completion',mixed);
  assert.equal(source.originalNativeClosures.length,6);
  source.singleWorker.originalHandoffCompleted=false;delete source.singleWorker.maximumConcurrentOwners;
  assert.doesNotThrow(()=>assertOnlineQualificationProof('single-worker-and-completion',source,mixed));
  for(const mutate of [
    (s:any)=>s.workerOwnershipIntervals.pop(),
    (s:any)=>{s.workerOwnershipIntervals[1].admissionRequestedMonotonicNs='800';},
    (s:any)=>{s.workerOwnershipIntervals[0].exclusiveClaimObservedMonotonicNs='99999';},
    (s:any)=>{s.workerOwnershipIntervals[0].bootId='22222222-2222-2222-2222-222222222222';},
    (s:any)=>{s.workerOwnershipIntervals[0].activeClaimSha256='f'.repeat(64);},
  ]){const bad=structuredClone(source);mutate(bad);assert.throws(()=>assertOnlineQualificationProof('single-worker-and-completion',bad,mixed));}
});

test('source index and classic target config require the exact saved graph; raw native IDs are never relabelled',()=>{
  const proof=syntheticQualificationProof('coherent-independent-restore',binding);
  assert.doesNotThrow(()=>assertOnlineQualificationProof('coherent-independent-restore',proof,binding));
  for(const mutate of [
    (value:any)=>{value.imageGraphs.backend.config=value.images.backend;},
    (value:any)=>{value.imageGraphs.backend.index=value.deploymentTargetImages.backend;},
    (value:any)=>{value.imageGraphs.backend.rootfsDiffIds=[];},
    (value:any)=>{value.deploymentTargetImages.inquiry=value.deploymentTargetImages.frontend;},
  ]){const invalid=structuredClone(binding);mutate(invalid);assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',proof,invalid));}
});
test('worker provenance refuses a new-worker notification, substituted predecessor closure and partial client fanout',()=>{
  for(const mutate of [
    (proof:any)=>{proof.workerHandoff.oldNativeSha256='0'.repeat(64);},
    (proof:any)=>{proof.durable.batches[0].producerRuntimeId=proof.workerHandoff.newJobsRuntimeId;},
    (proof:any)=>{proof.clientObservations[1].originalSocketClosed=false;},
    (proof:any)=>{proof.durable.commands.pop();},
  ]){const source=syntheticQualificationProof('single-worker-and-completion',binding),proof=JSON.parse(Buffer.from(source.bridgeProofRawBase64,'base64').toString());mutate(proof);const raw=Buffer.from(JSON.stringify(proof));source.bridgeProofRawBase64=raw.toString('base64');source.bridgeAfterDrain.proofSha256=createHash('sha256').update(raw).digest('hex');assert.throws(()=>assertOnlineQualificationProof('single-worker-and-completion',source,binding));}
});


test('physical ONLINE replay cannot use a COMPLETE drill or a future continuous completion flag',()=>{
 for(const mutate of [(s:any)=>delete s.physicalRestoreRawBase64,(s:any)=>delete s.liveWalCoverage,(s:any)=>s.continuousWalQualified=true,
  (s:any)=>s.liveWalCoverage.finalIntervalCompletion=true,(s:any)=>s.liveWalCoverage.successor.sender.flushLsn='0/100',
  (s:any)=>s.liveWalCoverage.closedWindows[0].acceptedAt='2026-10-20T01:00:00Z',
  (s:any)=>s.liveWalCoverage.successor.activeRawBase64=Buffer.from(JSON.stringify({phase:'COMPLETE'})).toString('base64')]){
  const source=syntheticQualificationProof('coherent-independent-restore',binding);mutate(source);
  assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',source,binding));
 }
});
test('physical replay verifies actual cluster, named point bounds, verifier closure and separate host identity',()=>{
 for(const mutate of [(r:any)=>r.replay.inRecovery=true,(r:any)=>r.replay.lastReplayLsn='0/99',
  (r:any)=>r.replay.sourceDatabaseOid='999',(r:any)=>r.originalPgCommands[0].returncode=1,
  (r:any)=>r.recoveryMachineUuidSha256=r.sourceMachineUuidSha256,(r:any)=>r.layout.restoredFileCuts.pop(),
  (r:any)=>r.decryption.fullGcmAuthenticated=false]){
  const source=syntheticQualificationProof('coherent-independent-restore',binding),report=JSON.parse(Buffer.from(source.physicalRestoreRawBase64,'base64').toString());
  mutate(report);source.physicalRestoreRawBase64=Buffer.from(JSON.stringify(report)).toString('base64');
  assert.throws(()=>assertOnlineQualificationProof('coherent-independent-restore',source,binding));
 }
 const source=syntheticQualificationProof('coherent-independent-restore',binding),report=JSON.parse(Buffer.from(source.physicalRestoreRawBase64,'base64').toString());
 const quiet=report.originalPgCommands.find((v:any)=>v.role==='pg_waldump');quiet.stdoutRawBase64='';quiet.stdoutSha256=createHash('sha256').update('').digest('hex');
 source.physicalRestoreRawBase64=Buffer.from(JSON.stringify(report)).toString('base64');
 assert.doesNotThrow(()=>assertOnlineQualificationProof('coherent-independent-restore',source,binding));
});
