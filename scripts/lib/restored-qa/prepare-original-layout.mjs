/** Source-owned file provisioning inside the SAME awaited strict callback.
 * All startup dependencies are copied before publication; never replace a key,
 * overwrite an old scope, start an actor, or modify the original Inquiry DB. */
import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
export const originalCompleteStartupNames=Object.freeze(['independent-restored-baseline.worker.cjs','private-qualification-observer.py','independent-private-runtime.py','private-qualification-materialize.py','original-host-controller-channel.py','online-runtime-owner.py','backend-runtime-owner.py','online-runtime-scope.py','online-capture-admission.py','private-qualification-bootstrap.sql','online-private-qualification-worker.cjs'].sort());
const required=originalCompleteStartupNames;
const sha=b=>createHash('sha256').update(b).digest('hex');
export function createOriginalCompleteLayoutPreparer({operation,sourcePins,files,issuer,assertOriginalCallbackActive}) {
 assert.match(operation,/^[a-f0-9]{32}$/);assert.deepEqual(Object.keys(files).sort(),required);assert.deepEqual(Object.keys(sourcePins).sort(),required);
 const held=new Map(required.map(name=>{assert.ok(Buffer.isBuffer(files[name]));const raw=Buffer.from(files[name]);assert.equal(sha(raw),sourcePins[name]);return[name,raw];}));
 let used=false;
 return async({root,publicGrants,enrollment})=>{
  assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(used,false,'ORIGINAL_COMPLETE_LAYOUT_PREPARER_ALREADY_USED');used=true;
  assertOriginalCallbackActive();issuer.assertActive();await issuer.checkOriginalResources();assertOriginalCallbackActive();
  assert.equal(root,'/app/runtime-authority/application-native-'+operation+'/restored-complete-app/coherent-private');assert.equal(fs.realpathSync(root),root);
  const original=fs.lstatSync(root,{bigint:true});assert.ok(original.isDirectory()&&original.uid===0n&&(original.mode&0o777n)===0o700n);
  assert.deepEqual(enrollment,issuer.enrollment);assert.equal(publicGrants.length,3);
  for(const name of required){assertOriginalCallbackActive();const raw=held.get(name);assert.equal(sha(raw),sourcePins[name]);const file=path.join(root,name),fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o400);try{let offset=0;while(offset<raw.length){const n=fs.writeSync(fd,raw.subarray(offset));assert.ok(n>0);offset+=n;}fs.fsyncSync(fd);}finally{fs.closeSync(fd);}assert.deepEqual(fs.readFileSync(file),raw);}
  const fd=fs.openSync(root,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  const current=fs.lstatSync(root,{bigint:true});for(const key of ['dev','ino','uid','mode'])assert.equal(current[key],original[key]);
  assertOriginalCallbackActive();const result=await issuer.prepareOriginalRestoredLayout();assert.equal(result.prepared,true);assertOriginalCallbackActive();issuer.assertActive();
 };
}
