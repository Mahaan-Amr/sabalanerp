import assert from 'node:assert/strict';
import {validateFrozenOriginalInventory} from './serial-owner.mjs';

/** Decode only the fixed frozen producer's stdout. The caller must first verify
 * its retained child receipt, hash, normal exit and private output custody. */
export function parseFrozenOriginalInventory(plan,raw,validate=validateFrozenOriginalInventory) {
 assert.equal(typeof raw,'string');assert.ok(raw.endsWith('\n'));
 const rows=[];let rootMetadata;
 for(const line of raw.slice(0,-1).split('\n')){
  const [kind,name,metadata,digest,...extra]=line.split('\t');
  assert.equal(extra.length,0);assert.ok(['R','D','F'].includes(kind));
  const parts=metadata.split('|');assert.equal(parts.length,9);
  const [device,inode,rawMode,uid,gid,links,size,mtime,ctime]=parts;
  for(const x of [device,inode,uid,gid,links,size])assert.match(x,/^[0-9]+$/);
  assert.match(rawMode,/^[a-f0-9]+$/);assert.ok(mtime.length>0&&ctime.length>0);
  const mode=Number.parseInt(rawMode,16),nlink=Number(links),bytes=Number(size);
  assert.ok(Number.isSafeInteger(mode)&&Number.isSafeInteger(nlink)&&Number.isSafeInteger(bytes));
  const row={path:name.replace(/^\.\//,''),type:kind==='F'?'file':'directory',device,inode,rawMode,mode:mode&0o7777,uid,gid,nlink,bytes,mtime,ctime};
  assert.equal(mode&0o170000,kind==='F'?0o100000:0o040000);
  if(kind==='R'){assert.equal(name,'.');assert.equal(rootMetadata,undefined);assert.equal(digest,undefined);rootMetadata=row;}
  else {assert.ok(name.startsWith('./'));if(kind==='F')row.sha256=digest;else assert.equal(digest,undefined);rows.push(row);}
 }
 assert.ok(rootMetadata);
 for(const row of rows)assert.equal(row.device,rootMetadata.device,'ORIGINAL_NESTED_MOUNT_REFUSED');
 rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const inventory={format:'sabalan-original-local-pgdata-frozen-inventory/v1',pgdata:'/var/lib/postgresql/data',
  excludedEntry:plan.originalDataExcludedEntry,normalShutdown:true,postmasterAbsent:true,runningServers:0,
  fullFileContentsHashed:true,rootMetadata,rows};
 if(plan.retainedEvidenceRoots?.length)inventory.retainedEvidenceRoots=[...plan.retainedEvidenceRoots].sort();
 validate(plan,inventory);return inventory;
}
