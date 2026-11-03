/** Source-review only. Fail-closed CLI: no operational lease or target writes. */
import {mkdir, open, lstat, link, unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const caseRoot = 'D:\\sabalanerp-online-qa\\419-safe-rollback-a0d2baba08ec7e004d1458675799db6a';
const evidencePaths=Object.freeze([
  ['baseline',path.join(caseRoot,'baseline.json')],
  ['roleHeld','C:\\Users\\mahan\\.codex\\worktrees\\native-c3-execution-419\\sabalanerp\\reports\\qa\\application-native-b0db9e621d4d29fa857a13285ca6254b-role-held.json'],
]);
export async function readFixedEvidence(label,file) {
  const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'reconciliation-phase1-evidence.ps1');
  const bytes=await readFile(source);if(bytes.length>65536)throw Error('EVIDENCE_SOURCE_BOUND');
  const raw=JSON.parse(await observeCensusChild(source,['-Target',file]));
  if(raw.format!=='phase1-evidence-snapshot/v1'||!Number.isSafeInteger(raw.bytes)||raw.bytes<0||raw.bytes>16777216||!/^\w+$/.test(label)||!/^[a-f0-9]{64}$/.test(raw.sha256)||!/^\d+:[a-f0-9]{32}$/.test(raw.fileId)||raw.ancestorRace!=='UNPROVEN'||raw.concurrentContentMutation!=='UNPROVEN')throw Error('EVIDENCE_OUTPUT_INVALID');
  if(!bytes.equals(await readFile(source)))throw Error('EVIDENCE_SOURCE_CHANGED');
  return {label,bytes:raw.bytes,sha256:raw.sha256,fileId:raw.fileId,sourceSha256:createHash('sha256').update(bytes).digest('hex'),pathSnapshot:'NONATOMIC_ANCESTOR_UNPROVEN',concurrentContentMutation:'UNPROVEN'};
}
async function observeCensusChild(source,args=[],deadlineMs=15000) {
  const child=spawn('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile','-NonInteractive','-File',source,...args],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  const out=[],err=[];let outSize=0,errSize=0,exceeded=false,timedOut=false,outEof=false,errEof=false,termination='NOT_REQUESTED';
  const stopOwnChild=()=>{
    if(termination!=='NOT_REQUESTED')return;
    try { termination=child.kill()?'REQUESTED':'UNCONFIRMED'; } catch { termination='UNCONFIRMED'; }
  };
  const deadline=setTimeout(()=>{timedOut=true;stopOwnChild();},deadlineMs);
  const collect=(stream,name)=>new Promise((resolve,reject)=>{
    stream.on('data',chunk=>{
      if(name==='out') {outSize+=chunk.length;if(outSize<=65536)out.push(chunk);else {exceeded=true;stopOwnChild();}}
      else {errSize+=chunk.length;if(errSize<=65536)err.push(chunk);else {exceeded=true;stopOwnChild();}}
    });
    stream.once('end',()=>{if(name==='out')outEof=true;else errEof=true;resolve();});
    stream.once('error',reject);
  });
  const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
  try {
    const outcomes=await Promise.allSettled([exit,collect(child.stdout,'out'),collect(child.stderr,'err')]);
    if(outcomes.some(item=>item.status!=='fulfilled'))throw Error('CENSUS_CLOSURE_UNPROVEN');
    const state=outcomes[0].value;
    if(timedOut||exceeded||!outEof||!errEof||state.code!==0||state.signal!==null||errSize){
      const failure=new Error('CENSUS_CLOSURE_UNPROVEN');
      const stderrBytes=Buffer.concat(err,errSize<=65536?errSize:undefined);
      const stderrText=stderrBytes.toString('utf8');
      failure.details={pid:child.pid,exitCode:state.code,signal:state.signal,stdoutEof:outEof,stderrEof:errEof,timedOut,exceeded,stderrCapturedSha256:createHash('sha256').update(stderrBytes).digest('hex'),stderrComplete:errEof&&!exceeded,nativeCode:stderrText.match(/IDENTITY_NATIVE_CODE=(\d+|UNAVAILABLE)/)?.[1]??'UNAVAILABLE',birth:'UNKNOWN'};throw failure;
    }
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(out,outSize));
  } finally { clearTimeout(deadline); }
}
export async function boundedReadOnlyCensus() {
  // This single observation is intentionally not a complete actor census.
  const st = await lstat(caseRoot, {bigint:true});
  if (!st.isDirectory() || st.isSymbolicLink()) throw Error('CASE_ROOT_UNPROVEN');
  const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'reconciliation-phase1-census.ps1');
  const sourceBytes=await readFile(source);
  if(sourceBytes.length>65536) throw Error('CENSUS_SOURCE_BOUND_EXCEEDED');
  const sourceSha256=createHash('sha256').update(sourceBytes).digest('hex');
  const stdout=await observeCensusChild(source);
  const raw=JSON.parse(stdout);
  if(raw.format!=='phase1-process-snapshot/v1' || raw.completeActorCensus!==false || !Array.isArray(raw.matches) || raw.matches.length>128||!Number.isSafeInteger(raw.unreadableRelevant)||raw.unreadableRelevant<0) throw Error('CENSUS_OUTPUT_INVALID');
  const validDate=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
  if(!validDate(raw.atUtc)||!validDate(raw.bootUtc))throw Error('CENSUS_TIMESTAMP_INVALID');
  const matches=raw.matches.map(({ProcessId,ParentProcessId,Name,CreationDate,SessionId})=>{
    if(!Number.isSafeInteger(ProcessId)||!Number.isSafeInteger(ParentProcessId)||typeof Name!=='string'||!/^[A-Za-z0-9_. -]{1,128}$/.test(Name)||!validDate(CreationDate)||!Number.isSafeInteger(SessionId))throw Error('CENSUS_PROCESS_INVALID');
    return {ProcessId,ParentProcessId,Name,CreationDate,SessionId};
  });
  const snapshot={format:'phase1-process-snapshot/v1',atUtc:raw.atUtc,bootUtc:raw.bootUtc,
    historicPids:[33376,46404,35996,34300,49140],matches,unreadableRelevant:raw.unreadableRelevant,commandLines:'REDACTED',completeActorCensus:false,
    jobIdentity:'UNKNOWN',leaseOwner:'UNKNOWN',scopeIdentities:'UNKNOWN'};
  if(!sourceBytes.equals(await readFile(source))) throw Error('CENSUS_SOURCE_CHANGED');
  const evidence=[];
  for(const [label,file] of evidencePaths)evidence.push(await readFixedEvidence(label,file));
  return {caseRootMetadata:{device:String(st.dev),inode:String(st.ino)},
    processSnapshot:snapshot,processSourceSha256:sourceSha256,sourcePin:'PATHNAME_SNAPSHOT_TOCTOU_UNPROVEN',evidence,
    actorCoverage:{windowsKnownEntrypoints:matches.length?'OBSERVED_CONFLICT':raw.unreadableRelevant?'UNKNOWN':'BOUNDED_NO_MATCH',
      wslNativeEntrypoints:'UNKNOWN',leaseHandleOwners:'UNKNOWN'},scopeIdentity:'UNKNOWN',sqlReaders:'UNKNOWN',
    oldObligation:'RETAINED_UNRESOLVED',historicalEof:'UNKNOWN',safeState:'UNKNOWN'};
}
export async function readOperationalLeaseIdentity() {
  const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'reconciliation-phase1-lock-identity.ps1');
  const bytes=await readFile(source);if(bytes.length>65536)throw Error('LEASE_IDENTITY_SOURCE_BOUND');
  const raw=JSON.parse(await observeCensusChild(source));
  if(raw.format!=='phase1-lock-identity/v1'||!/^\d+:[a-f0-9]{32}$/.test(raw.fileId)||raw.ancestorRace!=='UNPROVEN'||raw.ownership!=='UNKNOWN')throw Error('LEASE_IDENTITY_UNPROVEN');
  if(!bytes.equals(await readFile(source)))throw Error('LEASE_IDENTITY_SOURCE_CHANGED');
  return {fileId:raw.fileId,sourceSha256:createHash('sha256').update(bytes).digest('hex'),ancestorRace:'UNPROVEN',ownership:'UNKNOWN'};
}
export async function verifyStagedSourceDenial(){
  const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'reconciliation-phase1-source-proof.ps1');
  const raw=JSON.parse(await observeCensusChild(source));
  if(raw.format!=='phase1-staged-source-denial/v1'||raw.files!==16||raw.writeDenied!==true||raw.deleteDenied!==true||!/^\d+:[a-f0-9]{32}$/.test(raw.outputRootFileId)||raw.outputIdentity!=='PARENT_REPORTED_AND_REOBSERVED'||raw.ancestorRace!=='UNPROVEN'||raw.continuity!=='PARENT_HELD_ONLY')throw Error('STAGED_SOURCE_PROOF_INVALID');
  return {scope:'STAGED_FILES_ONLY',outputRootFileId:raw.outputRootFileId,outputIdentity:raw.outputIdentity,ancestorRace:'UNPROVEN',continuity:'PARENT_HELD_ONLY'};
}
export async function readTestOwnedNativeSnapshot(root) {
  const resolved=path.resolve(root);
  if(path.dirname(resolved)!==path.resolve(tmpdir())||!/^sabalan-phase1-fixture-[a-f0-9]{32}$/.test(path.basename(resolved)))throw Error('TEST_ROOT_REQUIRED');
  const base=path.dirname(fileURLToPath(import.meta.url));
  const censusSource=path.join(base,'reconciliation-phase1-census.ps1');
  const identitySource=path.join(base,'reconciliation-phase1-lock-identity.ps1');
  let census;
  try {census=JSON.parse(await observeCensusChild(censusSource,['-FixtureRoot',resolved]));}
  catch(cause){const error=new Error('FIXTURE_NATIVE_CENSUS_FAILED',{cause});error.substage='NATIVE_CENSUS';throw error;}
  if(census.format!=='phase1-fixture-census/v1'||census.fixtureOnly!==true||!['OBSERVED_CONFLICT','BOUNDED_NO_MATCH','UNKNOWN'].includes(census.status)||!['UNKNOWN','PARENT_REPORTED_BINDING'].includes(census.ownerProof)||!['UNKNOWN','PARENT_REPORTED_BINDING'].includes(census.ownLeaseProof)||!Array.isArray(census.matches)||census.matches.length>128)throw Error('TEST_CENSUS_INVALID');
  if(!Number.isSafeInteger(census.unreadableRelevant)||census.unreadableRelevant<0)throw Error('TEST_CENSUS_UNREADABLE_INVALID');
  const matches=census.matches.map(({pid,parentPid,name,sessionId,birthUtc,role,job,sourceIdentity,authority})=>{
    if(!Number.isSafeInteger(pid)||!Number.isSafeInteger(parentPid)||!Number.isSafeInteger(sessionId)||typeof name!=='string'||!/^[A-Za-z0-9_. -]{1,128}$/.test(name)||typeof birthUtc!=='string'||!/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(birthUtc)||!['ANCESTOR_CANDIDATE_UNPROVEN','HOST_LEASE_PATH_MATCH','FIXTURE_ROOT_PATH_MATCH'].includes(role)||job!=='UNKNOWN'||sourceIdentity!=='UNPROVEN'||authority!=='UNPROVEN')throw Error('TEST_CENSUS_ACTOR_INVALID');
    return {pid,parentPid,name,sessionId,birthUtc,role,job,sourceIdentity,authority};
  });
  const checkNames=['proof','parent','ancestor','launcherBirthUs','parentBirthUs','job','nodePin','launcherPin','nodeHash','launcherHash'];
  if(!census.ownerChecks||census.birthPrecision!=='CIM_MICROSECONDS_TRUNCATED'||census.rawFiletime!=='RETAINED_IN_SUPERVISOR_PROOF')throw Error('TEST_OWNER_CHECKS_INVALID');
  const ownerChecks={};
  for(const name of checkNames){const item=census.ownerChecks[name];if(!item||!['MATCH','MISMATCH','UNKNOWN'].includes(item.status)||typeof item.expected!=='string'||typeof item.actual!=='string'||!/^[A-Za-z0-9_]{1,128}$/.test(item.expected)||!/^[A-Za-z0-9_]{1,128}$/.test(item.actual))throw Error('TEST_OWNER_CHECK_INVALID');ownerChecks[name]={status:item.status,expected:item.expected,actual:item.actual};}
  if(census.status!=='BOUNDED_NO_MATCH')return {status:census.status,fixtureOnly:true,matches,ownerProof:census.ownerProof,ownLeaseProof:census.ownLeaseProof,ownerChecks,birthPrecision:census.birthPrecision,globalCoverage:'UNPROVEN'};
  let identity;
  try {identity=JSON.parse(await observeCensusChild(identitySource,['-FixtureRoot',resolved]));}
  catch(cause){const error=new Error('FIXTURE_NATIVE_IDENTITY_FAILED',{cause});error.substage='NATIVE_IDENTITY';throw error;}
  if(identity.format!=='phase1-lock-identity/v1'||!/^\d+:[a-f0-9]{32}$/.test(identity.fileId)||identity.ancestorRace!=='UNPROVEN')throw Error('TEST_IDENTITY_INVALID');
  return {status:census.status,fileId:identity.fileId,unreadableRelevant:census.unreadableRelevant,fixtureOnly:true,matches,ownerProof:census.ownerProof,ownLeaseProof:census.ownLeaseProof,ownerChecks,birthPrecision:census.birthPrecision,globalCoverage:'UNPROVEN'};
}

export async function writeDiagnostic(census, failure, fixtureOnly=false) {
  // Diagnostic only: a new UUID directory, exclusively created, no case writes.
  // Default process ACL applies; this is not claimed as a private/fully durable
  // release receipt until an independently reviewed Windows DACL/fsync adapter.
  const root=path.join(tmpdir(),`sabalan-phase1-diagnostic-${randomUUID()}`);
  await mkdir(root,{recursive:false,mode:0o700});
  const target=path.join(root,'diagnostic.json');const staging=path.join(root,'diagnostic.staging');
  if(failure!==null&&(!['Error','SyntaxError','TypeError'].includes(failure)))throw Error('DIAGNOSTIC_FAILURE_INVALID');
  if(census!==null&&(!census.processSnapshot||census.processSnapshot.format!=='phase1-process-snapshot/v1'||census.processSnapshot.completeActorCensus!==false||!Array.isArray(census.evidence)||census.evidence.length!==2))throw Error('DIAGNOSTIC_SCHEMA_INVALID');
  if(census!==null){
    const coverage=census.actorCoverage;
    if(!coverage||!['OBSERVED_CONFLICT','BOUNDED_NO_MATCH','UNKNOWN'].includes(coverage.windowsKnownEntrypoints)||coverage.wslNativeEntrypoints!=='UNKNOWN'||coverage.leaseHandleOwners!=='UNKNOWN')throw Error('DIAGNOSTIC_COVERAGE_INVALID');
    for(const [index,item] of census.evidence.entries())if(item.label!==['baseline','roleHeld'][index]||!Number.isSafeInteger(item.bytes)||item.bytes<0||item.bytes>16777216||!/^[a-f0-9]{64}$/.test(item.sha256)||!/^\d+:[a-f0-9]{32}$/.test(item.fileId)||!/^[a-f0-9]{64}$/.test(item.sourceSha256)||item.pathSnapshot!=='NONATOMIC_ANCESTOR_UNPROVEN'||item.concurrentContentMutation!=='UNPROVEN')throw Error('DIAGNOSTIC_EVIDENCE_INVALID');
  }
  const sanitized=census===null?null:{
    format:'phase1-census-summary/v1',actorCoverage:{windowsKnownEntrypoints:census.actorCoverage.windowsKnownEntrypoints,wslNativeEntrypoints:'UNKNOWN',leaseHandleOwners:'UNKNOWN'},
    evidence:census.evidence.map(({label,bytes,sha256,fileId,sourceSha256,pathSnapshot,concurrentContentMutation})=>({label,bytes,sha256,fileId,sourceSha256,pathSnapshot,concurrentContentMutation})),
    historicalEof:'UNKNOWN',safeState:'UNKNOWN',oldObligation:'RETAINED_UNRESOLVED',
  };
  const report={format:'phase1-source-review-diagnostic/v1',caseOperation:'a0d2baba08ec7e004d1458675799db6a',
    census:sanitized??'UNKNOWN',failure:failure??null,fixtureOnly:fixtureOnly===true,liveLeaseAcquired:false,productionAdmission:false,
    scopeReuse:false,authority:'UNPROVEN',release:'NOT_APPLICABLE',status:'NOT_QUALIFIED'};
  const f=await open(staging,'wx',0o600);
  try { const raw=JSON.stringify(report)+'\n';if(Buffer.byteLength(raw)>65536)throw Error('RECEIPT_BOUND_EXCEEDED');await f.writeFile(raw); await f.sync(); }
  finally { await f.close(); }
  // Hard-link publication is no-replace; a torn staging file is not success.
  await link(staging,target);
  await unlink(staging);
  return {target,directoryDurability:'UNKNOWN',acl:'UNVERIFIED_DEFAULT'};
}

export async function prepareDiagnosticReport() {
  if (process.platform!=='win32') throw Error('FIXED_MODE_REQUIRED');
  let census, failure=null;
  try { census=await boundedReadOnlyCensus(); } catch(e) { failure=e.name; }
  const receipt=await writeDiagnostic(census,failure);
  return {receipt,census:census??null,failure,status:'NOT_QUALIFIED'};
}
async function main() {
  if(process.argv.length===3&&['--test-owned-success','--test-owned-failure'].includes(process.argv[2])){
    const evidence=label=>({label,bytes:0,sha256:'0'.repeat(64),fileId:'1:'+'0'.repeat(32),sourceSha256:'0'.repeat(64),pathSnapshot:'NONATOMIC_ANCESTOR_UNPROVEN',concurrentContentMutation:'UNPROVEN'});
    const census=process.argv[2]==='--test-owned-success'?{processSnapshot:{format:'phase1-process-snapshot/v1',completeActorCensus:false},actorCoverage:{windowsKnownEntrypoints:'BOUNDED_NO_MATCH',wslNativeEntrypoints:'UNKNOWN',leaseHandleOwners:'UNKNOWN'},evidence:[evidence('baseline'),evidence('roleHeld')]}:null;
    const receipt=await writeDiagnostic(census,census?null:'Error',true);console.log(JSON.stringify(receipt));return;
  }
  if (process.argv.length!==2) throw Error('FIXED_MODE_REQUIRED');
  const {receipt}=await prepareDiagnosticReport();
  console.log(JSON.stringify(receipt));
  process.exitCode=2;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
