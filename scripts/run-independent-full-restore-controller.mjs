import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {createRequire} from 'node:module';
import {readIndependentCheckpointTransport} from './lib/independent-checkpoint-transport.mjs';
import {createOriginalIndependentQualificationController} from './lib/independent-private-qualification-controller.mjs';
import {compileIndependentPhysicalReplay,assertIndependentPhysicalReplayObserved} from './lib/independent-physical-replay.mjs';

const PRIVATE='/root/sabalan-recovery-private',QA=PRIVATE+'/native-qa',CHECKPOINTS='/srv/sabalanerp-recovery/checkpoints';
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const bytes=value=>Buffer.from(JSON.stringify(canonical(value))+'\n');
const same=(a,b)=>assert.deepEqual(a,b);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const pin=s=>['dev','ino','size','mtimeNs','ctimeNs','uid','mode','nlink'].map(k=>String(s[k])).join(':');
const MIB=1024**2;
const CAPS=Object.freeze({postgres:384,control:768,backend:768,frontend:512,inquiry:512,originalNode:192,controlReserve:128});
const completions=new WeakMap(),physicalCompletions=new WeakMap();
export function readOriginalIndependentRestoreCompletion(token){const value=completions.get(token);assert.ok(value,'ORIGINAL_BACKUP_RESTORE_COMPLETION_UNPROVEN');return value;}
export function readOriginalIndependentPhysicalRestoreCompletion(token){const value=physicalCompletions.get(token);assert.ok(value,'ORIGINAL_BACKUP_PHYSICAL_RESTORE_COMPLETION_UNPROVEN');return value;}
export function validateSelectedImageReceipt(role,selected,receipt){
  const sourceIdentity=selected.sourceImageId;
  if(role==='frontend'){
    same(receipt.format,'sabalan-current-frontend-image-build/v2');same(receipt.phase,'COMPLETE');same(receipt.pass,true);
    same(receipt.outputImage.id,sourceIdentity);same(receipt.manifestSha256,selected.manifestSha256);same(receipt.buildId,selected.buildId);
    same(receipt.materializationReceiptSha256,selected.materializationReceiptSha256);
    same(receipt.contextInventory['online-runtime-verify.cjs'],selected.verifierSha256);
  }else if(role==='backend'){
    same(receipt.format,'sabalan-current-backend-image/v1');same(receipt.pass,true);same(receipt.image.id,sourceIdentity);same(receipt.sourceCommit,selected.sourceCommit);
  }else if(role==='inquiry'){
    // The wrapper report and the image producer receipt are different shapes.
    // Both select the SAME exact immutable image; neither is a runtime grant.
    const value=receipt.imageReceipt??receipt;same(value.format,'sabalan-inquiry-native-image-diagnostic/v1');same(value.image,sourceIdentity);
    assert.ok(hex(value.archiveSha256));same(value.archiveSha256,selected.archiveSha256);
    same(value.runtimeSourceHashes,selected.runtimeSourceHashes);
  }else{same(receipt.imageId,selected.id);same(receipt.format,'sabalan-independent-postgres-image/v1');}
  return receipt;
}
export function validateSelectedArchiveGraph(selected,receipt){
  const graph=selected.archiveGraph;
  same(graph.index,selected.sourceImageId);same(graph.config,selected.id);
  for(const key of ['index','platform','config'])assert.match(graph[key],/^sha256:[a-f0-9]{64}$/);
  assert.ok(Array.isArray(graph.rootfsDiffIds)&&graph.rootfsDiffIds.length>0&&graph.rootfsDiffIds.length<=128);
  for(const value of graph.rootfsDiffIds)assert.match(value,/^sha256:[a-f0-9]{64}$/);
  assert.ok(hex(graph.archiveSha256)&&Number.isSafeInteger(graph.archiveBytes)&&graph.archiveBytes>0);
  for(const key of ['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'])same(receipt[key],graph[key]);
  return graph;
}
const LEGACY_BACKUP_QA_CACHES=Object.freeze({"backend":{"id":"sha256:13c89b392eb1903f55c1160f4f5f72a85d0ec57cd39476edff7928453516dde6","sourceImageId":"sha256:0772bcd13894be05d54c401134a197ff5906b6c5749fad53ed97de1238ddebaa","metadataPath":"/root/sabalan-recovery-private/native-qa/independent-image-custody-65cb95d50af8415aa569267d7ecd99bf/ciphertexts/private-component.json","metadataSha256":"f1d22ca1f9eddf09c2f9317b1b952c75fced7acf62a76e87119b34faadb7f85d","cipherPath":"/root/sabalan-recovery-private/native-qa/independent-image-custody-65cb95d50af8415aa569267d7ecd99bf/ciphertexts/backend.sabrec","cipherSha256":"5613ca7d681ddcea709f48f5b7536d1a5fdb7a8d059535ec638083999699fe6a","cipherBytes":535458202,"sourceSha256":"d6f66240a68f8dbf264a0193b540435a2f8c4d11f9465db7873e0d1749532934","sourceBytes":535457062},"frontend":{"id":"sha256:55ae5c9b07716b503c6b941755003afa9fca983cb4d4fe49540ddf3af4831046","sourceImageId":"sha256:348ceb11008abf840a878bd28c32c2910fd52649af6d04d0f1961870f57b3004","metadataPath":"/root/sabalan-recovery-private/native-qa/independent-image-custody-65cb95d50af8415aa569267d7ecd99bf/ciphertexts/private-component.json","metadataSha256":"f1d22ca1f9eddf09c2f9317b1b952c75fced7acf62a76e87119b34faadb7f85d","cipherPath":"/root/sabalan-recovery-private/native-qa/independent-image-custody-65cb95d50af8415aa569267d7ecd99bf/ciphertexts/frontend.sabrec","cipherSha256":"cacca499637af6df2bdab64cc411996d262380efa810e189e302c46de6fe1eb6","cipherBytes":269817665,"sourceSha256":"bd5210ff1854512e1f228f6c9a3746828400b728b920d7b303c7fdc97cbbf8bc","sourceBytes":269816525},"inquiry":{"id":"sha256:0dac87a3b24af8b608f9e0a258ca0b88bcf0e3883bc4e109b8bc6bf58cad7755","sourceImageId":"sha256:ab6e2933e2d0d397f0b1a514dba69206e21856fa7d4275ab33383020bf9dd66e","metadataPath":"/root/sabalan-recovery-private/native-qa/independent-image-custody-65cb95d50af8415aa569267d7ecd99bf/ciphertexts/private-component.json","metadataSha256":"f1d22ca1f9eddf09c2f9317b1b952c75fced7acf62a76e87119b34faadb7f85d","cipherPath":"/root/sabalan-recovery-private/native-qa/independent-image-custody-65cb95d50af8415aa569267d7ecd99bf/ciphertexts/inquiry.sabrec","cipherSha256":"9e3e3d22cb5e15791e93e80848be46a61aef33ea9acfbdf21db38c2ee47eb2f6","cipherBytes":379616083,"sourceSha256":"35c815783210f84c2fd2034987e4774dd8cf6a30d8e64aef8983159d933cc409","sourceBytes":379614943}});
export function requireLegacyBackupQaTransfer(role,selected){
  const expected=LEGACY_BACKUP_QA_CACHES[role];if(!expected||selected.id!==expected.id)return false;
  const transfer=selected.transfer;assert.ok(transfer,'LEGACY_BACKUP_QA_REHYDRATION_REQUIRED');
  for(const key of ['metadataPath','metadataSha256','cipherPath','cipherBytes','cipherSha256'])same(transfer[key],expected[key]);
  same(transfer.verifyRetainedSourceBeforeReuse,true);assert.ok(!transfer.stagedFromOriginalSsh);
  same(selected.sourceImageId,expected.sourceImageId);same(selected.archiveGraph.archiveSha256,expected.sourceSha256);same(selected.archiveGraph.archiveBytes,expected.sourceBytes);
  return true;
}
export function restoreResourceBudget(metadata,blockSize=4096){
  assert.ok(Number.isSafeInteger(blockSize)&&blockSize>0);const components=metadata.manifest?.components;assert.ok(Array.isArray(components));
  const sourceBytes=metadata.capacity?.estimate?.sourceBytes;assert.ok(Number.isSafeInteger(sourceBytes)&&sourceBytes>0);
  let payloadAllocated=0,retainedAllocated=0,retainedCount=0,protectedBytes=0,protectedAllocated=0;const parents=new Set();
  for(const row of components){assert.ok(Number.isSafeInteger(row.size)&&row.size>=0&&typeof row.path==='string');
    const allocated=Math.ceil(row.size/blockSize)*blockSize;payloadAllocated+=allocated;
    if(row.path!=='database/main.dump'){protectedBytes+=row.size;protectedAllocated+=allocated;}
    const parts=row.path.split('/');for(let i=1;i<parts.length;i++)parents.add(parts.slice(0,i).join('/'));
    if(row.path.startsWith('files/')){retainedAllocated+=allocated;retainedCount++;}}
  payloadAllocated+=parents.size*blockSize;
  // Source estimate includes the actual captured physical PostgreSQL size.
  // Payload allocation rounds small files to this filesystem's actual blocks;
  // immutable publication adds data objects and per-key version/head/reservation
  // records. Only the genuine restored PG owns business data. The separately
  // observed identity database is template0, bounded below, never a clone.
  const baselineAdditional=retainedAllocated+(retainedCount*5+parents.size+9*8)*blockSize;
  const postgresBaseAndWal=192*MIB,logsAndMetadata=192*MIB,remainingHostReserve=64*MIB;
  // Captured sourceBytes = physical PG + protected-file logical bytes (the
  // canonical capacity producer). Subtract only bytes actually present in the
  // manifest: excluded coordination bytes remain a conservative PG allowance.
  // The encrypted source already exists; metadata.size here bounds the NEW
  // decrypted compressed archive. Validation removes its stage before the
  // second restore stage; promotion temporarily owns payload + copied files.
  const postgresPhysicalUpperBound=sourceBytes-protectedBytes;assert.ok(postgresPhysicalUpperBound>0);
  // The canonical owner now unlinks its OWN decrypted compressed intermediate
  // immediately after complete extraction, before PG restoration/promotion.
  const canonicalExtractionPeak=metadata.size+payloadAllocated;
  const canonicalPromotionPeak=2*payloadAllocated+postgresPhysicalUpperBound;
  const canonicalPeak=Math.max(canonicalExtractionPeak,canonicalPromotionPeak);
  const identityObserverMaximumBytes=16*MIB;
  const nativePeak=postgresPhysicalUpperBound+identityObserverMaximumBytes+protectedAllocated+baselineAdditional;
  const requiredDiskBytes=Math.max(canonicalPeak,nativePeak)+postgresBaseAndWal+logsAndMetadata+remainingHostReserve;
  const requiredMemoryBytes=(CAPS.postgres+Math.max(CAPS.control,CAPS.backend,CAPS.frontend,CAPS.inquiry)+CAPS.originalNode+CAPS.controlReserve)*MIB;
  assert.ok(Number.isSafeInteger(requiredDiskBytes));
  return {format:'sabalan-independent-sequential-resource-budget/v1',stageOrder:['CANONICAL_RESTORE','BACKEND_PRIVATE_HTTP','INQUIRY','FRONTEND'],capsMiB:CAPS,
    sourceBytes,protectedBytes,protectedAllocated,postgresPhysicalUpperBound,payloadAllocated,retainedAllocated,retainedCount,baselineAdditional,canonicalExtractionPeak,canonicalPromotionPeak,postgresBaseAndWal,logsAndMetadata,remainingHostReserve,
    identityObserverMaximumBytes,sourceDatabaseRole:'EMPTY_ISOLATED_IDENTITY_OBSERVER',nativePeak,requiredDiskBytes,requiredMemoryBytes,
    imageImportBytes:null,imageImportAdmission:'ACTUAL_PER_STAGE_MEASURED_MISSING_LAYERS_AND_SOURCE_SPOOL',imagesMustAlreadyBePresent:false};
}
export function independentExecArguments(id,args){
  assert.ok(hex(id));assert.ok(Array.isArray(args));const options=[];let offset=0;
  while(['--env-file','--workdir'].includes(args[offset])){assert.equal(typeof args[offset+1],'string');assert.ok(path.posix.isAbsolute(args[offset+1]));
    options.push(args[offset],args[offset+1]);offset+=2;}
  assert.ok(['psql','pg_ctl','/usr/local/bin/node','/bin/sh'].includes(args[offset]));
  return ['exec','-i',...options,id,...args.slice(offset)];
}
export function independentIdentityObserverQueries(name){
  assert.match(name,/^qa_application_native_[a-f0-9]{32}$/);
  return Object.freeze({create:'CREATE DATABASE '+name+' TEMPLATE template0',size:"SELECT pg_database_size('"+name+"')",
    publicTables:"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"});
}
export function independentNamespaceObservationQuery(database,namespaces){
  assert.match(database,/^qa_application_restored_[a-f0-9]{32}$/);assert.ok(Array.isArray(namespaces)&&namespaces.length>0&&namespaces.length<=16&&new Set(namespaces).size===namespaces.length);
  for(const namespace of namespaces)assert.match(namespace,/^sabalan-rt-[a-f0-9]{48}$/);
  return "SELECT json_build_object('visible',current_setting('is_superuser')='on' OR pg_has_role(current_user,'pg_read_all_stats','MEMBER'),'database',json_build_object('name','"+database+"','oid',(SELECT oid::text FROM pg_database WHERE datname='"+database+"'),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datname='"+database+"'),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database='"+database+"'),'namespaces',(SELECT json_agg(json_build_object('namespace',names.namespace,'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datname='"+database+"' AND application_name=names.namespace)) ORDER BY names.namespace) FROM (VALUES "+namespaces.map(value=>"('"+value+"')").join(',')+") AS names(namespace)))";
}
export function validateConfiguration(value){
  same(value.format,'sabalan-original-independent-full-restore-input/v1');
  assert.match(value.operation,/^[a-f0-9]{32}$/);
  for(const key of ['expectedBackupMachineUuidSha256','expectedBackupKernelBootIdSha256'])assert.ok(hex(value[key]));
  const sourceIdentity=new URL(value.productionDatabaseIdentity);assert.ok(['postgresql:','postgres:'].includes(sourceIdentity.protocol));assert.ok(sourceIdentity.hostname&&sourceIdentity.pathname.length>1);assert.ok(!sourceIdentity.username&&!sourceIdentity.password);
  for(const role of ['backend','frontend','inquiry','postgres']){
    const image=value.images[role];assert.match(image.id,/^sha256:[a-f0-9]{64}$/);assert.ok(hex(image.receiptSha256));
    assert.ok(path.posix.isAbsolute(image.receiptPath)&&image.receiptPath.startsWith(PRIVATE+'/'));
    if(role!=='postgres')assert.match(image.sourceCommit,/^[a-f0-9]{40}$/);
    if(role!=='postgres'){
      assert.ok(hex(image.archiveReceiptSha256)&&path.posix.isAbsolute(image.archiveReceiptPath)&&image.archiveReceiptPath.startsWith(PRIVATE+'/'));
      assert.ok(Number.isSafeInteger(image.archiveReceiptBytes)&&image.archiveReceiptBytes>0&&image.archiveReceiptBytes<=2*1024**2);
      validateSelectedArchiveGraph(image,image.archiveGraph);requireLegacyBackupQaTransfer(role,image);
      if(image.transfer){for(const key of ['metadataPath','cipherPath'])assert.ok(path.posix.isAbsolute(image.transfer[key])&&image.transfer[key].startsWith(PRIVATE+'/'));
        assert.ok(hex(image.transfer.metadataSha256));
        if(image.transfer.stagedFromOriginalSsh){same(image.transfer.stagedFromOriginalSsh,true);same(image.transfer.cipherPath,QA+'/full-restore-'+value.operation+'/staged-ciphers/'+role+'.sabrec');assert.ok(hex(image.transfer.cipherSha256));assert.ok(Number.isSafeInteger(image.transfer.cipherBytes)&&image.transfer.cipherBytes>0&&image.transfer.cipherBytes<=2**31);}}
    }
  }
  assert.equal(value.images.backend.runtime.entryPath,'/app/dist/onlinePrivateQualification.js');
  assert.ok(hex(value.images.inquiry.runtimeBundleSha256));
  const inquiryFiles=value.images.inquiry.runtimeFiles;assert.ok(inquiryFiles&&Object.keys(inquiryFiles).length>8&&Object.keys(inquiryFiles).length<128);
  for(const [name,digest]of Object.entries(inquiryFiles)){assert.ok(/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.split('/').some(v=>!v||v==='.'||v==='..'));assert.ok(hex(digest));}
  same(sha(bytes(inquiryFiles)),value.images.inquiry.runtimeBundleSha256);
  for(const key of ['manifestSha256','verifierSha256','materializationReceiptSha256'])assert.ok(hex(value.images.frontend[key]));
  assert.ok(typeof value.images.frontend.buildId==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(value.images.frontend.buildId));
  for(const key of ['entrySha256','distTreeSha256','schemaSha256','clientInventorySha256'])assert.ok(hex(value.images.backend.runtime[key]));
  assert.ok(Number.isSafeInteger(value.images.backend.expectedMigrationCount)&&value.images.backend.expectedMigrationCount>0);
  assert.ok(Number.isSafeInteger(value.images.backend.expectedModelCount)&&value.images.backend.expectedModelCount>0);
  assert.ok(hex(value.images.backend.restoreEngineSha256));
  assert.equal(value.minimumDiskFreeBytes,undefined,'OBSOLETE_ARBITRARY_DISK_FLOOR');
  if(value.onlinePhysicalPoint){
    const point=value.onlinePhysicalPoint;assert.match(point.captureId,/^[a-f0-9]{64}$/);assert.match(point.postgresUser,/^[A-Za-z_][A-Za-z0-9_]{0,62}$/);
    assert.ok(path.posix.isAbsolute(point.root)&&path.posix.normalize(point.root)===point.root&&[PRIVATE,CHECKPOINTS].some(root=>point.root.startsWith(root+'/')));
    for(const key of ['sealedFile','manifestFile','producerFile'])assert.ok(path.posix.isAbsolute(point[key])&&path.posix.normalize(point[key])===point[key]&&point[key].startsWith(point.root+'/'));
    for(const key of ['sealedSha256','manifestSha256','producerSha256'])assert.ok(hex(point[key]));
    for(const key of ['machineUuidSha256','kernelBootIdSha256'])assert.ok(hex(point.sourceHost[key]));
    assert.ok(point.cipherPaths&&typeof point.cipherPaths==='object');
    for(const file of Object.values(point.cipherPaths))assert.ok(typeof file==='string'&&path.posix.normalize(file)===file&&file.startsWith(point.root+'/'));
    for(const key of ['checkpointMetadataPath','checkpointArchivePath','checkpointMetadataSha256'])same(value[key],undefined,'PHYSICAL_CANNOT_ADOPT_COMPLETE_POINT');
    for(const name of ['independent-online-components.worker.cjs','independent-online-layout.py','online-checkpoint-coverage.py','recovery-versioned-files.py','capture-coordination-history.py','independent-wal-window.worker.cjs','postgres-recovery-coverage.mjs','independent-wal-window-controller.py','online-qualification-public-key.pem'])assert.ok(hex(value.sourcePins[name]));
  }else{
  assert.ok(path.posix.isAbsolute(value.checkpointMetadataPath)&&[PRIVATE,CHECKPOINTS].some(root=>value.checkpointMetadataPath.startsWith(root+'/')));
  assert.equal(value.checkpointArchivePath,value.checkpointMetadataPath.replace(/\.json$/,''));assert.ok(value.checkpointArchivePath.endsWith('.sabrec'));
  for(const key of ['checkpointMetadataUid','checkpointArchiveUid'])assert.ok([0,997].includes(value[key]));
  assert.ok([0o600,0o640].includes(value.checkpointMetadataMode));assert.ok([0o400,0o600].includes(value.checkpointArchiveMode));
  assert.ok(hex(value.checkpointMetadataSha256));}
  for(const key of ['applicationKeysPath','recoveryPrivateKeyPath','bundleRoot'])assert.ok(path.posix.isAbsolute(value[key])&&value[key].startsWith(PRIVATE+'/'));
  assert.ok(hex(value.applicationKeysSha256));assert.ok(hex(value.recoveryPrivateKeySha256));
  assert.ok(value.sourcePins&&typeof value.sourcePins==='object');
  for(const name of ['independent-image-transfer.py','online-runtime-owner.py','online-runtime-scope.py','backend-runtime-owner.py','online-capture-admission.py',
    'original-host-controller-channel.py','private-qualification-observer.py','private-qualification-materialize.py',
    'private-qualification-bootstrap.sql','independent-private-runtime.py','independent-restored-baseline.worker.cjs',
    'online-private-qualification-worker.cjs','independent-next-runtime.py','online-inquiry-owner.py','inquiry-requested-stop.py','verify-inquiry-database.cjs','inquiry-baseline.json'])assert.ok(hex(value.sourcePins[name]),name);
  return value;
}
function privateRead(file,expected,mode=0o400,maximum=16*1024**2,ownerUid=0){
  assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.uid===BigInt(ownerUid)&&before.nlink===1n&&(before.mode&0o777n)===BigInt(mode)&&before.size>0n&&before.size<=BigInt(maximum));
    const raw=fs.readFileSync(fd);same(pin(fs.fstatSync(fd,{bigint:true})),pin(before));same(pin(fs.lstatSync(file,{bigint:true})),pin(before));
    if(expected)same(sha(raw),expected);return raw;
  }finally{fs.closeSync(fd);}
}
function write(file,raw,mode=0o400){const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,mode);
  try{fs.fchmodSync(fd,mode);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
function hostIdentity(){const read=file=>{const value=fs.readFileSync(file,'utf8').trim().toLowerCase();assert.match(value,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);assert.ok(!/^[0-]*$/.test(value)&&!/^[f-]*$/.test(value));return sha(value);};
  return {machineUuidSha256:read('/sys/class/dmi/id/product_uuid'),kernelBootIdSha256:read('/proc/sys/kernel/random/boot_id')};}
export function independentPhysicalResourceBudget(sealed,blockSize=4096){
  assert.ok(Array.isArray(sealed.objects)&&Number.isSafeInteger(blockSize)&&blockSize>0);
  let plaintextAllocated=0,selectedObjectsAllocated=0,metadataAllocated=0,lineageCount=0,baseBytes=0;
  for(const row of sealed.objects){assert.ok(Number.isSafeInteger(row.bytes)&&row.bytes>=0);const allocated=Math.ceil(row.bytes/blockSize)*blockSize;plaintextAllocated+=allocated;
    if(row.role==='physical-base'){same(baseBytes,0);baseBytes=row.bytes;}
    if(row.role==='versioned-file-object')selectedObjectsAllocated+=allocated;
    if(row.role==='versioned-file-lineage')lineageCount++;
    if(['versioned-file-cut','versioned-file-lineage'].includes(row.role))metadataAllocated+=allocated;}
  assert.ok(baseBytes>0);
  // Base is RAW tar, so total extracted regular bytes cannot exceed its actual
  // authenticated length. Objects are distinct immutable UUIDs per PUT. The
  // layout verifies this, reads every live byte back, then retires only its
  // independently authenticated decrypted cache before baseline adoption.
  const extractionPeak=plaintextAllocated+baseBytes;
  const baselineAdditional=selectedObjectsAllocated+metadataAllocated+(lineageCount*8+9*8)*blockSize;
  const nativePeak=plaintextAllocated+baselineAdditional,identityObserverMaximumBytes=16*MIB,postgresBaseAndWal=192*MIB,logsAndMetadata=192*MIB,remainingHostReserve=64*MIB;
  const walWindowDiskReserve=320*MIB,walWindowMemoryReserve=384*MIB;
  const requiredDiskBytes=Math.max(extractionPeak,nativePeak)+identityObserverMaximumBytes+postgresBaseAndWal+logsAndMetadata+remainingHostReserve+walWindowDiskReserve;
  assert.ok(Number.isSafeInteger(requiredDiskBytes));
  return {format:'sabalan-independent-physical-resource-budget/v1',stageOrder:['AUTHENTICATED_COMPONENTS','PG15_NAMED_POINT_REPLAY','BACKEND_PRIVATE_HTTP','INQUIRY','FRONTEND'],capsMiB:CAPS,
    plaintextAllocated,selectedObjectsAllocated,metadataAllocated,lineageCount,postgresPhysicalUpperBound:baseBytes,extractionPeak,baselineAdditional,nativePeak,identityObserverMaximumBytes,postgresBaseAndWal,logsAndMetadata,remainingHostReserve,walWindowDiskReserve,walWindowMemoryReserve,requiredDiskBytes,
    requiredMemoryBytes:walWindowMemoryReserve+(CAPS.postgres+Math.max(CAPS.control,CAPS.backend,CAPS.frontend,CAPS.inquiry)+CAPS.originalNode+CAPS.controlReserve)*MIB,
    sourceDatabaseRole:'EMPTY_ISOLATED_IDENTITY_OBSERVER',imageImportBytes:null,imageImportAdmission:'ACTUAL_PER_STAGE_MEASURED_MISSING_LAYERS_AND_SOURCE_SPOOL',imagesMustAlreadyBePresent:false};
}
export function validatePhysicalPointProducer(producer,captureId,manifestSha256){
 same(producer.format,'sabalan-original-online-checkpoint-producer-result/v1');same(producer.captureId,captureId);same(producer.manifestSha256,manifestSha256);
 if(producer.phase==='PLAINTEXT_COMPONENTS_CLOSED')same(producer.allOriginalChildrenClosed,true);
 else{
  same(producer.phase,'POINT_COMPONENTS_MATERIALIZED');same(producer.allOriginalChildrenClosed,undefined,'LIVE_SUCCESSOR_CANNOT_CLAIM_GLOBAL_CLOSURE');
  const rows=producer.originalPointChildren;same(rows?.map(row=>row.role).sort(),['coherent-capture','initial-wal','physical-base']);assert.ok(new Set(rows.map(row=>row.originalPid)).size===3);
  for(const row of rows){assert.ok(Number.isInteger(row.originalPid)&&row.originalPid>1);same(row.returncode,0);same(row.signal,null);assert.ok(hex(row.stdoutSha256)&&hex(row.stderrSha256));}
  same(rows.find(row=>row.role==='coherent-capture').originalPid,producer.captureClosure.originalDockerPid);
 }
 for(const key of ['independentRestoreVerified','remoteVerified','healthyRecoveryPoint','productionAdmission'])same(producer[key],false);
 same(producer.captureClosure.originalDockerStatus,0);same(producer.captureClosure.freshNamespaceSessions,0);same(producer.captureClosure.preparedTransactions,0);
 const native=JSON.parse(Buffer.from(producer.captureClosure.nativeRawBase64,'base64'));same(native.phase,'QUIESCENT');same(native.nativeStatus,0);same(native.nativeReaped,true);same(native.databaseQuiet,true);same(native.stoppedBySignal,false);
 same(producer.walClosure.phase,'COMPLETE');same(producer.walClosure.nativeReaped,true);same(producer.walClosure.databaseQuiet,true);same(producer.walClosure.nativeStatus,0);
 return {pointChildrenClosed:true,wholeProducerClosed:producer.phase==='PLAINTEXT_COMPONENTS_CLOSED'};
}
function readPhysicalPoint(input){
  const point=input.onlinePhysicalPoint;
  same(fs.realpathSync(point.root),point.root);
  const sealedRaw=privateRead(point.sealedFile,point.sealedSha256,0o400,64*1024**2),manifestRaw=privateRead(point.manifestFile,point.manifestSha256,0o400,64*1024**2),producerRaw=privateRead(point.producerFile,point.producerSha256,0o400,16*1024**2);
  const sealed=JSON.parse(sealedRaw),manifest=JSON.parse(manifestRaw),producer=JSON.parse(producerRaw);
  privateRead(input.bundleRoot+'/independent-online-components.worker.cjs',input.sourcePins['independent-online-components.worker.cjs']);
  const {validateOnlineSealedComponents}=createRequire(import.meta.url)(input.bundleRoot+'/independent-online-components.worker.cjs');
  validateOnlineSealedComponents(sealed,manifest,point.captureId);same(sealed.manifestSha256,point.manifestSha256);
  validatePhysicalPointProducer(producer,point.captureId,point.manifestSha256);
  const native=JSON.parse(Buffer.from(producer.captureClosure.nativeRawBase64,'base64'));
  same(native.phase,'QUIESCENT');same(native.nativeStatus,0);same(native.nativeReaped,true);same(native.databaseQuiet,true);same(native.stoppedBySignal,false);
  same(sha(native.guardian.bootId.trim().toLowerCase()),point.sourceHost.kernelBootIdSha256);
  const inventory=sealed.objects.map(row=>({name:row.name,bytes:row.cipherBytes,sha256:row.cipherSha256}));
  same(Object.keys(point.cipherPaths).sort(),inventory.map(row=>row.name).sort());
  return {point,sealedRaw,manifestRaw,producerRaw,sealed,manifest,producer,native,cipherInventorySha256:sha(Buffer.from(JSON.stringify(canonical(inventory))))};
}
export async function runOriginalIndependentFullRestore(configFile,configSha){
  assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);process.umask(0o077);assert.ok(hex(configSha));
  const input=validateConfiguration(JSON.parse(privateRead(configFile,configSha)));
  const host=hostIdentity();same(host.machineUuidSha256,input.expectedBackupMachineUuidSha256);same(host.kernelBootIdSha256,input.expectedBackupKernelBootIdSha256);
  // FDs originate in the companion Python launcher and remain with this exact
  // process. No lock deletion, timeout takeover or success-marker adoption.
  const locks=[[9,PRIVATE+'/drill-ownership.lock'],[10,'/run/lock/sabalan-backup-storage.lock']].map(([fd,file])=>{
    const actual=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});same(actual.dev,named.dev);same(actual.ino,named.ino);
    assert.ok(actual.isFile()&&actual.uid===0n&&actual.nlink===1n&&!(actual.mode&0o022n));
    const descriptors=Array(11).fill('ignore');descriptors[fd]=fd;
    same(spawnSync('/usr/bin/flock',['--exclusive','--nonblock',String(fd)],{stdio:descriptors}).status,0);return {fd,file,pin:pin(actual)};
  });
  const physical=input.onlinePhysicalPoint?readPhysicalPoint(input):null;
  let metadataRaw,metadata,canonicalCheckpoint,checkpointArchivePath;
  if(!physical){
  metadataRaw=privateRead(input.checkpointMetadataPath,input.checkpointMetadataSha256,input.checkpointMetadataMode,16*1024**2,input.checkpointMetadataUid);metadata=JSON.parse(metadataRaw);canonicalCheckpoint=readIndependentCheckpointTransport(metadataRaw);
  same(metadata.remoteVerified,true);same(metadata.id,metadata.deploymentId);assert.ok(hex(metadata.checksum));assert.ok(Number.isSafeInteger(metadata.size)&&metadata.size>0);
  checkpointArchivePath=input.checkpointArchivePath;
  assert.ok([PRIVATE,CHECKPOINTS].some(root=>checkpointArchivePath.startsWith(root+'/'))&&fs.realpathSync(checkpointArchivePath)===checkpointArchivePath);
  assert.ok(typeof metadata.remotePath==='string'&&path.posix.isAbsolute(metadata.remotePath)&&path.posix.basename(metadata.remotePath)===path.posix.basename(checkpointArchivePath));
  assert.ok(hex(metadata.sourceMachineUuidSha256)&&hex(metadata.sourceKernelBootIdSha256));
  assert.notEqual(metadata.sourceMachineUuidSha256,host.machineUuidSha256);assert.notEqual(metadata.sourceKernelBootIdSha256,host.kernelBootIdSha256);
  same(metadata.manifest?.format,'sabalan-recovery');same(metadata.manifest?.packageType,'COMPLETE');assert.ok(Array.isArray(metadata.manifest.components));
  same(metadata.captureMethod,'PROTECTED_MAINTENANCE_COMPLETE');
  }else{
    // Operational source identity only. This is deliberately NOT canonical DB
    // checkpoint metadata and cannot be published or used by COMPLETE policy.
    metadataRaw=physical.sealedRaw;checkpointArchivePath=physical.point.sealedFile;
    metadata={id:physical.point.captureId,releaseId:physical.native.onlineScope.scope.releaseId,captureMethod:'ONLINE_COHERENT_WAL',checksum:physical.point.sealedSha256,size:physical.sealed.objects.reduce((total,row)=>total+row.cipherBytes,0),
      sourceMachineUuidSha256:physical.point.sourceHost.machineUuidSha256,sourceKernelBootIdSha256:physical.point.sourceHost.kernelBootIdSha256};
    assert.notEqual(metadata.sourceMachineUuidSha256,host.machineUuidSha256);assert.notEqual(metadata.sourceKernelBootIdSha256,host.kernelBootIdSha256);
  }
  const declaredBytes=physical?physical.manifest.sources.reduce((total,row)=>total+row.bytes,0):metadata.manifest.components.reduce((total,row)=>{assert.ok(Number.isSafeInteger(row.size)&&row.size>=0&&hex(row.sha256));return total+row.size;},0);
  assert.ok(Number.isSafeInteger(declaredBytes));const capturedSourceBytes=physical?declaredBytes:metadata.capacity?.estimate?.sourceBytes;
  assert.ok(Number.isSafeInteger(capturedSourceBytes)&&capturedSourceBytes>0,'CAPTURED_UNCOMPRESSED_CAPACITY_REQUIRED');
  const hashFile=(file,ownerUid=0,mode)=>{const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.uid===BigInt(ownerUid));if(mode!==undefined)same(before.mode&0o777n,BigInt(mode));
    const hash=createHash('sha256'),chunk=Buffer.alloc(262144);let size=0;for(;;){const n=fs.readSync(fd,chunk,0,chunk.length,null);if(!n)break;size+=n;hash.update(chunk.subarray(0,n));}
    same(pin(fs.fstatSync(fd,{bigint:true})),pin(before));same(pin(fs.lstatSync(file,{bigint:true})),pin(before));return {sha256:hash.digest('hex'),size};}finally{fs.closeSync(fd);}};
  if(!physical)same(hashFile(checkpointArchivePath,input.checkpointArchiveUid,input.checkpointArchiveMode),{sha256:metadata.checksum,size:metadata.size});
  else for(const row of physical.sealed.objects)same(hashFile(physical.point.cipherPaths[row.name],0,0o400),{sha256:row.cipherSha256,size:row.cipherBytes});
  for(const namespace of [PRIVATE,QA]){same(fs.realpathSync(namespace),namespace);const value=fs.lstatSync(namespace);assert.ok(value.isDirectory()&&value.uid===0&&!(value.mode&0o022));}
  const capacity=fs.statfsSync(QA,{bigint:true}),resourceBudget=physical?independentPhysicalResourceBudget(physical.sealed,Number(capacity.bsize)):restoreResourceBudget(metadata,Number(capacity.bsize));assert.ok(capacity.bavail*capacity.bsize>=BigInt(resourceBudget.requiredDiskBytes));
  const mem=fs.readFileSync('/proc/meminfo','utf8').match(/^MemAvailable:\s+(\d+) kB$/m);assert.ok(mem&&Number(mem[1])*1024>=resourceBudget.requiredMemoryBytes);
  const applicationKeys=privateRead(input.applicationKeysPath,input.applicationKeysSha256,0o400);
  const allowed=new Set(['PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_BASE64','PERSONNEL_PERFORMANCE_ENCRYPTION_KEY_ID','PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_BASE64','PERSONNEL_PERFORMANCE_EXPORT_ENCRYPTION_KEY_ID']);
  const entries=applicationKeys.toString('utf8').trim().split('\n');for(const entry of entries){const [name,...parts]=entry.split('=');assert.ok(allowed.delete(name)&&parts.join('=').length>0&&!entry.includes('\r'));}same(allowed.size,0);
  privateRead(input.recoveryPrivateKeyPath,input.recoveryPrivateKeySha256,0o400,65536);
  for(const [role,image]of Object.entries(input.images))validateSelectedImageReceipt(role,image,JSON.parse(privateRead(image.receiptPath,image.receiptSha256)));
  const originalImageArchiveReceipts={};
  for(const role of ['backend','frontend','inquiry']){const selected=input.images[role],raw=privateRead(selected.archiveReceiptPath,selected.archiveReceiptSha256);same(raw.length,selected.archiveReceiptBytes);validateSelectedArchiveGraph(selected,JSON.parse(raw));originalImageArchiveReceipts[role]=raw.toString('base64');}
  const operation=input.operation,hostRoot=QA+'/full-restore-'+operation,root='/app/online-runtime-acceptance/application-native-'+operation;
  const privateReleaseId='independent_'+operation;
  fs.mkdirSync(hostRoot,{mode:0o700});const authority=hostRoot+'-authority';fs.mkdirSync(authority,{mode:0o700});
  const disk=file=>{assert.ok(file===root||file.startsWith(root+'/'));return hostRoot+file.slice(root.length);};
  const mkdir=file=>fs.mkdirSync(disk(file),{recursive:true,mode:0o700});
  for(const [name,digest]of Object.entries(input.sourcePins)){assert.match(name,/^[a-z0-9.-]+$/);write(hostRoot+'/'+name,privateRead(input.bundleRoot+'/'+name,digest));}
  const coordination=root+'/coordination',qualificationId=randomBytes(32).toString('hex'),app=coordination+'/private-qualifications/'+qualificationId+'/restored-app';
  for(const name of [app,app+'/storage/recovery',app+'/uploads',app+'/recovery-sources/inquiry',coordination,root+'/evidence'])mkdir(name);
  fs.mkdirSync(hostRoot+'/postgres',{mode:0o700});if(!physical)fs.chownSync(hostRoot+'/postgres',70,70);
  const database='qa_application_restored_'+operation,sourceDatabase='qa_application_native_'+operation,password=randomBytes(32).toString('hex'),marker=randomBytes(32).toString('hex');
  const databaseUrl='postgresql://postgres:'+password+'@postgres:5432/'+database+'?connection_limit=2&pool_timeout=10';
  const controlUrl='postgresql://postgres:'+password+'@postgres:5432/sabalanerp?connection_limit=2&pool_timeout=10';
  write(hostRoot+'/postgres.env',Buffer.from('POSTGRES_PASSWORD='+password+'\nPOSTGRES_USER=postgres\nPOSTGRES_DB=sabalanerp\n'));
  write(hostRoot+'/marker.sql',Buffer.from('\\connect postgres\nCREATE TABLE deployment_drill_environment_marker (singleton boolean PRIMARY KEY CHECK(singleton), marker text NOT NULL);\nINSERT INTO deployment_drill_environment_marker VALUES(true,\''+marker+'\');\nCREATE DATABASE '+database+';\n'),0o444);
  write(hostRoot+'/backend.env',Buffer.concat([applicationKeys,Buffer.from('\nNODE_ENV=test\nDATABASE_URL='+controlUrl+'\nJWT_SECRET='+randomBytes(32).toString('hex')+'\nSESSION_SECRET='+randomBytes(32).toString('hex')+'\n')]));
  write(hostRoot+'/inquiry.env',Buffer.from('NODE_ENV=production\nSESSION_SECRET='+randomBytes(32).toString('hex')+'\n'));
  const report={format:physical?'sabalan-original-independent-online-physical-restore/v1':'sabalan-original-independent-full-restore-controller/v1',operation,startedAt:new Date().toISOString(),productionAdmission:false,onlineAdmissionQualified:false,continuousWalQualified:false,
    recoveryMode:metadata.captureMethod,
    privateQualificationReleaseId:privateReleaseId,sourceDatabaseRole:'EMPTY_ISOLATED_IDENTITY_OBSERVER',sourceDatabaseContainsRestoredBusinessData:false,pass:false,phase:'PREPARED',
    configurationSha256:configSha,...(!physical?{checkpointMetadataRawSha256:sha(metadataRaw),checkpointTransportRawBase64:metadataRaw.toString('base64'),checkpointMetadata:canonicalCheckpoint.metadata,checkpointCanonicalMetadataSha256:canonicalCheckpoint.sha256}:{sealedManifestSha256:physical.point.sealedSha256,plaintextManifestSha256:physical.point.manifestSha256,cipherInventorySha256:physical.cipherInventorySha256,originalProducerRawBase64:physical.producerRaw.toString('base64'),originalSealedManifestRawBase64:physical.sealedRaw.toString('base64'),originalPlaintextManifestRawBase64:physical.manifestRaw.toString('base64'),physicalReplayQualified:false}),controllerSourcePins:input.controllerFiles,workerSourcePins:input.sourcePins,
    ...(!physical?{sourceCheckpoint:{id:metadata.id,releaseId:metadata.releaseId,checksum:metadata.checksum,size:metadata.size,captureMethod:metadata.captureMethod,sourceMachineUuidSha256:metadata.sourceMachineUuidSha256,sourceKernelBootIdSha256:metadata.sourceKernelBootIdSha256}}:{}),
    recoveryHost:host,images:input.images,originalImageArchiveReceipts,stages:[],hostRoot,...(physical?{sourceMachineUuidSha256:metadata.sourceMachineUuidSha256,sourceKernelBootIdSha256:metadata.sourceKernelBootIdSha256,recoveryMachineUuidSha256:host.machineUuidSha256,recoveryKernelBootIdSha256:host.kernelBootIdSha256,sealedSourceCustody:{actualRoot:physical.point.root,sealedFile:physical.point.sealedFile,manifestFile:physical.point.manifestFile}}:{checkpointSourceCustody:{actualArchivePath:checkpointArchivePath,producerRemotePath:metadata.remotePath,
      metadataUid:input.checkpointMetadataUid,metadataMode:input.checkpointMetadataMode,archiveUid:input.checkpointArchiveUid,archiveMode:input.checkpointArchiveMode}})};
  report.capacity={...resourceBudget,declaredComponentBytes:declaredBytes,capturedSourceBytes,observedDiskFreeBytes:String(capacity.bavail*capacity.bsize),observedMemoryAvailableBytes:Number(mem[1])*1024};
  const journal=[];const reportFile=hostRoot+'/controller-evidence.json';let seq=0,mutated=false,held=null,keeper;
  const save=(event,value)=>{write(hostRoot+'/evidence/'+String(++seq).padStart(6,'0')+'.json',bytes({event,...value}),0o400);};
  function guard(){same(hostIdentity(),host);for(const lock of locks){same(pin(fs.fstatSync(lock.fd,{bigint:true})),lock.pin);same(pin(fs.lstatSync(lock.file,{bigint:true})),lock.pin);}}
  function hold(error){if(!held){held=error;report.phase='HELD';report.failure='ORIGINAL_FULL_RESTORE_FAILED_OR_UNKNOWN';
    save('HELD',{code:error.message,originalProcesses:journal.map(v=>({pid:v.child.pid,argsSha256:v.argsSha256,closed:v.closed,code:v.code,signal:v.signal}))});
    keeper=setInterval(()=>{void journal;void locks;},30000);}return error;}
  function launch(args,{input:stdin,daemon=false,kind=daemon?'CONTAINER_ATTACH':'REQUIRED_ZERO',executable='docker'}={}){
    guard();assert.ok(['docker','/usr/bin/python3'].includes(executable));const child=spawn(executable,args,{stdio:['pipe','pipe','pipe']});
    const value={child,kind,argsSha256:sha(bytes(args)),closed:false,code:null,signal:null,out:[],err:[],outBytes:0,errBytes:0};journal.push(value);
    value.done=new Promise(resolve=>child.once('close',(code,signal)=>{value.closed=true;value.code=code;value.signal=signal;resolve();}));
    child.on('error',error=>hold(error));child.stdin.on('error',error=>hold(error));
    child.stdout.on('data',raw=>{value.outBytes+=raw.length;if(value.outBytes>16*1024**2){hold(Error('ORIGINAL_DOCKER_OUTPUT_BOUND'));return;}value.out.push(raw);});
    child.stderr.on('data',raw=>{value.errBytes+=raw.length;if(value.errBytes>1024**2){hold(Error('ORIGINAL_DOCKER_STDERR_BOUND'));return;}value.err.push(raw);});
    if(!daemon)child.stdin.end(stdin);return value;
  }
  async function run(args,stdin){const value=launch(args,{input:stdin});await value.done;if(held)throw held;same(value.code,0);same(value.signal,null);return {owner:value,raw:Buffer.concat(value.out)};}
  async function inspect(id){const {raw}=await run(['inspect',id]);const rows=JSON.parse(raw);same(rows.length,1);same(rows[0].Id,id);return rows[0];}
  async function image(id){const {raw}=await run(['image','inspect',id]);const rows=JSON.parse(raw);same(rows.length,1);same(rows[0].Id,id);return rows[0];}
  const imageStages=[];report.imageStages=[];report.imageTransfers=[];report.applicationStageOrder=['backend','inquiry','frontend'];
  const transferOrder=report.applicationStageOrder,retiredImageRoles=new Set();
  const staged=transferOrder.filter(role=>input.images[role].transfer?.stagedFromOriginalSsh);
  assert.ok(staged.length===0||staged.length===3,'PARTIAL_ORIGINAL_SSH_TRANSFER_FORBIDDEN');
  const transferInterface=staged.length||physical?createInterface({input:process.stdin,terminal:false}):null;
  const controlWaiters=new Map();
  transferInterface?.on('line',line=>{try{const value=JSON.parse(line),waiter=controlWaiters.get(value.event);assert.ok(waiter,'UNSOLICITED_ORIGINAL_GUARDIAN_RESPONSE');controlWaiters.delete(value.event);waiter.resolve(value);}catch(error){hold(error);}});
  transferInterface?.on('close',()=>{if(controlWaiters.size)hold(Error('ORIGINAL_GUARDIAN_CHANNEL_CLOSED'));});
  const response=event=>{assert.ok(!controlWaiters.has(event));return new Promise((resolve,reject)=>controlWaiters.set(event,{resolve,reject}));};
  async function storagePhase(event){if(!physical)return;const pending=response(event+'_ACK');process.stdout.write(JSON.stringify({event,operation})+'\n');const ack=await pending;same(ack.operation,operation);}
  async function cryptoExclusive(run){await storagePhase('STORAGE_PHASE_BEGIN');const value=await run();await storagePhase('STORAGE_PHASE_END');return value;}

  if(staged.length)fs.mkdirSync(hostRoot+'/staged-ciphers',{mode:0o700});
  async function requestOriginalCipher(role,reserve){
    const selected=input.images[role],transfer=selected.transfer;if(!transfer?.stagedFromOriginalSsh)return;
    const sequence=report.imageTransfers.length;same(transferOrder[sequence],role);
    if(sequence)assert.ok(retiredImageRoles.has(transferOrder[sequence-1]),'PRIOR_ORIGINAL_IMAGE_NOT_RETIRED');
    const metadata=JSON.parse(privateRead(transfer.metadataPath,transfer.metadataSha256));
    const expected=metadata.encryption.images[role];same(expected.cipherBytes,transfer.cipherBytes);same(expected.cipherSha256,transfer.cipherSha256);
    same(expected.sourceImageId,selected.sourceImageId);same(expected.sourceSha256,selected.archiveGraph.archiveSha256);same(expected.sourceBytes,selected.archiveGraph.archiveBytes);
    const capacity=fs.statfsSync(QA,{bigint:true});assert.ok(capacity.bavail*capacity.bsize>=BigInt(transfer.cipherBytes+reserve),'ORIGINAL_CIPHER_DISK_BUDGET');
    assert.ok(!fs.existsSync(transfer.cipherPath),'ORIGINAL_CIPHER_ALREADY_PRESENT');
    const frame={event:'IMAGE_TRANSFER_REQUEST',format:'sabalan-original-image-transfer/v1',operation,role,sequence,path:transfer.cipherPath,bytes:transfer.cipherBytes,sha256:transfer.cipherSha256};
    const pending=response('IMAGE_TRANSFER_STORED');process.stdout.write(JSON.stringify(frame)+'\n');
    const ack=await pending;
    same(ack.event,'IMAGE_TRANSFER_STORED');same(ack.operation,operation);same(ack.role,role);same(ack.sequence,sequence);
    same(ack.proof.path,transfer.cipherPath);same(ack.proof.bytes,transfer.cipherBytes);same(ack.proof.sha256,transfer.cipherSha256);
    same(ack.proof.fsyncFileAndDirectory,true);same(ack.proof.fullReadbackVerified,true);
    same(hashFile(transfer.cipherPath),{sha256:transfer.cipherSha256,size:transfer.cipherBytes});report.imageTransfers.push(ack);
    if(!physical&&report.imageTransfers.length===staged.length){transferInterface.close();process.stdin.pause();}
  }
  async function imageEvent(owner,event){const until=Date.now()+1800000;for(;;){if(held)throw held;
    const parts=Buffer.concat(owner.out).toString().split('\n');parts.pop();const lines=parts.filter(Boolean).map(v=>JSON.parse(v));
    const value=lines.find(v=>v.event===event);if(value){assert.ok(!lines.some(v=>v.event==='HELD'));return value;}
    assert.ok(!owner.closed&&Date.now()<until,'ORIGINAL_IMAGE_STAGE_UNKNOWN');await new Promise(r=>setTimeout(r,100));}}
  async function stageImage(role,reserve){await storagePhase('STORAGE_PHASE_BEGIN');const selected=input.images[role];await requestOriginalCipher(role,reserve+(physical?resourceBudget.walWindowDiskReserve:0));if(selected.transfer){
    for(const name of ['independent-image-stage.py','independent-image-decrypt.worker.cjs','materialize-private-image.py','recoveryCrypto.cjs'])assert.ok(hex(input.sourcePins[name]));
    const value={format:'sabalan-original-independent-image-stage-input/v1',operation,role,archiveGraph:selected.archiveGraph,
      temporaryRoot:'/dev/shm/sabalan-independent-image-'+operation+'-'+role,...selected.transfer,verifyRetainedSourceBeforeReuse:true,
      codecPath:hostRoot+'/recoveryCrypto.cjs',codecSha256:input.sourcePins['recoveryCrypto.cjs'],privateKeyPath:input.recoveryPrivateKeyPath,privateKeySha256:input.recoveryPrivateKeySha256,
      decryptWorkerPath:hostRoot+'/independent-image-decrypt.worker.cjs',decryptWorkerSha256:input.sourcePins['independent-image-decrypt.worker.cjs'],
      materializerPath:hostRoot+'/materialize-private-image.py',materializerSha256:input.sourcePins['materialize-private-image.py'],
      nodeExecutable:input.nodeExecutable,nodeExecutableSha256:input.nodeExecutableSha256,diskRoot:QA,retainedDiskReserveBytes:reserve};
    const raw=bytes(value),file=hostRoot+'/image-stage-'+role+'.json';write(file,raw);save('IMAGE_STAGE_INTENT',{role,configurationSha256:sha(raw)});mutated=true;
    const bootstrap="import hashlib,runpy,sys; p=sys.argv[1]; assert hashlib.sha256(open(p,'rb').read()).hexdigest()==sys.argv[2]; sys.argv=[p]+sys.argv[3:]; runpy.run_path(p,run_name='__main__')";
    const owner=launch(['-I','-B','-c',bootstrap,hostRoot+'/independent-image-stage.py',input.sourcePins['independent-image-stage.py'],file,sha(raw)],{daemon:true,kind:'REQUIRED_ZERO',executable:'/usr/bin/python3'});
    const ready=await imageEvent(owner,'READY');same(ready.image,selected.id);same(ready.sourceImage,selected.sourceImageId);imageStages.push({role,owner,ready});
    }const actual=await image(selected.id);same(actual.RootFS.Layers,selected.archiveGraph.rootfsDiffIds);
    if(role==='backend')same(actual.Config.Labels['io.sabalan.performance.source-commit'],selected.sourceCommit);
    if(role==='inquiry')same(actual.Config.Labels['io.sabalan.online-qa.archive-sha256'],selected.archiveSha256);
    if(role==='frontend')same(actual.Config.Labels['io.sabalan.online-acceptance'],'retained-ui');await storagePhase('STORAGE_PHASE_END');}
  async function retireStage(role){const stage=imageStages.find(v=>v.role===role);if(!stage)return;
    stage.owner.child.stdin.end('RETIRE\n');const closed=await imageEvent(stage.owner,'CLOSED');await stage.owner.done;same(stage.owner.code,0);same(stage.owner.signal,null);
    same(closed.encryptedSourcePreserved,true);assert.ok(closed.originalChildren.every(v=>v.returncode===0));report.imageStages.push({role,ready:stage.ready,closed,originalOwnerPid:stage.owner.child.pid});retiredImageRoles.add(role);}
  const foreignBefore=JSON.parse((await run(['ps','--all','--no-trunc','--format','{{json .}}'])).raw.toString().split('\n').filter(Boolean).map(line=>line)).map(v=>v.ID);
  const foreignIdentity={};for(const id of foreignBefore){const v=await inspect(id);foreignIdentity[id]={id:v.Id,image:v.Image,startedAt:v.State.StartedAt,running:v.State.Running};}
  const networkName='sabalan-independent-'+operation;let network,control,backend,postgres,frontend,inquiry,broker;
  async function create(role,args){save('CONTAINER_CREATE_INTENT',{role,image:input.images[role].id,argsSha256:sha(bytes(args))});mutated=true;
    const {owner,raw}=await run(['create','--label','com.docker.compose.project=sabalanerp-backup-drill','--label','com.docker.compose.service='+role,
      '--label','sabalan.drill.operation='+operation,...args]);const id=raw.toString().trim();assert.ok(hex(id));
    const actual=await inspect(id);same(actual.Image,input.images[role].id);same(actual.Config.Labels['sabalan.drill.operation'],operation);same(actual.HostConfig.Privileged,false);assert.ok(!actual.HostConfig.PortBindings||Object.keys(actual.HostConfig.PortBindings).length===0);
    const start=launch(['start','--attach',...(role==='inquiry'?['--interactive']:[]),id],{daemon:true});const value={id,image:actual.Image,originalCreateChild:owner.child,originalCreateClosed:true,originalCreateExitCode:owner.code,originalStartChild:start.child,start,role};
    save('CONTAINER_CREATED',{role,id,image:actual.Image,originalCreatePid:owner.child.pid,originalStartPid:start.child.pid});
    const until=Date.now()+120000;for(;;){const observed=await inspect(id);if(observed.State.Running){value.originalDaemonPid=observed.State.Pid;break;}
      assert.ok(!start.closed&&Date.now()<until,'ORIGINAL_CONTAINER_START_UNKNOWN');await new Promise(resolve=>setTimeout(resolve,100));}
    return value;}
  async function beforeDocker(value){guard();const actual=await inspect(value.id);same(actual.Image,value.image);same(actual.State.Running,true);
    const nets=actual.NetworkSettings.Networks;same(Object.keys(nets),[networkName]);same(nets[networkName].NetworkID,network);return actual;}
  const fixed=['--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--pids-limit=256','--log-driver=local','--log-opt=max-size=10m','--log-opt=max-file=2'];
  const mount=(source,target,ro=false)=>['--mount','type=bind,src='+source+',dst='+target+(ro?',readonly':'')];
  const exec=async(role,args,stdin)=>{await beforeDocker(role);return await run(independentExecArguments(role.id,args),stdin);};
  async function sql(text,selected=database,user='postgres'){assert.match(selected,/^[A-Za-z_][A-Za-z0-9_]*$/);assert.match(user,/^[A-Za-z_][A-Za-z0-9_]*$/);return (await exec(postgres,['psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-U',user,'-d',selected,'-c',text])).raw.toString().trim();}
  async function waitPostgres(selected=database,user='postgres'){const until=Date.now()+(physical?240000:120000);while(Date.now()<until){const actual=await inspect(postgres.id);same(actual.State.Running,true);
      const probe=launch(['exec',postgres.id,'pg_isready','-U',user,'-d',selected],{kind:'POSTGRES_READINESS'});await probe.done;assert.ok([0,1,2].includes(probe.code)&&probe.signal===null);if(probe.code===0)return;await new Promise(r=>setTimeout(r,250));}throw Error('ORIGINAL_POSTGRES_READINESS_UNKNOWN');}
  try{
    await image(input.images.postgres.id);await stageImage('backend',resourceBudget.requiredDiskBytes);
    save('NETWORK_CREATE_INTENT',{name:networkName,productionAdmission:false});mutated=true;
    network=(await run(['network','create','--internal','--label','io.sabalan.independent-operation='+operation,networkName])).raw.toString().trim();assert.ok(hex(network));save('NETWORK_CREATED',{id:network,name:networkName});
    if(!physical){postgres=await create('postgres',[...fixed,'--user=70:70','--network',networkName,'--network-alias','postgres','--memory='+CAPS.postgres+'m','--cpus=0.75','--shm-size=64m','--env-file',hostRoot+'/postgres.env',
      ...mount(hostRoot+'/postgres','/var/lib/postgresql/data'),...mount(hostRoot+'/marker.sql','/docker-entrypoint-initdb.d/20-marker.sql',true),
      '--tmpfs','/var/run/postgresql:rw,nosuid,nodev,uid=70,gid=70,mode=0700,size=16m','--tmpfs','/tmp:rw,nosuid,nodev,size=64m',input.images.postgres.id,
      'postgres','-c','max_connections=25','-c','shared_buffers=64MB','-c','max_wal_size=128MB','-c','min_wal_size=32MB']);
    await waitPostgres();}
    control=await create('backend',[...fixed,'--network',networkName,'--memory='+CAPS.control+'m','--cpus=1','--env-file',hostRoot+'/backend.env',
      ...mount(hostRoot,root),...mount(authority,'/run/sabalan-online',true),...mount(physical?physical.point.root:path.dirname(checkpointArchivePath),'/checkpoints',true),
      ...mount(input.recoveryPrivateKeyPath,'/run/secrets/recovery-private.pem',true),'--tmpfs','/tmp:rw,nosuid,nodev,size=256m',input.images.backend.id,
      '/usr/local/bin/node','-e','setInterval(()=>{},30000)']);
    const installed=JSON.parse((await exec(control,['/usr/local/bin/node','-e',"const fs=require('fs'),crypto=require('crypto');const p=require('@prisma/client');console.log(JSON.stringify({models:p.Prisma.dmmf.datamodel.models.length,schemaSha256:crypto.createHash('sha256').update(fs.readFileSync('/app/prisma/schema.prisma')).digest('hex'),restoreEngineSha256:crypto.createHash('sha256').update(fs.readFileSync('/app/dist/services/systemRecoveryEngine.js')).digest('hex'),migrations:fs.readdirSync('/app/prisma/migrations').filter(name=>/^\\d+_/.test(name)).length}));"])).raw);
    same(installed.restoreEngineSha256,input.images.backend.restoreEngineSha256);
    same(installed.models,input.images.backend.expectedModelCount);same(installed.schemaSha256,input.images.backend.runtime.schemaSha256);same(installed.migrations,input.images.backend.expectedMigrationCount);report.installedBackend=installed;
    let originalRestore;
    if(physical){
      await storagePhase('STORAGE_PHASE_BEGIN');report.phase='AUTHENTICATING_PHYSICAL_COMPONENTS';
      const containerPointFile=file=>'/checkpoints/'+path.posix.relative(physical.point.root,file);
      const decryptRoot=root+'/online-decrypted';mkdir(decryptRoot);
      const decryptInput={format:'sabalan-independent-online-components-input/v1',operation,captureId:physical.point.captureId,root:decryptRoot,
        sealedFile:containerPointFile(physical.point.sealedFile),sealedSha256:physical.point.sealedSha256,manifestFile:containerPointFile(physical.point.manifestFile),manifestSha256:physical.point.manifestSha256,
        codecFile:root+'/recoveryCrypto.cjs',codecSha256:input.sourcePins['recoveryCrypto.cjs'],keyFile:'/run/secrets/recovery-private.pem',keySha256:input.recoveryPrivateKeySha256,
        cipherPaths:Object.fromEntries(Object.entries(physical.point.cipherPaths).map(([name,file])=>[name,containerPointFile(file)]))};
      const decryptRaw=bytes(decryptInput);write(hostRoot+'/online-decrypt-input.json',decryptRaw);
      const decrypted=await exec(control,['/usr/local/bin/node',root+'/independent-online-components.worker.cjs',root+'/online-decrypt-input.json',sha(decryptRaw)]);
      const decryption=JSON.parse(decrypted.raw);same(decryption.fullGcmAuthenticated,true);same(decryption.independentRsaDecryptVerified,true);same(decryption.captureId,physical.point.captureId);
      report.decryption=decryption;
      write(hostRoot+'/online-decryption-output.json',decrypted.raw);report.originalComponentDecryption={rawBase64:decrypted.raw.toString('base64'),sha256:sha(decrypted.raw),originalPid:decrypted.owner.child.pid,originalExitCode:decrypted.owner.code};
      const cutRows=decryption.components.filter(row=>row.role==='versioned-file-cut');same(cutRows.length,9);
      const requiredProbe="process.chdir(process.argv[1]);const r=[...new Set([...require('/app/dist/services/hrPersonnelErasureGraph.js').HR_PERSONNEL_ERASURE_STORAGE_ROOTS,...require('/app/dist/services/documentPdfFileRuntime.js').DOCUMENT_PDF_RETAINED_ROOTS,require('/app/dist/services/dispatchFileRuntime.js').DISPATCH_DOCUMENT_STORAGE_ROOT,require('/app/dist/services/performanceFileRuntime.js').performanceExportStorageDirectory(),require('/app/dist/services/supportFileRuntime.js').supportTicketStorageDirectory()])].sort();console.log(JSON.stringify(r));";
      const required=JSON.parse((await exec(control,['/usr/local/bin/node','-e',requiredProbe,app])).raw);same(required.length,9);
      const layoutRoots=cutRows.map(row=>{const cut=JSON.parse(privateRead(disk(row.path),row.sha256));assert.ok(cut.source.path.startsWith('/app/'));return {name:row.name.slice('cut-'.length),sourceLiveRoot:cut.source.path,live:app+'/'+cut.source.path.slice('/app/'.length)};});
      same(layoutRoots.map(row=>row.live).sort(),required);
      const layoutInput={format:'sabalan-independent-online-layout-input/v1',operation,captureId:physical.point.captureId,componentsFile:root+'/online-decryption-output.json',componentsSha256:sha(decrypted.raw),sourceManifestFile:containerPointFile(physical.point.manifestFile),
        postgresRoot:root+'/postgres',walRoot:root+'/physical-wal',storesRoot:root+'/physical-source-stores',sqliteTarget:app+'/recovery-sources/inquiry/inquiry.db',coordinationHistoryTarget:root+'/historical-coordination/history.json',roots:layoutRoots,
        coverageReader:root+'/online-checkpoint-coverage.py',coverageReaderSha256:input.sourcePins['online-checkpoint-coverage.py'],fileReader:root+'/recovery-versioned-files.py',fileReaderSha256:input.sourcePins['recovery-versioned-files.py'],coordinationReader:root+'/capture-coordination-history.py',coordinationReaderSha256:input.sourcePins['capture-coordination-history.py']};
      const layoutRaw=bytes(layoutInput);write(hostRoot+'/online-layout-input.json',layoutRaw);
      const laidOut=await exec(control,['/usr/bin/python3','-I','-B',root+'/independent-online-layout.py',root+'/online-layout-input.json',sha(layoutRaw)]),layout=JSON.parse(laidOut.raw);
      report.layout=layout;
      for(const [role,key] of [['coherent-cut','originalCapturedRawBase64'],['coverage-manifest','originalCoverageRawBase64'],['wal-capture','originalWalClosureRawBase64']]){const rows=decryption.components.filter(row=>row.role===role);same(rows.length,1);report[key]=privateRead(disk(rows[0].path),rows[0].sha256,0o400,64*1024**2).toString('base64');}
      write(hostRoot+'/online-layout-output.json',laidOut.raw);report.originalPhysicalLayout={rawBase64:laidOut.raw.toString('base64'),sha256:sha(laidOut.raw),originalPid:laidOut.owner.child.pid,originalExitCode:laidOut.owner.code};
      // CHOWN belongs to this original host, not a cap-dropped application.
      for(const directory of [hostRoot+'/postgres',hostRoot+'/physical-wal']){const stack=[directory];while(stack.length){const file=stack.pop();same(fs.realpathSync(file),file);const stat=fs.lstatSync(file);assert.ok(!stat.isSymbolicLink()&&(stat.isDirectory()||stat.isFile()));if(stat.isDirectory())for(const name of fs.readdirSync(file))stack.push(path.join(file,name));else same(stat.nlink,1);fs.chownSync(file,70,70);}}
      const verifier=await create('postgres',[...fixed,'--user=70:70','--network',networkName,'--memory='+CAPS.postgres+'m','--cpus=0.75',...mount(hostRoot+'/postgres','/var/lib/postgresql/data',true),...mount(hostRoot+'/physical-wal','/wal',true),input.images.postgres.id,'/bin/sh','-c','while :; do sleep 30; done']);
      const backupVerified=await exec(verifier,['pg_verifybackup','--no-parse-wal','/var/lib/postgresql/data']);
      const controlData=await exec(verifier,['pg_controldata','/var/lib/postgresql/data']);
      const replayPlan=compileIndependentPhysicalReplay({operation,layout,controlDataRaw:controlData.raw.toString('utf8'),postgresUser:physical.point.postgresUser});
      const walVerified=await exec(verifier,replayPlan.verifyWal);
      await run(['stop','--time','60',verifier.id]);await verifier.start.done;const verifierFinal=await inspect(verifier.id);same(verifierFinal.State.Running,false);same(verifierFinal.State.Pid,0);assert.ok([0,143].includes(verifierFinal.State.ExitCode));await run(['rm',verifier.id]);
      report.originalPhysicalVerifier={backup:{rawBase64:backupVerified.raw.toString('base64'),originalPid:backupVerified.owner.child.pid,originalExitCode:backupVerified.owner.code},controlData:{rawBase64:controlData.raw.toString('base64'),originalPid:controlData.owner.child.pid,originalExitCode:controlData.owner.code},wal:{rawBase64:walVerified.raw.toString('base64'),originalPid:walVerified.owner.child.pid,originalExitCode:walVerified.owner.code},carrier:{originalAttachPid:verifier.start.child.pid,originalAttachCode:verifier.start.code,containerExitCode:verifierFinal.State.ExitCode}};
      report.originalPgCommands=[['pg_verifybackup',backupVerified],['pg_controldata',controlData],['pg_waldump',walVerified]].map(([role,value])=>({role,originalPid:value.owner.child.pid,returncode:value.owner.code,signal:value.owner.signal,stdoutRawBase64:value.raw.toString('base64'),stdoutSha256:sha(value.raw)}));
      for(const [file,raw,mode] of [['restore.conf',Buffer.from("data_directory='/var/lib/postgresql/data'\nshared_buffers='64MB'\n"),0o400],['restore-hba.conf',Buffer.from('local all all trust\nhost all all 0.0.0.0/0 scram-sha-256\n'),0o400],['restore-ident.conf',Buffer.alloc(0),0o400],['postgres/recovery.signal',Buffer.alloc(0),0o600]]){write(hostRoot+'/'+file,raw,mode);fs.chownSync(hostRoot+'/'+file,70,70);}
      postgres=await create('postgres',[...fixed,'--user=70:70','--network',networkName,'--network-alias','postgres','--memory='+CAPS.postgres+'m','--cpus=0.75','--shm-size=64m',...mount(hostRoot+'/postgres','/var/lib/postgresql/data'),...mount(hostRoot+'/physical-wal','/wal',true),...mount(hostRoot+'/restore.conf','/restore.conf',true),...mount(hostRoot+'/restore-hba.conf','/restore-hba.conf',true),...mount(hostRoot+'/restore-ident.conf','/restore-ident.conf',true),'--tmpfs','/var/run/postgresql:rw,nosuid,nodev,uid=70,gid=70,mode=0700,size=16m','--tmpfs','/tmp:rw,nosuid,nodev,size=64m',input.images.postgres.id,...replayPlan.postgresArguments]);
      await waitPostgres(replayPlan.sourceDatabase,replayPlan.postgresUser);
      const until=Date.now()+240000;let replayObserved;
      while(Date.now()<until){const observed=await exec(postgres,['psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-U',replayPlan.postgresUser,'-d','postgres','-c',replayPlan.observeReplaySql]);const observation=JSON.parse(observed.raw);if(observation.inRecovery===false){replayObserved=assertIndependentPhysicalReplayObserved(replayPlan,observation);report.originalPhysicalReplaySql={rawBase64:observed.raw.toString('base64'),sha256:sha(observed.raw),originalPid:observed.owner.child.pid,originalExitCode:observed.owner.code,originalSignal:observed.owner.signal};break;}await new Promise(resolve=>setTimeout(resolve,250));}
      assert.ok(replayObserved,'ORIGINAL_PHYSICAL_NAMED_POINT_NOT_REPLAYED');
      same(await sql("SELECT count(*) FROM pg_stat_activity WHERE datname='"+replayPlan.sourceDatabase+"'",'postgres',replayPlan.postgresUser),'0');
      await sql(replayPlan.renameDatabaseSql,'postgres',replayPlan.postgresUser);
      await sql("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='postgres') THEN CREATE ROLE postgres LOGIN SUPERUSER; END IF; END $$; ALTER ROLE postgres WITH LOGIN SUPERUSER PASSWORD '"+password+"'",'postgres',replayPlan.postgresUser);
      if(await sql("SELECT count(*) FROM pg_database WHERE datname='sabalanerp'",'postgres')==='0')await sql('CREATE DATABASE sabalanerp TEMPLATE template0','postgres');
      originalRestore={value:{format:'sabalan-original-independent-physical-replay/v1',operation,captureId:physical.point.captureId,sealedManifestSha256:physical.point.sealedSha256,plaintextManifestSha256:physical.point.manifestSha256,cipherInventorySha256:physical.cipherInventorySha256,sourceDatabase:layout.sourceDatabase,restorePoint:layout.restorePoint,physicalReplayQualified:true,restoredFileRoots:layout.restoredFileCuts.length,layout,actualReplay:replayObserved,originalVerifier:report.originalPhysicalVerifier,productionAdmission:false}};
      originalRestore.raw=bytes(originalRestore.value);write(hostRoot+'/original-restore-output.json',originalRestore.raw);report.originalPhysicalRestoreOutputRawBase64=originalRestore.raw.toString('base64');report.physicalReplayQualified=true;report.restorePoint={name:layout.restorePoint.name,lsn:layout.restorePoint.lsn,requiredWalEndLsn:layout.restorePoint.requiredWalEndLsn,timeline:layout.coverage.timeline};report.sourceDatabase={name:layout.sourceDatabase.database,oid:String(layout.sourceDatabase.databaseOid),systemIdentifier:layout.sourceDatabase.systemIdentifier};report.replay=replayObserved;
      await storagePhase('STORAGE_PHASE_END');report.stages.push({stage:'ORIGINAL_PG15_NAMED_POINT_REPLAY',outputSha256:sha(originalRestore.raw),originalPostgresAttachPid:postgres.start.child.pid,sourceDatabaseOid:replayObserved.sourceDatabaseOid});
    }else{
    const restoredMetadata={...metadata,remotePath:'/checkpoints/'+path.basename(checkpointArchivePath),independentRestoreVerified:false,lastDrill:undefined};
    write(hostRoot+'/checkpoint-private.json',bytes(restoredMetadata),0o600);
    report.phase='RESTORING';
    const restoreEnvironment={DATABASE_URL:databaseUrl,BACKEND_RUNTIME_ROLE:'control',DEPLOYMENT_DRILL_ISOLATED:'true',PRODUCTION_DATABASE_URL:input.productionDatabaseIdentity,
      DEPLOYMENT_DRILL_DATABASE_MARKER:marker,DEPLOYMENT_DRILL_METADATA_PATH:root+'/checkpoint-private.json',DEPLOYMENT_REMOTE_RECOVERY_PRIVATE_KEY_FILE:'/run/secrets/recovery-private.pem',
      DEPLOYMENT_REPORT_DIR:root+'/restore-reports',RECOVERY_COORDINATION_DIR:coordination,RECOVERY_STORAGE_DIR:app+'/storage/recovery',INQUIRY_RECOVERY_SOURCE_DIR:app+'/recovery-sources/inquiry'};
    write(hostRoot+'/restore.env',Buffer.from(Object.entries(restoreEnvironment).map(([key,value])=>{assert.ok(!/[\r\n]/.test(value));return key+'='+value;}).join('\n')+'\n'));
    const restored=await exec(control,['--env-file',hostRoot+'/restore.env','--workdir',app,
      '/bin/sh','/app/scripts/with-backend-control-ownership.sh','/usr/local/bin/node','/app/dist/scripts/deployment-recovery-drill.js']);
    const candidates=restored.raw.toString('utf8').split('\n').filter(Boolean).flatMap(line=>{try{const v=JSON.parse(line);return v.ok===true&&v.drill?[{raw:Buffer.from(line),value:v}]:[];}catch{return [];}});
    same(candidates.length,1);originalRestore=candidates[0];same(originalRestore.value.drill.checksum,metadata.checksum);same(originalRestore.value.drill.status,'HEALTHY');
    same(originalRestore.value.drill.recoveryMachineUuidSha256,host.machineUuidSha256);same(originalRestore.value.drill.recoveryKernelBootIdSha256,host.kernelBootIdSha256);
    write(hostRoot+'/original-restore-output.json',originalRestore.raw);report.canonicalRestoreOutputRawBase64=originalRestore.raw.toString('base64');
    report.stages.push({stage:'CANONICAL_COMPLETE_RESTORE',originalPid:restored.owner.child.pid,originalExitCode:restored.owner.code,outputSha256:sha(originalRestore.raw),drill:originalRestore.value.drill});
    }
    // Canonical owner applied its installed bounded migrations during isolated
    // restore. This is separate from the old checkpoint's original schema.
    const migrationCount=Number(await sql('SELECT count(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL'));
    same(migrationCount,input.images.backend.expectedMigrationCount);report.migrations={expected:migrationCount,observed:migrationCount,performedBy:physical?'observed-post-expansion-physical-point':'canonical-isolated-restore-owner',originalCheckpointRelease:metadata.releaseId,newRuntimeSource:input.images.backend.sourceCommit};
    await run(['stop','--time','60',control.id]);await control.start.done;const controlFinal=await inspect(control.id);same(controlFinal.State.Running,false);same(controlFinal.State.OOMKilled,false);same(controlFinal.State.Pid,0);assert.ok([0,143].includes(controlFinal.State.ExitCode));
    report.restoreControlClosure={id:control.id,originalAttachPid:control.start.child.pid,originalAttachCode:control.start.code,containerExitCode:controlFinal.State.ExitCode};
    await run(['rm',control.id]);
    // The serving carrier has neither the independent recovery private key nor
    // the original checkpoint directory. The QA signing key stays on the host.
    backend=await create('backend',[...fixed,'--network',networkName,'--memory='+CAPS.backend+'m','--cpus=1','--env-file',hostRoot+'/backend.env',
      ...mount(hostRoot,root),...mount(authority,'/run/sabalan-online',true),'--tmpfs','/tmp:rw,nosuid,nodev,size=128m',input.images.backend.id,
      '/usr/local/bin/node','-e','setInterval(()=>{},30000)']);
    const applicationMounts=(await beforeDocker(backend)).Mounts;
    assert.ok(!applicationMounts.some(value=>value.Source===input.recoveryPrivateKeyPath||value.Destination==='/run/secrets/recovery-private.pem'||value.Destination==='/checkpoints'));
    report.applicationHasRecoveryPrivateKeyMount=false;
    same(await sql("SELECT count(*) FROM pg_stat_activity WHERE datname='"+database+"' AND pid<>pg_backend_pid()"),'0');
    const observerQueries=independentIdentityObserverQueries(sourceDatabase);
    await sql(observerQueries.create,'postgres');
    const observerBytes=Number(await sql(observerQueries.size,'postgres'));
    assert.ok(Number.isSafeInteger(observerBytes)&&observerBytes>0&&observerBytes<=resourceBudget.identityObserverMaximumBytes);
    same(await sql(observerQueries.publicTables,sourceDatabase),'0');
    report.identityObserver={role:'EMPTY_ISOLATED_IDENTITY_OBSERVER',template:'template0',bytes:observerBytes,publicTables:0,restoredClone:false};
    const system=await sql('SELECT system_identifier FROM pg_control_system()'),oid=await sql("SELECT oid FROM pg_database WHERE datname='"+sourceDatabase+"'"),restoredOid=await sql("SELECT oid FROM pg_database WHERE datname='"+database+"'");
    report.proofDatabase={name:database,systemIdentifier:system,oid:String(restoredOid)};report.restoredDatabase={...report.proofDatabase};
    for(const name of ['online','online/native','online/work','online/admission','online/admission/staging'])mkdir(coordination+'/'+name);
    const lock=name=>{const target=coordination+'/'+name,file=disk(target);if(!fs.existsSync(file))write(file,Buffer.alloc(0),0o600);const stat=fs.lstatSync(file,{bigint:true});assert.ok(stat.isFile()&&stat.size===0n&&stat.uid===0n&&stat.nlink===1n);return {file:target,device:String(stat.dev),inode:String(stat.ino),ownerUid:0};};
    const gate=lock('deployment-write-admission.lock'),interlock=lock('deployment-runtime-control.lock'),worker=lock('deployment-online-worker.lock');
    const definition=bytes({format:'sabalan-online-admission-scope/v1',gate,interlock,worker,database:{systemIdentifier:system,name:database}});
    write(disk(coordination+'/online/admission/scope.json'),definition);write(disk(coordination+'/online/admission/00000000.json'),bytes({format:'sabalan-online-capture-admission/v1',generation:0,phase:'OPEN',previousSha256:null,capture:null,closureSha256:null}));
    function grant(purpose,imageIdentity=input.images.backend.id,commit=input.images.backend.sourceCommit,bundle=input.images.backend.runtime.distTreeSha256){
      const id=randomBytes(32).toString('hex'),native=coordination+'/online/native/'+id,boundary=coordination+'/online/work/'+id;mkdir(native);mkdir(boundary);write(disk(native+'/deployment-runtime-control.lock'),Buffer.alloc(0),0o600);
      const scope={format:'sabalan-online-runtime-scope/v2',runtimeId:id,releaseId:privateReleaseId,manifestSha256:bundle,sourceCommit:commit,image:imageIdentity,nonce:randomBytes(32).toString('hex'),purpose,role:purpose==='http'?'serving':'control',
        coordinationDirectory:coordination,nativeDirectory:native,boundaryDirectory:boundary,gate,interlock,worker:purpose==='http'?null:worker,database:{systemIdentifier:system,name:database},admission:{directory:coordination+'/online/admission',scopeSha256:sha(definition)}};
      write(disk(boundary+'/scope.json'),bytes({format:'sabalan-runtime-namespace/v1',scope:{runtimeId:id,image:scope.image,registrySha256:scope.manifestSha256,generation:1,gate:{device:gate.device,inode:gate.inode,ownerUid:0},postgresApplicationName:'sabalan-rt-'+sha(id).slice(0,48)}}),0o600);
      const raw=bytes(scope);write(authority+'/'+id+'.json',raw);return {scope,file:'/run/sabalan-online/'+id+'.json',sha256:sha(raw)};
    }
    const baselineGrant=grant('jobs'),httpGrant=grant('http'),jobsGrant=grant('jobs');
    const inquiryGrant=grant('http',input.images.inquiry.id,input.images.inquiry.sourceCommit,input.images.inquiry.runtimeBundleSha256);
    const index={sourceDatabaseRole:'EMPTY_ISOLATED_IDENTITY_OBSERVER',database:sourceDatabase,oid,restoredDatabase:database,restoredOid,schemaSha256:input.images.backend.runtime.schemaSha256,grants:[],restoredBaselineGrant:baselineGrant,
      privateQualification:{qualificationId,runtimeBundleSha256:input.images.backend.runtime.distTreeSha256,qualificationRoot:app,httpGrant,jobsGrant}};
    const backendActual=await beforeDocker(backend),backendHost=backendActual.NetworkSettings.Networks[networkName].IPAddress;
    const config={image:input.images.backend.id,sourceCommit:input.images.backend.sourceCommit,privateQualificationRuntime:input.images.backend.runtime,roleTopology:{main:{host:backendHost}}};
    broker=createOriginalIndependentQualificationController({root,index,config,sourcePins:input.sourcePins,beforeDocker,onHeld:value=>hold(Error(value.code))});
    write(authority+'/qualification-controller-public-key.pem',Buffer.from(broker.enrollment.publicKeyPem),0o444);
    config.originalHostEnrollment={publicKey:broker.enrollment.publicKey,session:broker.enrollment.session,roleTopology:{main:{containerId:backend.id,image:backend.image,host:backendHost}}};
    write(hostRoot+'/index.json',bytes(index));write(hostRoot+'/config.json',bytes(config));
    const rootProbe="const path=require('path');process.chdir(process.argv[1]);const roots=[...new Set([...require('/app/dist/services/hrPersonnelErasureGraph.js').HR_PERSONNEL_ERASURE_STORAGE_ROOTS,...require('/app/dist/services/documentPdfFileRuntime.js').DOCUMENT_PDF_RETAINED_ROOTS,require('/app/dist/services/dispatchFileRuntime.js').DISPATCH_DOCUMENT_STORAGE_ROOT,require('/app/dist/services/performanceFileRuntime.js').performanceExportStorageDirectory(),require('/app/dist/services/supportFileRuntime.js').supportTicketStorageDirectory()])].sort();console.log(JSON.stringify(roots));";
    const required=JSON.parse((await exec(backend,['/usr/local/bin/node','-e',rootProbe,app])).raw);same(required.length,9);
    const roots=required.map((live,i)=>{mkdir(live);const store=app+'/.versions/root-'+i;mkdir(store);return {name:'root-'+i,live,store};});
    for(const name of ['reports','sales-reports','bi-reports'])mkdir(app+'/storage/'+name);
    const baselineInput={format:'sabalan-independent-restored-baseline-input/v1',qualificationRoot:app,captureId:physical?physical.point.captureId:sha(bytes({operation,checksum:metadata.checksum})),checkpointSha256:metadata.checksum,...(physical?{captureSource:'independent-physical-v3'}:{}),
      originalRestoreOutput:{path:root+'/original-restore-output.json',sha256:sha(originalRestore.raw)},database:{name:database,systemIdentifier:system,oid:restoredOid},roots,outputManifest:root+'/restored-file-baseline.json'};
    const baselineRaw=bytes(baselineInput);write(hostRoot+'/independent-baseline-input.json',baselineRaw);
    const controller={format:'sabalan-original-independent-private-controller/v1',indexSha256:sha(bytes(index)),sourcePins:input.sourcePins,baselineInputSha256:sha(baselineRaw),
      postgres:{host:'postgres',port:5432,controlDatabase:'sabalanerp'},publicKey:broker.enrollment.publicKey,session:broker.enrollment.session,actorId:broker.enrollment.actorId};
    const controllerRaw=bytes(controller);write(hostRoot+'/independent-controller.json',controllerRaw);
    broker.enrollOriginalContainer(backend);report.baseline=await broker.runBaseline(sha(controllerRaw));
    const baselineManifestRaw=privateRead(hostRoot+'/restored-file-baseline.json',report.baseline.result.manifestSha256);report.restoredBaselineRawBase64=baselineManifestRaw.toString('base64');
    same(JSON.parse(baselineManifestRaw).capturedManifest.sha256,sha(originalRestore.raw));
    // Empty runtime-owned child is prepared after legacy adoption; no dummy
    // report, sentinel file or business record is inserted to manufacture it.
    mkdir(app+'/storage/accounting-contracts/.official-reports');
    report.initializer=await broker.initialize();report.backendReady=await broker.startHttp(sha(controllerRaw));
    const nextConfig={frontend:{port:3000,healthPath:'/login',image:input.images.frontend.id,sourceCommit:input.images.frontend.sourceCommit},inquiry:{port:3001,healthPath:'/admin/login',image:input.images.inquiry.id,sourceCommit:input.images.inquiry.sourceCommit,grant:inquiryGrant,
      runtimeFiles:input.images.inquiry.runtimeFiles,runtimeBundleSha256:input.images.inquiry.runtimeBundleSha256}};
    write(hostRoot+'/next-controller.json',bytes(nextConfig));
    async function health(role,port,route){const actual=await beforeDocker(role),hostIp=actual.NetworkSettings.Networks[networkName].IPAddress;const until=Date.now()+240000;
      while(Date.now()<until){try{const response=await fetch('http://'+hostIp+':'+port+route,{redirect:'manual',signal:AbortSignal.timeout(2000)});const chunks=[];let count=0;
        for await(const chunk of response.body){count+=chunk.length;assert.ok(count<=8*1024**2);chunks.push(Buffer.from(chunk));}const raw=Buffer.concat(chunks);
        if(response.status===200)return {status:200,responseSha256:sha(raw),image:role.image,declaredSourceCommit:input.images[role.role].sourceCommit,
          sourceBinding:role.role==='backend'?'verified-image-receipt-and-source-label':role.role==='frontend'?'verified-image-receipt-and-installed-compiled-manifest':'verified-image-archive-and-installed-runtime-inventory'};}catch{}await new Promise(r=>setTimeout(r,250));}throw Error('ORIGINAL_APP_HEALTH_UNKNOWN_'+role.role);}
    report.applicationStages='SEQUENTIAL_SAME_RESTORED_POINT';
    report.applicationHealth={backend:await health(backend,33179,'/api/health')};
    report.backendClosure=await broker.closeHttp();
    await run(['stop','--time','60',backend.id]);await backend.start.done;const backendFinal=await inspect(backend.id);same(backendFinal.State.Running,false);same(backendFinal.State.OOMKilled,false);same(backendFinal.State.Pid,0);assert.ok([0,143].includes(backendFinal.State.ExitCode));
    report.backendCarrierClosure={id:backend.id,originalAttachPid:backend.start.child.pid,originalAttachCode:backend.start.code,containerExitCode:backendFinal.State.ExitCode};
    await run(['rm',backend.id]);await retireStage('backend');
    await stageImage('inquiry',resourceBudget.remainingHostReserve+resourceBudget.logsAndMetadata);
    const sqliteBefore=hashFile(disk(app+'/recovery-sources/inquiry/inquiry.db'));
    inquiry=await create('inquiry',[...fixed,'--interactive','--network',networkName,'--memory='+CAPS.inquiry+'m','--cpus=0.75','--env-file',hostRoot+'/inquiry.env',...mount(hostRoot,root),...mount(authority,'/run/sabalan-online',true),
      ...mount(disk(app+'/recovery-sources/inquiry'),'/data'),'--tmpfs','/tmp:rw,nosuid,nodev,size=128m',input.images.inquiry.id,
      '/usr/bin/python3','-I','-B',root+'/independent-next-runtime.py',root,'inquiry',sha(bytes(nextConfig))]);
    report.applicationHealth.inquiry=await health(inquiry,3001,'/admin/login');
    // The Inquiry fixture keeps the SAME original guardian and receives stop
    // only on its original Docker attach stdin. It explicitly distinguishes
    // requested signal retirement from natural zero.
    inquiry.start.child.stdin.end('STOP\n');await inquiry.start.done;same(inquiry.start.code,0);same(inquiry.start.signal,null);
    const inquiryRows=Buffer.concat(inquiry.start.out).toString().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    same(inquiryRows.map(v=>v.event),['READY','CLOSED']);
    // qualify_requested_stop checks sqliteNativeClosed in the raw native record.
    const native=JSON.parse(Buffer.from(inquiryRows[1].closure.nativeRawBase64,'base64'));same(native.sqliteNativeClosed,true);same(native.nativeReaped,true);same(native.phase,'QUIESCENT');
    report.inquiryClosure=inquiryRows[1];
    const inquiryFinal=await inspect(inquiry.id);same(inquiryFinal.State.Running,false);same(inquiryFinal.State.ExitCode,0);same(inquiryFinal.State.OOMKilled,false);same(inquiryFinal.State.Pid,0);
    await run(['rm',inquiry.id]);await retireStage('inquiry');
    const sqliteAfter=hashFile(disk(app+'/recovery-sources/inquiry/inquiry.db'));same(sqliteAfter,sqliteBefore);report.inquiryReadOnlyData={before:sqliteBefore,after:sqliteAfter};
    for(const suffix of ['-wal','-shm']){const sidecar=disk(app+'/recovery-sources/inquiry/inquiry.db'+suffix);assert.ok(!fs.existsSync(sidecar)||fs.lstatSync(sidecar).size===0);}
    await stageImage('frontend',resourceBudget.remainingHostReserve+resourceBudget.logsAndMetadata);
    frontend=await create('frontend',[...fixed,'--network',networkName,'--memory='+CAPS.frontend+'m','--cpus=0.75','--tmpfs','/tmp:rw,nosuid,nodev,size=128m',input.images.frontend.id,
      '/bin/sh','-ec','node -e '+JSON.stringify("const fs=require('fs'),c=require('crypto'),a=require('assert/strict');const h=p=>c.createHash('sha256').update(fs.readFileSync(p)).digest('hex');a.equal(h('/app/online-runtime-manifest.json'),'"+input.images.frontend.manifestSha256+"');a.equal(h('/app/online-runtime-verify.cjs'),'"+input.images.frontend.verifierSha256+"');a.equal(JSON.parse(fs.readFileSync('/app/online-runtime-manifest.json')).buildId,'"+input.images.frontend.buildId+"');require('/app/online-runtime-verify.cjs');")+'; exec node /app/node_modules/next/dist/bin/next start --hostname 0.0.0.0 --port 3000']);
    report.applicationHealth.frontend=await health(frontend,3000,'/login');
    save('FRONTEND_REQUESTED_STOP',{id:frontend.id,signal:'SIGTERM',allowedExitCodes:[0,143],naturalNativeZero:false});
    await run(['stop','--time','60',frontend.id]);await frontend.start.done;const frontendFinal=await inspect(frontend.id);same(frontendFinal.State.Running,false);assert.ok([0,143].includes(frontendFinal.State.ExitCode));same(frontendFinal.State.OOMKilled,false);same(frontendFinal.State.Pid,0);
    report.frontendClosure={originalAttachPid:frontend.start.child.pid,attachExitCode:frontend.start.code,containerExitCode:frontendFinal.State.ExitCode,requestedContainerStop:true,naturalNativeZero:false};
    await run(['rm',frontend.id]);await retireStage('frontend');
    const ownedNaturalClosures=[report.baseline,report.backendClosure.closed];
    const namespaces=ownedNaturalClosures.map(closure=>{const scope=JSON.parse(Buffer.from(closure.workScopeRawBase64,'base64')).scope;const native=JSON.parse(Buffer.from(closure.nativeRawBase64,'base64'));same(scope.runtimeId,native.onlineScope.scope.runtimeId);return scope.postgresApplicationName;});
    const namespaceQuery=independentNamespaceObservationQuery(database,namespaces);
    const namespaceObserved=await exec(postgres,['psql','-X','-A','-t','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',namespaceQuery]);
    const namespaceValue=JSON.parse(namespaceObserved.raw);same(namespaceValue.visible,true);same(namespaceValue.database,report.proofDatabase);same(namespaceValue.sessions,0);same(namespaceValue.prepared,0);
    same(namespaceValue.namespaces.map(row=>row.namespace).sort(),[...namespaces].sort());assert.ok(namespaceValue.namespaces.every(row=>row.sessions===0));
    report.originalNamespaceSqlObservation={querySha256:sha(Buffer.from(namespaceQuery)),rawBase64:namespaceObserved.raw.toString('base64'),originalPid:namespaceObserved.owner.child.pid,originalExitCode:namespaceObserved.owner.code,originalSignal:namespaceObserved.owner.signal};
    const finalSessions=Number(await sql("SELECT count(*) FROM pg_stat_activity WHERE datname IN ('"+database+"','"+sourceDatabase+"')" ,'postgres'));
    const finalPrepared=Number(await sql("SELECT count(*) FROM pg_prepared_xacts WHERE database IN ('"+database+"','"+sourceDatabase+"')",'postgres'));
    same(finalSessions,0);same(finalPrepared,0);report.finalSql={sessions:finalSessions,prepared:finalPrepared};
    same(hashFile(checkpointArchivePath,input.checkpointArchiveUid,input.checkpointArchiveMode),{sha256:metadata.checksum,size:metadata.size});
    if(!physical)same(privateRead(input.checkpointMetadataPath,input.checkpointMetadataSha256,input.checkpointMetadataMode,16*1024**2,input.checkpointMetadataUid),metadataRaw);
    report.phase='APPLICATIONS_CLOSED_AWAITING_CARRIER_CLOSURE';
    await exec(postgres,['pg_ctl','-D','/var/lib/postgresql/data','-m','fast','-w','stop']);await postgres.start.done;const pgFinal=await inspect(postgres.id);same(pgFinal.State.Running,false);same(pgFinal.State.ExitCode,0);same(pgFinal.State.OOMKilled,false);
    same(postgres.start.code,0);same(postgres.start.signal,null);same(pgFinal.State.Pid,0);
    report.postgresClosure={id:postgres.id,originalAttachPid:postgres.start.child.pid,originalAttachCode:postgres.start.code,containerExitCode:pgFinal.State.ExitCode,normalExit:true};
    const capacityAfter=fs.statfsSync(QA,{bigint:true});report.capacity.afterDiskFreeBytes=String(capacityAfter.bavail*capacityAfter.bsize);assert.ok(capacityAfter.bavail*capacityAfter.bsize>=BigInt(resourceBudget.remainingHostReserve));
    for(const [id,expected]of Object.entries(foreignIdentity)){const actual=await inspect(id);same({id:actual.Id,image:actual.Image,startedAt:actual.State.StartedAt,running:actual.State.Running},expected);}
    guard();assert.ok(journal.every(v=>v.closed&&v.signal===null&&(v.kind==='REQUIRED_ZERO'?v.code===0:v.kind==='POSTGRES_READINESS'?[0,1,2].includes(v.code):v.kind==='CONTAINER_ATTACH'?[0,143].includes(v.code):false)));
    report.originalDockerProcesses=journal.map(v=>({pid:v.child.pid,kind:v.kind,argsSha256:v.argsSha256,code:v.code,signal:v.signal}));
    if(staged.length){same(report.imageTransfers.length,3);for(const role of transferOrder){const transfer=input.images[role].transfer;same(hashFile(transfer.cipherPath),{sha256:transfer.cipherSha256,size:transfer.cipherBytes});}}
    if(physical){const pending=response('WAL_WINDOW_DRAINED');process.stdout.write(JSON.stringify({event:'WAL_WINDOW_DRAIN_REQUEST',operation})+'\n');const ack=await pending;same(ack.operation,operation);transferInterface.close();process.stdin.pause();}
    const completedAt=new Date();report.phase='COMPLETE';report.pass=true;report.retentionPublished=false;
    if(!physical)report.healthyDrill={...originalRestore.value.drill,completedAt:completedAt.toISOString(),durationMs:completedAt.getTime()-Date.parse(originalRestore.value.drill.startedAt),threeApplicationHealth:report.applicationHealth,originalControllerOperation:operation};
    else{report.physicalAndThreeApplicationsQualified=true;report.completedAt=completedAt.toISOString();report.continuousWalQualified=false;}
    // Qualified output remains private. The original checkpoint sidecar is
    // unchanged; existing retention owner must consume this independently
    // reviewed whole-operation evidence, never the intermediate private HEALTHY.
    write(reportFile,bytes(report));
    const token=Object.freeze({});(physical?physicalCompletions:completions).set(token,Object.freeze({format:physical?'sabalan-original-independent-physical-backup-completion/v1':'sabalan-original-independent-backup-completion/v1',operation,configurationSha256:configSha,
      reportSha256:sha(bytes(report)),...(physical?{sealedManifestSha256:physical.point.sealedSha256,plaintextManifestSha256:physical.point.manifestSha256,cipherInventorySha256:physical.cipherInventorySha256,sourceDatabase:report.sourceDatabase,restorePoint:report.restorePoint}:{checkpointMetadataSha256:sha(metadataRaw),checkpointChecksum:metadata.checksum}),
      nativeClosures:Object.freeze([report.baseline,report.backendClosure.closed,report.inquiryClosure.closure].map(value=>Object.freeze({
        originalPopenPid:value.originalPopenPid,originalReturncode:value.originalReturncode,nativeSha256:sha(Buffer.from(value.nativeRawBase64,'base64')),workSha256:sha(Buffer.from(value.workRawBase64,'base64'))}))),
      originalDockerProcesses:Object.freeze(report.originalDockerProcesses.map(value=>Object.freeze({...value}))),productionAdmission:false}));
    console.log(JSON.stringify({pass:true,phase:report.phase,operation,reportSha256:sha(bytes(report)),retentionPublished:false,productionAdmission:false}));return token;
  }catch(error){if(mutated){hold(error);await new Promise(()=>{});}throw error;}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===path.resolve(process.argv[1])){
  runOriginalIndependentFullRestore(process.argv[2],process.argv[3]).catch(()=>{console.error('INDEPENDENT_FULL_RESTORE_PREMUTATION_REFUSED');process.exitCode=1;});
}
