/** Bind one actual outer owner to the retained coordinator and its v2 secret.
 * The secret stays in RAM/the anonymous owner frame; all readers close before
 * the original successful owner can retire this issuer operation. */
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {collectOriginalCompleteOwner} from './original-existing-compose-owner.mjs';
import {createOriginalRestoredIssuerPort} from './original-restored-issuer-port.mjs';
import {createOriginalCompleteReaderPort} from './original-complete-reader-port.mjs';

export async function collectOriginalCompleteIssuerOwner({retainedIssuer,resources,expectedManifestSha256,expectedManifest,
 issuerPort,readerPort,operation,command,beforeCredential,acquireCredential,onClosed,signal}) {
 assert.ok(Number.isInteger(issuerPort)&&issuerPort>0&&issuerPort<=65535);
 const passphrase=randomBytes(48).toString('base64url');
 let issuer,transport,reader,closure;
 const owner=await collectOriginalCompleteOwner({operation,command,beforeCredential,acquireCredential,signal,
  onOriginalReady:async ownerToken=>{
   issuer=await retainedIssuer.beginOriginalComplete({operation,ownerToken,expectedManifestSha256,expectedManifest,resources});
   transport=await createOriginalRestoredIssuerPort({operation,passphrase,issuer,port:issuerPort,readerDeadlineMs:300000});
   if(readerPort!==undefined)reader=await createOriginalCompleteReaderPort({operation,passphrase,resources,port:readerPort});
  },
  acquireTransportPassphrase:async()=>{assert.ok(transport);assert.equal(transport.inspect().phase,'ACTIVE');return passphrase;},
  onClosed:async row=>{
   const failures=[];try{if(transport)closure=await transport.close();}catch(error){failures.push(error);}
   try{if(reader){const value=await reader.close();closure={...closure,reader:value};assert.equal(value.fault,null,'ORIGINAL_COMPLETE_READER_TRANSPORT_HELD');}}catch(error){failures.push(error);}
   // A transport failure cannot suppress the SAME child's real closure row.
   await onClosed(row,closure??{phase:'UNKNOWN',fault:'ORIGINAL_COMPLETE_ISSUER_TRANSPORT_CLOSURE_UNPROVEN',productionAdmission:false});
   if(failures.length)throw new AggregateError(failures,'ORIGINAL_COMPLETE_TRANSPORT_CLOSURE_HELD');
   if(transport)assert.equal(closure.fault,null,'ORIGINAL_COMPLETE_ISSUER_TRANSPORT_HELD');
  },
 });
 assert.ok(issuer&&closure);issuer.finishOriginalOwner(owner);
 return owner;
}
