'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const { test } = require('node:test');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkContext } = require('./runtimeWorkContext');
const { VersionedFilePublication } = require('./versionedFilePublication');
const { createVersionedFilesystemDispatchArtifactStorage } = require('./dispatchDocuments/filesystemStorage');

async function fixture(name, existing = false) {
  const root = path.join(__dirname, name); if (!existing) fs.mkdirSync(root, { mode: 0o700 });
  const gate = path.join(root, 'deployment-write-admission.lock'); if (!existing) fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const value = fs.statSync(gate, { bigint: true });
  const gateIdentity = { device: String(value.dev), inode: String(value.ino), ownerUid: Number(value.uid) };
  const runtimeId = randomBytes(32).toString('hex');
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: gateIdentity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  const journalRoot = path.join(root, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  const tasks = new RuntimeTaskAdmission(new KernelWriteAdmission(gate, gateIdentity, () => {}), journal, () => {});
  const work = new RuntimeWorkContext(tasks, () => {});
  const store = path.join(root, 'versions'), live = path.join(root, 'live');
  if (!existing) for (const directory of [store, live]) fs.mkdirSync(directory, { mode: 0o700 });
  const publisher = await VersionedFilePublication.open(store, live, work);
  return { root, gate, gateIdentity, journal, work, publisher, live, store };
}

if (process.argv[2] === 'race-owner') {
  void (async () => {
    const value = await fixture(process.argv[4] || 'race', true);
    try {
      const sha256 = await value.publisher.publish(process.argv[5] || 'invoice.pdf', Buffer.from(process.argv[3]));
      console.log(JSON.stringify({ ok: true, sha256, bytes: process.argv[3] }));
    } catch (error) {
      console.log(JSON.stringify({ ok: false, code: error.code }));
    } finally { await value.work.stopAndDrain(1000); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else if (process.argv[2] === 'lost-owner') {
  void (async () => {
    const value = await fixture('lost-owner');
    const publication = require('./durableFilePublication'), original = publication.publishDurableFile;
    publication.publishDurableFile = async (...input) => {
      const result = await original(...input);
      if (input[0] === path.join(value.live, 'invoice.pdf')) {
        // Diagnostic observation after the real live publication completed,
        // before its caller can publish a version/head/completion receipt.
        fs.writeSync(1, 'ACTUAL_LIVE_FILE_PUBLISHED\n');
        setInterval(() => {}, 1000);
        await new Promise(() => {});
      }
      return result;
    };
    await value.publisher.publish('invoice.pdf', Buffer.from('COMMITTED WITH LOST OWNER'));
    throw Error('Unexpected completion');
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {

test('acknowledged replacement and deletion retain independent exact historical file bytes', async () => {
  const value = await fixture('history');
  try {
    const first = await value.publisher.publish('dispatch/invoice.pdf', Buffer.from('ORIGINAL 123456789.12345678'));
    const reader = fs.openSync(path.join(value.live, 'dispatch/invoice.pdf'), 'r');
    try {
      const second = await value.publisher.publish('dispatch/invoice.pdf', Buffer.from('REPLACED 0.00000001'), { replace: true });
      assert.equal(fs.readFileSync(reader, 'utf8'), 'ORIGINAL 123456789.12345678');
      assert.equal((await value.publisher.readVersion(first)).toString(), 'ORIGINAL 123456789.12345678');
      assert.equal((await value.publisher.readVersion(second)).toString(), 'REPLACED 0.00000001');
      const removed = await value.publisher.remove('dispatch/invoice.pdf');
      assert.equal(fs.existsSync(path.join(value.live, 'dispatch/invoice.pdf')), false);
      assert.equal(await value.publisher.readVersion(removed), null);
      assert.equal((await value.publisher.readVersion(first)).toString(), 'ORIGINAL 123456789.12345678');
      assert.deepEqual(fs.readdirSync(path.join(value.store, 'pending')), []);
      assert.equal((await value.journal.inspect()).phase, 'QUIESCENT');
    } finally { fs.closeSync(reader); }
  } finally { await value.work.stopAndDrain(1000); }
});

test('the Dispatch storage adapter retains staged bytes and records transaction-discard deletion', async () => {
  const value = await fixture('dispatch');
  try {
    const adapter = createVersionedFilesystemDispatchArtifactStorage(value.live, value.publisher);
    const key = 'dispatch-documents/issued-waybill.pdf';
    await adapter.stage({ storageKey: key, bytes: Buffer.from('APPROVED DISPATCH PDF 0.00000001') });
    assert.equal(Buffer.from(await adapter.read(key)).toString(), 'APPROVED DISPATCH PDF 0.00000001');
    const [first] = fs.readdirSync(path.join(value.store, 'versions'));
    await adapter.discard(key);
    assert.equal(await adapter.read(key), null);
    assert.equal((await value.publisher.readVersion(first.slice(0, -5))).toString(), 'APPROVED DISPATCH PDF 0.00000001');
    assert.equal(fs.readdirSync(path.join(value.store, 'versions')).length, 2);
    assert.throws(() => createVersionedFilesystemDispatchArtifactStorage(value.root, value.publisher), /FILE_VERSION_STORAGE_ROOT_MISMATCH/);
    await assert.rejects(adapter.stage({ storageKey: '../outside.pdf', bytes: Buffer.from('rejected') }), /Invalid dispatch artifact storage key/);
  } finally { await value.work.stopAndDrain(1000); }
});

test('a refused duplicate create preserves the acknowledged artifact without leaving unfinished mutation work', async () => {
  const value = await fixture('duplicate');
  try {
    const first = await value.publisher.publish('invoice.pdf', Buffer.from('APPROVED ORIGINAL'));
    await assert.rejects(value.publisher.publish('invoice.pdf', Buffer.from('DUPLICATE')), /FILE_VERSION_ALREADY_EXISTS/);
    assert.deepEqual(fs.readdirSync(path.join(value.store, 'pending')), []);
    assert.equal(fs.readFileSync(path.join(value.live, 'invoice.pdf'), 'utf8'), 'APPROVED ORIGINAL');
    assert.equal((await value.publisher.readVersion(first)).toString(), 'APPROVED ORIGINAL');
    assert.throws(() => value.work.assertActive(), /RUNTIME_WORK_CONTEXT_NOT_ACTIVE/);
  } finally { await value.work.stopAndDrain(1000); }
});

test('an actual exclusive cut seals already retained versions and refuses untracked live mutations', async () => {
  const value = await fixture('seal');
  const descriptor = fs.openSync(value.gate, 'r');
  const lock = () => {
    const result = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], {
      stdio: ['ignore', 'ignore', 'pipe', descriptor],
    });
    assert.equal(result.status, 0, result.stderr.toString());
  };
  const unlock = () => {
    const result = spawnSync('/usr/bin/flock', ['--unlock', '3'], { stdio: ['ignore', 'ignore', 'pipe', descriptor] });
    assert.equal(result.status, 0);
  };
  try {
    const original = await value.publisher.publish('invoice.pdf', Buffer.from('FIRST RETAINED VALUE'));
    await assert.rejects(value.publisher.seal('1'.repeat(64), descriptor), /FILE_VERSION_EXCLUSIVE_GATE_REQUIRED/);
    lock();
    const first = await value.publisher.seal('1'.repeat(64), descriptor);
    assert.deepEqual(first.manifest.heads, [{ key: 'invoice.pdf', sha256: original }]);
    unlock();
    const second = await value.publisher.publish('invoice.pdf', Buffer.from('SECOND LIVE VALUE'), { replace: true });
    assert.equal((await value.publisher.readVersion(first.manifest.heads[0].sha256)).toString(), 'FIRST RETAINED VALUE');
    lock();
    assert.deepEqual((await value.publisher.seal('2'.repeat(64), descriptor)).manifest.heads, [{ key: 'invoice.pdf', sha256: second }]);
    fs.writeFileSync(path.join(value.live, 'invoice.pdf'), 'SAME-SIZE MUTATED!');
    await assert.rejects(value.publisher.seal('3'.repeat(64), descriptor), /FILE_VERSION_UNTRACKED_LIVE_CHANGE/);
    assert.equal(fs.existsSync(path.join(value.store, 'seals', '3'.repeat(64) + '.json')), false);
  } finally { unlock(); fs.closeSync(descriptor); await value.work.stopAndDrain(1000); }
});

test('independent object copies detect corruption without damaging identical retained bytes', async () => {
  const value = await fixture('corruption');
  try {
    const first = await value.publisher.publish('first.pdf', Buffer.from('EXACT SAME PRIVATE BYTES'));
    const second = await value.publisher.publish('second.pdf', Buffer.from('EXACT SAME PRIVATE BYTES'));
    const objects = fs.readdirSync(path.join(value.store, 'objects'));
    assert.equal(objects.length, 2);
    const firstRecord = JSON.parse(fs.readFileSync(path.join(value.store, 'versions', first + '.json')));
    const object = path.join(value.store, 'objects', firstRecord.object.name);
    assert.equal(fs.statSync(object).nlink, 1);
    assert.notEqual(fs.statSync(object).ino, fs.statSync(path.join(value.live, 'first.pdf')).ino);
    fs.chmodSync(object, 0o600); fs.writeFileSync(object, 'X'.repeat(24)); fs.chmodSync(object, 0o400);
    await assert.rejects(value.publisher.readVersion(first), /FILE_VERSION_OBJECT_CHANGED/);
    assert.equal((await value.publisher.readVersion(second)).toString(), 'EXACT SAME PRIVATE BYTES');
  } finally { await value.work.stopAndDrain(1000); }
});

test('separate admitted processes cannot overwrite each other during concurrent create', async () => {
  const value = await fixture('race');
  try {
    const run = bytes => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [__filename, 'race-owner', bytes], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', error = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 && !signal ? resolve(JSON.parse(output)) : reject(Error(error)));
    });
    const results = await Promise.all([run('FIRST PROCESS 123456789.12345678'), run('SECOND PROCESS 0.00000001')]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.ok(['EEXIST', 'FILE_VERSION_ALREADY_EXISTS'].includes(results.find(result => !result.ok).code));
    const winner = results.find(result => result.ok);
    assert.equal(fs.readFileSync(path.join(value.live, 'invoice.pdf'), 'utf8'), winner.bytes);
    assert.equal((await value.publisher.readVersion(winner.sha256)).toString(), winner.bytes);
    assert.deepEqual(fs.readdirSync(path.join(value.store, 'pending')), []);
  } finally { await value.work.stopAndDrain(1000); }
});

test('actual process death after live publication retains unresolved intent and refuses replacement and sealing', async () => {
  const child = spawn(process.execPath, [__filename, 'lost-owner'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', error = '';
  child.stderr.on('data', bytes => { error += bytes; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('LOST_OWNER_OBSERVATION_TIMEOUT ' + error)), 10000);
    child.stdout.on('data', bytes => {
      output += bytes;
      if (output.includes('ACTUAL_LIVE_FILE_PUBLISHED\n')) { clearTimeout(timer); resolve(); }
    });
    child.once('error', reject);
  });
  const root = path.join(__dirname, 'lost-owner'), gate = path.join(root, 'deployment-write-admission.lock');
  assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', gate, '/usr/bin/true']).status, 1);
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  assert.equal(child.kill('SIGKILL'), true);
  assert.deepEqual(await closed, { code: null, signal: 'SIGKILL' });
  assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', gate, '/usr/bin/true']).status, 0);
  const pending = fs.readdirSync(path.join(root, 'versions', 'pending'));
  assert.equal(pending.length, 1);
  const original = fs.readFileSync(path.join(root, 'versions', 'pending', pending[0]));
  const replacement = await fixture('lost-owner', true);
  try {
    await assert.rejects(replacement.publisher.publish('invoice.pdf', Buffer.from('WRONG REPLAY'), { replace: true }), { code: 'EEXIST' });
    assert.equal(fs.readFileSync(path.join(root, 'live', 'invoice.pdf'), 'utf8'), 'COMMITTED WITH LOST OWNER');
    assert.deepEqual(fs.readFileSync(path.join(root, 'versions', 'pending', pending[0])), original);
    const fd = fs.openSync(gate, 'r');
    try {
      assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] }).status, 0);
      await assert.rejects(replacement.publisher.seal('f'.repeat(64), fd), /FILE_VERSION_PENDING_OPERATION/);
    } finally { fs.closeSync(fd); }
  } finally { await replacement.work.stopAndDrain(1000); }
});

function seedReservations(value, keys) {
  const root = path.join(value.store, 'reservations'); fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const key of keys) {
    const id = createHash('sha256').update(key).digest('hex');
    const file = path.join(root, id + '.json');
    fs.writeFileSync(file, JSON.stringify({ format: 'sabalan-file-key-reservation/v1', key }) + '\n', { flag: 'wx', mode: 0o400 });
    // Independently encode completed generation-one deletions of absent paths,
    // which the public remove operation supports. These are real immutable
    // predecessor records and heads, not a mocked count/capacity result.
    const raw = JSON.stringify({ format: 'sabalan-file-version/v1', generation: 1, key,
      live: null, object: null, operation: 'DELETE', previousSha256: null }) + '\n';
    const sha256 = createHash('sha256').update(raw).digest('hex');
    fs.writeFileSync(path.join(value.store, 'versions', sha256 + '.json'), raw, { flag: 'wx', mode: 0o400 });
    fs.writeFileSync(path.join(value.store, 'heads', id + '.json'), raw, { flag: 'wx', mode: 0o400 });
  }
  const fd = fs.openSync(root, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

test('exhausted distinct-key and directory reservations refuse before live mutation and preserve the previous cut', async () => {
  for (const kind of ['keys', 'directories']) {
    const value = await fixture('capacity-' + kind);
    try {
      const retained = await value.publisher.publish('kept.pdf', Buffer.from('PREVIOUS SEALABLE DATA'));
      seedReservations(value, kind === 'keys' ? Array.from({ length: 9999 }, (_, index) => 'reserved-' + index + '.pdf')
        : Array.from({ length: 19 }, (_, index) => 'r' + index + '/' + Array(500).fill('x').join('/') + '/f'));
      const key = kind === 'keys' ? 'excess.pdf' : 'new/' + Array(500).fill('y').join('/') + '/f';
      await assert.rejects(value.publisher.publish(key, Buffer.from('MUST NOT ACKNOWLEDGE')), /FILE_VERSION_INVENTORY_CAPACITY/);
      assert.equal(fs.existsSync(path.join(value.live, key)), false);
      assert.deepEqual(fs.readdirSync(path.join(value.store, 'pending')), []);
      const fd = fs.openSync(value.gate, 'r');
      try {
        assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] }).status, 0);
        const coldStart = performance.now();
        const cut = await value.publisher.seal('e'.repeat(64), fd);
        assert.equal(cut.manifest.heads.length, kind === 'keys' ? 10000 : 20);
        assert.deepEqual(cut.manifest.heads.find(head => head.key === 'kept.pdf'), { key: 'kept.pdf', sha256: retained });
        const coldMilliseconds = performance.now() - coldStart, warmStart = performance.now();
        const warm = await value.publisher.seal('b'.repeat(64), fd);
        assert.deepEqual(warm.manifest.heads, cut.manifest.heads);
        console.log(JSON.stringify({ event: 'file-version-component-cut-timing', kind, heads: cut.manifest.heads.length,
          coldSeedAdoptionMilliseconds: coldMilliseconds, warmMilliseconds: performance.now() - warmStart,
          productionBudgetProof: false }));
      } finally { fs.closeSync(fd); }
    } finally { await value.work.stopAndDrain(1000); }
  }
});

test('different processes reserve the last distinct-key capacity atomically', async () => {
  const value = await fixture('capacity-race');
  try {
    await value.publisher.publish('kept.pdf', Buffer.from('RETAINED ORIGINAL'));
    seedReservations(value, Array.from({ length: 9998 }, (_, index) => 'reserved-' + index + '.pdf'));
    const run = (key, bytes) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [__filename, 'race-owner', bytes, 'capacity-race', key], { stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', error = '';
      child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { error += chunk; });
      child.once('error', reject);
      child.once('close', (code, signal) => code === 0 && !signal ? resolve(JSON.parse(output)) : reject(Error(error)));
    });
    const results = await Promise.all([run('first.pdf', 'FIRST PROCESS'), run('second.pdf', 'SECOND PROCESS')]);
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.ok(['FILE_VERSION_INVENTORY_CAPACITY', 'FILE_VERSION_CAPACITY_BUSY'].includes(results.find(result => !result.ok).code));
    assert.equal(fs.readdirSync(path.join(value.store, 'reservations')).length, 10000);
    assert.deepEqual(fs.readdirSync(path.join(value.store, 'pending')), []);
    assert.equal(fs.readdirSync(value.live).length, 2);
  } finally { await value.work.stopAndDrain(1000); }
});

test('escaped key metadata is reserved before a write can exceed the 16 MiB cut budget', async () => {
  const value = await fixture('capacity-metadata');
  try {
    const retained = await value.publisher.publish('kept.pdf', Buffer.from('RETAINED METADATA BOUNDARY'));
    const fd = fs.openSync(value.gate, 'r'); let baseline;
    try {
      assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'pipe', fd] }).status, 0);
      baseline = await value.publisher.seal('d'.repeat(64), fd);
    } finally { fs.closeSync(fd); }
    const size = key => Buffer.byteLength(JSON.stringify({ key, sha256: '0'.repeat(64) }) + '\n');
    let used = Buffer.byteLength(JSON.stringify({ ...baseline.manifest, heads: [] }) + '\n') + size('kept.pdf');
    const prefix = ['\x01'.repeat(240), '\x02'.repeat(240), '\x03'.repeat(240)].join('/') + '/' + '\x04'.repeat(240);
    const keys = []; let key;
    for (let index = 0; ; index++) {
      key = prefix + index;
      if (used + size(key) > 16 * 1024 * 1024) break;
      keys.push(key); used += size(key);
    }
    assert.ok(keys.length < 10000);
    seedReservations(value, keys);
    await assert.rejects(value.publisher.publish(key, Buffer.from('MUST NOT ACKNOWLEDGE')), /FILE_VERSION_INVENTORY_CAPACITY/);
    assert.deepEqual(fs.readdirSync(value.live), ['kept.pdf']);
    assert.deepEqual(fs.readdirSync(path.join(value.store, 'pending')), []);
    assert.equal((await value.publisher.readVersion(retained)).toString(), 'RETAINED METADATA BOUNDARY');
    const completed = fs.openSync(value.gate, 'r');
    try {
      assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'pipe', completed] }).status, 0);
      const cut = await value.publisher.seal('c'.repeat(64), completed);
      assert.equal(cut.manifest.heads.length, keys.length + 1);
      assert.ok(Buffer.byteLength(JSON.stringify(cut.manifest) + '\n') <= 16 * 1024 * 1024);
    } finally { fs.closeSync(completed); }
  } finally { await value.work.stopAndDrain(1000); }
});

}
