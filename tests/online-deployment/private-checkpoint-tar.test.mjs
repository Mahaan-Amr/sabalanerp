import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{createHash}from'node:crypto';
import{writePrivateFileTar,extractPrivateFileTar}from'../../scripts/lib/private-checkpoint-tar.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
test('bounded tar transports exact empty/binary bytes and refuses same-size corruption',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-tar-'));
 try{
  const raws=[Buffer.alloc(0),Buffer.from([0,255,0,17,128])],entries=raws.map((raw,index)=>{const file=path.join(root,'source-'+index);fs.writeFileSync(file,raw);return{name:'row-'+String(index).padStart(6,'0'),file,bytes:raw.length,sha256:sha(raw)};});
  const archive=path.join(root,'files.tar');await writePrivateFileTar({archive,entries});
  const outputs=entries.map((row,index)=>({...row,file:path.join(root,'output-'+index)}));await extractPrivateFileTar({archive,entries:outputs});for(let i=0;i<raws.length;i++)assert.deepEqual(fs.readFileSync(outputs[i].file),raws[i]);
  fs.chmodSync(archive,0o600);const raw=fs.readFileSync(archive);raw[1024]^=1;fs.writeFileSync(archive,raw);
  await assert.rejects(extractPrivateFileTar({archive,entries:entries.map((row,index)=>({...row,file:path.join(root,'corrupted-'+index)}))}));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('a tar header cannot redirect extraction and an aliased source is refused',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'checkpoint-tar-path-'));
 try{
  const file=path.join(root,'source');fs.writeFileSync(file,'private');const row={name:'row-000000',file,bytes:7,sha256:sha(Buffer.from('private'))};
  const archive=path.join(root,'files.tar');await writePrivateFileTar({archive,entries:[row]});
  const raw=fs.readFileSync(archive);raw.fill(0,0,100);raw.write('../escape',0);raw.fill(32,148,156);const checksum=raw.subarray(0,512).reduce((a,b)=>a+b,0);raw.write(checksum.toString(8).padStart(6,'0')+'\0 ',148);fs.writeFileSync(archive,raw);
  await assert.rejects(extractPrivateFileTar({archive,entries:[{...row,file:path.join(root,'output')}]}));assert.equal(fs.existsSync(path.join(root,'output')),false);
  const alias=path.join(root,'source-alias');fs.linkSync(file,alias);await assert.rejects(writePrivateFileTar({archive:path.join(root,'aliased.tar'),entries:[{...row,file:alias}]}));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
