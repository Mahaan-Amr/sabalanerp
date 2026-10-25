import{assertCandidateApplicationSource}from'./lib/application-native-operations-source-reuse.mjs';
import {historicalCapsuleTargets,historicalCapsuleInputFiles,historicalCapsulePreflightSpec,validateHistoricalCapsuleConfiguration,validateHistoricalCapsulePair,validatePreviousHistoricalCapsulePair} from './lib/application-native-historical-capsules.mjs';
import {readPostUpMemoryBaseline,postUpMemoryDescriptor,postUpMemoryInputs,validatePostUpCurrentSlots,postUpAcceptanceExpectation,capsulePostUpBaselineFormat,capsulePostUpFailureContext,postUpAcceptanceBootstrap,postUpAcceptanceBootstrapForToken,postUpAcceptanceSelection,validatePostUpAcceptanceResult} from './lib/application-native-post-up-memory-baseline.mjs';
import {readNegativeRecoveryHandoff,negativeRecoveryDescriptor,negativeRecoveryInputs,negativeRecoveryStreamingInputs,negativeRecoveryAcceptance,validateNegativeRecoveryPhysicalReadback} from './lib/application-native-negative-baseline.mjs';
import {validateNegativeAcceptanceConfiguration,validateNegativeAcceptanceSlots} from './lib/application-native-negative-acceptance.mjs';
import {negativeCapsuleFormat,negativeCapsuleAcceptanceSelection,negativeCapsuleAcceptanceBootstrap,validateNegativeCapsuleAcceptanceResult} from './lib/application-native-negative-capsule-acceptance.mjs';
import {readExplicitQaMemoryProfile,readQaMemoryProfile,qaMemoryProfileTransition,qaMemoryProfileInputs} from './lib/application-native-qa-profile.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {validateQaMemoryConfiguration,validateQaSwapConfiguration,validateQaPreservedRuntimeLimits,qaUnchangedResourceLimits,validateQaHostMemoryObservation,stabilizeQaHostMemory,validateQaMemoryTransitionReceipt,nativeActorFloorBytes} from './lib/application-native-qa-memory.mjs';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {validateA29RetirementCertificate,loadA29Evidence,a29EvidenceFiles} from './lib/a29-known-negative-retirement.mjs';
import {authorityCohortSources,authorityMounts,authoritySubpath,authorityWriterRoot,validateAuthorityCohortConfiguration,validateAuthorityCohortSlots,validateAuthorityCohortReceipt,precisionFailedAuthorityCohortSha256,hostMemoryFailedAuthorityCohortSha256,hostMemoryFailedAncestorSha256,hostMemoryFailedSnapshot,hostMemoryFailedOwnerObservation,validateHostMemoryFailedObservation,validateHostMemoryFailedCurrentSlots,precisionFailedAuthorityNamespaces,validatePrecisionFailedAuthoritySlots,validateReconciledPrecisionFailedBaseline} from './lib/application-native-authority-cohort.mjs';

export function validateCandidatePreflight(value,now=Date.now()){
 assert.equal(value.sshExitCode,0);const age=now-Date.parse(value.observedAt);assert.ok(Number.isFinite(age)&&age>=0&&age<=600000,'BOTH_HOST_PREFLIGHT_STALE');
 const remote=JSON.parse(value.stdout);assert.equal(remote.exitCode,0);assert.equal(remote.lockHeldThroughBothHostPreflight,true);
 assert.equal(remote.productionCommitBefore,remote.productionCommitAfter);assert.match(remote.productionCommitBefore,/^[a-f0-9]{40}$/);
 const rows=remote.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
 const prerequisites=rows.filter(row=>row.format==='sabalan-host-backup-retention-prerequisites/v1');assert.ok(prerequisites.length<=1);
 for(const row of prerequisites)assert.deepEqual(row,{format:'sabalan-host-backup-retention-prerequisites/v1',inspected:true,sshStarted:false,mutation:false});
 const clean=rows.filter(row=>row.format!=='sabalan-host-backup-retention-prerequisites/v1');assert.equal(clean.length,2);
 assert.deepEqual(clean.map(row=>row.project).sort(),['sabalanerp','sabalanerp-backup']);for(const row of clean)assert.equal(row.ok,true);
}
export const candidateReplacementServices=Object.freeze(['backend','frontend','postgres','inquiry','redis','clamav','frontend-candidate','frontend-retained','backend-candidate','backend-retained']);
export function validateCandidateProjectRows(values){
 assert.equal(values.length,10,'EXACT_TEN_PROJECT_SERVICES_REQUIRED');
 assert.deepEqual(values.map(value=>value.Service).sort(),[...candidateReplacementServices].sort());
 for(const value of values){assert.equal(value.Project,'sabalanerp-local');assert.equal(value.State,'running');assert.equal(value.Health,'healthy');}
 return values;
}
export function nativeMaterialIdentity(material){
 const inventory=prefix=>{const entries=material.files.filter(row=>row.path.startsWith(prefix)).map(row=>({bytes:row.bytes,path:row.path.slice(prefix.length),sha256:row.sha256})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 assert.ok(entries.length>0);assert.equal(new Set(entries.map(row=>row.path)).size,entries.length);for(const row of entries){assert.match(row.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0);}
 return{sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),entries};};
 const entry=material.files.find(row=>row.path==='app/dist/onlinePrivateQualification.js');assert.ok(entry);assert.match(material.schemaSha256,/^[a-f0-9]{64}$/);
 return{dist:inventory('app/dist/'),client:inventory('app/node_modules/@prisma/client/'),entry,
 runtime:{entryPath:'/app/dist/onlinePrivateQualification.js',entrySha256:entry.sha256,distTreeSha256:inventory('app/dist/').sha256,schemaSha256:material.schemaSha256,clientInventorySha256:inventory('app/node_modules/@prisma/client/').sha256}};
}
export function validateInstalledNativeRole(result,expected){
 assert.equal(result.format,'sabalan-actual-installed-native-image/v1');assert.equal(result.entrySha256,expected.runtime.entrySha256);assert.equal(result.schemaSha256,expected.runtime.schemaSha256);
 assert.equal(result.dist.sha256,expected.dist.sha256);assert.deepEqual(result.dist.entries,expected.dist.entries);assert.equal(result.client.sha256,expected.client.sha256);assert.deepEqual(result.client.entries,expected.client.entries);
 assert.equal(result.entryExportPresent,true);assert.equal(result.applicationStarted,false);assert.equal(result.databaseConnected,false);assert.equal(result.productionAdmission,false);
}
export function parseCandidateReplacementArguments(argv){
 const memoryFlag=argv.at(-1);const candidateQaMemoryTransition=memoryFlag==='--candidate-qa-memory-1280'?'v1':memoryFlag==='--candidate-qa-memory-1536'?'v2':memoryFlag==='--candidate-qa-memory-2048'?'v3':false;if(candidateQaMemoryTransition)argv=argv.slice(0,-1);
 let negativeRetirement=null;if(argv.at(-4)==='--a29-negative-retirement-file'){assert.equal(argv.at(-2),'--a29-negative-retirement-sha256');assert.ok(path.isAbsolute(argv.at(-3)));assert.match(argv.at(-1),/^[a-f0-9]{64}$/);negativeRetirement={file:path.resolve(argv.at(-3)),sha256:argv.at(-1)};argv=argv.slice(0,-4);}
 const isolateAuthorityCohort=argv.at(-1)==='--isolate-authority-cohort';if(isolateAuthorityCohort)argv=argv.slice(0,-1);
 let postUpMemoryBaseline=null;if(argv[7]==='--post-up-memory-baseline-file'){assert.equal(argv.length,11);assert.equal(argv[9],'--post-up-memory-baseline-sha256');assert.ok(path.isAbsolute(argv[8]));assert.match(argv[10],/^[a-f0-9]{64}$/);assert.equal(isolateAuthorityCohort,true,'POST_UP_BASELINE_REQUIRES_FRESH_COHORT');assert.equal(candidateQaMemoryTransition,false,'POST_UP_BASELINE_CANNOT_TRANSITION');assert.equal(negativeRetirement,null,'POST_UP_BASELINE_CANNOT_INHERIT_A29');postUpMemoryBaseline={file:path.resolve(argv[8]),sha256:argv[10]};argv=argv.slice(0,7);}
 let negativeRecoveryHandoff=null;if(argv[7]==='--negative-recovery-handoff-file'){assert.equal(argv.length,11);assert.equal(argv[9],'--negative-recovery-handoff-sha256');assert.ok(path.isAbsolute(argv[8]));assert.match(argv[10],/^[a-f0-9]{64}$/);assert.equal(isolateAuthorityCohort,true,'NEGATIVE_BASELINE_REQUIRES_FRESH_COHORT');assert.equal(candidateQaMemoryTransition,false,'NEGATIVE_BASELINE_CANNOT_TRANSITION_HISTORY');assert.equal(negativeRetirement,null,'NEGATIVE_BASELINE_CANNOT_INHERIT_A29');negativeRecoveryHandoff={file:path.resolve(argv[8]),sha256:argv[10]};argv=argv.slice(0,7);}
 assert.ok(argv.length===7||argv.length===11,'EXACT_REPLACEMENT_ARGUMENTS_REQUIRED');assert.ok(['--inspect','--replace'].includes(argv[0]));
 for(const[i,key]of ['--image-receipt','--material-receipt','--preflight'].entries())assert.equal(argv[1+i*2],key);
 if(candidateQaMemoryTransition){assert.equal(isolateAuthorityCohort,true,'QA_MEMORY_TRANSITION_REQUIRES_FRESH_COHORT');assert.equal(argv.length,11,'QA_MEMORY_TRANSITION_REQUIRES_PREVIOUS_RECEIPT');assert.equal(argv[7],'--previous-replacement-receipt');}
 if(negativeRetirement)assert.equal(isolateAuthorityCohort,true,'A29_NEGATIVE_RETIREMENT_REQUIRES_FRESH_COHORT');
 const result={...(postUpMemoryBaseline?{postUpMemoryBaseline}:{}),...(negativeRecoveryHandoff?{negativeRecoveryHandoff}:{}),...(candidateQaMemoryTransition?{candidateQaMemoryTransition}:{}),...(negativeRetirement?{negativeRetirement}:{}),inspectOnly:argv[0]==='--inspect',imageReceiptFile:path.resolve(argv[2]),materialReceiptFile:path.resolve(argv[4]),preflightFile:path.resolve(argv[6]),...(isolateAuthorityCohort?{isolateAuthorityCohort:true}:{})};
 if(argv.length===11){const failed=argv[7]==='--failed-authority-cohort-receipt';assert.equal(argv[7],failed?'--failed-authority-cohort-receipt':'--previous-replacement-receipt');assert.equal(argv[9],failed?'--failed-authority-cohort-sha256':'--previous-replacement-sha256');assert.ok(path.isAbsolute(argv[8]));assert.match(argv[8].replaceAll('\\','/'),/\/reports\/qa\/application-native-candidate-[a-f0-9]{32}\.json$/);assert.match(argv[10],/^[a-f0-9]{64}$/);if(failed){assert.equal(isolateAuthorityCohort,true,'FAILED_COHORT_REQUIRES_FRESH_ROTATION');assert.ok([precisionFailedAuthorityCohortSha256,hostMemoryFailedAuthorityCohortSha256].includes(argv[10]));result.failedAuthorityCohort={file:path.resolve(argv[8]),sha256:argv[10]};}else result.previousReplacement={file:path.resolve(argv[8]),sha256:argv[10]};}return result;
}
export function validatePreviousCandidateReplacement(value){
 if(Object.hasOwn(value,'replacementEntry'))assert.equal(value.replacementEntry,'scripts/replace-qualified-application-native-candidate-local.mjs');
 assert.equal(value.format,'sabalan-application-native-candidate/v1');assert.equal(value.pass,true);assert.equal(value.phase,'COMPLETE');assert.equal(value.productionAdmission,false);
 if(value.authorityCohort)validateAuthorityCohortReceipt(value);else for(const key of ['onlyCandidateReplaced','retainedOriginalPreserved'])assert.equal(value[key],true);validateQaMemoryTransitionReceipt(value);assert.equal(value.up.code,0);assert.equal(value.up.signal,null);assert.equal(value.up.failure,undefined);assert.ok(Number.isSafeInteger(value.up.originalPid)&&value.up.originalPid>0);
 assert.deepEqual(value.originalChildren,{allOriginalChildrenClosed:true,interrupted:false});const protectedNames=candidateReplacementServices.filter(name=>name!=='backend-candidate'&&(!value.authorityCohort||name!=='backend-retained')).sort();assert.deepEqual(Object.keys(value.protectedBefore).sort(),protectedNames);assert.deepEqual(value.protectedAfter,value.protectedBefore);assert.deepEqual(value.finalProtected,value.protectedBefore);
 for(const stage of ['nativeQuiet','preMutationNativeQuiet','postMutationNativeQuiet'])for(const service of ['backend-candidate','backend-retained']){assert.equal(value[stage][service].originalNativeProcesses,0);assert.equal(value[stage][service].adoptsOriginalPopen,false);}
 for(const stage of ['sqlQuiet','preMutationSqlQuiet','postMutationSqlQuiet']){assert.equal(value[stage].visible,true);assert.equal(value[stage].sessions,0);assert.equal(value[stage].prepared,0);assert.equal(value[stage].system,value.sqlQuiet.system);}
 for(const[role,service]of [['main','backend-retained'],['candidate','backend-candidate']]){const actual=value.actual[service],evidence=value.roleEvidence[role];assert.match(actual.id,/^[a-f0-9]{64}$/);assert.match(actual.image,/^sha256:[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(actual.startedAt)));assert.equal(evidence.image,actual.image);for(const key of ['imageReceiptSha256','materialReceiptSha256'])assert.match(evidence[key],/^[a-f0-9]{64}$/);assert.equal(value.installed[service].code,0);assert.equal(value.installed[service].signal,null);}
 assert.equal(value.actual['backend-retained'].image,'sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186');assert.equal(value.immutableImage,value.actual['backend-candidate'].image);assert.notEqual(value.immutableImage,value.actual['backend-retained'].image);return value;
}
export function validateReobservedCandidateSlots(previous,current){
 validatePreviousCandidateReplacement(previous);const identities={};for(const service of ['backend-candidate','backend-retained']){const wanted=previous.actual[service],actual=current[service];assert.equal(actual.Id,wanted.id,'PREVIOUS_OWNED_CONTAINER_ID_CHANGED');assert.equal(actual.Image,wanted.image,'PREVIOUS_OWNED_IMAGE_CHANGED');assert.equal(actual.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(actual.Config.Labels['com.docker.compose.service'],service);assert.equal(actual.State.Running,true);assert.equal(actual.State.Health.Status,'healthy');assert.ok(Number.isFinite(Date.parse(actual.State.StartedAt)));identities[service]={id:actual.Id,image:actual.Image,startedAt:actual.State.StartedAt};}
 return{format:'sabalan-reobserved-quiescent-installed-slots/v1',identities,previousIdentities:Object.fromEntries(['backend-candidate','backend-retained'].map(service=>[service,Object.fromEntries(['id','image','startedAt'].map(key=>[key,previous.actual[service][key]]))])),adoptsOriginalPopen:false,originalNativeClosureInferred:false,birthReasonClaimed:false,productionAdmission:false};
}
export function qualifiedCandidateNativeQuietProbe(negativeRetirement){return String.raw`import os,json,stat,hashlib
from pathlib import Path
def assert_negative_original_guardian_not_live(guardian):
 boot=Path('/proc/sys/kernel/random/boot_id').read_text().strip();namespace=os.readlink('/proc/self/ns/pid')
 if boot!=guardian['bootId'] or namespace!=guardian['pidNamespace']:return
 process=Path('/proc')/str(guardian['pid'])
 def birth_from_stat(raw):
  assert len(raw)<=16384 and ') ' in raw and raw.split(' ',1)[0]==str(guardian['pid']),'A29_GUARDIAN_STAT_UNKNOWN'
  fields=raw.rsplit(') ',1)[1].split();assert len(fields)>=20 and fields[19].isdigit(),'A29_GUARDIAN_STAT_UNKNOWN';return fields[19]
 try:first=(process/'stat').read_text()
 except FileNotFoundError:
  # A missing stat alone must not hide permissions, malformed procfs, or a still-present directory.
  try:process.stat()
  except FileNotFoundError:pass
  else:raise AssertionError('A29_GUARDIAN_OBSERVATION_UNKNOWN')
 else:
  observedNamespace=os.readlink(process/'ns/pid');second=(process/'stat').read_text()
  assert observedNamespace==os.readlink(process/'ns/pid')==namespace and birth_from_stat(first)==birth_from_stat(second),'A29_GUARDIAN_OBSERVATION_CHANGED'
  assert birth_from_stat(second)!=str(guardian['startTicks']),'A29_ORIGINAL_GUARDIAN_STILL_PRESENT'
 assert Path('/proc/sys/kernel/random/boot_id').read_text().strip()==boot and os.readlink('/proc/self/ns/pid')==namespace,'A29_OBSERVATION_NAMESPACE_CHANGED'
found=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit() or int(p.name)==os.getpid(): continue
 try:
  argv=(p/'cmdline').read_bytes().split(b'\0');environment=(p/'environ').read_bytes().split(b'\0')
  if any(item.startswith(key)and item[len(key):]for item in environment for key in [b'BACKEND_ONLINE_SCOPE_FILE=',b'BACKEND_ONLINE_RUNTIME_ID=']):found.append(int(p.name))
  if any(Path(a.decode(errors='strict')).name in ['online-runtime-owner.py','backend-runtime-owner.py','online-inquiry-owner.py','fixture.py','application-native-candidate-controller.py','run-full-catalog-controller.py','chromium','chrome','chrome_crashpad_handler'] for a in argv if a): found.append(int(p.name))
 except FileNotFoundError: pass
assert not found, 'APPLICATION_ROLE_ORIGINAL_OWNER_STILL_PRESENT'
closed=0; unused=0; negativeCancelled=0
negative=${JSON.stringify(JSON.stringify(negativeRetirement))}
negative=json.loads(negative)
readHashes={}
def read(file):
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size<=4*1024**2
  data=os.read(fd,before.st_size+1);after=os.fstat(fd);named=os.lstat(file)
  identity=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
  assert len(data)==before.st_size and identity(before)==identity(after)==identity(named)
  readHashes[str(file)]=hashlib.sha256(data).hexdigest();return json.loads(data)
 finally:os.close(fd)
def grants(value):
 if isinstance(value,dict):
  if isinstance(value.get('scope'),dict) and 'nativeDirectory' in value['scope']:yield value['scope']
  else:
   for child in value.values():yield from grants(child)
 elif isinstance(value,list):
  for child in value:yield from grants(child)
seen=set()
for operation in Path('/app/online-runtime-acceptance').glob('application-native-*'):
 index=operation/'index.json'
 if not index.exists():continue
 for scope in grants(read(index)):
  directory=Path(scope['nativeDirectory']);file=directory/'deployment-runtime-native.json'
  if str(file) in seen:continue
  seen.add(str(file))
  if not file.exists():unused+=1;continue
  native=read(file)
  retired=next((row for row in (negative['records'] if negative else []) if row['nativeFile']==str(file)),None)
  if retired:
   assert str(operation)==negative['operationRoot'] and readHashes[str(index)]==negative['indexSha256'],'A29_INDEX_CHANGED'
   assert readHashes[str(file)]==retired['nativeSha256'] and native['phase']=='ACTIVE' and native['guardian']==retired['guardian'],'A29_NATIVE_CHANGED'
   assert str(Path(scope['boundaryDirectory'])/'state.json')==retired['workFile'] and str(Path(scope['boundaryDirectory'])/'claim.json')==retired['claimFile'],'A29_SCOPE_CHANGED'
   work=read(Path(retired['workFile']));claim=read(Path(retired['claimFile']))
   assert readHashes[retired['workFile']]==retired['workSha256'] and work['phase']=='QUIESCENT' and readHashes[retired['claimFile']]==retired['claimSha256'] and claim['native']['claimSha256']==retired['nativeSha256'],'A29_WORK_OR_CLAIM_CHANGED'
   assert_negative_original_guardian_not_live(retired['guardian'])
   negativeCancelled+=1;continue
  assert native['phase']=='QUIESCENT' and native['nativeReaped'] is True,'APPLICATION_ROLE_DURABLE_OWNER_UNKNOWN'
  assert native.get('databaseQuiet') is True or native.get('sqliteNativeClosed') is True,'APPLICATION_ROLE_DURABLE_SQL_UNKNOWN'
  work=Path(scope['boundaryDirectory'])/'state.json'
  if work.exists():assert read(work)['phase']=='QUIESCENT','APPLICATION_ROLE_DURABLE_WORK_UNKNOWN'
  closed+=1
if negative:assert negativeCancelled==2,'A29_EXACT_TWO_NEGATIVE_RECORDS_REQUIRED'
print(json.dumps(dict(originalNativeProcesses=0,denyUnknownGrantRecordsChecked=closed,unusedGrantRecords=unused,negativelyCancelledGrantRecords=negativeCancelled,adoptsOriginalPopen=False)))`;
}
async function main(){
const root=path.resolve(import.meta.dirname,'..'),base='D:/sabalanerp/docker-compose.local.yml';
const {inspectOnly,imageReceiptFile,materialReceiptFile,preflightFile,previousReplacement,failedAuthorityCohort,negativeRecoveryHandoff,postUpMemoryBaseline,isolateAuthorityCohort=false,negativeRetirement:negativeRetirementArgument,candidateQaMemoryTransition=false}=parseCandidateReplacementArguments(process.argv.slice(2));
const hostMemory=transition=>validateQaHostMemoryObservation({platform:process.platform,availableBytes:os.freemem(),observedAt:new Date().toISOString()},transition);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const imageReceiptRaw=fs.readFileSync(imageReceiptFile),imageReceipt=JSON.parse(imageReceiptRaw),materialReceiptRaw=fs.readFileSync(materialReceiptFile),materialReceipt=JSON.parse(materialReceiptRaw);
const preflight=()=>validateCandidatePreflight(JSON.parse(fs.readFileSync(preflightFile)));preflight();
const historicalFile=path.join(root,'reports/qa/application-native-role-slots-aeca1063d2275dde6b8fbda710d1de34.json'),historical=JSON.parse(fs.readFileSync(historicalFile));
const retainedImageReceiptFile=path.join(root,'reports/qa/current-backend-image-41f7dd679cc93ae31d18380c1c13786c.json'),retainedMaterialReceiptFile=path.join(root,'reports/qa/current-backend-material-d320bded734e4af6b7aede2f0c1fa7a9.json');
const retainedImageRaw=fs.readFileSync(retainedImageReceiptFile),retainedMaterialRaw=fs.readFileSync(retainedMaterialReceiptFile),retainedReceipt=JSON.parse(retainedImageRaw),retainedMaterial=JSON.parse(retainedMaterialRaw);
assert.equal(historical.pass,true);assert.equal(historical.phase,'COMPLETE');assert.equal(historical.up.code,0);assert.equal(historical.up.signal,null);
assert.equal(digest(retainedImageRaw),historical.imageReceiptSha256);assert.equal(digest(retainedMaterialRaw),historical.materialReceiptSha256);
const oldImage='sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186';assert.equal(retainedReceipt.image.id,oldImage);assert.equal(historical.immutableImage,oldImage);
let predecessor=null,predecessorMaterial=null,predecessorImage=null,failedAuthority=null,failedNamespaces=null,failedCandidateEvidence=null;const predecessorInputs=[];let recoverySnapshot=null;
const negativeToken=negativeRecoveryHandoff?readNegativeRecoveryHandoff(negativeRecoveryHandoff):null,negativeDescriptor=negativeToken?negativeRecoveryDescriptor(negativeToken):null;
const postUpToken=postUpMemoryBaseline?readPostUpMemoryBaseline(postUpMemoryBaseline):null,postUpDescriptor=postUpToken?postUpMemoryDescriptor(postUpToken):null;
if(postUpToken){const component=postUpDescriptor.components.candidate;predecessorImage=JSON.parse(fs.readFileSync(component.image.file));predecessorMaterial=JSON.parse(fs.readFileSync(component.material.file));predecessorInputs.push(...Object.keys(postUpMemoryInputs(postUpToken)));}
const predecessorSelection=previousReplacement??negativeDescriptor?.historicalCandidateReplacement;
if(predecessorSelection){
 const raw=fs.readFileSync(predecessorSelection.file);assert.equal(digest(raw),predecessorSelection.sha256,'PREDECESSOR_HISTORY_BYTES_CHANGED');const history=validatePreviousCandidateReplacement(JSON.parse(raw));if(previousReplacement)predecessor=history;predecessorInputs.push(predecessorSelection.file);
 const point=history.roleEvidence.candidate,imageRaw=fs.readFileSync(point.imageReceiptFile),materialRaw=fs.readFileSync(point.materialReceiptFile);assert.equal(digest(imageRaw),point.imageReceiptSha256);assert.equal(digest(materialRaw),point.materialReceiptSha256);predecessorInputs.push(point.imageReceiptFile,point.materialReceiptFile);predecessorImage=JSON.parse(imageRaw);predecessorMaterial=JSON.parse(materialRaw);
 assert.equal(predecessorImage.format,'sabalan-current-backend-image/v1');assert.equal(predecessorImage.pass,true);assert.equal(predecessorImage.sourceUnchanged,true);assert.equal(predecessorImage.protectedServicesUnchanged,true);assert.equal(predecessorImage.originalChildren.allOriginalChildrenClosed,true);assert.equal(predecessorImage.originalChildren.interrupted,false);assert.equal(predecessorImage.materialReceiptSha256,digest(materialRaw));assert.equal(predecessorImage.image.id,point.image);assert.equal(predecessorMaterial.materialized,true);assert.deepEqual(history.privateQualificationRuntimes.candidate,nativeMaterialIdentity(predecessorMaterial).runtime);validateInstalledNativeRole(history.installed['backend-candidate'].result,nativeMaterialIdentity(predecessorMaterial));
 assert.equal(history.roleEvidence.main.imageReceiptSha256,digest(retainedImageRaw));assert.equal(history.roleEvidence.main.materialReceiptSha256,digest(retainedMaterialRaw));assert.deepEqual(history.privateQualificationRuntimes.main,nativeMaterialIdentity(retainedMaterial).runtime);validateInstalledNativeRole(history.installed['backend-retained'].result,nativeMaterialIdentity(retainedMaterial));
}

let inheritedQaMemoryProfile=null;if(!candidateQaMemoryTransition&&predecessor&&(predecessor.candidateQaMemoryTransition?.format==='sabalan-explicit-local-qa-candidate-memory-transition/v3'||predecessor.candidateQaMemoryProfile||predecessor.candidateQaMemoryRecovery||predecessor.candidateQaMemoryNegativeRecovery||predecessor.candidateQaMemoryPostUpRecovery)){assert.equal(isolateAuthorityCohort,true,'PRESERVED_QA_PROFILE_REQUIRES_FRESH_COHORT');inheritedQaMemoryProfile=readExplicitQaMemoryProfile(previousReplacement);predecessorInputs.push(...Object.keys(qaMemoryProfileInputs(inheritedQaMemoryProfile)));}
if(negativeToken){inheritedQaMemoryProfile=readExplicitQaMemoryProfile(predecessorSelection);assert.equal(readQaMemoryProfile(inheritedQaMemoryProfile).candidateBytes,2048*1024**2);predecessorInputs.push(...Object.keys(qaMemoryProfileInputs(inheritedQaMemoryProfile)),...Object.keys(negativeRecoveryInputs(negativeToken)));}
let candidateQaMemoryMode=candidateQaMemoryTransition||(inheritedQaMemoryProfile||postUpToken?'preserve-v3':false);
if(failedAuthorityCohort){
 const failedRaw=fs.readFileSync(failedAuthorityCohort.file);assert.equal(digest(failedRaw),failedAuthorityCohort.sha256);assert.ok([precisionFailedAuthorityCohortSha256,hostMemoryFailedAuthorityCohortSha256].includes(failedAuthorityCohort.sha256));failedAuthority=JSON.parse(failedRaw);failedNamespaces=precisionFailedAuthorityNamespaces(failedAuthority);predecessorInputs.push(failedAuthorityCohort.file);
 if(failedAuthorityCohort.sha256===hostMemoryFailedAuthorityCohortSha256){assert.equal(candidateQaMemoryTransition,false);const ancestor=failedAuthority.candidateQaMemoryTransition.predecessor;const raw=fs.readFileSync(ancestor.file);assert.equal(digest(raw),hostMemoryFailedAncestorSha256);validatePreviousCandidateReplacement(JSON.parse(raw));assert.equal(JSON.parse(raw).actual['backend-candidate'].memoryBytes,1536*1024**2);predecessorInputs.push(ancestor.file);candidateQaMemoryMode='recovery-v3';const evidence=[hostMemoryFailedSnapshot,hostMemoryFailedOwnerObservation].map(ref=>{const bytes=fs.readFileSync(ref.file);assert.equal(digest(bytes),ref.sha256);predecessorInputs.push(ref.file);return JSON.parse(bytes);});validateHostMemoryFailedObservation(...evidence);recoverySnapshot=evidence[0];}
 const matching=expected=>{const found=Object.keys(failedAuthority.inputs).filter(file=>file.endsWith('.json')&&fs.existsSync(file)&&hashBytes(file)===expected);assert.equal(found.length,1,'EXACT_FAILED_COHORT_IMAGE_MATERIAL_REQUIRED');return found[0];};
 function hashBytes(file){return digest(fs.readFileSync(file));}
 const imageFile=matching(failedAuthority.imageReceiptSha256),materialFile=matching(failedAuthority.materialReceiptSha256);predecessorInputs.push(imageFile,materialFile);predecessorImage=JSON.parse(fs.readFileSync(imageFile));predecessorMaterial=JSON.parse(fs.readFileSync(materialFile));
 assert.equal(predecessorImage.format,'sabalan-current-backend-image/v1');assert.equal(predecessorImage.pass,true);assert.equal(predecessorImage.sourceUnchanged,true);assert.equal(predecessorImage.protectedServicesUnchanged,true);assert.equal(predecessorImage.originalChildren.allOriginalChildrenClosed,true);assert.equal(predecessorImage.originalChildren.interrupted,false);assert.equal(predecessorImage.image.id,failedAuthority.immutableImage);assert.equal(predecessorImage.materialReceiptSha256,failedAuthority.materialReceiptSha256);assert.equal(predecessorMaterial.materialized,true);
 failedCandidateEvidence={image:predecessorImage.image.id,imageReceiptFile:imageFile,imageReceiptSha256:hashBytes(imageFile),materialReceiptFile:materialFile,materialReceiptSha256:hashBytes(materialFile)};
}
for(const [receipt,material,raw]of [[imageReceipt,materialReceipt,materialReceiptRaw],[retainedReceipt,retainedMaterial,retainedMaterialRaw]]){
 assert.equal(receipt.format,'sabalan-current-backend-image/v1');assert.equal(receipt.pass,true);assert.equal(receipt.sourceUnchanged,true);assert.equal(receipt.protectedServicesUnchanged,true);
 assert.equal(receipt.originalChildren.allOriginalChildrenClosed,true);assert.equal(receipt.originalChildren.interrupted,false);assert.equal(receipt.materialReceiptSha256,digest(raw));assert.equal(material.materialized,true);assert.match(receipt.sourceCommit,/^[a-f0-9]{40}$/);
}
const operationsOnlySourceReuse=assertCandidateApplicationSource({root,imageReceiptRaw,materialReceiptRaw,postUpToken});
const image=imageReceipt.image.id;assert.match(image,/^sha256:[a-f0-9]{64}$/);assert.notEqual(image,oldImage);
const perRole={main:nativeMaterialIdentity(retainedMaterial),candidate:nativeMaterialIdentity(materialReceipt)};
assert.deepEqual(perRole.main.runtime,historical.privateQualificationRuntime);
const removedCodeTargets=['/app/dist','/packages/partner-sales-contracts/dist','/packages/contract-product-graph/dist'];
const installedProbeFile=path.join(root,'tests/online-deployment/installed-native-image-probe.fixture.mjs');
const installedProbe=fs.readFileSync(installedProbeFile);
const protectedServices=['backend','frontend','postgres','inquiry','redis','clamav','frontend-candidate','frontend-retained',...(isolateAuthorityCohort?[]:['backend-retained'])];
const slots=['backend-candidate','backend-retained'];
const rows=raw=>{try{const value=JSON.parse(raw);return Array.isArray(value)?value:[value];}
  catch{return raw.trim().split(/\r?\n/).map(line=>JSON.parse(line));}};
function status(){readQaMemoryProfile(inheritedQaMemoryProfile);if(postUpToken)postUpMemoryDescriptor(postUpToken);const values=rows(execFileSync('docker',['compose','-f',base,'ps','--format','json'],{encoding:'utf8'}));
  return validateCandidateProjectRows(values);}
function docker(args){status();return execFileSync('docker',args,{encoding:'utf8',maxBuffer:8*1024**2});}
function inspect(service){const [value]=JSON.parse(docker(['inspect','sabalanerp-local-'+service+'-1']));
  assert.equal(value.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(value.Config.Labels['com.docker.compose.service'],service);return value;}
const identity=value=>({id:value.Id,image:value.Image,startedAt:value.State.StartedAt});
const protectedBefore=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));
const previous=Object.fromEntries(slots.map(service=>[service,inspect(service)]));
let acceptanceOrigin=null,acceptanceDescriptor=null,acceptanceToken=negativeToken;
if(postUpToken){acceptanceOrigin=postUpDescriptor.acceptanceOrigin;acceptanceDescriptor=postUpDescriptor.acceptance;}else if(negativeToken){acceptanceOrigin=negativeRecoveryHandoff;acceptanceDescriptor=negativeRecoveryAcceptance(negativeToken);}else if(predecessor?.acceptanceCohort){assert.equal(predecessor.acceptanceCohort.format,'sabalan-preserved-negative-acceptance-view/v1');assert.equal(negativeRetirementArgument,undefined,'NEGATIVE_ACCEPTANCE_VIEW_CANNOT_INHERIT_A29');acceptanceOrigin=predecessor.acceptanceCohort.origin;if(predecessor.candidateQaMemoryPostUpRecovery){const origin=readPostUpMemoryBaseline(predecessor.candidateQaMemoryPostUpRecovery.baseline);const facts=postUpMemoryDescriptor(origin);assert.deepEqual(facts.acceptanceOrigin,acceptanceOrigin);acceptanceDescriptor=facts.acceptance;predecessorInputs.push(...Object.keys(postUpMemoryInputs(origin)));}else{acceptanceToken=readNegativeRecoveryHandoff(acceptanceOrigin);acceptanceDescriptor=negativeRecoveryAcceptance(acceptanceToken);}assert.deepEqual(predecessor.acceptanceCohort.descriptor,acceptanceDescriptor);if(acceptanceToken)predecessorInputs.push(...Object.keys(negativeRecoveryInputs(acceptanceToken)));}
if(acceptanceDescriptor)validateNegativeAcceptanceSlots(previous,acceptanceDescriptor);
validatePreviousHistoricalCapsulePair(previous['backend-candidate'],previous['backend-retained']);
const sourceDist=previous['backend-candidate'].Mounts.find(value=>value.Destination==='/app/dist');assert.ok(!sourceDist||!sourceDist.RW);
const sourceRoot=sourceDist?path.dirname(path.dirname(sourceDist.Source)):root;
let reobservedBaseline=null;
if(postUpToken){reobservedBaseline=validatePostUpCurrentSlots(postUpToken,Object.fromEntries([...slots,...protectedServices].map(service=>[service,inspect(service)])));}else if(negativeToken){reobservedBaseline=validateNegativeRecoveryPhysicalReadback(negativeToken,Object.fromEntries([...slots,...protectedServices].map(service=>[service,inspect(service)])));}else if(failedAuthority){reobservedBaseline=validatePrecisionFailedAuthoritySlots(failedAuthority,previous,protectedBefore);reobservedBaseline.candidateEvidence=failedCandidateEvidence;if(candidateQaMemoryMode==='recovery-v3'){validateHostMemoryFailedCurrentSlots(recoverySnapshot,previous);reobservedBaseline.previousIdentities=structuredClone(reobservedBaseline.identities);for(const service of slots){assert.equal(previous[service].HostConfig.Memory,service==='backend-candidate'?2048*1024**2:768*1024**2);assert.equal(previous[service].HostConfig.MemorySwap,service==='backend-candidate'?2048*1024**2:1536*1024**2);validateQaPreservedRuntimeLimits(service,failedAuthority.candidateQaMemoryTransition.runtimeLimitsBefore[service],previous[service].HostConfig,'v3');}}}else if(predecessor)reobservedBaseline=validateReobservedCandidateSlots(predecessor,previous);
else{assert.equal(previous['backend-retained'].Image,oldImage);assert.equal(previous['backend-candidate'].Image,oldImage);assert.deepEqual(identity(previous['backend-retained']),Object.fromEntries(['id','image','startedAt'].map(key=>[key,historical.actual['backend-retained'][key]])));}
if(predecessorImage){const [observedPredecessor]=JSON.parse(docker(['image','inspect',predecessorImage.image.id]));assert.equal(observedPredecessor.Id,predecessorImage.image.id);assert.deepEqual(observedPredecessor.RootFS.Layers,predecessorImage.image.layers);}
const [installedImage]=JSON.parse(docker(['image','inspect',image]));
assert.equal(installedImage.Id,image);assert.deepEqual(installedImage.RootFS.Layers,imageReceipt.image.layers);
const overlays=['docker-compose.online-acceptance.yml','docker-compose.online-runtime-authority-acceptance.yml',
  'docker-compose.application-native-role-isolation.yml','docker-compose.application-native-mixed-images.yml','docker-compose.application-native-historical-capsules.yml',...(isolateAuthorityCohort?['docker-compose.application-native-authority-cohort.yml']:[]),...(acceptanceDescriptor?['docker-compose.application-native-negative-acceptance-cohort.yml']:[])].map(name=>path.join(root,name));
const cohortNonce=isolateAuthorityCohort?randomBytes(16).toString('hex'):null;
const env={...process.env,ONLINE_ACCEPTANCE_BASE_COMPOSE:base,ONLINE_ACCEPTANCE_SOURCE_ROOT:sourceRoot,
  ONLINE_ACCEPTANCE_CANDIDATE_MEMORY:['v3','preserve-v3','recovery-v3'].includes(candidateQaMemoryMode)?'2048m':'1536m',ONLINE_ACCEPTANCE_CANDIDATE_SWAP:['v3','preserve-v3','recovery-v3'].includes(candidateQaMemoryMode)?'2048m':'1536m',ONLINE_ACCEPTANCE_BACKEND_IMAGE:image,ONLINE_ACCEPTANCE_RETAINED_BACKEND_IMAGE:oldImage,ONLINE_ACCEPTANCE_FRONTEND_IMAGE:inspect('frontend-candidate').Image,
  ONLINE_ACCEPTANCE_FRONTEND_DIST:path.join(sourceRoot,'frontend'),ONLINE_ACCEPTANCE_BROWSER_BUILD_ID:'configuration_only_not_deployed',...(isolateAuthorityCohort?{ONLINE_ACCEPTANCE_AUTHORITY_SUBPATH:authoritySubpath(cohortNonce)}:{}),...(acceptanceDescriptor?{ONLINE_ACCEPTANCE_RECOVERY_SUBPATH:acceptanceDescriptor.subpath}:{})};
const compose=['compose','-f',base,...overlays.flatMap(file=>['-f',file]),'--profile','online-acceptance'];
status();const configuration=JSON.parse(execFileSync('docker',[...compose,'config','--format','json'],{env,encoding:'utf8',maxBuffer:8*1024**2}));
assert.equal(configuration.name,'sabalanerp-local');if(isolateAuthorityCohort)validateAuthorityCohortConfiguration(configuration,cohortNonce);if(acceptanceDescriptor)validateNegativeAcceptanceConfiguration(configuration,acceptanceDescriptor);
for(const service of slots){const wanted=configuration.services[service],old=previous[service];
  assert.equal(wanted.image,service==='backend-candidate'?image:oldImage);assert.deepEqual(wanted.command,old.Config.Cmd);validateQaMemoryConfiguration(service,old.HostConfig.Memory,Number(wanted.mem_limit),candidateQaMemoryMode);validateQaSwapConfiguration(old.HostConfig.MemorySwap,Number(wanted.memswap_limit),service,candidateQaMemoryMode);
  assert.equal(wanted.read_only,old.HostConfig.ReadonlyRootfs);assert.deepEqual(wanted.cap_drop??[],old.HostConfig.CapDrop??[]);
  assert.deepEqual(wanted.security_opt??[],old.HostConfig.SecurityOpt??[]);
  assert.equal(Math.round(Number(wanted.cpus)*1e9),old.HostConfig.NanoCpus);
  assert.equal(wanted.privileged??false,old.HostConfig.Privileged);assert.equal(wanted.pids_limit??0,old.HostConfig.PidsLimit??0);
  const wantedPorts=(wanted.ports??[]).map(value=>({host:value.host_ip,port:String(value.published),target:String(value.target)+'/tcp'}));
  const oldPorts=Object.entries(old.HostConfig.PortBindings??{}).flatMap(([target,values])=>values.map(value=>({host:value.HostIp,port:value.HostPort,target})));
  assert.deepEqual(wantedPorts,oldPorts);
  const oldMounts=new Map(old.Mounts.map(value=>[value.Destination,value]));
  for(const target of removedCodeTargets)assert.ok(!wanted.volumes.some(volume=>volume.target===target));
  validateHistoricalCapsuleConfiguration(wanted,configuration.volumes);
  for(const volume of wanted.volumes){const existing=oldMounts.get(volume.target);
    if(!existing&&historicalCapsuleTargets.includes(volume.target))continue;
    if(!existing){const rootMount=isolateAuthorityCohort&&authorityMounts[service].find(m=>!m.subpath&&m.target===volume.target);assert.ok(rootMount,'unexpected mount '+volume.target);assert.equal(volume.type,'volume');assert.equal(volume.read_only??false,false);continue;}assert.equal(!volume.read_only,existing.RW);
    if(volume.type==='bind')assert.equal(path.resolve(volume.source).toLowerCase(),path.resolve(existing.Source).toLowerCase());
    else assert.equal(configuration.volumes[volume.source].name,existing.Name);
  }
  const remainingOld=old.Mounts.filter(value=>!removedCodeTargets.includes(value.Destination));const newRoots=isolateAuthorityCohort?authorityMounts[service].filter(m=>!m.subpath&&!oldMounts.has(m.target)).map(m=>m.target):[];const newCapsules=historicalCapsuleTargets.filter(target=>!oldMounts.has(target));assert.equal(wanted.volumes.length,remainingOld.length+newRoots.length+newCapsules.length);
  assert.deepEqual(wanted.volumes.map(value=>value.target).sort(),[...remainingOld.map(value=>value.Destination),...newRoots,...newCapsules].sort());
}
let negativeRetirement=null;
if(negativeRetirementArgument){const raw=fs.readFileSync(negativeRetirementArgument.file);assert.equal(createHash('sha256').update(raw).digest('hex'),negativeRetirementArgument.sha256);negativeRetirement=validateA29RetirementCertificate(JSON.parse(raw),loadA29Evidence());}
const processProbe=qualifiedCandidateNativeQuietProbe(negativeRetirement);
const processQuiet=(observed=previous)=>Object.fromEntries(slots.map(service=>[service,JSON.parse(docker(['exec',observed[service].Id,'/usr/bin/python3','-I','-B','-c',processProbe]))]));
const sqlQuiet=()=>{const value=JSON.parse(docker(['exec',inspect('postgres').Id,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',
  "SELECT json_build_object('visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database LIKE 'qa_application_%'),'system',(SELECT system_identifier::text FROM pg_control_system()))"]));
  assert.equal(value.visible,true);assert.equal(value.sessions,0);assert.equal(value.prepared,0);return value;};
const operation=randomBytes(16).toString('hex'),reportPath=path.join(root,'reports/qa/application-native-candidate-'+operation+'.json');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const negativeSources=acceptanceDescriptor?['scripts/lib/application-native-negative-baseline.mjs','scripts/lib/application-native-negative-evidence.mjs','scripts/lib/application-native-negative-acceptance.mjs','scripts/lib/application-native-negative-baseline.policy.py','tests/online-deployment/application-native-negative-acceptance.fixture.py',...(acceptanceToken&&negativeRecoveryDescriptor(acceptanceToken).format===negativeCapsuleFormat?['scripts/lib/application-native-negative-capsule-acceptance.mjs','scripts/lib/application-native-negative-capsule-baseline.policy.py','tests/online-deployment/application-native-negative-capsule-acceptance.fixture.py']:[])].map(file=>path.join(root,file)):[];
const capsuleProbeFile=path.join(root,'tests/online-deployment/historical-capsule-preflight.fixture.py');
const capsuleProbe=fs.readFileSync(capsuleProbeFile);
const capsuleSpec=historicalCapsulePreflightSpec(root);
const inputs=Object.fromEntries([base,...overlays,import.meta.filename,path.join(root,'scripts/lib/application-native-historical-capsules.mjs'),capsuleProbeFile,...historicalCapsuleInputFiles(root),path.join(root,'scripts/lib/application-native-post-up-memory-baseline.mjs'),...negativeSources,path.join(root,'scripts/lib/application-native-qa-memory.mjs'),path.join(root,'scripts/lib/application-native-qa-profile.mjs'),path.join(root,'scripts/lib/a29-known-negative-retirement.mjs'),...(negativeRetirementArgument?[negativeRetirementArgument.file,...a29EvidenceFiles]:[]),imageReceiptFile,materialReceiptFile,installedProbeFile,preflightFile,historicalFile,retainedImageReceiptFile,retainedMaterialReceiptFile,path.join(root,'scripts/replace-application-native-candidate-local.mjs'),...predecessorInputs,...(operationsOnlySourceReuse?[path.join(root,'scripts/lib/application-native-operations-source-reuse.mjs')]:[]),...(isolateAuthorityCohort?authorityCohortSources.map(file=>path.join(root,file)):[])].map(file=>[file,hash(file)]));
assert.equal(digest(capsuleProbe),inputs[capsuleProbeFile],'HISTORICAL_CAPSULE_PROBE_CHANGED');
const report={...(operationsOnlySourceReuse?{operationsOnlySourceReuse}:{}),...(postUpToken?{postUpMemoryBaseline:structuredClone(postUpMemoryBaseline),candidateQaMemoryPostUpRecovery:{format:'sabalan-post-up-negative-baseline-local-qa-memory-profile/v1',baseline:structuredClone(postUpMemoryBaseline),failedReportRemainsFailed:true,originalUpAdopted:false,before:Object.fromEntries(slots.map(service=>[service,previous[service].HostConfig.Memory])),after:Object.fromEntries(slots.map(service=>[service,Number(configuration.services[service].mem_limit)])),nativeActorFloorBytes,cacheCreditUsed:false,runtimeLimitsBefore:Object.fromEntries(slots.map(service=>[service,qaUnchangedResourceLimits(previous[service].HostConfig)]))},reobservedBaseline,postUpBaselineAuthorityVerified:{},postUpBaselineAcceptanceVerified:{}}:{}),...(acceptanceDescriptor?{acceptanceCohort:{format:'sabalan-preserved-negative-acceptance-view/v1',origin:structuredClone(acceptanceOrigin),descriptor:structuredClone(acceptanceDescriptor)}}:{}),...(negativeToken?{negativeRecoveryHandoff:structuredClone(negativeRecoveryHandoff),candidateQaMemoryNegativeRecovery:{format:'sabalan-negative-baseline-local-qa-memory-profile/v1',handoff:structuredClone(negativeRecoveryHandoff),history:structuredClone(predecessorSelection),transition:qaMemoryProfileTransition(inheritedQaMemoryProfile),historicalPhysicalIdentityClaimed:false,resourceProfileHistoryOnly:true,before:Object.fromEntries(slots.map(service=>[service,previous[service].HostConfig.Memory])),after:Object.fromEntries(slots.map(service=>[service,Number(configuration.services[service].mem_limit)])),nativeActorFloorBytes,cacheCreditUsed:false,runtimeLimitsBefore:Object.fromEntries(slots.map(service=>[service,qaUnchangedResourceLimits(previous[service].HostConfig)]))},negativeBaselineAuthorityVerified:{},negativeBaselineAcceptanceVerified:{}}:{}),...(inheritedQaMemoryProfile&&!negativeToken?{candidateQaMemoryProfile:{format:'sabalan-preserved-local-qa-candidate-memory-profile/v1',predecessor:{...previousReplacement},transition:qaMemoryProfileTransition(inheritedQaMemoryProfile),before:Object.fromEntries(slots.map(service=>[service,previous[service].HostConfig.Memory])),after:Object.fromEntries(slots.map(service=>[service,Number(configuration.services[service].mem_limit)])),nativeActorFloorBytes,cacheCreditUsed:false,runtimeLimitsBefore:Object.fromEntries(slots.map(service=>[service,qaUnchangedResourceLimits(previous[service].HostConfig)]))}}:{}),...(negativeRetirementArgument?{knownNegativeCancellationRetirement:{...negativeRetirementArgument,classification:'KNOWN_NEGATIVE_CANCELLED',successfulNativeClosure:false}}:{}),format:'sabalan-application-native-candidate/v1',replacementEntry:'scripts/replace-qualified-application-native-candidate-local.mjs',operation,pass:false,phase:'INTENT',productionAdmission:false,
  onlyCandidateReplaced:!isolateAuthorityCohort,retainedOriginalPreserved:!isolateAuthorityCohort,...(isolateAuthorityCohort?{onlyQualificationSlotsRecreated:true,authorityCohort:{format:'sabalan-native-authority-cohort/v1',nonce:cohortNonce,prepared:{},verified:{}}}:{}),originalLimitsUnchanged:!candidateQaMemoryTransition,...(candidateQaMemoryTransition?{candidateQaMemoryTransition:{format:'sabalan-explicit-local-qa-candidate-memory-transition/'+candidateQaMemoryTransition,...(candidateQaMemoryTransition==='v3'?{predecessor:{...previousReplacement}}:{}),before:Object.fromEntries(slots.map(service=>[service,previous[service].HostConfig.Memory])),after:Object.fromEntries(slots.map(service=>[service,Number(configuration.services[service].mem_limit)])),nativeActorFloorBytes,cacheCreditUsed:false,runtimeLimitsBefore:Object.fromEntries(slots.map(service=>[service,qaUnchangedResourceLimits(previous[service].HostConfig)]))}}:{}),protectedBefore,previous:Object.fromEntries(slots.map(service=>[service,identity(previous[service])])),inputs,
  immutableImage:image,materialReceiptSha256:digest(materialReceiptRaw),imageReceiptSha256:digest(imageReceiptRaw),removedCodeTargets,
  ...(predecessor?{previousReplacement:{...previousReplacement},reobservedBaseline}:{}),...(negativeToken?{reobservedBaseline,negativeStreamingInputs:negativeRecoveryStreamingInputs(negativeToken)}:{}),...(candidateQaMemoryMode==='recovery-v3'?{candidateQaMemoryRecovery:{format:'sabalan-recovered-local-qa-candidate-memory-profile/v1',predecessor:{...failedAuthority.candidateQaMemoryTransition.predecessor},failed:{...failedAuthorityCohort},originalTransitionQualified:false,failedReportRemainsFailed:true,negativeOwnerObservationNotAdoption:true,currentInspection:{...hostMemoryFailedSnapshot},negativeOwnerObservation:{...hostMemoryFailedOwnerObservation},before:Object.fromEntries(slots.map(service=>[service,previous[service].HostConfig.Memory])),after:Object.fromEntries(slots.map(service=>[service,Number(configuration.services[service].mem_limit)])),nativeActorFloorBytes,cacheCreditUsed:false,runtimeLimitsBefore:Object.fromEntries(slots.map(service=>[service,qaUnchangedResourceLimits(previous[service].HostConfig)]))}}:{}),...(failedAuthority?{failedAuthorityCohort:{...failedAuthorityCohort},...(candidateQaMemoryMode==='recovery-v3'?{reobservedBaseline}:{}),reconciledFailedAuthorityBaseline:reobservedBaseline,failedAuthorityBaselineVerified:{}}:{}),nativeQuiet:processQuiet(),sqlQuiet:sqlQuiet()};
const save=()=>{fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');};save();
const children=[];let interrupted=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{interrupted=true;});
async function originalInstalledReadback(service,expected){
 status();const result=await new Promise(resolve=>{const child=spawn('docker',['exec','-i',previous[service].Id,'node','--input-type=module'],{stdio:['pipe','pipe','pipe']});children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=8*1024**2)stdout+=bytes;else failure??='BASELINE_PROBE_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='BASELINE_PROBE_STDERR_BOUND';});child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded}));child.stdin.end(installedProbe);});
 assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.failure,undefined);assert.equal(interrupted,false);assert.equal(result.stdoutEof,true);assert.equal(result.stderrEof,true);const value=JSON.parse(result.stdout);validateInstalledNativeRole(value,expected);return{originalPid:result.originalPid,code:0,signal:null,stderr:result.stderr,stdoutEof:result.stdoutEof,stderrEof:result.stderrEof,result:value};
}
async function originalAuthorityDirectory(service,mode,observed,expected=null,peerExpected=null,nonce=cohortNonce,logField=null){
 const owner=authorityWriterRoot(observed[service],service),fixture=fs.readFileSync(path.join(root,authorityCohortSources[1]));
 const spec={mode,kind:owner.kind,nonce,root:owner.target,expected,peerExpected};
 const bootstrap="import sys,json,base64,hashlib,io;p=json.load(sys.stdin);s=base64.b64decode(p['source'],validate=True);assert hashlib.sha256(s).hexdigest()=="+JSON.stringify(digest(fixture))+";sys.stdin=io.StringIO(json.dumps(p['spec']));exec(compile(s,'original-authority-cohort','exec'),globals())";
 status();const result=await new Promise(resolve=>{const child=spawn('docker',['exec','-i',observed[service].Id,'/usr/bin/python3','-I','-B','-c',bootstrap],{stdio:['pipe','pipe','pipe']});children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=65536)stdout+=bytes;else failure??='AUTHORITY_COHORT_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='AUTHORITY_COHORT_STDERR_BOUND';});child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded}));child.stdin.end(JSON.stringify({source:fixture.toString('base64'),spec}));});
 const stage=mode==='create'?'prepared':'verified';(logField?report[logField]:report.authorityCohort[stage])[service]={...result};save();
 assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.failure,undefined);assert.equal(interrupted,false);assert.equal(result.stdoutEof,true);assert.equal(result.stderrEof,true);return {...result,result:JSON.parse(result.stdout)};
}
async function originalNegativeAcceptanceVerify(service){
 if(negativeToken&&negativeDescriptor.format===negativeCapsuleFormat){
  const selection=negativeCapsuleAcceptanceSelection(root,negativeDescriptor),fixture=fs.readFileSync(selection.source.file);
  assert.equal(digest(fixture),selection.source.sha256);const bootstrap=negativeCapsuleAcceptanceBootstrap(selection.source.sha256);
  status();const result=await new Promise(resolve=>{const child=spawn('docker',['exec','-i',previous[service].Id,'/usr/bin/python3','-I','-B','-c',bootstrap],{stdio:['pipe','pipe','pipe']});children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=65536)stdout+=bytes;else failure??='NEGATIVE_CAPSULE_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='NEGATIVE_CAPSULE_STDERR_BOUND';});child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded}));child.stdin.end(JSON.stringify({source:fixture.toString('base64'),spec:selection.spec}));});
  assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.failure,undefined);assert.equal(interrupted,false);assert.equal(result.stdoutEof,true);assert.equal(result.stderrEof,true);
  const value=JSON.parse(result.stdout);validateNegativeCapsuleAcceptanceResult(negativeDescriptor,value);return{...result,result:value};
 }
 if(postUpToken&&postUpDescriptor.format===capsulePostUpBaselineFormat){
  const selection=postUpAcceptanceSelection(postUpToken),fixture=fs.readFileSync(selection.source.file);
  assert.equal(digest(fixture),selection.source.sha256);
  const bootstrap=postUpAcceptanceBootstrapForToken(postUpToken);
  status();const result=await new Promise(resolve=>{const child=spawn('docker',['exec','-i',previous[service].Id,'/usr/bin/python3','-I','-B','-c',bootstrap],{stdio:['pipe','pipe','pipe']});children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=65536)stdout+=bytes;else failure??='INERT_ACCEPTANCE_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='INERT_ACCEPTANCE_STDERR_BOUND';});child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded}));child.stdin.end(JSON.stringify({source:fixture.toString('base64'),spec:selection.spec}));});
  assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.failure,undefined);assert.equal(interrupted,false);assert.equal(result.stdoutEof,true);assert.equal(result.stderrEof,true);
  const value=JSON.parse(result.stdout);validatePostUpAcceptanceResult(postUpToken,value);return{...result,result:value};
 }
 const fixture=fs.readFileSync(path.join(root,'tests/online-deployment/application-native-negative-acceptance.fixture.py'));const acceptanceProof=postUpToken?postUpAcceptanceExpectation():negativeDescriptor.acceptance;const expected=acceptanceProof.namespace;const fixtureHash=digest(fixture),bootstrap="import base64,hashlib,io,json,sys;p=json.load(sys.stdin);s=base64.b64decode(p['source'],validate=True);assert hashlib.sha256(s).hexdigest()=="+JSON.stringify(fixtureHash)+";sys.stdin=io.StringIO(json.dumps(p['spec']));exec(compile(s,'source-owned-negative-acceptance','exec'),{'__name__':'__main__'})";
 status();const result=await new Promise(resolve=>{const child=spawn('docker',['exec','-i',previous[service].Id,'/usr/bin/python3','-I','-B','-c',bootstrap],{stdio:['pipe','pipe','pipe']});children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=65536)stdout+=bytes;else failure??='NEGATIVE_ACCEPTANCE_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='NEGATIVE_ACCEPTANCE_STDERR_BOUND';});child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure}));child.stdin.end(JSON.stringify({source:fixture.toString('base64'),spec:{nonce:acceptanceProof.nonce,expected}}));});
 assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.failure,undefined);assert.equal(interrupted,false);const value=JSON.parse(result.stdout);assert.deepEqual(value,{format:'sabalan-c16-empty-acceptance-namespace/v1',mode:'verify',nonce:acceptanceProof.nonce,namespace:expected,empty:true,exclusivelyCreated:false,productionAdmission:false});return{...result,result:value};
}
try{
 if(predecessor||failedAuthority||negativeToken||postUpToken){report.reobservedInstalled={};for(const service of slots){report.reobservedInstalled[service]=await originalInstalledReadback(service,nativeMaterialIdentity(service==='backend-candidate'?predecessorMaterial:retainedMaterial));save();}report.reobservedNativeQuiet=processQuiet();report.reobservedSqlQuiet=sqlQuiet();for(const service of slots)assert.deepEqual(identity(inspect(service)),identity(previous[service]));const baseline=report.reconciledFailedAuthorityBaseline??report.reobservedBaseline;baseline.installedBytesVerified=true;baseline.nativeAndSqlQuietVerified=true;save();if(failedAuthority){for(const service of slots){const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';report.failedAuthorityBaselineVerified[service]=await originalAuthorityDirectory(service,'verify',previous,failedNamespaces[service],failedNamespaces[peer],failedAuthority.authorityCohort.nonce,'failedAuthorityBaselineVerified');save();}baseline.currentEmptyNamespacesVerified=true;save();}}
 if(negativeToken){for(const service of slots){const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';report.negativeBaselineAuthorityVerified[service]=await originalAuthorityDirectory(service,'verify',previous,negativeDescriptor.authorityCohort.namespaces[service],negativeDescriptor.authorityCohort.namespaces[peer],negativeDescriptor.authorityCohort.nonce,'negativeBaselineAuthorityVerified');save();report.negativeBaselineAcceptanceVerified[service]=await originalNegativeAcceptanceVerify(service);save();}if(negativeDescriptor.format===negativeCapsuleFormat){report.reobservedBaseline.currentAuthorityNamespacesVerified=true;report.reobservedBaseline.currentInertAcceptanceVerified=true;report.reobservedBaseline.acceptancePhysicalEmpty=false;}else report.reobservedBaseline.currentEmptyNamespacesVerified=true;save();}
 if(postUpToken){for(const service of slots){const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';report.postUpBaselineAuthorityVerified[service]=await originalAuthorityDirectory(service,'verify',previous,postUpDescriptor.authorityCohort.namespaces[service],postUpDescriptor.authorityCohort.namespaces[peer],postUpDescriptor.authorityCohort.nonce,'postUpBaselineAuthorityVerified');save();report.postUpBaselineAcceptanceVerified[service]=await originalNegativeAcceptanceVerify(service);save();}if(postUpDescriptor.format===capsulePostUpBaselineFormat){report.reobservedBaseline.currentAuthorityNamespacesVerified=true;report.reobservedBaseline.currentInertAcceptanceVerified=true;}else report.reobservedBaseline.currentEmptyNamespacesVerified=true;save();}
 report.localHostMemory=hostMemory(candidateQaMemoryMode);save();
 if(inspectOnly){report.phase='INSPECTION_COMPLETE';report.inspectionOnly=true;report.originalChildren={allOriginalChildrenClosed:true,interrupted:false};assert.equal(interrupted,false);save();console.log(JSON.stringify({inspectionOnly:true,reportPath}));return;}

  for(const [file,digest]of Object.entries(inputs))assert.equal(hash(file),digest);
  if(postUpToken)validatePostUpCurrentSlots(postUpToken,Object.fromEntries([...slots,...protectedServices].map(service=>[service,inspect(service)])));if(acceptanceToken)negativeRecoveryDescriptor(acceptanceToken);report.preMutationNativeQuiet=processQuiet();report.preMutationSqlQuiet=sqlQuiet();preflight();save();
  if(isolateAuthorityCohort){for(const service of slots){report.authorityCohort.prepared[service]=await originalAuthorityDirectory(service,'create',previous);save();}report.preMutationNativeQuiet=processQuiet();report.preMutationSqlQuiet=sqlQuiet();preflight();}
  if(negativeToken){validateNegativeRecoveryPhysicalReadback(negativeToken,Object.fromEntries([...slots,...protectedServices].map(service=>[service,inspect(service)])));for(const service of slots){const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';report.negativeBaselineAuthorityVerified[service]=await originalAuthorityDirectory(service,'verify',previous,negativeDescriptor.authorityCohort.namespaces[service],negativeDescriptor.authorityCohort.namespaces[peer],negativeDescriptor.authorityCohort.nonce,'negativeBaselineAuthorityVerified');report.negativeBaselineAcceptanceVerified[service]=await originalNegativeAcceptanceVerify(service);save();}}
  if(postUpToken){for(const service of slots){const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';report.postUpBaselineAuthorityVerified[service]=await originalAuthorityDirectory(service,'verify',previous,postUpDescriptor.authorityCohort.namespaces[service],postUpDescriptor.authorityCohort.namespaces[peer],postUpDescriptor.authorityCohort.nonce,'postUpBaselineAuthorityVerified');save();report.postUpBaselineAcceptanceVerified[service]=await originalNegativeAcceptanceVerify(service);save();}if(postUpDescriptor.format===capsulePostUpBaselineFormat){report.reobservedBaseline.currentAuthorityNamespacesVerified=true;report.reobservedBaseline.currentInertAcceptanceVerified=true;}else report.reobservedBaseline.currentEmptyNamespacesVerified=true;save();}
  status();const beforeUpMemory=hostMemory(candidateQaMemoryMode);if(candidateQaMemoryTransition||inheritedQaMemoryProfile||postUpToken||candidateQaMemoryMode==='recovery-v3')(report.candidateQaMemoryTransition??report.candidateQaMemoryProfile??report.candidateQaMemoryRecovery??report.candidateQaMemoryNegativeRecovery??report.candidateQaMemoryPostUpRecovery).beforeUp=beforeUpMemory;save();
  validateQaHostMemoryObservation(beforeUpMemory,candidateQaMemoryMode);report.up=await new Promise(resolve=>{const child=spawn('docker',[...compose,'up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120','backend-candidate',...(isolateAuthorityCohort?['backend-retained']:[])],{env,stdio:['ignore','pipe','pipe']});
    children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=8*1024**2)stdout+=bytes;else failure??='COMPOSE_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='COMPOSE_STDERR_BOUND';});
    child.on('error',error=>{report.spawnError=error.code;save();});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure}));});
  save();assert.equal(interrupted,false);assert.equal(report.up.failure,undefined);assert.equal(report.up.code,0);assert.equal(report.up.signal,null);assert.equal(report.spawnError,undefined);
  report.protectedAfter=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));assert.deepEqual(report.protectedAfter,protectedBefore);
  const actual=Object.fromEntries(slots.map(service=>[service,inspect(service)]));if(acceptanceDescriptor)validateNegativeAcceptanceSlots(actual,acceptanceDescriptor);
  for(const service of slots){const value=actual[service];assert.equal(value.Image,service==='backend-candidate'?image:oldImage);
    assert.equal(value.HostConfig.Memory,Number(configuration.services[service].mem_limit));validateQaPreservedRuntimeLimits(service,previous[service].HostConfig,value.HostConfig,candidateQaMemoryMode);assert.deepEqual(value.Config.Cmd,previous[service].Config.Cmd);}
  for(const service of slots)assert.ok(!actual[service].Mounts.some(value=>removedCodeTargets.includes(value.Destination)));
  if(isolateAuthorityCohort){validateAuthorityCohortSlots(actual,cohortNonce);for(const service of slots){assert.notEqual(actual[service].Id,previous[service].Id);const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';report.authorityCohort.verified[service]=await originalAuthorityDirectory(service,'verify',actual,report.authorityCohort.prepared[service].result.namespace,report.authorityCohort.prepared[peer].result.namespace);save();}}
  if(candidateQaMemoryTransition||inheritedQaMemoryProfile||postUpToken||candidateQaMemoryMode==='recovery-v3'){const memoryEvidence=report.candidateQaMemoryTransition??report.candidateQaMemoryProfile??report.candidateQaMemoryRecovery??report.candidateQaMemoryNegativeRecovery??report.candidateQaMemoryPostUpRecovery;memoryEvidence.afterUp=await stabilizeQaHostMemory({observe:()=>{assert.equal(interrupted,false);return{platform:process.platform,availableBytes:os.freemem(),observedAt:new Date().toISOString()};},persist:samples=>{memoryEvidence.afterUpSamples=samples;save();},wait:ms=>new Promise(resolve=>setTimeout(resolve,ms))},['v3','preserve-v3','recovery-v3'].includes(candidateQaMemoryMode)?candidateQaMemoryMode:false);memoryEvidence.runtimeLimitsAfter=Object.fromEntries(slots.map(service=>[service,qaUnchangedResourceLimits(actual[service].HostConfig)]));}
  const candidate=actual['backend-candidate'],retained=actual['backend-retained'];
  const mount=(value,target)=>{const found=value.Mounts.find(entry=>entry.Destination===target);assert.ok(found);return found;};
  const http=mount(retained,'/run/sabalan-online'),httpWriter=mount(candidate,'/app/runtime-authority');
  const jobs=mount(candidate,'/run/sabalan-online'),jobsWriter=mount(retained,'/app/jobs-authority');
  assert.equal(http.RW,false);assert.equal(jobs.RW,false);assert.equal(httpWriter.RW,true);assert.equal(jobsWriter.RW,true);
  assert.equal(http.Source,httpWriter.Source);assert.equal(jobs.Source,jobsWriter.Source);assert.notEqual(http.Source,jobs.Source);
  assert.ok(!retained.Mounts.some(value=>value.Source===http.Source&&value.RW));assert.ok(!candidate.Mounts.some(value=>value.Source===jobs.Source&&value.RW));
  report.actual=Object.fromEntries(slots.map(service=>[service,{...identity(actual[service]),memoryBytes:actual[service].HostConfig.Memory,memorySwapBytes:actual[service].HostConfig.MemorySwap,host:actual[service].NetworkSettings.Networks['sabalanerp-local_default'].IPAddress,
    mounts:actual[service].Mounts.map(value=>({source:value.Source,target:value.Destination,rw:value.RW}))}]));
  report.installed={};
  for(const service of slots){status();const observation=await new Promise(resolve=>{
    const child=spawn('docker',['exec','-i',actual[service].Id,'node','--input-type=module'],{stdio:['pipe','pipe','pipe']});children.push(child);
    let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=8*1024**2)stdout+=bytes;else failure??='INSTALLED_PROBE_STDOUT_BOUND';});
    child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='INSTALLED_PROBE_STDERR_BOUND';});
    child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});
    child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure}));child.stdin.end(installedProbe);
   });
   report.installed[service]={...observation};save();assert.equal(observation.code,0);assert.equal(observation.signal,null);assert.equal(observation.failure,undefined);
   const result=JSON.parse(observation.stdout);validateInstalledNativeRole(result,perRole[service==='backend-retained'?'main':'candidate']);
   report.installed[service]={originalPid:observation.originalPid,code:0,signal:null,stderr:observation.stderr,result};save();
  }
  report.historicalCapsuleViews=validateHistoricalCapsulePair(actual['backend-candidate'],actual['backend-retained']);
  report.historicalCapsulePreflight={};
  for(const service of slots){
    status();
    const observed=await new Promise(resolve=>{
      const child=spawn('docker',['exec','-i',actual[service].Id,'/usr/bin/python3','-I','-B','-c',capsuleProbe.toString('utf8')],{stdio:['pipe','pipe','pipe']});
      children.push(child);let stdout='',stderr='',failure;
      child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=65536)stdout+=bytes;else failure??='CAPSULE_PREFLIGHT_STDOUT_BOUND';});
      child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='CAPSULE_PREFLIGHT_STDERR_BOUND';});
      child.stdin.on('error',error=>{failure??=error.code;});child.once('error',error=>{failure??=error.code;});
      child.once('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,interrupted}));
      child.stdin.end(JSON.stringify(capsuleSpec));
    });
    report.historicalCapsulePreflight[service]=observed;save();
    assert.equal(observed.code,0);assert.equal(observed.signal,null);assert.equal(observed.failure,undefined);
    assert.equal(observed.stdoutEof,true);assert.equal(observed.stderrEof,true);assert.equal(observed.interrupted,false);
    const result=JSON.parse(observed.stdout);assert.equal(result.readOnly,true);assert.equal(result.capsulesVerified,2);
    assert.equal(result.databaseExecuted,false);assert.equal(result.nativeActorStarted,false);assert.equal(result.productionAdmission,false);
    assert.equal(result.inventoryChild.code,0);assert.equal(result.inventoryChild.stdoutEof,true);assert.equal(result.inventoryChild.stderrEof,true);
    report.historicalCapsulePreflight[service].result=result;save();
  }
  assert.deepEqual(report.historicalCapsulePreflight['backend-candidate'].result.directoryIdentities,report.historicalCapsulePreflight['backend-retained'].result.directoryIdentities);
  report.postMutationNativeQuiet=processQuiet(actual);report.postMutationSqlQuiet=sqlQuiet();
  report.privateQualificationRuntimes={main:perRole.main.runtime,candidate:perRole.candidate.runtime};
  report.privateQualificationSourceCommits={main:retainedReceipt.sourceCommit,candidate:imageReceipt.sourceCommit};
  report.roleEvidence={main:{image:oldImage,imageReceiptFile:retainedImageReceiptFile,imageReceiptSha256:digest(retainedImageRaw),materialReceiptFile:retainedMaterialReceiptFile,materialReceiptSha256:digest(retainedMaterialRaw)},candidate:{image,imageReceiptFile,imageReceiptSha256:digest(imageReceiptRaw),materialReceiptFile,materialReceiptSha256:digest(materialReceiptRaw)}};
  report.finalProtected=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));assert.deepEqual(report.finalProtected,protectedBefore);
  for(const [file,digest]of Object.entries(inputs))assert.equal(hash(file),digest);
  if(acceptanceToken)negativeRecoveryDescriptor(acceptanceToken);assert.equal(interrupted,false);assert.ok(children.every(child=>child.exitCode!==null||child.signalCode!==null));report.originalChildren={allOriginalChildrenClosed:true,interrupted:false};
  validateQaMemoryTransitionReceipt(report);if(isolateAuthorityCohort)validateAuthorityCohortReceipt(report);if(failedAuthority)validateReconciledPrecisionFailedBaseline(report,failedAuthority);report.pass=true;report.phase='COMPLETE';save();
}catch(error){report.failure={name:error.name,message:error.message};report.phase='FAILED_CLOSED';save();
  if(children.some(child=>child.exitCode===null&&child.signalCode===null)){await new Promise(()=>{setInterval(()=>{void children;},30000);});}
  throw error;
}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
