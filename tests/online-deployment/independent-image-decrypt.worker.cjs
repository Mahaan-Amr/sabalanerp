/** Original one-role host decryption using the unchanged canonical codec. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const pin=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].map(String).join(':');
function read(file,expected,maximum){assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o777n)===0o400n&&before.size>0n&&before.size<=BigInt(maximum));
  const raw=fs.readFileSync(fd);assert.equal(pin(fs.fstatSync(fd,{bigint:true})),pin(before));assert.equal(pin(fs.lstatSync(file,{bigint:true})),pin(before));assert.equal(sha(raw),expected);return raw;
 }finally{fs.closeSync(fd);}}
async function main(){assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);process.umask(0o077);assert.equal(process.argv.length,4);
 const configFile=process.argv[2],input=JSON.parse(read(configFile,process.argv[3],2*1024**2));
 assert.equal(input.format,'sabalan-original-independent-image-stage-input/v1');assert.match(input.operation,/^[a-f0-9]{32}$/);assert.ok(['backend','frontend','inquiry'].includes(input.role));
 const temporary='/dev/shm/sabalan-independent-image-'+input.operation+'-'+input.role;assert.equal(input.temporaryRoot,temporary);assert.equal(fs.realpathSync(temporary),temporary);
 const s=fs.lstatSync(temporary);assert.ok(s.isDirectory()&&s.uid===0&&(s.mode&0o777)===0o700);assert.deepEqual(fs.readdirSync(temporary),[]);
 const capacity=fs.statfsSync(temporary,{bigint:true});assert.equal(capacity.type,0x01021994n);assert.ok(capacity.bavail*capacity.bsize>=BigInt(input.archiveGraph.archiveBytes+16*1024**2));
 assert.equal(fs.realpathSync(input.cipherPath),input.cipherPath);const cipherBefore=fs.lstatSync(input.cipherPath,{bigint:true});assert.ok(cipherBefore.isFile()&&cipherBefore.uid===0n&&cipherBefore.nlink===1n&&(cipherBefore.mode&0o777n)===0o400n);
 read(input.codecPath,input.codecSha256,1024**2);const codec=require(input.codecPath);
 const metadata=JSON.parse(read(input.metadataPath,input.metadataSha256,1024**2));assert.equal(metadata.format,'sabalan-private-image-transfer/v1');assert.equal(metadata.healthyApplicationPoint,false);assert.equal(metadata.publicOnlineAdmission,false);
 const expected=metadata.encryption.images[input.role],record=metadata.images[input.role];assert.equal(expected.service,input.role);assert.equal(expected.sourceImageId,input.archiveGraph.index);
 assert.equal(expected.sourceSha256,input.archiveGraph.archiveSha256);assert.equal(expected.sourceBytes,input.archiveGraph.archiveBytes);
 assert.equal(record.cipherSha256,expected.cipherSha256);assert.equal(record.cipherBytes,expected.cipherBytes);assert.equal(Number(cipherBefore.size),expected.cipherBytes);
 assert.equal(await codec.sha256File(input.cipherPath),expected.cipherSha256);
 const key=read(input.privateKeyPath,input.privateKeySha256,65536).toString('utf8'),plain=path.join(temporary,input.role+'.oci.tar');
 // The canonical codec creates the actual OWN tmpfs file with wx and returns
 // only after full GCM authentication. No unauthenticated bytes reach Docker.
 await codec.decryptRecoveryArchive(input.cipherPath,plain,key);
 const fd=fs.openSync(plain,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.chmodSync(plain,0o400);
 assert.equal(fs.lstatSync(plain).size,expected.sourceBytes);assert.equal(await codec.sha256File(plain),expected.sourceSha256);
 assert.equal(pin(fs.lstatSync(input.cipherPath,{bigint:true})),pin(cipherBefore));assert.equal(await codec.sha256File(input.cipherPath),expected.cipherSha256);
 const parent=fs.openSync(temporary,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 console.log(JSON.stringify({format:'sabalan-original-independent-image-decryption/v1',operation:input.operation,role:input.role,plaintextPath:plain,
  plaintextBytes:expected.sourceBytes,plaintextSha256:expected.sourceSha256,cipherSha256:expected.cipherSha256,fullGcmAuthenticated:true,independentRsaDecryptVerified:true,productionAdmission:false}));
}
if(require.main===module)main().catch(()=>{console.error('ORIGINAL_INDEPENDENT_IMAGE_DECRYPTION_REFUSED');process.exitCode=1;});
