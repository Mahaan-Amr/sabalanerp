'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{inventory,verify}=require('../../deploy/scripts/inquiry-legacy-compiled-identity.cjs');

test('fresh measured source preserves its actual native build and refuses a relabeled build',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-inquiry-measured-'));
 try{
  for(const dir of ['.next','.next/server','public','node_modules'])fs.mkdirSync(path.join(root,dir));
  fs.writeFileSync(path.join(root,'.next/BUILD_ID'),'fresh_original_build\n');fs.writeFileSync(path.join(root,'.next/required-server-files.json'),JSON.stringify({config:{}}));fs.writeFileSync(path.join(root,'.next/server/server-reference-manifest.json'),JSON.stringify({node:{},edge:{}}));
  const dependencies=inventory(root,'node_modules',['node_modules/.cache'],100000,2147483648);delete dependencies.entries;
  const expected={format:'sabalan-production-inquiry-legacy-code/v1',frameworkBuildId:'fresh_original_build',knownBusinessSourceCommit:null,sourceSnapshot:{format:'sabalan-measured-inquiry-source/v1',engineImage:'sha256:'+'1'.repeat(64),baselineSha256:'2'.repeat(64),deployedHead:'3'.repeat(40),containerId:'4'.repeat(64),startedAt:'2026-10-20T12:00:00Z'},compiled:inventory(root,'.next',['.next/cache'],30000,1073741824),publicFiles:inventory(root,'public',[],10000,536870912),dependencies,configFiles:[],schemaFiles:[],deploymentId:null,actionIds:[]};
  const result=verify(root,expected);assert.equal(result.frameworkBuildId,'fresh_original_build');assert.equal(result.legacyBusinessSource.image,expected.sourceSnapshot.engineImage);assert.equal(result.productionAdmission,false);
  assert.throws(()=>verify(root,{...expected,frameworkBuildId:'invented_build'}),/LEGACY_NATIVE_BUILD_ID_CHANGED/);
 }finally{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));fs.rmSync(resolved,{recursive:true});}
});
test('exact legacy byte inventory detects same-size business asset changes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-inquiry-bytes-'));
 try{fs.mkdirSync(path.join(root,'.next'));fs.writeFileSync(path.join(root,'.next','page.js'),'original');const before=inventory(root,'.next',[],100,1000);fs.writeFileSync(path.join(root,'.next','page.js'),'changed!');const after=inventory(root,'.next',[],100,1000);assert.equal(before.bytes,after.bytes);assert.notEqual(before.sha256,after.sha256);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('legacy inventory refuses a source alias outside the actual application root',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-inquiry-alias-')),foreign=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-inquiry-foreign-'));
 try{fs.mkdirSync(path.join(root,'.next'));fs.symlinkSync(foreign,path.join(root,'.next','external'),process.platform==='win32'?'junction':'dir');assert.throws(()=>inventory(root,'.next',[],100,1000));}finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(foreign,{recursive:true,force:true});}
});
