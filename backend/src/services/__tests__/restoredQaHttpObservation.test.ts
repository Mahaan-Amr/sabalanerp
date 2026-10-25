import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {spawn} from 'node:child_process';
import {RestoredQaHttpObservation,retainRestoredQaHttpWork} from '../restoredQaHttpObservation';
const session='a'.repeat(64);
const source=`const readline=require('node:readline');const emit=event=>console.log('SABALAN_RESTORED_QA_HTTP '+JSON.stringify({format:'sabalan-restored-qa-http-original/v1',session:'${session}',event}));console.log('ordinary private application log');emit('READY');readline.createInterface({input:process.stdin}).on('line',line=>{if(line==='fault')console.log('SABALAN_RESTORED_QA_HTTP malformed');if(line==='held')emit('HELD');if(line==='finish'){emit('CLOSED');process.stdin.destroy();}});`;
async function original(work:(o:RestoredQaHttpObservation,child:ReturnType<typeof spawn>)=>Promise<void>){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-original-transport-'));const fds=['out','err'].map(n=>fs.openSync(path.join(dir,n),'wx',0o600));
 const child=spawn(process.execPath,['-e',source],{stdio:['pipe','pipe','pipe']});const observation=new RestoredQaHttpObservation(child,session,fds[0],fds[1]);
 try{await work(observation,child);}finally{if(!observation.closed){child.stdin!.write('finish\n');await observation.done;}for(const fd of fds)fs.closeSync(fd);fs.rmSync(dir,{recursive:true});}
}
test('real original transport retains ordinary logs and proves actual zero exit plus both EOF',async()=>original(async(o,child)=>{
 await o.next('READY');assert.equal(o.closed,false);assert.throws(()=>o.assertComplete());child.stdin!.write('finish\n');await o.next('CLOSED');await o.done;o.assertComplete();assert.equal(child.stdout!.readableEnded,true);assert.equal(child.stderr!.readableEnded,true);
}));
test('real protocol fault remains sticky while same child is live and cannot be laundered by late zero exit',async()=>original(async(o,child)=>{
 await o.next('READY');child.stdin!.write('fault\n');await assert.rejects(o.next('PREPARED'));assert.equal(o.closed,false);assert.equal(child.exitCode,null);assert.throws(()=>o.assertComplete());child.stdin!.write('finish\n');await o.done;assert.equal(o.code,0);assert.throws(()=>o.assertComplete());
}));
test('actual HELD immediately revokes LIVE before the owner asks for another event and retains same child through EOF',async()=>original(async(o,child)=>{
 await o.next('READY');child.stdin!.write('held\n');
 await new Promise<void>((resolve,reject)=>{const limit=setTimeout(()=>reject(Error('held observation absent')),3000);const poll=()=>{if(o.fault){clearTimeout(limit);resolve();}else setImmediate(poll);};poll();});
 assert.equal(o.closed,false);assert.equal(child.exitCode,null);assert.ok(o.fault);assert.throws(()=>o.assertComplete());
 child.stdin!.write('finish\n');await o.done;assert.equal(o.code,0);assert.equal(child.stdout!.readableEnded,true);assert.equal(child.stderr!.readableEnded,true);assert.throws(()=>o.assertComplete());
}));
test('all falsy callback rejections survive actual same-original cleanup and later cleanup errors',async()=>{
 for(const rejected of [null,undefined,false,0,''])await original(async(o,child)=>{
  await o.next('READY');let caught=false;
  try{await retainRestoredQaHttpWork(async()=>{throw rejected;},async()=>{
   assert.equal(o.closed,false);child.stdin!.write('finish\n');await o.next('CLOSED');await o.done;o.assertComplete();throw Error('later cleanup error');
  });}catch(error){caught=true;assert.equal(error,rejected);}
  assert.equal(caught,true);assert.equal(o.code,0);assert.equal(o.closed,true);assert.equal(child.stdout!.readableEnded,true);assert.equal(child.stderr!.readableEnded,true);
 });
});
