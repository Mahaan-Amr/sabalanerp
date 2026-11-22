'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {validateInput}=require('../../deploy/scripts/online-checkpoint-host-crypto.cjs');
const point=()=>({format:'sabalan-original-host-checkpoint-crypto/v1',kind:'point',mapping:{host:'/volume/private',runtime:'/app/coordination'},lockFile:'/operations/deployment.lock',localKeyFile:'/private-keys/local',publicKeyFile:'/private-keys/public',applicationMountHosts:['/volume/private','/volume/business'],point:{componentManifestFile:'/app/coordination/op/plaintext-components.json',componentManifestSha256:'a'.repeat(64),operation:'b'.repeat(64),outputRoot:'/app/coordination/op/sealed-components'}});
test('fixed host point schema preserves original runtime manifest paths and rejects app-mounted keys',()=>{
 const value=point();assert.equal(validateInput(value),value);
 const wrong=point();wrong.localKeyFile='/volume/business/rollback.key';assert.throws(()=>validateInput(wrong),/HOST_CRYPTO_KEY_MUST_NOT_BE_APP_MOUNTED/);
 const wholeHost=point();wholeHost.applicationMountHosts=['/'];assert.throws(()=>validateInput(wholeHost),/HOST_CRYPTO_KEY_MUST_NOT_BE_APP_MOUNTED/);
});
test('a caller cannot add a codec executable or redirect the fixed cipher destination',()=>{
 const value=point();value.codec='/tmp/fake.cjs';assert.throws(()=>validateInput(value));
 const destination=point();destination.point.outputRoot='/app/coordination/other/sealed-components';assert.throws(()=>validateInput(destination));
 const unknown=point();unknown.kind='arbitrary';assert.throws(()=>validateInput(unknown));
});
