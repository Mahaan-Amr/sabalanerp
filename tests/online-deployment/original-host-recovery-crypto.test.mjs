import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {createCanonicalHostRecoveryCrypto} from '../../scripts/lib/canonical-host-recovery-crypto.mjs';
import {readOriginalLocalCheckpointCryptoCompletion,assertOriginalLocalCheckpointCryptoExecutor} from '../../scripts/lib/original-local-checkpoint-crypto.mjs';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
test('actual canonical host crypto preserves empty and binary originals and rejects changed source identity',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'host-recovery-crypto-'));
 try{
  const executor=await createCanonicalHostRecoveryCrypto({root});
  const {publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  for(const [name,raw]of [['empty',Buffer.alloc(0)],['binary',Buffer.from([0,255,17,13,10,0,128])]]){
   const source=path.join(root,name);fs.writeFileSync(source,raw,{flag:'wx'});
   const result=await executor.seal({source,destination:source+'.sabrec',bytes:raw.length,sha256:sha(raw),passphrase:'0123456789abcdef0123456789abcdef',publicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString()});
   assert.equal(result.localDecryptVerified,true);assert.equal(result.plaintextSha256,sha(raw));
   assert.deepEqual(fs.readFileSync(source),raw);assert.ok(fs.statSync(result.cipherFile).size>raw.length);
  }
  const source=path.join(root,'changed');fs.writeFileSync(source,'changed');
  await assert.rejects(executor.seal({source,destination:source+'.sabrec',bytes:7,sha256:sha(Buffer.from('original')),passphrase:'0123456789abcdef0123456789abcdef',publicKeyPem:publicKey.export({type:'spki',format:'pem'}).toString()}));
  assert.equal(fs.existsSync(source+'.sabrec'),false);
 }finally{fs.rmSync(root,{recursive:true});}
});
test('saved crypto results and caller executors cannot recreate original transfer custody',async()=>{
 await assert.rejects(readOriginalLocalCheckpointCryptoCompletion(Object.freeze({result:{phase:'SEALED_LOCAL'},originalCommandsClosed:true})),/ORIGINAL_LOCAL_CRYPTO_COMPLETION_REQUIRED/);
 assert.throws(()=>assertOriginalLocalCheckpointCryptoExecutor({seal(){return {pass:true};}}),/ORIGINAL_LOCAL_CRYPTO_EXECUTOR_REQUIRED/);
});
