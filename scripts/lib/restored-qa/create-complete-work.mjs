/** Installed fixed strict-worker composition. Configuration/files come from the
 * pinned staged material loader, secrets only from that SAME original worker.
 * No CLI selector, arbitrary RPC, signer export or original SQLite write. */
import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{createHash}from'node:crypto';import{createRequire}from'node:module';
import{closeOriginalCompleteClients}from'./complete-client-closure.mjs';
import{qualifyOriginalCompleteCallback}from'./complete-callback.mjs';
import{createOriginalLinuxRestoredIssuerClient}from'./original-issuer-client.mjs';
import{createOriginalCompleteLayoutPreparer,originalCompleteStartupNames}from'./prepare-original-layout.mjs';
import{originalCompleteApplicationExchange,originalCompleteDirectoryTransport}from'../original-complete-file-exchange.mjs';
const require=createRequire(import.meta.url),{createOriginalInquiryCurrentClient}=require('./inquiry-current-client.cjs'),sha=b=>createHash('sha256').update(b).digest('hex');
export async function createOriginalCompleteQaWork({configuration,files,secret,session,runtime}){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.match(session,/^[a-f0-9]{64}$/);assert.equal(typeof runtime.assertRuntimeControlOwnership,'function');runtime.assertRuntimeControlOwnership();
 const c=structuredClone(configuration);assert.equal(c.format,'sabalan-original-complete-linux-work/v1');assert.match(c.operation,/^[a-f0-9]{32}$/);assert.equal(c.productionAdmission,false);assert.deepEqual(Object.keys(files).sort(),originalCompleteStartupNames);assert.deepEqual(Object.keys(c.sourcePins).sort(),originalCompleteStartupNames);
 for(const name of originalCompleteStartupNames){assert.ok(Buffer.isBuffer(files[name]));assert.equal(sha(files[name]),c.sourcePins[name]);}
 assert.equal(c.root,'/app/runtime-authority/application-native-'+c.operation+'/restored-complete-app');assert.equal(process.cwd(),c.root);assert.deepEqual(Object.keys(secret).sort(),['applicationKeys','passphrase']);assert.match(secret.passphrase,/^[A-Za-z0-9_-]{64}$/);
 let closed=false,issuer,inquiry,closing,exchanged=false;
 const persist=value=>{const raw=Buffer.from(JSON.stringify({...value,operation:c.operation,session})+'\n'),file=path.join(c.root,'recovery-coordination/complete-client-closures.json'),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);try{fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.ok(fs.readFileSync(file).equals(raw));return{file,sha256:sha(raw),bytes:raw.length};};const active=()=>{assert.equal(closed,false);runtime.assertRuntimeControlOwnership();};
 try{
  issuer=await createOriginalLinuxRestoredIssuerClient({operation:c.operation,passphrase:secret.passphrase,port:c.issuerPort,assertOriginalWorkerActive:active});
  inquiry=createOriginalInquiryCurrentClient({operation:c.operation,session,passphrase:secret.passphrase,incarnation:c.inquiryIncarnation,port:c.inquiryPort,python:c.python,assertOriginalOwner:active});
  const sourceOwned={operation:c.operation,sourceCommit:c.sourceCommit,image:c.image,checkpointChecksum:c.checkpointChecksum,releaseId:c.releaseId,sourcePins:c.sourcePins,python:c.python,runtime:c.runtime,config:c.config,issuer,inquiryCarrier:inquiry};
  const prepare=createOriginalCompleteLayoutPreparer({operation:c.operation,sourcePins:c.sourcePins,files,issuer,assertOriginalCallbackActive:active});
  return Object.freeze({sourceOwned,prepare,qualifyOriginalCompleteCallback,exchange:request=>{active();assert.equal(exchanged,false,'ORIGINAL_COMPLETE_LINUX_EXCHANGE_ALREADY_USED');exchanged=true;return originalCompleteApplicationExchange(originalCompleteDirectoryTransport(path.join(c.root,'coherent-private')))({...request,assertActive:()=>{active();request.assertActive();}});},
   onHeld:()=>{ /* The original broker retains its own actual held children. */ },
   close(){return closing??=closeOriginalCompleteClients({issuer,inquiry,assertOwner:active,persist}).finally(()=>{closed=true;});},
  });
 }catch(error){try{await closeOriginalCompleteClients({issuer,inquiry,assertOwner:active,persist});}catch(closure){throw new AggregateError([error,closure],'ORIGINAL_COMPLETE_CLIENT_SETUP_AND_CLOSURE_NEGATIVE');}finally{closed=true;}throw error;}
}
