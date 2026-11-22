import assert from 'node:assert/strict';
const hash=/^[a-f0-9]{64}$/,image=/^sha256:[a-f0-9]{64}$/;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const semantic=build=>({id:build.id,application:build.application,image:build.image,manifestSha256:build.manifestSha256,assets:build.assets,actionIds:build.actionIds});

/** Content selection only. The controller must obtain originals by reading its
 * own live token map through readOriginalInquiryCarrier; JSON cannot enroll an
 * actor or change its scope/release, and this function creates no authority. */
export function selectOriginalInquiryForRelease({releaseId,sourceCommit,runtimeBundleSha256,qualifiedBuild,originals}){
 assert.match(releaseId,/^[A-Za-z0-9_-]{8,128}$/);assert.match(sourceCommit,/^[a-f0-9]{40}$/);assert.match(runtimeBundleSha256,hash);
 assert.equal(qualifiedBuild?.application,'inquiry');assert.equal(typeof qualifiedBuild.id,'string');assert.ok(qualifiedBuild.id.length>0);
 assert.match(qualifiedBuild.image,image);assert.match(qualifiedBuild.manifestSha256,hash);assert.ok(Array.isArray(qualifiedBuild.assets)&&Array.isArray(qualifiedBuild.actionIds)&&Array.isArray(originals));
 const matching=originals.filter(row=>row.build?.id===qualifiedBuild.id);
 assert.ok(matching.length<=1,'ONLINE_INQUIRY_ORIGINAL_AMBIGUOUS');
 if(!matching.length)return {kind:'PREPARE_NEW',buildId:qualifiedBuild.id,runtimeId:null,releaseId,image:qualifiedBuild.image,manifestSha256:qualifiedBuild.manifestSha256};
 const row=matching[0],scope=row.scope,native=row.native;
 assert.deepEqual(canonical(semantic(row.build)),canonical(semantic(qualifiedBuild)),'ONLINE_INQUIRY_REUSE_BUILD_CHANGED');
 assert.ok(scope&&native&&native.originalReady===true,'ONLINE_INQUIRY_REUSE_NATIVE_REQUIRED');
 assert.match(scope.runtimeId,hash);assert.match(scope.releaseId,/^[A-Za-z0-9_-]{8,128}$/);assert.match(row.containerId,hash);assert.ok(Number.isFinite(Date.parse(row.startedAt)));
 assert.equal(scope.sourceCommit,sourceCommit,'ONLINE_INQUIRY_REUSE_SOURCE_CHANGED');assert.equal(scope.image,qualifiedBuild.image);assert.equal(scope.manifestSha256,runtimeBundleSha256);
 assert.equal(row.runtimeId,scope.runtimeId);assert.equal(row.image,scope.image);assert.equal(native.runtimeId,scope.runtimeId);assert.equal(native.image,scope.image);assert.equal(native.containerId,row.containerId);
 return {kind:'REUSE_ORIGINAL',buildId:qualifiedBuild.id,runtimeId:scope.runtimeId,releaseId:scope.releaseId,image:scope.image,manifestSha256:qualifiedBuild.manifestSha256};
}
