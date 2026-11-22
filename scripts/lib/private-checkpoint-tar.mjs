/** A deliberately small USTAR dialect, never general archive extraction. */
import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';
const BLOCK=512,CHUNK=262144,MAX=16*1024**3;
// Windows named stat reports device 0 while its descriptor reports the actual
// volume. The canonical real path + inode/times remain required on that host.
const identity=s=>[...(process.platform==='win32'?[]:['dev']),'ino','size','mtimeNs','ctimeNs','nlink'].map(key=>String(s[key])).join(':');
function entriesValid(entries){assert.ok(Array.isArray(entries)&&entries.length>=1&&entries.length<=512);const names=new Set(),files=new Set();for(const row of entries){assert.match(row.name,/^row-[0-9]{6}(?:\.sabrec)?$/);assert.ok(!names.has(row.name)&&!files.has(row.file));names.add(row.name);files.add(row.file);assert.equal(path.resolve(row.file),row.file);assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=MAX+65536);assert.match(row.sha256,/^[a-f0-9]{64}$/);}}
const octal=(value,length)=>{const text=value.toString(8);assert.ok(text.length<length);return text.padStart(length-1,'0')+'\0';};
function header(row){const raw=Buffer.alloc(BLOCK);raw.write(row.name,0,'ascii');raw.write(octal(0o400,8),100,'ascii');raw.write(octal(0,8),108,'ascii');raw.write(octal(0,8),116,'ascii');raw.write(octal(row.bytes,12),124,'ascii');raw.write(octal(0,12),136,'ascii');raw.fill(32,148,156);raw[156]=48;raw.write('ustar\0',257,'ascii');raw.write('00',263,'ascii');const sum=raw.reduce((a,b)=>a+b,0);raw.write(sum.toString(8).padStart(6,'0')+'\0 ',148,'ascii');return raw;}
function number(raw,start,length){const text=raw.subarray(start,start+length).toString('ascii').replace(/[\0 ]+$/,'');assert.match(text,/^[0-7]+$/);const value=parseInt(text,8);assert.ok(Number.isSafeInteger(value));return value;}
async function writeAll(file,raw){let offset=0;while(offset<raw.length){const result=await file.write(raw,offset,raw.length-offset);assert.ok(result.bytesWritten>0);offset+=result.bytesWritten;}}
async function readExact(file,length){const raw=Buffer.alloc(length);let offset=0;while(offset<length){const result=await file.read(raw,offset,length-offset);assert.ok(result.bytesRead>0,'CHECKPOINT_TAR_TRUNCATED');offset+=result.bytesRead;}return raw;}
async function pin(file){assert.equal(await fs.promises.realpath(file),file);const s=await fs.promises.lstat(file,{bigint:true});assert.ok(s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n);return s;}
export async function writePrivateFileTar({archive,entries}){
 entriesValid(entries);assert.equal(path.resolve(archive),archive);assert.equal(await fs.promises.realpath(path.dirname(archive)),path.dirname(archive));
 const output=await fs.promises.open(archive,'wx',0o600);let bytes=0;
 try{
  for(const row of entries){const before=await pin(row.file);assert.equal(Number(before.size),row.bytes);const input=await fs.promises.open(row.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{
   assert.equal(identity(await input.stat({bigint:true})),identity(before));await writeAll(output,header(row));bytes+=BLOCK;const digest=createHash('sha256'),buffer=Buffer.alloc(CHUNK);let read=0;
   while(read<row.bytes){const value=await input.read(buffer,0,Math.min(CHUNK,row.bytes-read));assert.ok(value.bytesRead>0);const raw=buffer.subarray(0,value.bytesRead);digest.update(raw);await writeAll(output,raw);read+=raw.length;bytes+=raw.length;}
   assert.equal((await input.read(Buffer.alloc(1),0,1)).bytesRead,0);assert.equal(digest.digest('hex'),row.sha256);assert.equal(identity(await input.stat({bigint:true})),identity(before));assert.equal(identity(await pin(row.file)),identity(before));
   const padding=(BLOCK-row.bytes%BLOCK)%BLOCK;if(padding){await writeAll(output,Buffer.alloc(padding));bytes+=padding;}
  }finally{await input.close();}}
  await writeAll(output,Buffer.alloc(BLOCK*2));bytes+=BLOCK*2;await output.sync();
 }finally{await output.close();}
 const actual=await pin(archive);assert.equal(Number(actual.size),bytes);return{archive,bytes};
}
export async function extractPrivateFileTar({archive,entries}){
 entriesValid(entries);const before=await pin(archive);assert.ok(before.size<=BigInt(entries.reduce((sum,row)=>sum+row.bytes+BLOCK*2,0)+BLOCK*22));
 const input=await fs.promises.open(archive,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{
  assert.equal(identity(await input.stat({bigint:true})),identity(before));
  for(const row of entries){const raw=await readExact(input,BLOCK);assert.equal(raw[156],48);assert.equal(raw.subarray(257,263).toString('ascii'),'ustar\0');assert.equal(raw.subarray(263,265).toString('ascii'),'00');assert.ok(raw.subarray(345,500).every(value=>value===0),'CHECKPOINT_TAR_PREFIX_REFUSED');
   const nul=raw.indexOf(0);assert.ok(nul>0&&nul<=100);assert.ok(raw.subarray(nul,100).every(value=>value===0));assert.equal(raw.subarray(0,nul).toString('ascii'),row.name);assert.equal(number(raw,124,12),row.bytes);assert.equal(number(raw,108,8),0);assert.equal(number(raw,116,8),0);
   const expected=number(raw,148,8),checked=Buffer.from(raw);checked.fill(32,148,156);assert.equal(checked.reduce((a,b)=>a+b,0),expected);assert.ok(raw.subarray(157,257).every(value=>value===0),'CHECKPOINT_TAR_LINK_REFUSED');
   assert.equal(await fs.promises.realpath(path.dirname(row.file)),path.dirname(row.file));const out=await fs.promises.open(row.file,'wx',0o600);const digest=createHash('sha256');try{
    let read=0;while(read<row.bytes){const data=await readExact(input,Math.min(CHUNK,row.bytes-read));digest.update(data);await writeAll(out,data);read+=data.length;}assert.equal(digest.digest('hex'),row.sha256);await out.sync();
   }finally{await out.close();}
   const padding=(BLOCK-row.bytes%BLOCK)%BLOCK;if(padding)assert.ok((await readExact(input,padding)).every(value=>value===0));
  }
  assert.ok((await readExact(input,BLOCK*2)).every(value=>value===0),'CHECKPOINT_TAR_EXTRA_ENTRY_REFUSED');
  let extra,total=0;const raw=Buffer.alloc(CHUNK);while((extra=await input.read(raw,0,raw.length)).bytesRead){total+=extra.bytesRead;assert.ok(total<=BLOCK*20&&raw.subarray(0,extra.bytesRead).every(value=>value===0),'CHECKPOINT_TAR_TRAILING_BYTES_REFUSED');}
  assert.equal(identity(await input.stat({bigint:true})),identity(before));assert.equal(identity(await pin(archive)),identity(before));return{files:entries.length};
 }finally{await input.close();}
}
