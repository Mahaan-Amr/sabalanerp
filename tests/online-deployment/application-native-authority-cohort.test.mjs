import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {authorityMounts,authorityVolumes,authoritySubpath,authorityWriterRoot,validateAuthorityCohortConfiguration,validateAuthorityCohortSlots,validateAuthorityCohortReceipt,validateAuthorityNamespaceIdentity,precisionFailedAuthorityCohortSha256,precisionFailedAuthorityNamespaces,validatePrecisionFailedAuthoritySlots,validateReconciledPrecisionFailedBaseline} from '../../scripts/lib/application-native-authority-cohort.mjs';
import {validateNativeCandidateReplacementReceipt} from '../../scripts/lib/application-native-candidate-artifacts.mjs';
import {parseCandidateReplacementArguments,validatePreviousCandidateReplacement} from '../../scripts/replace-qualified-application-native-candidate-local.mjs';
import {createOriginalRoleCoordinator} from '../../scripts/lib/application-native-role-coordinator.mjs';
const nonce='a'.repeat(32),subpath=authoritySubpath(nonce),image='sha256:'+'1'.repeat(64),retained='sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186';
const clone=structuredClone;
function configuration(){return{name:'sabalanerp-local',volumes:Object.fromEntries(Object.entries(authorityVolumes).map(([k,v])=>[k,{name:v}])),services:Object.fromEntries(Object.entries(authorityMounts).map(([service,mounts])=>[service,{volumes:mounts.map(m=>({type:'volume',source:m.kind,target:m.target,read_only:!m.rw,volume:{nocopy:true,...(m.subpath?{subpath}:{})}}))}]))};}
function containers(){return Object.fromEntries(Object.entries(authorityMounts).map(([service,mounts])=>[service,{Config:{Labels:{'com.docker.compose.project':'sabalanerp-local','com.docker.compose.service':service}},Mounts:mounts.map(m=>({Type:'volume',Name:authorityVolumes[m.kind],Destination:m.target,RW:m.rw,Source:'/var/lib/docker/volumes/'+authorityVolumes[m.kind]+'/_data'+(m.subpath?'/'+subpath:'')})),HostConfig:{Mounts:mounts.map(m=>({Type:'volume',Source:authorityVolumes[m.kind],Target:m.target,ReadOnly:!m.rw,VolumeOptions:{NoCopy:true,...(m.subpath?{Subpath:subpath}:{})}}))}}]));}
function receipt(){
 const protectedBefore=Object.fromEntries(['backend','frontend','postgres','inquiry','redis','clamav','frontend-candidate','frontend-retained'].map(n=>[n,{id:'same-'+n}]));
 const services=['backend-candidate','backend-retained'],previous=Object.fromEntries(services.map((s,i)=>[s,{id:String(i+1).repeat(64),image:s==='backend-candidate'?image:retained,startedAt:'2026-10-21T00:00:00Z'}]));
 const actual=Object.fromEntries(services.map((s,i)=>[s,{...previous[s],id:String(i+3).repeat(64),startedAt:'2026-10-22T00:00:00Z'}]));
 const namespace=i=>({st_dev:'2112',st_ino:String(i),st_uid:'0',st_gid:'0',st_mode:String(0o40700),st_nlink:'2',st_size:'4096',st_mtime_ns:'1792657655942494549',st_ctime_ns:'1792657655942494549'});
 const prepared=Object.fromEntries(services.map((s,i)=>[s,{originalPid:i+1,code:0,signal:null,result:{format:'sabalan-authority-cohort-directory/v1',mode:'create',nonce,namespace:namespace(i+10),exclusivelyCreated:true,empty:true}}]));
 const verified=Object.fromEntries(services.map((s,i)=>[s,{originalPid:i+3,code:0,signal:null,result:{format:'sabalan-authority-cohort-directory/v1',mode:'verify',nonce,namespace:namespace(i+10),consumerNamespace:namespace(11-i),empty:true}}]));
 const quiet=Object.fromEntries(services.map(s=>[s,{originalNativeProcesses:0,adoptsOriginalPopen:false}])),sql={visible:true,sessions:0,prepared:0,system:'123'};
 return{format:'sabalan-application-native-candidate/v1',replacementEntry:'scripts/replace-qualified-application-native-candidate-local.mjs',pass:true,phase:'COMPLETE',productionAdmission:false,onlyCandidateReplaced:false,retainedOriginalPreserved:false,onlyQualificationSlotsRecreated:true,originalLimitsUnchanged:true,authorityCohort:{format:'sabalan-native-authority-cohort/v1',nonce,prepared,verified},protectedBefore,protectedAfter:clone(protectedBefore),finalProtected:clone(protectedBefore),previous,actual,immutableImage:image,roleEvidence:{main:{image:retained,imageReceiptSha256:'a'.repeat(64),materialReceiptSha256:'b'.repeat(64)},candidate:{image,imageReceiptSha256:'c'.repeat(64),materialReceiptSha256:'d'.repeat(64)}},up:{originalPid:9,code:0,signal:null},originalChildren:{allOriginalChildrenClosed:true,interrupted:false},nativeQuiet:clone(quiet),preMutationNativeQuiet:clone(quiet),postMutationNativeQuiet:clone(quiet),sqlQuiet:clone(sql),preMutationSqlQuiet:clone(sql),postMutationSqlQuiet:clone(sql),installed:Object.fromEntries(services.map(s=>[s,{code:0,signal:null}]))};
}
test('fresh cohort config and actual engine mount options retain six exact roles',()=>{validateAuthorityCohortConfiguration(configuration(),nonce);assert.equal(validateAuthorityCohortSlots(containers(),nonce),true);});
test('nonces reject traversal, reuse paths and foreign labels',()=>{for(const value of ['../foreign','cohort-'+nonce,'a/b','',null])assert.throws(()=>authoritySubpath(value));});
test('consumer cannot gain any writable alias of peer authority volume',()=>{const c=containers();c['backend-candidate'].Mounts.push({Name:authorityVolumes.jobs,RW:true});assert.throws(()=>validateAuthorityCohortSlots(c,nonce),/PEER_AUTHORITY/);});
test('wrong subpath, copy-up and readonly producer are refused',()=>{
 for(const mutate of [c=>c.services['backend-candidate'].volumes[0].volume.subpath='cohort-'+'b'.repeat(32),c=>c.services['backend-candidate'].volumes[0].volume.nocopy=false,c=>c.services['backend-retained'].volumes[1].read_only=true]){const c=configuration();mutate(c);assert.throws(()=>validateAuthorityCohortConfiguration(c,nonce));}
});
test('actual Engine subpath must be explicit and equal, not inferred from container names',()=>{const c=containers();delete c['backend-candidate'].HostConfig.Mounts[0].VolumeOptions.Subpath;assert.throws(()=>validateAuthorityCohortSlots(c,nonce));});
test('first bootstrap uses only proved whole-volume producer; later runs use explicit root alias',()=>{
 const c=containers()['backend-candidate'];assert.equal(authorityWriterRoot(c,'backend-candidate').legacyBootstrap,false);
 c.Mounts=c.Mounts.filter(m=>m.Destination!=='/app/qualification-authority-root');c.HostConfig.Mounts=[];c.Mounts[0].Source='/var/lib/docker/volumes/'+authorityVolumes.runtime+'/_data';assert.equal(authorityWriterRoot(c,'backend-candidate').legacyBootstrap,true);
 c.Mounts[0].Source+='/foreign';assert.throws(()=>authorityWriterRoot(c,'backend-candidate'),/WHOLE_AUTHORITY/);
});
test('strict new receipt truthfully recreates both slots and preserves eight others',()=>{const r=receipt();assert.equal(validateAuthorityCohortReceipt(r),true);validateNativeCandidateReplacementReceipt(r);validatePreviousCandidateReplacement(r);});
test('same old slot, consumer inode mismatch or changed protected service refuses receipt',()=>{
 for(const mutate of [r=>r.actual['backend-retained'].id=r.previous['backend-retained'].id,r=>r.authorityCohort.verified['backend-candidate'].result.consumerNamespace.st_ino++,r=>r.finalProtected.backend.id='changed']){const r=receipt();mutate(r);assert.throws(()=>validateAuthorityCohortReceipt(r));}
});
test('failed original prepare, nonempty namespace or forged candidate-only claim refuses',()=>{
 for(const mutate of [r=>r.authorityCohort.prepared['backend-candidate'].code=1,r=>r.authorityCohort.verified['backend-retained'].result.empty=false,r=>r.onlyCandidateReplaced=true]){const r=receipt();mutate(r);assert.throws(()=>validateAuthorityCohortReceipt(r));}
});
test('cohort rotation requires explicit canonical flag; old argument behavior remains intact',()=>{
 const args=['--inspect','--image-receipt','D:/image.json','--material-receipt','D:/material.json','--preflight','D:/preflight.json'];
 assert.equal(parseCandidateReplacementArguments(args).isolateAuthorityCohort,undefined);assert.equal(parseCandidateReplacementArguments([...args,'--isolate-authority-cohort']).isolateAuthorityCohort,true);
 assert.throws(()=>parseCandidateReplacementArguments([...args,'--unknown-cohort']));
});
test('two actual original coordinators require distinct fresh trust stores',()=>{
 const topology={main:{containerId:'1'.repeat(64),image:retained,host:'172.18.0.10'},candidate:{containerId:'2'.repeat(64),image,host:'172.18.0.11'}};
 const first=createOriginalRoleCoordinator({directory:'/app/online-runtime-acceptance/application-native-'+'1'.repeat(32),topology,fileHashes:{}});
 const second=createOriginalRoleCoordinator({directory:'/app/online-runtime-acceptance/application-native-'+'2'.repeat(32),topology,fileHashes:{}});
 assert.notEqual(first.enrollment.publicKey,second.enrollment.publicKey);assert.notEqual(first.enrollment.session,second.enrollment.session);
 assert.notEqual(authoritySubpath('1'.repeat(32)),authoritySubpath('2'.repeat(32)));
});
test('nanoseconds beyond 2^53 survive JSON exactly; numeric or rounded identities are refused',()=>{
 const pin=receipt().authorityCohort.prepared['backend-candidate'].result.namespace;
 assert.equal(validateAuthorityNamespaceIdentity(JSON.parse(JSON.stringify(pin))).st_mtime_ns,'1792657655942494549');
 const numeric={...pin,st_mtime_ns:Number(pin.st_mtime_ns)};assert.throws(()=>validateAuthorityNamespaceIdentity(numeric));
 const r=receipt();r.authorityCohort.verified['backend-candidate'].result.namespace.st_mtime_ns='1792657655942494500';assert.throws(()=>validateAuthorityCohortReceipt(r));
});
function precisionFailure(){
 const r=receipt(),oldNonce='cbd70d62f0ce9abafb348acff4f86f56';
 const prepared=clone(r.authorityCohort.prepared);
 for(const[service,row]of Object.entries(prepared)){
  const value={...row.result,nonce:oldNonce,productionAdmission:false};
  const raw=JSON.stringify(value).replace(/"(st_[a-z_]+)":"([0-9]+)"/g,'"$1":$2');row.stdout=raw;row.result=JSON.parse(raw);
 }
 return{operation:'70ef926d515138b606e47ce11e32d011',pass:false,phase:'FAILED_CLOSED',productionAdmission:false,authorityCohort:{nonce:oldNonce,prepared,verified:{}},previous:r.previous,immutableImage:image,protectedBefore:r.protectedBefore,protectedAfter:clone(r.protectedBefore),up:{code:0,signal:null},failure:{name:'AssertionError',message:'1 !== 0'}};
}
function reconciledCase(){
 const failed=precisionFailure(),current=containers();
 for(const[service,value]of Object.entries(current)){
  value.Id=service==='backend-candidate'?'3'.repeat(64):'4'.repeat(64);value.Image=service==='backend-candidate'?image:retained;value.State={Running:true,Health:{Status:'healthy'},StartedAt:'2026-10-22T00:00:00Z'};
  for(const m of value.HostConfig.Mounts)if(m.VolumeOptions.Subpath)m.VolumeOptions.Subpath=authoritySubpath(failed.authorityCohort.nonce);
  for(const m of value.Mounts)m.Source=m.Source.replace(subpath,authoritySubpath(failed.authorityCohort.nonce));
 }
 const baseline=validatePrecisionFailedAuthoritySlots(failed,current,failed.protectedAfter),value=receipt(),pins=precisionFailedAuthorityNamespaces(failed);
 value.previous=baseline.identities;Object.assign(baseline,{installedBytesVerified:true,nativeAndSqlQuietVerified:true,currentEmptyNamespacesVerified:true,candidateEvidence:{image}});
 value.failedAuthorityCohort={sha256:precisionFailedAuthorityCohortSha256};value.reconciledFailedAuthorityBaseline=baseline;value.reobservedSqlQuiet=clone(value.sqlQuiet);value.reobservedNativeQuiet=clone(value.nativeQuiet);
 value.reobservedInstalled={};value.failedAuthorityBaselineVerified={};
 for(const service of Object.keys(authorityMounts)){
  const peer=service==='backend-candidate'?'backend-retained':'backend-candidate';value.reobservedInstalled[service]={originalPid:90,code:0,signal:null};
  value.failedAuthorityBaselineVerified[service]={originalPid:91,code:0,signal:null,result:{mode:'verify',nonce:failed.authorityCohort.nonce,empty:true,namespace:pins[service],consumerNamespace:pins[peer]}};
 }
 return{failed,value,current};
}
test('known failed raw stdout is recovered losslessly without upgrading its failure',()=>{
 const failed=precisionFailure(),pins=precisionFailedAuthorityNamespaces(failed);
 assert.equal(pins['backend-candidate'].st_mtime_ns,'1792657655942494549');assert.equal(failed.pass,false);assert.equal(failed.phase,'FAILED_CLOSED');
 const c=reconciledCase();assert.equal(validateReconciledPrecisionFailedBaseline(c.value,c.failed),true);
});
test('failed baseline requires same current images, protected services and actual original subpaths',()=>{
 for(const mutate of [c=>c.current['backend-retained'].Image=image,c=>c.current['backend-candidate'].HostConfig.Mounts[0].VolumeOptions.Subpath='foreign',c=>c.failed.protectedAfter.backend.id='changed']){const c=reconciledCase();mutate(c);assert.throws(()=>validatePrecisionFailedAuthoritySlots(c.failed,c.current,c.failed.protectedAfter));}
});
test('failed baseline refuses inferred ownership, missing fresh bytes, SQL or lossy namespace',()=>{
 for(const mutate of [v=>v.reconciledFailedAuthorityBaseline.adoptsOriginalPopen=true,v=>v.reconciledFailedAuthorityBaseline.installedBytesVerified=false,v=>v.reobservedSqlQuiet.sessions=1,v=>v.failedAuthorityBaselineVerified['backend-candidate'].result.namespace.st_mtime_ns='1792657655942494500']){const c=reconciledCase();mutate(c.value);assert.throws(()=>validateReconciledPrecisionFailedBaseline(c.value,c.failed));}
});
test('known failed-cohort recovery is explicit, SHA-pinned and permits only fresh rotation',()=>{
 const args=['--inspect','--image-receipt','D:/image.json','--material-receipt','D:/material.json','--preflight','D:/preflight.json','--failed-authority-cohort-receipt','D:/reports/qa/application-native-candidate-70ef926d515138b606e47ce11e32d011.json','--failed-authority-cohort-sha256',precisionFailedAuthorityCohortSha256];
 assert.throws(()=>parseCandidateReplacementArguments(args),/FRESH_ROTATION/);assert.equal(parseCandidateReplacementArguments([...args,'--isolate-authority-cohort']).failedAuthorityCohort.sha256,precisionFailedAuthorityCohortSha256);
 const wrong=[...args];wrong[10]='0'.repeat(64);assert.throws(()=>parseCandidateReplacementArguments([...wrong,'--isolate-authority-cohort']));
});
test('actual directory child failure is saved with stdout/stderr/code before assertion',async()=>{
 const source=fs.readFileSync(new URL('../../scripts/replace-qualified-application-native-candidate-local.mjs',import.meta.url),'utf8');
 const start=source.indexOf('async function originalAuthorityDirectory('),end=source.indexOf('\nasync function originalNegativeAcceptanceVerify(',start);assert.ok(start>0&&end>start);
 const report={authorityCohort:{prepared:{},verified:{}}},saved=[],children=[];
 const spawn=()=>{const child=new EventEmitter();child.pid=4321;child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.stdin=new EventEmitter();child.stdin.end=()=>queueMicrotask(()=>{child.stdout.emit('data',Buffer.from('original output'));child.stderr.emit('data',Buffer.from('original failure'));child.emit('close',1,null);});return child;};
 const context={authorityWriterRoot:()=>({kind:'runtime',target:'/app/qualification-authority-root'}),fs:{readFileSync:()=>Buffer.from('fixture')},path,root:'/repo',authorityCohortSources:['module','fixture'],cohortNonce:nonce,digest:()=> 'a'.repeat(64),status:()=>{},spawn,children,Buffer,assert,interrupted:false,report,save:()=>saved.push(clone(report))};
 const actual=vm.runInNewContext('('+source.slice(start,end)+')',context);
 await assert.rejects(actual('backend-candidate','verify',{'backend-candidate':{Id:'id'}}));
 assert.equal(saved.length,1);const row=saved[0].authorityCohort.verified['backend-candidate'];assert.equal(row.originalPid,4321);assert.equal(row.code,1);assert.equal(row.stdout,'original output');assert.equal(row.stderr,'original failure');
});
