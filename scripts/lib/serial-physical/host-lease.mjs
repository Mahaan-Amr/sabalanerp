import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const originals=new WeakMap();
export function assertOriginalSerialHostLease(lease,file){const value=originals.get(lease);assert.ok(value,'ORIGINAL_SERIAL_HOST_LEASE_REQUIRED');if(file!==undefined)assert.equal(value.file,file);lease.assertHeld();}
export function retainOriginalSerialHostLease(lease){assertOriginalSerialHostLease(lease);const value=originals.get(lease),token=Object.freeze({});value.obligations.add(token);let closed=false;return Object.freeze({close(){assert.equal(closed,false);assertOriginalSerialHostLease(lease);assert.ok(value.obligations.delete(token));closed=true;}});}
export async function acquireSerialHostLease(file){
 assert.equal(process.platform,'win32');
 const child=spawn('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./host-lease.ps1',import.meta.url))],{
  windowsHide:true,shell:false,env:{...process.env,SABALAN_SERIAL_LEASE_FILE:file},stdio:['pipe','pipe','pipe']});
 let out='',err='',closed=false,exit;
 child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});
 child.on('error',()=>{closed=true;});
 const completion=new Promise(resolve=>child.once('close',(code,signal)=>{closed=true;exit={code,signal};resolve(exit);}));
 while(!out.includes('\n')&&!closed)await new Promise(r=>setTimeout(r,20));
 if(!out.startsWith('LEASE_READY')){await completion;throw Error('SERIAL_LEASE_BUSY_OR_UNAVAILABLE');}
 const stat=fs.lstatSync(file,{bigint:true});
 const assertHeld=()=>{
  assert.ok(!closed&&err===''&&out.trim()==='LEASE_READY','SERIAL_LEASE_ORIGINAL_LOST');
  const actual=fs.lstatSync(file,{bigint:true});assert.equal(actual.dev,stat.dev);assert.equal(actual.ino,stat.ino);
 };
 const obligations=new Set();const lease=Object.freeze({assertHeld,originalPid:child.pid,
  async release(){assertHeld();assert.equal(obligations.size,0,'SERIAL_LEASE_HAS_LIVE_OBLIGATIONS');child.stdin.end('RELEASE_AFTER_VERIFIED_RESTORATION\n');await completion;
   assert.ok(exit.code===0&&exit.signal===null&&err===''&&out.trim()==='LEASE_READY\r\nLEASE_CLOSED'&&child.stdout.readableEnded&&child.stderr.readableEnded,'SERIAL_LEASE_CLOSURE_UNKNOWN');
  }});originals.set(lease,{file,obligations});return lease;
}
