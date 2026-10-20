import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {compilePrivateQualificationMaterial,qualificationBytes} from '../../scripts/lib/application-native-private-qualification.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
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
  const index={database:'qa_application_native_'+'f'.repeat(32),oid:'986',restoredDatabase:database.name,restoredOid:database.oid,schemaSha256:runtime.schemaSha256,
    restoredBaselineGrant:{scope:{runtimeId:baselineCompletion.runtimeId}},privateQualification:{qualificationId,qualificationRoot,runtimeBundleSha256:runtime.distTreeSha256,runtimeBundles:{main:runtime.distTreeSha256,candidate:nextRuntime.distTreeSha256},httpGrant:grant('http','a','main'),httpGrants:[grant('http','a','main'),grant('http','c','candidate')],oldJobsGrant:grant('jobs','d','main'),jobsGrant:grant('jobs','b','candidate')}};
  const facts={database,sql:{visible:true,sessions:0,prepared:0},qualificationRoot,runtime,candidateRuntime:nextRuntime,baselineCompletion,
    restoreManifestSha256:sha(raw),restoreManifestRawBase64:raw.toString('base64'),capturedManifestSha256:manifest.capturedManifest.sha256,roots,
    ephemeralRoots:['bi-reports','reports','sales-reports'].map(n=>qualificationRoot+'/storage/'+n),httpIngress:{bindHost:config.roleTopology.main.host,port:33111}};
  return structuredClone({index,config,baselineCompletion,facts,now:'2026-10-20T00:00:00.000Z'});
}
test('material binds actual independent restore identity and binds two distinct original HTTP images',()=>{
  const result=compilePrivateQualificationMaterial(fixture());
  assert.equal(result.productionAdmission,false);assert.equal(result.actualHttpTargets,2);
  assert.equal(Object.isFrozen(result),true);
  assert.equal(Object.keys(result.decisionsByRuntime).length,4);
  for(const [id,decision]of Object.entries(result.decisionsByRuntime)){
    assert.equal(decision.artifactsSha256,sha(qualificationBytes(result.artifactsByRuntime[id])));
    assert.notEqual(decision.database.name,decision.sourceDatabase.name);
    assert.equal(Date.parse(decision.expiresAt)-Date.parse(decision.issuedAt),600_000);
  }
});
test('refuses cross-source, unclosed SQL, substituted roots, baseline, image and ingress material',()=>{
  const changes=[
    v=>{v.facts.database.oid='1';},v=>{v.facts.sql.sessions=1;},v=>{v.facts.sql.prepared=1;},v=>{v.facts.sql.visible=false;},
    v=>{v.facts.roots.pop();},v=>{v.facts.roots[0].live='/app/unrelated';},v=>{v.facts.roots[0].baselineSha256='0'.repeat(64);},
    v=>{v.facts.roots[0].store=v.facts.roots[1].store;},v=>{v.facts.restoreManifestRawBase64=Buffer.from('{}').toString('base64');},
    v=>{v.facts.baselineCompletion.runtimeId='0'.repeat(64);},v=>{v.index.privateQualification.httpGrant.scope.image='sha256:'+'0'.repeat(64);},
    v=>{v.index.privateQualification.jobsGrant.scope.purpose='http';},v=>{v.config.privateQualificationRuntimes.candidate.schemaSha256='0'.repeat(64);},
    v=>{v.facts.httpIngress.bindHost='172.18.0.11';},v=>{v.facts.httpIngress.port=80;},v=>{v.facts.ephemeralRoots[0]='/tmp/shared';},
  ];
  for(const change of changes){const value=fixture();change(value);assert.throws(()=>compilePrivateQualificationMaterial(value));}
});
