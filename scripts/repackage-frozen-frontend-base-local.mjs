import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {stableFrontendBaseFile,qualifiedFrontendRuntimeBase} from './lib/production-frontend-base-artifacts.mjs';
import {frozenUiRepackagingFormat,frozenUiContextInventory,assertFrozenUiRepackaging,originalFrozenUiMaterialization} from './lib/frozen-ui-repackaging.mjs';
const repository=path.resolve(import.meta.dirname,'..'),[priorName,baseReceipt]=process.argv.slice(2);
assert.equal(process.argv.length,4);assert.match(priorName,/^current-frontend-bundle-[a-f0-9]{32}\.json$/);
const original=originalFrozenUiMaterialization(repository,priorName),prior=original.prior;
const priorPath=path.join(repository,'reports/qa',priorName),receiptFile=original.provenance.receiptFile;
assert.equal(prior.phase,'COMPLETE');assert.equal(prior.exactCopiedBytesVerified,true);assert.equal(prior.sourceUnchanged,true);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
assert.deepEqual(frozenUiContextInventory(prior.context).inventory,original.inventory);
const runtimeBase=qualifiedFrontendRuntimeBase(repository,baseReceipt),id=randomBytes(16).toString('hex');
const root=path.resolve('D:/sabalanerp-online-qa/current-frontend-bundle-'+id),context=path.join(root,'context');
const evidence=path.join(repository,'reports/qa/current-frontend-bundle-'+id+'.json');
const result={format:frozenUiRepackagingFormat,id,root,context,phase:'INTENT',sourceKind:'previously-frozen-completed-ui',
  repackaging:original.provenance,productionAdmission:false,dockerExecuted:false,frontendRebuilt:false,
  currentFrontendSourcesAssertedUnchanged:false};
fs.writeFileSync(evidence.replace('.json','-intent.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(context,{mode:0o700});
try{
  for(const [relative,hash]of Object.entries(original.inventory)){
    assert.ok(!relative.split('/').some(v=>!v||v==='.'||v==='..'));const source=path.join(prior.context,relative);
    assert.equal(stableFrontendBaseFile(source).sha256,hash);const target=path.join(context,relative);
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL);
    assert.equal(stableFrontendBaseFile(target).sha256,hash);
  }
  const manifestPath=path.join(context,'online-runtime-manifest.json');
  const oldManifest=JSON.parse(fs.readFileSync(manifestPath));assert.equal(oldManifest.baseImage,prior.source.baseImage);
  assert.equal(oldManifest.buildId,prior.bundle.buildId);const bytes=Buffer.from(JSON.stringify({...oldManifest,baseImage:runtimeBase.baseImage})+'\n');
  fs.writeFileSync(manifestPath,bytes);const manifest=stableFrontendBaseFile(manifestPath);
  const observed=frozenUiContextInventory(context);
  const files=prior.source.files.map(file=>{const relative=file.relative.startsWith(prior.source.dist+'/')
    ?'runtime/'+file.relative.slice(prior.source.dist.length+1):file.relative;
    const source=path.join(prior.context,relative),actual=stableFrontendBaseFile(source);
    assert.equal(actual.sha256,file.sha256);return{relative:file.relative,source,...actual};});
  Object.assign(result,{phase:'COMPLETE',sourceUnchanged:true,exactCopiedBytesVerified:true,
    source:{operation:prior.source.operation,dist:prior.source.dist,buildId:prior.bundle.buildId,
      baseImage:runtimeBase.baseImage,buildBaseImage:prior.source.buildBaseImage??prior.source.baseImage,runtimeBase,files,
      originalHistoricalBuildSource:prior.source,helperFile:stableFrontendBaseFile(import.meta.filename)},
    bundle:{...prior.bundle,manifestSha256:manifest.sha256},manifest,contextInventory:observed.inventory,
    contextInventorySha256:sha(Buffer.from(JSON.stringify(observed.inventory))),contextBytes:observed.total});
  assert.deepEqual(frozenUiContextInventory(prior.context).inventory,original.inventory);
  assert.deepEqual(stableFrontendBaseFile(priorPath,4*1024**2),receiptFile);assertFrozenUiRepackaging(repository,result);
  fs.writeFileSync(evidence,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({phase:result.phase,evidence,buildId:result.bundle.buildId,baseImage:runtimeBase.baseImage,frontendRebuilt:false}));
}catch(error){Object.assign(result,{phase:'FAILED_HELD',error:error instanceof Error?error.message:'REPACKAGING_FAILED'});
  fs.writeFileSync(evidence,JSON.stringify(result,null,2)+'\n',{flag:'wx'});throw error;}
