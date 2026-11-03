'use strict';
// Fixed diagnostic adapter. Deployed bundle bytes are read, never rewritten.
const fs=require('node:fs'),assert=require('node:assert/strict'),crypto=require('node:crypto'),vm=require('node:vm');
const file='/opt/sabalanerp-recovery/deploy/scripts/backup-checkpoint-retention.cjs';
const expected='ed3fcca37a3b5a15cfcb0cbc1b9719293f57b3e56a50cc33cc9ded60a05eae8b';
const digest=b=>crypto.createHash('sha256').update(b).digest('hex');
assert.equal(fs.realpathSync(file),file);const before=fs.lstatSync(file,{bigint:true});
assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.uid===0n&&!(before.mode&0o022n)&&before.nlink===1n);
const raw=fs.readFileSync(file);assert.equal(digest(raw),expected);
const source=raw.toString('utf8').replaceAll('\r\n','\n');
const terminal='main().catch(() => {\n  process.stderr.write("ORIGINAL_BACKUP_RETENTION_FAILED\\n");\n  process.exitCode = 1;\n});\n';
assert.equal(source.split(terminal).length,2);assert.ok(source.endsWith(terminal));
const body=source.slice(0,-terminal.length)+String.raw`
return (async()=>{
 diagnostic.phase='ORIGINAL_STORAGE_LOCK';
 const originalStorageLock=assertOriginalBackupStorageLock();
 diagnostic.phase='CANONICAL_ROOT_BEFORE';
 import_strict2.default.equal(await import_node_fs4.default.promises.realpath(BACKUP_CHECKPOINT_ROOT),BACKUP_CHECKPOINT_ROOT);
 const rootBefore=await import_node_fs4.default.promises.lstat(BACKUP_CHECKPOINT_ROOT,{bigint:true});
 const accounts=import_node_fs4.default.readFileSync('/etc/passwd','utf8').split('\n').filter(row=>row.startsWith('sabalan-backup:'));
 import_strict2.default.equal(accounts.length,1);const fields=accounts[0].split(':');
 import_strict2.default.ok(/^[1-9][0-9]*$/.test(fields[2])&&/^[1-9][0-9]*$/.test(fields[3]));
 import_strict2.default.equal(fields[5],'/var/lib/sabalan-backup');
 const groups=import_node_fs4.default.readFileSync('/etc/group','utf8').split('\n').filter(row=>row.startsWith('sabalan-backup:'));
 import_strict2.default.equal(groups.length,1);const group=groups[0].split(':');
 import_strict2.default.ok(/^[1-9][0-9]*$/.test(group[2]));import_strict2.default.equal(group[2],fields[3]);
 import_strict2.default.ok(rootBefore.isDirectory()&&!rootBefore.isSymbolicLink()&&rootBefore.uid===BigInt(fields[2])&&rootBefore.gid===BigInt(fields[3])&&(rootBefore.mode&0o777n)===0o700n);
 diagnostic.phase='CANONICAL_RETENTION_INSPECT';
 const result=await enforceFilesystemRemoteRetention(BACKUP_CHECKPOINT_ROOT,'qa-419-inspection-only',undefined,{mode:'inspect',protectedCheckpointIds:[]});
 diagnostic.phase='CANONICAL_ROOT_AFTER';
 import_strict2.default.equal(await import_node_fs4.default.promises.realpath(BACKUP_CHECKPOINT_ROOT),BACKUP_CHECKPOINT_ROOT);
 const rootAfter=await import_node_fs4.default.promises.lstat(BACKUP_CHECKPOINT_ROOT,{bigint:true});
 for(const key of ['dev','ino','mode','uid','gid'])import_strict2.default.equal(rootAfter[key],rootBefore[key]);
 const afterLock=assertOriginalBackupStorageLock();
 import_strict2.default.deepEqual(afterLock,originalStorageLock);
 return {format:'sabalan-419-backup-retention-inspection/v1',originalStorageLock,
  plan:result.plan,retainedPoints:result.retainedPoints,protectionEvidence:result.protectionEvidence,
  audit:result.audit,mode:'inspect',currentProductionLocalHoldsJoined:false,
  deletionEligibilityAccepted:false,cleanupPerformed:false,fullAccepted:false};
})();
`;
const allowed=new Set(['node:assert/strict','node:fs','node:path','node:crypto']);
const restrictedRequire=name=>{assert.ok(allowed.has(name));return require(name);};
const diagnostic={phase:'PINNED_BUNDLE_COMPILE'};
vm.compileFunction(body,['require','process','Buffer','diagnostic'],{filename:'fixed-419-retention-inspect-adapter'})(restrictedRequire,process,Buffer,diagnostic).then(result=>{
 const after=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mode','nlink','mtimeNs','ctimeNs'])assert.equal(after[key],before[key]);
 assert.equal(digest(fs.readFileSync(file)),expected);assert.deepEqual(result.audit,[]);
 const space=fs.statfsSync('/srv/sabalanerp-recovery',{bigint:true});
 console.log(JSON.stringify({...result,bundleSha256:expected,deployedBundleUnchanged:true,availableBytes:String(space.bavail*space.bsize)}));
}).catch(error=>{const code=/^[A-Z][A-Z0-9_]{0,99}$/.test(error.code??'')?error.code:/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message??'')?error.message:error.name;console.error(JSON.stringify({code,phase:diagnostic.phase,inspectionRefused:true}));process.exitCode=1;});
