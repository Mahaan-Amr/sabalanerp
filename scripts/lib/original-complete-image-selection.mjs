/** Content identities and observed store identities are separate facts. The
 * caller supplies an authenticated archive graph and a fresh original inspect;
 * this pure join never grants runtime or image-retrieval authority. */
import assert from 'node:assert/strict';
export function bindOriginalCompleteImage({graph,container,sourceCommit,store}){
 assert.match(sourceCommit,/^[a-f0-9]{40}$/);
 for(const name of ['index','platform','config'])assert.match(graph[name],/^sha256:[a-f0-9]{64}$/);
 assert.ok(Array.isArray(graph.rootfsDiffIds)&&graph.rootfsDiffIds.length>0);
 for(const digest of graph.rootfsDiffIds)assert.match(digest,/^sha256:[a-f0-9]{64}$/);
 assert.match(graph.archiveSha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(graph.archiveBytes)&&graph.archiveBytes>0);
 assert.match(container.Id,/^[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(container.State.StartedAt)));assert.equal(container.State.Running,true);
 if(store==='containerd'){
  assert.equal(container.Image,graph.index,'COMPLETE_CONTAINERD_INDEX_MISMATCH');
  assert.equal(container.ImageManifestDescriptor?.digest,graph.platform,'COMPLETE_PLATFORM_DESCRIPTOR_MISMATCH');
  assert.ok(['application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json'].includes(container.ImageManifestDescriptor.mediaType));
  assert.ok(Number.isSafeInteger(container.ImageManifestDescriptor.size)&&container.ImageManifestDescriptor.size>0);
  assert.deepEqual(container.ImageManifestDescriptor.platform,{architecture:'amd64',os:'linux'});
 }else{
  assert.equal(store,'classic');assert.equal(container.Image,graph.config,'COMPLETE_CLASSIC_CONFIG_MISMATCH');
  assert.equal(container.ImageManifestDescriptor,undefined);
 }
 return Object.freeze({image:graph.config,sourceCommit,executionImage:container.Image,store,
  containerId:container.Id,startedAt:container.State.StartedAt,index:graph.index,platform:graph.platform,config:graph.config});
}
