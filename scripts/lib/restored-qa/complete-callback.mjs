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
      exercise:async({witness,database,manifest,inquiryStage,assertActive})=>{
        active();assertActive();assert.deepEqual(database,initial);assert.deepEqual(manifest,context.manifest);
        const endpoint=assertOriginalIndependentQualificationEndpoint(witness);
        // exchange owns only one fixed observation, never a command/signer RPC.
        // Its ACK is accepted only after every original reader has closed.
        const result=await exchange({descriptor,endpoint,database,manifest,inquiryStage,assertActive:()=>{active();assertActive();assertOriginalIndependentQualificationEndpoint(witness);}});
        active();assertActive();assertCompleteCallbackAck(result.ack,descriptor);
        assert.deepEqual(result.probe.database,database);return result.probe;
      }});
    // Earn the exact restored-source readback before the financial benchmark
    // adds its owned private fixtures. Both lifecycles still close in this SAME
    // NORMAL scope before frame3, signing and retirement of private B.
    // Preserve the selected closed-financial owner's existing callback. Its
    // immutable C3 code owns the private fixtures, original HTTP cohorts and
    // post-HTTP/catalog closure; no caller boolean replaces that work.
    const {runRestoredQaFinancialQualification}=require('/app/dist/scripts/restored-qa-financial-qualification.js');
    const financial=await runRestoredQaFinancialQualification(scope);active();
    assert.equal(financial.format,'sabalan-restored-qa-financial-domain-partial/v1');
    assert.equal(financial.financialSchemaQualified,false);assert.equal(financial.productionAdmission,false);
    const {observeOriginalCompleteTerminal}=require('./complete-terminal.cjs');
    const terminalObservation=await observeOriginalCompleteTerminal(scope,sourceOwned,active);
    active();return Object.freeze({...financial,coherentQualification:reference,terminalObservation});
  });
}
