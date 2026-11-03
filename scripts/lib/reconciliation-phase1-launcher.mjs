/** Independent reviewed launcher. No live execution is currently authorized. */
import {readFile,lstat,open} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {verifyPhase1Manifest} from './reconciliation-phase1-verify.mjs';
import {readReviewedBinding,readFixtureReviewedBinding} from './reconciliation-phase1-review-anchor.mjs';
export async function launchReviewedPhase1(){
 await readReviewedBinding();
 // This path is intended only for the fixed native parent holding the staged
 // source handles. The operational verifier separately checks manifest bytes
 // and native write/delete denial before any lease effect.
 const operational=await import('./reconciliation-phase1-operational.mjs');
 return operational.executeOperationalPhase1();
}
async function launchReviewedFixture(runId){
 if(!/^[a-f0-9]{32}$/.test(runId))throw Error('TEST_RUN_ID_INVALID');
 await readFixtureReviewedBinding();
 const operational=await import('./reconciliation-phase1-operational.mjs');
 return operational.executeFixturePhase1(runId);
}
const fixtureSources=Object.freeze(['scripts/lib/reconciliation-phase1-core.mjs','scripts/lib/serial-physical/host-lease.mjs','scripts/lib/serial-physical/host-lease.ps1','tests/phase1-existing-lease/phase1-fixture-adapter.mjs','scripts/lib/reconciliation-readonly-phase1-cli.mjs','scripts/lib/reconciliation-phase1-census.ps1','scripts/lib/reconciliation-phase1-lock-identity.ps1']);
export async function launchTestOwnedPhase1(root,expectedId){
 const resolved=path.resolve(root);
 if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!/^sabalan-phase1-fixture-[a-f0-9]{32}$/.test(path.basename(resolved))||!/^\d+:[a-f0-9]{32}$/.test(expectedId))throw Error('TEST_ROOT_REQUIRED');
 const st=await lstat(resolved);if(!st.isDirectory()||st.isSymbolicLink())throw Error('TEST_ROOT_UNPROVEN');
 const anchorRaw=await readFile(path.join(resolved,'fixture-anchor.json'));if(anchorRaw.length>4096)throw Error('FIXTURE_ANCHOR_BOUND');
 const anchor=JSON.parse(anchorRaw);
 if(anchor.format!=='phase1-fixture-anchor/v1'||anchor.fixtureOnly!==true)throw Error('FIXTURE_ANCHOR_INVALID');
 await verifyPhase1Manifest({root:resolved,manifestFile:path.join(resolved,'fixture-manifest.json'),expectedDigest:anchor.manifestSha256,format:'phase1-fixture-manifest/v1',operation:'TEST_ONLY',action:'FIXTURE_AUDIT',targets:['fixture.lock','evidence.json'],sources:fixtureSources});
 // Test root is not a security boundary: path/ancestor TOCTOU is unproven.
 const module=await import(pathToFileURL(path.join(resolved,...fixtureSources[3].split('/'))).href);
 return module.runTestOwnedAudit(resolved,expectedId);
}
async function writeFixtureEvent(root,name,record){
 const resolved=path.resolve(root);
 if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!/^sabalan-phase1-fixture-[a-f0-9]{32}$/.test(path.basename(resolved))||!['failure','cleanup'].includes(name))throw Error('TEST_EVENT_PATH_INVALID');
 const stat=await lstat(resolved);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('TEST_ROOT_UNPROVEN');
 const raw=JSON.stringify(record)+'\n';if(Buffer.byteLength(raw)>16384)throw Error('TEST_EVENT_BOUND');
 const file=await open(path.join(resolved,name+'.json'),'wx',0o600);try{await file.writeFile(raw);await file.sync();}finally{await file.close();}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length===5&&process.argv[2]==='--test-owned'){
  try {
   const result=await launchTestOwnedPhase1(process.argv[3],process.argv[4]);console.log(JSON.stringify({fixtureOnly:true,oldObligation:result.oldObligation,historicalEof:result.historicalEof,safeState:result.safeState,scopeReuse:result.scopeReuse}));
  } catch(error) {
   if(error.custody==='PROCESS_LOCAL_ONLY'&&error.lease&&error.releaseFixtureLease){
    const inner=error.cause?.cause;
    const allowedPhases=['ASSERT_HELD_INITIAL','DURING_CENSUS','AUDIT','RECORD_PRE','OWN_RELEASE'];
    const allowedCauses=['FIXTURE_NATIVE_CENSUS_FAILED','FIXTURE_NATIVE_IDENTITY_FAILED','PHASE1_ACTOR_CENSUS_NOT_CLEAR','TEST_EVIDENCE_UNPROVEN','TEST_EVIDENCE_CHANGED','TEST_EVIDENCE_BOUND','EEXIST'];
    const allowedSubstages=['NATIVE_CENSUS','NATIVE_IDENTITY'];
    const cause=allowedCauses.includes(error.cause?.message)?error.cause.message:(allowedCauses.includes(error.cause?.code)?error.cause.code:'UNAVAILABLE');
    const observed=error.cause?.fixtureObservation;
    const safeObservation=observed&&['OBSERVED_CONFLICT','BOUNDED_NO_MATCH','UNKNOWN'].includes(observed.status)?observed:null;
    const original={fixtureOnly:true,phase:allowedPhases.includes(error.phase)?error.phase:'UNAVAILABLE',cause,substage:allowedSubstages.includes(error.cause?.substage)?error.cause.substage:'UNAVAILABLE',child:inner?.details??null,fixtureObservation:safeObservation,ownLeasePid:error.lease.originalPid,ownLeaseBirth:'UNKNOWN',originalErrorPreserved:'ALLOWLIST_SUBSET_ONLY'};
    let failurePersistence='UNKNOWN',cleanupPersistence='UNKNOWN',cleanup={fixtureOnly:true,status:'UNKNOWN'};
    try {await writeFixtureEvent(process.argv[3],'failure',original);failurePersistence='WRITTEN';}catch{}
    finally {
     // This test-only cleanup is tied to the exact lease object; if its own
     // guard or release fails, custody stays unresolved and no kill occurs.
     try {error.lease.assertHeld();const closure=await error.releaseFixtureLease();cleanup={fixtureOnly:true,status:'OWN_CLOSURE_REPORTED',ownLease:closure,source:'ORCHESTRATOR_REPORTED',directoryDurability:'UNKNOWN'};}
     catch {cleanup={fixtureOnly:true,status:'UNKNOWN'};}
     try {await writeFixtureEvent(process.argv[3],'cleanup',cleanup);cleanupPersistence='WRITTEN';}catch{}
    }
    console.error('FIXTURE_FAILURE '+JSON.stringify({phase:original.phase,cause:original.cause,substage:original.substage,failurePersistence,cleanupPersistence,cleanupStatus:cleanup.status}));process.exitCode=2;
   } else if(error.message==='PHASE1_ACTOR_CENSUS_NOT_CLEAR'&&error.phase==='BEFORE_ACQUISITION_CENSUS') {
    const observed=error.fixtureObservation;
    const safeObservation=observed&&['OBSERVED_CONFLICT','BOUNDED_NO_MATCH','UNKNOWN'].includes(observed.status)?observed:null;
    try {await writeFixtureEvent(process.argv[3],'failure',{fixtureOnly:true,phase:error.phase,cause:'PHASE1_ACTOR_CENSUS_NOT_CLEAR',fixtureObservation:safeObservation,ownLease:'NOT_ACQUIRED',originalErrorPreserved:'ALLOWLIST_SUBSET_ONLY'});}catch{}
    console.error('FIXTURE_PRE_ACQUISITION_CENSUS_NOT_CLEAR');process.exitCode=2;
   } else throw error;
  }
 }else if(process.argv.length===4&&process.argv[2]==='--reviewed-fixture'){
  let result;
  try {result=await launchReviewedFixture(process.argv[3]);}
  catch(error){
   // Only this fixture's retained lease object is eligible for cleanup.
   // A timeout is never reported as success even if eventual closure occurs.
   let closure='UNKNOWN';
   if(error.custody==='PROCESS_LOCAL_ONLY'&&error.lease){
    try {
     if(error.cause?.originalCompletion){await error.cause.originalCompletion;closure='EVENTUAL_CHILD_EXIT_PARENT_REPORTED';}
     else if(error.releaseFixtureLease){await error.releaseFixtureLease();closure='FIXTURE_RELEASE_PARENT_REPORTED';}
    } catch {closure='UNKNOWN';}
   }
   console.error(JSON.stringify({format:'phase1-fixture-failure/v1',status:'UNKNOWN',phase:['DURING_CENSUS','AUDIT','RECORD_PRE','OWN_RELEASE'].includes(error.phase)?error.phase:'UNKNOWN',closure}));throw Error('FIXTURE_FAILURE_UNKNOWN');
  }
  if(result.oldObligation!=='RETAINED_UNRESOLVED'||result.historicalEof!=='UNKNOWN'||result.safeState!=='UNKNOWN'||result.pre?.stage!=='PRE_RELEASE'||result.closed?.stage!=='OWN_LEASE_CLOSED')throw Error('PHASE1_TEST_RESULT_INVALID');
  console.log(JSON.stringify({format:'phase1-own-audit-result/v1',fixtureOnly:true,pre:result.pre.target,closed:result.closed.target,oldObligation:'RETAINED_UNRESOLVED',historicalEof:'UNKNOWN',safeState:'UNKNOWN'}));
 }else if(process.argv.length===2){
  const result=await launchReviewedPhase1();
  if(result.oldObligation!=='RETAINED_UNRESOLVED'||result.historicalEof!=='UNKNOWN'||result.safeState!=='UNKNOWN'||result.pre?.stage!=='PRE_RELEASE'||result.closed?.stage!=='OWN_LEASE_CLOSED')throw Error('PHASE1_RESULT_INVALID');
  console.log(JSON.stringify({format:'phase1-own-audit-result/v1',pre:result.pre.target,closed:result.closed.target,oldObligation:'RETAINED_UNRESOLVED',historicalEof:'UNKNOWN',safeState:'UNKNOWN'}));
 }else throw Error('FIXED_MODE_REQUIRED');
}
