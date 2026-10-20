'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readInquiryCompiledBrowser}=require('../../deploy/scripts/inquiry-compiled-browser.cjs');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-inquiry-manifest-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const files={'.next/BUILD_ID':'build-native-framework','.next/required-server-files.json':JSON.stringify({config:{deploymentId:'inquiry_online_12345678',env:{NEXT_PUBLIC_INQUIRY_BUILD_ID:'inquiry_online_12345678'}}}),'.next/server/server-reference-manifest.json':JSON.stringify({node:{['a'.repeat(40)]:{}},edge:{}}),'.next/static/chunks/browser.js':'const value=1;', 'public/logo.svg':'<svg/>','package.json':'{}','next.config.ts':'export default {};'};
 for(const [name,raw]of Object.entries(files)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw);}
 return root;
}
test('actual native framework ID stays distinct from the public Inquiry selector; same-size asset edits change manifest',t=>{
 const root=fixture(t),before=readInquiryCompiledBrowser(root);
 assert.equal(before.id,'inquiry_online_12345678');assert.equal(before.frameworkBuildId,'build-native-framework');assert.deepEqual(before.actionIds,['a'.repeat(40)]);assert.equal(before.assets[0].path,'/_next/static/chunks/browser.js');
 fs.writeFileSync(path.join(root,'.next/static/chunks/browser.js'),'const value=2;');const after=readInquiryCompiledBrowser(root);assert.notEqual(after.manifestSha256,before.manifestSha256);assert.notEqual(after.assets[0].sha256,before.assets[0].sha256);
});
test('mismatched public selector refuses and cache bytes do not become browser authority',t=>{
 const root=fixture(t),before=readInquiryCompiledBrowser(root);fs.mkdirSync(path.join(root,'.next/cache'));fs.writeFileSync(path.join(root,'.next/cache/opaque'),'runtime-cache');assert.equal(readInquiryCompiledBrowser(root).manifestSha256,before.manifestSha256);
 fs.writeFileSync(path.join(root,'.next/required-server-files.json'),JSON.stringify({config:{deploymentId:'inquiry_online_12345678',env:{NEXT_PUBLIC_INQUIRY_BUILD_ID:'inquiry_other_12345678'}}}));assert.throws(()=>readInquiryCompiledBrowser(root));
});
