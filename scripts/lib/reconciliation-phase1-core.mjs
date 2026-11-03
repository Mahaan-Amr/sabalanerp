/** Shared sequencing, not an authority source. Callers supply fixed ports. */
import path from 'node:path';
import {tmpdir} from 'node:os';
import {lstat} from 'node:fs/promises';
const unresolved=new Set();
export async function fixedSyntheticTargets(runId) {
  if(typeof runId!=='string'||!/^[a-f0-9]{32}$/.test(runId))throw Error('TEST_RUN_ID_INVALID');
  const parent=path.resolve(tmpdir());
  const fixture=path.join(parent,`sabalan-phase1-fixture-${runId}`);
  const evidence=path.join(parent,`sabalan-evidence-fixture-${runId}`);
  const output=path.join(parent,`sabalan-phase1-output-${runId}`);
  for(const root of [fixture,evidence,output]) {
    const st=await lstat(root,{bigint:true});
    if(!st.isDirectory()||st.isSymbolicLink())throw Error('TEST_ROOT_UNPROVEN');
  }
  return Object.freeze({fixture,evidence,output,lock:path.join(fixture,'fixture.lock'),baseline:path.join(evidence,'baseline.json'),roleHeld:path.join(evidence,'role-held.json')});
}
// Only explicitly recognized observations may pass the shared gate.
export function classifyPhase1Census(observation) {
  if(!observation || !['BOUNDED_NO_MATCH','OBSERVED_CONFLICT','UNKNOWN'].includes(observation.status)) return 'UNKNOWN';
  return observation.status;
}
export async function runPhase1Plan(ports) {
  const before=await ports.census();
  if(classifyPhase1Census(before)!=='BOUNDED_NO_MATCH'){
    const error=new Error('PHASE1_ACTOR_CENSUS_NOT_CLEAR');error.phase='BEFORE_ACQUISITION_CENSUS';
    if(ports.fixtureOnly===true)error.fixtureObservation=before.fixtureObservation??{status:'UNKNOWN',matches:[]};
    throw error;
  }
  const identity=await ports.readLeaseIdentity();
  let lease;
  try {lease=await ports.acquire(identity);}
  catch(error){if(error.originalChild&&error.ownChildClosure==='UNKNOWN')unresolved.add(error);throw error;}
  let pre,evidence,closure,phase='ASSERT_HELD_INITIAL';
  try {
    lease.assertHeld();
    phase='DURING_CENSUS';
    const during=await ports.census();
    if(classifyPhase1Census(during)!=='BOUNDED_NO_MATCH'){
      const error=new Error('PHASE1_ACTOR_CENSUS_NOT_CLEAR');
      if(ports.fixtureOnly===true)error.fixtureObservation=during.fixtureObservation??{status:'UNKNOWN',matches:[]};
      throw error;
    }
    phase='AUDIT';
    evidence=await ports.audit();
    phase='RECORD_PRE';lease.assertHeld();pre=await ports.recordPre(evidence,identity,lease);
    phase='OWN_RELEASE';lease.assertHeld();closure=await lease.release();
  } catch(cause) {
    unresolved.add(lease);
    const error=new Error('PHASE1_OWN_LEASE_OR_AUDIT_UNRESOLVED',{cause});
    error.lease=lease;error.preReleaseRecord=pre??null;error.custody='PROCESS_LOCAL_ONLY';error.phase=phase;
    // Fixture-only adapter can explicitly clean up its own test lease.
    if(ports.fixtureOnly===true)error.releaseFixtureLease=async()=>{const receipt=await lease.release();unresolved.delete(lease);return receipt;};
    throw error;
  }
  try {return {pre,closed:await ports.recordClosed(evidence,identity,lease,pre,closure),oldObligation:'RETAINED_UNRESOLVED',historicalEof:'UNKNOWN',safeState:'UNKNOWN',scopeReuse:false};}
  catch(cause){const error=new Error('PHASE1_POST_RELEASE_RECEIPT_UNPROVEN',{cause});error.preReleaseRecord=pre;throw error;}
}
