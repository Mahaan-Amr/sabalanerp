import {createHash} from 'node:crypto';
import {compileBrowserRoutingRegistry,compileBrowserApiBindings,browserRoutingIdentity} from './browser-release-routing.mjs';

const name=/^[a-z][a-z0-9_-]{7,95}$/;
const exact=(value,keys)=>value && typeof value==='object' && !Array.isArray(value)
  && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
const fail=code=>{throw Object.assign(new Error(code),{code});};

/** Routing input only. The owned controller must prove semantic compatibility,
 * recovery and actual backend identity before publishing the paired snapshot.
 * A browser header selects a producer; it grants no authentication/authority. */
export function compileApiRoutingRegistry(browserInput,input) {
  const browser=compileBrowserRoutingRegistry(browserInput);
  if(!exact(input,['format','generation','browserRegistryIdentity','bindings'])
    || input.format!=='sabalan-api-routing/v1' || input.generation!==browser.generation
    || input.browserRegistryIdentity!==browserRoutingIdentity(browserInput)
    || !Array.isArray(input.bindings))fail('API_REGISTRY_INVALID');
  const supplied=compileBrowserApiBindings(browser.builds,input.bindings);
  let owners=supplied;
  if(browserInput.format==='sabalan-browser-routing/v2') {
    const published=compileBrowserApiBindings(browser.builds,browserInput.apiBindings);
    const fields=['buildId','browserManifestSha256','slotId','image','manifestSha256'];
    if(Object.keys(supplied).some(id=>fields.some(field=>supplied[id][field]!==published[id][field])))fail('API_BINDINGS_NOT_PUBLISHED');
    owners=published;
  }
  const bindings={};
  for(const binding of Object.values(owners)) {
    const build=browser.builds[binding.buildId];
    bindings[binding.buildId]=Object.freeze({...binding,supportUntil:build.supportUntil,
      ...(build.handoffPolicy==='MANUAL_SAVE_REQUIRED'?{handoffPolicy:build.handoffPolicy}:{})});
  }
  return Object.freeze({generation:input.generation,browserRegistryIdentity:input.browserRegistryIdentity,
    legacy:browser.legacy.erp,bindings:Object.freeze(bindings)});
}

export function apiRoutingIdentity(browser,input) {
  const registry=compileApiRoutingRegistry(browser,input);
  const bytes=JSON.stringify({format:input.format,generation:registry.generation,
    browserRegistryIdentity:registry.browserRegistryIdentity,bindings:Object.keys(registry.bindings).sort().map(key=>registry.bindings[key])});
  return createHash('sha256').update(bytes).digest('hex');
}

/** Both transports derive their selection from the SAME durable publication.
 * Reading separate UI/API files is intentionally unnecessary. */
export function apiRoutingSnapshot(input) {
  const browser=structuredClone(input);
  compileBrowserRoutingRegistry(browser);
  if(browser.format!=='sabalan-browser-routing/v2')fail('API_PAIRED_PUBLICATION_REQUIRED');
  const api={format:'sabalan-api-routing/v1',generation:browser.generation,
    browserRegistryIdentity:browserRoutingIdentity(browser),bindings:structuredClone(browser.apiBindings)};
  compileApiRoutingRegistry(browser,api);
  return {browser,api};
}

export function selectApiRelease(registry,deploymentId,now=Date.now()) {
  if(deploymentId!==null && deploymentId!==undefined && (typeof deploymentId!=='string' || !name.test(deploymentId)))fail('API_BUILD_ID_INVALID');
  if(!Number.isFinite(now))fail('API_BUILD_ID_INVALID');
  // An uninstrumented pre-bootstrap form belongs to the recorded baseline.
  // It must never silently move to the newest business implementation.
  const buildId=deploymentId ?? registry.legacy;
  if(!Object.hasOwn(registry.bindings,buildId))fail('API_BUILD_UNAVAILABLE');
  const binding=registry.bindings[buildId];
  return Object.freeze({...binding,supportUntil:binding.supportUntil===null?null:new Date(binding.supportUntil).toISOString(),
    ...(binding.handoffPolicy==='MANUAL_SAVE_REQUIRED'?{manualSaveRequired:binding.supportUntil!==null && now>=binding.supportUntil}:{}),
    requiresDraftHandoff:binding.supportUntil!==null && now>=binding.supportUntil});
}
