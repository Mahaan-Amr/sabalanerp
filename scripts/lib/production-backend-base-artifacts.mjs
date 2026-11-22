import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const backendBaseIdentity=Object.freeze({
  exportReceipt:'production-image-export-b39dbefcc66448449f62d93159a31151.json',
  dependencyReceipt:'production-backend-dependencies-readonly-626ef06eee6b43bebd92f29b110ae845.json',
  remoteArchive:'/root/sabalan-recovery-private/production-image-export-b39dbefcc66448449f62d93159a31151/backend.docker.tar.gz',
  compressedBytes:535457062,compressedSha256:'d6f66240a68f8dbf264a0193b540435a2f8c4d11f9465db7873e0d1749532934',
  sourceIndex:'sha256:0772bcd13894be05d54c401134a197ff5906b6c5749fad53ed97de1238ddebaa',
  sourcePlatform:'sha256:46f6765209de10b67dc50fb59c24886eefbe8f207ad36469cd3f4fe4ee5ccd91',
  configIdentity:'sha256:13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6',
  rawBytes:540220928,rawSha256:'093a727439db36839eb9a36ecba5ebe95fcedbbfc943d16542b278ec69809f5a',
  packageLockSha256:'857d90c92a2d530fd610db3bc32648f20a3e513066fd7706feaa704096d9c0cf',
  node:'v22.23.3',layerCount:21,
});
export function stableBackendBaseFile(file,maximum=2*1024**3){
  file=path.resolve(file);assert.equal(fs.realpathSync(file),file);
  const identity=value=>Object.fromEntries(['dev','ino','size','mtimeNs','ctimeNs','mode','nlink'].map(key=>[key,String(value[key])]));
  const named=identity(fs.lstatSync(file,{bigint:true})),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
    const before=fs.fstatSync(fd,{bigint:true}),pinned=identity(before);
    const comparable=value=>Object.fromEntries(Object.entries(value).filter(([key])=>process.platform!=='win32'||key!=='dev'));
    assert.ok(before.isFile()&&before.nlink===1n&&before.size>=0n&&before.size<=BigInt(maximum));
    assert.deepEqual(comparable(pinned),comparable(named));
    const hash=createHash('sha256'),buffer=Buffer.alloc(262144);let bytes=0;
    for(;;){const count=fs.readSync(fd,buffer,0,buffer.length,null);if(!count)break;bytes+=count;assert.ok(bytes<=Number(before.size));hash.update(buffer.subarray(0,count));}
    assert.equal(bytes,Number(before.size));assert.deepEqual(identity(fs.fstatSync(fd,{bigint:true})),pinned);assert.deepEqual(identity(fs.lstatSync(file,{bigint:true})),named);
    return {bytes,sha256:hash.digest('hex'),identity:{...named,descriptorDevice:pinned.dev}};
  }finally{fs.closeSync(fd);}
}
function jsonFile(file){const identity=stableBackendBaseFile(file,4*1024**2),value=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  assert.deepEqual(stableBackendBaseFile(file,4*1024**2),identity);return {value,identity};}
const ordered=value=>Object.fromEntries(Object.entries(value??{}).sort(([a],[b])=>a.localeCompare(b)));

/** Catalog only. Matching lock bytes are dependency-manifest evidence, not a
 * proof of every installed package byte, schema/client or current runtime. */
export function qualifiedProductionBackendExport(repository){
  const expected=backendBaseIdentity;
  const exported=jsonFile(path.join(repository,'reports/qa',expected.exportReceipt));
  assert.equal(exported.value.sshExitCode,0);const result=JSON.parse(exported.value.stdout);
  assert.equal(result.operation,'production-image-export-b39dbefcc66448449f62d93159a31151');
  assert.equal(result.nativeExitCode,0);assert.equal(result.nativeClosureVerified,true);assert.equal(result.sourceUnchanged,true);
  assert.deepEqual(result.sourceServicesAfter,result.sourceServicesBefore);assert.equal(result.sourceServicesBefore.length,6);
  const component=result.component.images.backend,raw=component.verifiedRawArchive;
  assert.equal(component.service,'backend');assert.equal(component.fullLocalRoundtripVerified,true);
  assert.equal(component.archive,expected.remoteArchive);assert.equal(component.sourceImageId,expected.sourceIndex);
  assert.equal(component.compressedBytes,expected.compressedBytes);assert.equal(component.compressedSha256,expected.compressedSha256);
  assert.equal(raw.index,expected.sourceIndex);assert.equal(raw.platform,expected.sourcePlatform);assert.equal(raw.config,expected.configIdentity);
  assert.equal(raw.archiveBytes,expected.rawBytes);assert.equal(raw.archiveSha256,expected.rawSha256);
  assert.equal(raw.rootfsDiffIds.length,expected.layerCount);raw.rootfsDiffIds.forEach(value=>assert.match(value,/^sha256:[a-f0-9]{64}$/));
  const dependencies=jsonFile(path.join(repository,'reports/qa',expected.dependencyReceipt));
  assert.equal(dependencies.value.sshExitCode,0);const observed=JSON.parse(dependencies.value.stdout);
  assert.equal(observed.format,'sabalan-production-backend-dependencies-readonly/v1');assert.equal(observed.productionMutated,false);
  assert.deepEqual(observed.servicesAfter,observed.servicesBefore);assert.equal(Object.keys(observed.servicesBefore).length,6);
  assert.equal(observed.backendImage.id,expected.sourceIndex);assert.deepEqual(observed.backendImage.rootfsLayers,raw.rootfsDiffIds);
  assert.equal(observed.runtime.node,expected.node);assert.equal(observed.runtime.files['package-lock.json'].sha256,expected.packageLockSha256);
  const lockFile=path.join(repository,'backend/package-lock.json'),lock=jsonFile(lockFile),packageFile=jsonFile(path.join(repository,'backend/package.json'));
  assert.equal(lock.identity.sha256,expected.packageLockSha256);assert.equal(lock.identity.bytes,observed.runtime.files['package-lock.json'].bytes);
  for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies'])
    assert.deepEqual(ordered(packageFile.value[field]),ordered(lock.value.packages[''][field]),'CURRENT_BACKEND_MANIFEST_LOCK_MISMATCH_'+field);
  const dependencyManifest=Object.fromEntries(['dependencies','devDependencies','optionalDependencies','peerDependencies']
    .map(field=>[field,ordered(packageFile.value[field])]));
  return {...expected,layers:raw.rootfsDiffIds,exportReceiptFile:exported.identity,dependencyReceiptFile:dependencies.identity,
    currentPackageLock:{bytes:lock.identity.bytes,sha256:lock.identity.sha256},
    dependencyManifestSha256:createHash('sha256').update(JSON.stringify(dependencyManifest)).digest('hex'),packageScriptsExcludedFromDependencyProof:true,
    imageMapping:{localEngineIdentity:expected.sourceIndex,remoteConfigIdentity:expected.configIdentity,
      explicitIndexConfigMapping:true,configLookupRequired:false},
    dependencyProof:'exact-lock-and-observed-package-metadata-only',installedDependencyTreeQualified:false,
    currentSchemaClientQualified:false,productionAdmission:false};
}

export function freshBothHostBackendBasePreflight(repository,file,now=Date.now()){
  file=path.resolve(file);assert.equal(path.dirname(file),path.join(repository,'reports/qa'));
  const receipt=jsonFile(file),outer=receipt.value,observed=Date.parse(outer.observedAt);
  assert.ok(Number.isFinite(observed)&&now>=observed&&now-observed<=600000,'FRESH_BOTH_HOST_PREFLIGHT_REQUIRED');
  assert.equal(outer.sshExitCode,0);const result=JSON.parse(outer.stdout);
  assert.equal(result.exitCode,0);assert.equal(result.lockHeldThroughBothHostPreflight,true);
  assert.match(result.productionCommitBefore,/^[a-f0-9]{40}$/);assert.equal(result.productionCommitAfter,result.productionCommitBefore);
  const rows=result.stdout.trim().split(/\r?\n/).map(line=>JSON.parse(line));
  for(const project of ['sabalanerp','sabalanerp-backup']){
    const found=rows.filter(row=>row.project===project);assert.equal(found.length,1);assert.equal(found[0].ok,true);
    assert.ok(Number.isSafeInteger(found[0].availableBytes)&&found[0].availableBytes>=512*1024**2,'BOTH_HOST_HEADROOM_UNPROVEN');
  }
  return {file,receiptFile:receipt.identity,observedAt:outer.observedAt,productionCommit:result.productionCommitBefore,
    hosts:rows.map(row=>({project:row.project,availableBytes:row.availableBytes}))};
}

export const backendBaseReadonlyFsyncFailure=Object.freeze({
  receipt:'production-backend-base-transfer-9cea3ef0c8abde4f780af9d622690c63.json',
  sha256:'1c8ab6de062a75f87c085734efba4fbd51ea5743bf88d3b1262c78c00dfb433b',
  error:'EPERM: operation not permitted, fsync',
});
/** ONE actual terminal transfer failure; no generic failure/adoption path. */
export function inspectBackendBaseReadonlyFsyncFailure(repository){
  const receipt=jsonFile(path.join(repository,'reports/qa',backendBaseReadonlyFsyncFailure.receipt));
  assert.equal(receipt.identity.sha256,backendBaseReadonlyFsyncFailure.sha256);
  const value=receipt.value,source=qualifiedProductionBackendExport(repository);
  assert.equal(value.format,'sabalan-production-backend-base-transfer/v1');assert.equal(value.phase,'FAILED_HELD');assert.equal(value.pass,false);
  assert.equal(value.error,backendBaseReadonlyFsyncFailure.error);assert.equal(value.archiveFile,undefined);
  assert.equal(value.operation+'.json',backendBaseReadonlyFsyncFailure.receipt);assert.deepEqual(value.source,source);
  assert.equal(value.sourceExportReceipt,source.exportReceipt);
  const children=[value.beforeCommand,value.scp,value.afterCommand];
  for(const child of children){assert.ok(Number.isSafeInteger(child.originalPid)&&child.originalPid>0);
    assert.equal(child.code,0);assert.equal(child.signal,null);assert.equal(child.naturalChildClosure,true);
    assert.equal(child.outputBoundExceeded,false);assert.equal(child.spawnError,undefined);assert.equal(child.streamError,undefined);}
  assert.equal(new Set(children.map(child=>child.originalPid)).size,3);
  assert.deepEqual(value.originalChildren,{allOriginalChildrenClosed:true,childCount:3,interrupted:false});
  for(const [command,observation]of [[value.beforeCommand,value.before],[value.afterCommand,value.after]]){
    assert.deepEqual(JSON.parse(command.stdout),observation);
    assert.equal(observation.format,'sabalan-backend-base-source-readonly/v1');assert.equal(observation.archive,source.remoteArchive);
    assert.equal(observation.bytes,source.compressedBytes);assert.equal(observation.sha256,source.compressedSha256);
    assert.equal(observation.productionMutation,false);assert.equal(observation.allOriginalObserversClosed,true);
    assert.deepEqual(observation.servicesBefore,observation.servicesAfter);assert.equal(Object.keys(observation.servicesBefore).length,6);
  }
  assert.deepEqual(value.before.identity,value.after.identity);assert.deepEqual(value.before.servicesBefore,value.after.servicesAfter);
  assert.equal(value.sourceArchiveUnchanged,true);assert.equal(value.productionServicesUnchanged,true);assert.equal(value.productionMutation,false);
  const archive=path.resolve('D:/sabalanerp-online-qa',value.operation,'backend.docker.tar.gz');assert.equal(path.resolve(value.archive),archive);
  assert.equal(path.resolve(value.root),path.dirname(archive));assert.equal(fs.realpathSync(path.dirname(archive)),path.dirname(archive));
  return {value,receiptFile:receipt.identity,source,archive};
}

export function qualifiedProductionBackendArchive(repository,receiptName){
  if(/^production-backend-base-transfer-reconciliation-[a-f0-9]{32}\.json$/.test(receiptName)){
    const receipt=jsonFile(path.join(repository,'reports/qa',receiptName)),value=receipt.value;
    assert.equal(value.format,'sabalan-production-backend-base-transfer-reconciliation/v2');assert.equal(value.phase,'COMPLETE');assert.equal(value.pass,true);
    const original=inspectBackendBaseReadonlyFsyncFailure(repository);
    assert.equal(value.originalFailedReceipt,backendBaseReadonlyFsyncFailure.receipt);assert.deepEqual(value.originalFailedReceiptFile,original.receiptFile);
    assert.equal(value.originalOutcomeUnchanged,true);assert.equal(value.originalTransferPass,false);
    assert.equal(value.originalHistoricalFinalHostPinChecksPassed,false);assert.equal(value.originalDestinationInodeContinuityProven,false);
    assert.equal(value.currentHostPinsMatchRecordedPins,true);assert.equal(value.actualRwFsyncAndReadback,true);
    assert.equal(value.sshOrScpExecuted,false);assert.equal(value.dockerExecuted,false);assert.equal(value.nativeWorkAdopted,false);
    assert.deepEqual(value.source,original.source);assert.equal(path.resolve(value.archive),original.archive);
    const archiveFile=stableBackendBaseFile(original.archive);assert.equal(archiveFile.bytes,original.source.compressedBytes);
    assert.equal(archiveFile.sha256,original.source.compressedSha256);assert.deepEqual(archiveFile,value.archiveFile);
    return {archive:original.archive,archiveFile,transferReceipt:receiptName,transferReceiptFile:receipt.identity,source:original.source,
      predecessorFailedTransferReceipt:backendBaseReadonlyFsyncFailure.receipt,predecessorFailedTransferReceiptFile:original.receiptFile};
  }
  assert.match(receiptName,/^production-backend-base-transfer-[a-f0-9]{32}\.json$/);
  const source=qualifiedProductionBackendExport(repository),receipt=jsonFile(path.join(repository,'reports/qa',receiptName)),value=receipt.value;
  assert.equal(value.format,'sabalan-production-backend-base-transfer/v1');assert.equal(value.phase,'COMPLETE');assert.equal(value.pass,true);
  assert.equal(value.operation+'.json',receiptName);assert.equal(value.sourceExportReceipt,source.exportReceipt);
  assert.equal(value.scp.code,0);assert.equal(value.scp.signal,null);assert.equal(value.scp.naturalChildClosure,true);
  for(const command of [value.beforeCommand,value.afterCommand]){
    assert.equal(command.code,0);assert.equal(command.signal,null);assert.equal(command.naturalChildClosure,true);
    assert.equal(command.outputBoundExceeded,false);assert.equal(command.spawnError,undefined);assert.equal(command.streamError,undefined);
  }
  assert.equal(value.originalChildren.allOriginalChildrenClosed,true);assert.equal(value.originalChildren.interrupted,false);
  assert.equal(value.sourceArchiveUnchanged,true);assert.equal(value.productionServicesUnchanged,true);assert.equal(value.productionMutation,false);
  assert.deepEqual(value.source,source);
  const archive=path.resolve('D:/sabalanerp-online-qa',value.operation,'backend.docker.tar.gz');assert.equal(path.resolve(value.archive),archive);
  const archiveFile=stableBackendBaseFile(archive);assert.equal(archiveFile.bytes,source.compressedBytes);assert.equal(archiveFile.sha256,source.compressedSha256);
  assert.deepEqual(archiveFile,value.archiveFile);
  return {archive,archiveFile,transferReceipt:receiptName,transferReceiptFile:receipt.identity,source};
}

export function qualifiedBackendRuntimeBase(repository,receiptName){
  assert.match(receiptName,/^production-backend-base-local-[a-f0-9]{32}\.json$/);
  const receipt=jsonFile(path.join(repository,'reports/qa',receiptName)),value=receipt.value;
  assert.equal(value.format,'sabalan-production-backend-base-local/v1');assert.equal(value.phase,'COMPLETE');assert.equal(value.pass,true);
  const source=qualifiedProductionBackendArchive(repository,value.source.transferReceipt);assert.deepEqual(value.source,source);
  assert.equal(value.load.code,0);assert.equal(value.load.signal,null);assert.equal(value.load.naturalChildClosure,true);
  assert.equal(value.load.outputBoundExceeded,false);assert.equal(value.load.spawnError,undefined);assert.equal(value.load.streamError,undefined);
  assert.equal(value.explicitIndexConfigMapping,true);assert.equal(value.image.id,source.source.sourceIndex);
  assert.deepEqual(value.image.layers,source.source.layers);assert.equal(value.noMutableAliasesCreated,true);
  assert.equal(value.rawFile.bytes,source.source.rawBytes);assert.equal(value.rawFile.sha256,source.source.rawSha256);
  assert.equal(value.rawGraph.index,source.source.sourceIndex);assert.equal(value.rawGraph.platform,source.source.sourcePlatform);
  assert.equal(value.rawGraph.config,source.source.configIdentity);assert.deepEqual(value.rawGraph.rootfsDiffIds,source.source.layers);
  assert.equal(value.noAliasArchive.manifestTagsAbsent,true);assert.equal(value.noAliasArchive.ociImportAliasesAbsent,true);
  assert.equal(value.originalChildren.allOriginalChildrenClosed,true);assert.equal(value.originalChildren.interrupted,false);
  assert.equal(value.protectedServicesUnchanged,true);assert.deepEqual(value.servicesAfter,value.servicesBefore);
  assert.deepEqual(Object.keys(value.servicesBefore).sort(),['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained'].sort());
  return {baseImage:source.source.sourceIndex,configIdentity:source.source.configIdentity,receipt:receiptName,receiptFile:receipt.identity,source,
    installedDependencyTreeQualified:false,currentSchemaClientQualified:false,productionAdmission:false};
}
