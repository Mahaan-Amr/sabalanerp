import assert from 'node:assert/strict';
import test from 'node:test';
import {validateProductionExecutionBindings,productionImageInspectionSha256,type ProductionImageExecutionBindings,type OnlineImageGraph} from '../../backend/src/services/onlineImageExecutionBinding';
const roles=['backend','frontend','inquiry'] as const;
const image=(n:string)=>'sha256:'+n.repeat(64);
function fixture(store:'containerd'|'classic'='containerd'){
 const expected={releaseId:'actual_release_123',sourceHost:{machineUuidSha256:'1'.repeat(64),kernelBootIdSha256:'2'.repeat(64)},recoveryMachineUuidSha256:'3'.repeat(64),
  imageGraphs:{} as Record<typeof roles[number],OnlineImageGraph>,deploymentTargetImages:{} as Record<typeof roles[number],string>};
 const bindings={} as ProductionImageExecutionBindings;
 for(const [i,role]of roles.entries()){
  const graph={index:image(String(i+4)),platform:image('7'),config:image(String(i+1)),rootfsDiffIds:[image('8'),image('9')],archiveSha256:'a'.repeat(64),archiveBytes:10240};
  expected.imageGraphs[role]=graph;expected.deploymentTargetImages[role]=graph.config;
  const inspection={Id:store==='containerd'?graph.index:graph.config,Descriptor:store==='containerd'?{mediaType:'application/vnd.oci.image.index.v1+json',digest:graph.index,size:123}:null,
   RootFS:{Type:'layers' as const,Layers:[...graph.rootfsDiffIds]},Os:'linux' as const,Architecture:'amd64' as const,Config:{Labels:{'io.sabalan.source':'actual'}}};
  bindings[role]={format:'sabalan-production-image-execution-binding/v1',role,releaseId:expected.releaseId,sourceMachineUuidSha256:expected.sourceHost.machineUuidSha256,
   sourceKernelBootIdSha256:expected.sourceHost.kernelBootIdSha256,store,executionImageId:inspection.Id,graph:structuredClone(graph),nativeInspection:inspection,inspectionSha256:productionImageInspectionSha256(inspection)};
 }
 return {expected,bindings};
}
test('containerd INDEX execution and classic CONFIG execution bind the same canonical recovery content exactly',()=>{
 for(const store of ['containerd','classic'] as const){const {expected,bindings}=fixture(store),actual=validateProductionExecutionBindings(bindings,expected);
  for(const role of roles){assert.equal(actual[role],store==='containerd'?expected.imageGraphs[role].index:expected.imageGraphs[role].config);assert.equal(bindings[role].graph.config,expected.deploymentTargetImages[role]);}}
 const {expected}=fixture();assert.deepEqual(validateProductionExecutionBindings(undefined,expected),expected.deploymentTargetImages);
});
test('wrong native identity, store domain, full graph, host, operation and observation SHA all refuse',()=>{
 const mutations:Array<(f:ReturnType<typeof fixture>)=>void>=[
  f=>{f.bindings.backend.executionImageId=f.bindings.backend.graph.config;},f=>{f.bindings.backend.nativeInspection.Id=image('f');},
  f=>{f.bindings.backend.nativeInspection.Descriptor!.digest=f.bindings.backend.graph.config;},f=>{f.bindings.backend.nativeInspection.Descriptor!.mediaType='application/vnd.oci.image.manifest.v1+json';},
  f=>{f.bindings.backend.store='classic';},f=>{f.bindings.backend.graph.platform=image('f');},f=>{f.bindings.backend.graph.archiveSha256='f'.repeat(64);},
  f=>{f.bindings.backend.nativeInspection.RootFS.Layers.reverse();},f=>{f.bindings.backend.releaseId='other_release_123';},
  f=>{f.bindings.backend.sourceMachineUuidSha256='f'.repeat(64);},f=>{f.bindings.backend.sourceKernelBootIdSha256='f'.repeat(64);},
  f=>{for(const role of roles)f.bindings[role].sourceMachineUuidSha256=f.expected.recoveryMachineUuidSha256;},
  f=>{f.bindings.backend.inspectionSha256='f'.repeat(64);},f=>{f.bindings.backend.nativeInspection.Config.Labels!['io.sabalan.source']='changed';},
  f=>{(f.bindings.backend.nativeInspection as any).Env=['must-not-admit'];},f=>{(f.bindings as any).extra=f.bindings.backend;}
 ];
 for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>validateProductionExecutionBindings(f.bindings,f.expected));}
 const classic=fixture('classic');classic.bindings.backend.nativeInspection.Descriptor={mediaType:'application/vnd.oci.image.index.v1+json',digest:classic.bindings.backend.graph.index,size:123};
 classic.bindings.backend.inspectionSha256=productionImageInspectionSha256(classic.bindings.backend.nativeInspection);assert.throws(()=>validateProductionExecutionBindings(classic.bindings,classic.expected));
});
test('valid inspection hashes do not permit substituting another graph or host',()=>{
 for(const mutate of [
  (f:ReturnType<typeof fixture>)=>{f.bindings.backend.nativeInspection.Id=image('f');f.bindings.backend.executionImageId=image('f');f.bindings.backend.nativeInspection.Descriptor!.digest=image('f');},
  (f:ReturnType<typeof fixture>)=>{for(const role of roles)f.bindings[role].sourceMachineUuidSha256='f'.repeat(64);},
 ]){const f=fixture();mutate(f);for(const role of roles)f.bindings[role].inspectionSha256=productionImageInspectionSha256(f.bindings[role].nativeInspection);assert.throws(()=>validateProductionExecutionBindings(f.bindings,f.expected));}
});
