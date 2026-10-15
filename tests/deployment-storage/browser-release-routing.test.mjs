import assert from 'node:assert/strict';
import test from 'node:test';
import { BROWSER_SUPPORT_MS, compileBrowserRoutingRegistry, selectBrowserRelease,
  nativeActionIdentity, browserRoutingIdentity } from '../../deploy/scripts/browser-release-routing.mjs';

const legacyAction='a'.repeat(42), currentAction='b'.repeat(42);
const retired='2026-10-15T06:00:00.000Z', until='2026-10-16T06:00:00.000Z';
const build=(id,application,old=false)=>({id,application,slotId:`slot_${id}`,image:`sha256:${'c'.repeat(64)}`,
  manifestSha256:'d'.repeat(64),retiredAt:old ? retired:null,supportUntil:old ? until:null,
  actionIds:application==='inquiry' ? [legacyAction,...(old?[]:[currentAction])] : [],
  assets:[{path:'/_next/static/chunks/shared-1234.js',sha256:'e'.repeat(64),bytes:1234},
    {path:`/_next/static/${id}/_buildManifest.js`,sha256:'f'.repeat(64),bytes:20}]});
const registry=()=>({format:'sabalan-browser-routing/v1',generation:2,
  current:{erp:'erp_newer',inquiry:'inquiry_newer'},legacy:{erp:'erp_legacy',inquiry:'inquiry_legacy'},
  builds:[build('erp_legacy','erp',true),build('erp_newer','erp'),build('inquiry_legacy','inquiry',true),build('inquiry_newer','inquiry')]});

test('fresh documents, existing per-tab RSC and independent applications select immutable matching builds',()=>{
  const compiled=compileBrowserRoutingRegistry(registry());
  const now=Date.parse(retired)+BROWSER_SUPPORT_MS-1;
  assert.equal(selectBrowserRelease(compiled,{application:'erp'},now).buildId,'erp_newer');
  assert.equal(selectBrowserRelease(compiled,{application:'erp',isRsc:true},now).buildId,'erp_legacy');
  assert.equal(selectBrowserRelease(compiled,{application:'erp',isRsc:true,deploymentId:'erp_legacy'},now).buildId,'erp_legacy');
  assert.equal(selectBrowserRelease(compiled,{application:'erp',isRsc:true,deploymentId:'erp_newer'},now).buildId,'erp_newer');
  assert.equal(selectBrowserRelease(compiled,{application:'inquiry',isRsc:true,deploymentId:'inquiry_legacy'},now).buildId,'inquiry_legacy');
  assert.equal(selectBrowserRelease(compiled,{application:'inquiry',actionIds:[legacyAction]},now).buildId,'inquiry_legacy',
    'a shared action ID must never guess the current implementation');
  assert.equal(selectBrowserRelease(compiled,{application:'inquiry',actionIds:[legacyAction],nativeBuildId:'inquiry_newer'},now).buildId,'inquiry_newer');
  assert.throws(()=>selectBrowserRelease(compiled,{application:'inquiry',actionIds:[currentAction]},now),/ACTION_BUILD_MISMATCH/);
  assert.equal(selectBrowserRelease(compiled,{application:'erp',deploymentId:'erp_legacy'},now).requiresDraftHandoff,false);
  const expired=selectBrowserRelease(compiled,{application:'erp',deploymentId:'erp_legacy'},Date.parse(until));
  assert.equal(expired.requiresDraftHandoff,true);
  assert.equal(expired.buildId,'erp_legacy','expiration never silently changes the code handling a dirty form');
  assert.ok(Object.isFrozen(compiled.builds));
  assert.ok(Object.isFrozen(compiled.builds.erp_legacy.assets[0]));
});

test('assets retain exact content, including uninstrumented legacy chunks, without cross-build path collisions',()=>{
  const input=registry(),compiled=compileBrowserRoutingRegistry(input);
  const assetPath='/_next/static/erp_legacy/_buildManifest.js';
  assert.equal(selectBrowserRelease(compiled,{application:'erp',assetPath}).buildId,'erp_legacy');
  assert.equal(selectBrowserRelease(compiled,{application:'erp',assetPath,assetDeploymentId:'erp_legacy'}).buildId,'erp_legacy');
  assert.throws(()=>selectBrowserRelease(compiled,{application:'erp',assetPath,assetDeploymentId:'erp_newer'}),/ASSET_UNAVAILABLE/);
  input.builds[1].assets[0].sha256='0'.repeat(64);
  assert.throws(()=>compileBrowserRoutingRegistry(input),/ASSET_PATH_COLLISION/);
  for(const unsafe of ['/_next/static/../secret','/_next/static/a%2fb','/_next/static//file','/_next/static/a?b','/_next/static/a\\b']) {
    const candidate=registry();candidate.builds[0].assets[0].path=unsafe;
    assert.throws(()=>compileBrowserRoutingRegistry(candidate),/BUILD_INVALID/);
  }
});

test('unknown/conflicting headers, expired support windows and wrong application identities fail closed',()=>{
  const compiled=compileBrowserRoutingRegistry(registry());
  for(const request of [
    {application:'erp',deploymentId:'erp_unknown'},
    {application:'erp',deploymentId:'inquiry_legacy'},
    {application:'erp',deploymentId:['erp_legacy','erp_newer']},
    {application:'erp',deploymentId:'erp_legacy',assetDeploymentId:'erp_newer'},
    {application:'inquiry',deploymentId:'inquiry_newer',nativeBuildId:'inquiry_legacy'},
    {application:'erp',actionIds:[legacyAction]},
    {application:'inquiry',actionIds:['0'.repeat(41)]},
  ])assert.throws(()=>selectBrowserRelease(compiled,request));
  const short=registry();short.builds[0].supportUntil='2026-10-16T05:59:59.999Z';
  assert.throws(()=>compileBrowserRoutingRegistry(short),/SUPPORT_WINDOW_INVALID/);
  const invalid=registry();invalid.builds[0].retiredAt='2026-02-30T00:00:00.000Z';
  assert.throws(()=>compileBrowserRoutingRegistry(invalid),/TIMESTAMP_INVALID/);
});

test('native unbound and encrypted-bound forms retain exact action/build identity without decoding arguments',()=>{
  const ordinary=new FormData();ordinary.set(`$ACTION_ID_${legacyAction}`,'');ordinary.set('username','کاربر');
  assert.deepEqual(nativeActionIdentity(ordinary),{nativeBuildId:null,actionIds:[legacyAction]});
  const bound=new FormData();bound.set('$ACTION_REF_1','');
  bound.set('$ACTION_1:0',JSON.stringify({id:legacyAction,bound:'$@1'}));
  bound.set('$ACTION_1:1','DO_NOT_DECRYPT_OR_REWRITE_BOUND_CIPHERTEXT');
  bound.set('__sabalan_build_id','inquiry_legacy');
  const before=[...bound.entries()];
  assert.deepEqual(nativeActionIdentity(bound),{nativeBuildId:'inquiry_legacy',actionIds:[legacyAction]});
  assert.deepEqual([...bound.entries()],before);
  bound.append('$ACTION_1:0','duplicate');assert.throws(()=>nativeActionIdentity(bound),/ACTION_INVALID/);
  for(const fields of [[],[['$ACTION_REF_1','']],[[`$ACTION_ID_${legacyAction}`, ''],[`$ACTION_ID_${currentAction}`,'']]]) {
    const form=new FormData();for(const [key,value] of fields)form.append(key,value);
    assert.throws(()=>nativeActionIdentity(form));
  }
});

test('routing digest is stable across build, asset, action and JSON object ordering',()=>{
  const input=registry(),reordered=registry();
  reordered.builds.reverse();reordered.current={inquiry:input.current.inquiry,erp:input.current.erp};
  for(const build of reordered.builds){build.actionIds.reverse();build.assets.reverse();}
  assert.equal(browserRoutingIdentity(input),browserRoutingIdentity(reordered));
  reordered.builds[0].image=`sha256:${'9'.repeat(64)}`;
  assert.notEqual(browserRoutingIdentity(input),browserRoutingIdentity(reordered));
});
