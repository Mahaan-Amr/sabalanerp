import assert from 'node:assert/strict';

export const authorityCohortSources=Object.freeze([
  'scripts/lib/application-native-authority-cohort.mjs',
  'tests/online-deployment/application-native-authority-cohort.fixture.py',
]);
export const authorityVolumes=Object.freeze({runtime:'sabalanerp-local_online_runtime_authority',jobs:'sabalanerp-local_online_runtime_jobs_authority'});
export const authorityMounts=Object.freeze({
  'backend-candidate':[
    {target:'/app/runtime-authority',kind:'runtime',rw:true,subpath:true},
    {target:'/run/sabalan-online',kind:'jobs',rw:false,subpath:true},
    {target:'/app/qualification-authority-root',kind:'runtime',rw:true,subpath:false},
  ],
  'backend-retained':[
    {target:'/run/sabalan-online',kind:'runtime',rw:false,subpath:true},
    {target:'/app/jobs-authority',kind:'jobs',rw:true,subpath:true},
    {target:'/app/qualification-jobs-root',kind:'jobs',rw:true,subpath:false},
  ],
});
export function authoritySubpath(nonce){assert.match(nonce,/^[a-f0-9]{32}$/,'FRESH_AUTHORITY_COHORT_NONCE_REQUIRED');return 'cohort-'+nonce;}
export function validateAuthorityNamespaceIdentity(value){
  const fields=['st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'];
  assert.deepEqual(Object.keys(value).sort(),fields.sort());
  for(const field of fields)assert.match(value[field],/^(?:0|[1-9][0-9]{0,19})$/,'LOSSLESS_AUTHORITY_NAMESPACE_IDENTITY_REQUIRED');
  assert.equal(value.st_uid,'0');assert.equal(value.st_mode,String(0o40700));return value;
}
export const precisionFailedAuthorityCohortSha256='f071286164f1758088cb8cc1ed055dad7e039864e192171233726b28ddc17a92';
export const hostMemoryFailedAuthorityCohortSha256='1cccc94373dd98846b5aa8082fa9d76d3edc7a2a3e14e467e8e3e57677dc568d';
export const hostMemoryFailedAncestorSha256='5c6ffedf131d47d280651f55130ffa25f5798cbbe462ae185f66c577b56229fd';
export function hostMemoryFailedAuthorityNamespaces(value){
 assert.equal(value.operation,'0d4865c14f99d0bcf9e807db5b895dc8');assert.equal(value.pass,false);assert.equal(value.phase,'FAILED_CLOSED');assert.equal(value.productionAdmission,false);assert.deepEqual(value.failure,{name:'AssertionError',message:'LOCAL_QA_HOST_MEMORY_FLOOR_REFUSED'});
 assert.equal(value.actual,undefined);assert.equal(value.originalChildren,undefined);assert.equal(value.authorityCohort.nonce,'cec7a68d24be238f0a8834a5c44bdf44');assert.deepEqual(value.protectedAfter,value.protectedBefore);assert.equal(Object.keys(value.protectedBefore).length,8);assert.equal(value.up.code,0);assert.equal(value.up.signal,null);assert.equal(value.up.failure,undefined);assert.ok(value.up.originalPid>0);
 const t=value.candidateQaMemoryTransition;assert.equal(t.format,'sabalan-explicit-local-qa-candidate-memory-transition/v3');assert.equal(t.predecessor.sha256,hostMemoryFailedAncestorSha256);assert.equal(value.inputs[t.predecessor.file],hostMemoryFailedAncestorSha256);assert.equal(t.afterUp,undefined);assert.equal(t.runtimeLimitsAfter,undefined);assert.equal(t.before['backend-candidate'],1536*1024**2);assert.equal(t.after['backend-candidate'],2048*1024**2);
 const result={};for(const service of Object.keys(authorityMounts)){
  const prepared=value.authorityCohort.prepared[service],verified=value.authorityCohort.verified[service];
  for(const [row,mode]of [[prepared,'create'],[verified,'verify']]){assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>0);assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.failure,undefined);assert.ok(Buffer.byteLength(row.stdout)<65536);assert.deepEqual(JSON.parse(row.stdout),row.result);assert.equal(row.result.mode,mode);assert.equal(row.result.nonce,value.authorityCohort.nonce);assert.equal(row.result.empty,true);assert.equal(row.result.productionAdmission,false);validateAuthorityNamespaceIdentity(row.result.namespace);}
  assert.equal(prepared.result.exclusivelyCreated,true);assert.deepEqual(prepared.result.namespace,verified.result.namespace);const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';assert.deepEqual(verified.result.consumerNamespace,value.authorityCohort.prepared[peer].result.namespace);result[service]=verified.result.namespace;
 }return result;
}
export function precisionFailedAuthorityNamespaces(value){
  if(value.operation==='0d4865c14f99d0bcf9e807db5b895dc8')return hostMemoryFailedAuthorityNamespaces(value);
  // This is the one preserved, independently reproduced precision failure.
  // It is never upgraded to a successful replacement receipt.
  assert.equal(value.operation,'70ef926d515138b606e47ce11e32d011');assert.equal(value.pass,false);assert.equal(value.phase,'FAILED_CLOSED');assert.equal(value.productionAdmission,false);
  assert.equal(value.authorityCohort?.nonce,'cbd70d62f0ce9abafb348acff4f86f56');assert.deepEqual(value.authorityCohort.verified,{});
  assert.equal(value.up.code,0);assert.equal(value.up.signal,null);assert.equal(value.up.failure,undefined);
  assert.deepEqual(value.protectedBefore,value.protectedAfter);assert.equal(Object.keys(value.protectedBefore).length,8);
  assert.equal(value.failure.name,'AssertionError');assert.ok(value.failure.message.includes('1 !== 0'));
  const result={};
  for(const service of Object.keys(authorityMounts)){
    const prepared=value.authorityCohort.prepared[service];assert.equal(prepared.code,0);assert.equal(prepared.signal,null);assert.equal(prepared.failure,undefined);assert.ok(Number.isSafeInteger(prepared.originalPid)&&prepared.originalPid>0);
    assert.ok(Buffer.byteLength(prepared.stdout)<=65536);let fields=0;
    const lossless=prepared.stdout.replace(/"(st_dev|st_ino|st_uid|st_gid|st_mode|st_nlink|st_size|st_mtime_ns|st_ctime_ns)"\s*:\s*([0-9]+)/g,(_,key,integer)=>{fields++;return JSON.stringify(key)+':'+JSON.stringify(integer);});
    assert.equal(fields,9,'EXACT_ORIGINAL_RAW_NAMESPACE_REQUIRED');const parsed=JSON.parse(lossless);
    assert.equal(parsed.format,'sabalan-authority-cohort-directory/v1');assert.equal(parsed.mode,'create');assert.equal(parsed.nonce,value.authorityCohort.nonce);assert.equal(parsed.empty,true);assert.equal(parsed.exclusivelyCreated,true);assert.equal(parsed.productionAdmission,false);
    result[service]=validateAuthorityNamespaceIdentity(parsed.namespace);
  }
  return result;
}
export function validatePrecisionFailedAuthoritySlots(failed,containers,protectedNow){
  precisionFailedAuthorityNamespaces(failed);assert.deepEqual(protectedNow,failed.protectedAfter);validateAuthorityCohortSlots(containers,failed.authorityCohort.nonce);
  const identities={};
  for(const service of Object.keys(authorityMounts)){
    const current=containers[service];assert.notEqual(current.Id,failed.previous[service].id);assert.notEqual(current.State.StartedAt,failed.previous[service].startedAt);
    assert.equal(current.Image,service==='backend-candidate'?failed.immutableImage:failed.previous[service].image);assert.equal(current.State.Running,true);assert.equal(current.State.Health.Status,'healthy');
    identities[service]={id:current.Id,image:current.Image,startedAt:current.State.StartedAt};
  }
  return {format:'sabalan-reobserved-precision-failed-authority-cohort/v1',failedOperation:failed.operation,failedReportRemainsFailed:true,adoptsOriginalPopen:false,originalNativeClosureInferred:false,identities,installedBytesVerified:false,nativeAndSqlQuietVerified:false,currentEmptyNamespacesVerified:false};
}
export function validateReconciledPrecisionFailedBaseline(value,failed){
  assert.equal(value.failedAuthorityCohort.sha256,failed.operation==='0d4865c14f99d0bcf9e807db5b895dc8'?hostMemoryFailedAuthorityCohortSha256:precisionFailedAuthorityCohortSha256);assert.ok(value.authorityCohort,'FAILED_BASELINE_ONLY_PERMITS_NEW_COHORT_ROTATION');
  const expected=precisionFailedAuthorityNamespaces(failed),baseline=value.reconciledFailedAuthorityBaseline;
  assert.equal(baseline.format,'sabalan-reobserved-precision-failed-authority-cohort/v1');assert.equal(baseline.failedOperation,failed.operation);assert.equal(baseline.failedReportRemainsFailed,true);
  for(const key of ['adoptsOriginalPopen','originalNativeClosureInferred'])assert.equal(baseline[key],false);
  for(const key of ['installedBytesVerified','nativeAndSqlQuietVerified','currentEmptyNamespacesVerified'])assert.equal(baseline[key],true);
  assert.deepEqual(baseline.identities,value.previous);assert.notEqual(value.authorityCohort.nonce,failed.authorityCohort.nonce);
  assert.equal(baseline.candidateEvidence.image,failed.immutableImage);
  for(const service of Object.keys(authorityMounts)){
    const row=value.failedAuthorityBaselineVerified[service],readback=value.reobservedInstalled[service];
    for(const child of [row,readback]){assert.ok(Number.isSafeInteger(child.originalPid)&&child.originalPid>0);assert.equal(child.code,0);assert.equal(child.signal,null);assert.equal(child.failure,undefined);}
    const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';
    assert.equal(row.result.mode,'verify');assert.equal(row.result.nonce,failed.authorityCohort.nonce);assert.equal(row.result.empty,true);
    assert.deepEqual(row.result.namespace,expected[service]);assert.deepEqual(row.result.consumerNamespace,expected[peer]);
    assert.equal(value.reobservedNativeQuiet[service].originalNativeProcesses,0);assert.equal(value.reobservedNativeQuiet[service].adoptsOriginalPopen,false);
  }
  assert.equal(value.reobservedSqlQuiet.visible,true);assert.equal(value.reobservedSqlQuiet.sessions,0);assert.equal(value.reobservedSqlQuiet.prepared,0);assert.equal(value.reobservedSqlQuiet.system,value.sqlQuiet.system);
  return true;
}
const configuredMount=(value,target)=>{const found=value.volumes.filter(m=>m.target===target);assert.equal(found.length,1);return found[0];};
export function validateAuthorityCohortConfiguration(configuration,nonce){
  const subpath=authoritySubpath(nonce);assert.equal(configuration.name,'sabalanerp-local');
  for(const[service,mounts]of Object.entries(authorityMounts))for(const expected of mounts){
    const actual=configuredMount(configuration.services[service],expected.target);
    assert.equal(actual.type,'volume');assert.equal(configuration.volumes[actual.source].name,authorityVolumes[expected.kind]);
    assert.equal(!actual.read_only,expected.rw);assert.equal(actual.volume?.nocopy,true);
    assert.equal(actual.volume?.subpath??'',expected.subpath?subpath:'');
  }
}
function observedMount(container,target){const found=container.Mounts.filter(m=>m.Destination===target);assert.equal(found.length,1);return found[0];}
function requestedMount(container,target){const found=(container.HostConfig.Mounts??[]).filter(m=>m.Target===target);assert.equal(found.length,1,'EXPLICIT_ENGINE_VOLUME_SUBPATH_REQUIRED');return found[0];}
export function validateAuthorityCohortSlots(containers,nonce){
  const subpath=authoritySubpath(nonce);
  for(const[service,mounts]of Object.entries(authorityMounts)){
    const container=containers[service];assert.equal(container.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
    assert.equal(container.Config.Labels['com.docker.compose.service'],service);
    for(const expected of mounts){
      const actual=observedMount(container,expected.target),requested=requestedMount(container,expected.target);
      assert.equal(actual.Type,'volume');assert.equal(actual.Name,authorityVolumes[expected.kind]);assert.equal(actual.RW,expected.rw);
      assert.equal(requested.Type,'volume');assert.equal(requested.Source,authorityVolumes[expected.kind]);assert.equal(!requested.ReadOnly,expected.rw);
      assert.equal(requested.VolumeOptions?.NoCopy,true);assert.equal(requested.VolumeOptions?.Subpath??'',expected.subpath?subpath:'');
    }
    const forbidden=service==='backend-candidate'?authorityVolumes.jobs:authorityVolumes.runtime;
    assert.ok(!container.Mounts.some(m=>m.Name===forbidden&&m.RW),'PEER_AUTHORITY_VOLUME_MUST_BE_READONLY');
  }
  for(const[writer,producer,reader,consumer]of [
    ['backend-candidate','/app/runtime-authority','backend-retained','/run/sabalan-online'],
    ['backend-retained','/app/jobs-authority','backend-candidate','/run/sabalan-online'],
  ])assert.equal(observedMount(containers[writer],producer).Source,observedMount(containers[reader],consumer).Source);
  return true;
}
export function authorityWriterRoot(container,service){
  assert.ok(Object.hasOwn(authorityMounts,service));const kind=service==='backend-candidate'?'runtime':'jobs';
  const root=service==='backend-candidate'?'/app/qualification-authority-root':'/app/qualification-jobs-root';
  const legacy=service==='backend-candidate'?'/app/runtime-authority':'/app/jobs-authority';
  const target=container.Mounts.some(m=>m.Destination===root)?root:legacy;
  const actual=observedMount(container,target);assert.equal(actual.Type,'volume');assert.equal(actual.Name,authorityVolumes[kind]);assert.equal(actual.RW,true);
  const requested=(container.HostConfig.Mounts??[]).filter(m=>m.Target===target);
  if(requested.length){assert.equal(requested.length,1);assert.equal(requested[0].VolumeOptions?.Subpath??'','','WHOLE_AUTHORITY_VOLUME_ROOT_REQUIRED');}
  // Short-syntax legacy mounts have no HostConfig.Mounts entry. Their Source
  // must be the exact named-volume root, never an already-mounted cohort.
  assert.equal(actual.Source,`/var/lib/docker/volumes/${authorityVolumes[kind]}/_data`,'WHOLE_AUTHORITY_VOLUME_ROOT_REQUIRED');
  return {target,kind,volume:authorityVolumes[kind],legacyBootstrap:target===legacy};
}
export function validateAuthorityCohortReceipt(value){
  const cohort=value.authorityCohort;assert.equal(cohort?.format,'sabalan-native-authority-cohort/v1');authoritySubpath(cohort.nonce);
  assert.equal(value.onlyCandidateReplaced,false);assert.equal(value.retainedOriginalPreserved,false);assert.equal(value.onlyQualificationSlotsRecreated,true);
  const protectedNames=['backend','frontend','postgres','inquiry','redis','clamav','frontend-candidate','frontend-retained'].sort();
  assert.deepEqual(Object.keys(value.protectedBefore).sort(),protectedNames);assert.deepEqual(value.protectedBefore,value.protectedAfter);assert.deepEqual(value.protectedBefore,value.finalProtected);
  for(const service of Object.keys(authorityMounts)){
    const before=value.previous[service],after=value.actual[service];assert.notEqual(after.id,before.id,'FRESH_AUTHORITY_SLOT_INCARNATION_REQUIRED');assert.notEqual(after.startedAt,before.startedAt);
    assert.equal(after.image,value.roleEvidence[service==='backend-candidate'?'candidate':'main'].image);
    const prepared=cohort.prepared[service],verified=cohort.verified[service];
    for(const row of [prepared,verified]){assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>0);assert.equal(row.code,0);assert.equal(row.signal,null);assert.equal(row.failure,undefined);}
    assert.equal(prepared.result.format,'sabalan-authority-cohort-directory/v1');assert.equal(prepared.result.mode,'create');assert.equal(prepared.result.nonce,cohort.nonce);assert.equal(prepared.result.exclusivelyCreated,true);assert.equal(prepared.result.empty,true);
    assert.equal(verified.result.format,'sabalan-authority-cohort-directory/v1');assert.equal(verified.result.mode,'verify');assert.equal(verified.result.nonce,cohort.nonce);assert.equal(verified.result.empty,true);
    validateAuthorityNamespaceIdentity(prepared.result.namespace);validateAuthorityNamespaceIdentity(verified.result.namespace);validateAuthorityNamespaceIdentity(verified.result.consumerNamespace);
    assert.deepEqual(verified.result.namespace,prepared.result.namespace);
    const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';
    assert.deepEqual(verified.result.consumerNamespace,cohort.prepared[peer].result.namespace);
  }
  assert.equal(value.actual['backend-retained'].image,value.previous['backend-retained'].image);
  return true;
}

export const hostMemoryFailedSnapshot={file:'D:/sabalanerp-online-qa/C13-failed-transition-actual-current-slots-20261023.json',sha256:'8fafb7b06c860936e8b36b0179cd5bcd3d48422a91df7e5dc5a857b80b1896dd'};
export const hostMemoryFailedOwnerObservation={file:'D:/sabalanerp-online-qa/C13-negative-preparation-tool-owner-observation-20261023.json',sha256:'c5984447fb9598ea280de909879f655175cc3fe1f7ae4b104d41e88694a2f241'};
export function validateHostMemoryFailedObservation(snapshot,owner){
 assert.equal(snapshot.format,'sabalan-failed-local-transition-readonly-current-inspection/v1');assert.equal(snapshot.negativeReportSha256,hostMemoryFailedAuthorityCohortSha256);assert.equal(snapshot.canonicalProject,'sabalanerp-local');assert.equal(snapshot.readOnly,true);assert.equal(snapshot.qualified,false);assert.equal(snapshot.containers.length,10);
 assert.equal(owner.format,'sabalan-negative-preparation-tool-owner-observation/v1');assert.equal(owner.toolSessionId,57622);assert.equal(owner.actualFinalToolChunkId,'6313ec');assert.equal(owner.toolReturnedExitCode,1);assert.equal(owner.toolReturnedFinalOutput,true);assert.equal(owner.negativeReport.sha256,hostMemoryFailedAuthorityCohortSha256);assert.equal(owner.observedError.message,'LOCAL_QA_HOST_MEMORY_FLOOR_REFUSED');for(const key of ['qualificationSucceeded','productionAdmission','originalNativeClosureClaimed','missingHistoricalFieldsReconstructed','originalPopenAdopted'])assert.equal(owner[key],false);
}
export function validateHostMemoryFailedCurrentSlots(snapshot,current){
 for(const service of Object.keys(authorityMounts)){const rows=snapshot.containers.filter(row=>row.Labels['com.docker.compose.service']===service);assert.equal(rows.length,1);const old=rows[0],actual=current[service];assert.equal(actual.Id,old.Id);assert.equal(actual.Image,old.Image);assert.equal(actual.State.StartedAt,old.StartedAt);assert.equal(actual.State.Running,true);assert.equal(actual.State.Health.Status,'healthy');assert.deepEqual(actual.Config.Labels,old.Labels);assert.deepEqual(actual.Mounts,old.Mounts);assert.deepEqual(Object.fromEntries(Object.keys(old.HostConfig).map(key=>[key,actual.HostConfig[key]])),old.HostConfig);}
}
