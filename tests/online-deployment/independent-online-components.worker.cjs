'use strict';
// Original independent component decryption. No Docker, serving, SQL or health
// authority. Actual physical replay and all application closures follow it.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const pin=s=>['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'].map(key=>String(s[key])).join(':');
const allowed=new Set(['physical-base','coherent-cut','coverage-manifest','inquiry-sqlite','coordination','wal-capture','versioned-file-cut','versioned-file-object','versioned-file-lineage','wal-segment']);
function validateOnlineSealedComponents(sealed,manifest,operation){
 assert.equal(sealed.format,'sabalan-online-checkpoint-components-sealed/v1');assert.equal(sealed.phase,'SEALED_LOCAL');assert.equal(sealed.operation,operation);
 assert.equal(manifest.format,'sabalan-online-checkpoint-plaintext-components/v1');assert.equal(manifest.operation,operation);assert.ok(hex(manifest.coverageSha256)&&hex(manifest.sourceCaptureSha256));
 assert.ok(Array.isArray(manifest.sources)&&manifest.sources.length>=15&&manifest.sources.length<=250000);assert.equal(sealed.objects.length,manifest.sources.length);
 const names=new Set(),paths=new Set(),cipherPaths=new Set(),counts={};
 manifest.sources.forEach((row,index)=>{
  assert.deepEqual(Object.keys(row).sort(),['bytes','name','path','role','sha256']);assert.ok(allowed.has(row.role));assert.match(row.name,/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,159}$/);
  assert.ok(!names.has(row.name)&&!paths.has(row.path));names.add(row.name);paths.add(row.path);
  assert.ok(path.posix.isAbsolute(row.path)&&path.posix.normalize(row.path)===row.path&&!/[\\\0]/.test(row.path));
  assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0&&row.bytes<=16*1024**3&&hex(row.sha256));
  if(!['versioned-file-object','versioned-file-lineage'].includes(row.role))assert.ok(row.bytes>0);
  const actual=sealed.objects[index];for(const key of Object.keys(row))assert.deepEqual(actual[key],row[key]);
  assert.ok(path.posix.isAbsolute(actual.cipherFile)&&path.posix.normalize(actual.cipherFile)===actual.cipherFile&&!/[\\\0]/.test(actual.cipherFile)&&!cipherPaths.has(actual.cipherFile));cipherPaths.add(actual.cipherFile);
  assert.ok(hex(actual.cipherSha256)&&Number.isSafeInteger(actual.cipherBytes)&&actual.cipherBytes>row.bytes&&actual.cipherBytes<=row.bytes+65536);assert.equal(actual.localDecryptVerified,true);
  counts[row.role]=(counts[row.role]??0)+1;
 });
 for(const role of ['physical-base','coherent-cut','coverage-manifest','inquiry-sqlite','coordination','wal-capture'])assert.equal(counts[role],1);
 assert.equal(counts['versioned-file-cut'],9);assert.ok(counts['wal-segment']>=1&&counts['wal-segment']<=8);
 assert.equal(manifest.sources.find(row=>row.role==='coherent-cut').sha256,manifest.sourceCaptureSha256);assert.equal(manifest.sources.find(row=>row.role==='coverage-manifest').sha256,manifest.coverageSha256);
 return sealed.objects;
}
function privateFile(file,expected,maximum){
 assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.uid===0n&&!(before.mode&0o077n)&&before.size>0n&&before.size<=BigInt(maximum));
  assert.equal(pin(fs.lstatSync(file,{bigint:true})),pin(before));const raw=fs.readFileSync(fd);assert.equal(sha(raw),expected);assert.equal(pin(fs.fstatSync(fd,{bigint:true})),pin(before));assert.equal(pin(fs.lstatSync(file,{bigint:true})),pin(before));return raw;
 }finally{fs.closeSync(fd);}
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);process.umask(0o077);assert.equal(process.argv.length,4);
 const config=JSON.parse(privateFile(process.argv[2],process.argv[3],64*1024**2));assert.equal(config.format,'sabalan-independent-online-components-input/v1');assert.match(config.operation,/^[a-f0-9]{32}$/);assert.match(config.captureId,/^[a-f0-9]{64}$/);
 const sealedRaw=privateFile(config.sealedFile,config.sealedSha256,64*1024**2),manifestRaw=privateFile(config.manifestFile,config.manifestSha256,64*1024**2),sealed=JSON.parse(sealedRaw),manifest=JSON.parse(manifestRaw);
 assert.equal(sealed.manifestSha256,sha(manifestRaw));const objects=validateOnlineSealedComponents(sealed,manifest,config.captureId);
 privateFile(config.codecFile,config.codecSha256,1024**2);const codec=require(config.codecFile);
 const key=privateFile(config.keyFile,config.keySha256,65536).toString('utf8'),publicKey=crypto.createPublicKey(key);
 assert.equal(sha(publicKey.export({type:'spki',format:'der'})),sealed.independentPublicKeySha256);
 assert.equal(fs.realpathSync(config.root),config.root);assert.ok(config.root.startsWith('/app/online-runtime-acceptance/application-native-'+config.operation+'/'));
 const directory=fs.lstatSync(config.root);assert.ok(directory.isDirectory()&&directory.uid===0&&!(directory.mode&0o077));assert.deepEqual(fs.readdirSync(config.root),[]);
 assert.deepEqual(Object.keys(config.cipherPaths).sort(),objects.map(row=>row.name).sort());
 const originalSources=[],results=[];
 for(const row of objects){
  const cipher=config.cipherPaths[row.name];assert.ok(path.posix.isAbsolute(cipher)&&cipher.startsWith('/checkpoints/')&&path.posix.normalize(cipher)===cipher);
  assert.equal(fs.realpathSync(cipher),cipher);const before=fs.lstatSync(cipher,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.uid===0n&&!(before.mode&0o077n));assert.equal(Number(before.size),row.cipherBytes);
  assert.equal(await codec.sha256File(cipher),row.cipherSha256);originalSources.push({file:cipher,identity:pin(before),sha256:row.cipherSha256});
  const space=fs.statfsSync(config.root,{bigint:true});assert.ok(space.bavail*space.bsize>=BigInt(row.bytes)+64n*1024n**2n);
  const target=path.join(config.root,row.name);assert.ok(!fs.existsSync(target));
  await codec.decryptRecoveryArchiveWithPrivateKey(cipher,target,key,'independent-recovery');
  const actual=fs.lstatSync(target,{bigint:true});assert.ok(actual.isFile()&&actual.nlink===1n&&actual.uid===0n);assert.equal(Number(actual.size),row.bytes);assert.equal(await codec.sha256File(target),row.sha256);
  const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.chmodSync(target,0o400);
  assert.equal(pin(fs.lstatSync(cipher,{bigint:true})),pin(before));assert.equal(await codec.sha256File(cipher),row.cipherSha256);
  results.push({role:row.role,name:row.name,path:target,bytes:row.bytes,sha256:row.sha256,retainedCipherPath:cipher,cipherBytes:row.cipherBytes,cipherSha256:row.cipherSha256});
 }
 for(const value of originalSources){assert.equal(pin(fs.lstatSync(value.file,{bigint:true})),value.identity);assert.equal(await codec.sha256File(value.file),value.sha256);}
 const directoryFd=fs.openSync(config.root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(directoryFd);}finally{fs.closeSync(directoryFd);}
 process.stdout.write(JSON.stringify({format:'sabalan-original-independent-online-components/v1',operation:config.operation,captureId:config.captureId,sealedSha256:sha(sealedRaw),manifestSha256:sha(manifestRaw),components:results,fullGcmAuthenticated:true,independentRsaDecryptVerified:true,physicalReplayQualified:false,threeApplicationHealthQualified:false,productionAdmission:false})+'\n');
}
module.exports={validateOnlineSealedComponents};
if(require.main===module)main().catch(()=>{process.stderr.write('INDEPENDENT_ONLINE_COMPONENTS_UNPROVEN\n');process.exitCode=1;});
