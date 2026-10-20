import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHash} from 'node:crypto';
import {stableBackendBaseFile} from './lib/production-backend-base-artifacts.mjs';
import {privateLinuxPrismaIdentity as identity,assertPrivateLinuxPrismaController} from './lib/private-linux-prisma-receipt.mjs';
import {schemaTokens,schemaTokenDigest} from './lib/prisma-schema-tokens.mjs';
const repository=path.resolve(import.meta.dirname,'..'),sha=b=>createHash('sha256').update(b).digest('hex');
const [mode='--inspect',argument]=process.argv.slice(2);assert.ok(['--inspect','--extract'].includes(mode));
if(mode==='--inspect'){
 assert.ok(process.argv.length<=3);console.log(JSON.stringify({mode,...identity,extractionExecuted:false,dockerExecuted:false,databaseConnected:false,productionAdmission:false}));
}else{
 assert.equal(process.argv.length,4);
 const receipt=path.join(repository,'reports/qa',identity.operation+'.json');assert.equal(path.resolve(argument),receipt);
 const rawReceiptFile=stableBackendBaseFile(receipt,128*1024**2),rawBytes=fs.readFileSync(receipt);assert.equal(sha(rawBytes),rawReceiptFile.sha256);
 const raw=JSON.parse(rawBytes);assert.equal(raw.sshExitCode,0);assert.equal(raw.remoteEnvelopeSha256,identity.remoteEnvelopeSha256);
 const envelope=path.resolve('D:/sabalanerp-online-qa',identity.operation+'-remote.py'),envelopeFile=stableBackendBaseFile(envelope);
 assert.equal(envelopeFile.sha256,identity.remoteEnvelopeSha256);
 const sourcePath=path.join(repository,'backend/prisma/schema.prisma'),sourceFile=stableBackendBaseFile(sourcePath),source=fs.readFileSync(sourcePath);
 const controller=JSON.parse(raw.stdout),{generation,transformed}=assertPrivateLinuxPrismaController(controller,source);
 assert.equal(typeof controller.archiveBase64,'string');assert.ok(controller.archiveBase64.length<=Math.ceil(64*1024**2/3)*4);
 const compressed=Buffer.from(controller.archiveBase64,'base64');assert.equal(compressed.toString('base64'),controller.archiveBase64);
 assert.equal(compressed.length,controller.archive.compressedBytes);assert.equal(sha(compressed),controller.archive.compressedSha256);
 const root=path.resolve('D:/sabalanerp-online-qa',identity.operation),client=path.join(root,'client');
 assert.equal(fs.existsSync(root),false,'PRIVATE_LINUX_EXTRACTION_DESTINATION_EXISTS');
 const space=fs.statfsSync('D:/',{bigint:true});assert.ok(space.bavail*space.bsize>=BigInt(controller.archive.compressedBytes+controller.archive.rawBytes+generation.totalBytes+128*1024**2));
 fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(client,{mode:0o700});
 const compressedPath=path.join(root,'client.tar.gz'),rawPath=path.join(root,'client.tar');
 function write(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
 write(compressedPath,compressed);
 const rawFd=fs.openSync(rawPath,'wx',0o600),rawHash=createHash('sha256');let rawCount=0;
 try{
  for await(const chunk of fs.createReadStream(compressedPath).pipe(zlib.createGunzip())){
   rawCount+=chunk.length;assert.ok(rawCount<=controller.archive.rawBytes);rawHash.update(chunk);let at=0;
   while(at<chunk.length)at+=fs.writeSync(rawFd,chunk,at,chunk.length-at);
  }
  assert.equal(rawCount,controller.archive.rawBytes);assert.equal(rawHash.digest('hex'),controller.archive.rawSha256);fs.fsyncSync(rawFd);
 }finally{fs.closeSync(rawFd);}
 const tar=fs.openSync(rawPath,'r'),outputs={},seen=new Set();let position=0,total=0;
 const read=(size)=>{const buffer=Buffer.alloc(size);let at=0;while(at<size){const count=fs.readSync(tar,buffer,at,size-at,position+at);assert.ok(count>0,'PRIVATE_TAR_TRUNCATED');at+=count;}position+=size;return buffer;};
 const text=bytes=>bytes.toString('utf8').replace(/\0.*$/s,'');
 const octal=bytes=>{const value=text(bytes).trim();assert.match(value,/^[0-7]+$/);return parseInt(value,8);};
 try{
  for(;;){
   const header=read(512);if(header.every(byte=>byte===0)){
    assert.ok(read(512).every(byte=>byte===0),'PRIVATE_TAR_END_INVALID');
    while(position<rawCount)assert.ok(read(Math.min(262144,rawCount-position)).every(byte=>byte===0));break;
   }
   assert.equal(text(header.subarray(257,263)),'ustar');assert.equal(text(header.subarray(263,265)),'00');
   assert.ok(header[156]===0||header[156]===48,'PRIVATE_TAR_NON_REGULAR');assert.equal(text(header.subarray(157,257)),'');
   const checksum=octal(header.subarray(148,156));let sum=0;for(let n=0;n<512;n++)sum+=n>=148&&n<156?32:header[n];assert.equal(sum,checksum);
   const prefix=text(header.subarray(345,500)),name=(prefix?prefix+'/':'')+text(header.subarray(0,100));
   assert.match(name,/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)?$/);assert.ok(!name.split('/').some(part=>part==='.'||part==='..'));
   assert.ok(!seen.has(name));seen.add(name);assert.ok(seen.size<=2000);
   const expected=generation.files[name];assert.ok(expected,'PRIVATE_TAR_UNREPORTED_FILE');
   const size=octal(header.subarray(124,136));assert.equal(size,expected.bytes);assert.equal(octal(header.subarray(100,108)),0o400);
   total+=size;assert.ok(total<=256*1024**2);const file=path.join(client,name);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});assert.equal(fs.realpathSync(path.dirname(file)),path.dirname(file));
   const fd=fs.openSync(file,'wx',0o600),hash=createHash('sha256');let remaining=size;
   try{while(remaining){const bytes=read(Math.min(262144,remaining));remaining-=bytes.length;hash.update(bytes);let at=0;while(at<bytes.length)at+=fs.writeSync(fd,bytes,at,bytes.length-at);}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
   assert.equal(hash.digest('hex'),expected.sha256);const padding=(512-size%512)%512;if(padding)assert.ok(read(padding).every(byte=>byte===0));
   outputs[name]=stableBackendBaseFile(file);assert.equal(outputs[name].bytes,expected.bytes);assert.equal(outputs[name].sha256,expected.sha256);
  }
 }finally{fs.closeSync(tar);}
 assert.deepEqual([...seen].sort(),Object.keys(generation.files).sort());assert.equal(total,generation.totalBytes);
 const schema=fs.readFileSync(path.join(client,'schema.prisma'));assert.equal(sha(schema),generation.generatedSchemaSha256);
 assert.deepEqual(schemaTokens(schema.toString('utf8')),schemaTokens(transformed.toString('utf8')));assert.equal(schemaTokenDigest(schema.toString('utf8')),generation.generatedSchemaTokensSha256);
 const inline=fs.readFileSync(path.join(client,'index.js'),'utf8').split(/\r?\n/).filter(line=>line.trimStart().startsWith('"inlineSchema":'));
 assert.equal(inline.length,1);assert.equal(JSON.parse(inline[0].trim().slice('"inlineSchema":'.length).replace(/,$/,'')),schema.toString('utf8'));
 for(const[file,pinned]of [[receipt,rawReceiptFile],[envelope,envelopeFile],[sourcePath,sourceFile]])assert.deepEqual(stableBackendBaseFile(file),pinned);
 const report={format:'sabalan-private-linux-prisma-local-extraction/v1',operation:identity.operation,root,client,rawReceiptFile,remoteEnvelopeSha256:identity.remoteEnvelopeSha256,
  archives:{compressed:{path:compressedPath,...stableBackendBaseFile(compressedPath)},raw:{path:rawPath,...stableBackendBaseFile(rawPath)}},outputs,
  generationOnly:true,pass:true,databaseConnected:false,runtimeStarted:false,productionAdmission:false,originalSSHExitCode:0};
 const extractionReceipt=path.join(root,'local-extraction-receipt.json');write(extractionReceipt,Buffer.from(JSON.stringify(report,null,2)+'\n'));
 console.log(JSON.stringify({pass:true,extractionReceipt,receiptSha256:stableBackendBaseFile(extractionReceipt).sha256,files:seen.size,bytes:total,databaseConnected:false,productionAdmission:false}));
}
