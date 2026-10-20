import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {enforceFilesystemRemoteRetention,readLocalCheckpointRetentionHolds,FilesystemRemoteCheckpointStore} from '../deploymentCheckpointStorage';
import {withHealthyDrill} from './deploymentCheckpointDrill.fixture';
import {parseBackupRetentionRequest,canonicalRetentionBytes,retentionSha256,verifyHostBackupRetentionReceipt} from '../deploymentBackupRetention';
const request={format:'sabalan-restricted-backup-retention-request/v1',deploymentId:'deploy-original',requestId:'a'.repeat(64),protectedCheckpointIds:['backup-held']};
test('fixed retention request cannot choose repository, command, duplicate holds or caller lock',()=>{
 assert.deepEqual(parseBackupRetentionRequest(canonicalRetentionBytes(request)),request);
 for(const row of [{...request,root:'/other'},{...request,command:'rm'},{...request,protectedCheckpointIds:['same','same']},{...request,requestId:'invalid'}])assert.throws(()=>parseBackupRetentionRequest(canonicalRetentionBytes(row)));
});
test('host receipt binds closed original SSH, request, stage and retained source bytes',()=>{
 const response={format:'sabalan-original-backup-retention-result/v1',requestSha256:retentionSha256(canonicalRetentionBytes(request)),requestId:request.requestId,deploymentId:request.deploymentId,storageRoot:'/srv/sabalanerp-recovery/checkpoints',originalPid:44,originalStorageLock:{device:'1',inode:'2',ownerUid:0,descriptor:9},retainedPoints:[]};
 const responseRaw=Buffer.concat([canonicalRetentionBytes(response),Buffer.from('\n')]);const receipt={format:'sabalan-original-host-backup-retention/v1',deploymentId:request.deploymentId,stage:'BEFORE_CHECKPOINT',request,originalSsh:{pid:20,code:0,signal:null},originalHostOwner:{pid:21,code:0,signal:null},originalPipesClosed:true,responseRawBase64:responseRaw.toString('base64'),responseSha256:retentionSha256(responseRaw)};
 const verify=(row:any,stage:any='BEFORE_CHECKPOINT')=>{const raw=canonicalRetentionBytes(row);return verifyHostBackupRetentionReceipt(raw,{sha256:retentionSha256(raw),deploymentId:request.deploymentId,stage});};assert.equal(verify(receipt).response.requestId,request.requestId);
 for(const row of [{...receipt,originalHostOwner:{pid:20,code:0,signal:null}},{...receipt,originalHostOwner:{pid:21,code:1,signal:null}},{...receipt,originalPipesClosed:false},{...receipt,originalSsh:{pid:20,code:1,signal:null}},{...receipt,responseSha256:'0'.repeat(64)}])assert.throws(()=>verify(row));assert.throws(()=>verify(receipt,'AFTER_CHECKPOINT'));
});
test('production inspect never deletes; backup owner path normalizes actual archive root and respects additional local holds',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'owned-remote-retention-'));
 try{for(let i=1;i<=3;i++){const content=Buffer.from('checkpoint-'+i),file=path.join(root,'point-'+i+'.sabrec');await fs.writeFile(file,content);const point=withHealthyDrill({id:'point-'+i,releaseId:'release-'+i,remotePath:'/production-mount/point-'+i+'.sabrec',archivePath:file,size:content.length,checksum:retentionSha256(content),createdAt:'2026-10-0'+i+'T00:00:00Z',remoteVerified:true});await fs.writeFile(file+'.json',JSON.stringify(point));}
  const inspected=await enforceFilesystemRemoteRetention(root,'deploy-original',undefined,{mode:'inspect'});assert.deepEqual(inspected.plan.deleteIds,['point-1']);assert.equal((await fs.readdir(root)).length,6);
  const protectedResult=await enforceFilesystemRemoteRetention(root,'deploy-original',undefined,{protectedCheckpointIds:['point-1']});assert.deepEqual(protectedResult.plan.deleteIds,[]);
  await enforceFilesystemRemoteRetention(root,'deploy-original');await assert.rejects(fs.stat(path.join(root,'point-1.sabrec')));assert.ok(await fs.stat(path.join(root,'point-3.sabrec')));
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('unknown local metadata refuses hold export and stale uploading bytes are not age-deleted',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'protected-incomplete-'));
 try{const incomplete=path.join(root,'active.uploading');await fs.writeFile(incomplete,'owned');await fs.utimes(incomplete,new Date(0),new Date(0));await new FilesystemRemoteCheckpointStore(root).assertAvailable(0);assert.equal(await fs.readFile(incomplete,'utf8'),'owned');await fs.writeFile(path.join(root,'unknown.sabrec.json'),'not-json');await assert.rejects(readLocalCheckpointRetentionHolds(root));}finally{await fs.rm(root,{recursive:true,force:true});}
});
