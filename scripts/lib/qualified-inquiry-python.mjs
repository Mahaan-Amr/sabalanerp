/** Offline private interpreter bytes; no donor /usr overlay or application rebuild. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';

const sha=raw=>createHash('sha256').update(raw).digest('hex');
const root='D:/sabalanerp-online-qa/cpython-host-sysroot-998cce91d3d85250d54c330e42bd96df';
const pins={receipt:'474dae1c2f13cbe81a8d3d28a8dcaae721d37bd7244790e99bff99dd37438487',qualification:'234265c34dfb5514f2cc8357f4c770d91576e6da387997eec91854f800feb918',archive:'2738829736fdb1cdd16133de5f9e5b31c800dfcde2990d41f850d98237f13d45'};
function expectedFiles(inventory){
 const expected=new Map(Object.entries(inventory.files));
 function resolve(name,seen=new Set()){
  assert.ok(!seen.has(name),'PYTHON_ALIAS_CYCLE');seen.add(name);
  if(inventory.files[name])return inventory.files[name];
  const link=inventory.links[name];assert.equal(typeof link,'string','PYTHON_ALIAS_UNKNOWN');
  return resolve(path.posix.resolve(path.posix.dirname(name),link),seen);
 }
 for(const name of Object.keys(inventory.links))expected.set(name,resolve(name));
 assert.ok(expected.size>0&&expected.size<=2000);
 for(const [name,row]of expected){assert.ok(name.startsWith('/')&&path.posix.normalize(name)===name&&!name.includes('\\'));assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=64*1024**2);assert.match(row.sha256,/^[a-f0-9]{64}$/);}
 return expected;
}
export function decodeQualifiedPythonArchive(compressed,inventory){
 assert.ok(Buffer.isBuffer(compressed)&&compressed.length<=32*1024**2);
 const archive=gunzipSync(compressed,{maxOutputLength:128*1024**2}),expected=expectedFiles(inventory),files=new Map();
 const text=buffer=>buffer.toString('utf8').split('\0')[0];
 const octal=buffer=>{const value=buffer.toString('ascii').replace(/\0.*$/,'').trim();assert.match(value,/^[0-7]+$/);return Number.parseInt(value,8);};
 let offset=0,ended=false,pax=false;
 while(offset+512<=archive.length){
  const header=archive.subarray(offset,offset+512);
  if(header.every(value=>value===0)){assert.ok(archive.subarray(offset).every(value=>value===0));ended=true;break;}
  assert.equal(octal(header.subarray(148,156)),header.reduce((sum,value,i)=>sum+(i>=148&&i<156?32:value),0));
  if(header[156]===120){
   const length=octal(header.subarray(124,136));assert.ok(!pax&&length<=64&&offset+512+length<=archive.length,'PYTHON_PAX_BOUND');
   const body=archive.subarray(offset+512,offset+512+length),match=body.toString('ascii').match(/^([1-9][0-9]*) mtime=[0-9]+(?:\.[0-9]+)?\n$/);
   assert.ok(match&&Number(match[1])===length,'PYTHON_PAX_MTIME_ONLY');pax=true;offset+=512+Math.ceil(length/512)*512;continue;
  }
  assert.ok(header[156]===0||header[156]===48,'PYTHON_ARCHIVE_REGULAR_ONLY');pax=false;
  const prefix=text(header.subarray(345,500)),name=(prefix?prefix+'/':'')+text(header.subarray(0,100));
  assert.ok(name&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..'),'PYTHON_ARCHIVE_PATH');
  const row=expected.get('/'+name),bytes=octal(header.subarray(124,136));assert.ok(row&&!files.has(name),'PYTHON_ARCHIVE_UNEXPECTED');
  assert.equal(bytes,row.bytes);assert.ok(offset+512+bytes<=archive.length);
  const body=archive.subarray(offset+512,offset+512+bytes);assert.equal(sha(body),row.sha256,'PYTHON_ARCHIVE_BYTES_CHANGED');files.set(name,body);
  offset+=512+Math.ceil(bytes/512)*512;
 }
 assert.ok(ended&&!pax&&files.size===expected.size,'PYTHON_ARCHIVE_INCOMPLETE');return files;
}
export function readQualifiedInquiryPython(){
 const files={receipt:root+'/receipt.json',qualification:root+'/qualification-r5.json',archive:root+'/sysroot.tgz'},raw={};
 for(const [role,file]of Object.entries(files)){assert.equal(path.resolve(fs.realpathSync(file)),path.resolve(file));assert.ok(fs.lstatSync(file).isFile()&&fs.lstatSync(file).nlink===1);raw[role]=fs.readFileSync(file);assert.equal(sha(raw[role]),pins[role]);}
 const receipt=JSON.parse(raw.receipt),qualification=JSON.parse(raw.qualification);
 assert.equal(receipt.copiedInventoryVerified,true);assert.equal(receipt.originalClosure.allOriginalChildrenClosed,true);
 assert.equal(qualification.pass,true);assert.equal(qualification.extractionReceiptSha256,pins.receipt);assert.equal(qualification.originalClosure.allOriginalChildrenClosed,true);
 assert.equal(receipt.archive.bytes,raw.archive.length);assert.equal(receipt.archive.sha256,pins.archive);
 const content=decodeQualifiedPythonArchive(raw.archive,receipt.inventory);
 return {files,raw,content,proof:{format:'sabalan-offline-inquiry-python/v1',sourceImage:receipt.image.Id,extractionReceiptSha256:pins.receipt,extractionOriginalPass:receipt.pass,qualificationSha256:pins.qualification,qualificationPass:true,archiveSha256:pins.archive,archiveBytes:raw.archive.length,files:content.size,bytes:[...content.values()].reduce((sum,row)=>sum+row.length,0),prefix:'/app/online-runtime/python',productionAdmission:false}};
}
export function materializeQualifiedInquiryPython(runtime){
 const input=readQualifiedInquiryPython(),destination=path.join(runtime,'python');assert.equal(fs.existsSync(destination),false);fs.mkdirSync(destination);
 for(const [relative,raw]of input.content){const file=path.join(destination,relative);assert.ok(file.startsWith(destination+path.sep));fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw,{flag:'wx'});}
 const prefix='/app/online-runtime/python',libraries=['usr/bin','etc/python3.11','usr/lib/x86_64-linux-gnu','lib/x86_64-linux-gnu','lib64'].map(name=>prefix+'/'+name).join(':');
 const wrapper='#!/bin/sh\nexec '+prefix+'/usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2 --library-path '+libraries+' '+prefix+'/usr/bin/python3.11 "$@"\n';
 fs.writeFileSync(path.join(runtime,'python3'),wrapper,{flag:'wx'});
 fs.writeFileSync(path.join(runtime,'offline-python-extraction.json'),input.raw.receipt,{flag:'wx'});fs.writeFileSync(path.join(runtime,'offline-python-qualification.json'),input.raw.qualification,{flag:'wx'});
 fs.writeFileSync(path.join(runtime,'offline-python.json'),JSON.stringify(input.proof)+'\n',{flag:'wx'});return input.proof;
}
