import test from'node:test';import assert from'node:assert/strict';
import{compareCommittedRecipeBytes}from'../../scripts/lib/committed-recipe-inputs.mjs';
test('recipe accepts exact bytes or only bytewise CRLF-to-LF with both distinct pins',()=>{
 const canonical=Buffer.from('const text="اصل";\n// next\n');const working=Buffer.from('const text="اصل";\r\n// next\r\n');
 const exact=compareCommittedRecipeBytes(canonical,canonical);assert.equal(exact.transform,'IDENTICAL');assert.equal(exact.working.sha256,exact.committed.sha256);
 const transformed=compareCommittedRecipeBytes(working,canonical);assert.equal(transformed.transform,'CRLF_TO_LF');assert.notEqual(transformed.working.sha256,transformed.committed.sha256);assert.equal(transformed.working.bytes,canonical.length+2);assert.equal(transformed.committed.bytes,canonical.length);
});
test('recipe refuses content, BOM, standalone-CR or whitespace coercion',()=>{
 for(const [working,committed]of [['same \r\n','same\n'],['same\r','same\n'],['\ufeffsame\r\n','same\n'],['other\r\n','same\n']])assert.throws(()=>compareCommittedRecipeBytes(Buffer.from(working),Buffer.from(committed)),/COMMITTED_RECIPE_BYTES_DIFFER/);
});
import fs from'node:fs';import os from'node:os';import path from'node:path';import{execFileSync}from'node:child_process';import{readCommittedRecipeInput}from'../../scripts/lib/committed-recipe-inputs.mjs';
test('real Git LF blob remains the material input while checkout CRLF is separately pinned',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-recipe-git-'));
 try{
  const git=(...args)=>execFileSync('git',args,{cwd:directory,stdio:['ignore','pipe','pipe']});git('init','-q');
  fs.writeFileSync(path.join(directory,'.gitattributes'),'*.mjs text eol=lf\n');const working=Buffer.from('export const value="اصل";\r\n');fs.writeFileSync(path.join(directory,'input.mjs'),working);
  git('add','.gitattributes','input.mjs');git('-c','user.name=Recipe Fixture','-c','user.email=fixture@example.invalid','commit','-qm','canonical recipe fixture');
  const commit=git('rev-parse','HEAD').toString().trim(),input=readCommittedRecipeInput({repository:directory,commit,file:'input.mjs'});
  assert.equal(input.transform,'CRLF_TO_LF');assert.deepEqual(fs.readFileSync(path.join(directory,'input.mjs')),working);assert.deepEqual(input.bytes,Buffer.from('export const value="اصل";\n'));assert.notEqual(input.working.sha256,input.committed.sha256);
  fs.writeFileSync(path.join(directory,'input.mjs'),'export const value="other";\r\n');assert.throws(()=>readCommittedRecipeInput({repository:directory,commit,file:'input.mjs'}),/COMMITTED_RECIPE_BYTES_DIFFER/);
 }finally{const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('sabalan-recipe-git-'));fs.rmSync(resolved,{recursive:true});}
});
