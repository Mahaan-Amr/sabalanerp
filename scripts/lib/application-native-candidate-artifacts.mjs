import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {nativeMaterialIdentity,validateInstalledNativeRole} from '../replace-application-native-candidate-local.mjs';
import {stableFrontendBaseFile} from './production-frontend-base-artifacts.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function candidateReplacementReceiptArgument(argv){
 assert.equal(argv.length,2,'EXPLICIT_ACTUAL_CANDIDATE_REPLACEMENT_RECEIPT_REQUIRED');assert.equal(argv[0],'--candidate-replacement-receipt');
 assert.match(argv[1].replaceAll('\\','/'),/(?:^|\/)reports\/qa\/application-native-candidate-[a-f0-9]{32}\.json$/);return argv[1];
}
export function validateNativeCandidateReplacementReceipt(value){
 if(Object.hasOwn(value,'replacementEntry'))assert.equal(value.replacementEntry,'scripts/replace-qualified-application-native-candidate-local.mjs','REPLACEMENT_ENTRY_UNREVIEWED');
 assert.equal(value.format,'sabalan-application-native-candidate/v1');assert.equal(value.pass,true);assert.equal(value.phase,'COMPLETE');assert.equal(value.productionAdmission,false);
 assert.equal(value.onlyCandidateReplaced,true);assert.equal(value.retainedOriginalPreserved,true);assert.equal(value.up.code,0);assert.equal(value.up.signal,null);assert.equal(value.up.failure,undefined);
 assert.equal(value.originalChildren.allOriginalChildrenClosed,true);assert.equal(value.originalChildren.interrupted,false);
 const services=['backend','frontend','postgres','inquiry','redis','clamav','frontend-candidate','frontend-retained','backend-retained'].sort();
 assert.deepEqual(Object.keys(value.protectedBefore).sort(),services);assert.deepEqual(value.protectedBefore,value.protectedAfter);assert.deepEqual(value.protectedBefore,value.finalProtected);
 for(const stage of ['nativeQuiet','preMutationNativeQuiet','postMutationNativeQuiet'])for(const service of ['backend-candidate','backend-retained'])assert.equal(value[stage][service].originalNativeProcesses,0);
 for(const stage of ['sqlQuiet','preMutationSqlQuiet','postMutationSqlQuiet']){assert.equal(value[stage].visible,true);assert.equal(value[stage].sessions,0);assert.equal(value[stage].prepared,0);assert.equal(value[stage].system,value.sqlQuiet.system);}
}
export function validateReobservedCandidateBaselineReceipt(value,prior){
 validateNativeCandidateReplacementReceipt(prior);assert.equal(value.replacementEntry,'scripts/replace-qualified-application-native-candidate-local.mjs');const baseline=value.reobservedBaseline;assert.equal(baseline.format,'sabalan-reobserved-quiescent-installed-slots/v1');
 for(const key of ['adoptsOriginalPopen','originalNativeClosureInferred','birthReasonClaimed','productionAdmission'])assert.equal(baseline[key],false);assert.equal(baseline.installedBytesVerified,true);assert.equal(baseline.nativeAndSqlQuietVerified,true);
 for(const service of ['backend-candidate','backend-retained']){const original=prior.actual[service],observed=value.previous[service];assert.equal(observed.id,original.id);assert.equal(observed.image,original.image);assert.ok(Number.isFinite(Date.parse(observed.startedAt)));assert.deepEqual(baseline.identities[service],observed);assert.deepEqual(baseline.previousIdentities[service],Object.fromEntries(['id','image','startedAt'].map(k=>[k,original[k]])));const readback=value.reobservedInstalled[service];assert.ok(Number.isSafeInteger(readback.originalPid)&&readback.originalPid>0);assert.equal(readback.code,0);assert.equal(readback.signal,null);assert.equal(value.reobservedNativeQuiet[service].originalNativeProcesses,0);assert.equal(value.reobservedNativeQuiet[service].adoptsOriginalPopen,false);}
 assert.equal(value.reobservedSqlQuiet.visible,true);assert.equal(value.reobservedSqlQuiet.sessions,0);assert.equal(value.reobservedSqlQuiet.prepared,0);assert.equal(value.reobservedSqlQuiet.system,value.sqlQuiet.system);
}
/** Reads only an ACTUAL completed candidate replacement; missing future receipts
 * fail. Repository captures and external D receipt identities remain distinct. */
export function collectNativeCandidateArtifacts({root,capture,containers,sourceCommit,receiptArgument}){
 const external=new Map(),captured=new Map();
 const captureFile=relative=>{const raw=capture(relative);captured.set(relative,sha(raw));return raw;};
 const readExternal=file=>{file=path.resolve(file);const stable=stableFrontendBaseFile(file,16*1024**2),raw=fs.readFileSync(file);assert.equal(raw.length,stable.bytes);assert.equal(sha(raw),stable.sha256);external.set(file,stable);return raw;};
 const requested=path.resolve(root,receiptArgument),relative=path.relative(root,requested).split(path.sep).join('/');assert.match(relative,/^reports\/qa\/application-native-candidate-[a-f0-9]{32}\.json$/);
 captureFile('scripts/lib/application-native-candidate-artifacts.mjs');captureFile('scripts/lib/production-frontend-base-artifacts.mjs');
 const helper='scripts/replace-application-native-candidate-local.mjs',probe='tests/online-deployment/installed-native-image-probe.fixture.mjs';captureFile(helper);captureFile(probe);
 const bytes=captureFile(relative),value=JSON.parse(bytes);validateNativeCandidateReplacementReceipt(value);
 const replacementEntry=value.replacementEntry??helper;if(replacementEntry!==helper)captureFile(replacementEntry);
 if(value.previousReplacement){
  assert.equal(replacementEntry,'scripts/replace-qualified-application-native-candidate-local.mjs');assert.deepEqual(Object.keys(value.previousReplacement).sort(),['file','sha256']);assert.match(value.previousReplacement.sha256,/^[a-f0-9]{64}$/);const priorRaw=readExternal(value.previousReplacement.file);assert.equal(sha(priorRaw),value.previousReplacement.sha256);assert.equal(value.inputs[path.resolve(value.previousReplacement.file)],value.previousReplacement.sha256);const prior=JSON.parse(priorRaw);validateReobservedCandidateBaselineReceipt(value,prior);
  for(const[role,service]of [['main','backend-retained'],['candidate','backend-candidate']]){const point=prior.roleEvidence[role],imageRaw=readExternal(point.imageReceiptFile),materialRaw=readExternal(point.materialReceiptFile);assert.equal(sha(imageRaw),point.imageReceiptSha256);assert.equal(sha(materialRaw),point.materialReceiptSha256);const image=JSON.parse(imageRaw),material=JSON.parse(materialRaw);assert.equal(image.pass,true);assert.equal(image.image.id,prior.actual[service].image);assert.equal(image.materialReceiptSha256,sha(materialRaw));validateInstalledNativeRole(value.reobservedInstalled[service].result,nativeMaterialIdentity(material));}
 }

 const evidence={};
 for(const [role,service]of [['main','backend-retained'],['candidate','backend-candidate']]){
  const point=value.roleEvidence[role];assert.match(point.image,/^sha256:[a-f0-9]{64}$/);
  const imageRaw=readExternal(point.imageReceiptFile),materialRaw=readExternal(point.materialReceiptFile);assert.equal(sha(imageRaw),point.imageReceiptSha256);assert.equal(sha(materialRaw),point.materialReceiptSha256);
  const image=JSON.parse(imageRaw),material=JSON.parse(materialRaw);
  assert.equal(image.format,'sabalan-current-backend-image/v1');assert.equal(image.pass,true);assert.equal(image.sourceUnchanged,true);assert.equal(image.protectedServicesUnchanged,true);assert.equal(image.originalChildren.allOriginalChildrenClosed,true);assert.equal(image.originalChildren.interrupted,false);
  assert.equal(material.format,'sabalan-current-backend-material/v1');assert.equal(material.materialized,true);assert.equal(image.materialReceiptSha256,sha(materialRaw));assert.equal(image.image.id,point.image);assert.equal(containers[service].Image,point.image);
  assert.match(image.sourceCommit,/^[a-f0-9]{40}$/);assert.equal(image.sourceCommit,value.privateQualificationSourceCommits[role]);if(role==='candidate')assert.equal(image.sourceCommit,sourceCommit);
  const expected=nativeMaterialIdentity(material);assert.deepEqual(expected.runtime,value.privateQualificationRuntimes[role]);
  assert.deepEqual(Object.fromEntries(['id','image','startedAt'].map(key=>[key,value.actual[service][key]])),{id:containers[service].Id,image:containers[service].Image,startedAt:containers[service].State.StartedAt});
  const installed=value.installed[service];assert.equal(installed.code,0);assert.equal(installed.signal,null);validateInstalledNativeRole(installed.result,expected);
  assert.ok(!containers[service].Mounts.some(mount=>['/app/dist','/packages/partner-sales-contracts/dist','/packages/contract-product-graph/dist'].includes(mount.Destination)));
  evidence[role]={...point,sourceCommit:image.sourceCommit,runtime:expected.runtime};
 }
 assert.equal(evidence.main.image,'sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186');assert.notEqual(evidence.candidate.image,evidence.main.image);
 const historical=JSON.parse(captureFile('reports/qa/application-native-role-slots-aeca1063d2275dde6b8fbda710d1de34.json'));assert.equal(historical.pass,true);assert.deepEqual(evidence.main.runtime,historical.privateQualificationRuntime);assert.equal(evidence.main.imageReceiptSha256,historical.imageReceiptSha256);assert.equal(evidence.main.materialReceiptSha256,historical.materialReceiptSha256);
 assert.deepEqual(value.actual['backend-retained']&&Object.fromEntries(['id','image','startedAt'].map(key=>[key,value.actual['backend-retained'][key]])),value.protectedBefore['backend-retained']);
 for(const file of ['docker-compose.online-acceptance.yml','docker-compose.online-runtime-authority-acceptance.yml','docker-compose.application-native-role-isolation.yml','docker-compose.application-native-mixed-images.yml',helper,probe,...(replacementEntry===helper?[]:[replacementEntry])]){
  const raw=captureFile(file);assert.equal(value.inputs[path.join(root,file)],sha(raw),'REPLACEMENT_SOURCE_PIN_CHANGED: '+file);
 }
 const revalidate=()=>{for(const [file,pin]of external)assert.deepEqual(stableFrontendBaseFile(file,16*1024**2),pin,'EXTERNAL_ROLE_RECEIPT_CHANGED');for(const [file,digest]of captured)assert.equal(sha(fs.readFileSync(path.join(root,file))),digest,'ROLE_CAPTURE_CHANGED');return{roleEvidence:evidence,externalInputs:Object.fromEntries(external)};};
 revalidate();return{roleQualificationFile:relative,roleQualificationBytes:bytes,roleQualification:value,privateQualificationRuntime:structuredClone(value.privateQualificationRuntimes.main),revalidate};
}
