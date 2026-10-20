import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {createRequire} from 'node:module';
import {readOriginalIndependentWalWindowVerification,runOriginalIndependentWalWindowVerification,acknowledgeOriginalIndependentWalWindowVerification} from '../../scripts/lib/independent-wal-window-ssh.mjs';
import {independentPhysicalResourceBudget,validatePhysicalPointProducer} from '../../scripts/run-independent-full-restore-controller.mjs';
import {readOriginalIndependentPhysicalRepositoryPromotion,readOriginalIndependentPhysicalMetadataPublication,readOriginalIndependentPhysicalCertificateAcknowledgement,readOriginalIndependentTerminalWalCoveragePersistence,runOriginalIndependentPhysicalRepositoryPromotion} from '../../scripts/lib/independent-full-restore-ssh.mjs';
const {validateWindow,verifyCertificate,verifyPointCertificates,verifyTerminalCertificate}=createRequire(import.meta.url)('./independent-wal-window.worker.cjs');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
function sample(){
 const source={systemIdentifier:'1234567890',timeline:1,databaseName:'sabalanerp',databaseOid:'16384',segmentBytes:16777216};
 const closure={phase:'COMPLETE',nativeReaped:true,databaseQuiet:true,nativeStatus:0,source,startLsn:'0/1000000',endLsn:'0/2000000',segments:[{name:'000000010000000000000001',bytes:16777216,sha256:'a'.repeat(64)}]};
 const closureRaw=Buffer.from(JSON.stringify(closure));
 const objects=[{name:'capture.sabrec',rawBytes:closureRaw.length,rawSha256:hash(closureRaw),encryptedBytes:closureRaw.length+1000,encryptedSha256:'b'.repeat(64),localDecryptVerified:true},{name:closure.segments[0].name+'.sabrec',rawBytes:16777216,rawSha256:'a'.repeat(64),encryptedBytes:16778216,encryptedSha256:'c'.repeat(64),localDecryptVerified:true}];
 const seal={format:'sabalan-wal-seal/v1',phase:'SEALED',captureSha256:hash(closureRaw),source,range:{startLsn:closure.startLsn,endLsn:closure.endLsn,timeline:1,segmentBytes:source.segmentBytes},objects};
 const sealRaw=Buffer.from(JSON.stringify(seal));
 const request={format:'sabalan-original-wal-window-verification-request/v1',sequence:1,challenge:'d'.repeat(64),deploymentId:'deployment_123',releaseId:'release_123',windowSha256:hash(sealRaw),sourceIdentity:{systemIdentifier:source.systemIdentifier,timeline:source.timeline},objects:objects.map(row=>({name:row.name,bytes:row.encryptedBytes,sha256:row.encryptedSha256}))};
 return {request,seal,sealRaw,closure,closureRaw};
}
test('actual canonical sealer/closed receiver shape binds every raw and cipher descriptor without restore claims',()=>{
 const value=sample(),result=validateWindow(value.request,value.sealRaw,value.closureRaw);assert.equal(result.total,value.request.objects.reduce((n,row)=>n+row.bytes,0));
 for(const mutate of [v=>{v.request.sourceIdentity.timeline=2;},v=>{v.request.objects[1].sha256='f'.repeat(64);},v=>{v.request.windowSha256='f'.repeat(64);},v=>{v.closure.nativeReaped=false;v.closureRaw=Buffer.from(JSON.stringify(v.closure));},v=>{v.seal.objects[1].rawSha256='f'.repeat(64);v.sealRaw=Buffer.from(JSON.stringify(v.seal));v.request.windowSha256=hash(v.sealRaw);}]){const changed=sample();mutate(changed);assert.throws(()=>validateWindow(changed.request,changed.sealRaw,changed.closureRaw));}
});
test('arbitrary reports, source paths and caller guardian objects cannot mint original ownership',async()=>{
 assert.throws(()=>readOriginalIndependentWalWindowVerification({}),/UNPROVEN/);
 await assert.rejects(runOriginalIndependentWalWindowVerification({independentGuardian:{},sourceWindow:{}}),/UNPROVEN/);
 await assert.rejects(acknowledgeOriginalIndependentWalWindowVerification({},{}),/UNPROVEN/);
 await assert.rejects(runOriginalIndependentWalWindowVerification({sourceWindow:{}}),/STANDALONE_OPTIONS_REQUIRED/);
});
test('fixed trust root refuses a freshly signed counterfeit window certificate and altered fixed-key signature',()=>{
 const {request}=sample(),pair=generateKeyPairSync('ed25519');
 const decision={format:'sabalan-original-wal-window-verification/v1',requestSha256:'e'.repeat(64),challenge:request.challenge,windowSha256:request.windowSha256,sourceIdentity:request.sourceIdentity,objects:request.objects,independentTokenSha256:'f'.repeat(64),issuedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()};
 const envelope={format:'sabalan-signed-original-wal-window-verification/v1',decision,signature:sign(null,Buffer.from(JSON.stringify(decision)),pair.privateKey).toString('base64')};
 assert.throws(()=>verifyCertificate(envelope,request,pair.publicKey.export({type:'spki',format:'pem'})));
 assert.throws(()=>verifyCertificate(envelope,request,fs.readFileSync(new URL('../../deploy/trust/online-qualification-public-key.pem',import.meta.url))));
});
test('physical peak reserves cumulative bounded window ciphers plus one plaintext and verifier/certificate memory',()=>{
 const value=independentPhysicalResourceBudget({objects:[{role:'physical-base',bytes:1024*1024}]});assert.equal(value.walWindowDiskReserve,320*1024**2);assert.equal(value.walWindowMemoryReserve,384*1024**2);assert.ok(value.requiredDiskBytes>=value.extractionPeak+value.walWindowDiskReserve+value.remainingHostReserve);
});

test('scoped physical point closure accepts live successor only with actual three point children, never global closure fiction',()=>{
 const native={phase:'QUIESCENT',nativeStatus:0,nativeReaped:true,databaseQuiet:true,stoppedBySignal:false};const value={format:'sabalan-original-online-checkpoint-producer-result/v1',captureId:'a'.repeat(64),manifestSha256:'b'.repeat(64),phase:'POINT_COMPONENTS_MATERIALIZED',originalPointChildren:['physical-base','coherent-capture','initial-wal'].map((role,index)=>({role,originalPid:100+index,returncode:0,signal:null,stdoutSha256:'c'.repeat(64),stderrSha256:'d'.repeat(64)})),captureClosure:{originalDockerPid:101,originalDockerStatus:0,freshNamespaceSessions:0,preparedTransactions:0,nativeRawBase64:Buffer.from(JSON.stringify(native)).toString('base64')},walClosure:{phase:'COMPLETE',nativeReaped:true,databaseQuiet:true,nativeStatus:0},independentRestoreVerified:false,remoteVerified:false,healthyRecoveryPoint:false,productionAdmission:false};
 assert.deepEqual(validatePhysicalPointProducer(value,value.captureId,value.manifestSha256),{pointChildrenClosed:true,wholeProducerClosed:false});
 for(const mutate of [v=>v.originalPointChildren.pop(),v=>v.originalPointChildren[0].returncode=1,v=>v.originalPointChildren[1].originalPid=100,v=>v.allOriginalChildrenClosed=true]){const changed=structuredClone(value);mutate(changed);assert.throws(()=>validatePhysicalPointProducer(changed,changed.captureId,changed.manifestSha256));}
 const closed={...value,phase:'PLAINTEXT_COMPONENTS_CLOSED',allOriginalChildrenClosed:true};assert.equal(validatePhysicalPointProducer(closed,closed.captureId,closed.manifestSha256).wholeProducerClosed,true);
});
test('parsed repository/publication/certification/terminal reports never become owned publication tokens',async()=>{
 for(const reader of [readOriginalIndependentPhysicalRepositoryPromotion,readOriginalIndependentPhysicalMetadataPublication,readOriginalIndependentPhysicalCertificateAcknowledgement,readOriginalIndependentTerminalWalCoveragePersistence])assert.throws(()=>reader({pass:true,originalControllers:[{pid:123,code:0,signal:null}]}),/UNPROVEN/);
 await assert.rejects(runOriginalIndependentPhysicalRepositoryPromotion({physicalCompletion:{},options:{}}),/UNPROVEN/);
 const publicRaw=fs.readFileSync(new URL('../../deploy/trust/online-qualification-public-key.pem',import.meta.url));assert.throws(()=>verifyPointCertificates({}, {},publicRaw));assert.throws(()=>verifyTerminalCertificate({format:'sabalan-signed-online-terminal-coverage/v1',decision:{}},{},publicRaw));
});
