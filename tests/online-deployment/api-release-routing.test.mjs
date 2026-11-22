import assert from 'node:assert/strict';
import test from 'node:test';
import {browserRoutingIdentity,compileBrowserRoutingRegistry} from '../../deploy/scripts/browser-release-routing.mjs';
import {compileApiRoutingRegistry,selectApiRelease} from '../../deploy/scripts/api-release-routing.mjs';

const image='sha256:'+'a'.repeat(64),manifest='b'.repeat(64);
export function routingFixture() {
  const browser={format:'sabalan-browser-routing/v1',generation:1,
    current:{erp:'erp_current',inquiry:'inquiry_current'},legacy:{erp:'erp_previous',inquiry:null},
    builds:['erp_previous','erp_current','inquiry_current'].map(id=>({id,application:id.startsWith('erp_')?'erp':'inquiry',
      slotId:'slot_'+id,image,manifestSha256:manifest,actionIds:[],assets:[],
      retiredAt:id==='erp_previous'?'2026-10-19T00:00:00.000Z':null,
      supportUntil:id==='erp_previous'?'2026-10-20T00:00:00.000Z':null}))};
  const api={format:'sabalan-api-routing/v1',generation:1,browserRegistryIdentity:browserRoutingIdentity(browser),
    bindings:['erp_previous','erp_current'].map(buildId=>({buildId,browserManifestSha256:manifest,
      slotId:buildId==='erp_previous'?'backend_previous':'backend_current',image,
      manifestSha256:buildId==='erp_previous'?'c'.repeat(64):'d'.repeat(64)}))};
  return {browser,api};
}

test('old and uninstrumented API forms keep their owning backend across a current-build switch',()=>{
  const {browser,api}=routingFixture();const registry=compileApiRoutingRegistry(browser,api);
  assert.equal(selectApiRelease(registry,'erp_previous').slotId,'backend_previous');
  assert.equal(selectApiRelease(registry,null).slotId,'backend_previous');
  assert.equal(selectApiRelease(registry,'erp_current').slotId,'backend_current');
  assert.throws(()=>selectApiRelease(registry,'unknown_build'),/API_BUILD_UNAVAILABLE/);
  assert.throws(()=>selectApiRelease(registry,'constructor'),/API_BUILD_UNAVAILABLE/);
  assert.throws(()=>selectApiRelease(registry,['erp_previous','erp_current']),/API_BUILD_ID_INVALID/);
  assert.throws(()=>selectApiRelease(registry,'inquiry_current'),/API_BUILD_UNAVAILABLE/);
});

test('API routing refuses partial, substituted or independently published browser bindings',()=>{
  const {browser,api}=routingFixture();
  for(const change of [value=>value.bindings.pop(),value=>value.bindings.push(value.bindings[0]),
    value=>value.bindings[0].browserManifestSha256='e'.repeat(64),value=>value.generation++,
    value=>value.browserRegistryIdentity='f'.repeat(64),value=>value.bindings[0].slotId='frontend_previous']) {
    const altered=structuredClone(api);change(altered);
    assert.throws(()=>compileApiRoutingRegistry(browser,altered),/API_/);
  }
  assert.equal(compileBrowserRoutingRegistry(browser).generation,1);
});

test('retirement never silently changes a form backend, including after support expiry',()=>{
  const {browser,api}=routingFixture();const registry=compileApiRoutingRegistry(browser,api);
  const selection=selectApiRelease(registry,'erp_previous');
  assert.equal(selection.slotId,'backend_previous');assert.equal(selection.manifestSha256,'c'.repeat(64));
  assert.equal(selection.supportUntil,'2026-10-20T00:00:00.000Z');
  assert.equal(selection.buildId,'erp_previous');
});
