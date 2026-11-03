import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {observeOriginalCompleteRetiredFile} from '../../scripts/lib/original-complete-retired-files.mjs';
import {readOriginalCompleteRetirementFor} from '../../scripts/lib/original-existing-compose-complete.mjs';
test('retirement observes only ENOENT under the same genuine parent',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-retirement-')),file=path.join(dir,'owned-input');
 try{
  const parent=observeOriginalCompleteRetiredFile(file);assert.equal(observeOriginalCompleteRetiredFile(file,parent),parent);
  fs.writeFileSync(file,'reappeared',{flag:'wx'});assert.throws(()=>observeOriginalCompleteRetiredFile(file,parent),/NOT_RETIRED/);fs.unlinkSync(file);
  assert.throws(()=>observeOriginalCompleteRetiredFile(file,parent+'changed'),/PARENT_REPLACED/);
  const original=fs.lstatSync;
  try{fs.lstatSync=function(p,...args){if(p===file)throw Object.assign(new Error('fixture I/O failure'),{code:'EIO'});return original.call(this,p,...args);};assert.throws(()=>observeOriginalCompleteRetiredFile(file,parent),/fixture I\/O failure/);}
  finally{fs.lstatSync=original;}
  fs.rmdirSync(dir);assert.throws(()=>observeOriginalCompleteRetiredFile(file,parent));
 }finally{if(fs.existsSync(file))fs.unlinkSync(file);if(fs.existsSync(dir))fs.rmdirSync(dir);}
});
test('persisted retirement data or a different owner cannot mint genuine FULL retirement',()=>{
 for(const token of [{},Object.freeze({}),{format:'sabalan-same-root-complete-retirement/v1',originalOwnerClosed:true,backupTransferRetired:true}])assert.throws(()=>readOriginalCompleteRetirementFor(token,{}),/SAME_ROOT_COMPLETE_RETIREMENT_REQUIRED/);
});
