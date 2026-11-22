/** Fixed-trust physical point publication. Neither phase grants release admission. */
import assert from 'node:assert/strict';
import {createHash,createPublicKey,verify} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const checkpointCanonicalBytes=v=>Buffer.from(JSON.stringify(canonical(v)));
export const checkpointSha=raw=>createHash('sha256').update(raw).digest('hex');
const same=(a,b)=>assert.deepEqual(a,b);
const filePin=st=>[st.dev,st.ino,st.size,st.mtimeNs,st.ctimeNs,st.mode,st.nlink].map(String).join(':');
export async function readMountedOriginalCheckpointFile(repository,name,maximum=8*1024*1024){
 assert.ok(['point.json','terminal-coverage.json','canonical-checkpoint.json','certification.json'].includes(name));
 const file=path.join(repository.mountPath,name);assert.equal(await fs.promises.realpath(file),file);
 const handle=await fs.promises.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=await handle.stat({bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&(before.mode&0o777n)===0o600n&&before.size>0n&&before.size<=BigInt(maximum));
  const raw=await handle.readFile();assert.equal(BigInt(raw.length),before.size);assert.equal(filePin(await handle.stat({bigint:true})),filePin(before));assert.equal(filePin(await fs.promises.lstat(file,{bigint:true})),filePin(before));return raw;
 }finally{await handle.close();}
}
/** Read the actual production recovery mount, not the backup host's pathname.
 * File handles remain original for the entire hash; every named inode is
 * checked before and after. Yield each chunk so the owned lease can renew. */
export async function verifyMountedOriginalCheckpointRepository(repository,point,captureId){
 assertOriginalCheckpointRepository(repository,point,captureId);
 const root=repository.mountPath;assert.equal(await fs.promises.realpath(root),root);
 const rootBefore=await fs.promises.lstat(root,{bigint:true});assert.ok(rootBefore.isDirectory()&&!rootBefore.isSymbolicLink()&&(rootBefore.mode&0o022n)===0n);
 async function original(file,maximum,consume){
  assert.equal(await fs.promises.realpath(file),file);const handle=await fs.promises.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const before=await handle.stat({bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&(before.mode&0o022n)===0n&&before.size>0n&&before.size<=BigInt(maximum));
   const hash=createHash('sha256'),chunk=Buffer.allocUnsafe(262144);let bytes=0;
   for(;;){const result=await handle.read(chunk,0,chunk.length,null);if(!result.bytesRead)break;bytes+=result.bytesRead;assert.ok(bytes<=maximum);const data=chunk.subarray(0,result.bytesRead);hash.update(data);if(consume)consume(data);await new Promise(resolve=>setImmediate(resolve));}
   assert.equal(BigInt(bytes),before.size);assert.equal(filePin(await handle.stat({bigint:true})),filePin(before));assert.equal(filePin(await fs.promises.lstat(file,{bigint:true})),filePin(before));
   return {bytes,sha256:hash.digest('hex')};
  }finally{await handle.close();}
 }
 const chunks=[],index=await original(path.join(root,'recovery-material.json'),8*1024*1024,data=>chunks.push(Buffer.from(data)));
 assert.equal(index.sha256,repository.materialIndexSha256);const material=JSON.parse(Buffer.concat(chunks));assert.equal(material.format,'sabalan-online-recovery-material/v1');assert.equal(material.captureId,captureId);
 for(const key of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'])assert.equal(material[key],point[key]);
 assert.ok(Array.isArray(material.objects)&&material.objects.length>=15&&material.objects.length<=8192);
 const names=new Set();let total=0;
 for(const object of material.objects){const relative=object.relativePath;assert.ok(typeof relative==='string'&&!relative.includes('\\')&&!relative.startsWith('/')&&relative.split('/').every(part=>part&&part!=='.'&&part!=='..')&&!names.has(relative));names.add(relative);
  assert.ok(Number.isSafeInteger(object.bytes)&&object.bytes>0&&object.bytes<=4*1024**3);assert.match(object.sha256,/^[a-f0-9]{64}$/);total+=object.bytes;assert.ok(total<=16*1024**3);
  same(await original(path.join(root,...relative.split('/')),object.bytes),{bytes:object.bytes,sha256:object.sha256});
 }
 const rootAfter=await fs.promises.lstat(root,{bigint:true});assert.equal(String(rootAfter.dev),String(rootBefore.dev));assert.equal(String(rootAfter.ino),String(rootBefore.ino));
 assert.equal((await original(path.join(root,'recovery-material.json'),8*1024*1024)).sha256,index.sha256);
 return {format:'sabalan-original-mounted-checkpoint-readback/v1',captureId,materialIndexSha256:index.sha256,objects:names.size,bytes:total};
}
export function assertOriginalCheckpointRepository(repository,point,captureId){
 assert.match(captureId,/^[a-f0-9]{64}$/);
 assert.equal(repository.format,'sabalan-online-checkpoint-directory/v1');assert.equal(repository.captureId,captureId);
 assert.equal(repository.repository,'independent-recovery');
 assert.equal(repository.mountPath,'/mnt/sabalanerp-independent-recovery/online-'+captureId);
 assert.equal(repository.sftpPath,'/checkpoints/online-'+captureId);
 for(const field of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256'])assert.equal(repository[field],point[field]);
 assert.match(repository.materialIndexSha256,/^[a-f0-9]{64}$/);
 return repository;
}
export function verifyOriginalPhysicalRepositoryPromotion(envelope,publicKey,point,captureId,now=Date.now()){
 assert.equal(envelope.format,'sabalan-signed-physical-repository-promotion/v1');const d=envelope.decision;
 assert.equal(d.format,'sabalan-original-physical-repository-promotion/v1');
 assert.equal(d.physicalCompletionSha256,point.originalCompletionSha256);
 assert.match(d.originalPromotionSha256,/^[a-f0-9]{64}$/);
 assertOriginalCheckpointRepository(d.repository,point,captureId);
 assert.ok(Date.parse(d.issuedAt)<=now&&now<Date.parse(d.expiresAt)&&Date.parse(d.expiresAt)-Date.parse(d.issuedAt)<=600000);
 assert.ok(verify(null,Buffer.concat([Buffer.from('sabalan-original-physical-repository-promotion/v1\n'),checkpointCanonicalBytes(d)]),createPublicKey(publicKey),Buffer.from(envelope.signature,'base64')));
 return d;
}
export function verifyOriginalPhysicalCheckpointCertificate(envelope,publicKey,point,now=Date.now()){
 assert.equal(envelope.format,'sabalan-signed-physical-checkpoint-verification/v1');const d=envelope.decision;
 assert.equal(d.format,'sabalan-original-physical-checkpoint-verification/v1');assert.equal(d.continuousWalQualified,false);assert.equal(d.productionAdmission,false);
 for(const field of ['sealedManifestSha256','plaintextManifestSha256','cipherInventorySha256']){assert.match(d[field],/^[a-f0-9]{64}$/);assert.equal(d[field],point[field]);}
 for(const field of ['reportSha256','originalCompletionSha256','nativeClosuresSha256'])assert.match(d[field],/^[a-f0-9]{64}$/);
 same(d.sourceDatabase,point.sourceDatabase);same(d.restorePoint,point.restorePoint);
 assert.ok(Date.parse(d.issuedAt)<=now&&now<Date.parse(d.expiresAt)&&Date.parse(d.expiresAt)-Date.parse(d.issuedAt)<=600000);
 const key=createPublicKey(publicKey);assert.equal(key.asymmetricKeyType,'ed25519');
 assert.ok(verify(null,Buffer.concat([Buffer.from('sabalan-original-physical-checkpoint-verification/v1\n'),checkpointCanonicalBytes(d)]),key,Buffer.from(envelope.signature,'base64')));
 return d;
}
export function verifyOriginalPhysicalCheckpointPublication(envelope,publicKey,metadata,physicalDecision,now=Date.now()){
 assert.equal(envelope.format,'sabalan-signed-physical-checkpoint-publication/v1');const d=envelope.decision;
 assert.equal(d.format,'sabalan-original-physical-checkpoint-publication/v1');
 assert.equal(d.canonicalMetadataSha256,checkpointSha(checkpointCanonicalBytes(metadata)));
 assert.equal(d.sealedManifestSha256,physicalDecision.sealedManifestSha256);assert.equal(d.cipherInventorySha256,physicalDecision.cipherInventorySha256);
 assert.equal(d.physicalCompletionSha256,physicalDecision.originalCompletionSha256);
 assertOriginalCheckpointRepository(d.repository,physicalDecision,metadata.repositoryDirectory.captureId);
 same(d.repository,metadata.repositoryDirectory);
 assert.match(d.remoteMetadataSha256,/^[a-f0-9]{64}$/);
 assert.equal(d.remoteMetadataFile,'/srv/sabalanerp-recovery/checkpoints/online-'+metadata.repositoryDirectory.captureId+'/canonical-checkpoint.json');
 assert.ok(Date.parse(d.issuedAt)<=now&&now<Date.parse(d.expiresAt)&&Date.parse(d.expiresAt)-Date.parse(d.issuedAt)<=600000);
 assert.ok(verify(null,Buffer.concat([Buffer.from('sabalan-original-physical-checkpoint-publication/v1\n'),checkpointCanonicalBytes(d)]),createPublicKey(publicKey),Buffer.from(envelope.signature,'base64')));
 return d;
}
export function verifyOriginalTerminalCheckpointCoverage(envelope,publicKey,terminal,metadata,pointIndexSha256,now=Date.now()){
 assert.equal(envelope.format,'sabalan-signed-online-terminal-coverage/v1');const d=envelope.decision;
 assert.equal(d.format,'sabalan-original-online-terminal-coverage/v1');assert.equal(d.captureId,terminal.captureId);
 assert.equal(d.pointIndexSha256,pointIndexSha256);assert.equal(d.canonicalMetadataSha256,checkpointSha(checkpointCanonicalBytes(metadata)));
 assert.equal(d.terminalResultSha256,checkpointSha(checkpointCanonicalBytes(terminal)));
 assert.equal(d.terminalEpochSha256,terminal.terminalEpochSha256);assert.equal(d.publicationSha256,terminal.publicationSha256);same(d.sourceDatabase,metadata.sourceDatabase);
 same(d.windows.map(row=>row.requestSha256),terminal.windows.map(row=>row.requestSha256));for(const row of d.windows)assert.match(row.dependencySha256,/^[a-f0-9]{64}$/);
 assert.ok(Date.parse(d.issuedAt)<=now&&now<Date.parse(d.expiresAt)&&Date.parse(d.expiresAt)-Date.parse(d.issuedAt)<=600000);
 assert.ok(verify(null,Buffer.concat([Buffer.from('sabalan-original-online-terminal-coverage/v1\n'),checkpointCanonicalBytes(d)]),createPublicKey(publicKey),Buffer.from(envelope.signature,'base64')));
 return d;
}
export function originalPhysicalCheckpointMetadata({owner,targetCommit,plan,producer,seal,sealRawBase64,report,reportRawBase64,physicalDecision,repositoryPromotion,localManifestFile,sourceHost,liveCoverage}){
 assert.equal(producer.format,'sabalan-original-online-checkpoint-producer-result/v1');assert.equal(producer.captureId,plan.captureId);
 const closure=producer.captureClosure;assert.equal(closure.format,'sabalan-original-confined-capture-closure/v1');
 assert.equal(checkpointSha(Buffer.from(closure.scopeRawBase64,'base64')),plan.scopeSha256);same(JSON.parse(Buffer.from(closure.scopeRawBase64,'base64')),plan.scope);
 const native=JSON.parse(Buffer.from(closure.nativeRawBase64,'base64'));assert.equal(native.phase,'QUIESCENT');assert.equal(native.nativeStatus,0);assert.equal(native.nativeReaped,true);assert.equal(native.databaseQuiet,true);assert.equal(native.onlineScope.sha256,plan.scopeSha256);
 assert.equal(closure.originalDockerStatus,0);assert.equal(closure.freshNamespaceSessions,0);assert.equal(closure.preparedTransactions,0);
 assert.equal(seal.format,'sabalan-online-checkpoint-components-sealed/v1');assert.equal(seal.phase,'SEALED_LOCAL');assert.equal(seal.manifestSha256,producer.manifestSha256);
 assert.equal(report.plaintextManifestSha256,producer.manifestSha256);assert.equal(report.sealedManifestSha256,physicalDecision.sealedManifestSha256);
 assert.equal(checkpointSha(Buffer.from(reportRawBase64,'base64')),physicalDecision.reportSha256);same(JSON.parse(Buffer.from(reportRawBase64,'base64')),report);
 assert.equal(checkpointSha(Buffer.from(sealRawBase64,'base64')),physicalDecision.sealedManifestSha256);same(JSON.parse(Buffer.from(sealRawBase64,'base64')),seal);
 const actualCipher=report.decryption.components;assert.equal(actualCipher.length,seal.objects.length);
 for(const o of seal.objects){const rows=actualCipher.filter(v=>v.name===o.name);assert.equal(rows.length,1);same({bytes:o.bytes,sha256:o.sha256,cipherBytes:o.cipherBytes,cipherSha256:o.cipherSha256},{bytes:rows[0].bytes,sha256:rows[0].sha256,cipherBytes:rows[0].cipherBytes,cipherSha256:rows[0].cipherSha256});}
 assert.ok(seal.objects.length>0&&seal.objects.every(v=>v.localDecryptVerified===true));
 same(liveCoverage.sourceDatabase,plan.database);assert.equal(liveCoverage.captureId,plan.captureId);assert.equal(liveCoverage.phase,'LIVE_ORIGINAL_OWNER');assert.equal(liveCoverage.finalIntervalCompletion,false);
 for(const field of ['machineUuidSha256','kernelBootIdSha256'])assert.match(sourceHost[field],/^[a-f0-9]{64}$/);
 const size=seal.objects.reduce((sum,v)=>{assert.ok(Number.isSafeInteger(v.cipherBytes)&&v.cipherBytes>0);return sum+v.cipherBytes;},0);assert.ok(Number.isSafeInteger(size));
 assert.equal(repositoryPromotion.physicalCompletionSha256,physicalDecision.originalCompletionSha256);
 const repository=assertOriginalCheckpointRepository(repositoryPromotion.repository,physicalDecision,plan.captureId);
 return {id:owner.deploymentId,deploymentId:owner.deploymentId,releaseId:owner.releaseId,targetCommit,captureMethod:'ONLINE_COHERENT_WAL',
  sourceDatabase:plan.database,sourceMachineUuidSha256:sourceHost.machineUuidSha256,sourceKernelBootIdSha256:sourceHost.kernelBootIdSha256,
  createdAt:new Date().toISOString(),localPath:localManifestFile,archivePath:localManifestFile,remotePath:repository.mountPath,repositoryDirectory:structuredClone(repository),repositoryPromotionSha256:repositoryPromotion.originalPromotionSha256,checksum:physicalDecision.cipherInventorySha256,size,
  localVerified:true,remoteVerified:true,restoreVerified:true,localRestoreVerified:false,independentRestoreVerified:true,manifestReadable:true,
  continuousWalQualified:false,continuousWalCoveragePhase:'LIVE_ORIGINAL_OWNER',liveCoverageSha256:checkpointSha(checkpointCanonicalBytes(liveCoverage)),
  physicalPoint:{sealedManifestSha256:physicalDecision.sealedManifestSha256,plaintextManifestSha256:physicalDecision.plaintextManifestSha256,cipherInventorySha256:physicalDecision.cipherInventorySha256,restorePoint:physicalDecision.restorePoint},
  compatibility:{local:{compatible:true,verification:'same-original-locally-authenticated-components',plaintextManifestSha256:producer.manifestSha256},remote:{compatible:true,verification:'original-independent-physical-replay-and-three-applications',reportSha256:physicalDecision.reportSha256}}};
}
