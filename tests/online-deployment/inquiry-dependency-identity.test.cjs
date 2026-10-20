const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const {inquiryDependencyIdentity}=require('../../scripts/lib/inquiry-dependency-identity.cjs');
test('runtime identity follows actual dependency bytes even when package versions and sizes match',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-inquiry-deps-'));
  try{
    const first=path.join(root,'first'),second=path.join(root,'second');fs.mkdirSync(first);fs.mkdirSync(second);
    for(const directory of [first,second]){
      fs.writeFileSync(path.join(directory,'package.json'),'{}');fs.writeFileSync(path.join(directory,'runtime.js'),'original');
    }
    const a=inquiryDependencyIdentity(first),b=inquiryDependencyIdentity(second);assert.deepEqual(a,b);
    fs.writeFileSync(path.join(second,'runtime.js'),'tampered');
    const changed=inquiryDependencyIdentity(second);assert.equal(a.files,changed.files);assert.equal(a.bytes,changed.bytes);assert.notEqual(a.sha256,changed.sha256);
    fs.writeFileSync(path.join(second,'runtime.js'),'original');
    fs.writeFileSync(path.join(second,'unexpected.js'),'extra');assert.notEqual(inquiryDependencyIdentity(second).sha256,a.sha256);
  }finally{
    assert.equal(path.dirname(root),os.tmpdir());assert.ok(path.basename(root).startsWith('sabalan-inquiry-deps-'));
    fs.rmSync(root,{recursive:true});
  }
});
