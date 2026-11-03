/** Data validation only. JSON can never mint an original RSA capability. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const {validateOnlineSealedComponents}=createRequire(import.meta.url)('../../tests/online-deployment/independent-online-components.worker.cjs');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
export function assertOriginalComponentDecryption(report,source){
 assert.equal(report.format,'sabalan-original-independent-components-result/v1');
 assert.equal(report.captureId,source.captureId);
 assert.equal(report.sealedManifestSha256,source.sealedSha256);assert.equal(report.plaintextManifestSha256,source.manifestSha256);
 assert.equal(report.productionAdmission,false);assert.equal(report.physicalReplayQualified,false);
 assert.notEqual(report.rsaHost.machineUuidSha256,source.sourceHost.machineUuidSha256);
 for(const value of Object.values(report.rsaHost))assert.match(value,/^[a-f0-9]{64}$/);
 const original=report.originalVerifier;assert.ok(Number.isSafeInteger(original.pid)&&original.pid>1);
 assert.equal(original.code,0);assert.equal(original.signal,null);assert.equal(original.stdoutEof,true);assert.equal(original.stderrEof,true);
 const read=(value,expected)=>{const raw=Buffer.from(value,'base64');assert.ok(raw.length>0&&raw.length<=32*1024**2);
  assert.equal(raw.toString('base64'),value);assert.equal(sha(raw),expected);return raw;};
 const sealedRaw=read(source.ownedOutputs.sealedManifest.rawBase64,source.sealedSha256);
 const manifestRaw=read(source.ownedOutputs.plaintextManifest.rawBase64,source.manifestSha256);
 const sealed=JSON.parse(sealedRaw),manifest=JSON.parse(manifestRaw);
 validateOnlineSealedComponents(sealed,manifest,source.captureId);
 const raw=read(report.decryptionRawBase64,report.decryptionSha256),actual=JSON.parse(raw);
 assert.equal(actual.format,'sabalan-original-independent-online-components/v1');
 assert.equal(actual.captureId,source.captureId);assert.equal(actual.sealedSha256,source.sealedSha256);assert.equal(actual.manifestSha256,source.manifestSha256);
 assert.equal(actual.fullGcmAuthenticated,true);assert.equal(actual.independentRsaDecryptVerified,true);
 assert.equal(actual.physicalReplayQualified,false);assert.equal(actual.threeApplicationHealthQualified,false);assert.equal(actual.productionAdmission,false);
 assert.equal(actual.components.length,manifest.sources.length);
 for(const row of manifest.sources){const matches=actual.components.filter(x=>x.name===row.name);assert.equal(matches.length,1);const object=sealed.objects.find(x=>x.name===row.name);
  for(const key of ['name','role','bytes','sha256'])assert.equal(matches[0][key],row[key]);
  assert.equal(matches[0].cipherSha256,object.cipherSha256);assert.equal(matches[0].cipherBytes,object.cipherBytes);}
 return raw;
}
