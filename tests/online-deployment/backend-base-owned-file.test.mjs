import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {syncOwnedBackendBaseFile} from '../../scripts/lib/backend-base-owned-file.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function own(){const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-owned-fsync-')));
 const file=path.join(root,'owned.bin'),bytes=Buffer.from('actual owned artifact');fs.writeFileSync(file,bytes,{flag:'wx'});
 return {root,file,bytes,expected:{bytes:bytes.length,sha256:sha(bytes)},close(){
  assert.equal(fs.realpathSync(root),root);assert.equal(path.dirname(root),fs.realpathSync(os.tmpdir()));
  assert.match(path.basename(root),/^sabalan-owned-fsync-/);fs.rmSync(root,{recursive:true});}};}
test('actual small owned file flushes through RW handle and preserves exact bytes/incarnation',()=>{
 const value=own(),open=fs.openSync;let flags;
 try{fs.openSync=(file,mode,...rest)=>{if(file===value.file)flags=mode;return open(file,mode,...rest);};
  const result=syncOwnedBackendBaseFile(value.file,value.expected);assert.ok((flags&fs.constants.O_RDWR)===fs.constants.O_RDWR);
  assert.equal(result.bytes,value.bytes.length);assert.equal(result.sha256,sha(value.bytes));assert.deepEqual(fs.readFileSync(value.file),value.bytes);
 }finally{fs.openSync=open;value.close();}
});
test('a real fsync failure propagates; existing bytes are never rewritten or accepted',()=>{
 const value=own(),sync=fs.fsyncSync,error=Error('PRIVATE_FLUSH_FAILURE');
 try{fs.fsyncSync=()=>{throw error;};assert.throws(()=>syncOwnedBackendBaseFile(value.file,value.expected),actual=>actual===error);
  assert.deepEqual(fs.readFileSync(value.file),value.bytes);
 }finally{fs.fsyncSync=sync;value.close();}
});
test('named-file replacement before open refuses before flushing the replacement',()=>{
 const value=own(),open=fs.openSync,sync=fs.fsyncSync;let changed=false,flushed=false;
 try{fs.openSync=(file,mode,...rest)=>{if(file===value.file&&!changed){changed=true;fs.renameSync(file,path.join(value.root,'original.bin'));fs.writeFileSync(file,value.bytes);}
   return open(file,mode,...rest);};fs.fsyncSync=fd=>{flushed=true;return sync(fd);};
  assert.throws(()=>syncOwnedBackendBaseFile(value.file,value.expected));assert.equal(flushed,false);
 }finally{fs.openSync=open;fs.fsyncSync=sync;value.close();}
});
