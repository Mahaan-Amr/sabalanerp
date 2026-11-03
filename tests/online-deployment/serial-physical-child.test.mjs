import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {retainSerialChild,isClosedSerialNegative} from '../../scripts/lib/serial-physical/retained-child.mjs';

function evidence({writeFault=false,finalFault=false}={}) {
 const events=[], output={stdout:[],stderr:[]}; let receipt;
 const sinks=Object.fromEntries(['stdout','stderr'].map(name=>[name,{
  write(bytes) { if(writeFault){writeFault=false;throw Error('DISK');}const n=Math.min(3,bytes.length);output[name].push(Buffer.from(bytes.subarray(0,n)));return n; },
  sync(){events.push(name+'-sync');},close(){events.push(name+'-close');}
 }]));
 return {sinks,events,output,get receipt(){return receipt;},
  persistReceipt(row){if(finalFault){finalFault=false;throw Error('FINAL');}events.push('receipt');receipt=row;}};
}
test('finite original persists negative receipt and complete byte hashes before rejection',async()=>{
 const e=evidence();const child=spawn(process.execPath,['-e',"process.stdout.write('output');process.stderr.write('negative');process.exitCode=7"],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 await assert.rejects(retainSerialChild(child,e),error=>isClosedSerialNegative(error));
 assert.equal(e.receipt.code,7);assert.equal(e.receipt.stdoutEof,true);assert.equal(e.receipt.stderrEof,true);
 assert.equal(Buffer.concat(e.output.stdout).toString(),'output');
 assert.equal(e.receipt.stdoutSha256,createHash('sha256').update('output').digest('hex'));
 assert.equal(e.events.at(-1),'receipt');assert.equal(e.receipt.physicalReplayQualified,false);
});
test('write and receipt faults remain negative after actual child closure and retry',async()=>{
 for(const option of [{writeFault:true},{finalFault:true}]){
  const e=evidence(option); const child=spawn(process.execPath,['-e',"process.stdout.write('retained')"],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  await assert.rejects(retainSerialChild(child,e),error=>!isClosedSerialNegative(error));
  assert.equal(e.receipt.observationFault,true);assert.equal(Buffer.concat(e.output.stdout).toString(),'retained');
 }
});
test('exit without actual pipe EOF withholds restoration authority',async()=>{
 const child=new EventEmitter();child.pid=123;child.stdout=new PassThrough();child.stderr=new PassThrough();
 const e=evidence();let settled=false;const result=retainSerialChild(child,e).finally(()=>{settled=true;});
 child.emit('close',0,null);await new Promise(resolve=>setTimeout(resolve,80));
 assert.equal(settled,false);assert.equal(e.receipt,undefined);
 child.stdout.end();child.stderr.end();await result;
});
test('JSON and lookalike errors cannot grant closed-negative restoration',()=>{
 assert.equal(isClosedSerialNegative(new Error('SERIAL_NATIVE_CLOSED_NEGATIVE')),false);
 assert.equal(isClosedSerialNegative({code:7,stdoutEof:true,stderrEof:true}),false);
});
test('finite negative original reaches durable files before its rejection is observed',async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-serial-finite-'));
 const fds=Object.fromEntries(['stdout','stderr'].map(name=>[name,fs.openSync(path.join(directory,name),'wx',0o600)]));
 const receiptFile=path.join(directory,'receipt.json');
 try{
  const child=spawn(process.execPath,['-e',"process.stdout.write('finite-only');process.exitCode=2"],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const sinks=Object.fromEntries(Object.entries(fds).map(([name,fd])=>[name,{write:bytes=>fs.writeSync(fd,bytes),sync:()=>fs.fsyncSync(fd),close:()=>fs.closeSync(fd)}]));
  await assert.rejects(retainSerialChild(child,{phase:'FINITE_DISK',sinks,persistReceipt:row=>{
   const fd=fs.openSync(receiptFile,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(row));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }}),error=>isClosedSerialNegative(error));
  assert.equal(JSON.parse(fs.readFileSync(receiptFile)).code,2);
  assert.equal(fs.readFileSync(path.join(directory,'stdout'),'utf8'),'finite-only');
 }finally{
  // Exactly three owned flat files; no recursive cleanup or foreign paths.
  for(const name of ['stdout','stderr','receipt.json']){const file=path.join(directory,name);if(fs.existsSync(file))fs.unlinkSync(file);}
  fs.rmdirSync(directory);
 }
});
test('receipt finalizer fault retries under custody and cannot become restoration authority',async()=>{
 const e=evidence();let failed=false;
 const child=spawn(process.execPath,['-e','process.exitCode=0'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
 await assert.rejects(retainSerialChild(child,{...e,finalizeReceipt(){if(!failed){failed=true;throw Error('FINAL_CLOSE');}}}),error=>!isClosedSerialNegative(error));
 assert.equal(e.receipt.observationFault,true);
});
