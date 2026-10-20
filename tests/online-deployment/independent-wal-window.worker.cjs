'use strict';
// A closed WAL window is durable byte coverage, not physical restore or release
// admission. This original child may inherit the live restore guardian's OFDs.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const sort=v=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;
const hash=v=>sha(Buffer.from(JSON.stringify(sort(v))));
const pin=s=>['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'].map(key=>String(s[key])).join(':');
function validateWindow(request,sealRaw,closureRaw){
 const seal=JSON.parse(sealRaw),closure=JSON.parse(closureRaw);
 assert.equal(request.format,'sabalan-original-wal-window-verification-request/v1');assert.ok(Number.isSafeInteger(request.sequence)&&request.sequence>0);assert.match(request.challenge,/^[a-f0-9]{64}$/);assert.equal(sha(sealRaw),request.windowSha256);
 assert.equal(seal.format,'sabalan-wal-seal/v1');assert.equal(seal.phase,'SEALED');assert.equal(seal.captureSha256,sha(closureRaw));
 assert.equal(closure.phase,'COMPLETE');assert.equal(closure.nativeReaped,true);assert.equal(closure.databaseQuiet,true);assert.equal(closure.nativeStatus,0);
 assert.equal(seal.source.systemIdentifier,request.sourceIdentity.systemIdentifier);assert.equal(seal.source.timeline,request.sourceIdentity.timeline);
 for(const key of ['systemIdentifier','timeline','databaseName','databaseOid','segmentBytes'])assert.deepEqual(seal.source[key],closure.source[key]);
 assert.deepEqual(seal.range,{startLsn:closure.startLsn,endLsn:closure.endLsn,timeline:closure.source.timeline,segmentBytes:closure.source.segmentBytes});
 assert.ok(seal.objects.length>=2&&seal.objects.length<=9&&closure.segments.length+1===seal.objects.length);
 assert.deepEqual(request.objects,seal.objects.map(row=>({name:row.name,bytes:row.encryptedBytes,sha256:row.encryptedSha256})));
 const expected=[{name:'capture.sabrec',rawBytes:closureRaw.length,rawSha256:sha(closureRaw)},...closure.segments.map(row=>({name:row.name+'.sabrec',rawBytes:row.bytes,rawSha256:row.sha256}))];
 let total=0;const names=new Set();for(let index=0;index<seal.objects.length;index++){const row=seal.objects[index];assert.equal(row.name,expected[index].name);assert.match(row.name,/^[A-Za-z0-9_.-]{1,160}$/);assert.ok(!names.has(row.name));names.add(row.name);assert.equal(row.rawBytes,expected[index].rawBytes);assert.equal(row.rawSha256,expected[index].rawSha256);assert.equal(row.localDecryptVerified,true);assert.ok(Number.isSafeInteger(row.encryptedBytes)&&row.encryptedBytes>0&&row.encryptedBytes<=64*1024**2);assert.match(row.encryptedSha256,/^[a-f0-9]{64}$/);total+=row.encryptedBytes;}
 assert.ok(total<=256*1024**2);return {seal,closure,total};
}
function read(file,expected,maximum){assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&!(before.mode&0o077n)&&before.size>0n&&before.size<=BigInt(maximum));const raw=fs.readFileSync(fd);assert.equal(sha(raw),expected);assert.equal(pin(fs.fstatSync(fd,{bigint:true})),pin(before));assert.equal(pin(fs.lstatSync(file,{bigint:true})),pin(before));return raw;}finally{fs.closeSync(fd);}}
function verifyCertificate(envelope,request,publicRaw){
 assert.equal(sha(publicRaw),'e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48');
 assert.equal(envelope.format,'sabalan-signed-original-wal-window-verification/v1');const value=envelope.decision;
 assert.equal(value.format,'sabalan-original-wal-window-verification/v1');assert.equal(value.requestSha256,hash(request));
 for(const key of ['challenge','windowSha256','sourceIdentity','objects'])assert.deepEqual(value[key],request[key]);assert.match(value.independentTokenSha256,/^[a-f0-9]{64}$/);
 const signature=Buffer.from(envelope.signature,'base64');assert.equal(signature.toString('base64'),envelope.signature);assert.equal(signature.length,64);
 const now=Date.now(),start=Date.parse(value.issuedAt),end=Date.parse(value.expiresAt);assert.ok(Number.isFinite(start)&&start<=now+30000&&end>now&&end-start===600000);
 assert.ok(crypto.verify(null,Buffer.concat([Buffer.from('sabalan-original-wal-window-verification/v1\n'),Buffer.from(JSON.stringify(sort(value)))]),publicRaw,signature));return value;
}
function verifyPointCertificates(certificates,expected,publicRaw,at=Date.now()){
 assert.equal(sha(publicRaw),'e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48');
 const domains={physical:'sabalan-original-physical-checkpoint-verification/v1',repository:'sabalan-original-physical-repository-promotion/v1',metadataPublication:'sabalan-original-physical-checkpoint-publication/v1'};
 const formats={physical:'sabalan-signed-physical-checkpoint-verification/v1',repository:'sabalan-signed-physical-repository-promotion/v1',metadataPublication:'sabalan-signed-physical-checkpoint-publication/v1'};
 assert.deepEqual(Object.keys(certificates).sort(),Object.keys(domains).sort());
 for(const role of Object.keys(domains)){const envelope=certificates[role],d=envelope.decision;assert.equal(envelope.format,formats[role]);assert.equal(d.format,domains[role]);const signature=Buffer.from(envelope.signature,'base64');assert.equal(signature.toString('base64'),envelope.signature);assert.equal(signature.length,64);
  const start=Date.parse(d.issuedAt),end=Date.parse(d.expiresAt);assert.ok(start<=at&&end>at&&end-start===600000);assert.ok(crypto.verify(null,Buffer.concat([Buffer.from(domains[role]+'\n'),Buffer.from(JSON.stringify(sort(d)))]),publicRaw,signature));
 }
 const p=certificates.physical.decision,r=certificates.repository.decision,m=certificates.metadataPublication.decision;
 for(const key of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256','sourceDatabase','restorePoint'])assert.deepEqual(p[key],expected[key]);
 assert.equal(p.originalCompletionSha256,expected.physicalCompletionSha256);assert.equal(p.reportSha256,expected.physicalReportSha256);assert.equal(p.continuousWalQualified,false);assert.equal(p.productionAdmission,false);
 assert.equal(r.physicalCompletionSha256,expected.physicalCompletionSha256);assert.equal(r.originalPromotionSha256,expected.repositoryPromotionSha256);assert.deepEqual(r.repository,expected.repositoryDescriptor);
 for(const key of ['canonicalMetadataSha256','sealedManifestSha256','cipherInventorySha256','physicalCompletionSha256','remoteMetadataFile','remoteMetadataSha256'])assert.equal(m[key],expected[key]);assert.deepEqual(m.repository,expected.repositoryDescriptor);
 return true;
}
function verifyTerminalCertificate(envelope,expected,publicRaw,at=Date.now()){
 assert.equal(sha(publicRaw),'e61a06dfe5562a2375cb3051178ad9760857a7a01ea8b88f094a6e6123fdbc48');assert.equal(envelope.format,'sabalan-signed-online-terminal-coverage/v1');const d=envelope.decision;assert.equal(d.format,'sabalan-original-online-terminal-coverage/v1');
 for(const [key,value] of Object.entries(expected))assert.deepEqual(d[key],value);const start=Date.parse(d.issuedAt),end=Date.parse(d.expiresAt);assert.ok(start<=at&&end>at&&end-start===600000);
 const signature=Buffer.from(envelope.signature,'base64');assert.equal(signature.length,64);assert.equal(signature.toString('base64'),envelope.signature);assert.ok(crypto.verify(null,Buffer.concat([Buffer.from('sabalan-original-online-terminal-coverage/v1\n'),Buffer.from(JSON.stringify(sort(d)))]),publicRaw,signature));return true;
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);process.umask(0o077);assert.equal(process.argv.length,4);
 const input=JSON.parse(read(process.argv[2],process.argv[3],2*1024**2));
 if(input.format==='sabalan-original-independent-terminal-certificate-input/v1'){const publicRaw=read(input.publicKeyFile,input.publicKeySha256,4096),acceptedAt=new Date().toISOString();verifyTerminalCertificate(input.envelope,input.expected,publicRaw,Date.parse(acceptedAt));process.stdout.write(JSON.stringify({format:'sabalan-original-terminal-certificate-verified/v1',acceptedAt,productionAdmission:false})+'\n');return;}
 if(input.format==='sabalan-original-independent-point-certificates-input/v1'){const publicRaw=read(input.publicKeyFile,input.publicKeySha256,4096),acceptedAt=new Date().toISOString();verifyPointCertificates(input.certificates,input.expected,publicRaw,Date.parse(acceptedAt));process.stdout.write(JSON.stringify({format:'sabalan-original-point-certificates-verified/v1',acceptedAt,productionAdmission:false})+'\n');return;}
 if(input.format==='sabalan-original-independent-wal-window-certificate-input/v1'){
  const raw=Buffer.from(input.certificateRawBase64,'base64');assert.equal(raw.toString('base64'),input.certificateRawBase64);const publicRaw=read(input.publicKeyFile,input.publicKeySha256,4096);
  verifyCertificate(JSON.parse(raw),input.request,publicRaw);process.stdout.write(JSON.stringify({format:'sabalan-original-independent-wal-certificate-verified/v1',certificateSha256:sha(raw),requestSha256:hash(input.request),acceptedAt:new Date().toISOString(),productionAdmission:false})+'\n');return;
 }
 assert.equal(input.format,'sabalan-original-independent-wal-window-input/v1');
 const sealRaw=Buffer.from(input.sealRawBase64,'base64'),closureRaw=Buffer.from(input.closureRawBase64,'base64');assert.equal(sealRaw.toString('base64'),input.sealRawBase64);assert.equal(closureRaw.toString('base64'),input.closureRawBase64);
 const {seal,closure}=validateWindow(input.request,sealRaw,closureRaw);assert.equal(hash(input.request),input.requestSha256);
 for(const [fd,file] of [[9,'/root/sabalan-recovery-private/drill-ownership.lock'],[10,'/run/lock/sabalan-backup-storage.lock']]){const opened=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});assert.equal(opened.dev,named.dev);assert.equal(opened.ino,named.ino);assert.ok(fs.readFileSync('/proc/self/fdinfo/'+fd,'utf8').split('\n').some(line=>new RegExp('^lock:\\s+\\d+:\\s+FLOCK\\s+ADVISORY\\s+WRITE\\s+\\S+\\s+[0-9a-f]+:[0-9a-f]+:'+opened.ino+'\\s+0\\s+EOF\\s*$').test(line)));}
 read(input.codecFile,input.codecSha256,1024**2);read(input.coverageFile,input.coverageSha256,1024**2);const codec=require(input.codecFile),coverage=await import('file://'+input.coverageFile);
 const key=read(input.keyFile,input.keySha256,65536).toString('utf8');assert.equal(sha(crypto.createPublicKey(key).export({type:'spki',format:'der'})),seal.independentPublicKeySha256);
 assert.equal(fs.realpathSync(input.root),input.root);assert.equal(input.root,'/root/sabalan-recovery-private/native-qa/wal-windows/'+input.requestSha256);const directory=fs.lstatSync(input.root);assert.ok(directory.isDirectory()&&directory.uid===0&&!(directory.mode&0o077));
 const expectedNames=coverage.postgresWalSegments(seal.range);assert.deepEqual(closure.segments.map(row=>row.name).sort(),expectedNames.slice().sort());
 const plaintext=path.join(input.root,'plaintext');fs.mkdirSync(plaintext,{mode:0o700});const outputs=[],cipherPins=[];
 for(const row of seal.objects){
  const cipher=path.join(input.root,'ciphertexts',row.name);assert.equal(fs.realpathSync(cipher),cipher);const before=fs.lstatSync(cipher,{bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&!(before.mode&0o077n));assert.equal(Number(before.size),row.encryptedBytes);assert.equal(await codec.sha256File(cipher),row.encryptedSha256);cipherPins.push({cipher,before});
  const space=fs.statfsSync(input.root,{bigint:true});assert.ok(space.bavail*space.bsize>=BigInt(row.rawBytes)+64n*1024n**2n);
  const target=path.join(plaintext,row.name==='capture.sabrec'?'capture-state.json':row.name.slice(0,-'.sabrec'.length));
  await codec.decryptRecoveryArchiveWithPrivateKey(cipher,target,key,'independent-recovery');assert.equal(fs.lstatSync(target).size,row.rawBytes);assert.equal(await codec.sha256File(target),row.rawSha256);
  const descriptor=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(descriptor);}finally{fs.closeSync(descriptor);}fs.chmodSync(target,0o400);
  if(row.name==='capture.sabrec')assert.deepEqual(fs.readFileSync(target),closureRaw);
  else{
   const name=path.basename(target),identity=closure.segments.find(value=>value.name===name);assert.ok(identity);
   const start=BigInt('0x'+name.slice(8,16))*0x100000000n+BigInt('0x'+name.slice(16,24))*BigInt(seal.range.segmentBytes);
   const lsn=value=>(value>>32n).toString(16).toUpperCase()+'/'+(value&0xffffffffn).toString(16).toUpperCase();
   const actual=await coverage.verifyWalSegmentFiles(plaintext,{...seal.range,startLsn:lsn(start),endLsn:lsn(start+BigInt(seal.range.segmentBytes))},[identity]);assert.equal(actual.segments.length,1);
  }
  assert.equal(pin(fs.lstatSync(cipher,{bigint:true})),pin(before));assert.equal(await codec.sha256File(cipher),row.encryptedSha256);
  // Keep only one authenticated plaintext object at a time. The independent
  // retained cipher, manifest and per-object readback remain durable.
  fs.unlinkSync(target);const scratch=fs.openSync(plaintext,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(scratch);}finally{fs.closeSync(scratch);}
  outputs.push({name:row.name,bytes:row.rawBytes,sha256:row.rawSha256,cipherBytes:row.encryptedBytes,cipherSha256:row.encryptedSha256});
 }
 assert.equal(outputs.length,seal.objects.length);
 for(const {cipher,before} of cipherPins){assert.equal(pin(fs.lstatSync(cipher,{bigint:true})),pin(before));assert.equal(await codec.sha256File(cipher),seal.objects.find(row=>path.basename(cipher)===row.name).encryptedSha256);}
 const parent=fs.openSync(input.root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
 // Only authenticated scratch is retired; every independently durable cipher
 // remains available for actual later point replay and retention references.
 for(const name of fs.readdirSync(plaintext))fs.unlinkSync(path.join(plaintext,name));fs.rmdirSync(plaintext);const retiredParent=fs.openSync(input.root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(retiredParent);}finally{fs.closeSync(retiredParent);}
 process.stdout.write(JSON.stringify({format:'sabalan-original-independent-wal-window-verification/v1',requestSha256:input.requestSha256,challenge:input.request.challenge,windowSha256:input.request.windowSha256,sourceIdentity:input.request.sourceIdentity,objects:input.request.objects,range:seal.range,rawObjects:outputs,independentRsaDecryptVerified:true,fullGcmAuthenticated:true,fullCipherReadbackVerified:true,exactContiguousWalVerified:true,allCiphertextsRetained:true,physicalReplayQualified:false,productionAdmission:false})+'\n');
}
module.exports={validateWindow,verifyCertificate,verifyPointCertificates,verifyTerminalCertificate};
if(require.main===module)main().catch(()=>{process.stderr.write('ORIGINAL_INDEPENDENT_WAL_WINDOW_UNPROVEN\n');process.exitCode=1;});
