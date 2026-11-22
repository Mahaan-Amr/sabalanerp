import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {canonicalRetentionBytes,retentionSha256,verifyHostBackupRetentionReceipt,assertOriginalBackupStorageLock,assertBackupStorageLockFileIdentity} from '../deploymentBackupRetention';
import {enforceFilesystemRemoteRetention,readLocalCheckpointRetentionHolds} from '../deploymentCheckpointStorage';
import {withHealthyDrill} from './deploymentCheckpointDrill.fixture';

// These are data-parser and isolated filesystem tests, not SSH/kernel-lock
// acceptance. No successful parsed receipt can mint an original owner token.
function receipt(){
 const request={format:'sabalan-restricted-backup-retention-request/v1',deploymentId:'deploy-immutable',requestId:'a'.repeat(64),protectedCheckpointIds:['point-1']};
 const response={format:'sabalan-original-backup-retention-result/v1',requestSha256:retentionSha256(canonicalRetentionBytes(request)),requestId:request.requestId,deploymentId:request.deploymentId,storageRoot:'/srv/sabalanerp-recovery/checkpoints',originalPid:44,originalStorageLock:{device:'1',inode:'2',ownerUid:0,descriptor:9},retainedPoints:[]};
 const raw=Buffer.concat([canonicalRetentionBytes(response),Buffer.from('\n')]);
 return {format:'sabalan-original-host-backup-retention/v1',deploymentId:request.deploymentId,stage:'BEFORE_CHECKPOINT',request,originalSsh:{pid:22,code:0,signal:null},originalHostOwner:{pid:23,code:0,signal:null},originalPipesClosed:true,responseRawBase64:raw.toString('base64'),responseSha256:retentionSha256(raw)};
}
const verify=(value:any,stage:'BEFORE_CHECKPOINT'|'AFTER_CHECKPOINT'='BEFORE_CHECKPOINT')=>{const raw=canonicalRetentionBytes(value);return verifyHostBackupRetentionReceipt(raw,{sha256:retentionSha256(raw),deploymentId:'deploy-immutable',stage});};

test('existing root-owned readable mutex stays valid without chmod; write access, aliases and identity drift refuse',()=>{
 const original=()=>({dev:29n,ino:6n,uid:0n,gid:0n,mode:0o100644n,nlink:1n,size:0n,mtimeNs:10n,ctimeNs:20n,isFile:()=>true});
 for(const mode of [0o100600n,0o100644n])assert.doesNotThrow(()=>assertBackupStorageLockFileIdentity({...original(),mode},{...original(),mode}));
 for(const change of [{mode:0o100664n},{mode:0o100646n},{uid:997n},{nlink:2n},{isFile:()=>false}]){
  assert.throws(()=>assertBackupStorageLockFileIdentity({...original(),...change},original()));
  assert.throws(()=>assertBackupStorageLockFileIdentity(original(),{...original(),...change}));
 }
 for(const change of [{dev:30n},{ino:7n},{gid:997n},{mode:0o100600n},{size:1n},{mtimeNs:11n},{ctimeNs:21n}])assert.throws(()=>assertBackupStorageLockFileIdentity(original(),{...original(),...change}));
});

test('closed guardian and exact protected-ID request cannot be replaced by cross-stage or partial SSH custody',()=>{
 const original=receipt();assert.equal(verify(original).request.protectedCheckpointIds[0],'point-1');
 assert.throws(()=>verify(original,'AFTER_CHECKPOINT'));
 for(const change of [
  (value:any)=>{value.request.protectedCheckpointIds=['point-2'];},
  (value:any)=>{value.originalSsh.signal='SIGTERM';},
  (value:any)=>{value.originalHostOwner.pid=value.originalSsh.pid;},
  (value:any)=>{value.originalHostOwner.code=1;},
  (value:any)=>{value.originalPipesClosed=false;},
 ]){const changed=structuredClone(original);change(changed);assert.throws(()=>verify(changed));}
});

test('production inspect does not mutate actual bytes; a newly recorded local hold protects the old point',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'retention-refusal-')),remote=path.join(root,'remote'),local=path.join(root,'local');
 await fs.mkdir(remote);await fs.mkdir(local);
 const snapshot=async()=>{
  const entries=await fs.readdir(remote);
  const hashes=await Promise.all(entries.sort().map(async name=>[name,retentionSha256(await fs.readFile(path.join(remote,name)))]));
  return Object.fromEntries(hashes);
 };
 try{
  for(let i=1;i<=3;i++){
   const raw=Buffer.from('actual-file-'+i),file=path.join(remote,'point-'+i+'.sabrec');await fs.writeFile(file,raw);
   const metadata=withHealthyDrill({id:'point-'+i,releaseId:'release-'+i,archivePath:file,remotePath:'/original-mount/point-'+i+'.sabrec',size:raw.length,checksum:retentionSha256(raw),createdAt:'2026-10-0'+i+'T00:00:00Z',remoteVerified:true});
   await fs.writeFile(file+'.json',JSON.stringify(metadata));
  }
  const before=await snapshot(),exported=await readLocalCheckpointRetentionHolds(local);assert.deepEqual(exported,[]);
  const inspected=await enforceFilesystemRemoteRetention(remote,'deploy-immutable',local,{mode:'inspect',protectedCheckpointIds:exported});
  assert.deepEqual(inspected.plan.deleteIds,['point-1']);assert.deepEqual(await snapshot(),before);
  // A hold added after the earlier export is genuine later local metadata,
  // not a timer/lease expiry or fabricated permission to delete the old copy.
  await fs.writeFile(path.join(local,'held.sabrec.json'),JSON.stringify({id:'point-1',active:true}));
  const guarded=await enforceFilesystemRemoteRetention(remote,'deploy-immutable',local,{protectedCheckpointIds:exported});
  assert.deepEqual(guarded.plan.deleteIds,[]);assert.deepEqual(await snapshot(),before);
 }finally{assert.equal(path.dirname(root),path.resolve(os.tmpdir()));await fs.rm(root,{recursive:true,force:true});}
});

test('Windows cannot confer the actual Linux backup kernel-lock authority',{skip:process.platform!=='win32'},()=>{
 assert.throws(()=>assertOriginalBackupStorageLock());
});
