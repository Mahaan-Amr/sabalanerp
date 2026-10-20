import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
export const BACKUP_CHECKPOINT_ROOT='/srv/sabalanerp-recovery/checkpoints';
export const BACKUP_STORAGE_LOCK='/run/lock/sabalan-backup-storage.lock';
export const canonicalRetentionBytes=(value:any):Buffer=>Buffer.from(JSON.stringify(canonical(value)));
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const retentionSha256=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
export type BackupRetentionRequest={format:'sabalan-restricted-backup-retention-request/v1';deploymentId:string;requestId:string;protectedCheckpointIds:string[]};
export function parseBackupRetentionRequest(raw:Buffer):BackupRetentionRequest{
 assert.ok(raw.length>0&&raw.length<=1024*1024);const value=JSON.parse(raw.toString());
 assert.deepEqual(Object.keys(value).sort(),['format','deploymentId','requestId','protectedCheckpointIds'].sort());assert.equal(value.format,'sabalan-restricted-backup-retention-request/v1');
 assert.match(value.deploymentId,/^[a-zA-Z0-9_-]{8,160}$/);assert.match(value.requestId,/^[a-f0-9]{64}$/);assert.ok(Array.isArray(value.protectedCheckpointIds)&&value.protectedCheckpointIds.length<=4096);
 assert.ok(value.protectedCheckpointIds.every((id:unknown)=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,160}$/.test(id)));assert.equal(new Set(value.protectedCheckpointIds).size,value.protectedCheckpointIds.length);return value;
}
/** The SAME inherited backup owner OFD excludes restore, promotion and retention. */
export function assertOriginalBackupStorageLock(){
 assert.equal(process.platform,'linux');assert.equal(process.getuid?.(),0);assert.equal(fs.realpathSync(BACKUP_STORAGE_LOCK),BACKUP_STORAGE_LOCK);
 const named=fs.lstatSync(BACKUP_STORAGE_LOCK,{bigint:true}),owned=fs.fstatSync(9,{bigint:true});
 assert.ok(named.isFile()&&owned.isFile()&&named.dev===owned.dev&&named.ino===owned.ino&&owned.uid===0n&&owned.nlink===1n&&(owned.mode&0o077n)===0n);
 const locks=[...fs.readFileSync('/proc/self/fdinfo/9','utf8').matchAll(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:(\d+)\s+0\s+EOF\s*$/gm)];assert.ok(locks.some(row=>row[1]===String(owned.ino)));
 return {device:String(owned.dev),inode:String(owned.ino),ownerUid:0,descriptor:9};
}
export function verifyHostBackupRetentionReceipt(raw:Buffer,expected:{sha256:string;deploymentId:string;stage:'BEFORE_CHECKPOINT'|'AFTER_CHECKPOINT'}){
 assert.ok(raw.length>0&&raw.length<=8*1024*1024);assert.equal(retentionSha256(raw),expected.sha256);const receipt=JSON.parse(raw.toString());
 assert.equal(receipt.format,'sabalan-original-host-backup-retention/v1');assert.equal(receipt.deploymentId,expected.deploymentId);assert.equal(receipt.stage,expected.stage);assert.equal(receipt.originalPipesClosed,true);
 assert.ok(Number.isSafeInteger(receipt.originalHostOwner?.pid)&&receipt.originalHostOwner.pid>0&&receipt.originalHostOwner.pid!==receipt.originalSsh?.pid);assert.equal(receipt.originalHostOwner.code,0);assert.equal(receipt.originalHostOwner.signal,null);
 assert.ok(Number.isSafeInteger(receipt.originalSsh?.pid)&&receipt.originalSsh.pid>0);assert.equal(receipt.originalSsh.code,0);assert.equal(receipt.originalSsh.signal,null);
 const request=parseBackupRetentionRequest(canonicalRetentionBytes(receipt.request));assert.equal(request.deploymentId,expected.deploymentId);
 const responseRaw=Buffer.from(receipt.responseRawBase64,'base64');assert.equal(responseRaw.toString('base64'),receipt.responseRawBase64);assert.equal(retentionSha256(responseRaw),receipt.responseSha256);
 const response=JSON.parse(responseRaw.toString());assert.equal(response.format,'sabalan-original-backup-retention-result/v1');assert.equal(response.requestId,request.requestId);assert.equal(response.deploymentId,request.deploymentId);
 assert.equal(response.requestSha256,retentionSha256(canonicalRetentionBytes(request)));assert.equal(response.storageRoot,BACKUP_CHECKPOINT_ROOT);assert.ok(Number.isSafeInteger(response.originalPid)&&response.originalPid>0);
 assert.equal(response.originalStorageLock?.ownerUid,0);assert.equal(response.originalStorageLock?.descriptor,9);for(const key of ['device','inode'])assert.match(response.originalStorageLock[key],/^[1-9][0-9]*$/);
 assert.ok(Array.isArray(response.retainedPoints)&&response.retainedPoints.length<=2);return {request,response};
}
