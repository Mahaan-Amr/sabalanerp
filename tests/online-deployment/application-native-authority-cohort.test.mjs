import test from 'node:test';
import assert from 'node:assert/strict';
import {authorityMounts,authorityVolumes,authoritySubpath,authorityWriterRoot,validateAuthorityCohortConfiguration,validateAuthorityCohortSlots,validateAuthorityCohortReceipt} from '../../scripts/lib/application-native-authority-cohort.mjs';
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
 const namespace=i=>({st_dev:1,st_ino:i,st_uid:0,st_mode:0o40700});
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
