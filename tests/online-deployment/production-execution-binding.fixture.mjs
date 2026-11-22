/** Synthetic content observations only. Never an original request/completion. */
import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export function syntheticProductionExecution(request,store='containerd'){
 const bindings={},imageGraphs={},images={};
 for(const [i,role]of ['backend','frontend','inquiry'].entries()){
  const graph={index:'sha256:'+String(i+1).repeat(64),platform:'sha256:'+'4'.repeat(64),config:'sha256:'+String(i+5).repeat(64),rootfsDiffIds:['sha256:'+'8'.repeat(64)],archiveSha256:'9'.repeat(64),archiveBytes:10240};
  const nativeInspection={Id:store==='containerd'?graph.index:graph.config,Descriptor:store==='containerd'?{mediaType:'application/vnd.oci.image.index.v1+json',digest:graph.index,size:123}:null,
   RootFS:{Type:'layers',Layers:[...graph.rootfsDiffIds]},Os:'linux',Architecture:'amd64',Config:{Labels:null}};
  bindings[role]={format:'sabalan-production-image-execution-binding/v1',role,releaseId:request.releaseId,sourceMachineUuidSha256:request.checkpoint.sourceMachineUuidSha256,
   sourceKernelBootIdSha256:request.checkpoint.sourceKernelBootIdSha256,store,executionImageId:nativeInspection.Id,graph,nativeInspection,
   inspectionSha256:createHash('sha256').update(JSON.stringify(canonical(nativeInspection))).digest('hex')};
  imageGraphs[role]=structuredClone(graph);images[role]=graph.config;
 }
 return {bindings,independent:{imageGraphs,images}};
}
