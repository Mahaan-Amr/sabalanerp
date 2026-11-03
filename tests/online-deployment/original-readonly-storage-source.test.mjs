import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
test('no-delete source keeps current host guards and canonical floor; exact original owns source ACK lifetime',async()=>{
 const result=await new Promise((resolve,reject)=>{
  const child=spawn('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B',path.resolve('tests/online-deployment/fixtures/readonly-storage-source.fixture.py'),path.resolve('.')],{windowsHide:true,stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',raw=>out+=raw);child.stderr.on('data',raw=>err+=raw);child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,out,err}));
 });
 assert.equal(result.code,0,result.err);assert.equal(result.signal,null);assert.equal(result.err,'');const value=JSON.parse(result.out);assert.equal(value.canonicalMountOrderVerified,true);assert.equal(value.canonicalChangedFieldsRejected,13);assert.equal(value.historicalC748Reclassified,false);assert.equal(value.sourceOnly,true);assert.equal(value.applyRefused,true);assert.equal(value.nativeStorageExecuted,false);assert.equal(value.productionAdmission,false);assert.ok(value.sourceBytes<=2*1024**2&&value.backupBytes<=2*1024**2);
});
