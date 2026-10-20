import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizeProductionImageInspection,productionImageStore,productionInspectionSha256,assertExecutionBindingSelection,assertProductionImageInspection} from '../../deploy/scripts/production-image-execution-binding.mjs';
import {bindTargetBrowserImage} from '../../deploy/scripts/online-release-carriers.mjs';
const hash=value=>value.repeat(64),image=value=>'sha256:'+hash(value);
function fixture(store='containerd'){
 const graph={index:image('1'),platform:image('2'),config:image('3'),rootfsDiffIds:[image('4')],archiveSha256:hash('5'),archiveBytes:1234};
 const actual={Id:store==='containerd'?graph.index:graph.config,Descriptor:store==='containerd'?{mediaType:'application/vnd.oci.image.index.v1+json',digest:graph.index,size:856,annotations:{ignored:'native annotation'}}:null,RootFS:{Type:'layers',Layers:graph.rootfsDiffIds},Os:'linux',Architecture:'amd64',Config:{Labels:{source:'actual'},Env:['PRIVATE_VALUE=not-in-observation']}};
 const nativeInspection=sanitizeProductionImageInspection(actual),binding={format:'sabalan-production-image-execution-binding/v1',role:'frontend',store,executionImageId:actual.Id,graph,nativeInspection,inspectionSha256:productionInspectionSha256(nativeInspection)};
 return{graph,actual,binding};
}
test('native image store is measured explicitly and unsupported contexts fail closed',()=>{
 assert.equal(productionImageStore({Driver:'overlayfs',DriverStatus:[['driver-type','io.containerd.snapshotter.v1']]}),'containerd');
 assert.equal(productionImageStore({Driver:'overlay2',DriverStatus:[]}),'classic');
 assert.throws(()=>productionImageStore({Driver:'vfs'}));assert.throws(()=>productionImageStore({Driver:'overlayfs',DriverStatus:[]}));
});
test('observed production INDEX and classic CONFIG each bind to exactly one authenticated graph',()=>{
 for(const store of ['containerd','classic']){
  const {graph,actual,binding}=fixture(store);assert.equal(assertExecutionBindingSelection(binding,graph,actual.Id),actual.Id);assertProductionImageInspection(binding,actual,graph);
  const translated=bindTargetBrowserImage({image:graph.index,id:'erp_actual123'},'frontend',graph,actual.Id,binding);assert.equal(translated.build.image,actual.Id);assert.equal(translated.sourceBuild.image,graph.index);
  assert.ok(!JSON.stringify(binding.nativeInspection).includes('PRIVATE_VALUE'));
 }
});
test('changed original descriptor, content, role or native bytes cannot select another execution identity',()=>{
 for(const mutate of [
  value=>{value.actual.Id=value.graph.config;},value=>{value.actual.Descriptor.digest=image('f');},value=>{value.actual.Descriptor.size++;},value=>{value.actual.RootFS.Layers=[image('f')];},value=>{value.actual.Config.Labels.source='changed';},
 ]){const value=fixture();mutate(value);assert.throws(()=>assertProductionImageInspection(value.binding,value.actual,value.graph));}
 const {graph,actual,binding}=fixture();assert.throws(()=>assertExecutionBindingSelection(binding,{...graph,platform:image('f')},actual.Id));
 assert.throws(()=>bindTargetBrowserImage({image:graph.index},'inquiry',graph,actual.Id,binding));
 assert.throws(()=>bindTargetBrowserImage({image:graph.index},'frontend',graph,actual.Id));
});
