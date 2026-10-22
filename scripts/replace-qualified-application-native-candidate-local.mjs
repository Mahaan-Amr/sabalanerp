import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {authorityCohortSources,authorityMounts,authoritySubpath,authorityWriterRoot,validateAuthorityCohortConfiguration,validateAuthorityCohortSlots,validateAuthorityCohortReceipt,precisionFailedAuthorityCohortSha256,precisionFailedAuthorityNamespaces,validatePrecisionFailedAuthoritySlots,validateReconciledPrecisionFailedBaseline} from './lib/application-native-authority-cohort.mjs';

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
 const isolateAuthorityCohort=argv.at(-1)==='--isolate-authority-cohort';if(isolateAuthorityCohort)argv=argv.slice(0,-1);
 assert.ok(argv.length===7||argv.length===11,'EXACT_REPLACEMENT_ARGUMENTS_REQUIRED');assert.ok(['--inspect','--replace'].includes(argv[0]));
 for(const[i,key]of ['--image-receipt','--material-receipt','--preflight'].entries())assert.equal(argv[1+i*2],key);
 const result={inspectOnly:argv[0]==='--inspect',imageReceiptFile:path.resolve(argv[2]),materialReceiptFile:path.resolve(argv[4]),preflightFile:path.resolve(argv[6]),...(isolateAuthorityCohort?{isolateAuthorityCohort:true}:{})};
 if(argv.length===11){const failed=argv[7]==='--failed-authority-cohort-receipt';assert.equal(argv[7],failed?'--failed-authority-cohort-receipt':'--previous-replacement-receipt');assert.equal(argv[9],failed?'--failed-authority-cohort-sha256':'--previous-replacement-sha256');assert.ok(path.isAbsolute(argv[8]));assert.match(argv[8].replaceAll('\\','/'),/\/reports\/qa\/application-native-candidate-[a-f0-9]{32}\.json$/);assert.match(argv[10],/^[a-f0-9]{64}$/);if(failed){assert.equal(isolateAuthorityCohort,true,'FAILED_COHORT_REQUIRES_FRESH_ROTATION');assert.equal(argv[10],precisionFailedAuthorityCohortSha256);result.failedAuthorityCohort={file:path.resolve(argv[8]),sha256:argv[10]};}else result.previousReplacement={file:path.resolve(argv[8]),sha256:argv[10]};}return result;
}
export function validatePreviousCandidateReplacement(value){
 if(Object.hasOwn(value,'replacementEntry'))assert.equal(value.replacementEntry,'scripts/replace-qualified-application-native-candidate-local.mjs');
 assert.equal(value.format,'sabalan-application-native-candidate/v1');assert.equal(value.pass,true);assert.equal(value.phase,'COMPLETE');assert.equal(value.productionAdmission,false);
 if(value.authorityCohort)validateAuthorityCohortReceipt(value);else for(const key of ['onlyCandidateReplaced','retainedOriginalPreserved'])assert.equal(value[key],true);assert.equal(value.originalLimitsUnchanged,true);assert.equal(value.up.code,0);assert.equal(value.up.signal,null);assert.equal(value.up.failure,undefined);assert.ok(Number.isSafeInteger(value.up.originalPid)&&value.up.originalPid>0);
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
async function main(){
const root=path.resolve(import.meta.dirname,'..'),base='D:/sabalanerp/docker-compose.local.yml';
const {inspectOnly,imageReceiptFile,materialReceiptFile,preflightFile,previousReplacement,failedAuthorityCohort,isolateAuthorityCohort=false}=parseCandidateReplacementArguments(process.argv.slice(2));
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const imageReceiptRaw=fs.readFileSync(imageReceiptFile),imageReceipt=JSON.parse(imageReceiptRaw),materialReceiptRaw=fs.readFileSync(materialReceiptFile),materialReceipt=JSON.parse(materialReceiptRaw);
const preflight=()=>validateCandidatePreflight(JSON.parse(fs.readFileSync(preflightFile)));preflight();
const historicalFile=path.join(root,'reports/qa/application-native-role-slots-aeca1063d2275dde6b8fbda710d1de34.json'),historical=JSON.parse(fs.readFileSync(historicalFile));
const retainedImageReceiptFile=path.join(root,'reports/qa/current-backend-image-41f7dd679cc93ae31d18380c1c13786c.json'),retainedMaterialReceiptFile=path.join(root,'reports/qa/current-backend-material-d320bded734e4af6b7aede2f0c1fa7a9.json');
const retainedImageRaw=fs.readFileSync(retainedImageReceiptFile),retainedMaterialRaw=fs.readFileSync(retainedMaterialReceiptFile),retainedReceipt=JSON.parse(retainedImageRaw),retainedMaterial=JSON.parse(retainedMaterialRaw);
assert.equal(historical.pass,true);assert.equal(historical.phase,'COMPLETE');assert.equal(historical.up.code,0);assert.equal(historical.up.signal,null);
assert.equal(digest(retainedImageRaw),historical.imageReceiptSha256);assert.equal(digest(retainedMaterialRaw),historical.materialReceiptSha256);
const oldImage='sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186';assert.equal(retainedReceipt.image.id,oldImage);assert.equal(historical.immutableImage,oldImage);
let predecessor=null,predecessorMaterial=null,predecessorImage=null,failedAuthority=null,failedNamespaces=null,failedCandidateEvidence=null;const predecessorInputs=[];
if(previousReplacement){
 const raw=fs.readFileSync(previousReplacement.file);assert.equal(digest(raw),previousReplacement.sha256,'PREVIOUS_REPLACEMENT_BYTES_CHANGED');predecessor=validatePreviousCandidateReplacement(JSON.parse(raw));predecessorInputs.push(previousReplacement.file);
 const point=predecessor.roleEvidence.candidate,imageRaw=fs.readFileSync(point.imageReceiptFile),materialRaw=fs.readFileSync(point.materialReceiptFile);assert.equal(digest(imageRaw),point.imageReceiptSha256);assert.equal(digest(materialRaw),point.materialReceiptSha256);predecessorInputs.push(point.imageReceiptFile,point.materialReceiptFile);predecessorImage=JSON.parse(imageRaw);predecessorMaterial=JSON.parse(materialRaw);
 assert.equal(predecessorImage.format,'sabalan-current-backend-image/v1');assert.equal(predecessorImage.pass,true);assert.equal(predecessorImage.sourceUnchanged,true);assert.equal(predecessorImage.protectedServicesUnchanged,true);assert.equal(predecessorImage.originalChildren.allOriginalChildrenClosed,true);assert.equal(predecessorImage.originalChildren.interrupted,false);assert.equal(predecessorImage.materialReceiptSha256,digest(materialRaw));assert.equal(predecessorImage.image.id,point.image);assert.equal(predecessorMaterial.materialized,true);assert.deepEqual(predecessor.privateQualificationRuntimes.candidate,nativeMaterialIdentity(predecessorMaterial).runtime);validateInstalledNativeRole(predecessor.installed['backend-candidate'].result,nativeMaterialIdentity(predecessorMaterial));
 assert.equal(predecessor.roleEvidence.main.imageReceiptSha256,digest(retainedImageRaw));assert.equal(predecessor.roleEvidence.main.materialReceiptSha256,digest(retainedMaterialRaw));assert.deepEqual(predecessor.privateQualificationRuntimes.main,nativeMaterialIdentity(retainedMaterial).runtime);validateInstalledNativeRole(predecessor.installed['backend-retained'].result,nativeMaterialIdentity(retainedMaterial));
}

if(failedAuthorityCohort){
 const failedRaw=fs.readFileSync(failedAuthorityCohort.file);assert.equal(digest(failedRaw),precisionFailedAuthorityCohortSha256);assert.equal(failedAuthorityCohort.sha256,precisionFailedAuthorityCohortSha256);failedAuthority=JSON.parse(failedRaw);failedNamespaces=precisionFailedAuthorityNamespaces(failedAuthority);predecessorInputs.push(failedAuthorityCohort.file);
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
assert.equal(imageReceipt.sourceCommit,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
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
function status(){const values=rows(execFileSync('docker',['compose','-f',base,'ps','--format','json'],{encoding:'utf8'}));
  return validateCandidateProjectRows(values);}
function docker(args){status();return execFileSync('docker',args,{encoding:'utf8',maxBuffer:8*1024**2});}
function inspect(service){const [value]=JSON.parse(docker(['inspect','sabalanerp-local-'+service+'-1']));
  assert.equal(value.Config.Labels['com.docker.compose.project'],'sabalanerp-local');assert.equal(value.Config.Labels['com.docker.compose.service'],service);return value;}
const identity=value=>({id:value.Id,image:value.Image,startedAt:value.State.StartedAt});
const protectedBefore=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));
const previous=Object.fromEntries(slots.map(service=>[service,inspect(service)]));
const sourceDist=previous['backend-candidate'].Mounts.find(value=>value.Destination==='/app/dist');assert.ok(!sourceDist||!sourceDist.RW);
const sourceRoot=sourceDist?path.dirname(path.dirname(sourceDist.Source)):root;
let reobservedBaseline=null;
if(failedAuthority){reobservedBaseline=validatePrecisionFailedAuthoritySlots(failedAuthority,previous,protectedBefore);reobservedBaseline.candidateEvidence=failedCandidateEvidence;}else if(predecessor)reobservedBaseline=validateReobservedCandidateSlots(predecessor,previous);
else{assert.equal(previous['backend-retained'].Image,oldImage);assert.equal(previous['backend-candidate'].Image,oldImage);assert.deepEqual(identity(previous['backend-retained']),Object.fromEntries(['id','image','startedAt'].map(key=>[key,historical.actual['backend-retained'][key]])));}
if(predecessorImage){const [observedPredecessor]=JSON.parse(docker(['image','inspect',predecessorImage.image.id]));assert.equal(observedPredecessor.Id,predecessorImage.image.id);assert.deepEqual(observedPredecessor.RootFS.Layers,predecessorImage.image.layers);}
const [installedImage]=JSON.parse(docker(['image','inspect',image]));
assert.equal(installedImage.Id,image);assert.deepEqual(installedImage.RootFS.Layers,imageReceipt.image.layers);
const overlays=['docker-compose.online-acceptance.yml','docker-compose.online-runtime-authority-acceptance.yml',
  'docker-compose.application-native-role-isolation.yml','docker-compose.application-native-mixed-images.yml',...(isolateAuthorityCohort?['docker-compose.application-native-authority-cohort.yml']:[])].map(name=>path.join(root,name));
const cohortNonce=isolateAuthorityCohort?randomBytes(16).toString('hex'):null;
const env={...process.env,ONLINE_ACCEPTANCE_BASE_COMPOSE:base,ONLINE_ACCEPTANCE_SOURCE_ROOT:sourceRoot,
  ONLINE_ACCEPTANCE_BACKEND_IMAGE:image,ONLINE_ACCEPTANCE_RETAINED_BACKEND_IMAGE:oldImage,ONLINE_ACCEPTANCE_FRONTEND_IMAGE:inspect('frontend-candidate').Image,
  ONLINE_ACCEPTANCE_FRONTEND_DIST:path.join(sourceRoot,'frontend'),ONLINE_ACCEPTANCE_BROWSER_BUILD_ID:'configuration_only_not_deployed',...(isolateAuthorityCohort?{ONLINE_ACCEPTANCE_AUTHORITY_SUBPATH:authoritySubpath(cohortNonce)}:{})};
const compose=['compose','-f',base,...overlays.flatMap(file=>['-f',file]),'--profile','online-acceptance'];
status();const configuration=JSON.parse(execFileSync('docker',[...compose,'config','--format','json'],{env,encoding:'utf8',maxBuffer:8*1024**2}));
assert.equal(configuration.name,'sabalanerp-local');if(isolateAuthorityCohort)validateAuthorityCohortConfiguration(configuration,cohortNonce);
for(const service of slots){const wanted=configuration.services[service],old=previous[service];
  assert.equal(wanted.image,service==='backend-candidate'?image:oldImage);assert.deepEqual(wanted.command,old.Config.Cmd);assert.equal(Number(wanted.mem_limit),old.HostConfig.Memory);
  assert.equal(wanted.read_only,old.HostConfig.ReadonlyRootfs);assert.deepEqual(wanted.cap_drop??[],old.HostConfig.CapDrop??[]);
  assert.deepEqual(wanted.security_opt??[],old.HostConfig.SecurityOpt??[]);
  assert.equal(Math.round(Number(wanted.cpus)*1e9),old.HostConfig.NanoCpus);
  assert.equal(wanted.privileged??false,old.HostConfig.Privileged);assert.equal(wanted.pids_limit??0,old.HostConfig.PidsLimit??0);
  const wantedPorts=(wanted.ports??[]).map(value=>({host:value.host_ip,port:String(value.published),target:String(value.target)+'/tcp'}));
  const oldPorts=Object.entries(old.HostConfig.PortBindings??{}).flatMap(([target,values])=>values.map(value=>({host:value.HostIp,port:value.HostPort,target})));
  assert.deepEqual(wantedPorts,oldPorts);
  const oldMounts=new Map(old.Mounts.map(value=>[value.Destination,value]));
  for(const target of removedCodeTargets)assert.ok(!wanted.volumes.some(volume=>volume.target===target));
  for(const volume of wanted.volumes){const existing=oldMounts.get(volume.target);
    if(!existing){const rootMount=isolateAuthorityCohort&&authorityMounts[service].find(m=>!m.subpath&&m.target===volume.target);assert.ok(rootMount,'unexpected mount '+volume.target);assert.equal(volume.type,'volume');assert.equal(volume.read_only??false,false);continue;}assert.equal(!volume.read_only,existing.RW);
    if(volume.type==='bind')assert.equal(path.resolve(volume.source).toLowerCase(),path.resolve(existing.Source).toLowerCase());
    else assert.equal(configuration.volumes[volume.source].name,existing.Name);
  }
  const remainingOld=old.Mounts.filter(value=>!removedCodeTargets.includes(value.Destination));const newRoots=isolateAuthorityCohort?authorityMounts[service].filter(m=>!m.subpath&&!oldMounts.has(m.target)).map(m=>m.target):[];assert.equal(wanted.volumes.length,remainingOld.length+newRoots.length);
  assert.deepEqual(wanted.volumes.map(value=>value.target).sort(),[...remainingOld.map(value=>value.Destination),...newRoots].sort());
}
const processProbe=String.raw`import os,json,stat
from pathlib import Path
found=[]
for p in Path('/proc').iterdir():
 if not p.name.isdigit() or int(p.name)==os.getpid(): continue
 try:
  argv=(p/'cmdline').read_bytes().split(b'\0')
  if any(Path(a.decode(errors='strict')).name in ['online-runtime-owner.py','online-inquiry-owner.py','fixture.py','application-native-candidate-controller.py','run-full-catalog-controller.py','chromium','chrome','chrome_crashpad_handler'] for a in argv if a): found.append(int(p.name))
 except FileNotFoundError: pass
assert not found, 'APPLICATION_ROLE_ORIGINAL_OWNER_STILL_PRESENT'
closed=0; unused=0
def read(file):
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd);assert stat.S_ISREG(before.st_mode) and before.st_nlink==1 and before.st_size<=4*1024**2
  data=os.read(fd,before.st_size+1);after=os.fstat(fd);named=os.lstat(file)
  identity=lambda value:(value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns)
  assert len(data)==before.st_size and identity(before)==identity(after)==identity(named)
  return json.loads(data)
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
  assert native['phase']=='QUIESCENT' and native['nativeReaped'] is True,'APPLICATION_ROLE_DURABLE_OWNER_UNKNOWN'
  assert native.get('databaseQuiet') is True or native.get('sqliteNativeClosed') is True,'APPLICATION_ROLE_DURABLE_SQL_UNKNOWN'
  work=Path(scope['boundaryDirectory'])/'state.json'
  if work.exists():assert read(work)['phase']=='QUIESCENT','APPLICATION_ROLE_DURABLE_WORK_UNKNOWN'
  closed+=1
print(json.dumps(dict(originalNativeProcesses=0,denyUnknownGrantRecordsChecked=closed,unusedGrantRecords=unused,adoptsOriginalPopen=False)))`;
const processQuiet=(observed=previous)=>Object.fromEntries(slots.map(service=>[service,JSON.parse(docker(['exec',observed[service].Id,'/usr/bin/python3','-I','-B','-c',processProbe]))]));
const sqlQuiet=()=>{const value=JSON.parse(docker(['exec',inspect('postgres').Id,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',
  "SELECT json_build_object('visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database LIKE 'qa_application_%'),'system',(SELECT system_identifier::text FROM pg_control_system()))"]));
  assert.equal(value.visible,true);assert.equal(value.sessions,0);assert.equal(value.prepared,0);return value;};
const operation=randomBytes(16).toString('hex'),reportPath=path.join(root,'reports/qa/application-native-candidate-'+operation+'.json');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const inputs=Object.fromEntries([base,...overlays,import.meta.filename,imageReceiptFile,materialReceiptFile,installedProbeFile,preflightFile,historicalFile,retainedImageReceiptFile,retainedMaterialReceiptFile,path.join(root,'scripts/replace-application-native-candidate-local.mjs'),...predecessorInputs,...(isolateAuthorityCohort?authorityCohortSources.map(file=>path.join(root,file)):[])].map(file=>[file,hash(file)]));
const report={format:'sabalan-application-native-candidate/v1',replacementEntry:'scripts/replace-qualified-application-native-candidate-local.mjs',operation,pass:false,phase:'INTENT',productionAdmission:false,
  onlyCandidateReplaced:!isolateAuthorityCohort,retainedOriginalPreserved:!isolateAuthorityCohort,...(isolateAuthorityCohort?{onlyQualificationSlotsRecreated:true,authorityCohort:{format:'sabalan-native-authority-cohort/v1',nonce:cohortNonce,prepared:{},verified:{}}}:{}),originalLimitsUnchanged:true,protectedBefore,previous:Object.fromEntries(slots.map(service=>[service,identity(previous[service])])),inputs,
  immutableImage:image,materialReceiptSha256:digest(materialReceiptRaw),imageReceiptSha256:digest(imageReceiptRaw),removedCodeTargets,
  ...(predecessor?{previousReplacement:{...previousReplacement},reobservedBaseline}:{}),...(failedAuthority?{failedAuthorityCohort:{...failedAuthorityCohort},reconciledFailedAuthorityBaseline:reobservedBaseline,failedAuthorityBaselineVerified:{}}:{}),nativeQuiet:processQuiet(),sqlQuiet:sqlQuiet()};
const save=()=>{fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');};save();
const children=[];let interrupted=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{interrupted=true;});
async function originalInstalledReadback(service,expected){
 status();const result=await new Promise(resolve=>{const child=spawn('docker',['exec','-i',previous[service].Id,'node','--input-type=module'],{stdio:['pipe','pipe','pipe']});children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=8*1024**2)stdout+=bytes;else failure??='BASELINE_PROBE_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='BASELINE_PROBE_STDERR_BOUND';});child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure}));child.stdin.end(installedProbe);});
 assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.failure,undefined);assert.equal(interrupted,false);const value=JSON.parse(result.stdout);validateInstalledNativeRole(value,expected);return{originalPid:result.originalPid,code:0,signal:null,stderr:result.stderr,result:value};
}
async function originalAuthorityDirectory(service,mode,observed,expected=null,peerExpected=null,nonce=cohortNonce,logField=null){
 const owner=authorityWriterRoot(observed[service],service),fixture=fs.readFileSync(path.join(root,authorityCohortSources[1]));
 const spec={mode,kind:owner.kind,nonce,root:owner.target,expected,peerExpected};
 const bootstrap="import sys,json,base64,hashlib,io;p=json.load(sys.stdin);s=base64.b64decode(p['source'],validate=True);assert hashlib.sha256(s).hexdigest()=="+JSON.stringify(digest(fixture))+";sys.stdin=io.StringIO(json.dumps(p['spec']));exec(compile(s,'original-authority-cohort','exec'),globals())";
 status();const result=await new Promise(resolve=>{const child=spawn('docker',['exec','-i',observed[service].Id,'/usr/bin/python3','-I','-B','-c',bootstrap],{stdio:['pipe','pipe','pipe']});children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=65536)stdout+=bytes;else failure??='AUTHORITY_COHORT_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='AUTHORITY_COHORT_STDERR_BOUND';});child.stdin.on('error',error=>{failure??=error.code;});child.on('error',error=>{failure??=error.code;});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure}));child.stdin.end(JSON.stringify({source:fixture.toString('base64'),spec}));});
 const stage=mode==='create'?'prepared':'verified';(logField?report[logField]:report.authorityCohort[stage])[service]={...result};save();
 assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(result.failure,undefined);assert.equal(interrupted,false);return {...result,result:JSON.parse(result.stdout)};
}
try{
 if(predecessor||failedAuthority){report.reobservedInstalled={};for(const service of slots){report.reobservedInstalled[service]=await originalInstalledReadback(service,nativeMaterialIdentity(service==='backend-candidate'?predecessorMaterial:retainedMaterial));save();}report.reobservedNativeQuiet=processQuiet();report.reobservedSqlQuiet=sqlQuiet();for(const service of slots)assert.deepEqual(identity(inspect(service)),identity(previous[service]));const baseline=report.reconciledFailedAuthorityBaseline??report.reobservedBaseline;baseline.installedBytesVerified=true;baseline.nativeAndSqlQuietVerified=true;save();if(failedAuthority){for(const service of slots){const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';report.failedAuthorityBaselineVerified[service]=await originalAuthorityDirectory(service,'verify',previous,failedNamespaces[service],failedNamespaces[peer],failedAuthority.authorityCohort.nonce,'failedAuthorityBaselineVerified');save();}baseline.currentEmptyNamespacesVerified=true;save();}}
 if(inspectOnly){report.phase='INSPECTION_COMPLETE';report.inspectionOnly=true;report.originalChildren={allOriginalChildrenClosed:true,interrupted:false};assert.equal(interrupted,false);save();console.log(JSON.stringify({inspectionOnly:true,reportPath}));return;}

  for(const [file,digest]of Object.entries(inputs))assert.equal(hash(file),digest);
  report.preMutationNativeQuiet=processQuiet();report.preMutationSqlQuiet=sqlQuiet();preflight();save();
  if(isolateAuthorityCohort){for(const service of slots){report.authorityCohort.prepared[service]=await originalAuthorityDirectory(service,'create',previous);save();}report.preMutationNativeQuiet=processQuiet();report.preMutationSqlQuiet=sqlQuiet();preflight();}
  status();report.up=await new Promise(resolve=>{const child=spawn('docker',[...compose,'up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120','backend-candidate',...(isolateAuthorityCohort?['backend-retained']:[])],{env,stdio:['ignore','pipe','pipe']});
    children.push(child);let stdout='',stderr='',failure;child.stdout.on('data',bytes=>{if(Buffer.byteLength(stdout)+bytes.length<=8*1024**2)stdout+=bytes;else failure??='COMPOSE_STDOUT_BOUND';});child.stderr.on('data',bytes=>{if(Buffer.byteLength(stderr)+bytes.length<=65536)stderr+=bytes;else failure??='COMPOSE_STDERR_BOUND';});
    child.on('error',error=>{report.spawnError=error.code;save();});child.on('close',(code,signal)=>resolve({originalPid:child.pid,code,signal,stdout,stderr,failure}));});
  save();assert.equal(interrupted,false);assert.equal(report.up.failure,undefined);assert.equal(report.up.code,0);assert.equal(report.up.signal,null);assert.equal(report.spawnError,undefined);
  report.protectedAfter=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));assert.deepEqual(report.protectedAfter,protectedBefore);
  const actual=Object.fromEntries(slots.map(service=>[service,inspect(service)]));
  for(const service of slots){const value=actual[service];assert.equal(value.Image,service==='backend-candidate'?image:oldImage);
    assert.equal(value.HostConfig.Memory,previous[service].HostConfig.Memory);assert.deepEqual(value.Config.Cmd,previous[service].Config.Cmd);}
  for(const service of slots)assert.ok(!actual[service].Mounts.some(value=>removedCodeTargets.includes(value.Destination)));
  if(isolateAuthorityCohort){validateAuthorityCohortSlots(actual,cohortNonce);for(const service of slots){assert.notEqual(actual[service].Id,previous[service].Id);const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';report.authorityCohort.verified[service]=await originalAuthorityDirectory(service,'verify',actual,report.authorityCohort.prepared[service].result.namespace,report.authorityCohort.prepared[peer].result.namespace);save();}}
  const candidate=actual['backend-candidate'],retained=actual['backend-retained'];
  const mount=(value,target)=>{const found=value.Mounts.find(entry=>entry.Destination===target);assert.ok(found);return found;};
  const http=mount(retained,'/run/sabalan-online'),httpWriter=mount(candidate,'/app/runtime-authority');
  const jobs=mount(candidate,'/run/sabalan-online'),jobsWriter=mount(retained,'/app/jobs-authority');
  assert.equal(http.RW,false);assert.equal(jobs.RW,false);assert.equal(httpWriter.RW,true);assert.equal(jobsWriter.RW,true);
  assert.equal(http.Source,httpWriter.Source);assert.equal(jobs.Source,jobsWriter.Source);assert.notEqual(http.Source,jobs.Source);
  assert.ok(!retained.Mounts.some(value=>value.Source===http.Source&&value.RW));assert.ok(!candidate.Mounts.some(value=>value.Source===jobs.Source&&value.RW));
  report.actual=Object.fromEntries(slots.map(service=>[service,{...identity(actual[service]),host:actual[service].NetworkSettings.Networks['sabalanerp-local_default'].IPAddress,
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
  report.postMutationNativeQuiet=processQuiet(actual);report.postMutationSqlQuiet=sqlQuiet();
  report.privateQualificationRuntimes={main:perRole.main.runtime,candidate:perRole.candidate.runtime};
  report.privateQualificationSourceCommits={main:retainedReceipt.sourceCommit,candidate:imageReceipt.sourceCommit};
  report.roleEvidence={main:{image:oldImage,imageReceiptFile:retainedImageReceiptFile,imageReceiptSha256:digest(retainedImageRaw),materialReceiptFile:retainedMaterialReceiptFile,materialReceiptSha256:digest(retainedMaterialRaw)},candidate:{image,imageReceiptFile,imageReceiptSha256:digest(imageReceiptRaw),materialReceiptFile,materialReceiptSha256:digest(materialReceiptRaw)}};
  report.finalProtected=Object.fromEntries(protectedServices.map(service=>[service,identity(inspect(service))]));assert.deepEqual(report.finalProtected,protectedBefore);
  for(const [file,digest]of Object.entries(inputs))assert.equal(hash(file),digest);
  assert.equal(interrupted,false);assert.ok(children.every(child=>child.exitCode!==null||child.signalCode!==null));report.originalChildren={allOriginalChildrenClosed:true,interrupted:false};
  if(isolateAuthorityCohort)validateAuthorityCohortReceipt(report);if(failedAuthority)validateReconciledPrecisionFailedBaseline(report,failedAuthority);report.pass=true;report.phase='COMPLETE';save();
}catch(error){report.failure={name:error.name,message:error.message};report.phase='FAILED_CLOSED';save();
  if(children.some(child=>child.exitCode===null&&child.signalCode===null)){await new Promise(()=>{setInterval(()=>{void children;},30000);});}
  throw error;
}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
