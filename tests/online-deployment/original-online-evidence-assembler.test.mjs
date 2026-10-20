import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deriveProtectedDirectoryComponents,originalOnlineProducerGaps,assembleOriginalProtectedOnlineEvidence,assembleOriginalOnlineEvidence,readOriginalOnlineEvidenceAssembly} from '../../scripts/lib/original-online-evidence-assembler.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const raw=value=>Buffer.from(JSON.stringify(value));
function sample(){
 const roots=['storage/contracts','storage/hr-hiring','storage/accounting-contracts','storage/dispatch-documents','storage/support-tickets','storage/performance-exports','uploads/images','uploads/security-shift-log','uploads/security-vehicle-pairs'];
 const canonicalRestoreRaw=raw({ok:true,drill:{healthy:true}});
 const payload=Buffer.from('original Persian attachment: قرارداد');
 const components=roots.map(relative=>({path:'files/'+relative.replace(/^storage\//,'')+'/nested/real.bin',size:payload.length,sha256:sha(payload)}));
 const metadata={captureMethod:'PROTECTED_MAINTENANCE_COMPLETE',manifest:{format:'sabalan-recovery',packageType:'COMPLETE',components}};
 const baselineRaw=raw({format:'sabalan-application-restored-file-baseline/v1',captureSource:'canonical-complete-package',capturedManifest:{sha256:sha(canonicalRestoreRaw)},sources:roots.map((relative,index)=>({name:'root-'+index,liveRoot:'/private/restored-app/'+relative,directories:['nested','empty-kept'],files:[{key:'nested/real.bin',bytes:payload.length,sha256:sha(payload)}]}))});
 return {checkpointMetadataSha256:sha(raw(canonical(metadata))),metadata,canonicalRestoreRaw,baselineRaw,requestRoots:roots.map(relative=>({live:'/app/'+relative}))};
}
test('COMPLETE mapping preserves exact original bytes and nine root files without claiming v3 cuts',()=>{
 const input=sample(),result=deriveProtectedDirectoryComponents(input);
 assert.equal(result.format,'sabalan-original-protected-directory-restore/v1');assert.equal(result.rootBindings.length,9);
 assert.equal(result.canonicalRestoreOutputRawBase64,input.canonicalRestoreRaw.toString('base64'));assert.equal(result.baselineRawBase64,input.baselineRaw.toString('base64'));
 assert.equal(result.baselineSha256,sha(input.baselineRaw));assert.equal(Object.hasOwn(result,'captureId'),false);
 assert.deepEqual(result.rootBindings[6],{name:'root-6',sourceLiveRoot:'/app/uploads/images',payloadPrefix:'files/uploads/images',restoredLiveRoot:'/private/restored-app/uploads/images'});
});
test('changed extracted attachment, missing baseline root and wrong original restore hash refuse',()=>{
 for(const mutate of [value=>{value.sources[0].files[0].sha256='f'.repeat(64);},value=>value.sources.pop(),value=>{value.capturedManifest.sha256='0'.repeat(64);}]){
  const input=sample(),baseline=JSON.parse(input.baselineRaw);mutate(baseline);input.baselineRaw=raw(baseline);assert.throws(()=>deriveProtectedDirectoryComponents(input));
 }
});
test('unknown source root, duplicate name, directory traversal, duplicated directories and WAL relabel refuse',()=>{
 for(const mutate of [value=>{value.sources[0].liveRoot='/private/restored-app/foreign';},value=>{value.sources[0].name=value.sources[1].name;},value=>{value.sources[0].directories.push('../escape');},value=>{value.sources[0].directories.push('nested');}]){
  const input=sample(),baseline=JSON.parse(input.baselineRaw);mutate(baseline);input.baselineRaw=raw(baseline);assert.throws(()=>deriveProtectedDirectoryComponents(input));
 }
 const input=sample();input.metadata.captureMethod='ONLINE_COHERENT_WAL';input.checkpointMetadataSha256=sha(raw(canonical(input.metadata)));assert.throws(()=>deriveProtectedDirectoryComponents(input));
});
test('actual incomplete writer and retained-build producers remain incomplete despite diagnostic PASS',()=>{
 const main={passResult:true,writerCoverage:{remaining:['full-dispatch-issuance-and-authority','complete-writer-inventory'],startupOnly:[]}};
 const browser={passResult:true,actualCompiledPages:true,retainedBuilds:[{application:'erp'}]};const before=structuredClone({main,browser});
 const gaps=originalOnlineProducerGaps(main,browser);
 assert.deepEqual(gaps,['current-domain:writerCoverage.remaining','current-domain:actual-nine-domain-receipts','browser-24-hours:both-actual-retained-builds','browser-24-hours:original-routing-registry']);assert.deepEqual({main,browser},before);
});
test('parsed completion receipts and pure derivation output cannot mint or read authority tokens',()=>{
 const fake={format:'sabalan-original-role-qualification-completion/v1',originalControllers:[{code:0,signal:null}]};
 assert.throws(()=>assembleOriginalProtectedOnlineEvidence({localCompletion:fake,independentCompletion:{},protectedRequest:{},evidenceDirectory:'Z:/must-not-exist'}),/ORIGINAL_ROLE_COMPLETION_TOKEN_REQUIRED/);
 assert.throws(()=>assembleOriginalOnlineEvidence({localCompletion:fake,independentCompletion:{recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE'},onlineRequest:{},evidenceDirectory:'Z:/must-not-exist'}),/ORIGINAL_ROLE_COMPLETION_TOKEN_REQUIRED/);
 assert.throws(()=>readOriginalOnlineEvidenceAssembly(fake),/ORIGINAL_ONLINE_ASSEMBLY_TOKEN_REQUIRED/);
 assert.throws(()=>readOriginalOnlineEvidenceAssembly(deriveProtectedDirectoryComponents(sample())),/ORIGINAL_ONLINE_ASSEMBLY_TOKEN_REQUIRED/);
});
