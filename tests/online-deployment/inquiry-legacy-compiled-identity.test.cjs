'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const{inventory}=require('../../deploy/scripts/inquiry-legacy-compiled-identity.cjs');
test('exact legacy byte inventory detects same-size business asset changes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-inquiry-bytes-'));
 try{fs.mkdirSync(path.join(root,'.next'));fs.writeFileSync(path.join(root,'.next','page.js'),'original');const before=inventory(root,'.next',[],100,1000);fs.writeFileSync(path.join(root,'.next','page.js'),'changed!');const after=inventory(root,'.next',[],100,1000);assert.equal(before.bytes,after.bytes);assert.notEqual(before.sha256,after.sha256);}finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('legacy inventory refuses a source alias outside the actual application root',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-inquiry-alias-')),foreign=fs.mkdtempSync(path.join(os.tmpdir(),'legacy-inquiry-foreign-'));
 try{fs.mkdirSync(path.join(root,'.next'));fs.symlinkSync(foreign,path.join(root,'.next','external'),process.platform==='win32'?'junction':'dir');assert.throws(()=>inventory(root,'.next',[],100,1000));}finally{fs.rmSync(root,{recursive:true,force:true});fs.rmSync(foreign,{recursive:true,force:true});}
});
