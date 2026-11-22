import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
const retained=fs.readFileSync(new URL('../../scripts/lib/original-retained-browser-qualification.mjs',import.meta.url),'utf8');
const paired=fs.readFileSync(new URL('./installed-legacy-paired-browser.fixture.mjs',import.meta.url),'utf8');
const carrier=fs.readFileSync(new URL('../../scripts/lib/original-private-legacy-ui-carrier.mjs',import.meta.url),'utf8');
const owner=fs.readFileSync(new URL('../../scripts/lib/application-native-ui-artifacts.mjs',import.meta.url),'utf8');
const literal=(source,name)=>{const match=source.match(new RegExp('const '+name+'=(\\{[\\s\\S]*?\\});'));assert.ok(match,'fixed selection literal required');return new Function('return ('+match[1]+');')();};
const selected=literal(owner,'points');
function assertSelection(source){
 const images=literal(source,'restoredImages');assert.equal(images.new,selected.new.image);assert.equal(images.old,selected.old.image);
 const build=source.match(/ONLINE_BROWSER_NEW_BUILD_ID:'([^']+)'/);assert.ok(build);assert.equal(build[1],'erp_online_committed_33bd7e000cc2f1e3');return images;
}
test('retained ERP restoration selects the canonical current and retained frontend images',()=>{const images=assertSelection(retained);assert.equal(images.new,'sha256:948a939c55cb17a11ebcd7232ce5dc6ec31b80f71bcf0748f084f2a5236de4d6');assert.equal(selected.new.imageReceipt,'reports/qa/current-frontend-image-792da52dca314b79ba0f2cde7d38c36d.json');});
test('old candidate image and build selections fail the current cross-module contract',()=>{assert.throws(()=>assertSelection(retained.replace('sha256:948a939c55cb17a11ebcd7232ce5dc6ec31b80f71bcf0748f084f2a5236de4d6','sha256:923340ff3fd7950f38c4188f9209e1006e4fc3105c49b325c4e1d00a5f4075ae')));assert.throws(()=>assertSelection(retained.replace('erp_online_committed_33bd7e000cc2f1e3','erp_online_committed_0c3c2fd8e569bfa9')));});
test('retained ERP and Inquiry reference identities remain exact',()=>{const images=literal(retained,'restoredImages'),inquiry=literal(retained,'defaultImages');assert.equal(images.old,'sha256:9df9eec8db41a96b86492a04f9d2e18767e9845e861329e6c8036c4e5b77cdb3');assert.match(retained,/ONLINE_BROWSER_OLD_BUILD_ID:'erp_online_final_20261019_5b4cc688a771e5a9'/);assert.deepEqual(inquiry,{old:'sha256:0a3fa6cb6312ecc01765308bc95ff7eb6fddac22e44630c945d587836c63d6c1',current:'sha256:c1ef9462f192f03f62a781b35ad13ae3de4aa780670b7638bb53a713a4d256b4'});});
test('selected images remain checked before takeover and canonical UI receipts remain verified',()=>{assert.ok(retained.includes("assert.equal(before[name].Image,restoredImages[name==='frontend-retained'?'old':'new'])"));assert.ok(retained.includes('collectApplicationUiArtifacts({root,capture,containers:before,inspectImage:image=>imageCache.get(image)})'));assert.ok(retained.includes('ONLINE_BROWSER_NEW_IMAGE:restoredImages.new'));});

function assertCarrierSelection(source){const current=source.match(/currentImage='([^']+)'/),retained=source.match(/retainedImage='([^']+)'/),build=source.match(/ONLINE_BROWSER_NEW_BUILD_ID:'([^']+)'/);assert.ok(current&&retained&&build);assert.equal(current[1],selected.new.image);assert.equal(retained[1],selected.old.image);assert.equal(build[1],'erp_online_committed_33bd7e000cc2f1e3');}
test('private legacy carrier agrees with both canonical ERP selection owners',()=>{assertSelection(retained);assertCarrierSelection(carrier);assert.ok(carrier.includes('assert.equal(value.originalCurrent.image,currentImage)'));assert.ok(carrier.includes('ONLINE_BROWSER_NEW_IMAGE:currentImage'));assert.match(carrier,/ONLINE_BROWSER_OLD_BUILD_ID:'erp_online_final_20261019_5b4cc688a771e5a9'/);});
test('old private carrier image or build fails independently of retained helper',()=>{assert.throws(()=>assertCarrierSelection(carrier.replace('sha256:948a939c55cb17a11ebcd7232ce5dc6ec31b80f71bcf0748f084f2a5236de4d6','sha256:923340ff3fd7950f38c4188f9209e1006e4fc3105c49b325c4e1d00a5f4075ae')));assert.throws(()=>assertCarrierSelection(carrier.replace('erp_online_committed_33bd7e000cc2f1e3','erp_online_committed_0c3c2fd8e569bfa9')));});

function assertPairedSelection(source){const match=source.match(/assert\.equal\(current\.image,'([^']+)'\)/);assert.ok(match,'actual current ERP assertion required');assert.equal(match[1],selected.new.image);}
test('installed paired browser asserts the same current ERP image as both owners',()=>{assertSelection(retained);assertCarrierSelection(carrier);assertPairedSelection(paired);});
test('old installed paired-browser fixture fails the current selection contract',()=>{assert.throws(()=>assertPairedSelection(paired.replace('sha256:948a939c55cb17a11ebcd7232ce5dc6ec31b80f71bcf0748f084f2a5236de4d6','sha256:923340ff3fd7950f38c4188f9209e1006e4fc3105c49b325c4e1d00a5f4075ae')));});
