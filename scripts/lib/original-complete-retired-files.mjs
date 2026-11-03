/** Observation only; no cleanup and no completion capability. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function parentIdentity(file) {
  const parent=path.dirname(file), st=fs.lstatSync(parent,{bigint:true});
  assert.equal(fs.realpathSync.native(parent).toLowerCase(),parent.toLowerCase(),'COMPLETE_RETIRED_PARENT_CHANGED');
  assert.ok(st.isDirectory()&&!st.isSymbolicLink(),'COMPLETE_RETIRED_PARENT_REQUIRED');
  return ['dev','ino','mode'].map(key=>String(st[key])).join(':');
}
export function observeOriginalCompleteRetiredFile(file,expectedParent) {
  assert.equal(path.resolve(file),file,'COMPLETE_RETIRED_PATH_NOT_CANONICAL');
  const parent=parentIdentity(file);
  if(expectedParent!==undefined)assert.equal(parent,expectedParent,'COMPLETE_RETIRED_PARENT_REPLACED');
  let absent=false;
  try { fs.lstatSync(file); }
  catch(error) { if(error.code!=='ENOENT')throw error; absent=true; }
  assert.ok(absent,'COMPLETE_TEMPORARY_INPUT_NOT_RETIRED');
  assert.equal(parentIdentity(file),parent,'COMPLETE_RETIRED_PARENT_CHANGED');
  return parent;
}
