/** Immutable file data only; never a resource lease or completion token. */
import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{createHash}from'node:crypto';
export const completePlanSha=raw=>createHash('sha256').update(raw).digest('hex');
const stamp=s=>['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>String(s[k])).join(':');
function checkedPlanFile(ref,maximum,consumeBytes,expectedNamed,verificationBuffer){
 assert.equal(path.resolve(ref.file),ref.file);assert.equal(fs.realpathSync(ref.file),ref.file);assert.match(ref.sha256,/^[a-f0-9]{64}$/);assert.ok(Number.isSafeInteger(maximum)&&maximum>0);
 const fd=fs.openSync(ref.file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(ref.file,{bigint:true});
  assert.ok(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(maximum));
  for(const key of ['ino','mode','nlink','size','mtimeNs','ctimeNs'])assert.equal(before[key],named[key]);if(process.platform!=='win32')assert.equal(before.dev,named.dev);
  if(expectedNamed)assert.equal(stamp(named),stamp(expectedNamed));
  let raw;
  if(consumeBytes){raw=fs.readFileSync(fd);assert.equal(raw.length,Number(before.size));assert.equal(completePlanSha(raw),ref.sha256);}
  else{
   const buffer=verificationBuffer,hash=createHash('sha256');let bytes=0;
   for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;bytes+=count;assert.ok(bytes<=Number(before.size));hash.update(buffer.subarray(0,count));}
   assert.equal(bytes,Number(before.size));assert.equal(hash.digest('hex'),ref.sha256);
  }
  assert.equal(stamp(before),stamp(fs.fstatSync(fd,{bigint:true})));assert.equal(stamp(named),stamp(fs.lstatSync(ref.file,{bigint:true})));
  return{raw,named};
 }finally{fs.closeSync(fd);}
}
export function completePlanReader(){
 const held=[];let verificationBuffer;
 const buffer=()=>verificationBuffer??=Buffer.alloc(1024*1024);
 function inspect(reference,maximum,consumeBytes){
  const ref={file:reference.file,sha256:reference.sha256},value=checkedPlanFile(ref,maximum,consumeBytes,undefined,consumeBytes?undefined:buffer());
  held.push({ref,maximum,named:value.named});return value.raw;
 }
 return{read(ref,maximum=32*1024**2){return inspect(ref,maximum,true);},verify(ref,maximum=32*1024**2){inspect(ref,maximum,false);},revalidate(){for(const item of held)checkedPlanFile(item.ref,item.maximum,false,item.named,buffer());}};
}
export function writeCompletePlanFile(directory,name,raw){assert.ok(Buffer.isBuffer(raw));assert.ok(name&&!name.startsWith('/')&&!name.includes('\\')&&name.split('/').every(p=>p&&p!=='.'&&p!=='..'));const file=path.join(directory,...name.split('/'));fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);try{let n=0;while(n<raw.length){const z=fs.writeSync(fd,raw.subarray(n));assert.ok(z>0);n+=z;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.equal(completePlanSha(fs.readFileSync(file)),completePlanSha(raw));return{file,sha256:completePlanSha(raw),bytes:raw.length};}
