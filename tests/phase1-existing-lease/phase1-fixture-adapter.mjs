import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../scripts/lib/serial-physical/host-lease.mjs';
import {runPhase1Plan} from '../../scripts/lib/reconciliation-phase1-core.mjs';
import {readTestOwnedNativeSnapshot} from '../../scripts/lib/reconciliation-readonly-phase1-cli.mjs';

// Test-owned only: exercises the same sequencing core and real canonical
// child, never the operational fixed target or its authority.
export async function runTestOwnedAudit(root,expectedFileId) {
 const parent=path.resolve(os.tmpdir()),resolved=path.resolve(root);
 if(path.dirname(resolved)!==parent||!/^sabalan-phase1-fixture-[a-f0-9]{32}$/.test(path.basename(resolved)))throw Error('TEST_ROOT_REQUIRED');
 const target=path.join(resolved,'fixture.lock'),input=path.join(resolved,'evidence.json');
 const base=await fs.lstat(resolved,{bigint:true});if(!base.isDirectory()||base.isSymbolicLink())throw Error('TEST_ROOT_UNPROVEN');
 let snapshot,censusCount=0,originalLease;
 const fixtureCensus=async()=>{
  const rootNow=await fs.lstat(resolved,{bigint:true});
  if(rootNow.ino!==base.ino||rootNow.dev!==base.dev)return {status:'UNKNOWN'};
  if(originalLease){
   const deadline=Date.now()+10000;let witness;
   while(Date.now()<deadline){try{witness=JSON.parse(await fs.readFile(path.join(resolved,'fixture-lease-job-proof.json'),'utf8'));break;}catch(error){if(error.code!=='ENOENT')throw error;await new Promise(r=>setTimeout(r,50));}}
   const own=originalLease.fixtureIdentity;
   if(!witness||!own||witness.pid!==own.pid||witness.birth100ns!==own.birth100ns||witness.parentPid!==own.parentPid||witness.runId!==own.runId||witness.helperSha256!==own.helperSha256||witness.executableSha256!==own.executableSha256)return {status:'UNKNOWN',fixtureObservation:{status:'UNKNOWN',matches:[],reason:'OWN_LEASE_WITNESS_UNPROVEN'}};
  }
  try {snapshot=await readTestOwnedNativeSnapshot(resolved);if(originalLease&&snapshot.ownLeaseProof!=='PARENT_REPORTED_BINDING')snapshot={...snapshot,status:'UNKNOWN'};}
  catch(error){snapshot={status:'UNKNOWN',matches:[],substage:error.substage??'UNAVAILABLE',nativeChild:error.cause?.details??null};}
  const raw=JSON.stringify(snapshot)+'\n';if(Buffer.byteLength(raw)>65536)throw Error('TEST_CENSUS_RECEIPT_BOUND');
  const file=await fs.open(path.join(resolved,`census-${++censusCount}.json`),'wx',0o600);
  try {await file.writeFile(raw);await file.sync();}finally{await file.close();}
  return {status:snapshot.status,fixtureObservation:snapshot};
 };
 return runPhase1Plan({
  fixtureOnly:true,
  census:fixtureCensus,
  readLeaseIdentity:async()=>{if(snapshot.fileId!==expectedFileId)throw Error('TEST_CALLER_IDENTITY_MISMATCH');return {fileId:snapshot.fileId};},
  async acquire(identity){originalLease=await acquireSerialHostLease(target,{expectedExistingFileId:identity.fileId,fixtureRunId:path.basename(resolved).slice('sabalan-phase1-fixture-'.length)});return originalLease;},
  async audit(){
   const st=await fs.lstat(input,{bigint:true});if(!st.isFile()||st.isSymbolicLink()||st.size>65536n)throw Error('TEST_EVIDENCE_UNPROVEN');
   const f=await fs.open(input,'r');try{const opened=await f.stat({bigint:true});if(opened.ino!==st.ino||opened.size!==st.size)throw Error('TEST_EVIDENCE_CHANGED');const b=Buffer.alloc(65537);const {bytesRead}=await f.read(b,0,b.length,0);if(bytesRead>65536||BigInt(bytesRead)!==st.size)throw Error('TEST_EVIDENCE_BOUND');return {sha256:createHash('sha256').update(b.subarray(0,bytesRead)).digest('hex'),bytes:bytesRead};}finally{await f.close();}
  },
  async recordPre(evidence){
   const data={format:'phase1-test-audit/v1',stage:'PRE_RELEASE',ownLeaseClosure:'UNKNOWN_AT_RECORD',oldObligation:'RETAINED_UNRESOLVED',historicalEof:'UNKNOWN',safeState:'UNKNOWN',scopeReuse:false,evidence,directoryDurability:'UNKNOWN',ancestorRace:'UNPROVEN'};
   const staging=path.join(resolved,'audit.staging'),final=path.join(resolved,'audit.json');const f=await fs.open(staging,'wx',0o600);try{await f.writeFile(JSON.stringify(data)+'\n');await f.sync();}finally{await f.close();}await fs.link(staging,final);await fs.unlink(staging);return {root:resolved};
  },
  async recordClosed(evidence,identity,lease,pre,closure){
   if(!closure||closure.pid!==lease.originalPid||closure.exitCode!==0||closure.signal!==null||closure.stdoutEof!==true||closure.stderrEof!==true||closure.closeMarker!=='LEASE_CLOSED'||closure.evidenceType!=='ORIGINAL_PARENT_REPORTED')throw Error('TEST_OWN_CLOSURE_UNPROVEN');
   const record={stage:'OWN_LEASE_CLOSED',closure,source:'ORCHESTRATOR_REPORTED',directoryDurability:'UNKNOWN'};
   const f=await fs.open(path.join(pre.root,'closed.json'),'wx',0o600);try{await f.writeFile(JSON.stringify(record)+'\n');await f.sync();}finally{await f.close();}return record;
  },
 });
}
