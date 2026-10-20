import assert from 'node:assert/strict';
import fs from 'node:fs';
import {enforceFilesystemRemoteRetention} from '../services/deploymentCheckpointStorage';
import {assertOriginalBackupStorageLock,BACKUP_CHECKPOINT_ROOT,canonicalRetentionBytes,parseBackupRetentionRequest,retentionSha256} from '../services/deploymentBackupRetention';
async function main(){
 assert.equal(process.argv.length,2);const lock=assertOriginalBackupStorageLock();let total=0;const chunks:Buffer[]=[];
 for await(const chunk of process.stdin){total+=chunk.length;assert.ok(total<=1024*1024);chunks.push(Buffer.from(chunk));}
 const request=parseBackupRetentionRequest(Buffer.concat(chunks));assert.equal(await fs.promises.realpath(BACKUP_CHECKPOINT_ROOT),BACKUP_CHECKPOINT_ROOT);
 assertOriginalBackupStorageLock();const result=await enforceFilesystemRemoteRetention(BACKUP_CHECKPOINT_ROOT,request.deploymentId,undefined,{protectedCheckpointIds:request.protectedCheckpointIds});assertOriginalBackupStorageLock();
 const response={format:'sabalan-original-backup-retention-result/v1',requestSha256:retentionSha256(canonicalRetentionBytes(request)),requestId:request.requestId,deploymentId:request.deploymentId,storageRoot:BACKUP_CHECKPOINT_ROOT,originalPid:process.pid,originalStorageLock:lock,
  plan:result.plan,audit:result.audit,retainedPoints:result.retainedPoints.map(row=>({id:row.id,checksum:row.checksum,size:row.size,metadataSha256:row.metadataSha256}))};
 const raw=canonicalRetentionBytes(response);assert.ok(raw.length<=4*1024*1024);process.stdout.write(Buffer.concat([raw,Buffer.from('\n')]));
}
main().catch(()=>{process.stderr.write('ORIGINAL_BACKUP_RETENTION_FAILED\n');process.exitCode=1;});
