import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {compileBrowserRoutingRegistry,selectBrowserRelease,browserRoutingIdentity} from '../../deploy/scripts/browser-release-routing.mjs';
import {compileApiRoutingRegistry,selectApiRelease} from '../../deploy/scripts/api-release-routing.mjs';
import {createApiReleaseProxy} from '../../deploy/scripts/browser-release-proxy.mjs';
import {BrowserOperationJournal} from '../../deploy/scripts/browser-operation-journal.mjs';

const nativeBuildId='B3FQSLBH439Vaf6knWbsb';
const id='erp_legacy_'+createHash('sha256').update(nativeBuildId).digest('hex');
function input(){
 const image='sha256:'+'a'.repeat(64),manifestSha256='b'.repeat(64);
 const base={image,manifestSha256,assets:[],actionIds:[],retiredAt:null,supportUntil:null};
 return {format:'sabalan-browser-routing/v2',generation:1,current:{erp:'erp_current',inquiry:'inquiry_current'},
  legacy:{erp:id,inquiry:null},builds:[{...base,id:'erp_current',application:'erp',slotId:'frontend_current'},
   {...base,id:'inquiry_current',application:'inquiry',slotId:'inquiry_current'},
   {...base,id,application:'erp',slotId:'frontend_legacy',nativeBuildId,handoffPolicy:'MANUAL_SAVE_REQUIRED',
    retiredAt:'2026-10-20T00:00:00.000Z',supportUntil:'2026-10-21T00:00:00.000Z'}],
  apiBindings:['erp_current',id].map(buildId=>({buildId,browserManifestSha256:manifestSha256,
   slotId:'backend_current',image,manifestSha256:'c'.repeat(64)}))};
}
test('actual native legacy BUILD_ID resolves only its measured internal producer without changing paths',()=>{
 const registry=compileBrowserRoutingRegistry(input());
 const selected=selectBrowserRelease(registry,{application:'erp',assetDeploymentId:nativeBuildId},0);
 assert.equal(selected.buildId,id);assert.equal(selected.slotId,'frontend_legacy');
 assert.equal(selectBrowserRelease(registry,{application:'erp',isRsc:true},0).buildId,id);
 assert.throws(()=>selectBrowserRelease(registry,{application:'erp',deploymentId:'erp_current',assetDeploymentId:nativeBuildId},0),/IDENTITY_CONFLICT/);
 assert.throws(()=>selectBrowserRelease(registry,{application:'erp',assetDeploymentId:'OtherUnmeasuredBuild'},0),/ASSET_ID_INVALID/);
});
test('legacy expiry keeps original ownership and explicitly requires manual saving rather than refresh',()=>{
 const browser=input(),api={format:'sabalan-api-routing/v1',generation:1,
  browserRegistryIdentity:browserRoutingIdentity(browser),bindings:browser.apiBindings};
 const registry=compileApiRoutingRegistry(browser,api),deadline=Date.parse('2026-10-21T00:00:00.000Z');
 const before=selectApiRelease(registry,null,deadline-1),expired=selectApiRelease(registry,null,deadline);
 assert.equal(before.requiresDraftHandoff,false);assert.equal(before.manualSaveRequired,false);
 assert.equal(expired.buildId,id);assert.equal(expired.slotId,'backend_current');
 assert.equal(expired.manualSaveRequired,true);assert.equal(expired.requiresDraftHandoff,true);
 assert.equal(selectApiRelease(registry,'erp_current',deadline).requiresDraftHandoff,false);
});
test('legacy manual policy cannot be detached from exact native identity or shorten its support window',()=>{
 for(const change of [value=>value.builds[2].id='erp_forged',value=>delete value.builds[2].handoffPolicy,
  value=>value.builds[2].nativeBuildId='../other',value=>value.builds[2].supportUntil='2026-10-20T23:59:59.999Z']){
  const value=input();change(value);assert.throws(()=>compileBrowserRoutingRegistry(value),/BROWSER_/);
 }
});
test('expired uninstrumented form receives manual-save refusal before any forwarding or durable mutation intent',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'legacy-manual-routing-'));
 let proxy;
 try{
  const browser=input();browser.builds[2].retiredAt='2020-01-01T00:00:00.000Z';browser.builds[2].supportUntil='2020-01-02T00:00:00.000Z';
  const journal=new BrowserOperationJournal({directory:root,instanceId:'d'.repeat(64)});await journal.initialize();
  proxy=createApiReleaseProxy({loadSnapshot:async()=>({browser,api:{format:'sabalan-api-routing/v1',generation:1,
   browserRegistryIdentity:browserRoutingIdentity(browser),bindings:browser.apiBindings}}),
   slotEndpoints:[{slotId:'backend_current',host:'backend-current',port:33179,image:'sha256:'+'a'.repeat(64),manifestSha256:'c'.repeat(64)}],
   operationJournal:journal,applicationsByHost:{'erp.test':'erp'}});
  proxy.server.listen(0,'127.0.0.1');await once(proxy.server,'listening');
  const result=await new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port:proxy.server.address().port,
   path:'/api/support/tickets',method:'POST',headers:{host:'erp.test','content-length':2}},response=>{
    const chunks=[];response.on('data',value=>chunks.push(value));response.on('end',()=>resolve({status:response.statusCode,body:JSON.parse(Buffer.concat(chunks))}));
   });request.on('error',reject);request.end('{}');});
  assert.equal(result.status,409);assert.equal(result.body.error,'API_LEGACY_MANUAL_SAVE_REQUIRED');
  assert.equal((await journal.pending()).length,0);proxy.beginDrain();await proxy.assertDrained();
 }finally{
  if(proxy)await new Promise((resolve,reject)=>proxy.server.close(error=>error?reject(error):resolve()));
  await fs.rm(root,{recursive:true,force:true});
 }
});
