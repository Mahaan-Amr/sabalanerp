/* Private DR fixture, not a production recovery-point publisher. */
'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
process.umask(0o077);

async function main() {
  if (process.argv[2] === 'business') {
    const {PrismaClient} = require('@prisma/client');
    const {captureRecoveryBusinessProof} = require('/app/dist/services/deploymentRecoveryDataProof');
    const client = new PrismaClient(); // Standalone DR script; always closes.
    try {
      const proof = await client.$transaction(async transaction => {
        await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
        return captureRecoveryBusinessProof(transaction);
      }, {isolationLevel:'RepeatableRead',maxWait:5000,timeout:240000});
      console.log(JSON.stringify({tables:proof.length,
        records:proof.reduce((sum,row)=>sum+BigInt(row.rows),0n).toString(),
        sha256:crypto.createHash('sha256').update(JSON.stringify(proof)).digest('hex')}));
    } finally {await client.$disconnect();}
    return;
  }
  if (process.argv[2] !== 'crypto') throw new Error('PRIVATE_DRILL_MODE_REQUIRED');
  const {encryptRecoveryArchiveForRecipients,decryptRecoveryArchive,sha256File} = require('/app/dist/services/recoveryCrypto');
  const source='/source/base.tar', encrypted='/component/base.sabrec', restored='/component/restored.tar';
  const sourceBytes=fs.statSync(source).size;
  const requireCapacity=copies=>{
    const available=fs.statfsSync('/component');
    if(available.bavail*available.bsize < sourceBytes*copies+1024**3) throw new Error('PRIVATE_DRILL_CAPACITY_REQUIRED');
  };
  const key=fs.readFileSync('/run/secrets/recovery-private.pem','utf8');
  const publicKeyPem=crypto.createPublicKey(key).export({type:'spki',format:'pem'});
  const sourceSha256=await sha256File(source);
  requireCapacity(3);
  await encryptRecoveryArchiveForRecipients(source,encrypted,[
    {keyId:'independent-dr-rsa',publicKeyPem},
    // Diagnostic format exercise only. This discarded random recipient is NOT
    // production's required second independently held recovery authority.
    {keyId:'disposable-drill-recipient',passphrase:crypto.randomBytes(48).toString('base64')},
  ]);
  requireCapacity(2);
  await decryptRecoveryArchive(encrypted,restored,key);
  if (await sha256File(restored)!==sourceSha256) throw new Error('PRIVATE_DRILL_DECRYPT_MISMATCH');
  const encryptedSha256=await sha256File(encrypted);
  requireCapacity(1);
  const descriptor=fs.openSync(encrypted,'r+');
  const original=Buffer.alloc(1);
  fs.readSync(descriptor,original,0,1,1048576);
  let rejected=false;
  try {
    fs.writeSync(descriptor,Buffer.from([original[0]^1]),0,1,1048576);
    fs.fsyncSync(descriptor);
    try {await decryptRecoveryArchive(encrypted,'/component/rejected.tar',key);}
    catch(error) {if(error.code==='RECOVERY_DECRYPTION_FAILED') rejected=true;else throw error;}
  } finally {
    fs.writeSync(descriptor,original,0,1,1048576);fs.fsyncSync(descriptor);fs.closeSync(descriptor);
  }
  if(!rejected || fs.existsSync('/component/rejected.tar') || await sha256File(encrypted)!==encryptedSha256) {
    throw new Error('PRIVATE_DRILL_TAMPER_ACCEPTED');
  }
  for(const file of [encrypted,restored]) {
    const owned=fs.openSync(file,'r');try{fs.fsyncSync(owned);}finally{fs.closeSync(owned);}
  }
  const directory=fs.openSync('/component','r');try{fs.fsyncSync(directory);}finally{fs.closeSync(directory);}
  console.log(JSON.stringify({sourceSha256,encryptedSha256,rsaRoundTrip:true,
    authenticatedCorruptionRejected:true,disposableSecondRecipient:true,productionRecoveryPoint:false}));
}
main().catch(error=>{console.error(JSON.stringify({ok:false,code:error.code||error.name}));process.exitCode=1;});
