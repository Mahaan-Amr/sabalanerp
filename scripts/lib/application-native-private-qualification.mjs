import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export const canonicalQualification=value=>Array.isArray(value)?value.map(canonicalQualification):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonicalQualification(value[key])])):value;
export const qualificationBytes=value=>Buffer.from(JSON.stringify(canonicalQualification(value)));
const same=(a,b)=>assert.deepEqual(a,b);
const confined=(parent,file)=>{const relative=path.posix.relative(parent,file);assert.ok(relative&&!relative.startsWith('../')&&relative!=='..'&&!path.posix.isAbsolute(relative));};
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

/** Data compiler only: it owns no key, issues no capability, starts no runtime.
 * The original broker must independently bind these observations to its actual
 * completed baseline actor/observer and original image before signing bytes.
 */
export function compilePrivateQualificationMaterial({index,config,baselineCompletion,facts,now}){
  const pair=index.privateQualification;
  assert.ok(pair&&hex(pair.qualificationId)&&hex(pair.runtimeBundleSha256));
  assert.ok(Array.isArray(pair.httpGrants)&&pair.httpGrants.length===2);
  same(pair.httpGrant,pair.httpGrants[0]);
  const grants=[...pair.httpGrants,pair.oldJobsGrant,pair.jobsGrant];
  assert.equal(grants.length,4);
  same(grants[0].scope.releaseId,grants[1].scope.releaseId);
  same(grants[0].scope.gate,grants[1].scope.gate);same(grants[0].scope.interlock,grants[1].scope.interlock);
  const database={name:index.restoredDatabase,systemIdentifier:grants[0].scope.database.systemIdentifier,oid:String(index.restoredOid)};
  const sourceDatabase={name:index.database,systemIdentifier:database.systemIdentifier,oid:String(index.oid)};
  assert.notEqual(database.name,sourceDatabase.name);assert.notEqual(database.oid,sourceDatabase.oid);
  assert.match(database.name,/^qa_application_restored_[a-f0-9]{32}$/);
  assert.match(sourceDatabase.name,/^qa_application_native_[a-f0-9]{32}$/);
  same(facts.database,database);same(facts.sql,{visible:true,sessions:0,prepared:0});
  assert.equal(facts.qualificationRoot,pair.qualificationRoot);
  const runtimes=config.privateQualificationRuntimes;
  assert.ok(runtimes?.main&&runtimes?.candidate);
  const material=runtimes.main;
  same(material.entryPath,'/app/dist/onlinePrivateQualification.js');
  assert.ok([material.entrySha256,material.distTreeSha256,material.schemaSha256,material.clientInventorySha256].every(hex));
  same(material.distTreeSha256,pair.runtimeBundleSha256);same(runtimes.candidate.schemaSha256,index.schemaSha256);
  same(pair.runtimeBundles,{main:material.distTreeSha256,candidate:runtimes.candidate.distTreeSha256});
  same(facts.candidateRuntime,runtimes.candidate);
  same(facts.runtime,material);
  assert.equal(baselineCompletion.event,'restored-file-baseline-complete');
  assert.equal(baselineCompletion.runtimeId,index.restoredBaselineGrant.scope.runtimeId);
  same(facts.baselineCompletion,baselineCompletion);
  assert.ok(hex(baselineCompletion.captureId)&&hex(baselineCompletion.manifestSha256)&&hex(baselineCompletion.capturedManifestSha256));
  same(facts.restoreManifestSha256,baselineCompletion.manifestSha256);
  same(facts.capturedManifestSha256,baselineCompletion.capturedManifestSha256);
  assert.equal(typeof facts.restoreManifestRawBase64,'string');
  const manifestBytes=Buffer.from(facts.restoreManifestRawBase64,'base64');
  assert.ok(manifestBytes.length>0&&manifestBytes.length<=8*1024**2);
  same(manifestBytes.toString('base64'),facts.restoreManifestRawBase64);
  same(sha(manifestBytes),baselineCompletion.manifestSha256);
  const manifest=JSON.parse(manifestBytes);
  same(manifest.format,'sabalan-application-restored-file-baseline/v1');
  same(manifest.captureId,baselineCompletion.captureId);
  same(manifest.capturedManifest.sha256,baselineCompletion.capturedManifestSha256);
  same(manifest.sources.length,9);
  assert.equal(facts.roots.length,9);assert.equal(baselineCompletion.proofs.length,9);
  assert.equal(new Set(facts.roots.map(value=>value.live)).size,9);
  assert.equal(new Set(facts.roots.map(value=>value.store)).size,9);
  for(const root of facts.roots){
    same(Object.keys(root).sort(),['live','store','liveDevice','liveInode','storeDevice','storeInode','baselineSha256'].sort());
    confined(pair.qualificationRoot,root.live);confined(pair.qualificationRoot,root.store);
    assert.ok([root.liveDevice,root.liveInode,root.storeDevice,root.storeInode].every(value=>typeof value==='string'&&/^[1-9][0-9]*$/.test(value)));
    assert.ok(hex(root.baselineSha256));
    const sources=manifest.sources.filter(source=>source.liveRoot===root.live&&source.storeRoot===root.store);
    same(sources.length,1);
    const proofs=baselineCompletion.proofs.filter(proof=>proof.name===sources[0].name);
    same(proofs.length,1);same(proofs[0].sha256,root.baselineSha256);same(proofs[0].publicOnlineAdmission,false);
  }
  same([...facts.ephemeralRoots].sort(),['bi-reports','reports','sales-reports'].map(name=>pair.qualificationRoot+'/storage/'+name).sort());
  same(Object.keys(facts.httpIngress).sort(),['bindHost','port']);same(facts.httpIngress.bindHost,config.roleTopology.main.host);
  assert.ok(Number.isInteger(facts.httpIngress.port)&&facts.httpIngress.port>=1024&&facts.httpIngress.port<=65535);
  const targets=grants.filter(grant=>grant.scope.purpose==='http').map(grant=>({runtimeId:grant.scope.runtimeId,
    nonceSha256:sha(Buffer.from(grant.scope.nonce)),releaseId:grant.scope.releaseId,imageIdentity:grant.scope.image,scopeSha256:grant.sha256}));
  assert.equal(targets.length,2);
  assert.equal(new Set(targets.map(target=>target.imageIdentity)).size,2);
  targets.sort((a,b)=>a.runtimeId.localeCompare(b.runtimeId));
  const targetsSha256=sha(qualificationBytes(targets));
  const issuedAt=new Date(now).toISOString(),expiresAt=new Date(Date.parse(issuedAt)+600_000).toISOString();
  const artifactsByRuntime={},decisionsByRuntime={};
  for(const [ordinal,grant]of grants.entries()){
    assert.ok(hex(grant.sha256)&&hex(grant.scope.runtimeId));
    same(grant.sha256,sha(Buffer.concat([qualificationBytes(grant.scope),Buffer.from('\n')])));
    same(grant.scope.database,{name:database.name,systemIdentifier:database.systemIdentifier});
    const role=[0,2].includes(ordinal)?'main':'candidate',runtime=runtimes[role];
    same(grant.scope.manifestSha256,runtime.distTreeSha256);
    same(grant.scope.image,config.roleTopology[role].image);same(grant.scope.sourceCommit,config.privateQualificationSourceCommits[role]);
    same(grant.scope.purpose,ordinal<2?'http':'jobs');same(grant.scope.role,ordinal<2?'serving':'control');
    same(pair.qualificationRoot,path.posix.join(grant.scope.coordinationDirectory,'private-qualifications',pair.qualificationId,'restored-app'));
    const artifacts={format:'sabalan-online-private-qualification-artifacts/v1',qualificationId:pair.qualificationId,
      releaseId:grant.scope.releaseId,image:grant.scope.image,sourceCommit:grant.scope.sourceCommit,
      runtimeBundleSha256:runtime.distTreeSha256,generation:1,database,restoreManifestSha256:facts.restoreManifestSha256,
      qualificationRoot:pair.qualificationRoot,targetsSha256,targets,roots:facts.roots,ephemeralRoots:facts.ephemeralRoots};
    const decision={format:'sabalan-online-private-qualification-decision/v1',purpose:'private-qualification',
      qualificationId:pair.qualificationId,scopeSha256:grant.sha256,runtimeId:grant.scope.runtimeId,
      nonceSha256:sha(Buffer.from(grant.scope.nonce)),runtimePurpose:grant.scope.purpose,role:grant.scope.role,
      releaseId:grant.scope.releaseId,image:grant.scope.image,sourceCommit:grant.scope.sourceCommit,
      runtimeBundleSha256:runtime.distTreeSha256,artifactsSha256:sha(qualificationBytes(artifacts)),
      restoreManifestSha256:facts.restoreManifestSha256,database,sourceDatabase,
      httpIngress:ordinal<2?{bindHost:config.roleTopology[role].host,port:ordinal===0?facts.httpIngress.port:5000}:null,issuedAt,expiresAt};
    artifactsByRuntime[grant.scope.runtimeId]=artifacts;decisionsByRuntime[grant.scope.runtimeId]=decision;
  }
  return freeze({format:'sabalan-original-private-qualification-material/v1',productionAdmission:false,
    artifactsByRuntime,decisionsByRuntime,targets,targetsSha256,restoreManifestSha256:facts.restoreManifestSha256,
    baselineRuntimeId:baselineCompletion.runtimeId,actualHttpTargets:targets.length});
}
