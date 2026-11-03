import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

const sha=value=>createHash('sha256').update(value).digest('hex');
const base='backend/prisma/migrations/';
function git(repository,args,input){
 const result=spawnSync('git',args,{cwd:repository,input,stdio:[input===undefined?'ignore':'pipe','pipe','pipe'],maxBuffer:128*1024*1024});
 assert.ifError(result.error);assert.equal(result.signal,null,'MIGRATION_GIT_SIGNAL');assert.equal(result.status,0,'MIGRATION_GIT_FAILED');
 return result.stdout;
}

/** Immutable Git-object inventory; no checkpoint, lease or release authority. */
export function readPrebuiltMigrationInventory(repository,commit){
 assert.equal(path.resolve(repository),repository);assert.match(commit,/^[a-f0-9]{40}$/);
 const raw=git(repository,['ls-tree','-rz','--full-tree',commit,'--',base]);
 const requests=[];
 for(const line of raw.toString('utf8').split('\0')){
  if(!line)continue;
  const match=/^(100644) blob ([a-f0-9]{40})\t(.+)$/.exec(line);
  assert.ok(match,'MIGRATION_GIT_TREE_UNSUPPORTED');
  const relative=match[3];
  if(relative===base+'migration_lock.toml')continue;
  const parsed=/^backend\/prisma\/migrations\/(\d{14}_[A-Za-z0-9_]+)\/migration\.sql$/.exec(relative);
  assert.ok(parsed,'MIGRATION_GIT_PATH_UNSUPPORTED');
  requests.push({name:parsed[1],oid:match[2]});
 }
 assert.ok(requests.length>0&&requests.length<=8192,'MIGRATION_GIT_INVENTORY_BOUND');
 const batch=git(repository,['cat-file','--batch'],requests.map(item=>item.oid).join('\n')+'\n');
 const entries=[];let offset=0;
 for(const request of requests){
  const end=batch.indexOf(10,offset);assert.ok(end>=offset,'MIGRATION_GIT_BATCH_HEADER');
  const header=batch.subarray(offset,end).toString('ascii');
  const match=/^([a-f0-9]{40}) blob ([0-9]+)$/.exec(header);
  assert.ok(match&&match[1]===request.oid,'MIGRATION_GIT_BATCH_IDENTITY');
  const size=Number(match[2]);assert.ok(Number.isSafeInteger(size)&&size>0&&size<=8*1024*1024,'MIGRATION_GIT_BLOB_BOUND');
  const first=end+1,last=first+size;assert.ok(last<batch.length&&batch[last]===10,'MIGRATION_GIT_BATCH_TRUNCATED');
  entries.push(Object.freeze({name:request.name,sha256:sha(batch.subarray(first,last))}));offset=last+1;
 }
 assert.equal(offset,batch.length,'MIGRATION_GIT_BATCH_TRAILING');
 entries.sort((a,b)=>a.name.localeCompare(b.name,'en'));
 assert.equal(new Set(entries.map(item=>item.name)).size,entries.length,'MIGRATION_GIT_DUPLICATE');
 return Object.freeze({format:'sabalan-git-migration-inventory/v1',commit,entries:Object.freeze(entries),sha256:sha(JSON.stringify(entries)),releaseAdmission:false});
}
