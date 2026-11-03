import fs from 'node:fs';
import assert from 'node:assert/strict';
/** Settle a previous same-owner complete write, never replace differing data. */
export function persistImmutableSerialJson(file,value){
 const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');let fd;
 try{fd=fs.openSync(file,'wx',0o600);}
 catch(error){
  if(error.code!=='EEXIST')throw error;
  const named=fs.lstatSync(file,{bigint:true});assert.ok(named.isFile()&&!named.isSymbolicLink()&&named.nlink===1n,'OWNED_EVIDENCE_NOT_REGULAR');
  fd=fs.openSync(file,'r+');
  try{
   const held=fs.fstatSync(fd,{bigint:true});assert.equal(held.ino,named.ino);
   // Windows lstat reports dev=0 while fstat reports the volume serial.
   if(process.platform!=='win32')assert.equal(held.dev,named.dev);
   assert.ok(fs.readFileSync(fd).equals(raw),'OWNED_EVIDENCE_CONFLICT');fs.fsyncSync(fd);
   const after=fs.lstatSync(file,{bigint:true});assert.equal(after.ino,named.ino);assert.equal(after.dev,named.dev);assert.ok(after.isFile()&&!after.isSymbolicLink()&&after.nlink===1n);
  }finally{fs.closeSync(fd);}
  return;
 }
 try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
