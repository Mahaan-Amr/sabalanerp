'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkContext } = require('./runtimeWorkContext');
const { VersionedFilePublication, assertVersionedFileRootScope } = require('./versionedFilePublication');

async function fixture(name = randomBytes(16).toString('hex'), existing = false) {
  assert.match(name, /^[a-f0-9]{32}$/);
  const root = path.join(__dirname, name); if (!existing) fs.mkdirSync(root, { mode: 0o700 });
  const gate = path.join(root, 'deployment-write-admission.lock'); if (!existing) fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const value = fs.statSync(gate, { bigint: true });
  const identity = { device: String(value.dev), inode: String(value.ino), ownerUid: Number(value.uid) };
  const runtimeId = randomBytes(32).toString('hex'), journalRoot = path.join(root, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  const work = new RuntimeWorkContext(new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {}), () => {});
  const store = path.join(root, 'versions'), live = path.join(root, 'live');
  if (!existing) for (const p of [store, live]) fs.mkdirSync(p, { mode: 0o700 });
  const publisher = await VersionedFilePublication.open(store, live, work);
  const fd = fs.openSync(gate, 'r');
  const command = mode => {
    const result = spawnSync('/usr/bin/flock', [mode, '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] });
    assert.equal(result.status, 0, result.stderr.toString());
  };
  return { root, work, store, live, publisher, fd, lock: () => command('--exclusive'), unlock: () => command('--unlock'),
    async close() { command('--unlock'); fs.closeSync(fd); await work.stopAndDrain(1000); } };
}


async function scope(v,name){const root=path.join(v.live,name);fs.mkdirSync(root,{mode:0o700});return {root,files:await v.publisher.bindRoot(root)};}

test('root scopes isolate sibling bytes and version reads while sharing the sealed cut',async()=>{
 const v=await fixture();try{
  const a=await scope(v,'contracts'),b=await scope(v,'people');
  const av=await a.files.publish('same.pdf',Buffer.from('CONTRACT'));
  const bv=await b.files.publish('same.pdf',Buffer.from('PERSONNEL'));
  assert.equal((await a.files.read('same.pdf')).toString(),'CONTRACT');assert.equal((await b.files.read('same.pdf')).toString(),'PERSONNEL');
  assert.equal((await a.files.readVersion('same.pdf',av)).toString(),'CONTRACT');
  await assert.rejects(a.files.readVersion('same.pdf',bv),/FILE_VERSION_SELECTION_INVALID/);
  assert.equal((await a.files.inspect('same.pdf')).versionSha256,av);
  v.lock();const cut=await v.publisher.seal('a'.repeat(64),v.fd);v.unlock();assert.equal(cut.manifest.heads.length,2);
  assert.equal(fs.readFileSync(path.join(a.root,'same.pdf'),'utf8'),'CONTRACT');
 }finally{await v.close();}
});

test('scope roots, aliases and escaped keys refuse before file intents',async()=>{
 const v=await fixture();try{
  const a=await scope(v,'contracts');
  await assert.rejects(v.publisher.bindRoot(v.root),/FILE_VERSION_STORAGE_ROOT_MISMATCH/);
  fs.symlinkSync(a.root,path.join(v.live,'alias'),'dir');
  await assert.rejects(v.publisher.bindRoot(path.join(v.live,'alias')),/FILE_VERSION_DIRECTORY_ALIAS/);
  for(const key of ['../escape.pdf','/absolute.pdf','sub/../../escape.pdf',''])await assert.rejects(a.files.publish(key,Buffer.from('NO')),/FILE_VERSION_KEY_INVALID/);
  assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
  assert.throws(()=>assertVersionedFileRootScope({...a.files},a.root),/FILE_VERSION_STORAGE_ROOT_MISMATCH/);
  assert.throws(()=>assertVersionedFileRootScope(a.files,v.live),/FILE_VERSION_STORAGE_ROOT_MISMATCH/);
 }finally{await v.close();}
});

test('rebinding cannot bless a replacement directory incarnation',async()=>{
 const v=await fixture();try{
  const a=await scope(v,'contracts');await a.files.publish('original.pdf',Buffer.from('OLD'));
  fs.renameSync(a.root,a.root+'-retired');fs.mkdirSync(a.root,{mode:0o700});
  await assert.rejects(v.publisher.bindRoot(a.root),/FILE_VERSION_DIRECTORY_CHANGED/);
  await assert.rejects(a.files.publish('new.pdf',Buffer.from('NO')),/FILE_VERSION_DIRECTORY_CHANGED/);
  assert.equal(fs.existsSync(path.join(a.root,'new.pdf')),false);
 }finally{await v.close();}
});

test('concurrent binding cannot replace an incarnation pinned during filesystem observation',async()=>{
 const v=await fixture();const target=path.join(v.live,'contracts');fs.mkdirSync(target,{mode:0o700});
 const original=fs.promises.lstat;let release,observed,count=0;
 const hold=new Promise(r=>{release=r;}),seen=new Promise(r=>{observed=r;});let first;
 try{
  fs.promises.lstat=async function(file,...args){
   const value=await original.call(this,file,...args);
   if(file===target&&++count===2){observed();await hold;}
   return value;
  };
  first=v.publisher.bindRoot(target);const refused=assert.rejects(first,/FILE_VERSION_DIRECTORY_CHANGED/);await seen;
  fs.renameSync(target,target+'-retired');fs.mkdirSync(target,{mode:0o700});
  const second=await v.publisher.bindRoot(target);release();await refused;
  await second.publish('current.pdf',Buffer.from('CURRENT'));
  assert.equal(fs.readFileSync(path.join(target,'current.pdf'),'utf8'),'CURRENT');
 }finally{release?.();await first?.catch(()=>{});fs.promises.lstat=original;await v.close();}
});

test('sibling relocation uses one actual owner and refuses stale or foreign moves',async()=>{
 const v=await fixture(),other=await fixture();try{
  const a=await scope(v,'documents'),b=await scope(v,'quarantine'),foreign=await scope(other,'documents');
  const original=await a.files.publish('file.pdf',Buffer.from('ORIGINAL'));
  await assert.rejects(a.files.moveTo(foreign.files,'file.pdf','file.pdf',original),/FILE_VERSION_STORAGE_ROOT_MISMATCH/);
  const moved=await a.files.moveTo(b.files,'file.pdf','file.pdf',original);
  assert.equal(await a.files.read('file.pdf'),null);assert.equal((await b.files.read('file.pdf')).toString(),'ORIGINAL');
  await a.files.publish('file.pdf',Buffer.from('NEW'));
  await assert.rejects(b.files.moveTo(a.files,'file.pdf','file.pdf',moved.destinationVersionSha256),/FILE_VERSION_ALREADY_EXISTS/);
  assert.equal((await a.files.read('file.pdf')).toString(),'NEW');assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
 }finally{await v.close();await other.close();}
});

test('invalid scoped upload retains admission until actual input destruction completes',async()=>{
 const v=await fixture();let release,started;const hold=new Promise(r=>{release=r;}),seen=new Promise(r=>{started=r;});let pending;
 try{
  const a=await scope(v,'uploads');const {Readable}=require('node:stream');
  const input=new Readable({read(){},destroy(error,done){started();hold.then(()=>done(error));}});
  pending=a.files.publishUpload('../escape.pdf',input);const rejected=assert.rejects(pending,/FILE_VERSION_KEY_INVALID/);await seen;
  const blocked=spawnSync('/usr/bin/flock',['--exclusive','--nonblock','3'],{stdio:['ignore','ignore','pipe',v.fd]});assert.equal(blocked.status,1);assert.equal(input.closed,false);
  release();await rejected;assert.equal(input.closed,true);v.lock();v.unlock();
 }finally{release?.();await pending?.catch(()=>{});await v.close();}
});

test('scoped Dispatch storage publishes and tombstones through its admitted root',async()=>{
 const v=await fixture();try{
  const a=await scope(v,'artifacts');const {createScopedVersionedFilesystemDispatchArtifactStorage}=require('./dispatchDocuments/filesystemStorage');
  const storage=createScopedVersionedFilesystemDispatchArtifactStorage(a.root,a.files);
  await storage.stage({storageKey:'dispatch-documents/document.pdf',bytes:Buffer.from('ORIGINAL DISPATCH')});
  assert.equal(Buffer.from(await storage.read('dispatch-documents/document.pdf')).toString(),'ORIGINAL DISPATCH');
  const head=await a.files.inspect('dispatch-documents/document.pdf');await storage.discard('dispatch-documents/document.pdf');
  assert.equal(await storage.read('dispatch-documents/document.pdf'),null);
  assert.equal((await a.files.readVersion('dispatch-documents/document.pdf',head.versionSha256)).toString(),'ORIGINAL DISPATCH');
  assert.throws(()=>createScopedVersionedFilesystemDispatchArtifactStorage(v.live,a.files),/FILE_VERSION_STORAGE_ROOT_MISMATCH/);
 }finally{await v.close();}
});
