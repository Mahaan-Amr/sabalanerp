/** Bounded admission inventory. Reuses canonical lease/observers; no runtime promotion. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards,backendBaseLocalCapacity} from '../../../scripts/lib/production-backend-base-local-guard.mjs';
import {stableBackendBaseFile} from '../../../scripts/lib/production-backend-base-artifacts.mjs';
import {verify} from '../issue-413-backend-image-20261026/verify-artifact-handoff.mjs';
const repo=path.resolve(import.meta.dirname,'../../..');
const resultFile=path.join(import.meta.dirname,'INPUT-OBSERVATION.json');
assert.ok(!fs.existsSync(resultFile),'OBSERVATION_ALREADY_RETAINED');
const sourceRepo='C:/Users/mahan/.codex/worktrees/immutable-final-package-413/sabalanerp';
const originalRepo='C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp';
const qa='D:/sabalanerp-online-qa';
const python='C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const ref=file=>{const row=stableBackendBaseFile(file);return {file,bytes:row.bytes,sha256:row.sha256};};
const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
const report={format:'sabalan-419-input-observation/v1',startedAt:new Date().toISOString(),pass:false,
  sourceCommit:'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14',productionAdmission:false,runtimeAccepted:false,
  compilerRepeated:false,materializerRepeated:false,imageRebuilt:false,hostPackRebuilt:false,cryptoRepeated:false};
let lease,failure;
async function run(executable,args){
  const row=await commands.run(executable,args,{cwd:repo});commands.assertSuccessful(row);return row.stdout;
}
function preservation(){
  return {stagedPatchSha256:null,bytecode:ref(originalRepo+'/deploy/scripts/__pycache__/private-image-filesystem-capacity.cpython-314.pyc')};
}
try{
  lease=await acquireSerialHostLease(qa+'/deployment.lock');
  report.lease={file:qa+'/deployment.lock',originalPid:lease.originalPid,competingOriginalRefused:false};
  await assert.rejects(acquireSerialHostLease(qa+'/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);
  report.lease.competingOriginalRefused=true;lease.assertHeld();
  report.servicesBefore=await guards.protectedIdentities();
  report.capacityBefore=backendBaseLocalCapacity({rawBytes:563746304});
  const receiptFile=sourceRepo+'/reports/qa/issue-413-backend-image-20261026/RECEIPT.json';
  report.sourceReceipt=ref(receiptFile);
  assert.equal(report.sourceReceipt.sha256,'51d7380d8e7f017f6ce506b4dd70e44dd0e800d2764d62c17bb220f000ce2fec');
  const receipt=JSON.parse(fs.readFileSync(receiptFile));
  report.evidenceVerified=[];
  for(const [name,row]of Object.entries(receipt.evidence)){
    const file=path.join(sourceRepo,'reports/qa/issue-413-backend-image-20261026',name);
    const actual=ref(file);assert.equal(actual.sha256,row.sha256);assert.equal(actual.bytes,row.bytes);
    report.evidenceVerified.push(actual);
  }
  const reference=JSON.parse(fs.readFileSync(path.join(repo,'reports/qa/issue-413-backend-image-20261026/ARTIFACT-PACKAGE-REFERENCE.json')));
  for(const row of [reference.plan,reference.handoff])assert.deepEqual(ref(row.file),row);
  report.artifacts=verify(JSON.parse(fs.readFileSync(reference.plan.file)));
  report.preservationBefore=preservation();
  report.preservationBefore.stagedPatchSha256=sha(await run('git',['-C',originalRepo,'diff','--cached','--binary']));
  assert.equal(report.preservationBefore.stagedPatchSha256,'0ba0dd832216df0f2c79a9512f758ead080775591e101d7520e16c135de960a4');
  assert.equal(report.preservationBefore.bytecode.sha256,'12e9035aa9ea495505a0a64552910a40b7acf344833a139ec9f80a10c7b4cff9');
  assert.equal((await run('git',['-C',originalRepo,'rev-parse','refs/stash'])).trim(),'cd76a5619acefc35b8003ba6f7e5f0590486a361');
  report.imageStore=JSON.parse(await guards.docker(['info','--format','{"driver":{{json .Driver}},"driverStatus":{{json .DriverStatus}},"id":{{json .ID}}}']));
  const [image]=JSON.parse(await guards.docker(['image','inspect',report.artifacts.backendImage]));
  assert.equal(image.Id,report.artifacts.index);assert.deepEqual(image.RootFS.Layers,receipt.image.archiveGraph.rootfsDiffIds);
  report.localImage={id:image.Id,layers:image.RootFS.Layers,sourceCommit:image.Config.Labels['io.sabalan.compact.source-commit']};
  assert.equal(report.localImage.sourceCommit,report.sourceCommit);
  lease.assertHeld();
  report.freshBaseline=JSON.parse((await run(python,['-I','-B',qa+'/C29-installed45cab-healthy-baseline-source-r2-exact-bytes-20261024/run-baseline-observer.py',
    '--observe-reviewed','--installation',qa+'/offline-source-install-original-20261024T161731966906Z.json',
    '--installation-sha256','4ce668432ad3a82b3b1224ecc7305c1c734e9862d2bc64d1040c9073940676f3',
    '--installation-original-sha256','77f249b57bee1e92799e5b2a2b9d0bc4419f5a73ab0b76efd540dc54f026eb19'])).trim());
  assert.equal(report.freshBaseline.qualified,true);
  report.freshBaselineReference=ref(report.freshBaseline.file);
  lease.assertHeld();
  // The original factory uses its held scratch template. It creates a fresh unused preflight.
  const factory=sourceRepo+'/reports/qa/issue-413-backend-image-20261026/prepare-current-preflight.py';
  assert.equal(ref(factory).sha256,'874d2e3a86bffadbde5d17f7c3fb4fba3552d924a887f403e73e8cf4ddbdbfcf');
  report.preflightPreparation=JSON.parse((await run(python,['-I','-B',factory,report.freshBaseline.file,report.freshBaseline.sha256])).trim());
  lease.assertHeld();
  const prepared=report.preflightPreparation.source;
  assert.equal(ref(prepared.file).sha256,prepared.sha256);
  report.preflightResult=JSON.parse((await run(python,['-I','-B',prepared.file,'--execute-reviewed'])).trim());
  report.freshPreflight=ref(report.preflightResult.report??report.preflightResult.file);
  report.servicesAfter=await guards.protectedIdentities();assert.deepEqual(report.servicesAfter,report.servicesBefore);
  report.capacityAfter=backendBaseLocalCapacity({rawBytes:563746304});
  assert.deepEqual(preservation().bytecode,report.preservationBefore.bytecode);
  assert.equal(sha(await run('git',['-C',originalRepo,'diff','--cached','--binary'])),report.preservationBefore.stagedPatchSha256);
  lease.assertHeld();report.pass=true;
}catch(error){failure=error;report.error={name:error.name,message:String(error.message).slice(0,1200)};}
finally{
  report.originalChildren=await commands.close();
  if(lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}
  report.completedAt=new Date().toISOString();
  fs.writeFileSync(resultFile,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({file:resultFile,pass:report.pass,error:report.error??null}));
if(failure)process.exitCode=1;
