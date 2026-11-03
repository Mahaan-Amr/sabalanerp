import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {acquireSerialHostLease,assertOriginalSerialHostLease,retainOriginalSerialHostLease} from '../../scripts/lib/serial-physical/host-lease.mjs';
test('actual host kernel lease excludes a second original and releases only after explicit restoration completion',{skip:process.platform!=='win32'},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-lease-')),file=path.join(directory,'deployment.lock');
 const owner=await acquireSerialHostLease(file);
 try {owner.assertHeld();await assert.rejects(acquireSerialHostLease(file),/LEASE_BUSY/);owner.assertHeld();}
 finally{await owner.release();}
 const next=await acquireSerialHostLease(file);await next.release();fs.unlinkSync(file);fs.rmdirSync(directory);
});

test('a real kernel lease cannot retire while a rollback obligation remains',{skip:process.platform!=='win32'},async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-rollback-lease-')),file=path.join(directory,'deployment.lock');
 assert.throws(()=>assertOriginalSerialHostLease({},file),/ORIGINAL_SERIAL_HOST_LEASE_REQUIRED/);
 const lease=await acquireSerialHostLease(file),obligation=retainOriginalSerialHostLease(lease);
 try{assertOriginalSerialHostLease(lease,file);await assert.rejects(lease.release(),/LIVE_OBLIGATIONS/);await assert.rejects(acquireSerialHostLease(file),/LEASE_BUSY/);obligation.close();}finally{await lease.release();fs.unlinkSync(file);fs.rmdirSync(directory);}
});
