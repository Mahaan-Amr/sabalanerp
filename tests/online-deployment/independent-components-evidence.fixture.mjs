import {createHash} from 'node:crypto';
export const sha=raw=>createHash('sha256').update(raw).digest('hex');
export const owned=value=>{const raw=Buffer.from(JSON.stringify(value));return {rawBase64:raw.toString('base64'),sha256:sha(raw),bytes:raw.length};};
export function componentFixture(){
 const captureId='a'.repeat(64),roles=['physical-base','coherent-cut','coverage-manifest','inquiry-sqlite','wal-capture',...Array(9).fill('versioned-file-cut'),'wal-segment','coordination'];
 const sources=roles.map((role,i)=>({name:'component-'+i,role,path:'/source/'+i,bytes:100,sha256:'b'.repeat(64)}));
 const manifest={format:'sabalan-online-checkpoint-plaintext-components/v1',operation:captureId,sourceCaptureSha256:sources[1].sha256,coverageSha256:sources[2].sha256,sources};
 const sealed={format:'sabalan-online-checkpoint-components-sealed/v1',phase:'SEALED_LOCAL',operation:captureId,objects:sources.map((row,i)=>({...row,cipherFile:'/cipher/'+i,cipherBytes:1124,cipherSha256:'c'.repeat(64),localDecryptVerified:true}))};
 const ownedOutputs={sealedManifest:owned(sealed),plaintextManifest:owned(manifest)};
 const source={captureId,sealedSha256:ownedOutputs.sealedManifest.sha256,manifestSha256:ownedOutputs.plaintextManifest.sha256,sourceHost:{machineUuidSha256:'d'.repeat(64),kernelBootIdSha256:'e'.repeat(64)},ownedOutputs};
 const decrypted={format:'sabalan-original-independent-online-components/v1',captureId,sealedSha256:source.sealedSha256,manifestSha256:source.manifestSha256,
  components:sealed.objects.map(({name,role,bytes,sha256,cipherBytes,cipherSha256})=>({name,role,bytes,sha256,cipherBytes,cipherSha256})),
  fullGcmAuthenticated:true,independentRsaDecryptVerified:true,physicalReplayQualified:false,threeApplicationHealthQualified:false,productionAdmission:false};
 const descriptor=owned(decrypted);
 const report={format:'sabalan-original-independent-components-result/v1',captureId,sealedManifestSha256:source.sealedSha256,plaintextManifestSha256:source.manifestSha256,
  rsaHost:{machineUuidSha256:'f'.repeat(64),kernelBootIdSha256:'0'.repeat(64)},originalVerifier:{pid:123,code:0,signal:null,stdoutEof:true,stderrEof:true},
  decryptionRawBase64:descriptor.rawBase64,decryptionSha256:descriptor.sha256,physicalReplayQualified:false,productionAdmission:false};
 return {source,report,decrypted,owned};
}
