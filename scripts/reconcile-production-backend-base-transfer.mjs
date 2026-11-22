import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import {backendBaseReadonlyFsyncFailure,inspectBackendBaseReadonlyFsyncFailure,stableBackendBaseFile} from './lib/production-backend-base-artifacts.mjs';
import {syncOwnedBackendBaseFile} from './lib/backend-base-owned-file.mjs';

const repository=path.resolve(import.meta.dirname,'..'),[mode='--inspect']=process.argv.slice(2);
assert.ok(['--inspect','--reconcile'].includes(mode)&&process.argv.length<=3);
const original=inspectBackendBaseReadonlyFsyncFailure(repository),prior=original.value;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function currentPins(){
  const helper=path.join(repository,'scripts/lib/production-backend-base-remote-readonly.py');
  const observer=path.join(repository,'scripts/lib/production-backend-base-observer.py');
  assert.deepEqual(stableBackendBaseFile(helper),prior.helperFile);assert.deepEqual(stableBackendBaseFile(observer),prior.observerFile);
  assert.equal(sha(Buffer.concat([fs.readFileSync(observer),Buffer.from('\n'),fs.readFileSync(helper)])),prior.remoteEnvelopeSha256);
  const known=prior.sshTrust.knownHostsFile,key=prior.sshTrust.privateKeyPath;
  assert.equal(path.resolve(known),path.resolve('C:/Users/mahan/.ssh/known_hosts'));
  assert.equal(path.resolve(key),path.resolve('C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519'));
  assert.equal(fs.realpathSync(key),path.resolve(key));const keyStat=fs.lstatSync(key,{bigint:true});assert.ok(keyStat.isFile()&&keyStat.nlink===1n);
  const metadata=['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'].map(field=>String(keyStat[field])).join(':');
  assert.equal(metadata,prior.sshTrust.privateKeyMetadata);
  assert.deepEqual(stableBackendBaseFile(known,4*1024**2),prior.sshTrust.knownHostsIdentity);
  return {helperFile:prior.helperFile,observerFile:prior.observerFile,remoteEnvelopeSha256:prior.remoteEnvelopeSha256,
    knownHostsIdentity:prior.sshTrust.knownHostsIdentity,privateKeyMetadata:metadata};
}
const pins=currentPins();
if(mode==='--inspect')console.log(JSON.stringify({originalFailedReceipt:backendBaseReadonlyFsyncFailure.receipt,
  originalFailedReceiptFile:original.receiptFile,archive:original.archive,expectedBytes:original.source.compressedBytes,
  expectedSha256:original.source.compressedSha256,currentHostPinsMatchRecordedPins:true,
  archiveHashed:false,fsyncExecuted:false,sshOrScpExecuted:false,dockerExecuted:false,originalTransferPass:false,
  originalHistoricalFinalHostPinChecksPassed:false,originalDestinationInodeContinuityProven:false,productionAdmission:false}));
else{
  const operation='production-backend-base-transfer-reconciliation-'+randomBytes(16).toString('hex');
  const report={format:'sabalan-production-backend-base-transfer-reconciliation/v2',operation,phase:'INTENT',pass:false,
    originalFailedReceipt:backendBaseReadonlyFsyncFailure.receipt,originalFailedReceiptFile:original.receiptFile,
    originalOutcomeUnchanged:true,originalTransferPass:false,originalHistoricalFinalHostPinChecksPassed:false,
    originalDestinationInodeContinuityProven:false,currentHostPinsMatchRecordedPins:true,currentPins:pins,
    source:original.source,archive:original.archive,actualRwFsyncAndReadback:false,
    sshOrScpExecuted:false,dockerExecuted:false,nativeWorkAdopted:false,productionAdmission:false,
    recoveryScope:'local-artifact-durability-and-byte-identity-only',fullOciGraphRevalidationRequiredBeforeImport:true};
  const evidence=path.join(repository,'reports/qa',operation),ownFile=stableBackendBaseFile(import.meta.filename);
  const publish=(suffix)=>{const fd=fs.openSync(evidence+suffix+'.json','wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(report,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
  publish('-intent');let failure;
  try{
    report.archiveFile=syncOwnedBackendBaseFile(original.archive,{bytes:original.source.compressedBytes,sha256:original.source.compressedSha256});
    report.actualRwFsyncAndReadback=true;
    assert.deepEqual(currentPins(),pins);assert.deepEqual(inspectBackendBaseReadonlyFsyncFailure(repository),original);
    assert.deepEqual(stableBackendBaseFile(import.meta.filename),ownFile);
    report.phase='COMPLETE';report.pass=true;
  }catch(error){failure=error;report.phase='FAILED_HELD';report.error=error instanceof Error?error.message:'ARTIFACT_RECONCILIATION_UNPROVEN';}
  publish('');console.log(JSON.stringify({receipt:evidence+'.json',phase:report.phase,pass:report.pass,originalTransferPass:false,productionAdmission:false}));
  if(failure)throw failure;
}
