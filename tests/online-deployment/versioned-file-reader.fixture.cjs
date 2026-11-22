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

async function fixture() {
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
  const work = new RuntimeWorkContext(tasks, () => {});
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

function restore(value, cut, target) {
  const result = spawnSync('python3', ['-I', '-B', path.join(__dirname, 'reader.worker.py'), value.store, cut.captureId, cut.sha256, target], { encoding: 'utf8' });
  assert.equal(result.signal, null, result.stderr);
  return { ...JSON.parse(result.stdout), status: result.status, stderr: result.stderr };
}

test('independent Python restores actual Node PUT/replacement/deletion cuts without live paths or mutable heads', async () => {
  const value = await fixture();
  try {
    const name = 'قرارداد/😀-\x01.pdf';
    await value.publisher.publish(name, Buffer.from('ORIGINAL 123456789.12345678'));
    await value.publisher.publish('attachment.pdf', Buffer.from('KEEP THE ORIGINAL ATTACHMENT'));
    const first = await seal(value);
    await value.publisher.publish(name, Buffer.from('CURRENT 0.00000001'), { replace: true });
    await value.publisher.remove('attachment.pdf');
    const second = await seal(value);
    // A later interrupted operation cannot invalidate a previously completed cut.
    fs.writeFileSync(path.join(value.store, 'pending', 'later-unresolved.json'), 'UNKNOWN LATER WORK', { flag: 'wx', mode: 0o400 });
    fs.renameSync(path.join(value.store, 'heads'), path.join(value.root, 'mutable-heads-unavailable'));
    fs.renameSync(value.live, path.join(value.root, 'live-unavailable'));
    const oldTarget = path.join(value.root, 'old-restored'), currentTarget = path.join(value.root, 'current-restored');
    const old = restore(value, first, oldTarget), current = restore(value, second, currentTarget);
    assert.equal(old.ok, true, old.stderr); assert.equal(current.ok, true, current.stderr);
    assert.equal(fs.readFileSync(path.join(oldTarget, 'files', name), 'utf8'), 'ORIGINAL 123456789.12345678');
    assert.equal(fs.readFileSync(path.join(oldTarget, 'files/attachment.pdf'), 'utf8'), 'KEEP THE ORIGINAL ATTACHMENT');
    assert.equal(fs.readFileSync(path.join(currentTarget, 'files', name), 'utf8'), 'CURRENT 0.00000001');
    assert.equal(fs.existsSync(path.join(currentTarget, 'files/attachment.pdf')), false);
    assert.equal(current.result.tombstones, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(currentTarget, 'complete.json'))), current.result);
    assert.equal(restore(value, first, oldTarget).ok, false, 'an existing target must never be adopted or repaired');
    const wrong = restore(value, { ...first, sha256: '0'.repeat(64) }, path.join(value.root, 'wrong-selection'));
    assert.equal(wrong.ok, false); assert.match(wrong.error, /SEAL_CHANGED/);
    assert.equal(fs.existsSync(path.join(value.root, 'wrong-selection')), false);
  } finally { await value.work.stopAndDrain(2000); }
});

test('a real materializer stopped after copying bytes retains its old cut while later admitted writes and EX sealing finish', async () => {
  const value = await fixture(); let child, closed, output = '';
  try {
    const original = Buffer.alloc(17 * 1024 * 1024, 61);
    await value.publisher.publish('large.pdf', original);
    await value.publisher.publish('attachment.pdf', Buffer.from('ORIGINAL ATTACHMENT'));
    const first = await seal(value), target = path.join(value.root, 'paused-restore');
    child = spawn('python3', ['-I', '-B', path.join(__dirname, 'reader.worker.py'), value.store, first.captureId, first.sha256, target, 'pause-after-copy'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
    closed = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal, stderr })));
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('REAL_READER_DID_NOT_COPY_BYTES ' + stderr)), 10000);
      child.stdout.on('data', bytes => { output += bytes; if (output.includes('ACTUAL_IMMUTABLE_BYTES_COPIED\n')) { clearTimeout(timer); resolve(); } });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      void closed.then(result => { if (!output.includes('ACTUAL_IMMUTABLE_BYTES_COPIED\n')) { clearTimeout(timer); reject(Error(JSON.stringify(result))); } });
    });
    assert.match(fs.readFileSync('/proc/' + child.pid + '/status', 'utf8'), /^State:\s+T/m);
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 0);
    await value.publisher.publish('large.pdf', Buffer.from('NEW ACKNOWLEDGED FILE'), { replace: true });
    await value.publisher.remove('attachment.pdf');
    const next = await seal(value); assert.notEqual(next.sha256, first.sha256);
    assert.equal(child.kill('SIGCONT'), true);
    assert.deepEqual(await closed, { code: 0, signal: null, stderr: '' });
    assert.deepEqual(fs.readFileSync(path.join(target, 'files/large.pdf')), original);
    assert.equal(fs.readFileSync(path.join(target, 'files/attachment.pdf'), 'utf8'), 'ORIGINAL ATTACHMENT');
    assert.equal(fs.readFileSync(path.join(value.live, 'large.pdf'), 'utf8'), 'NEW ACKNOWLEDGED FILE');
    assert.equal(JSON.parse(fs.readFileSync(path.join(target, 'complete.json'))).sealSha256, first.sha256);
  } finally {
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGCONT');
    if (closed) await closed;
    await value.work.stopAndDrain(2000);
  }
});

test('missing, same-size damaged, aliased and FIFO objects cannot produce a complete restore receipt', async () => {
  for (const kind of ['missing', 'same-size', 'symlink', 'hardlink', 'fifo']) {
    const value = await fixture();
    try {
      const sha256 = await value.publisher.publish('invoice.pdf', Buffer.from('ORIGINAL IMMUTABLE BYTES'));
      const cut = await seal(value), record = JSON.parse(fs.readFileSync(path.join(value.store, 'versions', sha256 + '.json')));
      const object = path.join(value.store, 'objects', record.object.name), target = path.join(value.root, 'refused');
      if (kind === 'same-size') { fs.chmodSync(object, 0o600); fs.writeFileSync(object, Buffer.alloc(record.object.bytes, 88)); fs.chmodSync(object, 0o400); }
      else if (kind === 'hardlink') fs.linkSync(object, path.join(value.root, 'aliased-object'));
      else {
        fs.unlinkSync(object);
        if (kind === 'symlink') fs.symlinkSync(path.join(value.live, 'invoice.pdf'), object);
        if (kind === 'fifo') assert.equal(spawnSync('/usr/bin/mkfifo', [object]).status, 0);
      }
      const result = restore(value, cut, target);
      assert.equal(result.ok, false, kind);
      assert.equal(fs.existsSync(path.join(target, 'complete.json')), false, kind);
      assert.equal(fs.readFileSync(path.join(value.live, 'invoice.pdf'), 'utf8'), 'ORIGINAL IMMUTABLE BYTES');
    } finally { await value.work.stopAndDrain(2000); }
  }
});

test('forged predecessor lineage is refused before creating a target even with a matching outer seal hash', async () => {
  const value = await fixture();
  try {
    const first = await value.publisher.publish('invoice.pdf', Buffer.from('ORIGINAL'));
    const second = await value.publisher.publish('invoice.pdf', Buffer.from('CURRENT'), { replace: true });
    const cut = await seal(value), record = JSON.parse(fs.readFileSync(path.join(value.store, 'versions', second + '.json')));
    const wrong = { ...record, generation: 3, previousSha256: first };
    const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
    const raw = Buffer.from(JSON.stringify(canonical(wrong)) + '\n'), id = hash(raw);
    fs.writeFileSync(path.join(value.store, 'versions', id + '.json'), raw, { flag: 'wx', mode: 0o400 });
    const captureId = randomBytes(32).toString('hex'), manifest = { ...cut.manifest, captureId, heads: [{ key: 'invoice.pdf', sha256: id }] };
    const bytes = Buffer.from(JSON.stringify(canonical(manifest)) + '\n');
    fs.writeFileSync(path.join(value.store, 'seals', captureId + '.json'), bytes, { flag: 'wx', mode: 0o400 });
    const target = path.join(value.root, 'wrong-lineage');
    const result = restore(value, { captureId, sha256: hash(bytes) }, target);
    assert.equal(result.ok, false); assert.match(result.error, /LINEAGE_INVALID/);
    assert.equal(fs.existsSync(target), false);
  } finally { await value.work.stopAndDrain(2000); }
});

test('an independent reader refuses a new target inside the original live source before creating anything', async () => {
  const value = await fixture();
  try {
    await value.publisher.publish('invoice.pdf', Buffer.from('CURRENT LIVE DATA'));
    const cut = await seal(value), target = path.join(value.live, 'recovered-copy');
    const result = restore(value, cut, target);
    assert.equal(result.ok, false, 'gate-free historical materialization must never write inside protected live storage');
    assert.match(result.error, /TARGET_INVALID/);
    assert.equal(fs.existsSync(target), false);
    assert.equal(fs.readFileSync(path.join(value.live, 'invoice.pdf'), 'utf8'), 'CURRENT LIVE DATA');
  } finally { await value.work.stopAndDrain(2000); }
});

test('all producer-admitted per-key histories remain restorable beyond the former aggregate 512 MiB reader limit', async () => {
  const value = await fixture();
  try {
    let metadataBytes = 0;
    for (let index = 0; index < 9; index++) {
      const key = Array.from({ length: 4 }, (_, part) => String.fromCharCode(part + 1).repeat(250)).join('/') + '-' + index;
      let previousSha256 = await value.publisher.remove(key);
      // Independent real immutable records, not a supplied counter/byte total.
      // Every key remains below the producer's existing 10,000-version limit.
      for (let generation = 2; generation <= 9998; generation++) {
        const raw = Buffer.from(JSON.stringify({ format: 'sabalan-file-version/v1', generation, key,
          live: null, object: null, operation: 'DELETE', previousSha256 }) + '\n');
        previousSha256 = hash(raw); metadataBytes += raw.length;
        fs.writeFileSync(path.join(value.store, 'versions', previousSha256 + '.json'), raw, { flag: 'wx', mode: 0o400 });
      }
      const head = path.join(value.store, 'heads', hash(key) + '.json');
      fs.chmodSync(head, 0o600);
      fs.copyFileSync(path.join(value.store, 'versions', previousSha256 + '.json'), head); fs.chmodSync(head, 0o400);
      // The actual producer acknowledges the next generation and seals it.
      await value.publisher.remove(key);
    }
    assert.ok(metadataBytes > 512 * 1024 * 1024, metadataBytes);
    const cut = await seal(value), target = path.join(value.root, 'long-history-restored');
    const started = performance.now(), result = restore(value, cut, target);
    assert.equal(result.ok, true, result.error || result.stderr);
    assert.equal(result.result.tombstones, 9); assert.deepEqual(fs.readdirSync(path.join(target, 'files')), []);
    assert.equal(result.result.historyRecordsVerified, 9 * 9999);
    assert.ok(result.result.historyBytesVerified >= metadataBytes);
    console.log(JSON.stringify({ event: 'actual-version-history-restoration', metadataBytes,
      heads: 9, generation: 9999, milliseconds: performance.now() - started, productionBudgetProof: false }));
  } finally { await value.work.stopAndDrain(2000); }
});
