import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {OriginalOnlineReleaseController} from './online-release-controller.mjs';
const issued=new WeakMap(),originals=new WeakMap();
const sha=value=>createHash('sha256').update(value).digest('hex');
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
/** Pure shape/identity predicate; only the private-brand original controller
 * issues source custody. Hashes and a caller-created JSON never issue tokens. */
export function validateLegacyBrowserSource(source){
 const browser=source?.browser,manifest=source?.manifest;
 assert.ok(browser&&manifest);assert.match(browser.nativeBuildId,/^[A-Za-z0-9_-]{1,128}$/);
 assert.equal(browser.id,'erp_legacy_'+sha(browser.nativeBuildId));assert.equal(browser.handoffPolicy,'MANUAL_SAVE_REQUIRED');assert.equal(browser.application,'erp');
 assert.equal(manifest.format,'sabalan-production-legacy-browser-manifest/v1');assert.equal(manifest.buildId,browser.nativeBuildId);
 assert.match(browser.image,/^sha256:[a-f0-9]{64}$/);assert.equal(manifest.image,browser.image);assert.equal(source.originalFrontend.image,browser.image);assert.match(source.originalFrontend.id,/^[a-f0-9]{64}$/);
 assert.equal(browser.manifestSha256,sha(JSON.stringify(manifest)+'\n'));assert.equal(source.source.sourceIndex,browser.image);
 assert.ok(Array.isArray(source.source.layers)&&source.source.layers.length>0&&source.source.layers.length<=128);for(const layer of source.source.layers)assert.match(layer,/^sha256:[a-f0-9]{64}$/);
 assert.ok(Array.isArray(manifest.files)&&manifest.files.length>0&&manifest.files.length<=20000);assert.ok(['.next-build','.next'].includes(manifest.dist));
 const paths=new Set();let total=0;for(const file of manifest.files){assert.ok(typeof file.path==='string'&&!file.path.startsWith('/')&&!file.path.split('/').some(part=>!part||part==='.'||part==='..'||part.includes('\\'))&&!paths.has(file.path));paths.add(file.path);assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>=0);total+=file.bytes;assert.ok(total<=256*1024**2);}
 const prefix=manifest.dist+'/static/';assert.deepEqual(browser.assets,manifest.files.filter(file=>file.path.startsWith(prefix)).map(file=>({...file,path:'/_next/static/'+file.path.slice(prefix.length)})));
 assert.ok(Array.isArray(browser.actionIds)&&browser.actionIds.length<=10000);assert.equal(new Set(browser.actionIds).size,browser.actionIds.length);
 return source;
}
export async function issueOriginalLegacyBrowserDescriptor(controller){
 // Direct prototype dispatch proves genuine private controller state and its
 // protected, originally enrolled source. No replaceable evidence callback.
 const source=await OriginalOnlineReleaseController.prototype.readBootstrapLegacyBrowserSource.call(controller);validateLegacyBrowserSource(source);
 assert.equal(originals.has(controller),false,'ONLINE_ORIGINAL_LEGACY_DESCRIPTOR_ALREADY_ISSUED');
 const facts=freeze(structuredClone(source)),token=Object.freeze({});issued.set(token,{controller,facts});originals.set(controller,token);return token;
}
export function readOriginalLegacyBrowserDescriptor(controller,token){
 const value=issued.get(token);assert.ok(value&&value.controller===controller,'ONLINE_ORIGINAL_LEGACY_DESCRIPTOR_REQUIRED');return value.facts;
}
