/** Installed callback composition. This code runs only inside the engine's
 * awaited strict callback and borrows the existing issuer/carrier lifetimes. */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {qualifyRestoredQaApplications} from './application-composer.mjs';
import {assertOriginalIndependentQualificationEndpoint} from './restored-private-broker.mjs';
import {completeCallbackRequest,assertCompleteCallbackAck} from '../original-complete-callback.mjs';
const require=createRequire(import.meta.url);

export async function qualifyOriginalCompleteCallback({proof,intendedOwner,files,sourceOwned,prepare,exchange,onHeld}){
  const {assertActiveStrictRestoreProof}=require('/app/dist/services/systemRecoveryEngine.js');
  const {withRestoredQaPrivateControlQualification}=require('/app/dist/services/restoredQaPrivateControlQualification.js');
  const context=assertActiveStrictRestoreProof(proof);
  assert.equal(sourceOwned.sourceCommit,sourceOwned.config.sourceCommit);
  const initial=context.proof.database;
  const descriptor=completeCallbackRequest({session:sourceOwned.hrSession,operation:sourceOwned.operation,
    sourceCommit:sourceOwned.sourceCommit,database:initial},context.manifest);
  return withRestoredQaPrivateControlQualification(proof,intendedOwner,sourceOwned.sourceCommit,files,async scope=>{
    const active=()=>{assert.equal(assertActiveStrictRestoreProof(proof),context);sourceOwned.issuer.assertActive();sourceOwned.inquiryCarrier.assertCurrent();};
    active();
    const reference=await qualifyRestoredQaApplications({proof,scope,sourceOwned,prepare,onHeld,
      exercise:async({witness,database,manifest,assertActive})=>{
        active();assertActive();assert.deepEqual(database,initial);assert.deepEqual(manifest,context.manifest);
        const endpoint=assertOriginalIndependentQualificationEndpoint(witness);
        // exchange owns only one fixed observation, never a command/signer RPC.
        // Its ACK is accepted only after every original reader has closed.
        const result=await exchange({descriptor,endpoint,database,manifest,assertActive:()=>{active();assertActive();assertOriginalIndependentQualificationEndpoint(witness);}});
        active();assertActive();assertCompleteCallbackAck(result.ack,descriptor);
        assert.deepEqual(result.probe.database,database);return result.probe;
      }});
    active();return Object.freeze({coherentQualification:reference});
  });
}
