import assert from 'node:assert/strict';
import test from 'node:test';
import {BROWSER_SUPPORT_MS,browserRoutingIdentity,compileBrowserRoutingRegistry,selectBrowserRelease} from '../../deploy/scripts/browser-release-routing.mjs';
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

test('each ERP and Inquiry generation keeps its own retirement clock and producer at the 24-hour boundary',()=>{
  const {browser,api}=routingFixture();
  const action='e'.repeat(42),firstRetirement=Date.parse('2026-10-19T00:00:00.000Z');
  assert.equal(BROWSER_SUPPORT_MS,86400000,'ADR-0131 requires 24 hours from retirement');
  // Two overlapping retired releases per application, followed by a current one.
  // These are explicit selector clocks, not elapsed-time or native UI evidence.
  for(const application of ['erp','inquiry']){
    for(const [index,suffix] of ['previous','second'].entries()){
      const id=`${application}_${suffix}`;
      let build=browser.builds.find(row=>row.id===id);
      if(!build){
        build={...browser.builds.find(row=>row.id===browser.current[application]),id,slotId:`slot_${id}`};
        browser.builds.push(build);
      }
      build.retiredAt=new Date(firstRetirement+index*300000).toISOString();
      build.supportUntil=new Date(Date.parse(build.retiredAt)+86400000).toISOString();
      build.assets=[{path:`/_next/static/${id}/page.js`,sha256:manifest,bytes:17}];
      build.actionIds=application==='inquiry'?[action]:[];
      if(application==='erp'&&!api.bindings.some(row=>row.buildId===id)){
        api.bindings.push({...api.bindings[0],buildId:id,slotId:`backend_${suffix}`});
      }
    }
  }
  api.browserRegistryIdentity=browserRoutingIdentity(browser);
  const uiRegistry=compileBrowserRoutingRegistry(browser),apiRegistry=compileApiRoutingRegistry(browser,api);
  for(const build of browser.builds.filter(row=>row.retiredAt!==null)){
    const deadline=Date.parse(build.supportUntil);
    for(const now of [Date.parse(build.retiredAt),deadline-1,deadline,deadline+1]){
      const requests=[
        {deploymentId:build.id,isRsc:true},
        {assetDeploymentId:build.id,assetPath:build.assets[0].path},
        ...(build.application==='inquiry'?[{nativeBuildId:build.id,actionIds:[action]}]:[]),
      ];
      for(const request of requests){
        const result=selectBrowserRelease(uiRegistry,{application:build.application,...request},now);
        assert.equal(result.buildId,build.id);
        assert.equal(result.slotId,build.slotId);
        assert.equal(result.requiresDraftHandoff,now>=deadline);
        assert.equal(result.supportUntil,build.supportUntil);
      }
      if(build.application==='erp'){
        const result=selectApiRelease(apiRegistry,build.id,now);
        assert.equal(result.slotId,api.bindings.find(row=>row.buildId===build.id).slotId);
        assert.equal(result.requiresDraftHandoff,now>=deadline);
      }
      for(const application of ['erp','inquiry']){
        assert.equal(selectBrowserRelease(uiRegistry,{application},now).buildId,browser.current[application]);
        assert.equal(selectBrowserRelease(uiRegistry,{application},now).requiresDraftHandoff,false);
      }
    }
  }
  const betweenDeadlines=Date.parse('2026-10-20T00:00:00.000Z');
  assert.equal(selectBrowserRelease(uiRegistry,{application:'erp',deploymentId:'erp_second'},betweenDeadlines).requiresDraftHandoff,false);
  assert.equal(selectBrowserRelease(uiRegistry,{application:'inquiry',nativeBuildId:'inquiry_previous',actionIds:[action]},betweenDeadlines).requiresDraftHandoff,true);
});
