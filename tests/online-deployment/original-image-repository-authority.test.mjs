import test from 'node:test';
import assert from 'node:assert/strict';
import {runOriginalImageRepository,readOriginalImageRepositoryQualification,readOriginalKnownImageRepositoryFailure} from '../../scripts/lib/original-image-repository.mjs';
test('reports and spoofed owner objects refuse before process, directory or credential access',async()=>{
 let accessed=0;const nativeOwner=new Proxy({},{get(){accessed++;throw Error('MUST_NOT_ACCESS_FAKE_OWNER');}});
 for(const independentCompletion of [{},{format:'sabalan-original-existing-compose-complete/v1',outerOriginalClosurePending:false},Object.freeze({})]){
  await assert.rejects(runOriginalImageRepository({nativeOwner,localCompletion:{},independentCompletion,acquireCredential:async()=>{accessed++;throw Error('MUST_NOT_ACQUIRE_CREDENTIAL');}}),/SAME_ROOT_COMPLETE_RETIREMENT_REQUIRED/);
 }
 assert.equal(accessed,0);
});
test('serialization cannot mint an image completion or known-negative recovery token',()=>{
 for(const value of [{},{retrievalQualified:true,productionAdmission:false},{originalCustodyKnown:true,retrievalQualified:false}]){
  assert.throws(()=>readOriginalImageRepositoryQualification(value,{}),/IMAGE_REPOSITORY_QUALIFICATION_REQUIRED/);
  assert.throws(()=>readOriginalKnownImageRepositoryFailure(value,{}),/KNOWN_IMAGE_REPOSITORY_FAILURE_REQUIRED/);
 }
});
