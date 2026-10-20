'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes,createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkContext } = require('./runtimeWorkContext');
const { VersionedFilePublication } = require('./versionedFilePublication');

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

if (process.argv[2] === 'lost-legacy-owner') {
  void (async () => {
    const v = await fixture(), publication = require('./durableFilePublication'), original = publication.publishDurableFile;
    fs.writeFileSync(path.join(v.live, 'old.pdf'), 'ORIGINAL LEGACY SURVIVES LOST OWNER');
    publication.publishDurableFile = async (...args) => {
      const result = await original(...args);
      if (args[0].startsWith(path.join(v.store, 'heads') + '/')) {
        console.log(JSON.stringify({ event: 'BASELINE_FIRST_HEAD_DURABLE', rootName: path.basename(v.root) }));
        setInterval(() => {}, 1000); await new Promise(() => {});
      }
      return result;
    };
    v.lock(); await v.publisher.adoptLegacy('c'.repeat(64), v.fd);
    throw Error('Unexpected completed adoption');
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {

test('legacy adoption requires the actual exclusive gate before creating any baseline intent', async () => {
  const v = await fixture();
  try {
    fs.writeFileSync(path.join(v.live, 'old.pdf'), 'ORIGINAL LEGACY BYTES');
    await assert.rejects(v.publisher.adoptLegacy('1'.repeat(64), v.fd), /FILE_VERSION_EXCLUSIVE_GATE_REQUIRED/);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'heads')), []);
  } finally { await v.close(); }
});

test('native adoption retains independent old bytes without rewriting live inodes, then permits ordinary versioned replacements', async () => {
  const v = await fixture();
  try {
    fs.mkdirSync(path.join(v.live, 'nested'), { mode: 0o700 });
    for (const key of ['one.pdf', 'nested/two.pdf']) fs.writeFileSync(path.join(v.live, key), 'SAME LEGACY BYTES 123456789.12345678');
    const before = fs.statSync(path.join(v.live, 'one.pdf'), { bigint: true });
    v.lock(); const adoption = await v.publisher.adoptLegacy('2'.repeat(64), v.fd);
    assert.equal(adoption.files, 2); assert.equal(adoption.publicOnlineAdmission, false);
    const cut = await v.publisher.seal('3'.repeat(64), v.fd); v.unlock();
    assert.equal(cut.manifest.heads.length, 2);
    assert.equal(fs.statSync(path.join(v.live, 'one.pdf'), { bigint: true }).ino, before.ino);
    const objects = fs.readdirSync(path.join(v.store, 'objects')).map(n => fs.statSync(path.join(v.store, 'objects', n), { bigint: true }));
    assert.equal(objects.length, 2); assert.notEqual(objects[0].ino, objects[1].ino);
    for (const object of objects) { assert.equal(object.nlink, 1n); assert.notEqual(object.ino, before.ino); }
    await v.publisher.publish('one.pdf', Buffer.from('NEW CURRENT DATA 0.00000001'), { replace: true });
    await v.publisher.remove('nested/two.pdf');
    for (const selected of cut.manifest.heads) assert.equal((await v.publisher.readVersion(selected.sha256)).toString(), 'SAME LEGACY BYTES 123456789.12345678');
    v.lock(); await assert.rejects(v.publisher.adoptLegacy('4'.repeat(64), v.fd), /FILE_VERSION_ADOPTION_REQUIRES_EMPTY_STORE/);
  } finally { await v.close(); }
});

test('legacy aliases and hardlinks cannot become an admitted baseline', async () => {
  for (const kind of ['symlink', 'hardlink']) {
    const v = await fixture();
    try {
      const original = path.join(v.live, 'original.pdf'); fs.writeFileSync(original, 'ORIGINAL');
      if (kind === 'symlink') fs.symlinkSync(original, path.join(v.live, 'alias.pdf'));
      else fs.linkSync(original, path.join(v.live, 'alias.pdf'));
      v.lock(); await assert.rejects(v.publisher.adoptLegacy('5'.repeat(64), v.fd), /FILE_VERSION_LEGACY_INVENTORY_UNSAFE/);
      assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
      assert.equal(fs.readFileSync(original, 'utf8'), 'ORIGINAL');
    } finally { await v.close(); }
  }
});

test('preserved empty-directory baseline counts against future reservation capacity', async () => {
  const v = await fixture();
  try {
    // 10,000 actual directories including the root. If these empty prefixes
    // were omitted, a subsequent acknowledged newdir/new.pdf would make the
    // first capture exceed its directory bound.
    for (let i = 0; i < 9999; i++) fs.mkdirSync(path.join(v.live, 'empty-' + String(i).padStart(5, '0')), { mode: 0o700 });
    v.lock();
    const adopted=await v.publisher.adoptLegacy('b'.repeat(64), v.fd);assert.equal(adopted.files,0);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'heads')), []);
    assert.equal(fs.readdirSync(v.live).length, 9999, 'unknown existing directories remain intact');
    const cut=await v.publisher.seal('1'.repeat(64),v.fd);assert.equal(cut.manifest.format,'sabalan-file-version-cut/v2');assert.equal(cut.manifest.directories.length,9999);v.unlock();
    await assert.rejects(v.publisher.publish('newdir/new.pdf',Buffer.from('MUST NOT ACK EXCESS DIRECTORY')),/FILE_VERSION_INVENTORY_CAPACITY/);
    assert.equal(fs.existsSync(path.join(v.live,'newdir')),false);assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),[]);
  } finally { await v.close(); }
});

test('the real19 HR trash empty-directory layout is durably preserved without replacing any live inode',async()=>{
 const v=await fixture();try{
  fs.mkdirSync(path.join(v.live,'.deletion-trash'),{mode:0o700});
  for(let i=0;i<19;i++)fs.mkdirSync(path.join(v.live,'.deletion-trash',`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`),{mode:0o700});
  const directories=['.deletion-trash',...fs.readdirSync(path.join(v.live,'.deletion-trash')).map(name=>'.deletion-trash/'+name)].sort();
  const before=directories.map(name=>fs.statSync(path.join(v.live,name),{bigint:true}).ino);
  v.lock();await v.publisher.adoptLegacy('d'.repeat(64),v.fd);
  const record=JSON.parse(fs.readFileSync(path.join(v.store,'legacy-directories.json')));assert.deepEqual(record.directories,directories);assert.equal(fs.statSync(path.join(v.store,'legacy-directories.json')).mode&0o777,0o400);
  const cut=await v.publisher.seal('e'.repeat(64),v.fd);assert.deepEqual(cut.manifest.directories,directories);assert.equal(cut.manifest.format,'sabalan-file-version-cut/v2');
  assert.deepEqual(directories.map(name=>fs.statSync(path.join(v.live,name),{bigint:true}).ino),before);v.unlock();
  await v.publisher.publish('acknowledged.pdf',Buffer.from('NEW FILE ALONGSIDE PRESERVED DIRECTORIES'));v.lock();
  assert.deepEqual((await v.publisher.seal('f'.repeat(64),v.fd)).manifest.directories,directories);
 }finally{await v.close();}
});

test('ordinary reopening refuses a replaced or removed legacy directory record against the immutable baseline proof',async()=>{
 for(const mutation of ['omit-directory','change-capture','remove']){
  const v=await fixture();try{
   fs.mkdirSync(path.join(v.live,'preserved'),{mode:0o700});fs.mkdirSync(path.join(v.live,'second'),{mode:0o700});
   v.lock();const result=await v.publisher.adoptLegacy('9'.repeat(64),v.fd);v.unlock();
   const file=path.join(v.store,'legacy-directories.json'),proofFile=path.join(v.store,'legacy-adoption-'+('9'.repeat(64))+'.json');
   const raw=fs.readFileSync(file),proofRaw=fs.readFileSync(proofFile),proof=JSON.parse(proofRaw);
   assert.equal(createHash('sha256').update(proofRaw).digest('hex'),result.sha256);
   assert.equal(proof.directoryMetadataSha256,createHash('sha256').update(raw).digest('hex'));
   assert.equal(proof.preservedDirectories,2);
   const record=JSON.parse(raw);fs.unlinkSync(file);
   if(mutation!=='remove'){
    if(mutation==='omit-directory')record.directories=['preserved'];else record.captureId='8'.repeat(64);
    fs.writeFileSync(file,JSON.stringify(record)+'\n',{flag:'wx',mode:0o400});
   }
   await assert.rejects(VersionedFilePublication.open(v.store,v.live,v.work),/FILE_VERSION_LEGACY_DIRECTORIES_PROOF_MISMATCH|ENOENT/);
   assert.ok(fs.statSync(path.join(v.live,'preserved')).isDirectory());assert.ok(fs.statSync(path.join(v.live,'second')).isDirectory());
  }finally{await v.close();}
 }
});

test('directory replacement during immutable metadata publication cannot acknowledge a baseline',async()=>{
 const v=await fixture(),publication=require('./durableFilePublication'),original=publication.publishDurableFile;
 try{
  fs.mkdirSync(path.join(v.live,'empty'),{mode:0o700});
  publication.publishDurableFile=async(...args)=>{const result=await original(...args);if(args[0]===path.join(v.store,'legacy-directories.json')){fs.renameSync(path.join(v.live,'empty'),path.join(v.root,'original-empty'));fs.mkdirSync(path.join(v.live,'empty'),{mode:0o700});}return result;};
  v.lock();await assert.rejects(v.publisher.adoptLegacy('0'.repeat(64),v.fd),/FILE_VERSION_LEGACY_SOURCE_CHANGED/);
  assert.deepEqual(fs.readdirSync(path.join(v.store,'pending')),['legacy-adoption.json']);assert.ok(fs.existsSync(path.join(v.root,'original-empty')));
 }finally{publication.publishDurableFile=original;await v.close();}
});

test('a noncooperating live mutation during the actual copy retains an unresolved baseline and refuses capture', async () => {
  const v = await fixture(), publication = require('./durableFilePublication'), original = publication.publishDurableStream;
  try {
    const live = path.join(v.live, 'original.pdf'); fs.writeFileSync(live, 'ORIGINAL-A');
    publication.publishDurableStream = async (...args) => {
      const result = await original(...args);
      if (args[0].startsWith(path.join(v.store, 'objects') + '/')) fs.writeFileSync(live, 'CHANGED--B');
      return result;
    };
    v.lock(); await assert.rejects(v.publisher.adoptLegacy('6'.repeat(64), v.fd), /FILE_VERSION_LEGACY_SOURCE_CHANGED/);
    assert.ok(fs.readdirSync(path.join(v.store, 'pending')).length > 0);
    await assert.rejects(v.publisher.seal('7'.repeat(64), v.fd), /FILE_VERSION_PENDING_OPERATION/);
    await assert.rejects(v.publisher.adoptLegacy('8'.repeat(64), v.fd), /FILE_VERSION_ADOPTION_REQUIRES_EMPTY_STORE/);
    assert.equal(fs.readFileSync(live, 'utf8'), 'CHANGED--B');
  } finally { publication.publishDurableStream = original; await v.close(); }
});

test('a lost exclusive gate after durable object copy cannot publish a successful legacy baseline', async () => {
  const v = await fixture(), publication = require('./durableFilePublication'), original = publication.publishDurableStream;
  try {
    fs.writeFileSync(path.join(v.live, 'old.pdf'), 'ORIGINAL LEGACY');
    publication.publishDurableStream = async (...args) => {
      const result = await original(...args);
      if (args[0].startsWith(path.join(v.store, 'objects') + '/')) v.unlock();
      return result;
    };
    v.lock(); await assert.rejects(v.publisher.adoptLegacy('9'.repeat(64), v.fd), /FILE_VERSION_EXCLUSIVE_GATE_REQUIRED/);
    assert.ok(fs.readdirSync(path.join(v.store, 'pending')).length > 0);
    v.lock(); await assert.rejects(v.publisher.seal('a'.repeat(64), v.fd), /FILE_VERSION_PENDING_OPERATION/);
    assert.equal(fs.readFileSync(path.join(v.live, 'old.pdf'), 'utf8'), 'ORIGINAL LEGACY');
  } finally { publication.publishDurableStream = original; await v.close(); }
});

test('actual legacy-owner process death preserves its first durable history and never permits silent re-adoption', async () => {
  const rootName = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [__filename, 'lost-legacy-owner'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let name, stdout = '', stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (!name && stdout.includes('\n')) {
        try {
          const event = JSON.parse(stdout.split('\n')[0]); assert.equal(event.event, 'BASELINE_FIRST_HEAD_DURABLE');
          assert.match(event.rootName, /^[a-f0-9]{32}$/); name = event.rootName;
          // Only this disposable, positively identified QA child is killed.
          child.kill('SIGKILL');
        } catch (error) { reject(error); }
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; }); child.once('error', reject);
    child.once('close', (code, signal) => name && signal === 'SIGKILL' ? resolve(name) : reject(Error(JSON.stringify({ code, signal, stderr }))));
  });
  const v = await fixture(rootName, true);
  try {
    assert.equal(fs.readFileSync(path.join(v.live, 'old.pdf'), 'utf8'), 'ORIGINAL LEGACY SURVIVES LOST OWNER');
    const [name] = fs.readdirSync(path.join(v.store, 'heads'));
    const head = JSON.parse(fs.readFileSync(path.join(v.store, 'heads', name)));
    const digest = require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(v.store, 'heads', name))).digest('hex');
    assert.equal(head.generation, 1);
    assert.equal((await v.publisher.readVersion(digest)).toString(), 'ORIGINAL LEGACY SURVIVES LOST OWNER');
    assert.ok(fs.readdirSync(path.join(v.store, 'pending')).length > 0);
    v.lock(); await assert.rejects(v.publisher.seal('d'.repeat(64), v.fd), /FILE_VERSION_PENDING_OPERATION/);
    await assert.rejects(v.publisher.adoptLegacy('e'.repeat(64), v.fd), /FILE_VERSION_ADOPTION_REQUIRES_EMPTY_STORE/);
  } finally { await v.close(); }
});
}
