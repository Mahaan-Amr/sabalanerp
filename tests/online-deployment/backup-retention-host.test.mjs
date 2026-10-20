import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateOriginalBackupRetentionResponse,readOriginalBackupRetentionSettings} from '../../deploy/scripts/backup-retention-host.mjs';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const bytes=value=>Buffer.from(JSON.stringify(canonical(value)));
const request={format:'sabalan-restricted-backup-retention-request/v1',deploymentId:'deployment_example',requestId:'a'.repeat(64),protectedCheckpointIds:['held_point']};
const response=()=>({format:'sabalan-original-backup-retention-result/v1',requestSha256:createHash('sha256').update(bytes(request)).digest('hex'),requestId:request.requestId,deploymentId:request.deploymentId,storageRoot:'/srv/sabalanerp-recovery/checkpoints',originalPid:123,originalStorageLock:{device:'29',inode:'6',ownerUid:0,descriptor:9},plan:{deleteIds:[]},audit:[],retainedPoints:[]});
const wire=value=>Buffer.concat([bytes(value),Buffer.from('\n')]);
test('host parser accepts exact original request binding without granting authority from parsed data',()=>{
 const value=response();assert.deepEqual(validateOriginalBackupRetentionResponse(request,wire(value)),value);
});
test('foreign request, root, lock descriptor, malformed retained points and trailing bytes refuse',()=>{
 for(const change of [value=>{value.requestId='b'.repeat(64);},value=>{value.requestSha256='c'.repeat(64);},value=>{value.storageRoot='/tmp/another';},value=>{value.originalStorageLock.descriptor=10;},value=>{value.originalStorageLock.ownerUid=997;},value=>{value.retainedPoints=[{id:'../escape',checksum:'d'.repeat(64),metadataSha256:'e'.repeat(64),size:1}];}]){
  const value=response();change(value);assert.throws(()=>validateOriginalBackupRetentionResponse(request,wire(value)));
 }
 assert.throws(()=>validateOriginalBackupRetentionResponse(request,Buffer.concat([wire(response()),Buffer.from('\n')])));
});

test('premaintenance configuration requires separate transfer and restricted operations identities',()=>{
 const settings={DEPLOYMENT_BACKUP_HOST:'backup.example.com',DEPLOYMENT_BACKUP_OPERATIONS_USER:'sabalan-backup-ops',DEPLOYMENT_BACKUP_SSH_KEY_FILE:'/root/.ssh/transfer',DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE:'/root/.ssh/operations',DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE:'/root/.ssh/known-hosts'};
 const encode=value=>Buffer.from(Object.entries(value).map(([name,value])=>name+'='+value).join('\n'));
 const parsed=readOriginalBackupRetentionSettings(encode(settings));assert.equal(parsed.key,settings.DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE);assert.equal(parsed.transferKey,settings.DEPLOYMENT_BACKUP_SSH_KEY_FILE);
 for(const change of [value=>{delete value.DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE;},value=>{value.DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE=value.DEPLOYMENT_BACKUP_SSH_KEY_FILE;},value=>{value.DEPLOYMENT_BACKUP_OPERATIONS_USER='root';},value=>{value.DEPLOYMENT_BACKUP_HOST='-oProxyCommand=other';},value=>{value.DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE='/root/.ssh/../transfer';}]){
  const changed={...settings};change(changed);assert.throws(()=>readOriginalBackupRetentionSettings(encode(changed)));
 }
 assert.throws(()=>readOriginalBackupRetentionSettings(Buffer.concat([encode(settings),Buffer.from('\nDEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE=/other')])));
});
