import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const moduleUrl=pathToFileURL(path.resolve('scripts/lib/original-complete-plan-files.mjs')).href;
test('many verification-only files share the bounded resident budget',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bounded-complete-many-'));
 const program=String.raw`
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{createHash}from'node:crypto';
const{completePlanReader}=await import(process.argv[1]),directory=process.argv[2],bytes=Buffer.from('owned verification bytes'),sha256=createHash('sha256').update(bytes).digest('hex');
for(let i=0;i<4096;i++)fs.writeFileSync(path.join(directory,i+'.bin'),bytes);
const baseline=process.resourceUsage().maxRSS,reader=completePlanReader();for(let i=0;i<4096;i++)reader.verify({file:path.join(directory,i+'.bin'),sha256});reader.revalidate();
const peak=process.resourceUsage().maxRSS;assert.ok((peak-baseline)*1024<32*1024**2,'MANY_FILE_RESIDENT_GROWTH_EXCEEDS_32_MIB');console.log(JSON.stringify({files:4096,baselineResidentKiB:baseline,peakResidentKiB:peak,qualificationAccepted:false}));`;
 try{
  const child=spawnSync(process.execPath,['--max-old-space-size=32','--input-type=module','-e',program,moduleUrl,directory],{encoding:'utf8',windowsHide:true,maxBuffer:65536});
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);assert.equal(JSON.parse(child.stdout).files,4096);console.log(child.stdout.trim());
 }finally{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.equal(fs.realpathSync(directory),directory);fs.rmSync(directory,{recursive:true});}
});
test('actual files reject tampering and close every descriptor on success or refusal',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bounded-complete-tamper-'));
 const program=String.raw`
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';import vm from'node:vm';
const{completePlanReader}=await import(process.argv[1]),directory=process.argv[2],mode=process.argv[3],file=path.join(directory,mode+'.bin'),bytes=Buffer.from('globalThis.checkedValue = 7;\n'),sha=raw=>createHash('sha256').update(raw).digest('hex');fs.writeFileSync(file,bytes);
const reference={file,sha256:sha(bytes)},reader=completePlanReader(),opened=new Set(),open=fs.openSync,close=fs.closeSync,read=fs.readSync;let changed=false;
fs.openSync=(target,...args)=>{const fd=open(target,...args);if(target===file)opened.add(fd);return fd;};fs.closeSync=fd=>{close(fd);opened.delete(fd);};
fs.readSync=(fd,buffer,offset,length,position)=>{if(opened.has(fd)&&mode==='read-error')throw Error('OWNED_READ_FAILED');const n=read(fd,buffer,offset,mode==='short-read'?Math.min(length,7):length,position);if(opened.has(fd)&&n&&!changed){changed=true;if(mode==='mutate')fs.writeFileSync(file,Buffer.alloc(bytes.length,88));if(mode==='replace'){fs.renameSync(file,file+'.previous');fs.writeFileSync(file,bytes);}}return n;};
if(mode==='mutate'||mode==='replace'||mode==='read-error')assert.throws(()=>reader.verify(reference));
else if(mode==='hardlink'){fs.linkSync(file,file+'.link');assert.throws(()=>reader.verify(reference));}
else if(mode==='size-limit')assert.throws(()=>reader.verify(reference,bytes.length-1));
else if(mode==='changed-digest')assert.throws(()=>reader.verify({...reference,sha256:'a'.repeat(64)}));
else if(mode==='revalidate'){reader.verify(reference);fs.writeFileSync(file,Buffer.alloc(bytes.length,89));assert.throws(()=>reader.revalidate());}
else if(mode==='consumed-bytes'){const raw=reader.read(reference);assert.deepEqual(raw,bytes);fs.writeFileSync(file,'globalThis.checkedValue = 99;');const context={};vm.runInNewContext(raw.toString(),context);assert.equal(context.checkedValue,7);assert.throws(()=>reader.revalidate());}
else{reader.verify(reference);reader.revalidate();assert.equal(mode,'short-read');}
assert.equal(opened.size,0);console.log(JSON.stringify({mode,allOwnedDescriptorsClosed:true,qualificationAccepted:false}));`;
 try{
  for(const mode of ['short-read','mutate','replace','read-error','hardlink','size-limit','changed-digest','revalidate','consumed-bytes']){
   const child=spawnSync(process.execPath,['--max-old-space-size=32','--input-type=module','-e',program,moduleUrl,directory,mode],{encoding:'utf8',windowsHide:true,maxBuffer:65536});
   assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,mode+': '+child.stderr);assert.equal(JSON.parse(child.stdout).allOwnedDescriptorsClosed,true);
  }
 }finally{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.equal(fs.realpathSync(directory),directory);fs.rmSync(directory,{recursive:true});}
});
test('actual finite verifier hashes a large file and revalidates with bounded resident memory',()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'bounded-complete-files-'));
 const program=String.raw`
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{createHash}from'node:crypto';
const{completePlanReader}=await import(process.argv[1]),mode=process.argv[3],file=path.join(process.argv[2],'large-'+mode+'.bin'),chunk=Buffer.alloc(1024*1024,91),hash=createHash('sha256');
const fd=fs.openSync(file,'wx');try{for(let i=0;i<128;i++){fs.writeSync(fd,chunk);hash.update(chunk);}}finally{fs.closeSync(fd);}
const reference={file,sha256:hash.digest('hex')},baseline=process.resourceUsage().maxRSS,reader=completePlanReader();let consumed;if(mode==='control')consumed=reader.read(reference,128*1024**2);else reader.verify(reference,128*1024**2);reader.revalidate();if(consumed)assert.equal(consumed.length,128*1024**2);
const peak=process.resourceUsage().maxRSS,growth=(peak-baseline)*1024;assert.ok(mode==='control'?growth>=80*1024**2:growth<48*1024**2,'RESIDENT_MEASUREMENT_BOUND_OR_CONTROL_FAILED');
console.log(JSON.stringify({mode,baselineResidentKiB:baseline,peakResidentKiB:peak,fileBytes:128*1024**2,verifiedTwice:true,qualificationAccepted:false}));`;
 try{
  for(const mode of ['bounded','control']){
   const child=spawnSync(process.execPath,['--max-old-space-size=32','--input-type=module','-e',program,moduleUrl,directory,mode],{encoding:'utf8',windowsHide:true,maxBuffer:65536});
   assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
   const result=JSON.parse(child.stdout);assert.equal(result.fileBytes,134217728);assert.equal(result.verifiedTwice,true);assert.equal(result.qualificationAccepted,false);console.log(JSON.stringify(result));
  }
 }finally{assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));assert.equal(fs.realpathSync(directory),directory);fs.rmSync(directory,{recursive:true});}
});
