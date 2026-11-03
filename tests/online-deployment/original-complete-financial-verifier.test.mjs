/** Actual esbuild, tiny data-only recorded graph. No app/runtime qualification. */
import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
import{buildFixedFinancialVerifier}from'../../scripts/lib/original-complete-financial-verifier-v2.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex'),parent=path.resolve('D:/sabalanerp-online-qa');
for(const mode of['positive','changed-pin','unrecorded'])test('compiler consumes pin-verified captured bytes: '+mode,async()=>{
 const root=fs.mkdtempSync(path.join(parent,'419-verifier-unit-'));try{
  fs.mkdirSync(path.join(root,'dist/services'),{recursive:true});const entry='dist/services/protectedFinancialQualificationProvenance.js',dep='dist/services/unit-data.js',files={[entry]:Buffer.from("exports.verifyProtectedFinancialQualification=()=>require('./unit-data.js').value;"),[dep]:Buffer.from("exports.value='unit-data-only';")};
  const outputs={};for(const[name,raw]of Object.entries(files)){fs.writeFileSync(path.join(root,name),raw);outputs[name]={bytes:raw.length,sha256:sha(raw)};}
  if(mode==='changed-pin')fs.writeFileSync(path.join(root,dep),'INVALID JAVASCRIPT !!!');if(mode==='unrecorded')delete outputs[dep];
  const data={format:'sabalan-current-backend-compiled/v1',pass:true,sourceUnchanged:true,originalChildren:{allOriginalChildrenClosed:true,interrupted:false},commands:Array.from({length:2},()=>({code:0,signal:null,naturalChildClosure:true,outputBoundExceeded:false})),root,outputs},raw=Buffer.from(JSON.stringify(data)),file=path.join(root,'compiled-receipt.json');fs.writeFileSync(file,raw);const ref={file,sha256:sha(raw)};
  if(mode==='positive'){const result=await buildFixedFinancialVerifier(ref);assert.equal(result.receipt.compilerInputProvenance,'PIN_VERIFIED_BUFFER_ON_LOAD');assert.deepEqual(result.receipt.inputs,Object.fromEntries(Object.entries(files).map(([name,b])=>[name,sha(b)])));assert.equal(sha(result.raw),result.receipt.sha256);}
  else await assert.rejects(buildFixedFinancialVerifier(ref),error=>error.errors?.some(row=>row.detail?.code==='ERR_ASSERTION'));
 }finally{assert.equal(fs.realpathSync(root),root);assert.equal(path.dirname(root),parent);assert.ok(path.basename(root).startsWith('419-verifier-unit-'));fs.rmSync(root,{recursive:true,force:true});}
});
