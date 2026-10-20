import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {qualifiedProductionFrontendArchive,stableFrontendBaseFile} from './production-frontend-base-artifacts.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const productionLegacyFrontendImage='sha256:348ceb11008abf840a878bd28c32c2910fd52649af6d04d0f1961870f57b3004';
export const productionLegacyFrontendBuild='B3FQSLBH439Vaf6knWbsb';
const observationName='production-legacy-browser-readonly-edfedc2663e44683bee2067f502602af.json';
const inventorySha256='124d044c0332062152df4617b2b48e126d4c8e6a9329ca64b7886f1337afa19a';
/** Predicate over a fixed real read-only production observation. No controller,
 * public runtime admission, endpoint ownership or invented native scope issued. */
export function validateProductionLegacyBrowserObservation(envelope){
 assert.equal(envelope.sshExitCode,0);assert.equal(envelope.originalChildClosed,true);
 const observed=JSON.parse(envelope.stdout);assert.equal(observed.readOnly,true);assert.equal(observed.allSixUnchangedHealthy,true);
 assert.equal(observed.frontend.id,'7fce37c3b77a333135e2cff24a8a5d08120a71df43a449157d2ee1e4bf8fda7f');
 assert.equal(observed.frontend.image,productionLegacyFrontendImage);assert.equal(observed.originalImageLayers.length,12);for(const layer of observed.originalImageLayers)assert.match(layer,/^sha256:[a-f0-9]{64}$/);assert.deepEqual(observed.frontend.mounts,[]);
 const browser=observed.browser;assert.equal(browser.format,'sabalan-production-legacy-browser-bytes/v1');
 assert.equal(browser.buildId,productionLegacyFrontendBuild);assert.equal(browser.dist,'.next-build');
 assert.equal(browser.applicationStarted,false);assert.equal(browser.databaseConnected,false);assert.equal(browser.files.length,1377);
 assert.equal(browser.bytes,36086294);assert.equal(browser.inventorySha256,inventorySha256);assert.equal(sha(JSON.stringify(browser.files)),inventorySha256);
 assert.equal(new Set(browser.files.map(file=>file.path)).size,browser.files.length);
 let total=0;for(const file of browser.files){assert.ok(file.path&&!file.path.startsWith('/')&&!file.path.split('/').some(part=>!part||part==='.'||part==='..'||part.includes('\\')));assert.match(file.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(file.bytes)&&file.bytes>=0);total+=file.bytes;}
 assert.equal(total,browser.bytes);assert.equal(browser.assets.length,269);assert.deepEqual(browser.actionIds,[]);
 assert.deepEqual(browser.assets,browser.files.filter(file=>file.path.startsWith('.next-build/static/')).map(file=>({...file,path:'/_next/static/'+file.path.slice('.next-build/static/'.length)})));
 return observed;
}
/** Binds the actual original exported image/archive to the fixed real production
 * bytes. This is source evidence for original protected bootstrap, NOT a token
 * that authorizes a carrier, SQL writes, or an unowned legacy backend. */
export function collectProductionLegacyBrowserArtifacts(repository){
 const observationPath=path.join(repository,'reports/qa',observationName),observationFile=stableFrontendBaseFile(observationPath,4*1024**2);
 const observed=validateProductionLegacyBrowserObservation(JSON.parse(fs.readFileSync(observationPath)));
 const source=qualifiedProductionFrontendArchive(repository);assert.equal(source.sourceIndex,observed.frontend.image);assert.deepEqual(observed.originalImageLayers,source.layers);
 const manifest={format:'sabalan-production-legacy-browser-manifest/v1',image:productionLegacyFrontendImage,buildId:observed.browser.buildId,dist:observed.browser.dist,files:observed.browser.files};
 const manifestRaw=Buffer.from(JSON.stringify(manifest)+'\n');
 assert.deepEqual(stableFrontendBaseFile(observationPath,4*1024**2),observationFile);
 return {source,originalFrontend:observed.frontend,observation:{receipt:observationName,file:observationFile,frontend:observed.frontend},manifest,manifestSha256:sha(manifestRaw),
  browser:{id:'erp_legacy_'+sha(observed.browser.buildId),nativeBuildId:observed.browser.buildId,handoffPolicy:'MANUAL_SAVE_REQUIRED',application:'erp',image:productionLegacyFrontendImage,manifestSha256:sha(manifestRaw),assets:observed.browser.assets,actionIds:observed.browser.actionIds},
  instrumentation:'legacy-uninstrumented',automaticReloadSupported:false,retentionStartsAt:'actual-retirement-database-clock',productionAdmission:false};
}
