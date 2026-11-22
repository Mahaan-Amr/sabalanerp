'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const express = require('express');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkBoundary } = require('./runtimeWorkBoundary');
const { RuntimeWorkContext } = require('./runtimeWorkContext');
const { VersionedFilePublication } = require('./versionedFilePublication');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function fixture(assertOwner = () => {}) {
  const root = path.join(__dirname, randomBytes(16).toString('hex')); fs.mkdirSync(root, { mode: 0o700 });
  const gate = path.join(root, 'deployment-write-admission.lock'); fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const value = fs.statSync(gate, { bigint: true }), runtimeId = randomBytes(32).toString('hex');
  const gateIdentity = { device: String(value.dev), inode: String(value.ino), ownerUid: Number(value.uid) };
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: gateIdentity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  const journalRoot = path.join(root, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  let open = true;
  const tasks = new RuntimeTaskAdmission(new KernelWriteAdmission(gate, gateIdentity, () => {}), journal, () => {}, () => open);
  const boundary = new RuntimeWorkBoundary(tasks, () => true, assertOwner, assertOwner);
  assert.ok(boundary.context instanceof RuntimeWorkContext, 'actual HTTP and nested file work must share one completion context');
  const store = path.join(root, 'versions'), live = path.join(root, 'live');
  for (const directory of [store, live]) fs.mkdirSync(directory, { mode: 0o700 });
  const publisher = await VersionedFilePublication.open(store, live, boundary.context);
  return { root, gate, journal, boundary, publisher, live, close: () => { open = false; }, reopen: () => { open = true; } };
}

test('an early HTTP response retains its admitted file write across capture closure while a new request waits outside', async () => {
  const value = await fixture(), entered = deferred(), proceed = deferred(), finished = deferred();
  const app = express(); app.use(value.boundary.middleware); let lateStarted = false;
  app.post('/old', async (_req, res) => {
    res.status(202).json({ accepted: true }); entered.resolve(); await proceed.promise;
    await value.publisher.publish('invoice.pdf', Buffer.from('COMPLETED BEFORE THE CUT 123456789.12345678'));
    finished.resolve();
  });
  app.post('/new', (_req, res) => { lateStarted = true; res.json({ accepted: true }); });
  value.boundary.requests.install(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  let late;
  try {
    assert.equal((await fetch(url + '/old', { method: 'POST' })).status, 202); await entered.promise;
    value.close(); late = fetch(url + '/new', { method: 'POST' });
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(lateStarted, false);
    assert.equal((await value.journal.inspect()).phase, 'ACTIVE');
    proceed.resolve();
    let timer;
    try { await Promise.race([finished.promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('ADMITTED_FILE_DEADLOCKED_BEHIND_CAPTURE')), 2000); })]); }
    finally { clearTimeout(timer); }
    let exclusive = false;
    const deadline = performance.now() + 2000;
    while (!exclusive && performance.now() < deadline) {
      exclusive = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status === 0;
      if (!exclusive) await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.equal(exclusive, true);
    assert.equal(lateStarted, false);
    assert.equal(fs.readFileSync(path.join(value.live, 'invoice.pdf'), 'utf8'), 'COMPLETED BEFORE THE CUT 123456789.12345678');
    value.reopen(); assert.equal((await late).status, 200); assert.equal(lateStarted, true);
  } finally {
    value.reopen(); proceed.resolve(); if (late) await late;
    await value.boundary.stopAndDrain(2000); await new Promise(resolve => server.close(resolve));
  }
});

test('a disconnected real HTTP client cannot release an unfinished nested file writer', async () => {
  const value = await fixture(), entered = deferred(), proceed = deferred(), finished = deferred();
  const app = express(); app.use(value.boundary.middleware);
  app.post('/disconnect', async (_req, _res) => {
    entered.resolve(); await proceed.promise;
    await value.publisher.publish('disconnected.pdf', Buffer.from('SAVED AFTER DISCONNECT'));
    finished.resolve();
  });
  value.boundary.requests.install(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const request = require('node:http').request({ host: '127.0.0.1', port: server.address().port, path: '/disconnect', method: 'POST' });
  request.on('error', () => {}); request.end();
  try {
    await entered.promise; value.close(); request.destroy();
    await assert.rejects(value.boundary.requests.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 1);
    proceed.resolve(); await finished.promise; await value.boundary.requests.waitForDrain(2000);
    assert.equal(fs.readFileSync(path.join(value.live, 'disconnected.pdf'), 'utf8'), 'SAVED AFTER DISCONNECT');
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 0);
  } finally {
    proceed.resolve(); request.destroy(); value.reopen();
    await value.boundary.stopAndDrain(2000); await new Promise(resolve => server.close(resolve));
  }
});

test('an unfired reservation blocks drain until cancellation and cannot revive a completed owner', async () => {
  const value = await fixture(); let reservation, savedRequest;
  const app = express(); app.use(value.boundary.middleware);
  app.post('/reserve', (req, res) => {
    savedRequest = req; reservation = value.boundary.requests.reserveWrite(req); res.status(202).end();
  });
  value.boundary.requests.install(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    assert.equal((await fetch('http://127.0.0.1:' + server.address().port + '/reserve', { method: 'POST' })).status, 202);
    value.close();
    await assert.rejects(value.boundary.requests.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 1);
    reservation.cancel(); await value.boundary.requests.waitForDrain(2000);
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 0);
    await assert.rejects(reservation.run(async () => value.publisher.publish('stale.pdf', Buffer.from('STALE'))), /HTTP_WRITE_RESERVATION_CONSUMED/);
    value.reopen();
    assert.throws(() => value.boundary.requests.reserveWrite(savedRequest), /RUNTIME_LEASED_WORK_NOT_ACTIVE/);
    assert.equal(fs.existsSync(path.join(value.live, 'stale.pdf')), false);
  } finally {
    reservation?.cancel(); value.reopen();
    await value.boundary.stopAndDrain(2000); await new Promise(resolve => server.close(resolve));
  }
});

test('owner revocation refuses a reserved callback without publishing and releases only its completed work', async () => {
  let valid = true;
  const value = await fixture(() => { if (!valid) throw Error('ACTUAL_OWNER_REVOKED'); });
  let reservation;
  const app = express(); app.use(value.boundary.middleware);
  app.post('/revoke', (req, res) => { reservation = value.boundary.requests.reserveWrite(req); res.status(202).end(); });
  value.boundary.requests.install(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  try {
    assert.equal((await fetch('http://127.0.0.1:' + server.address().port + '/revoke', { method: 'POST' })).status, 202);
    valid = false; value.close();
    await assert.rejects(reservation.run(async () => value.publisher.publish('revoked.pdf', Buffer.from('REVOKED'))), /ACTUAL_OWNER_REVOKED/);
    await value.boundary.requests.waitForDrain(2000);
    assert.equal(fs.existsSync(path.join(value.live, 'revoked.pdf')), false);
  } finally {
    reservation?.cancel(); valid = true; value.reopen();
    await value.boundary.stopAndDrain(2000); await new Promise(resolve => server.close(resolve));
  }
});

test('an admitted background action completes nested file work during capture closure and cannot restart after retirement', async () => {
  const value = await fixture(), entered = deferred(), proceed = deferred();
  const action = value.boundary.runBackground(async () => {
    entered.resolve(); await proceed.promise;
    await value.publisher.publish('job.pdf', Buffer.from('FINISHED ADMITTED JOB'));
  });
  try {
    await entered.promise; value.close();
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 1);
    proceed.resolve(); await action;
    assert.equal(fs.readFileSync(path.join(value.live, 'job.pdf'), 'utf8'), 'FINISHED ADMITTED JOB');
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 0);
    await value.boundary.stopAndDrain(2000);
    await assert.rejects(value.boundary.runBackground(async () => value.publisher.publish('late-job.pdf', Buffer.from('LATE'))));
    assert.equal(fs.existsSync(path.join(value.live, 'late-job.pdf')), false);
  } finally { proceed.resolve(); value.reopen(); await action; await value.boundary.stopAndDrain(2000); }
});

test('a still-owned ignored child can reserve a future callback while response ownership is already draining', async () => {
  const value = await fixture(), entered = deferred(), proceed = deferred(), scheduled = deferred();
  const callbackStarted = deferred(), callbackProceed = deferred(), outcome = deferred();
  const app = express(); app.use(value.boundary.middleware);
  app.post('/callback', (req, res) => {
    void value.boundary.context.run(async () => {
      entered.resolve(); await proceed.promise;
      const reservation = value.boundary.requests.reserveWrite(req);
      setTimeout(() => {
        void reservation.run(async () => {
          callbackStarted.resolve(); await callbackProceed.promise;
          await value.publisher.publish('receipt.pdf', Buffer.from('COMPLETED RESERVED CALLBACK 0.00000001'));
        }).then(() => outcome.resolve({ ok: true }), error => outcome.resolve({ ok: false, code: error.code }));
      }, 20);
      scheduled.resolve();
    });
    res.status(202).json({ accepted: true });
  });
  value.boundary.requests.install(app);
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  try {
    assert.equal((await fetch(url + '/callback', { method: 'POST' })).status, 202); await entered.promise;
    value.close(); await new Promise(resolve => setTimeout(resolve, 20)); proceed.resolve(); await scheduled.promise;
    const started = await Promise.race([callbackStarted.promise.then(() => true), outcome.promise.then(() => false)]);
    assert.equal(started, true, 'a reserved callback must retain the original native admission after its parent returns');
    assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', value.gate, '/usr/bin/true']).status, 1);
    await assert.rejects(value.boundary.requests.waitForDrain(30), /HTTP_REQUEST_DRAIN_TIMEOUT/);
    callbackProceed.resolve(); assert.deepEqual(await outcome.promise, { ok: true });
    assert.equal(fs.readFileSync(path.join(value.live, 'receipt.pdf'), 'utf8'), 'COMPLETED RESERVED CALLBACK 0.00000001');
  } finally {
    value.reopen(); proceed.resolve(); callbackProceed.resolve(); await outcome.promise;
    await value.boundary.stopAndDrain(2000); await new Promise(resolve => server.close(resolve));
  }
});
