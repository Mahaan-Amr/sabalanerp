/** Content encryption only. This module cannot issue capture, release or health
 * authority. The canonical service is bundled without a runtime application graph. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey} from 'node:crypto';
import {createRequire} from 'node:module';
const repository=path.resolve(import.meta.dirname,'../..');
const source=path.join(repository,'backend/src/services/recoveryCrypto.ts');
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const identity=value=>['dev','ino','size','mtimeNs','ctimeNs','nlink'].map(key=>String(value[key])).join(':');
export function readPinnedHostCryptoFile(file,maximum=64*1024*1024){
 assert.equal(fs.realpathSync(file),path.resolve(file));const stat=fs.lstatSync(file,{bigint:true});
 assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1n&&stat.size<=BigInt(maximum));
 const raw=fs.readFileSync(file);assert.equal(identity(fs.lstatSync(file,{bigint:true})),identity(stat));
 return {raw,sha256:sha(raw),identity:identity(stat),bytes:Number(stat.size)};
}
export async function hashPinnedHostCryptoFile(file,maximum=16*1024**3){
 assert.equal(fs.realpathSync(file),path.resolve(file));const before=fs.lstatSync(file,{bigint:true});
 assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size<=BigInt(maximum));
 const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 assert.equal(identity(fs.lstatSync(file,{bigint:true})),identity(before));
 return {sha256:hash.digest('hex'),bytes:Number(before.size),identity:identity(before)};
}
function sync(file){const fd=fs.openSync(file,'r+');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export async function createCanonicalHostRecoveryCrypto({root}){
 assert.equal(fs.realpathSync(root),path.resolve(root));
 const original=readPinnedHostCryptoFile(source);
 const require=createRequire(path.join(repository,'backend/package.json'));
 const esbuild=require('esbuild');
 const bundle=esbuild.buildSync({entryPoints:[source],bundle:true,platform:'node',target:'node20',format:'cjs',write:false,metafile:true,logLevel:'silent'});
 const inputs=Object.keys(bundle.metafile.inputs).map(file=>path.resolve(file));assert.deepEqual(inputs,[source]);
 assert.equal(bundle.outputFiles.length,1);assert.equal(readPinnedHostCryptoFile(source).sha256,original.sha256);
 const bundleFile=path.join(root,'canonical-recovery-crypto.cjs');
 fs.writeFileSync(bundleFile,bundle.outputFiles[0].contents,{flag:'wx',mode:0o600});sync(bundleFile);fs.chmodSync(bundleFile,0o400);
 const bundlePin=readPinnedHostCryptoFile(bundleFile);const canonical=createRequire(import.meta.url)(bundleFile);
 const provenance=Object.freeze({sourceFile:source,sourceSha256:original.sha256,bundleFile,bundleSha256:bundlePin.sha256,inputs:[source],runtimeGraphIncluded:false});
 const revalidate=()=>{assert.equal(readPinnedHostCryptoFile(source).sha256,original.sha256);assert.equal(readPinnedHostCryptoFile(bundleFile).sha256,bundlePin.sha256);};
 return Object.freeze({provenance,revalidate,async seal({source:plaintext,destination,bytes,sha256,passphrase,publicKeyPem}){
  revalidate();assert.ok(Number.isSafeInteger(bytes)&&bytes>=0&&bytes<=16*1024**3);assert.match(sha256,/^[a-f0-9]{64}$/);
  assert.ok(typeof passphrase==='string'&&passphrase.length>=32);
  const key=createPublicKey(publicKeyPem);assert.equal(key.asymmetricKeyType,'rsa');assert.ok(key.asymmetricKeyDetails.modulusLength>=2048);
  assert.equal(path.dirname(path.resolve(destination)),root);assert.equal(fs.existsSync(destination),false);
  assert.equal(path.dirname(path.resolve(plaintext)),root);
  const before=fs.lstatSync(plaintext,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n);assert.equal(Number(before.size),bytes);
  assert.equal(await canonical.sha256File(plaintext),sha256);assert.equal(identity(fs.lstatSync(plaintext,{bigint:true})),identity(before));
  await canonical.encryptRecoveryArchiveForRecipients(plaintext,destination,[{keyId:'local-rollback',passphrase},{keyId:'independent-recovery',publicKeyPem}]);
  sync(destination);const check=destination+'.local-check';
  await canonical.decryptRecoveryArchive(destination,check,passphrase);sync(check);
  assert.equal(fs.statSync(check).size,bytes);assert.equal(await canonical.sha256File(check),sha256);
  assert.equal(identity(fs.lstatSync(plaintext,{bigint:true})),identity(before));assert.equal(await canonical.sha256File(plaintext),sha256);revalidate();
  const cipherSha256=await canonical.sha256File(destination),cipherBytes=fs.statSync(destination).size;
  fs.unlinkSync(check);
  return Object.freeze({cipherFile:destination,cipherBytes,cipherSha256,plaintextSha256:sha256,localDecryptVerified:true,
   independentDecryptVerified:false,remoteReadBackVerified:false,healthyRecoveryPoint:false,productionAdmission:false});
 }});
}
