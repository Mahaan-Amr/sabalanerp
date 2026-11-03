import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
test('fixed backup source packages exact crypto/transfer/locks/capacity without runtime authority',async()=>{
 const row=await new Promise((resolve,reject)=>{
  const child=spawn('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B',path.resolve('tests/online-deployment/fixtures/image-repository-source.fixture.py'),path.resolve('.')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',raw=>out+=raw);child.stderr.on('data',raw=>err+=raw);child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,out,err}));
 });
 assert.equal(row.code,0,row.err);assert.equal(row.signal,null);assert.equal(row.err,'');
 const value=JSON.parse(row.out);assert.equal(value.sourceOnly,true);assert.equal(value.nativeExecuted,false);assert.equal(value.productionAdmission,false);assert.ok(value.compiledBytes>0&&value.compiledBytes<=1024**2);
});
