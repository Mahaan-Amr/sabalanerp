/** Read-only measured baseline data. These receipts never confer runtime admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const hash=raw=>createHash('sha256').update(raw).digest('hex');
export function readProductionInquirySnapshot(file,expectedSha256){
 assert.ok(path.isAbsolute(file));assert.match(expectedSha256,/^[a-f0-9]{64}$/);
 const resolved=fs.realpathSync(file);assert.equal(resolved,path.resolve(file));
 const before=fs.lstatSync(resolved,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size<=1048576n);
 const fd=fs.openSync(resolved,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let raw;
 const key=s=>['ino','size','mtimeNs','ctimeNs','mode','nlink'].map(k=>String(s[k])).join(':');
 try{const held=fs.fstatSync(fd,{bigint:true});assert.equal(key(held),key(before));if(process.platform!=='win32')assert.equal(held.dev,before.dev);raw=fs.readFileSync(fd);assert.equal(key(fs.fstatSync(fd,{bigint:true})),key(held));assert.equal(key(fs.lstatSync(resolved,{bigint:true})),key(before));}finally{fs.closeSync(fd);}
 assert.equal(hash(raw),expectedSha256,'PRODUCTION_SNAPSHOT_BYTES_CHANGED');const value=JSON.parse(raw);
 assert.equal(value.format,'sabalan-readonly-capture-only-readiness/v1');assert.equal(value.readOnly,true);assert.equal(value.productionMutation,false);assert.equal(value.allSixIdentitiesUnchanged,true);assert.match(value.head,/^[a-f0-9]{40}$/);
 assert.equal(value.originalSsh.code,0);assert.equal(value.originalSsh.signal,null);assert.ok(value.originalChildren.length>0&&value.originalChildren.every(c=>c.code===0&&c.signal===null));
 assert.deepEqual(Object.keys(value.services).sort(),['backend','clamav','frontend','inquiry','nginx','postgres']);
 for(const row of Object.values(value.services)){assert.match(row.id,/^[a-f0-9]{64}$/);assert.match(row.image,/^sha256:[a-f0-9]{64}$/);assert.ok(Number.isFinite(Date.parse(row.startedAt)));assert.equal(row.running,true);assert.equal(row.health,'healthy');}
 return {file:resolved,sha256:expectedSha256,deployedHead:value.head,services:value.services,productionAdmission:false};
}
export function snapshotArguments(args,offset){
 if(args.length===offset)return null;assert.equal(args.length,offset+4);assert.equal(args[offset],'--snapshot-receipt');assert.equal(args[offset+2],'--snapshot-sha256');return readProductionInquirySnapshot(args[offset+1],args[offset+3]);
}
export function assertSnapshotInquiryJoin(snapshot,code,exported,codeOuter){
 assert.equal(codeOuter.format,'sabalan-production-inquiry-legacy-code-ssh/v1');assert.equal(codeOuter.originalSsh.code,0);assert.equal(codeOuter.originalSsh.signal,null);assert.equal(codeOuter.originalClosure.interrupted,false);assert.equal(codeOuter.originalClosure.allOriginalChildrenClosed,true);assert.deepEqual(JSON.parse(codeOuter.originalSsh.stdout),code);
 assert.equal(code.passResult,true);assert.equal(code.allSixIdentitiesUnchanged,true);assert.equal(code.allOriginalChildrenClosed,true);assert.ok(code.originalCommands.length>0&&code.originalCommands.every(v=>v.returncode===0));assert.equal(exported.passResult,true);assert.equal(exported.originalSsh.code,0);assert.equal(exported.originalSsh.signal,null);assert.equal(exported.originalTransfer.code,0);assert.equal(exported.originalTransfer.signal,null);assert.equal(exported.originalClosure.interrupted,false);assert.equal(exported.originalClosure.allOriginalChildrenClosed,true);assert.equal(exported.remote.allSixIdentitiesUnchanged,true);assert.equal(exported.remote.allOriginalChildrenClosed,true);assert.ok(exported.remote.originalCommands.length>0&&exported.remote.originalCommands.every(v=>v.returncode===0));
 const expected=snapshot.services.inquiry;assert.equal(code.inquiry.id,expected.id);assert.equal(code.inquiry.image,expected.image);assert.equal(code.inquiry.birth,expected.startedAt);
 assert.deepEqual(code.snapshotBaseline,snapshot);assert.deepEqual(exported.snapshotBaseline,snapshot);
 assert.equal(exported.remote.sourceImage,expected.image);for(const row of code.before){const other=exported.remote.before.find(v=>v.service===row.service);assert.ok(other);for(const field of ['id','image','birth'])assert.equal(other[field],row[field]);}assert.deepEqual(exported.remote.image,code.image);
 assert.deepEqual(code.value.sourceSnapshot,{format:'sabalan-measured-inquiry-source/v1',baselineSha256:snapshot.sha256,deployedHead:snapshot.deployedHead,engineImage:expected.image,containerId:expected.id,startedAt:expected.startedAt});
 assert.match(code.value.frameworkBuildId,/^[A-Za-z0-9_-]{1,200}$/);assert.equal(code.value.knownBusinessSourceCommit,null);
 return code.value.sourceSnapshot;
}
