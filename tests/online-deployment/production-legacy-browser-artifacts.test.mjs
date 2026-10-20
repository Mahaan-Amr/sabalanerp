import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {validateProductionLegacyBrowserObservation,productionLegacyFrontendBuild} from '../../scripts/lib/production-legacy-browser-artifacts.mjs';
const original=JSON.parse(fs.readFileSync(new URL('../../reports/qa/production-legacy-browser-readonly-edfedc2663e44683bee2067f502602af.json',import.meta.url)));
test('actual uninstrumented production native BUILD_ID is retained without changing its meaning',()=>{
 const actual=validateProductionLegacyBrowserObservation(original);assert.equal(actual.browser.buildId,productionLegacyFrontendBuild);assert.equal(actual.browser.assets.length,269);assert.deepEqual(actual.frontend.mounts,[]);
});
test('new diagnostic UI, changed bytes, mounted code and failed original SSH cannot become legacy evidence',()=>{
 assert.throws(()=>validateProductionLegacyBrowserObservation({...original,sshExitCode:1}));
 for(const change of [v=>v.frontend.image='sha256:'+'1'.repeat(64),v=>v.frontend.mounts=[{target:'/app/public',rw:false}],v=>v.browser.files[0].sha256='2'.repeat(64),v=>v.browser.buildId='erp_some_diagnostic_build',v=>v.browser.assets.pop()]){
  const value=JSON.parse(original.stdout);change(value);assert.throws(()=>validateProductionLegacyBrowserObservation({...original,stdout:JSON.stringify(value)}));
 }
});
