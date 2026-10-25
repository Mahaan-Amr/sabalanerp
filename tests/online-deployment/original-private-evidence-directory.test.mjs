import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import{randomBytes}from'node:crypto';
import{prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory,originalPrivateEvidenceAclScript}from'../../scripts/lib/original-private-evidence-directory.mjs';
test('private output custody refuses copied tokens and existing directories before any write',async()=>{
 assert.throws(()=>assertOriginalPrivateEvidenceDirectory({},os.tmpdir()));await assert.rejects(prepareOriginalPrivateEvidenceDirectory(os.tmpdir()));
 assert.ok(originalPrivateEvidenceAclScript().includes('[System.IO.Directory]::SetAccessControl'));assert.ok(!originalPrivateEvidenceAclScript().includes('$new.SetOwner'));
});
test('real empty-directory ACL original closes before first private evidence write',async(t)=>{
 const parent=process.platform==='win32'?path.resolve('D:/sabalanerp-online-qa'):os.tmpdir();
 if(process.platform==='win32'&&!fs.existsSync(parent)){t.skip('fixed original Windows evidence workspace unavailable');return;}
 const directory=path.join(parent,'C30-private-evidence-unit-'+randomBytes(8).toString('hex'));
 try{const token=await prepareOriginalPrivateEvidenceDirectory(directory);assert.equal(fs.readdirSync(directory).length,0);assertOriginalPrivateEvidenceDirectory(token,directory);assert.throws(()=>assertOriginalPrivateEvidenceDirectory({...token},directory));
  const file=path.join(directory,'synthetic-unit.json'),fd=fs.openSync(file,'wx',0o400);try{fs.writeFileSync(fd,'{"synthetic":true}');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.equal(fs.readFileSync(file,'utf8'),'{"synthetic":true}');fs.unlinkSync(file);
 }finally{if(fs.existsSync(directory)&&fs.readdirSync(directory).length===0)fs.rmdirSync(directory);}
});
