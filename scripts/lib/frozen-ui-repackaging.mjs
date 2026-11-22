import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {stableFrontendBaseFile,qualifiedFrontendRuntimeBase} from './production-frontend-base-artifacts.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const frozenUiRepackagingFormat='sabalan-frozen-frontend-repackaging/v1';
export function originalFrozenUiMaterialization(repository,receipt){
  assert.match(receipt,/^current-frontend-bundle-[a-f0-9]{32}\.json$/);
  const file=path.join(repository,'reports/qa',receipt),receiptFile=stableFrontendBaseFile(file,4*1024**2);
  const prior=JSON.parse(fs.readFileSync(file));assert.equal(prior.format,'sabalan-current-frontend-materialization/v1');
  assert.equal(prior.phase,'COMPLETE');assert.equal(prior.sourceUnchanged,true);assert.equal(prior.exactCopiedBytesVerified,true);
  if(prior.contextInventory){assert.equal(sha(Buffer.from(JSON.stringify(prior.contextInventory))),prior.contextInventorySha256);
    return{prior,inventory:prior.contextInventory,provenance:{receipt,receiptFile}};}
  // The first materializer predates inventory publication. Its actual completed
  // immutable image receipt independently records the entire measured context.
  assert.equal(receipt,'current-frontend-bundle-e1c4ea205818116fa0c550dae3328d39.json');
  const imageReceipt='current-frontend-image-a0d91677d0bb07955be5541f74b9caee.json';
  const imagePath=path.join(repository,'reports/qa',imageReceipt),imageReceiptFile=stableFrontendBaseFile(imagePath,4*1024**2);
  const image=JSON.parse(fs.readFileSync(imagePath));assert.equal(image.phase,'COMPLETE');assert.equal(image.pass,true);
  assert.equal(image.imageQualified,true);assert.equal(image.build.code,0);assert.equal(image.build.signal,null);
  assert.equal(image.materializationReceiptSha256,receiptFile.sha256);assert.equal(image.context,prior.context);
  assert.equal(image.buildId,prior.bundle.buildId);assert.equal(image.manifestSha256,prior.bundle.manifestSha256);
  assert.equal(sha(Buffer.from(JSON.stringify(image.contextInventory))),image.contextInventorySha256);
  return{prior,inventory:image.contextInventory,provenance:{receipt,receiptFile,imageReceipt,imageReceiptFile}};
}
export function frozenUiContextInventory(directory){
  assert.equal(fs.realpathSync(directory),path.resolve(directory));const inventory={};let total=0;
  function walk(root,prefix=''){for(const name of fs.readdirSync(root).sort()){
    const file=path.join(root,name),relative=prefix+name,stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink());
    if(stat.isDirectory())walk(file,relative+'/');else{assert.ok(stat.isFile());const actual=stableFrontendBaseFile(file,256*1024**2);
      total+=actual.bytes;assert.ok(total<=256*1024**2&&Object.keys(inventory).length<20000);inventory[relative]=actual.sha256;}}}
  walk(directory);return{inventory,total};
}
export function assertFrozenUiRepackaging(repository,material){
  assert.equal(material.format,frozenUiRepackagingFormat);assert.equal(material.sourceKind,'previously-frozen-completed-ui');
  const source=material.repackaging;
  const original=originalFrozenUiMaterialization(repository,source.receipt),prior=original.prior;
  assert.deepEqual(source,original.provenance);
  const runtimeBase=qualifiedFrontendRuntimeBase(repository,material.source.runtimeBase.receipt);
  assert.deepEqual(runtimeBase,material.source.runtimeBase);assert.equal(material.source.baseImage,runtimeBase.baseImage);
  assert.equal(material.source.buildBaseImage,prior.source.buildBaseImage??prior.source.baseImage);
  assert.equal(material.source.dist,prior.source.dist);assert.equal(material.bundle.buildId,prior.bundle.buildId);
  const withoutManifest=inventory=>Object.fromEntries(Object.entries(inventory).filter(([name])=>name!=='online-runtime-manifest.json'));
  assert.deepEqual(withoutManifest(material.contextInventory),withoutManifest(original.inventory));
  const oldManifestPath=path.join(prior.context,'online-runtime-manifest.json');
  assert.equal(stableFrontendBaseFile(oldManifestPath).sha256,prior.bundle.manifestSha256);
  const oldManifest=JSON.parse(fs.readFileSync(oldManifestPath));
  const expected=Buffer.from(JSON.stringify({...oldManifest,baseImage:runtimeBase.baseImage})+'\n');
  assert.equal(sha(expected),material.bundle.manifestSha256);
  assert.equal(material.contextInventory['online-runtime-manifest.json'],sha(expected));
  assert.deepEqual(material.bundle.assets,prior.bundle.assets);
  assert.deepEqual(material.source.files.map(({relative,sha256})=>({relative,sha256})),
    prior.source.files.map(({relative,sha256})=>({relative,sha256})));
  return prior;
}
