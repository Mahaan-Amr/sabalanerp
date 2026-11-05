import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const source=fs.readFileSync(new URL('../../deploy/scripts/deploy.sh',import.meta.url),'utf8');
const line=source.split('\n').find(value=>value.includes('DEPLOYMENT_REMOTE_RETENTION_RECEIPT_SHA256="$(node -e '));
const binder=line?.match(/node -e '([^']+)'/)?.[1];
assert.ok(binder,'the actual production receipt binder must be tested');
const run=file=>spawnSync(process.execPath,['-e',binder,file],{encoding:'utf8'});

test('the actual retention binder rejects a non-root owned receipt',
 {skip:process.platform!=='linux'||process.getuid()===0}, () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retention-binder-user-'));
 try {
  const file=path.join(root,'receipt');fs.writeFileSync(file,'fixture',{mode:0o400});
  assert.notEqual(run(file).status,0,'non-root owner must be rejected');
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

test('root-owned receipt accepts intact evidence and rejects custody attacks',
 {skip:process.platform!=='linux'||process.getuid()!==0}, () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'retention-binder-root-'));
 try {
  const file=path.join(root,'receipt'); const bytes=Buffer.from('actual production binder evidence');
  fs.writeFileSync(file,bytes,{mode:0o400});
  const success=run(file); assert.equal(success.status,0,success.stderr);
  assert.equal(success.stdout,createHash('sha256').update(bytes).digest('hex'));
  fs.chmodSync(file,0o600);assert.notEqual(run(file).status,0,'writable receipt must fail');fs.chmodSync(file,0o400);
  const link=path.join(root,'hardlink');fs.linkSync(file,link);assert.notEqual(run(file).status,0,'hardlinked receipt must fail');fs.unlinkSync(link);
  const symbolic=path.join(root,'symlink');fs.symlinkSync(file,symbolic);assert.notEqual(run(symbolic).status,0,'symlink receipt must fail');
  fs.chownSync(file,65534,65534);assert.notEqual(run(file).status,0,'foreign owner must fail');fs.chownSync(file,0,0);
  fs.chmodSync(file,0o600);fs.writeFileSync(file,Buffer.alloc(8388609));fs.chmodSync(file,0o400);
  assert.notEqual(run(file).status,0,'oversized receipt must fail');
  for(const field of ['dev','ino','size','mtimeNs','ctimeNs'])assert.ok(binder.includes(`"${field}"`),'identity pin missing: '+field);
 } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
