/** Exact native observations; content data alone never grants admission. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const equal=(a,b)=>assert.deepEqual(canonical(a),canonical(b));
export function sanitizeProductionImageInspection(actual){
 const descriptor=actual.Descriptor;
 return {Id:actual.Id,Descriptor:descriptor?{mediaType:descriptor.mediaType,digest:descriptor.digest,size:descriptor.size}:null,
  RootFS:{Type:actual.RootFS?.Type,Layers:actual.RootFS?.Layers},Os:actual.Os,Architecture:actual.Architecture,Config:{Labels:actual.Config?.Labels??null}};
}
export const productionInspectionSha256=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function productionImageStore(info){
 const status=Object.fromEntries(info.DriverStatus??[]);
 if(info.Driver==='overlayfs'&&status['driver-type']==='io.containerd.snapshotter.v1')return 'containerd';
 assert.equal(info.Driver,'overlay2','PRODUCTION_IMAGE_STORE_UNSUPPORTED');assert.ok(!status['driver-type']);return 'classic';
}
export function assertExecutionBindingSelection(binding,graph,executionImageId){
 assert.equal(binding.format,'sabalan-production-image-execution-binding/v1');equal(binding.graph,graph);
 assert.equal(binding.executionImageId,executionImageId);const observed=binding.nativeInspection;
 assert.equal(observed.Id,executionImageId);assert.equal(productionInspectionSha256(observed),binding.inspectionSha256);
 assert.equal(observed.Os,'linux');assert.equal(observed.Architecture,'amd64');assert.equal(observed.RootFS.Type,'layers');equal(observed.RootFS.Layers,graph.rootfsDiffIds);
 if(binding.store==='containerd'){
  assert.equal(executionImageId,graph.index);assert.equal(observed.Descriptor?.digest,graph.index);
  assert.ok(['application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json'].includes(observed.Descriptor?.mediaType));
  assert.ok(Number.isSafeInteger(observed.Descriptor.size)&&observed.Descriptor.size>0);
 }else{assert.equal(binding.store,'classic');assert.equal(executionImageId,graph.config);assert.equal(observed.Descriptor,null);}
 return executionImageId;
}
export function assertProductionImageInspection(binding,actual,graph){
 assertExecutionBindingSelection(binding,graph,actual.Id);equal(sanitizeProductionImageInspection(actual),binding.nativeInspection);
}
