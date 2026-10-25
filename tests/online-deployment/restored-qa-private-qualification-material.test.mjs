import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import * as compiler from '../../scripts/lib/independent-private-qualification-material.mjs';
const {qualificationBytes}=compiler;
const sha=raw=>createHash('sha256').update(raw).digest('hex');
function fixture(){
  const qualificationId='1'.repeat(64),coord='/app/online-runtime-acceptance/application-native-'+'a'.repeat(32)+'/restored-coordination';
  const qualificationRoot=coord+'/private-qualifications/'+qualificationId+'/restored-app';
  const database={name:'qa_application_restored_'+'2'.repeat(32),systemIdentifier:'1234',oid:'987'};
  const runtime={entryPath:'/app/dist/onlinePrivateQualification.js',entrySha256:'3'.repeat(64),distTreeSha256:'4'.repeat(64),schemaSha256:'5'.repeat(64),clientInventorySha256:'6'.repeat(64)};
  const nextRuntime={...runtime,distTreeSha256:'c'.repeat(64),entrySha256:'d'.repeat(64),clientInventorySha256:'e'.repeat(64)};
  const config={image:'sha256:'+'7'.repeat(64),sourceCommit:'8'.repeat(40),privateQualificationRuntime:runtime,privateQualificationRuntimes:{main:runtime,candidate:nextRuntime},privateQualificationSourceCommits:{main:'8'.repeat(40),candidate:'f'.repeat(40)},roleTopology:{main:{host:'172.18.0.10',image:'sha256:'+'7'.repeat(64)},candidate:{host:'172.18.0.9',image:'sha256:'+'9'.repeat(64)}}};
  const grant=(purpose,id,role)=>{const material=config.privateQualificationRuntimes[role];const scope={format:'sabalan-online-runtime-scope/v2',runtimeId:id.repeat(64),nonce:'9'.repeat(64),
    role:purpose==='http'?'serving':'control',purpose,releaseId:'private-canonical-application',image:config.roleTopology[role].image,sourceCommit:config.privateQualificationSourceCommits[role],
    manifestSha256:material.distTreeSha256,coordinationDirectory:coord,gate:{device:'1',inode:'2',ownerUid:0},interlock:{device:'1',inode:'3',ownerUid:0},
    database:{name:database.name,systemIdentifier:database.systemIdentifier}};
    return{scope,sha256:sha(Buffer.concat([qualificationBytes(scope),Buffer.from('\n')]))};};
  const roots=Array.from({length:9},(_,n)=>({live:qualificationRoot+'/storage/root-'+n,store:qualificationRoot+'/.versioned-files/root-'+n,
    liveDevice:'1',liveInode:String(10+n),storeDevice:'1',storeInode:String(30+n),baselineSha256:String(n+1).repeat(64)}));
  const manifest={format:'sabalan-application-restored-file-baseline/v1',captureId:'c'.repeat(64),capturedManifest:{sha256:'d'.repeat(64)},
    sources:roots.map((r,n)=>({name:'root-'+n,liveRoot:r.live,storeRoot:r.store}))};
  const raw=Buffer.concat([qualificationBytes(manifest),Buffer.from('\n')]);
  const baselineCompletion={event:'restored-file-baseline-complete',runtimeId:'e'.repeat(64),captureId:manifest.captureId,
    manifestSha256:sha(raw),capturedManifestSha256:manifest.capturedManifest.sha256,
    proofs:roots.map((r,n)=>({name:'root-'+n,sha256:r.baselineSha256,publicOnlineAdmission:false}))};
  const index={sourceDatabaseRole:'EMPTY_ISOLATED_IDENTITY_OBSERVER',database:'qa_application_native_'+'f'.repeat(32),oid:'986',restoredDatabase:database.name,restoredOid:database.oid,schemaSha256:runtime.schemaSha256,
    restoredBaselineGrant:{scope:{runtimeId:baselineCompletion.runtimeId}},privateQualification:{qualificationId,qualificationRoot,runtimeBundleSha256:runtime.distTreeSha256,runtimeBundles:{main:runtime.distTreeSha256,candidate:nextRuntime.distTreeSha256},httpGrant:grant('http','a','main'),httpGrants:[grant('http','a','main'),grant('http','c','candidate')],oldJobsGrant:grant('jobs','d','main'),jobsGrant:grant('jobs','b','main')}};
  const facts={database,sql:{visible:true,sessions:0,prepared:0},qualificationRoot,runtime,candidateRuntime:nextRuntime,baselineCompletion,
    restoreManifestSha256:sha(raw),restoreManifestRawBase64:raw.toString('base64'),capturedManifestSha256:manifest.capturedManifest.sha256,roots,
    ephemeralRoots:['bi-reports','reports','sales-reports'].map(n=>qualificationRoot+'/storage/'+n),httpIngress:{bindHost:config.roleTopology.main.host,port:33111}};
  for(const key of ['httpGrants','oldJobsGrant','runtimeBundles'])delete index.privateQualification[key];
  delete config.privateQualificationRuntimes;delete config.privateQualificationSourceCommits;delete config.roleTopology.candidate;delete facts.candidateRuntime;
  return structuredClone({index,config,baselineCompletion,facts,now:'2026-10-20T00:00:00.000Z'});
}

function restored(){
 const v=fixture(),sourceDatabase={name:'production_source',oid:'1122',systemIdentifier:'9988'};
 v.facts.database.name='sabalan_checkpoint_verify_012345abcdef';v.index.restoredDatabase=v.facts.database.name;
 for(const grant of [v.index.privateQualification.httpGrant,v.index.privateQualification.jobsGrant]){grant.scope.database.name=v.facts.database.name;grant.sha256=sha(Buffer.concat([qualificationBytes(grant.scope),Buffer.from('\n')]));}
 const lineage={format:'sabalan-live-restored-qa-private-lineage/v1',sourceDatabase,targetDatabase:v.facts.database,
  completeManifestSha256:'d'.repeat(64),nativeHistorySha256:'a'.repeat(64),workingManifestSha256:'b'.repeat(64),
  cleanupPending:true,independentPointHealthy:false,productionAdmission:false};
 v.index.sourceDatabaseRole='VERIFIED_COMPLETE_RESTORED_QA';v.index.database=sourceDatabase.name;v.index.oid=sourceDatabase.oid;
 v.restoredQaLineage=lineage;
 const manifest=JSON.parse(Buffer.from(v.facts.restoreManifestRawBase64,'base64'));manifest.restoredQaLineage=lineage;
 const raw=Buffer.concat([qualificationBytes(manifest),Buffer.from('\n')]);v.facts.restoreManifestRawBase64=raw.toString('base64');
 v.baselineCompletion.manifestSha256=sha(raw);v.facts.baselineCompletion=v.baselineCompletion;v.facts.restoreManifestSha256=sha(raw);
 return v;
}
test('explicit restored QA data retains genuine different-cluster source lineage without healthy or public claims',()=>{
 const v=restored(),result=compiler.compileRestoredQaPrivateQualificationMaterial(v);
 assert.equal(result.format,'sabalan-original-restored-qa-private-material/v1');
 assert.deepEqual(result.restoredQaLineage,v.restoredQaLineage);assert.equal(result.cleanupPending,true);
 assert.equal(result.independentPointHealthy,false);assert.equal(result.productionAdmission,false);
 for(const decision of Object.values(result.decisionsByRuntime)){
  assert.deepEqual(decision.sourceDatabase,v.restoredQaLineage.sourceDatabase);assert.deepEqual(decision.database,v.facts.database);
  assert.notEqual(decision.sourceDatabase.systemIdentifier,decision.database.systemIdentifier);
 }
 assert.throws(()=>compiler.compileIndependentPrivateQualificationMaterial(v));
});
test('restored QA compiler rejects source-role laundering, unbound lineage and future cleanup claims',()=>{
 const changes=[v=>v.index.sourceDatabaseRole='EMPTY_ISOLATED_IDENTITY_OBSERVER',v=>v.restoredQaLineage.cleanupPending=false,
  v=>v.restoredQaLineage.independentPointHealthy=true,v=>v.restoredQaLineage.productionAdmission=true,
  v=>v.restoredQaLineage.targetDatabase={...v.facts.database,oid:'99'},v=>v.restoredQaLineage.sourceDatabase.oid='100',
  v=>v.restoredQaLineage.completeManifestSha256='e'.repeat(64),v=>v.restoredQaLineage.nativeHistorySha256='bad',
  v=>v.restoredQaLineage.workingManifestSha256='bad',v=>v.restoredQaLineage.extra=true,v=>v.restoredQaLineage.sourceDatabase.systemIdentifier=v.restoredQaLineage.targetDatabase.systemIdentifier];
 for(const change of changes){const v=restored();change(v);assert.throws(()=>compiler.compileRestoredQaPrivateQualificationMaterial(v));}
 const old=fixture();assert.throws(()=>compiler.compileRestoredQaPrivateQualificationMaterial(old));
 assert.equal(compiler.compileIndependentPrivateQualificationMaterial(old).actualHttpTargets,1);
});
