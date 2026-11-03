import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
const originals=new WeakMap();
// Keep original spawned children reachable until their own closure is observed.
// Process-local custody is not crash recovery or a durable fence.
const unresolvedChildren=new Set();
export function assertOriginalSerialHostLease(lease,file){const value=originals.get(lease);assert.ok(value,'ORIGINAL_SERIAL_HOST_LEASE_REQUIRED');if(file!==undefined)assert.equal(value.file,file);lease.assertHeld();}
export function retainOriginalSerialHostLease(lease){assertOriginalSerialHostLease(lease);const value=originals.get(lease),token=Object.freeze({});value.obligations.add(token);let closed=false;return Object.freeze({close(){assert.equal(closed,false);assertOriginalSerialHostLease(lease);assert.ok(value.obligations.delete(token));closed=true;}});}
export async function acquireSerialHostLease(file, {expectedExistingFileId,fixtureRunId,fixtureTimeoutProbe} = {}){
 if(fixtureTimeoutProbe!==undefined){assert.equal(fixtureTimeoutProbe,'DELAY_RELEASE_12S');assert.ok(fixtureRunId);}
 assert.equal(process.platform,'win32');
 if(expectedExistingFileId!==undefined)assert.match(expectedExistingFileId,/^\d+:[0-9a-f]{32}$/);
 if(fixtureRunId!==undefined){
  assert.match(fixtureRunId,/^[a-f0-9]{32}$/);assert.ok(expectedExistingFileId);
  const root=path.join(path.resolve(os.tmpdir()),'sabalan-phase1-fixture-'+fixtureRunId);
  assert.equal(path.resolve(file),path.join(root,'fixture.lock'));
 }
 const child=spawn('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./host-lease.ps1',import.meta.url))],{
  windowsHide:true,shell:false,env:{...process.env,SABALAN_SERIAL_LEASE_FILE:file,SABALAN_AUDIT_EXPECTED_FILE_ID:expectedExistingFileId??'',SABALAN_TEST_RUN_ID:fixtureRunId??'',SABALAN_TEST_RELEASE_DELAY:fixtureTimeoutProbe??''},stdio:['pipe','pipe','pipe']});
 unresolvedChildren.add(child);
 let out='',err='',closed=false,exit,stdinError,streamError,outputExceeded=false;
 const auditMode=expectedExistingFileId!==undefined;
 const outputLimit=auditMode?65536:Infinity;
 child.stdin.on('error',error=>{stdinError=error;});
 child.stdout.on('data',b=>{if(Buffer.byteLength(out)+b.length>outputLimit)outputExceeded=true;else out+=b;});
 child.stderr.on('data',b=>{if(Buffer.byteLength(err)+b.length>outputLimit)outputExceeded=true;else err+=b;});
 child.stdout.on('error',error=>{streamError=error;});child.stderr.on('error',error=>{streamError=error;});
 child.on('error',()=>{closed=true;});
 const completion=new Promise(resolve=>child.once('close',(code,signal)=>{closed=true;exit={code,signal};resolve(exit);}));
 const waitForClosure=async()=>{
  if(!auditMode)return completion;
  let timer;
  try { return await Promise.race([completion,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('SERIAL_LEASE_CLOSURE_TIMEOUT')),10000);})]); }
  finally { clearTimeout(timer); }
 };
 const readyDeadline=auditMode?Date.now()+10000:Infinity;
 while(!out.includes('\n')&&!closed&&!outputExceeded&&!streamError&&Date.now()<readyDeadline)await new Promise(r=>setTimeout(r,20));
 if((!out.includes('\n')&&!closed)||outputExceeded||streamError){
  const failure=new Error(outputExceeded?'SERIAL_LEASE_OUTPUT_BOUND_EXCEEDED':streamError?'SERIAL_LEASE_STREAM_ERROR':'SERIAL_LEASE_READY_TIMEOUT');
  failure.originalChild=child;failure.originalCompletion=completion;failure.ownChildClosure='UNKNOWN';throw failure;
 }
 if(!out.startsWith('LEASE_READY')){
  try { await waitForClosure(); }
  catch(cause){const failure=new Error('SERIAL_LEASE_START_CLOSURE_UNPROVEN',{cause});failure.originalChild=child;failure.originalCompletion=completion;failure.ownChildClosure='UNKNOWN';throw failure;}
  if(child.stdout.readableEnded&&child.stderr.readableEnded)unresolvedChildren.delete(child);
  throw Error('SERIAL_LEASE_BUSY_OR_UNAVAILABLE');
 }
 const ready=expectedExistingFileId===undefined?'LEASE_READY':`LEASE_READY ${expectedExistingFileId}`;
 let stat,fixtureIdentity;
 try {
  assert.equal(out.trim(),ready,'SERIAL_LEASE_READY_IDENTITY_MISMATCH');
  stat=fs.lstatSync(file,{bigint:true});
  if(fixtureRunId!==undefined){
   const proof=JSON.parse(fs.readFileSync(path.join(path.dirname(file),'fixture-lease-self.json'),'utf8'));
   const helperSha256=createHash('sha256').update(fs.readFileSync(fileURLToPath(new URL('./host-lease.ps1',import.meta.url)))).digest('hex');
   assert.equal(proof.format,'phase1-fixture-lease-self/v1');assert.equal(proof.fixtureOnly,true);
   assert.equal(proof.runId,fixtureRunId);assert.equal(proof.pid,child.pid);assert.equal(proof.parentPid,process.pid);
   assert.equal(proof.fileId,expectedExistingFileId);assert.equal(proof.helperSha256,helperSha256);
   assert.match(proof.birth100ns,/^\d{16,20}$/);assert.match(proof.executableSha256,/^[a-f0-9]{64}$/);
   fixtureIdentity=Object.freeze({runId:fixtureRunId,pid:proof.pid,parentPid:proof.parentPid,birth100ns:proof.birth100ns,fileId:proof.fileId,helperSha256,executableSha256:proof.executableSha256});
  }
  // The audit child compares its exclusive and path metadata handles via
  // FileIdInfo before READY; Node's Windows dev/ino encoding is not assumed
  // equivalent. This remains a snapshot, not an atomic ancestor/path guard.
 }
 catch(cause) {
  // This is the original child of this acquisition, before a lease is
  // exported or any obligation can be registered. Ask only it to close.
  // If closure is ambiguous, retain the child and completion on the error.
  const failure=new Error('SERIAL_LEASE_POST_READY_IDENTITY_UNPROVEN',{cause});
  failure.originalChild=child;failure.originalCompletion=completion;
  try {
   assert.ok(!closed&&err===''&&out.trim()===ready,'SERIAL_LEASE_ORIGINAL_LOST');
   child.stdin.end('RELEASE_AFTER_VERIFIED_RESTORATION\n');
   await waitForClosure();
   assert.ok(!outputExceeded&&!stdinError&&!streamError&&exit.code===0&&exit.signal===null&&err===''&&out.trim()===`${ready}\r\nLEASE_CLOSED`&&child.stdout.readableEnded&&child.stderr.readableEnded,'SERIAL_LEASE_CLOSURE_UNKNOWN');
   unresolvedChildren.delete(child);
   failure.ownChildClosure='OBSERVED';
  } catch(cleanupError) { failure.ownChildClosure='UNKNOWN';failure.cleanupError=cleanupError; }
  throw failure;
 }
 const assertHeld=()=>{
  assert.ok(!closed&&!outputExceeded&&!streamError&&err===''&&out.trim()===ready,'SERIAL_LEASE_ORIGINAL_LOST');
  const actual=fs.lstatSync(file,{bigint:true});assert.equal(actual.dev,stat.dev);assert.equal(actual.ino,stat.ino);
 };
 const obligations=new Set();const lease=Object.freeze({assertHeld,originalPid:child.pid,fixtureIdentity,
  async release(){assertHeld();assert.equal(obligations.size,0,'SERIAL_LEASE_HAS_LIVE_OBLIGATIONS');child.stdin.end('RELEASE_AFTER_VERIFIED_RESTORATION\n');
   try {
    await waitForClosure();
    assert.ok(!outputExceeded&&!stdinError&&!streamError&&exit.code===0&&exit.signal===null&&err===''&&out.trim()===`${ready}\r\nLEASE_CLOSED`&&child.stdout.readableEnded&&child.stderr.readableEnded,'SERIAL_LEASE_CLOSURE_UNKNOWN');
    unresolvedChildren.delete(child);
    return Object.freeze({pid:child.pid,birth100ns:fixtureIdentity?.birth100ns??'UNKNOWN',exitCode:exit.code,signal:exit.signal,
      stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,closeMarker:'LEASE_CLOSED',
      observedAt:new Date().toISOString(),evidenceType:'ORIGINAL_PARENT_REPORTED'});
   } catch(cause) {
    const failure=new Error('SERIAL_LEASE_RELEASE_CLOSURE_UNPROVEN',{cause});
    failure.originalChild=child;failure.originalCompletion=completion;failure.ownChildClosure='UNKNOWN';throw failure;
   }
  }});originals.set(lease,{file,obligations});return lease;
}
