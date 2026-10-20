import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {enforceFilesystemRemoteRetention,readLocalCheckpointRetentionHolds} from './deploymentCheckpointStorage';
import {verifyHostBackupRetentionReceipt} from './deploymentBackupRetention';
/** The host owns SSH and the backup owns deletion. This side only re-reads the
 * actual mounted bytes and mints local filesystem evidence for local cleanup. */
export async function inspectOriginalHostRemoteRetention(remoteRoot:string,deploymentId:string,localRoot:string,stage:'BEFORE_CHECKPOINT'|'AFTER_CHECKPOINT'){
 const file=String(process.env.DEPLOYMENT_REMOTE_RETENTION_RECEIPT||''),digest=String(process.env.DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256||''),reportRoot=String(process.env.DEPLOYMENT_REPORT_DIR||'');
 assert.ok(path.isAbsolute(file)&&path.isAbsolute(reportRoot)&&path.dirname(file)===reportRoot&&path.basename(file)===`remote-retention-${deploymentId}-${stage}.json`);assert.match(digest,/^[a-f0-9]{64}$/);
 assert.equal(await fs.promises.realpath(file),file);const handle=await fs.promises.open(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);let receipt:ReturnType<typeof verifyHostBackupRetentionReceipt>;
 try{const before=await handle.stat({bigint:true});assert.ok(before.isFile()&&before.uid===0n&&before.nlink===1n&&(before.mode&0o777n)===0o400n&&before.size>0n&&before.size<=8n*1024n*1024n);const raw=await handle.readFile(),after=await handle.stat({bigint:true}),named=await fs.promises.lstat(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'] as const){assert.equal(before[key],after[key]);assert.equal(before[key],named[key]);}receipt=verifyHostBackupRetentionReceipt(raw,{sha256:digest,deploymentId,stage});}finally{await handle.close();}
 const currentHolds=await readLocalCheckpointRetentionHolds(localRoot);assert.ok(currentHolds.every(id=>receipt.request.protectedCheckpointIds.includes(id)),'DEPLOYMENT_REMOTE_RETENTION_HOLDS_CHANGED');
 const inspected=await enforceFilesystemRemoteRetention(remoteRoot,deploymentId,localRoot,{mode:'inspect',protectedCheckpointIds:receipt.request.protectedCheckpointIds});
 const identity=(row:any)=>({id:row.id,checksum:row.checksum,size:row.size,metadataSha256:row.metadataSha256});
 const sorted=(rows:any[])=>rows.map(identity).sort((a,b)=>a.id.localeCompare(b.id));assert.deepEqual(sorted(inspected.retainedPoints),sorted(receipt.response.retainedPoints),'DEPLOYMENT_REMOTE_RETENTION_REPLACEMENTS_CHANGED');return inspected;
}
