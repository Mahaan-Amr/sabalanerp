import { createHash } from 'node:crypto';

export const BROWSER_SUPPORT_MS = 24 * 60 * 60 * 1000;
const identity = /^[a-z][a-z0-9_-]{7,95}$/;
const digest = /^[a-f0-9]{64}$/;
const image = /^sha256:[a-f0-9]{64}$/;
const action = /^(?:[a-f0-9]{40}|[a-f0-9]{42})$/;
const fail = code => { throw Object.assign(new Error(code), { code }); };

/** A routing selector, not release admission. Only the owned controller may
 * publish a registry after validating immutable runtime and recovery evidence.
 * It deliberately returns a required build even after its support deadline:
 * expiration must preserve a draft before the client agrees to change builds. */
export function compileBrowserRoutingRegistry(input) {
  if (!input || input.format !== 'sabalan-browser-routing/v1'
    || !Number.isSafeInteger(input.generation) || input.generation < 1
    || !Array.isArray(input.builds) || !input.builds.length || input.builds.length > 256) fail('BROWSER_REGISTRY_INVALID');
  const builds = new Map();
  for (const build of input.builds) {
    if (!build || !identity.test(build.id) || builds.has(build.id)
      || !['erp','inquiry'].includes(build.application) || !image.test(build.image)
      || !digest.test(build.manifestSha256) || !identity.test(build.slotId)
      || !Array.isArray(build.actionIds) || build.actionIds.some(id => !action.test(id))
      || new Set(build.actionIds).size !== build.actionIds.length
      || !Array.isArray(build.assets) || build.assets.some(asset => !validAsset(asset))) fail('BROWSER_BUILD_INVALID');
    if (build.application === 'erp' && build.actionIds.length) fail('BROWSER_ERP_ACTIONS_UNPROVEN');
    const retiredAt = build.retiredAt === null ? null : timestamp(build.retiredAt);
    const supportUntil = build.supportUntil === null ? null : timestamp(build.supportUntil);
    if (retiredAt === null ? supportUntil !== null : supportUntil === null || supportUntil - retiredAt < BROWSER_SUPPORT_MS) {
      fail('BROWSER_SUPPORT_WINDOW_INVALID');
    }
    builds.set(build.id, Object.freeze({ ...build, retiredAt, supportUntil,
      actionIds: Object.freeze([...build.actionIds]), assets: Object.freeze(build.assets.map(asset=>Object.freeze({...asset}))) }));
  }
  for (const application of ['erp','inquiry']) {
    const current = builds.get(input.current?.[application]);
    if (!current || current.application !== application || current.retiredAt !== null) fail('BROWSER_CURRENT_BUILD_INVALID');
    const legacy = input.legacy?.[application];
    if (legacy !== null && (!builds.has(legacy) || builds.get(legacy).application !== application)) fail('BROWSER_LEGACY_BUILD_INVALID');
  }
  const assets = new Map();
  for (const build of builds.values()) for (const asset of build.assets) {
    const key = `${build.application}:${asset.path}`;
    const previous = assets.get(key);
    if (previous && previous.sha256 !== asset.sha256) fail('BROWSER_ASSET_PATH_COLLISION');
    assets.set(key, asset);
  }
  return Object.freeze({ generation:input.generation, builds:Object.freeze(Object.fromEntries(builds)),
    current:Object.freeze({...input.current}), legacy:Object.freeze({...input.legacy}) });
}

function timestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('BROWSER_TIMESTAMP_INVALID');
  return Date.parse(value);
}

function validAsset(asset) {
  return asset && typeof asset.path === 'string' && asset.path.startsWith('/_next/static/')
    && !/[\\?#%\u0000-\u0020]/.test(asset.path) && !asset.path.slice(1).split('/').some(part=>part==='.'||part==='..'||part==='')
    && digest.test(asset.sha256) && Number.isSafeInteger(asset.bytes) && asset.bytes >= 0;
}

const single = (value, code) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !identity.test(value)) fail(code);
  return value;
};

/** Browser identity lives in a request/header or native form, never a shared
 * cookie. No selection executes an action, decodes its bound arguments or
 * substitutes the current implementation for an old native form. */
export function selectBrowserRelease(registry, request, now=Date.now()) {
  if (!request || !['erp','inquiry'].includes(request.application) || !Number.isFinite(now)) fail('BROWSER_REQUEST_INVALID');
  const {application} = request;
  const header = single(request.deploymentId,'BROWSER_HEADER_ID_INVALID');
  const query = single(request.assetDeploymentId,'BROWSER_ASSET_ID_INVALID');
  const native = single(request.nativeBuildId,'BROWSER_FORM_ID_INVALID');
  const requested = [header,query,native].filter(Boolean);
  if (new Set(requested).size>1) fail('BROWSER_IDENTITY_CONFLICT');
  const actionIds = request.actionIds ?? [];
  if (!Array.isArray(actionIds) || actionIds.some(id=>!action.test(id)) || new Set(actionIds).size!==actionIds.length) fail('BROWSER_ACTION_INVALID');
  if (application==='erp' && actionIds.length) fail('BROWSER_ERP_ACTIONS_UNPROVEN');
  const explicit = requested[0];
  let build;
  if (explicit) build = registry.builds[explicit];
  else if (request.isRsc || actionIds.length) {
    // Uninstrumented pre-bootstrap tabs have no version header. Their action
    // IDs can coincide with later builds, so only the recorded baseline owns
    // this ambiguity. Never guess the newest action implementation.
    build = registry.builds[registry.legacy[application]];
  } else if (request.assetPath) {
    const candidates=Object.values(registry.builds).filter(candidate=>candidate.application===application
      && candidate.assets.some(asset=>asset.path===request.assetPath));
    build=candidates.find(candidate=>candidate.id===registry.current[application]) ?? candidates[0];
  } else build = registry.builds[registry.current[application]];
  if (!build || build.application!==application) fail('BROWSER_BUILD_UNAVAILABLE');
  if (actionIds.some(id=>!build.actionIds.includes(id))) fail('BROWSER_ACTION_BUILD_MISMATCH');
  if (request.assetPath && !build.assets.some(asset=>asset.path===request.assetPath)) fail('BROWSER_ASSET_UNAVAILABLE');
  return Object.freeze({ buildId:build.id, slotId:build.slotId, image:build.image,
    requiresDraftHandoff:build.supportUntil!==null && now>=build.supportUntil,
    supportUntil:build.supportUntil===null ? null : new Date(build.supportUntil).toISOString() });
}

/** Parse only the outer native action identity. Bound argument ciphertext is
 * forwarded byte-for-byte to that build's Next runtime and never evaluated. */
export function nativeActionIdentity(formData) {
  if (!formData || typeof formData.entries!=='function') fail('BROWSER_NATIVE_FORM_INVALID');
  const buildValues=formData.getAll('__sabalan_build_id');
  if (buildValues.length>1) fail('BROWSER_FORM_ID_INVALID');
  const nativeBuildId=single(buildValues[0],'BROWSER_FORM_ID_INVALID');
  const actionIds=[];
  for (const [key] of formData.entries()) {
    if (key.startsWith('$ACTION_ID_')) {
      const id=key.slice(11);
      if (!action.test(id)) fail('BROWSER_ACTION_INVALID');
      actionIds.push(id);
    } else if (key.startsWith('$ACTION_REF_')) {
      const reference=key.slice(12);
      if (!/^[a-zA-Z0-9]{1,64}$/.test(reference)) fail('BROWSER_ACTION_INVALID');
      const fields=formData.getAll(`$ACTION_${reference}:0`);
      if(fields.length!==1 || typeof fields[0]!=='string' || fields[0].length>65536) fail('BROWSER_ACTION_INVALID');
      let descriptor;
      try { descriptor=JSON.parse(fields[0]); } catch { fail('BROWSER_ACTION_INVALID'); }
      if (!descriptor || typeof descriptor!=='object' || !action.test(descriptor.id)) fail('BROWSER_ACTION_INVALID');
      actionIds.push(descriptor.id);
    }
  }
  if (actionIds.length!==1) fail('BROWSER_NATIVE_ACTION_AMBIGUOUS');
  return {nativeBuildId,actionIds};
}

/** Stable content identity for a frozen registry, independent of map insertion
 * order. This digest proves identity, not acceptance or runtime readiness. */
export function browserRoutingIdentity(input) {
  compileBrowserRoutingRegistry(input);
  const normalized={format:input.format,generation:input.generation,current:input.current,legacy:input.legacy,
    builds:input.builds.map(build=>({...build,actionIds:[...build.actionIds].sort(),assets:[...build.assets].sort((a,b)=>a.path.localeCompare(b.path))}))
      .sort((a,b)=>a.id.localeCompare(b.id))};
  const canonical=value=>Array.isArray(value) ? value.map(canonical) : value && typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
  return createHash('sha256').update(JSON.stringify(canonical(normalized))).digest('hex');
}
