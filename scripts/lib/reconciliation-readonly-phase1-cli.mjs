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
    if(timedOut||exceeded||!outEof||!errEof||state.code!==0||state.signal!==null||errSize)throw Error('CENSUS_CLOSURE_UNPROVEN');
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
  if(raw.format!=='phase1-process-snapshot/v1' || raw.completeActorCensus!==false || !Array.isArray(raw.matches) || raw.matches.length>128) throw Error('CENSUS_OUTPUT_INVALID');
  const validDate=value=>typeof value==='string'&&value.length<=40&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
  if(!validDate(raw.atUtc)||!validDate(raw.bootUtc))throw Error('CENSUS_TIMESTAMP_INVALID');
  const matches=raw.matches.map(({ProcessId,ParentProcessId,Name,CreationDate,SessionId})=>{
    if(!Number.isSafeInteger(ProcessId)||!Number.isSafeInteger(ParentProcessId)||typeof Name!=='string'||!/^[A-Za-z0-9_. -]{1,128}$/.test(Name)||!validDate(CreationDate)||!Number.isSafeInteger(SessionId))throw Error('CENSUS_PROCESS_INVALID');
    return {ProcessId,ParentProcessId,Name,CreationDate,SessionId};
  });
  const snapshot={format:'phase1-process-snapshot/v1',atUtc:raw.atUtc,bootUtc:raw.bootUtc,
    historicPids:[33376,46404,35996,34300,49140],matches,commandLines:'REDACTED',completeActorCensus:false,
    jobIdentity:'UNKNOWN',leaseOwner:'UNKNOWN',scopeIdentities:'UNKNOWN'};
  if(!sourceBytes.equals(await readFile(source))) throw Error('CENSUS_SOURCE_CHANGED');
  const evidence=[];
  for(const [label,file] of evidencePaths)evidence.push(await readFixedEvidence(label,file));
  return {caseRootMetadata:{device:String(st.dev),inode:String(st.ino)},
    processSnapshot:snapshot,processSourceSha256:sourceSha256,sourcePin:'PATHNAME_SNAPSHOT_TOCTOU_UNPROVEN',evidence,
    actorCensus:'UNKNOWN',scopeIdentity:'UNKNOWN',sqlReaders:'UNKNOWN',
    oldObligation:'RETAINED_UNRESOLVED',historicalEof:'UNKNOWN',safeState:'UNKNOWN'};
}
async function writeDiagnostic(census, failure) {
  // Diagnostic only: a new UUID directory, exclusively created, no case writes.
  // Default process ACL applies; this is not claimed as a private/fully durable
  // release receipt until an independently reviewed Windows DACL/fsync adapter.
  const root=path.join(tmpdir(),`sabalan-phase1-diagnostic-${randomUUID()}`);
  await mkdir(root,{recursive:false,mode:0o700});
  const target=path.join(root,'diagnostic.json');const staging=path.join(root,'diagnostic.staging');
  const report={format:'phase1-source-review-diagnostic/v1',caseOperation:'a0d2baba08ec7e004d1458675799db6a',
    census:census??'UNKNOWN',failure:failure??null,liveLeaseAcquired:false,productionAdmission:false,
    scopeReuse:false,authority:'UNPROVEN',release:'NOT_APPLICABLE',status:'NOT_QUALIFIED'};
  const f=await open(staging,'wx',0o600);
  try { const raw=JSON.stringify(report)+'\n';if(Buffer.byteLength(raw)>65536)throw Error('RECEIPT_BOUND_EXCEEDED');await f.writeFile(raw); await f.sync(); }
  finally { await f.close(); }
  // Hard-link publication is no-replace; a torn staging file is not success.
  await link(staging,target);
  await unlink(staging);
  return {target,directoryDurability:'UNKNOWN',acl:'UNVERIFIED_DEFAULT'};
}
async function main() {
  if (process.platform!=='win32' || process.argv.length!==2) throw Error('FIXED_MODE_REQUIRED');
  let census, failure=null;
  try { census=await boundedReadOnlyCensus(); } catch(e) { failure=e.name; }
  const receipt=await writeDiagnostic(census,failure);
  console.log(JSON.stringify(receipt));
  process.exitCode=2;
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
