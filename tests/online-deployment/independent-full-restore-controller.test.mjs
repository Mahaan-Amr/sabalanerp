import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,createPublicKey} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {validateConfiguration,independentExecArguments,independentIdentityObserverQueries,independentNamespaceObservationQuery,restoreResourceBudget,validateSelectedImageReceipt,validateSelectedArchiveGraph,requireLegacyBackupQaTransfer} from '../../scripts/run-independent-full-restore-controller.mjs';
import {readOriginalIndependentRestoreSshCompletion,verifyOriginalIndependentSshProtocol} from '../../scripts/lib/independent-full-restore-ssh.mjs';
import {createOriginalIndependentQualificationController} from '../../scripts/lib/independent-private-qualification-controller.mjs';
const require=createRequire(import.meta.url),{inventory}=require('./independent-restored-baseline.worker.cjs');
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const names=['online-runtime-owner.py','online-runtime-scope.py','backend-runtime-owner.py','online-capture-admission.py','original-host-controller-channel.py',
  'private-qualification-observer.py','private-qualification-materialize.py','private-qualification-bootstrap.sql','independent-private-runtime.py',
  'independent-restored-baseline.worker.cjs','online-private-qualification-worker.cjs','independent-next-runtime.py','online-inquiry-owner.py','inquiry-requested-stop.py','verify-inquiry-database.cjs','inquiry-baseline.json','independent-image-transfer.py'];
function configuration(){const result={format:'sabalan-original-independent-full-restore-input/v1',operation:'a'.repeat(32),expectedBackupMachineUuidSha256:'a'.repeat(64),expectedBackupKernelBootIdSha256:'b'.repeat(64),
  productionDatabaseIdentity:'postgresql://source.invalid/actual-source',images:Object.fromEntries(['backend','frontend','inquiry','postgres'].map(role=>[role,
    {id:'sha256:'+'a'.repeat(64),receiptSha256:'b'.repeat(64),receiptPath:'/root/sabalan-recovery-private/'+role+'.json',sourceCommit:'c'.repeat(40),runtimeBundleSha256:'d'.repeat(64),
      expectedMigrationCount:438,expectedModelCount:548,runtime:{entryPath:'/app/dist/onlinePrivateQualification.js',entrySha256:'d'.repeat(64),distTreeSha256:'e'.repeat(64),schemaSha256:'f'.repeat(64),clientInventorySha256:'a'.repeat(64)}}])),
  checkpointMetadataPath:'/root/sabalan-recovery-private/point.sabrec.json',checkpointArchivePath:'/root/sabalan-recovery-private/point.sabrec',checkpointMetadataSha256:'a'.repeat(64),
  checkpointMetadataUid:997,checkpointArchiveUid:997,checkpointMetadataMode:0o600,checkpointArchiveMode:0o600,
  applicationKeysPath:'/root/sabalan-recovery-private/keys.env',applicationKeysSha256:'b'.repeat(64),recoveryPrivateKeyPath:'/root/sabalan-recovery-private/key.pem',recoveryPrivateKeySha256:'c'.repeat(64),
  bundleRoot:'/root/sabalan-recovery-private/bundle',sourcePins:Object.fromEntries(names.map(name=>[name,'a'.repeat(64)]))};
  result.images.inquiry.runtimeFiles=Object.fromEntries(Array.from({length:9},(_,i)=>['file'+i+'.js','a'.repeat(64)]));
  result.images.backend.restoreEngineSha256='a'.repeat(64);
  result.images.inquiry.runtimeBundleSha256=hash(JSON.stringify(result.images.inquiry.runtimeFiles)+'\n');
  Object.assign(result.images.frontend,{buildId:'frozen-build',manifestSha256:'a'.repeat(64),verifierSha256:'b'.repeat(64),materializationReceiptSha256:'c'.repeat(64)});
  for(const role of ['backend','frontend','inquiry']){const image=result.images[role];image.sourceImageId='sha256:'+'f'.repeat(64);image.archiveReceiptPath='/root/sabalan-recovery-private/'+role+'-archive.json';image.archiveReceiptSha256='a'.repeat(64);image.archiveReceiptBytes=1024;
    image.archiveGraph={index:image.sourceImageId,platform:'sha256:'+'e'.repeat(64),config:image.id,rootfsDiffIds:['sha256:'+'b'.repeat(64)],archiveSha256:'c'.repeat(64),archiveBytes:1024};}
  return result;}
function temporary(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-independent-inventory-'));try{return fn(root);}finally{
  assert.ok(path.basename(root).startsWith('sabalan-independent-inventory-')&&path.dirname(root)===os.tmpdir());fs.rmSync(root,{recursive:true});}}

test('canonical restore baseline inventory preserves actual binary/hidden bytes and path order',()=>temporary(root=>{
  fs.mkdirSync(path.join(root,'nested'));fs.mkdirSync(path.join(root,'empty'));
  const blob=Buffer.from([0,255,13,10,0]);fs.writeFileSync(path.join(root,'nested','z.bin'),blob);fs.writeFileSync(path.join(root,'.record'),'actual restored record');
  assert.deepEqual(inventory(fs.realpathSync(root)),[{key:'.record',bytes:22,sha256:hash('actual restored record')},{key:'nested/z.bin',bytes:blob.length,sha256:hash(blob)}]);
}));
test('baseline refuses a filesystem alias escaping the actual restored root',()=>temporary(root=>{
  fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.join(root,'foreign'));fs.writeFileSync(path.join(root,'foreign','foreign.bin'),'foreign');
  fs.symlinkSync(path.join(root,'foreign'),path.join(root,'data','alias'),'junction');assert.throws(()=>inventory(fs.realpathSync(path.join(root,'data'))));
}));
test('baseline refuses shared hardlinks instead of adopting foreign mutable bytes',()=>temporary(root=>{
  fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'outside'),'shared');fs.linkSync(path.join(root,'outside'),path.join(root,'data','linked'));
  assert.throws(()=>inventory(fs.realpathSync(path.join(root,'data'))));
}));
test('restored baseline inventories genuine empty directories alongside unchanged binary files',()=>temporary(root=>{
  fs.mkdirSync(path.join(root,'.deletion-trash'));fs.mkdirSync(path.join(root,'.deletion-trash','original-owner'));fs.mkdirSync(path.join(root,'nested'));
  fs.writeFileSync(path.join(root,'nested','record'),Buffer.from([0,255]));
  assert.deepEqual(inventory(fs.realpathSync(root),true),{files:[{key:'nested/record',bytes:2,sha256:hash(Buffer.from([0,255]))}],directories:['.deletion-trash','.deletion-trash/original-owner','nested']});
}));
test('fixed image/receipt/dependency inputs preserve selected 548/438 expectations and refuse tags/missing Inquiry bundle',()=>{
  const input=configuration();assert.equal(validateConfiguration(input),input);assert.equal(input.images.backend.expectedMigrationCount,438);assert.equal(input.images.backend.expectedModelCount,548);
  const canonical=configuration();canonical.checkpointMetadataPath='/srv/sabalanerp-recovery/checkpoints/point.sabrec.json';canonical.checkpointArchivePath='/srv/sabalanerp-recovery/checkpoints/point.sabrec';assert.equal(validateConfiguration(canonical),canonical);
  for(const mutate of [v=>{v.images.backend.id='backend:latest';},v=>{delete v.images.inquiry.runtimeBundleSha256;},v=>{v.images.backend.runtime.entryPath='/app/dist/index.js';},v=>{v.bundleRoot='/tmp/public';},v=>{delete v.sourcePins['private-qualification-bootstrap.sql'];}]){
    const value=configuration();mutate(value);assert.throws(()=>validateConfiguration(value));}
});
test('actual exec construction keeps Docker options before the exact owned container',()=>{
  const id='a'.repeat(64);assert.deepEqual(independentExecArguments(id,['--env-file','/root/private/restore.env','--workdir','/app/private','/bin/sh','/app/scripts/with-backend-control-ownership.sh','/usr/local/bin/node','/app/dist/scripts/deployment-recovery-drill.js']),
    ['exec','-i','--env-file','/root/private/restore.env','--workdir','/app/private',id,'/bin/sh','/app/scripts/with-backend-control-ownership.sh','/usr/local/bin/node','/app/dist/scripts/deployment-recovery-drill.js']);
  assert.throws(()=>independentExecArguments(id,['--privileged','/bin/sh']));assert.throws(()=>independentExecArguments('foreign-name',['psql']));
});
test('actual observer query builder creates only an empty isolated identity, never clones restored business data',()=>{
  const name='qa_application_native_'+'a'.repeat(32),queries=independentIdentityObserverQueries(name);
  assert.equal(queries.create,'CREATE DATABASE '+name+' TEMPLATE template0');
  assert.equal(queries.size,"SELECT pg_database_size('"+name+"')");
  assert.equal(queries.publicTables,"SELECT count(*) FROM information_schema.tables WHERE table_schema='public'");
  assert.ok(!Object.values(queries).some(value=>value.includes('qa_application_restored_')));
  for(const value of ['production','qa_application_restored_'+'a'.repeat(32),name+"';DROP DATABASE production;"])assert.throws(()=>independentIdentityObserverQueries(value));
});
test('private QA issuer exposes fixed lifecycle only and refuses receipt-only container enrollment before Docker',()=>{
  let docker=0;const broker=createOriginalIndependentQualificationController({root:'/app/online-runtime-acceptance/application-native-'+'a'.repeat(32),index:{},config:{image:'sha256:'+'b'.repeat(64)},sourcePins:configuration().sourcePins,beforeDocker:()=>{docker++;}});
  assert.equal(createPublicKey({key:Buffer.from(broker.enrollment.publicKey,'base64'),format:'der',type:'spki'}).asymmetricKeyType,'ed25519');
  assert.equal(broker.sign,undefined);assert.equal(broker.privateKey,undefined);
  assert.throws(()=>broker.enrollOriginalContainer({id:'a'.repeat(64),image:'sha256:'+'b'.repeat(64),originalCreateClosed:true,originalCreateExitCode:0,originalCreateChild:{exitCode:0},originalStartChild:{}}));
  assert.equal(broker.inspect().phase,'NEW');assert.equal(docker,0);
});
test('direct CLI refuses an unpinned input before any Docker mutation',()=>{
  const file=fileURLToPath(new URL('../../scripts/run-independent-full-restore-controller.mjs',import.meta.url));
  try{execFileSync(process.execPath,[file,'missing-private-config','invalid-sha'],{stdio:['ignore','pipe','pipe']});assert.fail('must refuse');}
  catch(error){assert.equal(error.status,1);assert.match(error.stderr.toString(),/INDEPENDENT_FULL_RESTORE_PREMUTATION_REFUSED/);}
});
test('resource admission measures sequential complete restore peak rather than arbitrary server size',()=>{
  const mib=1024**2,metadata={size:32*mib,capacity:{estimate:{sourceBytes:128*mib}},manifest:{components:[{path:'database/main.dump',size:64*mib},{path:'files/uploads/record',size:1025}]}};
  const budget=restoreResourceBudget(metadata,4096);
  assert.equal(budget.requiredMemoryBytes,1472*mib);assert.ok(budget.requiredDiskBytes<1.87*1024**3);
  assert.equal(budget.retainedAllocated,4096);assert.equal(budget.imageImportBytes,null);assert.equal(budget.imagesMustAlreadyBePresent,false);
  assert.equal(budget.sourceDatabaseRole,'EMPTY_ISOLATED_IDENTITY_OBSERVER');assert.equal(budget.identityObserverMaximumBytes,16*mib);
  assert.equal(budget.postgresPhysicalUpperBound,128*mib-1025,'captured protected bytes cannot also count as physical PostgreSQL');
  assert.equal(budget.protectedBytes,1025);
  assert.deepEqual(budget.stageOrder,['CANONICAL_RESTORE','BACKEND_PRIVATE_HTTP','INQUIRY','FRONTEND']);
  assert.equal(budget.nativePeak,budget.postgresPhysicalUpperBound+16*mib+budget.protectedAllocated+budget.baselineAdditional);
  const large=structuredClone(metadata);large.capacity.estimate.sourceBytes=2*1024*mib;
  assert.ok(restoreResourceBudget(large).requiredDiskBytes>1.87*1024**3);
  const old=configuration();old.minimumDiskFreeBytes=8*1024**3;assert.throws(()=>validateConfiguration(old),/OBSOLETE_ARBITRARY_DISK_FLOOR/);
});
test('original SSH completion cannot be minted from a parsed receipt or an arbitrary object',()=>{
  for(const token of [{},{format:'sabalan-original-independent-ssh-completion/v1',pass:true},Object.freeze({})])assert.throws(()=>readOriginalIndependentRestoreSshCompletion(token),/ORIGINAL_INDEPENDENT_SSH_COMPLETION_UNPROVEN/);
  assert.throws(()=>verifyOriginalIndependentSshProtocol(Buffer.from(JSON.stringify({format:'sabalan-original-independent-ssh/v1',originalRemoteExitStatus:0})),{remoteControllerSha256:'a'.repeat(64)}));
});
test('frontend identity binds actual compiled receipt bytes and accepts unattested labels without claiming source measurement',()=>{
  const selected=configuration().images.frontend;
  const receipt={format:'sabalan-current-frontend-image-build/v2',phase:'COMPLETE',pass:true,outputImage:{id:selected.sourceImageId,labels:{'io.sabalan.performance.source-commit':'unattested'}},
    manifestSha256:selected.manifestSha256,buildId:selected.buildId,materializationReceiptSha256:selected.materializationReceiptSha256,contextInventory:{'online-runtime-verify.cjs':selected.verifierSha256}};
  assert.equal(validateSelectedImageReceipt('frontend',selected,receipt),receipt);
  for(const mutate of [v=>v.outputImage.id=selected.id,v=>v.manifestSha256='f'.repeat(64),v=>v.buildId='foreign',v=>v.contextInventory['online-runtime-verify.cjs']='f'.repeat(64),v=>v.pass=false]){
    const changed=structuredClone(receipt);mutate(changed);assert.throws(()=>validateSelectedImageReceipt('frontend',selected,changed));}
});
test('source OCI index and backup classic config identities require the exact saved graph without relabeling',()=>{
  const selected=configuration().images.inquiry,receipt=structuredClone(selected.archiveGraph);
  assert.equal(validateSelectedArchiveGraph(selected,receipt),selected.archiveGraph);assert.notEqual(selected.id,selected.sourceImageId);
  for(const mutate of [v=>v.config=v.index,v=>v.rootfsDiffIds=['sha256:'+'f'.repeat(64)],v=>v.archiveSha256='f'.repeat(64),v=>v.archiveBytes++]){
    const changed=structuredClone(receipt);mutate(changed);assert.throws(()=>validateSelectedArchiveGraph(selected,changed));}
  const relabeled=structuredClone(selected);relabeled.id=relabeled.sourceImageId;assert.throws(()=>validateSelectedArchiveGraph(relabeled,receipt));
});
test('data-only SSH verifier binds checkpoint/image/raw native lineage and preserves Inquiry128/143 retirement',()=>{
  const h='a'.repeat(64),b='b'.repeat(64),images=structuredClone(configuration().images);delete images.postgres;
  const expected={remote:{operation:'a'.repeat(32)},remoteControllerSha256:h,remoteConfigurationSha256:b,hostKeySha256:h,
    checkpoint:{metadataSha256:h,source:{id:'point',releaseId:'old-release',checksum:b,size:1024,sourceMachineUuidSha256:h,sourceKernelBootIdSha256:b}},
    recoveryHost:{machineUuidSha256:b,kernelBootIdSha256:h},controllerSourcePins:{controller:h},workerSourcePins:{worker:b},images};
  const encode=value=>Buffer.from(JSON.stringify(value)),base64=raw=>raw.toString('base64');
  const originalImageArchiveReceipts={};for(const role of ['backend','frontend','inquiry']){const raw=encode(images[role].archiveGraph);images[role].archiveReceiptBytes=raw.length;images[role].archiveReceiptSha256=hash(raw);originalImageArchiveReceipts[role]=base64(raw);}
  const canonicalMetadata={...expected.checkpoint.source,localPath:'/original/point.sabrec'};
  const canonicalMetadataSha256=hash(Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(canonicalMetadata).sort().map(key=>[key,canonicalMetadata[key]])))));
  const transport={...expected.checkpoint.source,canonicalMetadata,canonicalMetadataSha256};
  const transportRaw=encode(transport);expected.checkpoint.metadataSha256=hash(transportRaw);expected.checkpoint.canonicalMetadataSha256=canonicalMetadataSha256;
  const database={name:'qa_application_restored_'+expected.remote.operation,systemIdentifier:'12345'};
  function closure(i){const id=String(i+1).repeat(64),scope={format:'sabalan-runtime-namespace/v1',scope:{runtimeId:id,image:images[i===2?'inquiry':'backend'].id,database,postgresApplicationName:'sabalan-rt-'+hash(id).slice(0,48)}},scopeRaw=encode(scope);
    const claim={scopeSha256:hash(scopeRaw),native:{scopeSha256:b,claimSha256:h}},claimRaw=encode(claim);
    return {originalPopenPid:100+i,originalReturncode:i===2?128:0,naturalExitZero:false,workScopeRawBase64:base64(scopeRaw),workClaimRawBase64:base64(claimRaw),
      workRawBase64:base64(encode({phase:'QUIESCENT',claimSha256:hash(claimRaw)})),nativeRawBase64:base64(encode({phase:'QUIESCENT',nativeReaped:true,databaseQuiet:true,sqliteNativeClosed:true,
        nativeStatus:i===2?143:0,stoppedBySignal:i===2,guardian:{pid:100+i},activeClaimSha256:h,onlineScope:{sha256:b,scope:scope.scope}}))};}
  const report={pass:true,phase:'COMPLETE',productionAdmission:false,retentionPublished:false,operation:expected.remote.operation,
    recoveryMode:'PROTECTED_MAINTENANCE_COMPLETE',continuousWalQualified:false,proofDatabase:{...database,oid:'123'},restoredDatabase:{...database,oid:'123'},
    configurationSha256:b,checkpointMetadataRawSha256:expected.checkpoint.metadataSha256,checkpointTransportRawBase64:base64(transportRaw),checkpointMetadata:canonicalMetadata,checkpointCanonicalMetadataSha256:canonicalMetadataSha256,sourceCheckpoint:expected.checkpoint.source,recoveryHost:expected.recoveryHost,controllerSourcePins:expected.controllerSourcePins,workerSourcePins:expected.workerSourcePins,
    applicationStageOrder:['backend','inquiry','frontend'],imageTransfers:[],applicationStages:'SEQUENTIAL_SAME_RESTORED_POINT',applicationHasRecoveryPrivateKeyMount:false,images,originalImageArchiveReceipts,
    applicationHealth:Object.fromEntries(Object.entries(images).map(([role,image])=>[role,{image:image.id,declaredSourceCommit:image.sourceCommit,status:200}])),
    postgresClosure:{normalExit:true,containerExitCode:0,originalAttachCode:0},finalSql:{sessions:0,prepared:0},inquiryReadOnlyData:{before:{sha256:h,size:1024},after:{sha256:h,size:1024}},
    originalDockerProcesses:[{pid:150,kind:'REQUIRED_ZERO',code:0,signal:null}],baseline:closure(0),backendClosure:{closed:closure(1)},inquiryClosure:{closure:closure(2)}};
  const canonicalRestore=encode({ok:true,drill:{checksum:expected.checkpoint.source.checksum}}),baseline=encode({format:'sabalan-application-restored-file-baseline/v1',capturedManifest:{sha256:hash(canonicalRestore)},sources:[]});
  report.canonicalRestoreOutputRawBase64=base64(canonicalRestore);report.restoredBaselineRawBase64=base64(baseline);report.baseline.result={manifestSha256:hash(baseline)};
  const namespaces=[0,1].map(i=>'sabalan-rt-'+hash(String(i+1).repeat(64)).slice(0,48));
  report.originalNamespaceSqlObservation={rawBase64:base64(encode({visible:true,database:report.proofDatabase,sessions:0,prepared:0,namespaces:namespaces.map(namespace=>({namespace,sessions:0}))})),originalPid:190,originalExitCode:0,originalSignal:null};
  function protocol(value=report,transfers=[]){const reportRaw=encode(value),launch=encode({format:'sabalan-original-independent-full-restore-launch/v1',pass:true,originalNodeReturncode:0,originalNodePid:1234,productionAdmission:false,retentionPublished:false,
    operation:expected.remote.operation,reportRawBase64:base64(reportRaw),reportSha256:hash(reportRaw),imageTransfers:value.imageTransfers,applicationStageOrder:value.applicationStageOrder});
    return encode({format:'sabalan-original-independent-ssh/v1',originalRemoteExitStatus:0,remoteControllerSha256:h,remoteConfigurationSha256:b,hostKeyBinding:'PINNED_PLINK_ENFORCED',enforcedHostKeySha256:h,originalPlinkPid:5678,originalPlinkReturncode:0,imageTransfers:transfers,applicationStageOrder:['backend','inquiry','frontend'],remoteStdoutBase64:base64(launch)});}
  const value=verifyOriginalIndependentSshProtocol(protocol(),expected);assert.equal(value.nativeClosures[2].nativeStatus,143);assert.equal(value.nativeClosures[2].stoppedBySignal,true);
  assert.equal(hash(Buffer.from(value.ownedReport.rawBase64,'base64')),value.ownedReport.sha256);assert.equal(value.ownedReport.bytes,encode(report).length);
  for(const row of value.nativeClosures)for(const output of Object.values(row.ownedOutputs)){const raw=Buffer.from(output.rawBase64,'base64');assert.equal(hash(raw),output.sha256);assert.equal(raw.length,output.bytes);}
  assert.throws(()=>readOriginalIndependentRestoreSshCompletion(value),/UNPROVEN/);
  for(const mutate of [v=>v.originalImageArchiveReceipts.inquiry=base64(Buffer.from('{}')),v=>v.originalNamespaceSqlObservation.originalExitCode=1,v=>v.restoredBaselineRawBase64=base64(Buffer.from('{}')),v=>v.checkpointMetadata.localPath='/changed',v=>v.checkpointCanonicalMetadataSha256=h,v=>v.sourceCheckpoint.releaseId='foreign',v=>v.applicationHasRecoveryPrivateKeyMount=true,v=>v.finalSql.sessions=1,v=>v.applicationHealth.frontend.status=503,
    v=>v.applicationStageOrder=['backend','frontend','inquiry'],v=>v.originalDockerProcesses[0].code=1,v=>v.inquiryClosure.closure.originalReturncode=0,
    v=>v.images.frontend.archiveReceiptBytes++,v=>v.images.backend.sourceImageId=v.images.backend.id,
    v=>v.images.inquiry.archiveGraph.rootfsDiffIds=['sha256:'+h],v=>v.recoveryMode='ONLINE_COHERENT_WAL',v=>v.proofDatabase.oid='foreign',
    v=>{const raw=JSON.parse(Buffer.from(v.baseline.workClaimRawBase64,'base64'));raw.scopeSha256=h;v.baseline.workClaimRawBase64=base64(encode(raw));}]){
    const changed=structuredClone(report);mutate(changed);assert.throws(()=>verifyOriginalIndependentSshProtocol(protocol(changed),expected));}
  // Data verification does not mint a token. Bind all three original transfers
  // and fsynced remote acknowledgments in the newly explicit stage order.
  expected.imageSources={};const sent=[];const stagedReport=structuredClone(report);
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
  for(const [sequence,role] of ['backend','inquiry','frontend'].entries()){
    const source={path:'D:/sabalanerp-online-qa/pinned/'+role+'.sabrec',targetPath:'/root/sabalan-recovery-private/native-qa/full-restore-'+expected.remote.operation+'/staged-ciphers/'+role+'.sabrec',bytes:100+sequence,sha256:h};
    expected.imageSources[role]=source;expected.images[role].transfer={cipherPath:source.targetPath,cipherBytes:source.bytes,cipherSha256:h,stagedFromOriginalSsh:true};
    const request={event:'IMAGE_TRANSFER_REQUEST',format:'sabalan-original-image-transfer/v1',operation:expected.remote.operation,role,sequence,path:source.targetPath,bytes:source.bytes,sha256:h};
    sent.push({role,bytes:source.bytes,sha256:h,requestSha256:hash(Buffer.from(JSON.stringify(canonical(request))+'\n')),originalSourceFdRetained:true});
    stagedReport.imageTransfers.push({event:'IMAGE_TRANSFER_STORED',operation:expected.remote.operation,role,sequence,proof:{role,path:source.targetPath,bytes:source.bytes,sha256:h,fsyncFileAndDirectory:true,fullReadbackVerified:true}});
  }
  verifyOriginalIndependentSshProtocol(protocol(stagedReport,sent),expected);
  for(const mutate of [v=>v.imageTransfers.pop(),v=>v.imageTransfers[1].proof.fsyncFileAndDirectory=false,v=>v.imageTransfers[2].role='inquiry',v=>v.imageTransfers[0].proof.sha256=b]){
    const changed=structuredClone(stagedReport);mutate(changed);assert.throws(()=>verifyOriginalIndependentSshProtocol(protocol(changed,sent),expected));}
  const changedSent=structuredClone(sent);changedSent[1].requestSha256=b;assert.throws(()=>verifyOriginalIndependentSshProtocol(protocol(stagedReport,changedSent),expected));
});

test('exact legacy backup-QA configs require retained encrypted source before existing-cache startup',()=>{
 const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
 const original=JSON.parse(JSON.parse(fs.readFileSync(path.join(repo,'reports/qa/independent-image-custody-65cb95d50af8415aa569267d7ecd99bf.json'))).stdout);
 // Closure data from an outer-failed operation never becomes admission.
 assert.equal(original.publicOnlineAdmission,false);
 for(const role of ['backend','frontend','inquiry']){
  const row=original.decryption.images[role],cipher=original.custody.images[role];
  const selected={id:row.verifiedRawArchive.config,sourceImageId:row.sourceImageId,archiveGraph:{archiveSha256:row.plaintextSha256,archiveBytes:row.plaintextBytes}};
  assert.throws(()=>requireLegacyBackupQaTransfer(role,selected),/REHYDRATION_REQUIRED/);
  selected.transfer={metadataPath:original.custody.root+'/private-component.json',metadataSha256:original.custody.metadataSha256,cipherPath:original.custody.root+'/'+role+'.sabrec',cipherBytes:cipher.cipherBytes,cipherSha256:cipher.cipherSha256,verifyRetainedSourceBeforeReuse:true};
  assert.equal(requireLegacyBackupQaTransfer(role,selected),true);
  for(const mutate of [v=>v.transfer.verifyRetainedSourceBeforeReuse=false,v=>v.transfer.cipherSha256='0'.repeat(64),v=>v.transfer.metadataPath='/root/raw.json',v=>v.archiveGraph.archiveSha256=v.sourceImageId.slice(7),v=>v.transfer.stagedFromOriginalSsh=true]){
   const changed=structuredClone(selected);mutate(changed);assert.throws(()=>requireLegacyBackupQaTransfer(role,changed));}
 }
});

test('namespace SQL observation uses full visibility and exact original work namespaces on restored DB only',()=>{
 const database='qa_application_restored_'+'a'.repeat(32),namespaces=['sabalan-rt-'+'b'.repeat(48),'sabalan-rt-'+'c'.repeat(48)];
 const sql=independentNamespaceObservationQuery(database,namespaces);assert.ok(sql.includes("current_setting('is_superuser')"));assert.ok(sql.includes('pg_read_all_stats'));assert.ok(sql.includes('pg_prepared_xacts'));assert.ok(sql.includes("application_name=names.namespace"));
 for(const changed of [[],[namespaces[0],namespaces[0]],["foreign' OR true --"]])assert.throws(()=>independentNamespaceObservationQuery(database,changed));
 assert.throws(()=>independentNamespaceObservationQuery('postgres',namespaces));
});
