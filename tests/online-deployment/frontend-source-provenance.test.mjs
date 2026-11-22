import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {readFrontendSourceCommit,qualifyFrontendGeneratedSelectors} from '../../scripts/lib/frontend-source-provenance.mjs';
test('one real Git batch binds authored blobs separately from actual compiler CRLF bytes',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-frontend-commit-'));
 try{
  const git=(...args)=>execFileSync('git',args,{cwd:root,stdio:['ignore','pipe','pipe']});git('init','-q');fs.writeFileSync(path.join(root,'.gitattributes'),'*.ts text eol=lf\n*.bin -text\n');fs.writeFileSync(path.join(root,'source.ts'),'export const value="اصل";\r\n');fs.writeFileSync(path.join(root,'asset.bin'),Buffer.from([0,13,10,255]));git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-qm','fixed source');const commit=git('rev-parse','HEAD').toString().trim();
  const proof=readFrontendSourceCommit(root,commit,['source.ts','asset.bin']);assert.equal(proof['source.ts'].transform,'CRLF_TO_LF');assert.notEqual(proof['source.ts'].working.sha256,proof['source.ts'].committed.sha256);assert.equal(proof['asset.bin'].transform,'IDENTICAL');
  fs.writeFileSync(path.join(root,'source.ts'),'export const value="changed";\r\n');assert.throws(()=>readFrontendSourceCommit(root,commit,['source.ts']),/COMMITTED_RECIPE_BYTES_DIFFER/);fs.writeFileSync(path.join(root,'asset.bin'),Buffer.from([0,10,255]));assert.throws(()=>readFrontendSourceCommit(root,commit,['asset.bin']),/BINARY_FRONTEND_SOURCE_CHANGED/);
  assert.throws(()=>readFrontendSourceCommit(root,commit,['missing.ts']),/COMMITTED_FRONTEND_BLOB_MISSING/);assert.throws(()=>readFrontendSourceCommit(root,commit,['../source.ts']));
 }finally{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('sabalan-frontend-commit-'));fs.rmSync(resolved,{recursive:true});}
});

test('known Next selector cleanup accepts current and historical dist formats, but refuses authored changes',()=>{
 const names=['frontend/tsconfig.json','frontend/next-env.d.ts'];
 const original={[names[0]]:Buffer.from(JSON.stringify({compilerOptions:{strict:true},include:['next-env.d.ts','src/**/*.ts']})),[names[1]]:Buffer.from('/// <reference path="./.next-build/types/routes.d.ts" />\n')};
 for(const dist of ['.next-online-committed-1234567890abcdef','.next-online-final-20261019-1234']){
  const full={[names[0]]:Buffer.from(JSON.stringify({compilerOptions:{strict:true},include:['next-env.d.ts','src/**/*.ts',dist+'/types/**/*.ts']})),[names[1]]:Buffer.from(original[names[1]].toString().replace('./.next-build/','./'+dist+'/'))};
  assert.equal(qualifyFrontendGeneratedSelectors(original,full,dist),true);
  assert.equal(qualifyFrontendGeneratedSelectors(original,original,dist,{allowPartial:true}),true);
  assert.equal(qualifyFrontendGeneratedSelectors(original,{...full,[names[1]]:original[names[1]]},dist,{allowPartial:true}),true);
  assert.throws(()=>qualifyFrontendGeneratedSelectors(original,original,dist));
  const changed={...full,[names[0]]:Buffer.from(full[names[0]].toString().replace('"strict":true','"strict":false'))};
  assert.throws(()=>qualifyFrontendGeneratedSelectors(original,changed,dist,{allowPartial:true}),/UNREVIEWED_NEXT_CONFIG_CHANGE/);
  assert.throws(()=>qualifyFrontendGeneratedSelectors(original,{...full,[names[1]]:Buffer.from(full[names[1]].toString()+'unexpected')},dist,{allowPartial:true}),/UNREVIEWED_NEXT_ENV_CHANGE/);
 }
 assert.throws(()=>qualifyFrontendGeneratedSelectors(original,original,'../foreign',{allowPartial:true}));
});
