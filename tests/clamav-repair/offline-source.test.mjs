import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {offlineIncidentSource} from '../../scripts/clamav-release-readiness.mjs';
const git=(cwd,...args)=>execFileSync('git',['-c','protocol.file.allow=always',...args],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const write=async(file,value)=>{await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,value);};
const commit=cwd=>git(cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-am','fixture');
async function fixture(changed='deploy/clamav/health.sh') {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sabalan-offline-source-'));
 const upstream=path.join(root,'inquiry'),ops=path.join(root,'operations'),repo=path.join(root,'production');
 await fs.mkdir(upstream);git(upstream,'init');await write(path.join(upstream,'index.txt'),'fixture');git(upstream,'add','.');commit(upstream);
 await fs.mkdir(ops);git(ops,'init');await write(path.join(ops,'.gitattributes'),'* -text\n');
 await write(path.join(ops,'package.json'),'{"scripts":{}}');await write(path.join(ops,'backend/package.json'),'{"scripts":{}}');
 await write(path.join(ops,'deploy/clamav/health.sh'),'original');git(ops,'add','.');commit(ops);
 git(ops,'submodule','add',upstream,'apps/sabalan-inquiry');commit(ops);
 const base=git(ops,'rev-parse','HEAD');git(root,'clone','--no-hardlinks',ops,repo);git(repo,'submodule','update','--init');
 await write(path.join(ops,changed),changed.endsWith('package.json')?'{"scripts":{},"dependencies":{"unexpected":"1.0.0"}}':'candidate');git(ops,'add','.');commit(ops);git(ops,'branch','incident-offline');
 const bundle=path.join(root,'source.bundle');git(ops,'bundle','create',bundle,'refs/heads/incident-offline');
 const raw=await fs.readFile(bundle);
 const manifest={format:'sabalan-offline-clamav-incident-source/v1',baseCommit:base,targetCommit:git(ops,'rev-parse','HEAD'),targetTree:git(ops,'rev-parse','HEAD^{tree}'),inquiryCommit:git(upstream,'rev-parse','HEAD'),bundle:{file:bundle,bytes:raw.length,sha256:crypto.createHash('sha256').update(raw).digest('hex'),ref:'refs/heads/incident-offline'}};
 return {root,repo,ops,manifest};
}
async function withFixture(run,changed) {const f=await fixture(changed);try{await run(f);}finally{await fs.rm(f.root,{recursive:true,force:true});}}
test('actual Git bundle imports an exact AV-only fast-forward and revalidates without source acquisition',async()=>withFixture(async f=>{
 const remotes=git(f.repo,'remote','-v');
 const result=await offlineIncidentSource(f.manifest,f.repo,f.ops,'import');assert.equal(result.releaseAdmission,false);
 assert.equal(git(f.repo,'rev-parse','HEAD'),f.manifest.targetCommit);assert.equal(git(f.repo,'remote','-v'),remotes);
 assert.equal((await offlineIncidentSource(f.manifest,f.repo,f.ops,'verify')).sourceVerified,true);
 await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'),/base changed/);
}));
test('actual bundle with unreviewed business source is rejected before checkout changes',async()=>withFixture(async f=>{
 await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'),/unrelated source/);assert.equal(git(f.repo,'rev-parse','HEAD'),f.manifest.baseCommit);
},'backend/src/business.ts'));
test('checksum, tree, advertised-ref and base mismatches fail before checkout changes',async()=>withFixture(async f=>{
 for(const change of [m=>m.bundle.sha256='0'.repeat(64),m=>m.targetTree='0'.repeat(40),m=>m.bundle.ref='refs/heads/another',m=>m.baseCommit='0'.repeat(40)]) {
  const m=structuredClone(f.manifest);change(m);await assert.rejects(offlineIncidentSource(m,f.repo,f.ops,'import'));assert.equal(git(f.repo,'rev-parse','HEAD'),f.manifest.baseCommit);
 }
}));
test('dirty production, dirty runner and wrong initialized Inquiry are rejected',async()=>withFixture(async f=>{
 await write(path.join(f.repo,'untracked.txt'),'unexpected');await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'),/not clean/);await fs.unlink(path.join(f.repo,'untracked.txt'));
 await write(path.join(f.ops,'untracked.txt'),'unexpected');await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'),/not clean/);await fs.unlink(path.join(f.ops,'untracked.txt'));
 const sub=path.join(f.repo,'apps/sabalan-inquiry');await write(path.join(sub,'index.txt'),'changed');commit(sub);
 await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'),/clean|gitlink/);
 assert.equal(git(f.repo,'rev-parse','HEAD'),f.manifest.baseCommit);
}));
test('dependency commands cannot be changed inside otherwise allowed package path',async()=>withFixture(async f=>{
 await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'));
},'backend/package.json'));
test('post-import changes are refused by the pre-maintenance revalidation',async()=>withFixture(async f=>{
 await offlineIncidentSource(f.manifest,f.repo,f.ops,'import');await write(path.join(f.repo,'deploy/clamav/health.sh'),'changed after build');
 await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'verify'),/not clean/);
}));

test('migration changes are rejected by the real scope validator',async()=>withFixture(async f=>{
 await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'),/unrelated source/);
 assert.equal(git(f.repo,'rev-parse','HEAD'),f.manifest.baseCommit);
},'backend/prisma/migrations/unapproved/migration.sql'));
test('extra bundle refs cannot be smuggled into the source package',async()=>withFixture(async f=>{
 await fs.unlink(f.manifest.bundle.file);git(f.ops,'branch','unexpected');
 git(f.ops,'bundle','create',f.manifest.bundle.file,'refs/heads/incident-offline','refs/heads/unexpected');
 const raw=await fs.readFile(f.manifest.bundle.file);f.manifest.bundle.bytes=raw.length;f.manifest.bundle.sha256=crypto.createHash('sha256').update(raw).digest('hex');
 await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'),/unexpected refs|full v2 bundle/);
 assert.equal(git(f.repo,'rev-parse','HEAD'),f.manifest.baseCommit);
}));

test('an incremental bundle is rejected even when both checkouts possess its prerequisites',async()=>withFixture(async f=>{
 await fs.unlink(f.manifest.bundle.file);
 git(f.ops,'bundle','create',f.manifest.bundle.file,'refs/heads/incident-offline','^'+f.manifest.baseCommit);
 const raw=await fs.readFile(f.manifest.bundle.file);f.manifest.bundle.bytes=raw.length;f.manifest.bundle.sha256=crypto.createHash('sha256').update(raw).digest('hex');
 await assert.rejects(offlineIncidentSource(f.manifest,f.repo,f.ops,'import'),/full v2 bundle/);
 assert.equal(git(f.repo,'rev-parse','HEAD'),f.manifest.baseCommit);
}));
