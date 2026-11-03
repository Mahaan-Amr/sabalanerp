/**
 * Narrow post-LOCAL audit. Fixed operation and targets, never changes scope,
 * restores files, deploys or resolves the old owner's obligations.
 * Calling this function has real lock/metadata effects; do not invoke it
 * without the bounded operation-specific authorization and source review.
 */
import {boundedReadOnlyCensus,readOperationalLeaseIdentity,verifyStagedSourceDenial,readTestOwnedNativeSnapshot,readFixedEvidence} from './reconciliation-readonly-phase1-cli.mjs';
import {acquireSerialHostLease} from './serial-physical/host-lease.mjs';
import {readFile,open,lstat,link,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runPhase1Plan,fixedSyntheticTargets} from './reconciliation-phase1-core.mjs';
import {readReviewedBinding,readFixtureReviewedBinding} from './reconciliation-phase1-review-anchor.mjs';
import {verifyPhase1Manifest} from './reconciliation-phase1-verify.mjs';

const lockFile='D:\\sabalanerp-online-qa\\deployment.lock';
const manifestPath=path.join(path.dirname(fileURLToPath(import.meta.url)),'reconciliation-phase1-reviewed-intent.json');
const fixedSources=Object.freeze(['reconciliation-phase1-operational.mjs','reconciliation-readonly-phase1-cli.mjs',
  'reconciliation-phase1-census.ps1','reconciliation-phase1-evidence.ps1','reconciliation-phase1-lock-identity.ps1',
  'serial-physical/host-lease.mjs','serial-physical/host-lease.ps1','reconciliation-phase1-core.mjs','reconciliation-phase1-verify.mjs','reconciliation-phase1-source-proof.ps1']);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function verifyReviewedPackage() {
  const binding=await readReviewedBinding();
  const manifestBytes=await readFile(manifestPath);if(manifestBytes.length>65536||digest(manifestBytes)!==binding.manifestSha256)throw Error('PHASE1_INTENT_DIGEST_MISMATCH');
  const manifest=JSON.parse(manifestBytes);
  if(manifest.format!=='phase1-reviewed-intent/v1'||manifest.operation!=='a0d2baba08ec7e004d1458675799db6a'||manifest.action!=='READ_ONLY_AUDIT_NEW_OWN_LEASE'||manifest.reviewEvidenceSha256===undefined||!/^[a-f0-9]{64}$/.test(manifest.reviewEvidenceSha256))throw Error('PHASE1_INTENT_INVALID');
  if(manifest.outputRootPolicy!=='FRESH_PRIVATE_PARENT_HANDLE_BOUND')throw Error('PHASE1_OUTPUT_POLICY_INVALID');
  const targets=['D:/sabalanerp-online-qa/deployment.lock','D:/sabalanerp-online-qa/419-safe-rollback-a0d2baba08ec7e004d1458675799db6a/baseline.json','C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp/reports/qa/application-native-b0db9e621d4d29fa857a13285ca6254b-role-held.json'];
  await verifyPhase1Manifest({root:path.dirname(manifestPath),manifestFile:manifestPath,expectedDigest:binding.manifestSha256,format:'phase1-reviewed-intent/v1',operation:'a0d2baba08ec7e004d1458675799db6a',action:'READ_ONLY_AUDIT_NEW_OWN_LEASE',targets,sources:fixedSources});
  // Probe only the staged copies. The fixed native parent must keep its
  // handles and Job alive through closure; hostile administrators and the
  // interval before pinning remain outside this observation.
  return verifyStagedSourceDenial();
}

// This is a fixed synthetic namespace, not authorization for live effects.
async function verifyFixturePackage(runId) {
  const targets=await fixedSyntheticTargets(runId);
  const binding=await readFixtureReviewedBinding();
  const bytes=await readFile(manifestPath);
  if(bytes.length>65536||digest(bytes)!==binding.manifestSha256)throw Error('PHASE1_TEST_MANIFEST_DIGEST');
  const manifest=JSON.parse(bytes);
  if(manifest.testOnly!==true||manifest.runId!==runId||manifest.outputRootPolicy!=='FRESH_PRIVATE_PARENT_HANDLE_BOUND')throw Error('PHASE1_TEST_MANIFEST_SCOPE');
  await verifyPhase1Manifest({root:path.dirname(manifestPath),manifestFile:manifestPath,expectedDigest:binding.manifestSha256,format:'phase1-reviewed-intent/v1',operation:'TEST_ONLY',action:'FIXTURE_AUDIT',targets:[targets.lock,targets.baseline,targets.roleHeld],sources:fixedSources});
  const sourceProof=await verifyStagedSourceDenial();
  if(path.resolve(process.env.SABALAN_PHASE1_OUTPUT_ROOT??'')!==targets.output)throw Error('PHASE1_TEST_OUTPUT_SCOPE');
  return {targets,sourceProof};
}

export function buildPhase1AuditRecord(stage,evidence,context) {
  return {format:'phase1-audit-record/v1',stage,oldObligation:'RETAINED_UNRESOLVED',historicalEof:'UNKNOWN',safeState:'UNKNOWN',
    ownLeaseClosure:stage==='PRE_RELEASE'?'UNKNOWN':'CALLER_REPORTED_NOT_INDEPENDENT',scopeReuse:false,productionAdmission:false,outputRootFileId:context.outputRootFileId,
    newLease:{fileId:context.fileId,originalPid:context.originalPid,lockIdentitySourceSha256:context.lockIdentitySourceSha256,birth:'UNKNOWN'},
    actorCoverage:{scope:'KNOWN_OPERATION_ENTRIES_ONLY',knownMatches:0,unreadableRelevant:context.unreadableRelevant,unreadableRelevance:'UNKNOWN',wslNative:'NOT_GLOBAL_CENSUS',processSourceSha256:context.processSourceSha256},
    closure:stage==='OWN_LEASE_CLOSED'?context.closure:null,
    evidence:evidence.map(({label,bytes,sha256,fileId,sourceSha256,pathSnapshot,concurrentContentMutation})=>({label,bytes,sha256,fileId,sourceSha256,pathSnapshot,concurrentContentMutation})),
    directoryDurability:'UNKNOWN',acl:'UNVERIFIED_DEFAULT'};
}

async function writePhase1AuditRecord(stage,evidence,context,existingRoot) {
  if(!['PRE_RELEASE','OWN_LEASE_CLOSED'].includes(stage))throw Error('AUDIT_STAGE_INVALID');
  if(!Array.isArray(evidence)||evidence.length!==2||evidence[0].label!=='baseline'||evidence[1].label!=='roleHeld')throw Error('AUDIT_EVIDENCE_INVALID');
  if(!context||!/^\d+:[a-f0-9]{32}$/.test(context.fileId)||!Number.isSafeInteger(context.originalPid)||context.originalPid<=0||!/^[a-f0-9]{64}$/.test(context.lockIdentitySourceSha256))throw Error('AUDIT_CONTEXT_INVALID');
  if(!/^\d+:[a-f0-9]{32}$/.test(context.outputRootFileId))throw Error('AUDIT_OUTPUT_IDENTITY_UNPROVEN');
  const currentProof=await verifyStagedSourceDenial();
  if(currentProof.outputRootFileId!==context.outputRootFileId)throw Error('AUDIT_OUTPUT_IDENTITY_CHANGED');
  if(!Number.isSafeInteger(context.unreadableRelevant)||context.unreadableRelevant<0||!/^[a-f0-9]{64}$/.test(context.processSourceSha256))throw Error('AUDIT_CENSUS_CONTEXT_INVALID');
  if(stage==='OWN_LEASE_CLOSED'){
    const c=context.closure;
    if(!c||c.pid!==context.originalPid||c.exitCode!==0||c.signal!==null||c.stdoutEof!==true||c.stderrEof!==true||c.closeMarker!=='LEASE_CLOSED'||c.evidenceType!=='ORIGINAL_PARENT_REPORTED'||typeof c.observedAt!=='string'||!Number.isFinite(Date.parse(c.observedAt))||!(c.birth100ns==='UNKNOWN'||/^\d{16,20}$/.test(c.birth100ns)))throw Error('AUDIT_CLOSURE_UNPROVEN');
  }
  const tmp=path.resolve(tmpdir());
  const root=existingRoot??context.outputRoot;
  if(typeof root!=='string'||path.dirname(root)!==tmp||!/^sabalan-phase1-output-[a-f0-9]{32}$/.test(path.basename(root)))throw Error('AUDIT_ROOT_INVALID');
  const rootInfo=await lstat(root,{bigint:true});if(!rootInfo.isDirectory()||rootInfo.isSymbolicLink())throw Error('AUDIT_ROOT_UNPROVEN');
  const record=buildPhase1AuditRecord(stage,evidence,context);
  const raw=JSON.stringify(record)+'\n';if(Buffer.byteLength(raw)>65536)throw Error('AUDIT_RECORD_BOUND');
  const staging=path.join(root,stage+'.staging'),target=path.join(root,stage+'.json');
  const f=await open(staging,'wx',0o600);try{await f.writeFile(raw);await f.sync();}finally{await f.close();}
  const finalProof=await verifyStagedSourceDenial();
  if(finalProof.outputRootFileId!==context.outputRootFileId)throw Error('AUDIT_OUTPUT_IDENTITY_CHANGED');
  await link(staging,target);await unlink(staging);
  return {root,target,stage,directoryDurability:'UNKNOWN',acl:'UNVERIFIED_DEFAULT'};
}
export async function executeOperationalPhase1() {
  const sourceProof=await verifyReviewedPackage();
  let latest;
  const context=(identity,lease)=>({fileId:identity.fileId,originalPid:lease.originalPid,lockIdentitySourceSha256:identity.sourceSha256,outputRoot:process.env.SABALAN_PHASE1_OUTPUT_ROOT,outputRootFileId:sourceProof.outputRootFileId,unreadableRelevant:latest.processSnapshot.unreadableRelevant,processSourceSha256:latest.processSourceSha256});
  return runPhase1Plan({
    async census(){
      try {
        latest=await boundedReadOnlyCensus();
        if(latest.processSnapshot.matches.length)return {status:'OBSERVED_CONFLICT'};
        // This status is limited to observed fixed operation/worktree entries.
        // Other processes remain UNKNOWN_RELEVANCE; exclusive lease and
        // read-only file snapshots do not assert global actor absence.
        return {status:'BOUNDED_NO_MATCH',scope:'KNOWN_OPERATION_ENTRIES_ONLY',otherActors:'UNKNOWN_RELEVANCE'};
      } catch {return {status:'UNKNOWN'};}
    },
    readLeaseIdentity:readOperationalLeaseIdentity,
    acquire:identity=>acquireSerialHostLease(lockFile,{expectedExistingFileId:identity.fileId}),
    audit:async()=>latest.evidence,
    recordPre:(evidence,identity,lease)=>writePhase1AuditRecord('PRE_RELEASE',evidence,context(identity,lease)),
    recordClosed:(evidence,identity,lease,pre,closure)=>writePhase1AuditRecord('OWN_LEASE_CLOSED',evidence,{...context(identity,lease),closure},pre.root),
  });
}

// Fixed synthetic data only. The same manifest verifier, sequencing, canonical
// helper, receipt writer and closure checks are used as the live path.
export async function executeFixturePhase1(runId) {
  const {targets,sourceProof}=await verifyFixturePackage(runId);
  const manifest=JSON.parse(await readFile(manifestPath));
  if(!['NORMAL','DELAY_RELEASE_12S'].includes(manifest.testScenario))throw Error('PHASE1_TEST_SCENARIO_INVALID');
  const base=path.dirname(fileURLToPath(import.meta.url));
  const sourceSha256=digest(await readFile(path.join(base,'reconciliation-phase1-census.ps1')));
  const identitySha256=digest(await readFile(path.join(base,'reconciliation-phase1-lock-identity.ps1')));
  let latest,owned;
  const context=(identity,lease)=>({fileId:identity.fileId,originalPid:lease.originalPid,lockIdentitySourceSha256:identitySha256,outputRoot:targets.output,outputRootFileId:sourceProof.outputRootFileId,unreadableRelevant:latest?.unreadableRelevant,processSourceSha256:sourceSha256});
  return runPhase1Plan({
    fixtureOnly:true,
    async census(){
      try {
        latest=await readTestOwnedNativeSnapshot(targets.fixture);
        if(owned){
          const witness=JSON.parse(await readFile(path.join(targets.fixture,'fixture-lease-job-proof.json'),'utf8'));
          const self=owned.fixtureIdentity;
          if(latest.ownLeaseProof!=='PARENT_REPORTED_BINDING'||!self||['pid','birth100ns','parentPid','runId','helperSha256','executableSha256'].some(key=>witness[key]!==self[key]))return {status:'UNKNOWN'};
        }
        return {status:latest.status,fixtureObservation:latest};
      } catch {return {status:'UNKNOWN'};}
    },
    async readLeaseIdentity(){if(!latest?.fileId)throw Error('TEST_IDENTITY_UNPROVEN');return {fileId:latest.fileId};},
    async acquire(identity){owned=await acquireSerialHostLease(targets.lock,{expectedExistingFileId:identity.fileId,fixtureRunId:runId,...(manifest.testScenario==='DELAY_RELEASE_12S'?{fixtureTimeoutProbe:'DELAY_RELEASE_12S'}:{})});return owned;},
    async audit(){return [await readFixedEvidence('baseline',targets.baseline),await readFixedEvidence('roleHeld',targets.roleHeld)];},
    recordPre:(evidence,identity,lease)=>writePhase1AuditRecord('PRE_RELEASE',evidence,context(identity,lease)),
    recordClosed:(evidence,identity,lease,pre,closure)=>writePhase1AuditRecord('OWN_LEASE_CLOSED',evidence,{...context(identity,lease),closure},pre.root),
  });
}
