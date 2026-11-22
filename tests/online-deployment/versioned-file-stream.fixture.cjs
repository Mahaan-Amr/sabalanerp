'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkContext } = require('./runtimeWorkContext');
const { VersionedFilePublication } = require('./versionedFilePublication');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(assertOwner = () => {}) {
  const root = path.join(__dirname, randomBytes(16).toString('hex')); fs.mkdirSync(root, { mode: 0o700 });
  const gate = path.join(root, 'deployment-write-admission.lock'); fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const stat = fs.statSync(gate, { bigint: true }), runtimeId = randomBytes(32).toString('hex');
  const identity = { device: String(stat.dev), inode: String(stat.ino), ownerUid: Number(stat.uid) };
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  const journalRoot = path.join(root, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  const tasks = new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {});
  const work = new RuntimeWorkContext(tasks, assertOwner);
  const store = path.join(root, 'versions'), live = path.join(root, 'live');
  for (const directory of [store, live]) fs.mkdirSync(directory, { mode: 0o700 });
  const publisher = await VersionedFilePublication.open(store, live, work);
  return { root, gate, work, store, live, publisher };
}

async function seal(value) {
  const captureId = randomBytes(32).toString('hex'), descriptor = fs.openSync(value.gate, 'r');
  try {
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'pipe', descriptor] }).status, 0);
    return { captureId, ...await value.publisher.seal(captureId, descriptor) };
  } finally { fs.closeSync(descriptor); }
}


const { Readable } = require('node:stream');

test('streamed files retain exact independent bytes and old versions across replacement without whole-file buffering', async () => {
  const value = await fixture();
  try {
    const expected = createHash('sha256'); let chunks = 0;
    async function* source() { for (let index = 0; index < 257; index++) { const chunk = Buffer.alloc(65536, index % 251); expected.update(chunk); chunks++; yield chunk; } }
    const original = await value.publisher.publishStream('large.pdf', Readable.from(source(), { objectMode: false, highWaterMark: 65536 }));
    assert.equal(chunks, 257);
    const first = JSON.parse(fs.readFileSync(path.join(value.store, 'versions', original + '.json')));
    assert.equal(first.object.bytes, 257 * 65536); assert.equal(first.object.sha256, expected.digest('hex'));
    assert.equal(hash(fs.readFileSync(path.join(value.live, 'large.pdf'))), first.object.sha256);
    const originalCut = await seal(value);
    await value.publisher.publishStream('large.pdf', Readable.from([Buffer.from('CURRENT STREAMED DATA 0.00000001')]), { replace: true });
    assert.equal(hash(await value.publisher.readVersion(original)), first.object.sha256);
    assert.equal(fs.readFileSync(path.join(value.live, 'large.pdf'), 'utf8'), 'CURRENT STREAMED DATA 0.00000001');
    const target = path.join(value.root, 'independently-restored');
    const restored = spawnSync('python3', ['-I', '-B', path.join(__dirname, 'reader.worker.py'), value.store,
      originalCut.captureId, originalCut.sha256, target], { encoding: 'utf8' });
    assert.equal(restored.signal, null); assert.equal(restored.status, 0, restored.stdout + restored.stderr);
    assert.equal(hash(fs.readFileSync(path.join(target, 'files/large.pdf'))), first.object.sha256);
    assert.equal((await seal(value)).manifest.heads.length, 1);
    assert.deepEqual(fs.readdirSync(path.join(value.store, 'pending')), []);
  } finally { await value.work.stopAndDrain(2000); }
});

test('an interrupted incoming stream never acknowledges a partial live file and preserves its unknown intent', async () => {
  const value = await fixture();
  try {
    async function* source() { yield Buffer.alloc(65536, 71); throw Error('ACTUAL_SOURCE_INTERRUPTED'); }
    await assert.rejects(value.publisher.publishStream('interrupted.pdf', Readable.from(source())), /ACTUAL_SOURCE_INTERRUPTED/);
    assert.equal(fs.existsSync(path.join(value.live, 'interrupted.pdf')), false);
    const pending = fs.readdirSync(path.join(value.store, 'pending')); assert.equal(pending.length, 1);
    const original = fs.readFileSync(path.join(value.store, 'pending', pending[0]));
    await assert.rejects(value.publisher.publish('interrupted.pdf', Buffer.from('WRONG REPLAY')), { code: 'EEXIST' });
    assert.deepEqual(fs.readFileSync(path.join(value.store, 'pending', pending[0])), original);
    await assert.rejects(seal(value), /FILE_VERSION_PENDING_OPERATION/);
  } finally { await value.work.stopAndDrain(2000); }
});

test('an early source error is observed while native admission is pending and cannot crash or publish', async () => {
  const value = await fixture();
  try {
    const source = new Readable({ read() {} });
    const task = value.publisher.publishStream('early.pdf', source);
    source.destroy(Error('ACTUAL_EARLY_SOURCE_ERROR'));
    await assert.rejects(task, /ACTUAL_EARLY_SOURCE_ERROR/);
    assert.equal(fs.existsSync(path.join(value.live, 'early.pdf')), false);
  } finally { await value.work.stopAndDrain(2000); }
});

test('actual incoming-stream destruction must complete before its native admission can drain', async () => {
  const value = await fixture(); let completeDestruction, entered;
  const destruction = new Promise(resolve => { entered = resolve; });
  const source = new Readable({ read() { this.push(Buffer.from('DURABLE STREAM 123456789.12345678')); this.push(null); },
    destroy(error, done) { entered(); completeDestruction = () => done(error); } });
  let settled = false;
  const action = value.publisher.publishStream('delayed.pdf', source).then(result => { settled = true; return result; });
  try {
    await destruction; await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(settled, false);
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 1);
    completeDestruction(); await action;
    assert.equal(fs.readFileSync(path.join(value.live, 'delayed.pdf'), 'utf8'), 'DURABLE STREAM 123456789.12345678');
  } finally { completeDestruction?.(); await action; await value.work.stopAndDrain(2000); }
});

test('same-size immutable-object damage between real stream publication and live read-back cannot be acknowledged', async () => {
  const value = await fixture(), durable = require('./durableFilePublication');
  const publish = durable.publishDurableStream; let damaged = false;
  durable.publishDurableStream = async (...args) => {
    const result = await publish(...args);
    if (args[0].startsWith(path.join(value.store, 'objects') + '/') && !damaged) {
      damaged = true; fs.chmodSync(args[0], 0o600);
      const descriptor = fs.openSync(args[0], 'r+');
      try { fs.writeSync(descriptor, Buffer.from('X'), 0, 1, 0); fs.fsyncSync(descriptor); }
      finally { fs.closeSync(descriptor); }
      fs.chmodSync(args[0], 0o400);
    }
    return result;
  };
  try {
    await assert.rejects(value.publisher.publishStream('corrupt.pdf', Readable.from([Buffer.from('ORIGINAL INPUT')])), /FILE_VERSION_OBJECT_CHANGED/);
    assert.equal(damaged, true);
    assert.equal(fs.existsSync(path.join(value.live, 'corrupt.pdf')), false);
    assert.deepEqual(fs.readdirSync(path.join(value.store, 'versions')), []);
    assert.equal(fs.readdirSync(path.join(value.store, 'pending')).length, 1);
    await assert.rejects(seal(value), /FILE_VERSION_PENDING_OPERATION/);
  } finally { durable.publishDurableStream = publish; await value.work.stopAndDrain(2000); }
});

test('owner revocation during real stream ingestion refuses publication and retains its unresolved intent', async () => {
  let valid = true;
  const value = await fixture(() => { if (!valid) throw Error('ACTUAL_STREAM_OWNER_REVOKED'); });
  try {
    async function* source() { yield Buffer.from('FIRST'); valid = false; yield Buffer.from('SECOND'); }
    await assert.rejects(value.publisher.publishStream('revoked.pdf', Readable.from(source())), /ACTUAL_STREAM_OWNER_REVOKED/);
    assert.equal(fs.existsSync(path.join(value.live, 'revoked.pdf')), false);
    assert.equal(fs.readdirSync(path.join(value.store, 'pending')).length, 1);
  } finally { valid = true; await value.work.stopAndDrain(2000); }
});

test('an empty stream is retained as an exact zero-byte immutable object and can be deleted normally', async () => {
  const value = await fixture();
  try {
    const sha256 = await value.publisher.publishStream('empty.pdf', Readable.from([]));
    const record = JSON.parse(fs.readFileSync(path.join(value.store, 'versions', sha256 + '.json')));
    assert.equal(record.object.bytes, 0); assert.equal(record.object.sha256, hash(Buffer.alloc(0)));
    assert.deepEqual(await value.publisher.readVersion(sha256), Buffer.alloc(0));
    await value.publisher.remove('empty.pdf'); assert.equal(fs.existsSync(path.join(value.live, 'empty.pdf')), false);
    assert.equal((await seal(value)).manifest.heads.length, 1);
  } finally { await value.work.stopAndDrain(2000); }
});

test('a source destruction failure after EOF cannot acknowledge a file or discard its persistent intent', async () => {
  const value = await fixture();
  try {
    const source = new Readable({ autoDestroy: false,
      read() { this.push(Buffer.from('INPUT WITH UNPROVEN CLOSE')); this.push(null); },
      destroy(_error, done) { done(Error('ACTUAL_SOURCE_DESTRUCTION_FAILED')); } });
    await assert.rejects(value.publisher.publishStream('unclosed.pdf', source), /ACTUAL_SOURCE_DESTRUCTION_FAILED/);
    assert.equal(fs.existsSync(path.join(value.live, 'unclosed.pdf')), false);
    assert.equal(fs.readdirSync(path.join(value.store, 'pending')).length, 1);
    await assert.rejects(seal(value), /FILE_VERSION_PENDING_OPERATION/);
  } finally { await value.work.stopAndDrain(2000); }
});

for (const failure of [false, true]) test('a stream suppressing close events retains real ownership until its delayed destroy ' + (failure ? 'fails' : 'completes'), async () => {
  const value = await fixture(); let completeDestruction, entered;
  const destruction = new Promise(resolve => { entered = resolve; });
  const source = new Readable({ autoDestroy: false, emitClose: false,
    read() { this.push(Buffer.from('NO CLOSE EVENT INPUT')); this.push(null); },
    destroy(_error, done) { entered(); completeDestruction = () => done(failure ? Error('ACTUAL_SUPPRESSED_CLOSE_FAILURE') : null); } });
  // Keep the negative implementation's late error observable without letting
  // that deliberately bad implementation crash the whole fixture process.
  const errors = []; source.on('error', error => errors.push(error.message));
  let settled = false;
  const action = value.publisher.publishStream('suppressed.pdf', source).then(sha256 => {
    settled = true; return { ok: true, sha256 };
  }, error => { settled = true; return { ok: false, error: error.message }; });
  try {
    await destruction; await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(settled, false, 'EOF without a close event cannot prove actual input destruction');
    assert.equal(fs.existsSync(path.join(value.live, 'suppressed.pdf')), false);
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 1);
    await assert.rejects(value.work.stopAndDrain(30), /RUNTIME_TASK_DRAIN_UNPROVEN/);
    completeDestruction(); const result = await action;
    assert.equal(source.closed, true);
    if (failure) {
      assert.deepEqual(result, { ok: false, error: 'ACTUAL_SUPPRESSED_CLOSE_FAILURE' });
      assert.deepEqual(errors, ['ACTUAL_SUPPRESSED_CLOSE_FAILURE']);
      assert.equal(fs.existsSync(path.join(value.live, 'suppressed.pdf')), false);
      assert.equal(fs.readdirSync(path.join(value.store, 'pending')).length, 1);
      await assert.rejects(seal(value), /FILE_VERSION_PENDING_OPERATION/);
    } else {
      assert.equal(result.ok, true);
      assert.equal(fs.readFileSync(path.join(value.live, 'suppressed.pdf'), 'utf8'), 'NO CLOSE EVENT INPUT');
    }
  } finally { completeDestruction?.(); await action; await value.work.stopAndDrain(2000); }
});

test('unconsumed duplicate input with suppressed close events must finish destruction before admission is released', async () => {
  const value = await fixture(); let completeDestruction, entered, reads = 0;
  const destruction = new Promise(resolve => { entered = resolve; });
  const source = new Readable({ emitClose: false,
    read() { reads++; this.push(Buffer.from('MUST NOT BE CONSUMED')); this.push(null); },
    destroy(_error, done) { entered(); completeDestruction = () => done(); } });
  let action, settled = false;
  try {
    await value.publisher.publish('existing.pdf', Buffer.from('RETAIN THE ORIGINAL'));
    action = value.publisher.publishStream('existing.pdf', source).then(result => {
      settled = true; return { ok: true, result };
    }, error => { settled = true; return { ok: false, error: error.code }; });
    await destruction; await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(settled, false); assert.equal(reads, 0);
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 1);
    assert.deepEqual(fs.readdirSync(path.join(value.store, 'pending')), []);
    assert.equal(fs.readFileSync(path.join(value.live, 'existing.pdf'), 'utf8'), 'RETAIN THE ORIGINAL');
    completeDestruction(); assert.deepEqual(await action, { ok: false, error: 'FILE_VERSION_ALREADY_EXISTS' });
    assert.equal(source.closed, true);
  } finally { completeDestruction?.(); if (action) await action; await value.work.stopAndDrain(2000); }
});
