import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {checkpointCanonicalBytes,checkpointSha,verifyOriginalPhysicalCheckpointCertificate,verifyOriginalPhysicalCheckpointPublication,verifyOriginalPhysicalRepositoryPromotion,verifyOriginalTerminalCheckpointCoverage} from '../../deploy/scripts/online-checkpoint-finalization.mjs';
const pair=generateKeyPairSync('ed25519'),publicKey=pair.publicKey.export({type:'spki',format:'pem'}),now=Date.parse('2026-10-20T00:05:00Z');
const point={sealedManifestSha256:'a'.repeat(64),plaintextManifestSha256:'b'.repeat(64),cipherInventorySha256:'c'.repeat(64),sourceDatabase:{name:'actual',oid:'123',systemIdentifier:'456'},restorePoint:{name:'actual_cut',lsn:'0/100',requiredWalEndLsn:'0/200',timeline:1}};
const captureId='2'.repeat(64),repository={format:'sabalan-online-checkpoint-directory/v1',captureId,repository:'independent-recovery',mountPath:'/mnt/sabalanerp-independent-recovery/online-'+captureId,sftpPath:'/checkpoints/online-'+captureId,sealedManifestSha256:point.sealedManifestSha256,plaintextManifestSha256:point.plaintextManifestSha256,cipherInventorySha256:point.cipherInventorySha256,materialIndexSha256:'3'.repeat(64)};
function signed(format,domain,decision){return {format,decision,signature:sign(null,Buffer.concat([Buffer.from(domain+'\n'),checkpointCanonicalBytes(decision)]),pair.privateKey).toString('base64')};}
function physical(){return signed('sabalan-signed-physical-checkpoint-verification/v1','sabalan-original-physical-checkpoint-verification/v1',{format:'sabalan-original-physical-checkpoint-verification/v1',...point,continuousWalQualified:false,productionAdmission:false,reportSha256:'d'.repeat(64),originalCompletionSha256:'e'.repeat(64),nativeClosuresSha256:'f'.repeat(64),issuedAt:'2026-10-20T00:00:00Z',expiresAt:'2026-10-20T00:10:00Z'});}
test('real Ed25519 point certificate binds immutable prepublication point, not future canonical metadata',()=>{
 const envelope=physical();assert.doesNotThrow(()=>verifyOriginalPhysicalCheckpointCertificate(envelope,publicKey,point,now));
 assert.throws(()=>verifyOriginalPhysicalCheckpointCertificate(envelope,publicKey,{...point,sealedManifestSha256:'9'.repeat(64)},now));
 assert.throws(()=>verifyOriginalPhysicalCheckpointCertificate(envelope,publicKey,point,now+600000));
 const altered=structuredClone(envelope);altered.decision.continuousWalQualified=true;assert.throws(()=>verifyOriginalPhysicalCheckpointCertificate(altered,publicKey,point,now));
});
test('actual metadata acknowledgement needs its separate domain and exact canonical bytes',()=>{
 const original=physical().decision,metadata={captureMethod:'ONLINE_COHERENT_WAL',releaseId:'actual_release',physicalPoint:point,repositoryDirectory:repository},decision={format:'sabalan-original-physical-checkpoint-publication/v1',canonicalMetadataSha256:checkpointSha(checkpointCanonicalBytes(metadata)),sealedManifestSha256:point.sealedManifestSha256,cipherInventorySha256:point.cipherInventorySha256,physicalCompletionSha256:original.originalCompletionSha256,repository,remoteMetadataFile:'/srv/sabalanerp-recovery/checkpoints/online-'+captureId+'/canonical-checkpoint.json',remoteMetadataSha256:'1'.repeat(64),issuedAt:'2026-10-20T00:00:00Z',expiresAt:'2026-10-20T00:10:00Z'};
 const envelope=signed('sabalan-signed-physical-checkpoint-publication/v1','sabalan-original-physical-checkpoint-publication/v1',decision);
 assert.doesNotThrow(()=>verifyOriginalPhysicalCheckpointPublication(envelope,publicKey,metadata,original,now));
 assert.throws(()=>verifyOriginalPhysicalCheckpointPublication(envelope,publicKey,{...metadata,releaseId:'foreign'},original,now));
 assert.throws(()=>verifyOriginalPhysicalCheckpointPublication({...envelope,signature:physical().signature},publicKey,metadata,original,now));
});
test('promotion certificate rejects private QA aliases, foreign captures and inventory substitution',()=>{
 const original=physical().decision,decision={format:'sabalan-original-physical-repository-promotion/v1',physicalCompletionSha256:original.originalCompletionSha256,originalPromotionSha256:'4'.repeat(64),repository,issuedAt:'2026-10-20T00:00:00Z',expiresAt:'2026-10-20T00:10:00Z'};
 const envelope=signed('sabalan-signed-physical-repository-promotion/v1','sabalan-original-physical-repository-promotion/v1',decision);
 assert.doesNotThrow(()=>verifyOriginalPhysicalRepositoryPromotion(envelope,publicKey,original,captureId,now));
 for(const field of ['mountPath','sftpPath','materialIndexSha256']){
  const changed=structuredClone(envelope);changed.decision.repository[field]=field==='materialIndexSha256'?'5'.repeat(64):'/root/private-qa';
  assert.throws(()=>verifyOriginalPhysicalRepositoryPromotion(changed,publicKey,original,captureId,now));
 }
 assert.throws(()=>verifyOriginalPhysicalRepositoryPromotion(envelope,publicKey,original,'6'.repeat(64),now));
 assert.throws(()=>verifyOriginalPhysicalRepositoryPromotion({...envelope,signature:physical().signature},publicKey,original,captureId,now));
});
test('terminal certificate binds the actual epoch, source database and complete acknowledged window union',()=>{
 const metadata={sourceDatabase:point.sourceDatabase},terminal={captureId,terminalEpochSha256:'4'.repeat(64),publicationSha256:'5'.repeat(64),windows:[{requestSha256:'6'.repeat(64)}]},pointIndexSha256='7'.repeat(64);
 const decision={format:'sabalan-original-online-terminal-coverage/v1',captureId,pointIndexSha256,canonicalMetadataSha256:checkpointSha(checkpointCanonicalBytes(metadata)),terminalResultSha256:checkpointSha(checkpointCanonicalBytes(terminal)),terminalEpochSha256:terminal.terminalEpochSha256,publicationSha256:terminal.publicationSha256,sourceDatabase:point.sourceDatabase,windows:[{requestSha256:terminal.windows[0].requestSha256,dependencySha256:'8'.repeat(64)}],issuedAt:'2026-10-20T00:00:00Z',expiresAt:'2026-10-20T00:10:00Z'};
 const envelope=signed('sabalan-signed-online-terminal-coverage/v1','sabalan-original-online-terminal-coverage/v1',decision);
 assert.doesNotThrow(()=>verifyOriginalTerminalCheckpointCoverage(envelope,publicKey,terminal,metadata,pointIndexSha256,now));
 assert.throws(()=>verifyOriginalTerminalCheckpointCoverage(envelope,publicKey,{...terminal,terminalEpochSha256:'9'.repeat(64)},metadata,pointIndexSha256,now));
 assert.throws(()=>verifyOriginalTerminalCheckpointCoverage(envelope,publicKey,{...terminal,windows:[]},metadata,pointIndexSha256,now));
 assert.throws(()=>verifyOriginalTerminalCheckpointCoverage(envelope,publicKey,terminal,{sourceDatabase:{...point.sourceDatabase,oid:'999'}},pointIndexSha256,now));
});
