import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {frozenUiRepackagingFormat,assertFrozenUiRepackaging} from './frozen-ui-repackaging.mjs';
import {qualifiedFrontendRuntimeBase} from './production-frontend-base-artifacts.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const read=file=>{const raw=fs.readFileSync(file);return {raw,value:JSON.parse(raw.toString('utf8')),sha256:sha(raw)};};
const points={
  old:{slotId:'frontend_retained',service:'frontend-retained',imageReceipt:'reports/qa/current-frontend-image-f1d2f35620e97112f093e3f2e8815027.json',
    bundleReceipt:'reports/qa/current-frontend-bundle-fa93e6481b00ee2bb70b1034030bce2d.json',
    image:'sha256:9df9eec8db41a96b86492a04f9d2e18767e9845e861329e6c8036c4e5b77cdb3'},
  new:{slotId:'frontend_candidate',service:'frontend-candidate',imageReceipt:'reports/qa/current-frontend-image-d754592e7d002635b0acc08189408e9b.json',
    bundleReceipt:'reports/qa/current-frontend-bundle-df8c728df7c54fc821da77d5d0de863b.json',
    image:'sha256:923340ff3fd7950f38c4188f9209e1006e4fc3105c49b325c4e1d00a5f4075ae'},
};
/** Verify complete immutable build receipts, every materialized byte and the
 * actual Docker config ID/layers. Mutable labels and tags grant no identity. */
export function collectApplicationUiArtifacts({root,capture,containers,inspectImage}){
  capture('scripts/lib/application-native-ui-artifacts.mjs');const artifacts={},proof={};
  for(const [name,point]of Object.entries(points)){
    const imageRaw=capture(point.imageReceipt),bundleRaw=capture(point.bundleReceipt);
    const image=JSON.parse(imageRaw),material=JSON.parse(bundleRaw);
    assert.ok(['sabalan-current-frontend-materialization/v1',frozenUiRepackagingFormat].includes(material.format));
    if(material.format===frozenUiRepackagingFormat){
      capture('scripts/lib/frozen-ui-repackaging.mjs');assertFrozenUiRepackaging(root,material);
      capture('reports/qa/'+material.repackaging.receipt);
      if(material.repackaging.imageReceipt)capture('reports/qa/'+material.repackaging.imageReceipt);
    }
    if(material.source.runtimeBase){
      capture('scripts/lib/production-frontend-base-artifacts.mjs');
      const base=qualifiedFrontendRuntimeBase(root,material.source.runtimeBase.receipt);
      assert.deepEqual(base,material.source.runtimeBase);assert.equal(base.baseImage,material.source.baseImage);
      capture('reports/qa/'+base.receipt);capture('reports/qa/'+base.source.transferReceipt);capture('reports/qa/'+base.source.exportReceipt);
      const baseReceipt=JSON.parse(fs.readFileSync(path.join(root,'reports/qa',base.receipt)));
      if(baseReceipt.originalFailedImportReceipt)capture('reports/qa/'+baseReceipt.originalFailedImportReceipt);
    }
    assert.equal(image.phase,'COMPLETE');assert.equal(image.pass,true);assert.equal(image.imageQualified,true);
    assert.equal(image.build.code,0);assert.equal(image.build.signal,null);assert.equal(image.outputImage.id,point.image);
    assert.equal(material.phase,'COMPLETE');assert.equal(material.sourceUnchanged,true);assert.equal(material.exactCopiedBytesVerified,true);
    assert.equal(image.materializationReceiptSha256,sha(bundleRaw));assert.equal(image.context,material.context);
    assert.equal(fs.realpathSync(image.context),path.resolve(image.context));
    const inventory={};
    function walk(directory,prefix=''){
      for(const entry of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
        assert.ok(!entry.isSymbolicLink());const relative=prefix+entry.name,file=path.join(directory,entry.name);
        if(entry.isDirectory())walk(file,relative+'/');else{
          assert.ok(entry.isFile());const before=fs.lstatSync(file,{bigint:true});assert.equal(before.nlink,1n);
          const raw=fs.readFileSync(file),after=fs.lstatSync(file,{bigint:true});
          for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(after[key],before[key]);
          inventory[relative]=sha(raw);
        }
      }
    }
    walk(image.context);assert.deepEqual(inventory,image.contextInventory);
    const manifest=read(path.join(image.context,'online-runtime-manifest.json'));
    assert.equal(manifest.sha256,image.manifestSha256);assert.equal(manifest.sha256,material.manifest.sha256);
    assert.equal(manifest.value.format,'sabalan-diagnostic-ui-bundle/v1');assert.equal(manifest.value.buildId,image.buildId);
    assert.equal(material.bundle.buildId,image.buildId);assert.equal(material.bundle.manifestSha256,image.manifestSha256);
    const actions=read(path.join(image.context,'runtime/server/server-reference-manifest.json')).value;
    const actionIds=[...new Set([...Object.keys(actions.node),...Object.keys(actions.edge)])].sort();
    // These two measured client-API builds have no Server Actions. A later build
    // with actions needs its own reviewed action registry, never an empty claim.
    assert.deepEqual(actionIds,[]);
    const actual=inspectImage(point.image);
    assert.equal(actual.Id,point.image);assert.deepEqual(actual.RootFS.Layers,image.outputImage.layers);
    assert.equal(containers[point.service].Image,point.image);
    assert.equal(containers[point.service].State.Health.Status,'healthy');
    assert.equal(containers[point.service].Config.Labels['com.docker.compose.project'],'sabalanerp-local');
    artifacts[name]={buildId:image.buildId,slotId:point.slotId,image:point.image,manifestSha256:image.manifestSha256,
      assets:material.bundle.assets,actionIds};
    proof[name]={imageReceiptSha256:sha(imageRaw),bundleReceiptSha256:sha(bundleRaw),contextInventorySha256:image.contextInventorySha256,
      image:point.image,buildId:image.buildId,manifestSha256:image.manifestSha256,actualContainerId:containers[point.service].Id,
      immutableImageLayersVerified:true,allMaterializedContextBytesVerified:true,serverActions:0};
  }
  return {artifacts,proof};
}
