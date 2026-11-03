/** Read-only lifecycle seam. Its result is data, never owner/lease admission. */
const code=error=>/^[A-Z0-9_]+$/.test(error?.message??'')?error.message:error?.code??error?.name??'THROWN_VALUE';
export async function runOriginalNativeReadiness({createOwner,inspectInputs}){
 let owner;const value={format:'sabalan-original-native-current-readiness/v1',observedAt:new Date().toISOString(),pass:false,prerequisitesPassed:false,upStarted:false,masterStarted:false,productionAdmission:false};
 try{owner=await createOwner();value.baselinePreparation=await owner.prepareOnly();owner.assertHeld();value.completeInputs=inspectInputs();owner.assertHeld();value.prerequisitesPassed=true;}
 catch(error){value.failure={code:code(error)};}
 finally{
  if(owner){try{value.closure=await owner.closeReadOnlyOrRestored();if(value.closure?.leaseClosed!==true)value.failure??={code:'ORIGINAL_READ_ONLY_LEASE_CLOSURE_UNPROVEN'};}catch(error){value.closure={closed:false,code:code(error)};value.failure??={code:'ORIGINAL_READ_ONLY_LEASE_CLOSURE_FAILED'};}}
 }
 value.pass=value.prerequisitesPassed&&value.closure?.leaseClosed===true&&!value.failure;
 return value;
}
