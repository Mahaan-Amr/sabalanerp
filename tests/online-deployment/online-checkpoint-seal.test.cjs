const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {validateManifest} = require('../../deploy/scripts/seal-online-checkpoint.cjs');
function manifest() {
  const roles=['physical-base','coherent-cut','inquiry-sqlite','coordination','wal-capture','coverage-manifest',
    ...Array(9).fill('versioned-file-cut'),'wal-segment'];
  return {format:'sabalan-online-checkpoint-plaintext-components/v1',operation:'b'.repeat(64),
    coverageSha256:'c'.repeat(64),sourceCaptureSha256:'d'.repeat(64),sources:roles.map((role,i)=>({
      role,name:'component-'+i,path:path.resolve('private-component-'+i),bytes:1024,
      sha256:(role==='coherent-cut'?'d':role==='coverage-manifest'?'c':'a').repeat(64)}))};
}
test('one base, SQLite and coordination snapshots, nine file cuts and a complete WAL segment can be sealed',()=>{
  const value=manifest();assert.equal(value.sources.length,16);assert.equal(validateManifest(value,value.operation),value);
});
test('missing recovery components and duplicate destinations are refused',()=>{
  for(const mutate of [v=>v.sources.pop(),v=>v.sources.splice(3,1),v=>v.sources[0].name=v.sources[1].name,
    v=>v.sources[0].path=v.sources[1].path,v=>v.sources[1].role='physical-base']) {
    const value=manifest();mutate(value);assert.throws(()=>validateManifest(value,value.operation));
  }
});
test('relative paths, invalid digests, traversing object names and oversized components are refused',()=>{
  for(const change of [{path:'../unowned'},{sha256:'missing'},{name:'../escape'},{bytes:Number.MAX_SAFE_INTEGER},{bytes:-1},{role:'arbitrary'}]) {
    const value=manifest();Object.assign(value.sources[0],change);assert.throws(()=>validateManifest(value,value.operation));
  }
});
test('empty immutable user files remain representable while empty database components are refused',()=>{
  const value=manifest();value.sources.push({role:'versioned-file-object',name:'empty-file',path:path.resolve('empty-user-file'),bytes:0,sha256:'e'.repeat(64)});
  assert.equal(validateManifest(value,value.operation),value);
  value.sources[0].bytes=0;assert.throws(()=>validateManifest(value,value.operation));
});
test('another operation or source coverage cannot be silently substituted',()=>{
  let value=manifest();assert.throws(()=>validateManifest(value,'e'.repeat(64)));
  value=manifest();value.coverageSha256='';assert.throws(()=>validateManifest(value,value.operation));
  value=manifest();value.sourceCaptureSha256='e'.repeat(64);assert.throws(()=>validateManifest(value,value.operation));
});
