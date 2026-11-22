import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** Flush only an already-owned regular file; never create/truncate/write bytes.
 * Windows FlushFileBuffers requires a write-capable handle. Keep that SAME
 * handle and named incarnation pinned through flush and independent readback. */
export function syncOwnedBackendBaseFile(file,expected){
  file=path.resolve(file);assert.equal(fs.realpathSync(file),file);
  const identity=value=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'].map(key=>[key,String(value[key])]));
  const namedStat=fs.lstatSync(file,{bigint:true}),named=identity(namedStat);
  assert.ok(namedStat.isFile()&&!namedStat.isSymbolicLink()&&namedStat.nlink===1n);
  assert.equal(namedStat.size,BigInt(expected.bytes));assert.match(expected.sha256,/^[a-f0-9]{64}$/);
  const fd=fs.openSync(file,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd,{bigint:true}),pinned=identity(before);
    const comparable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>process.platform!=='win32'||key!=='dev'));
    assert.deepEqual(comparable(pinned),comparable(named));
    fs.fsyncSync(fd); // Failure is never ignored or rewritten as success.
    assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),pinned);
    assert.deepEqual(identity(fs.lstatSync(file,{bigint:true})),named);
    const hash=createHash('sha256'),buffer=Buffer.alloc(262144);let bytes=0;
    for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;
      bytes+=count;assert.ok(bytes<=expected.bytes);hash.update(buffer.subarray(0,count));}
    assert.equal(bytes,expected.bytes);const sha256=hash.digest('hex');assert.equal(sha256,expected.sha256);
    assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),pinned);
    assert.deepEqual(identity(fs.lstatSync(file,{bigint:true})),named);
    return {bytes,sha256,identity:{...named,descriptorDevice:pinned.dev}};
  }finally{fs.closeSync(fd);}
}
