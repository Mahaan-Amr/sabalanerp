/** Physical source-capsule/import checks. This deliberately does not claim the
 * required connected native path or a source-owned runtime binding exists. */
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{pathToFileURL}from'node:url';
import{writeOriginalCompleteConnectionCapsule,readOriginalCompleteConnectionCapsule}from'../../scripts/lib/original-complete-connection-capsule.mjs';
test('capsule contains physical readers, callback dependencies and the SAME source connection entry',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'complete-source-capsule-')),outputDirectory=path.join(temp,'capsule');try{
  const reference=writeOriginalCompleteConnectionCapsule({sourceRoot:path.resolve('.'),outputDirectory}),held=readOriginalCompleteConnectionCapsule(reference);assert.equal(held.value.runtimeBindingIssued,false);
  const entries=held.value.source.entries;assert.ok(entries.includes('scripts/lib/restored-qa/original-complete-frontend-reader.cjs'));
  for(const relative of entries){const module=await import(pathToFileURL(path.join(held.value.sourceDirectory,relative)));assert.ok(Object.keys(module).length>0);}
  const connection=await import(pathToFileURL(path.join(held.value.sourceDirectory,'scripts/lib/original-complete-live-connection.mjs')));assert.equal(typeof connection.createOriginalCompleteLiveConnection,'function');held.revalidate();
  assert.throws(()=>writeOriginalCompleteConnectionCapsule({sourceRoot:path.resolve('.'),outputDirectory}),/ALREADY_EXISTS/);
  const dependency=path.join(held.value.sourceDirectory,'scripts/lib/restored-qa/complete-terminal.cjs');fs.chmodSync(dependency,0o600);fs.appendFileSync(dependency,'\n// altered');assert.throws(()=>held.revalidate());
 }finally{assert.equal(path.dirname(temp),path.resolve(os.tmpdir()));assert.equal(fs.realpathSync(temp),temp);assert.ok(path.basename(temp).startsWith('complete-source-capsule-'));fs.rmSync(temp,{recursive:true,force:true});}
});
