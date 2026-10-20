import {readMeasuredFrontendSnapshot} from '../../deploy/scripts/production-frontend-snapshot.mjs';
import {inspectPrivateDockerArchive} from './private-docker-image-archive.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const productionFrontendConfig = 'sha256:55ae5c9b07716b503c6b941755003afa9fca983cb4d4fe49540ddf3af4831046';
const transferName = 'production-frontend-base-transfer-c37071ab25dc45f4b708872172fdf8a0.json';
const exportName = 'production-image-export-b39dbefcc66448449f62d93159a31151.json';
export function stableFrontendBaseFile(file, limit = 1024 * 1024 ** 2) {
  file = path.resolve(file); assert.equal(fs.realpathSync(file), file);
  const identity = value => Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'].map(key => [key,String(value[key])]));
  const named = identity(fs.lstatSync(file, {bigint:true}));
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd, {bigint:true}), pinned = identity(opened);
    const cross = value => Object.fromEntries(Object.entries(value).filter(([key]) => process.platform !== 'win32' || key !== 'dev'));
    assert.ok(opened.isFile() && opened.nlink === 1n && opened.size <= BigInt(limit));
    assert.deepEqual(cross(pinned), cross(named));
    const hash = createHash('sha256'), buffer = Buffer.alloc(262144); let bytes = 0;
    for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break;
      bytes += n; assert.ok(bytes <= Number(opened.size)); hash.update(buffer.subarray(0,n)); }
    assert.equal(bytes, Number(opened.size)); assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),pinned);
    assert.deepEqual(identity(fs.lstatSync(file,{bigint:true})),named);
    return {bytes,sha256:hash.digest('hex'),identity:{...named,descriptorDevice:pinned.dev}};
  } finally { fs.closeSync(fd); }
}

export function qualifiedProductionFrontendArchive(repository, snapshotSelection=null) {
  if(snapshotSelection){assert.deepEqual(Object.keys(snapshotSelection).sort(),['file','sha256']);const measured=readMeasuredFrontendSnapshot(fs.realpathSync(snapshotSelection.file),snapshotSelection.sha256),source=measured.source,archive=fs.realpathSync(source.archive),proof=inspectPrivateDockerArchive(archive,source.sourceIndex);assert.deepEqual(proof,measured.packet.archive.proof);const archiveFile=stableFrontendBaseFile(archive);assert.equal(archiveFile.sha256,proof.archiveSha256);return{archive,archiveFile,configIdentity:source.configIdentity,sourceIndex:source.sourceIndex,sourcePlatform:source.sourcePlatform,layers:source.layers,snapshotSelection:{file:fs.realpathSync(snapshotSelection.file),sha256:snapshotSelection.sha256},sourceSnapshot:measured.browser.sourceSnapshot};}

  const transferPath = path.join(repository,'reports/qa',transferName), exportPath = path.join(repository,'reports/qa',exportName);
  const transferFile = stableFrontendBaseFile(transferPath,4*1024**2), exportFile = stableFrontendBaseFile(exportPath,4*1024**2);
  const transfer = JSON.parse(fs.readFileSync(transferPath)), exported = JSON.parse(fs.readFileSync(exportPath));
  assert.equal(transfer.pass,true); assert.equal(transfer.scpExitCode,0); assert.equal(transfer.sourceExportReceipt,exportName);
  assert.equal(transfer.configIdentity,productionFrontendConfig); assert.equal(exported.sshExitCode,0);
  const result = JSON.parse(exported.stdout); assert.equal(result.nativeExitCode,0); assert.equal(result.nativeClosureVerified,true);
  assert.equal(result.operation,'production-image-export-b39dbefcc66448449f62d93159a31151');
  const component = result.component.images.frontend;
  assert.equal(component.fullLocalRoundtripVerified,true); assert.equal(component.service,'frontend');
  const raw = component.verifiedRawArchive;
  assert.equal(raw.config,productionFrontendConfig); assert.equal(raw.index,component.sourceImageId);
  assert.equal(raw.index,'sha256:348ceb11008abf840a878bd28c32c2910fd52649af6d04d0f1961870f57b3004');
  assert.equal(raw.rootfsDiffIds.length,12); raw.rootfsDiffIds.forEach(value=>assert.match(value,/^sha256:[a-f0-9]{64}$/));
  const archive = path.resolve(transfer.archive);
  assert.equal(archive,path.resolve('D:/sabalanerp-online-qa/production-frontend-base-transfer-c37071ab25dc45f4b708872172fdf8a0/frontend.docker.tar.gz'));
  const archiveFile = stableFrontendBaseFile(archive);
  assert.equal(archiveFile.bytes,269816525); assert.equal(archiveFile.bytes,component.compressedBytes); assert.equal(transfer.bytes,archiveFile.bytes);
  assert.equal(archiveFile.sha256,'bd5210ff1854512e1f228f6c9a3746828400b728b920d7b303c7fdc97cbbf8bc');
  assert.equal(transfer.sha256,archiveFile.sha256); assert.equal(component.compressedSha256,archiveFile.sha256);
  assert.deepEqual(stableFrontendBaseFile(transferPath,4*1024**2),transferFile);
  assert.deepEqual(stableFrontendBaseFile(exportPath,4*1024**2),exportFile);
  return {archive,archiveFile,transferReceipt:transferName,transferFile,exportReceipt:exportName,exportFile,
    configIdentity:productionFrontendConfig,sourceIndex:raw.index,sourcePlatform:raw.platform,layers:raw.rootfsDiffIds};
}

export function qualifiedFrontendRuntimeBase(repository, receiptName) {
  assert.match(receiptName,/^production-frontend-base-local-[a-f0-9]{32}\.json$/);
  const file = path.join(repository,'reports/qa',receiptName), receiptFile = stableFrontendBaseFile(file,4*1024**2);
  const receipt = JSON.parse(fs.readFileSync(file));
  assert.ok(['sabalan-production-frontend-base-local/v1','sabalan-production-frontend-engine-base-local/v1'].includes(receipt.format)); assert.equal(receipt.phase,'COMPLETE');
  assert.equal(receipt.pass,true); assert.equal(receipt.load.code,0); assert.equal(receipt.load.signal,null);
  assert.equal(receipt.load.naturalChildClosure,true); assert.equal(receipt.protectedServicesUnchanged,true);
  const source = qualifiedProductionFrontendArchive(repository); assert.deepEqual(receipt.source,source);
  let baseImage=source.configIdentity;
  if(receipt.format==='sabalan-production-frontend-engine-base-local/v1'){
    assert.equal(receipt.originalRequestedConfigIdentityFailed,true);assert.equal(receipt.noNewLoadExecuted,true);
    assert.equal(receipt.sourceConfigIdentity,source.configIdentity);assert.equal(receipt.engineImageIdentity,source.sourceIndex);
    baseImage=source.sourceIndex;
    const priorPath=path.join(repository,'reports/qa',receipt.originalFailedImportReceipt);
    assert.equal(receipt.originalFailedImportReceipt,'production-frontend-base-local-bee8adabf607c7e5eba735f328612750.json');
    assert.deepEqual(stableFrontendBaseFile(priorPath,4*1024**2),receipt.originalFailedImportReceiptFile);
    const prior=JSON.parse(fs.readFileSync(priorPath));assert.equal(prior.pass,false);assert.deepEqual(prior.load,receipt.load);
  }
  assert.equal(receipt.image.id,baseImage); assert.deepEqual(receipt.image.layers,source.layers);
  assert.deepEqual(receipt.servicesAfter,receipt.servicesBefore);
  assert.equal(Object.keys(receipt.servicesBefore).length,8);
  assert.deepEqual(stableFrontendBaseFile(receipt.load.stdoutPath,16*1024**2),receipt.load.stdoutFile);
  assert.deepEqual(stableFrontendBaseFile(receipt.load.stderrPath,16*1024**2),receipt.load.stderrFile);
  assert.deepEqual(stableFrontendBaseFile(file,4*1024**2),receiptFile);
  return {baseImage,receipt:receiptName,receiptFile,source};
}
