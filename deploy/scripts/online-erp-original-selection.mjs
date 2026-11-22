import assert from 'node:assert/strict';
const hash=/^[a-f0-9]{64}$/,image=/^sha256:[a-f0-9]{64}$/;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const semantic=build=>({id:build.id,application:build.application,image:build.image,manifestSha256:build.manifestSha256,assets:build.assets,actionIds:build.actionIds,nativeBuildId:build.nativeBuildId,handoffPolicy:build.handoffPolicy});

/** Content selection only. Originals must come from the same controller's
 * private carrier tokens; this cannot enroll, relabel or recreate a frontend. */
export function selectOriginalErpForRelease({releaseId,sourceCommit,qualifiedBuild,originals}){
 assert.match(releaseId,/^[A-Za-z0-9_-]{8,128}$/);assert.match(sourceCommit,/^[a-f0-9]{40}$/);
 assert.equal(qualifiedBuild?.application,'erp');assert.match(qualifiedBuild.id,/^erp_[a-z0-9_-]{8,90}$/);
 assert.match(qualifiedBuild.image,image);assert.match(qualifiedBuild.manifestSha256,hash);
 assert.ok(Array.isArray(qualifiedBuild.assets)&&Array.isArray(qualifiedBuild.actionIds)&&Array.isArray(originals));
 const matches=originals.filter(row=>row.facts?.build?.id===qualifiedBuild.id);assert.ok(matches.length<=1,'ONLINE_ERP_ORIGINAL_AMBIGUOUS');
 if(!matches.length)return {kind:'PREPARE_NEW',buildId:qualifiedBuild.id,slotId:null,releaseId,image:qualifiedBuild.image,manifestSha256:qualifiedBuild.manifestSha256};
 const {facts,sourceCommit:originalSource}=matches[0];
 assert.deepEqual(canonical(semantic(facts.build)),canonical(semantic(qualifiedBuild)),'ONLINE_ERP_REUSE_BUILD_CHANGED');
 assert.equal(originalSource,sourceCommit,'ONLINE_ERP_REUSE_SOURCE_CHANGED');
 assert.equal(facts.kind,'frontend');assert.equal(facts.compiledBytesVerified,true);assert.equal(facts.originalHealthyObserved,true);
 assert.equal(facts.originalStartCode0,true);assert.equal(facts.readOnlyRootfs,true);assert.match(facts.runtimeId,hash);assert.match(facts.containerId,hash);
 assert.equal(facts.slotId,'frontend_'+facts.runtimeId);assert.equal(facts.image,qualifiedBuild.image);assert.ok(Number.isFinite(Date.parse(facts.startedAt)));
 assert.match(facts.releaseId,/^[A-Za-z0-9_-]{8,128}$/);
 return {kind:'REUSE_ORIGINAL',buildId:qualifiedBuild.id,slotId:facts.slotId,releaseId:facts.releaseId,image:facts.image,manifestSha256:qualifiedBuild.manifestSha256};
}
