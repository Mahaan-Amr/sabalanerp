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

if (process.argv[2] === 'lost-move-owner') {
  void (async () => {
    const v = await fixture();
    const original = await v.publisher.publish('application.pdf', Buffer.from('REAL LOST MOVE ORIGINAL'));
    const publication = require('./durableFilePublication'), publish = publication.publishDurableFile;
    publication.publishDurableFile = async (...args) => {
      const result = await publish(...args);
      if (args[0] === path.join(v.store, 'heads', require('node:crypto').createHash('sha256').update('staged.pdf').digest('hex') + '.json')) {
        console.log(JSON.stringify({ event: 'MOVE_DESTINATION_HEAD_DURABLE', rootName: path.basename(v.root), original }));
        setInterval(() => {}, 1000); await new Promise(() => {});
      }
      return result;
    };
    await v.publisher.move('application.pdf', 'staged.pdf', original);
    throw Error('Unexpected completed move');
  })().catch(error => { console.error(error); process.exitCode = 1; });
} else {

test('private HR staging preserves exact receipts and refuses to certify erasure while retained versions exist', async () => {
  const v = await fixture();
  try {
    const { createVersionedHiringFileTransaction } = require('./hrVersionedFileTransaction');
    const files = createVersionedHiringFileTransaction(v.live, v.publisher);
    const original = await v.publisher.publish('applicant.pdf', Buffer.from('PRIVATE HR DOCUMENT'));
    const stage = await files.stage('applicant.pdf', 'deletion-operation', original);
    assert.equal(fs.existsSync(path.join(v.live, 'applicant.pdf')), false);
    const replacement = await v.publisher.publish('applicant.pdf', Buffer.from('NEW HR DOCUMENT'));
    await assert.rejects(files.restore(stage), /FILE_VERSION_ALREADY_EXISTS/);
    assert.equal(fs.readFileSync(path.join(v.live, 'applicant.pdf'), 'utf8'), 'NEW HR DOCUMENT');
    await v.publisher.removeUpload('applicant.pdf', replacement);
    await assert.rejects(files.restore(stage), /FILE_VERSION_MOVE_DESTINATION_CHANGED/);
    assert.equal(fs.existsSync(path.join(v.live, 'applicant.pdf')), false);
    const current = await v.publisher.publish('applicant.pdf', Buffer.from('CURRENT HR DOCUMENT'));
    const second = await files.stage('applicant.pdf', 'next-deletion-operation', current);
    const deleted = await files.commit(second);
    assert.equal(deleted.physicalErasure, 'UNPROVEN');
    assert.equal(deleted.status, 'LIVE_REMOVED_RETAINED_COPIES_PENDING');
    assert.equal(fs.existsSync(path.join(v.live, '.deletion-trash/next-deletion-operation/applicant.pdf')), false);
    assert.equal((await v.publisher.readVersion(original)).toString(), 'PRIVATE HR DOCUMENT');
    assert.equal((await v.publisher.readVersion(second.stagedVersionSha256)).toString(), 'CURRENT HR DOCUMENT');
    await assert.rejects(files.commit(second), /FILE_VERSION_UPLOAD_CHANGED/);
    v.lock(); await v.publisher.seal('c'.repeat(64), v.fd); v.unlock();
  } finally { await v.close(); }
});

test('conditional relocation binds a deleted destination generation and refuses reused staging history', async () => {
  const v = await fixture();
  try {
    const original = await v.publisher.publish('source.pdf', Buffer.from('ORIGINAL'));
    const staged = await v.publisher.move('source.pdf', 'stage.pdf', original, null);
    const newer = await v.publisher.publish('source.pdf', Buffer.from('NEW USER FILE'));
    const deleted = await v.publisher.removeUpload('source.pdf', newer);
    await assert.rejects(v.publisher.move('stage.pdf', 'source.pdf', staged.destinationVersionSha256,
      staged.sourceVersionSha256), /FILE_VERSION_MOVE_DESTINATION_CHANGED/);
    assert.equal(fs.existsSync(path.join(v.live, 'source.pdf')), false);
    assert.equal(fs.readFileSync(path.join(v.live, 'stage.pdf'), 'utf8'), 'ORIGINAL');
    const restored = await v.publisher.move('stage.pdf', 'source.pdf', staged.destinationVersionSha256, deleted);
    await assert.rejects(v.publisher.move('source.pdf', 'stage.pdf', restored.destinationVersionSha256, null),
      /FILE_VERSION_MOVE_DESTINATION_CHANGED/);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
    assert.equal(fs.readFileSync(path.join(v.live, 'source.pdf'), 'utf8'), 'ORIGINAL');
  } finally { await v.close(); }
});

test('a version-bound move retains both histories and restores without clobbering a new file', async () => {
  const v = await fixture();
  try {
    const original = await v.publisher.publish('application.pdf', Buffer.from('ORIGINAL PERSONNEL FILE 123456789.12345678'));
    const staged = await v.publisher.move('application.pdf', '.deletion-trash/op/application.pdf', original);
    assert.equal(fs.existsSync(path.join(v.live, 'application.pdf')), false);
    assert.equal(fs.readFileSync(path.join(v.live, '.deletion-trash/op/application.pdf'), 'utf8'), 'ORIGINAL PERSONNEL FILE 123456789.12345678');
    assert.equal((await v.publisher.readVersion(original)).toString(), 'ORIGINAL PERSONNEL FILE 123456789.12345678');
    assert.equal(await v.publisher.readVersion(staged.sourceVersionSha256), null);
    assert.equal((await v.publisher.readVersion(staged.destinationVersionSha256)).toString(), 'ORIGINAL PERSONNEL FILE 123456789.12345678');
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
    const replacement = await v.publisher.publish('application.pdf', Buffer.from('NEW LEGITIMATE APPLICATION'));
    await assert.rejects(v.publisher.move('.deletion-trash/op/application.pdf', 'application.pdf', staged.destinationVersionSha256), /FILE_VERSION_ALREADY_EXISTS/);
    assert.equal(fs.readFileSync(path.join(v.live, 'application.pdf'), 'utf8'), 'NEW LEGITIMATE APPLICATION');
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
    await v.publisher.removeUpload('application.pdf', replacement);
    const restored = await v.publisher.move('.deletion-trash/op/application.pdf', 'application.pdf', staged.destinationVersionSha256);
    assert.equal(fs.readFileSync(path.join(v.live, 'application.pdf'), 'utf8'), 'ORIGINAL PERSONNEL FILE 123456789.12345678');
    assert.equal(await v.publisher.readVersion(restored.sourceVersionSha256), null);
    v.lock(); const cut = await v.publisher.seal('d'.repeat(64), v.fd); v.unlock();
    assert.equal(cut.manifest.heads.length, 2);
  } finally { await v.close(); }
});

test('HR cleanup rejects another root, malformed receipts and stale staged replacements before changing any file', async () => {
  const v = await fixture();
  try {
    const { createVersionedHiringFileTransaction } = require('./hrVersionedFileTransaction');
    assert.throws(() => createVersionedHiringFileTransaction(v.root, v.publisher), /FILE_VERSION_STORAGE_ROOT_MISMATCH/);
    const files = createVersionedHiringFileTransaction(v.live, v.publisher);
    const original = await v.publisher.publish('applicant.pdf', Buffer.from('ORIGINAL HR FILE'));
    const stage = await files.stage('applicant.pdf', 'operation', original);
    await assert.rejects(files.restore({ ...stage, operationId: '../escape' }), /HR_FILE_STAGE_RECEIPT_INVALID/);
    await assert.rejects(files.commit({ ...stage, extra: 'unknown' }), /HR_FILE_STAGE_RECEIPT_INVALID/);
    await assert.rejects(files.stage('applicant.pdf', 'operation', 'invalid'), /HR_FILE_STAGE_RECEIPT_INVALID/);
    const key = '.deletion-trash/operation/applicant.pdf';
    const replacement = await v.publisher.publish(key, Buffer.from('LEGITIMATE STAGED REPLACEMENT'), { replace: true });
    await assert.rejects(files.commit(stage), /FILE_VERSION_UPLOAD_CHANGED/);
    await assert.rejects(files.restore(stage), /FILE_VERSION_MOVE_SOURCE_CHANGED/);
    assert.equal(fs.readFileSync(path.join(v.live, key), 'utf8'), 'LEGITIMATE STAGED REPLACEMENT');
    assert.equal((await v.publisher.readVersion(replacement)).toString(), 'LEGITIMATE STAGED REPLACEMENT');
    assert.equal(fs.existsSync(path.join(v.live, 'applicant.pdf')), false);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
  } finally { await v.close(); }
});

test('both move keys remain owned through the actual destination head and stale source receipts never move newer bytes', async () => {
  const v = await fixture(), publication = require('./durableFilePublication'), publish = publication.publishDurableFile;
  let release, observed;
  const wait = new Promise(resolve => { observed = resolve; });
  const hold = new Promise(resolve => { release = resolve; });
  let operation;
  try {
    const old = await v.publisher.publish('source.pdf', Buffer.from('OLD'));
    const current = await v.publisher.publish('source.pdf', Buffer.from('NEW CURRENT'), { replace: true });
    await assert.rejects(v.publisher.move('source.pdf', 'target.pdf', old), /FILE_VERSION_MOVE_SOURCE_CHANGED/);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
    publication.publishDurableFile = async (...args) => {
      const result = await publish(...args);
      const target = require('node:crypto').createHash('sha256').update('target.pdf').digest('hex');
      if (args[0] === path.join(v.store, 'heads', target + '.json')) { observed(); await hold; }
      return result;
    };
    operation = v.publisher.move('source.pdf', 'target.pdf', current);
    await wait;
    assert.equal(fs.readdirSync(path.join(v.store, 'pending')).length, 2);
    await assert.rejects(v.publisher.publish('source.pdf', Buffer.from('RACE'), { replace: true }), { code: 'EEXIST' });
    await assert.rejects(v.publisher.remove('target.pdf'), { code: 'EEXIST' });
    await assert.rejects(v.publisher.move('target.pdf', 'source.pdf', current), { code: 'EEXIST' });
    await v.publisher.publish('unrelated.pdf', Buffer.from('OTHER USER CAN STILL WRITE'));
    release(); const result = await operation;
    assert.equal((await v.publisher.readVersion(result.destinationVersionSha256)).toString(), 'NEW CURRENT');
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
  } finally { release(); if (operation) await operation.catch(() => {}); publication.publishDurableFile = publish; await v.close(); }
});

test('a busy second key retires only the untouched first claim and preserves the other owner', async () => {
  const v = await fixture();
  try {
    const source = await v.publisher.publish('a.pdf', Buffer.from('SOURCE SURVIVES BUSY TARGET'));
    const target = require('node:crypto').createHash('sha256').update('z.pdf').digest('hex') + '.json';
    const pending = path.join(v.store, 'pending', target);
    fs.writeFileSync(pending, 'UNRESOLVED OTHER OWNER', { flag: 'wx', mode: 0o400 });
    const before = fs.statSync(pending, { bigint: true });
    await assert.rejects(v.publisher.move('a.pdf', 'z.pdf', source), { code: 'EEXIST' });
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), [target]);
    assert.equal(fs.statSync(pending, { bigint: true }).ino, before.ino);
    assert.equal(fs.readFileSync(pending, 'utf8'), 'UNRESOLVED OTHER OWNER');
    assert.equal(fs.readFileSync(path.join(v.live, 'a.pdf'), 'utf8'), 'SOURCE SURVIVES BUSY TARGET');
    v.lock(); await assert.rejects(v.publisher.seal('e'.repeat(64), v.fd), /FILE_VERSION_PENDING_OPERATION/); v.unlock();
  } finally { await v.close(); }
});

test('real concurrent reservation refusal retires only the unstarted move pair', async () => {
  const v = await fixture(), publication = require('./durableFilePublication'), publish = publication.publishDurableFile;
  let release, observed;
  const ready = new Promise(resolve => { observed = resolve; }), hold = new Promise(resolve => { release = resolve; });
  let other;
  try {
    const source = await v.publisher.publish('source.pdf', Buffer.from('ORIGINAL SOURCE'));
    const otherId = require('node:crypto').createHash('sha256').update('other.pdf').digest('hex');
    publication.publishDurableFile = async (...args) => {
      const result = await publish(...args);
      if (args[0] === path.join(v.store, 'reservations', otherId + '.json')) { observed(); await hold; }
      return result;
    };
    other = v.publisher.publish('other.pdf', Buffer.from('ACTUAL OTHER RESERVATION OWNER'));
    await ready;
    const before = fs.readdirSync(path.join(v.store, 'pending')).sort(); assert.equal(before.length, 2);
    await assert.rejects(v.publisher.move('source.pdf', 'target.pdf', source), /FILE_VERSION_CAPACITY_BUSY/);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')).sort(), before);
    await v.publisher.publish('source.pdf', Buffer.from('SOURCE STILL WRITABLE'), { replace: true });
    release(); await other;
    v.lock(); await v.publisher.seal('a'.repeat(64), v.fd); v.unlock();
  } finally { release(); if (other) await other.catch(() => {}); publication.publishDurableFile = publish; await v.close(); }
});

test('full reservation inventory refuses the move without stranding unchanged source and destination', async () => {
  const v = await fixture();
  try {
    const source = await v.publisher.publish('source.pdf', Buffer.from('SOURCE AT CAPACITY'));
    for (let i = 0; i < 9999; i++) {
      const key = 'retained-' + i + '.pdf', id = require('node:crypto').createHash('sha256').update(key).digest('hex');
      fs.writeFileSync(path.join(v.store, 'reservations', id + '.json'), JSON.stringify({ format: 'sabalan-file-key-reservation/v1', key }) + '\n', { flag: 'wx', mode: 0o400 });
    }
    await assert.rejects(v.publisher.move('source.pdf', 'target.pdf', source), /FILE_VERSION_INVENTORY_CAPACITY/);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
    assert.equal(fs.readdirSync(path.join(v.store, 'reservations')).length, 10000);
    assert.equal(fs.readFileSync(path.join(v.live, 'source.pdf'), 'utf8'), 'SOURCE AT CAPACITY');
    await v.publisher.publish('source.pdf', Buffer.from('EXISTING SOURCE STILL WRITABLE'), { replace: true });
    v.lock(); await v.publisher.seal('b'.repeat(64), v.fd); v.unlock();
  } finally { await v.close(); }
});

test('actual process death between destination publication and source deletion preserves both claims and all original bytes', async () => {
  const child = spawn(process.execPath, [__filename, 'lost-move-owner'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const receipt = await new Promise((resolve, reject) => {
    child.stdout.on('data', data => {
      stdout += data;
      for (const line of stdout.split('\n').filter(Boolean)) {
        try { const value = JSON.parse(line); if (value.event === 'MOVE_DESTINATION_HEAD_DURABLE') resolve(value); } catch {}
      }
    });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', reject); child.once('exit', () => reject(Error('MOVE_OWNER_EXITED_BEFORE_OBSERVATION ' + stderr)));
  });
  assert.match(receipt.rootName, /^[a-f0-9]{32}$/); assert.match(receipt.original, /^[a-f0-9]{64}$/);
  const closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  assert.equal(child.kill('SIGKILL'), true);
  assert.deepEqual(await closed, { code: null, signal: 'SIGKILL' });
  const v = await fixture(receipt.rootName, true);
  try {
    for (const name of ['application.pdf', 'staged.pdf']) assert.equal(fs.readFileSync(path.join(v.live, name), 'utf8'), 'REAL LOST MOVE ORIGINAL');
    assert.equal((await v.publisher.readVersion(receipt.original)).toString(), 'REAL LOST MOVE ORIGINAL');
    const pending = fs.readdirSync(path.join(v.store, 'pending')); assert.equal(pending.length, 2);
    const records = pending.map(name => JSON.parse(fs.readFileSync(path.join(v.store, 'pending', name), 'utf8')));
    assert.equal(records[0].move.operationId, records[1].move.operationId);
    await assert.rejects(v.publisher.move('application.pdf', 'staged.pdf', receipt.original), { code: 'EEXIST' });
    for (const name of ['application.pdf', 'staged.pdf']) await assert.rejects(v.publisher.remove(name), { code: 'EEXIST' });
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), pending);
    v.lock(); await assert.rejects(v.publisher.seal('f'.repeat(64), v.fd), /FILE_VERSION_PENDING_OPERATION/); v.unlock();
  } finally { await v.close(); }
});

}
