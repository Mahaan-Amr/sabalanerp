/** Ticket08 primitive proof, independent of point replay/master10/apps. */
import assert from 'node:assert/strict';
export function compareFrozenOriginalInventories(initial,final){
 const {rootMetadata:before,...oldRows}=initial,{rootMetadata:after,...newRows}=final;
 assert.deepEqual(newRows,oldRows,'FROZEN_ORIGINAL_CHANGED');
 return JSON.stringify(before)!==JSON.stringify(after)?{before,after}:null;
}
/** Retry only restoration through the same live driver's original handles. */
export async function restoreBoundedSerialOwner(driver){
 const s=driver.boundedState;assert.ok(s,'ORIGINAL_BOUNDED_OWNER_REQUIRED');
 if(s.obligation){
  if(s.transition&&!s.wrapper&&!s.wrapperReleased)s.wrapper=(await driver.settleTransitionForRestoration()).wrapper;
  if(s.wrapper&&!s.wrapperReleased){
   if(!s.initial){s.initial=structuredClone(await driver.inventory());await driver.persistInitialInventory(s.initial);}
   if(!s.finalCommitted){
    const final=await driver.inventory();const change=compareFrozenOriginalInventories(s.initial,final);
    if(change)await driver.recordRootChange(change.before,change.after);
    await driver.persistFinalInventory(final);s.finalCommitted=true;
   }
   await driver.releaseWrapper();s.wrapperReleased=true;
  }
  if(s.transition&&!s.postgresRestored){await driver.restorePostgres();s.postgresRestored=true;}
  if(!s.clientsRestored){await driver.restoreClients();s.clientsRestored=true;}
  await driver.verifyRestoration();await driver.persistCompleted();s.obligation=false;
 }
 if(s.leased){await driver.releaseLease();s.leased=false;}
}
export async function runBoundedSerialFaultProof(driver){
 const s=driver.boundedState={leased:false,obligation:false,transition:false,wrapper:false};let primary,failed=false;
 try{
  await driver.acquireLease();s.leased=true;
  await driver.preflight();await driver.stage();
  await driver.persistObligation();s.obligation=true;
  await driver.quietClients();s.transition=true;await driver.disableRestart();
  await driver.shutdownOriginal();await driver.activateIdleWrapper();s.wrapper=true;
  s.initial=structuredClone(await driver.inventory());await driver.persistInitialInventory(s.initial);
  await driver.runFaultProofs(s.initial);
 }catch(error){primary=error;failed=true;}
 try{await restoreBoundedSerialOwner(driver);}
 catch(error){await driver.hold(error);throw new AggregateError(failed?[primary,error]:[error],'SERIAL_BOUNDED_RESTORATION_HELD');}
 if(failed)throw primary;
 return {originalClusterRestored:true,primitiveProofsCompleted:true,physicalReplayQualified:false,productionAdmission:false};
}
