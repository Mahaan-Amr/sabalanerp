/** Exact closed negative-operation bytes. This module grants no runtime admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const childKeys=['format','argv','inputSha256','inputBase64','originalPid','code','signal','stdoutEof','stderrEof','interrupted','stdoutBase64','stderrBase64','stdoutSha256','stderrSha256'].sort();
export function createNegativeEvidenceReader(){
 const inputs=new Map(),streaming=new Map();
 function read(ref){
  assert.deepEqual(Object.keys(ref).sort(),['file','sha256']);assert.ok(path.isAbsolute(ref.file));assert.match(ref.sha256,/^[a-f0-9]{64}$/);
  const file=path.resolve(ref.file);assert.equal(fs.realpathSync(file),file,'NEGATIVE_EVIDENCE_ALIAS');
  const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>=0n&&before.size<=16n*1024n**2n,'NEGATIVE_EVIDENCE_FILE_REQUIRED');
  const fd=fs.openSync(file,fs.constants.O_RDONLY);let raw;
  try{const opened=fs.fstatSync(fd,{bigint:true});for(const k of ['ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(opened[k],before[k],'NEGATIVE_EVIDENCE_OPEN_CHANGED');raw=fs.readFileSync(fd);const after=fs.fstatSync(fd,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(opened[k],after[k],'NEGATIVE_EVIDENCE_READ_CHANGED');}
  finally{fs.closeSync(fd);}
  const after=fs.lstatSync(file,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(before[k],after[k],'NEGATIVE_EVIDENCE_PATH_CHANGED');assert.equal(sha(raw),ref.sha256,'NEGATIVE_EVIDENCE_HASH_CHANGED');
  if(inputs.has(file)){assert.deepEqual(inputs.get(file).raw,raw,'NEGATIVE_EVIDENCE_REOBSERVED_CHANGED');for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(inputs.get(file).identity[key],before[key],'NEGATIVE_EVIDENCE_IDENTITY_CHANGED');}inputs.set(file,{raw,sha256:ref.sha256,identity:before});return raw;
 }
 function readStream(ref){
  assert.ok(['archive','source-snapshot','archive-inventory'].includes(ref.kind));assert.deepEqual(Object.keys(ref).sort(),(ref.kind==='source-snapshot'?['bytes','file','kind','originalPath','sha256']:['bytes','file','kind','sha256']).sort());assert.ok(path.isAbsolute(ref.file));assert.match(ref.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=(ref.kind==='archive'?4*1024**3:64*1024**2),'FINITE_NEGATIVE_STREAM_BYTE_BOUND');
  if(ref.kind==='archive-inventory'){assert.equal(ref.bytes,42144060,'EXACT_CURRENT_C16_INVENTORY_BYTES');assert.equal(ref.sha256,'70968d0900e5bb463d6ac35b1b455ff2a01f7837da666500ebf07e1418271197','EXACT_CURRENT_C16_INVENTORY_HASH');}
  if(ref.kind==='source-snapshot'){assert.equal(ref.bytes,52193462,'EXACT_CURRENT_C16_LARGE_SOURCE_BYTES');assert.ok(path.isAbsolute(ref.originalPath));assert.ok(ref.originalPath.replaceAll('\\','/').endsWith('/host-pack/deploy/scripts/online-release-host-dependencies/node_modules/@prisma/client/index.d.ts'),'EXACT_CURRENT_C16_LARGE_SOURCE_REQUIRED');}
  const file=path.resolve(ref.file);assert.equal(fs.realpathSync(file),file);const before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n);assert.equal(before.size,BigInt(ref.bytes));
  const fd=fs.openSync(file,fs.constants.O_RDONLY);let total=0;const hash=createHash('sha256');
  try{const opened=fs.fstatSync(fd,{bigint:true});for(const key of ['ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(opened[key],before[key]);const chunk=Buffer.alloc(262144);for(;;){const count=fs.readSync(fd,chunk,0,chunk.length,null);if(!count)break;total+=count;assert.ok(total<=ref.bytes);hash.update(chunk.subarray(0,count));}const after=fs.fstatSync(fd,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(opened[key],after[key]);}
  finally{fs.closeSync(fd);}
  const after=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(before[key],after[key]);assert.equal(total,ref.bytes);assert.equal(hash.digest('hex'),ref.sha256,'NEGATIVE_ARCHIVE_HASH_CHANGED');if(streaming.has(file)){assert.deepEqual(streaming.get(file).ref,ref);for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(streaming.get(file).identity[key],before[key],'NEGATIVE_ARCHIVE_IDENTITY_CHANGED');}streaming.set(file,{ref:structuredClone(ref),identity:before});const all=[...streaming.values()].map(v=>v.ref);assert.ok(all.filter(v=>v.kind==='archive').length<=3&&all.filter(v=>v.kind==='source-snapshot').length<=1&&all.filter(v=>v.kind==='archive-inventory').length<=1&&all.reduce((n,v)=>n+v.bytes,0)<=12*1024**3+128*1024**2,'FINITE_CURRENT_C16_STREAM_BOUND');return{bytes:ref.bytes,sha256:ref.sha256};
 }
 return Object.freeze({read,readStream,json:ref=>JSON.parse(read(ref)),inputs:()=>Object.fromEntries([...inputs].map(([file,row])=>[file,row.sha256])),streamingInputs:()=>Object.fromEntries([...streaming].map(([file,row])=>{const {file:unused,...reference}=row.ref;return[file,structuredClone(reference)];})),recheck:()=>{for(const [file,row]of inputs)assert.deepEqual(read({file,sha256:row.sha256}),row.raw);for(const row of streaming.values())readStream(row.ref);}});
}
export function decodeClosedNegativeChild(row,expectedArgv,expectedInput=null,allowedCodes=[0]){
 assert.deepEqual(Object.keys(row).sort(),childKeys,'NEGATIVE_CHILD_SCHEMA');assert.equal(row.format,'sabalan-c16-original-child/v1');assert.deepEqual(row.argv,expectedArgv,'NEGATIVE_CHILD_ARGV');assert.ok(expectedArgv.length>0&&expectedArgv.every(v=>typeof v==='string'));
 assert.equal(row.inputSha256,expectedInput===null?null:sha(expectedInput),'NEGATIVE_CHILD_INPUT');
 assert.equal(row.inputBase64,expectedInput===null?null:Buffer.from(expectedInput).toString('base64'),'NEGATIVE_CHILD_INPUT_BYTES');
 assert.ok(Number.isSafeInteger(row.originalPid)&&row.originalPid>0,'NEGATIVE_CHILD_PID');assert.ok(allowedCodes.includes(row.code),'NEGATIVE_CHILD_CODE');assert.equal(row.signal,null);assert.equal(row.stdoutEof,true);assert.equal(row.stderrEof,true);assert.equal(row.interrupted,false);
 const output={};for(const stream of ['stdout','stderr']){const encoded=row[stream+'Base64'];assert.equal(typeof encoded,'string');const bytes=Buffer.from(encoded,'base64');assert.equal(bytes.toString('base64'),encoded,'NEGATIVE_CHILD_ENCODING');assert.match(row[stream+'Sha256'],/^[a-f0-9]{64}$/);assert.equal(sha(bytes),row[stream+'Sha256'],'NEGATIVE_CHILD_STREAM_HASH');output[stream]=bytes;}
 return output;
}
