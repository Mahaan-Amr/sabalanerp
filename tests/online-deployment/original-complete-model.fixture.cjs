'use strict';
// MODELED data-only evidence. No genuine restore, original token or admission.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const R=path.resolve(__dirname,'../..');
const esbuild=require(path.join(R,'backend/node_modules/esbuild'));
const target=path.join(R,'backend/src/services/onlineQualificationEvidence.ts');
async function kernel(){
 const out=await esbuild.build({stdin:{contents:`export {assertOnlineQualificationProof} from ${JSON.stringify(target)};export * from ${JSON.stringify(path.join(R,'tests/online-deployment/online-qualification-evidence.fixture.ts'))};`,resolveDir:R,loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',target:'node18'});
 const module={exports:{}};new Function('require','module','exports',out.outputFiles[0].text)(require,module,module.exports);return module.exports;
}
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v))+'\n'),sha=v=>createHash('sha256').update(v).digest('hex'),vh=v=>sha(bytes(v)),b64=v=>bytes(v).toString('base64');
function fixture(k){
 const base={manifestSha256:'1'.repeat(64),checkpointSha256:'2'.repeat(64),checkpointArchiveChecksum:'f'.repeat(64),releaseId:'unit_release',sourceCommit:'3'.repeat(40),runtimeBundleSha256:'4'.repeat(64),schemaSha256:'5'.repeat(64),captureId:'6'.repeat(64),sourceDatabase:{name:'unit_source',systemIdentifier:'123',oid:'42'},deploymentTargetDatabase:{name:'production_database',systemIdentifier:'456',oid:'77'},recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE',deploymentTargetImages:{backend:'sha256:'+'a'.repeat(64),frontend:'sha256:'+'b'.repeat(64),inquiry:'sha256:'+'c'.repeat(64)},images:{backend:'sha256:'+'7'.repeat(64),frontend:'sha256:'+'8'.repeat(64),inquiry:'sha256:'+'9'.repeat(64)}};
 const binding={...base,imageGraphs:k.syntheticQualificationImageGraphs(base.images,base.deploymentTargetImages),...k.syntheticQualificationIdentities(base)};
 const http=binding.runtimeCohorts['coherent-independent-restore'][0];binding.runtimeCohorts['coherent-independent-restore']=[{...http,runtimeId:'d'.repeat(64),purpose:'jobs'},http];
 binding.checkpointSha256=sha(Buffer.from(JSON.stringify(canonical(k.syntheticCheckpointMetadata(binding)))));
 const source=k.syntheticQualificationProof('coherent-independent-restore',binding);
 return{binding,source};
}
function live(k,padding=0){
 const v=fixture(k),s=v.source,p=s.protectedDirectoryComponents,oldBaseline=JSON.parse(Buffer.from(p.baselineRawBase64,'base64')),restore=JSON.parse(Buffer.from(p.canonicalRestoreOutputRawBase64,'base64'));
 const history=JSON.stringify(Array.from({length:440},(_,i)=>({id:'modeled-row-'+i+'x'.repeat(padding)}))),database=s.restoredDatabase;
 const baseline={...oldBaseline,captureSource:'live-verified-complete-restored-qa'};
 const produced=require('./live-restored-directory-lineage.fixture.cjs').produce(s.checkpointMetadata.manifest,{database,sourceDatabase:s.checkpointMetadata.sourceDatabase,sourceManifestValueSha256:sha(Buffer.from(JSON.stringify(s.checkpointMetadata.manifest)))},history,baseline.sources);
 baseline.restoredQaLineage=produced.lineage;
 baseline.capturedManifest={path:'/unit/original-live-complete-input.json',sha256:baseline.restoredQaLineage.completeManifestSha256};
 const baselineRaw=bytes(baseline),native=s.originalNativeClosures[0];
 const completion={event:'restored-file-baseline-complete',runtimeId:native.runtimeId,captureId:v.binding.captureId,manifestSha256:sha(baselineRaw),capturedManifestSha256:baseline.capturedManifest.sha256,proofs:baseline.sources.map(r=>({name:r.name,sha256:'a'.repeat(64),publicOnlineAdmission:false})),productionAdmission:false};
 const baselineOriginal={format:'sabalan-original-independent-private-runtime/v1',event:'CLOSED',mode:'baseline',result:completion,originalPopenPid:native.originalPopenPid,originalReturncode:0,...Object.fromEntries(['nativeRawBase64','workRawBase64','workClaimRawBase64','workScopeRawBase64'].map(key=>[key,native[key]]))};
 const proof={format:'sabalan-private-native-complete-ledger439-proof/v1',database,cleanupPending:true,productionAdmission:false,sourceAuthorityAuthenticated:false,nativeRowsCompared:440,activeRows:439,rollbackRows:1,sourceCatalogMigrations:444,rawHistoryJson:history,rawHistorySha256:sha(history),originalRestore:{format:'sabalan-owned-native-recovery-command/v1',originalPid:987,code:0,signal:null,stdoutEof:true,stderrEof:true,killed:false}};
 const session='c'.repeat(64),frames=[{format:'sabalan-original-active-restored-qa-hr-request/v1',event:'HR_REQUEST',session,sequence:1,manifest:s.checkpointMetadata.manifest,targetDatabase:database,proof},{format:'sabalan-original-active-restored-qa-hr-drained/v1',event:'CALLBACK_DRAINED',session,sequence:2},{format:'sabalan-original-active-restored-qa-result/v1',event:'RESTORE_RESULT',session,sequence:3,result:{format:'sabalan-strict-local-complete-validation/v1',strictCompleteValidationSucceeded:true,databaseAbsent:true,baseClientFinallyDisconnected:true,productionAdmission:false,financialSchemaQualified:false,absence:{visible:true,name:database.name,oid:null,systemIdentifier:database.systemIdentifier,sessions:0,transactions:0,prepared:0}}}];
 const workerRaw=Buffer.concat(frames.map(bytes)),worker={format:'sabalan-original-protected-financial-closure/v1',originalPid:222,code:0,signal:null,stdoutEof:true,stderrEof:true,observationFault:null,killed:false,stdoutSha256:sha(workerRaw),stderrSha256:sha(Buffer.alloc(0)),stdoutRawBase64:workerRaw.toString('base64'),stderrRawBase64:'',workerSourceSha256:'8'.repeat(64),controllerSourceSha256:'9'.repeat(64)};
 const ownerResult={format:'sabalan-owned-complete-transfer-strict-restore/v1',strictCompleteValidationSucceeded:true,temporaryTransferRetired:true,localJobRetired:true,productionAdmission:false,protectedFinancialQualification:{binding:{sourceDatabase:baseline.restoredQaLineage.sourceDatabase,restoredDatabase:database,sourceCommit:s.sourceCommit,workerSourceSha256:worker.workerSourceSha256,controllerSourceSha256:worker.controllerSourceSha256}}};
 const ownerRaw=bytes(ownerResult),ownerStdout=bytes({file:'/private/modeled-result.json',sha256:sha(ownerRaw)});
 const owner={format:'sabalan-original-existing-compose-complete-owner/v1',originalPid:333,code:0,signal:null,stdoutEof:true,stderrEof:true,observationFault:null,killed:false,interrupted:false,stdoutSha256:sha(ownerStdout),stdoutBytes:ownerStdout.length,stderrSha256:sha(Buffer.alloc(0)),stderrBytes:0,startedAt:restore.drill.startedAt,closedAt:restore.drill.completedAt};
 const ownerClosure=bytes(owner);Object.assign(restore,{format:'sabalan-original-existing-compose-complete-restore/v1',originalBaselineSha256:sha(baselineRaw),finalOwnerResultSha256:sha(ownerRaw),finalOwnerClosureSha256:sha(ownerClosure),finalWorkerStdoutSha256:sha(workerRaw)});
 Object.assign(p,{format:'sabalan-original-live-restored-qa-directory-restore/v1',canonicalRestoreOutputRawBase64:b64(restore),baselineRawBase64:baselineRaw.toString('base64'),baselineSha256:sha(baselineRaw),liveFinalJoin:{format:'sabalan-original-live-restored-qa-final-join/v1',completeManifestValueRawBase64:produced.completeManifestValueRaw.toString('base64'),workingManifestValueRawBase64:produced.workingManifestValueRaw.toString('base64'),baselineCompletion:completion,baselineOriginalRawBase64:b64(baselineOriginal),baselineNativeSha256:sha(Buffer.from(native.nativeRawBase64,'base64')),workerStdoutRawBase64:workerRaw.toString('base64'),workerOriginalRawBase64:b64(worker),ownerResultRawBase64:ownerRaw.toString('base64'),ownerOriginalRawBase64:ownerClosure.toString('base64'),ownerStdoutRawBase64:ownerStdout.toString('base64')}});
 return v;
}

module.exports={kernel,live};
