import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import path from 'node:path';
test('C3 packages unchanged bounded crypto with separate serving producer and deployment archive',async()=>{
 const row=await new Promise((resolve,reject)=>{
  const child=spawn('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B',path.resolve('tests/online-deployment/fixtures/c3-backend-stream-source.fixture.py'),path.resolve('.')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',err='';child.stdout.on('data',raw=>out+=raw);child.stderr.on('data',raw=>err+=raw);child.on('error',reject);child.on('close',(code,signal)=>resolve({code,signal,out,err}));
 });
 assert.equal(row.signal,null);assert.equal(row.code,0,row.err);assert.equal(row.err,'');
 assert.deepEqual(JSON.parse(row.out),{sourceOnly:true,phasesCompiled:2,producerTargetSeparated:true,wrongProducerRefused:true,nativeExecuted:false,productionAdmission:false});
});
