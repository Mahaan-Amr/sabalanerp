import test from 'node:test';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
import {assertOriginalComponentDecryption} from '../../scripts/lib/independent-components-evidence.mjs';
import {readOriginalIndependentComponents} from '../../scripts/lib/independent-full-restore-ssh.mjs';
import {componentFixture,owned} from './independent-components-evidence.fixture.mjs';
test('independent component evidence joins exact manifest/ciphers and a separate actual RSA host without claiming replay',()=>{
 const {source,report}=componentFixture();assert.ok(assertOriginalComponentDecryption(report,source).length>0);
 assert.throws(()=>readOriginalIndependentComponents(report),/ORIGINAL_INDEPENDENT_COMPONENTS_REQUIRED/);
});
test('corrupt bytes, missing components, same host and live or failed originals refuse',()=>{
 for(const change of [v=>v.report.rsaHost=v.source.sourceHost,v=>v.report.originalVerifier.code=7,v=>v.report.originalVerifier.signal='SIGTERM',
  v=>v.report.originalVerifier.stdoutEof=false,v=>v.report.originalVerifier.stderrEof=false,v=>v.report.captureId='1'.repeat(64),v=>v.report.decryptionSha256='2'.repeat(64),
  v=>v.decrypted.components.pop(),v=>v.decrypted.independentRsaDecryptVerified=false,v=>v.decrypted.fullGcmAuthenticated=false,v=>v.decrypted.components[0].cipherSha256='4'.repeat(64)]){
  const value=componentFixture();change(value);
  if(JSON.stringify(value.decrypted)!==Buffer.from(value.report.decryptionRawBase64,'base64').toString()){
   const descriptor=owned(value.decrypted);value.report.decryptionRawBase64=descriptor.rawBase64;value.report.decryptionSha256=descriptor.sha256;
  }
  assert.throws(()=>assertOriginalComponentDecryption(value.report,value.source));
 }
});
