'use strict';
// Canonical COMPLETE restore -> genuine versioned baseline. Private QA only.
// This is deliberately a different producer from the v3 coherent-cut worker:
// its capturedManifest is the original canonical restore owner's output.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const {spawnSync} = require('node:child_process');
const hash = raw => createHash('sha256').update(raw).digest('hex');
// Windows lstat reports dev=0 while fstat reports a volume serial. This pure
// inventory is exercised there; the authority-producing main below is Linux
// only and retains the complete device identity check.
const pin = value => ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink'].map(key=>String(key==='dev'&&process.platform==='win32'?0:value[key])).join(':');
function inventory(root,includeDirectories=false) {
  assert.equal(fs.realpathSync(root),root);
  const rows=[],directories=[];
  const mount=fd=>process.platform==='linux'?fs.readFileSync('/proc/self/fdinfo/'+fd,'utf8').match(/^mnt_id:\s+(\d+)$/m)?.[1]:'windows-source-only';
  let rootMount='windows-source-only';
  if(process.platform==='linux'){const rootFd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
    try{rootMount=mount(rootFd);assert.ok(rootMount);}finally{fs.closeSync(rootFd);}}
  function walk(directory,prefix='') {
    const before=fs.lstatSync(directory,{bigint:true});
    assert.ok(before.isDirectory()&&!before.isSymbolicLink());
    if(process.platform==='linux'){const directoryFd=fs.openSync(directory,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
      try{assert.equal(mount(directoryFd),rootMount);}finally{fs.closeSync(directoryFd);}}
    for(const name of fs.readdirSync(directory).sort()) {
      const file=path.join(directory,name), value=fs.lstatSync(file,{bigint:true});
      assert.ok(!value.isSymbolicLink()&&value.dev===before.dev);
      if(value.isDirectory()){directories.push(prefix+name);assert.ok(directories.length<10000);walk(file,prefix+name+'/');}
      else {
        assert.ok(value.isFile()&&value.nlink===1n&&value.size<=2n*1024n**3n);
        const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
        try {
          assert.equal(mount(fd),rootMount);
          const digest=createHash('sha256'),buffer=Buffer.alloc(262144);let bytes=0;
          for(;;){const n=fs.readSync(fd,buffer,0,buffer.length,null);if(!n)break;bytes+=n;assert.ok(BigInt(bytes)<=value.size);digest.update(buffer.subarray(0,n));}
          assert.equal(BigInt(bytes),value.size);
          assert.equal(pin(fs.fstatSync(fd,{bigint:true})),pin(value));assert.equal(pin(fs.lstatSync(file,{bigint:true})),pin(value));
          rows.push({key:prefix+name,bytes,sha256:digest.digest('hex')});assert.ok(rows.length<=10000);
        } finally {fs.closeSync(fd);}
      }
    }
    assert.equal(pin(fs.lstatSync(directory,{bigint:true})),pin(before));
  }
  walk(root);rows.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);directories.sort();return includeDirectories?{files:rows,directories}:rows;
}
function write(file,value) {
  const raw=Buffer.from(JSON.stringify(value)+'\n');
  const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);
  try{fs.fchmodSync(fd,0o400);fs.writeFileSync(fd,raw);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const parent=fs.openSync(path.dirname(file),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}return raw;
}
async function main(){
  assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);process.umask(0o077);
  assert.equal(process.argv.length,4);assert.match(process.argv[3],/^[a-f0-9]{64}$/);
  const inputRaw=fs.readFileSync(process.argv[2]);assert.equal(hash(inputRaw),process.argv[3]);
  const input=JSON.parse(inputRaw),cwd=fs.realpathSync(process.cwd());
  assert.equal(input.format,'sabalan-independent-restored-baseline-input/v1');assert.equal(input.qualificationRoot,cwd);
  assert.match(input.captureId,/^[a-f0-9]{64}$/);assert.equal(input.roots.length,9);
  const restoreRaw=fs.readFileSync(input.originalRestoreOutput.path);assert.equal(hash(restoreRaw),input.originalRestoreOutput.sha256);
  const restore=JSON.parse(restoreRaw);
  if(input.captureSource==='independent-physical-v3'){
    assert.equal(restore.format,'sabalan-original-independent-physical-replay/v1');assert.equal(restore.productionAdmission,false);assert.equal(restore.physicalReplayQualified,true);
    assert.equal(restore.captureId,input.captureId);assert.equal(restore.sealedManifestSha256,input.checkpointSha256);assert.equal(restore.restoredFileRoots,9);
    assert.equal(restore.actualReplay.inRecovery,false);assert.equal(restore.actualReplay.systemIdentifier,input.database.systemIdentifier);
    assert.equal(restore.layout.coordinationHistory.archivalOnly,true);assert.equal(restore.layout.coordinationHistory.runtimeAdmission,false);
  }else{
  assert.equal(restore.ok,true);
  assert.equal(restore.drill.format,'sabalan-independent-checkpoint-drill/v1');assert.equal(restore.drill.status,'HEALTHY');
  assert.equal(restore.drill.packageType,'COMPLETE');
  for(const key of ['stagedPostgresRestore','stagedSqliteIntegrity','verifiedFiles','verifiedApplicationPayloads','verifiedBusinessData'])assert.equal(restore.drill[key],true);
  assert.equal(restore.drill.checksum,input.checkpointSha256);
  assert.notEqual(restore.drill.sourceMachineUuidSha256,restore.drill.recoveryMachineUuidSha256);
  assert.notEqual(restore.drill.sourceKernelBootIdSha256,restore.drill.recoveryKernelBootIdSha256);
  }
  const required=[...new Set([
    ...require('/app/dist/services/hrPersonnelErasureGraph.js').HR_PERSONNEL_ERASURE_STORAGE_ROOTS,
    ...require('/app/dist/services/documentPdfFileRuntime.js').DOCUMENT_PDF_RETAINED_ROOTS,
    require('/app/dist/services/dispatchFileRuntime.js').DISPATCH_DOCUMENT_STORAGE_ROOT,
    require('/app/dist/services/performanceFileRuntime.js').performanceExportStorageDirectory(),
    require('/app/dist/services/supportFileRuntime.js').supportTicketStorageDirectory(),
  ])].sort();
  assert.deepEqual(input.roots.map(row=>row.live).sort(),required);
  const {loadOnlineRuntimeScope}=require('/app/dist/services/onlineRuntimeScope.js');const issued=loadOnlineRuntimeScope();
  assert.ok(issued);assert.equal(issued.scope.purpose,'jobs');assert.equal(issued.scope.role,'control');
  assert.equal(issued.scope.database.name,input.database.name);assert.equal(issued.scope.database.systemIdentifier,input.database.systemIdentifier);
  const {createScopedRuntimeWork}=require('/app/dist/services/onlineRuntimeWork.js');
  const {VersionedFilePublication}=require('/app/dist/services/versionedFilePublication.js');
  const {prisma,disconnectDatabase}=require('/app/dist/lib/prisma.js');
  const boundary=await createScopedRuntimeWork({registrySha256:issued.scope.manifestSha256,generation:1,canJoin:()=>true});
  const roots=[];let gate;
  try {
    await boundary.runBackground(async()=>{
      const [actual]=await prisma.$queryRawUnsafe("SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS \"systemIdentifier\",(SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS sessions,(SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared");
      assert.deepEqual(actual,{...input.database,sessions:0,prepared:0});
      for(const root of input.roots){
        for(const directory of [root.live,root.store]){assert.equal(fs.realpathSync(directory),directory);assert.ok(directory.startsWith(cwd+'/'));const s=fs.lstatSync(directory);assert.ok(s.isDirectory()&&s.uid===0&&!(s.mode&0o077));}
        assert.deepEqual(fs.readdirSync(root.store),[]);
        const snapshot=inventory(root.live,true);const publication=await VersionedFilePublication.open(root.store,root.live,boundary.context);
        roots.push({root,...snapshot,publication});
      }
    });
    await disconnectDatabase();await boundary.stopAndDrain(5000);
    gate=fs.openSync(issued.scope.gate.file,fs.constants.O_RDWR|fs.constants.O_NOFOLLOW);
    const descriptors=Array(21).fill('ignore');descriptors[20]=gate;
    assert.equal(spawnSync('/usr/bin/flock',['--exclusive','--nonblock','20'],{stdio:descriptors}).status,0);
    const proofs=[];
    for(const {root,files,directories,publication} of roots){assert.deepEqual(inventory(root.live,true),{files,directories});const proof=await publication.adoptLegacy(input.captureId,gate);assert.deepEqual(inventory(root.live,true),{files,directories});proofs.push({name:root.name,...proof});}
    const manifest={format:'sabalan-application-restored-file-baseline/v1',captureSource:input.captureSource==='independent-physical-v3'?'independent-physical-v3':'canonical-complete-package',captureId:input.captureId,
      capturedManifest:input.originalRestoreOutput,sources:roots.map(({root,files,directories})=>({name:root.name,liveRoot:root.live,storeRoot:root.store,files,directories}))};
    const raw=write(input.outputManifest,manifest);
    const completion={event:'restored-file-baseline-complete',runtimeId:issued.scope.runtimeId,captureId:input.captureId,manifestSha256:hash(raw),capturedManifestSha256:input.originalRestoreOutput.sha256,proofs,productionAdmission:false};
    write(input.outputManifest+'.completed.json',completion);console.log(JSON.stringify(completion));
  } finally {if(gate!==undefined)fs.closeSync(gate);await disconnectDatabase();await boundary.stopAndDrain(5000);}
}
module.exports={inventory};
if(require.main===module)main().catch(()=>{console.error('INDEPENDENT_RESTORED_BASELINE_FAILED');process.exitCode=1;});
