'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkBoundary } = require('./runtimeWorkBoundary');
const { VersionedFilePublication } = require('./versionedFilePublication');
const { runtimeHttpRequests, bindRuntimeHttpWriteAdmission } = require('./httpRequestLifecycle');
const runtime = require('./performanceFileRuntime');
const mode = process.argv[2];
async function run() {
  assert.equal(process.platform, 'linux');
  const root = path.join(__dirname, randomBytes(16).toString('hex')); fs.mkdirSync(root, { mode: 0o700 });
  const gate = path.join(root, 'deployment-write-admission.lock'); fs.writeFileSync(gate, '', { flag: 'wx', mode: 0o600 });
  const stat = fs.statSync(gate, { bigint: true });
  const identity = { device: String(stat.dev), inode: String(stat.ino), ownerUid: Number(stat.uid) };
  const runtimeId = randomBytes(32).toString('hex'), journalRoot = path.join(root, runtimeId); fs.mkdirSync(journalRoot, { mode: 0o700 });
  const scope = { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    gate: identity, postgresApplicationName: runtimeNativePostgresApplicationName(runtimeId) };
  fs.writeFileSync(path.join(journalRoot, 'scope.json'), runtimeBoundaryProvisionBytes(scope), { flag: 'wx', mode: 0o600 });
  const journal = new RuntimeBoundaryJournal(journalRoot, scope); await journal.initialize();
  const tasks = new RuntimeTaskAdmission(new KernelWriteAdmission(gate, identity, () => {}), journal, () => {});
  const boundary = new RuntimeWorkBoundary(tasks, runtimeHttpRequests, () => {});
  const live = path.join(root, 'exports'), store = path.join(root, 'versions');
  for (const directory of [live, store]) fs.mkdirSync(directory, { mode: 0o700 });
  process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = live;
  const publication = await VersionedFilePublication.open(store, live, boundary.context);
  const files = await publication.bindRoot(live);
  try {
    if (mode === 'late') {
      await runtime.runOwnedPerformanceExport(async () => {});
      await assert.rejects(runtime.configurePrivateVersionedPerformanceFiles({ boundary, publication }), /ALREADY_OBSERVED/);
    } else if (mode === 'wrong') {
      await assert.rejects(runtime.configurePrivateVersionedPerformanceFiles({ boundary: { ...boundary }, publication }), /SCOPE_INVALID/);
      process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = root;
      await assert.rejects(runtime.configurePrivateVersionedPerformanceFiles({ boundary, publication }), /SCOPE_INVALID/);
      assert.deepEqual(fs.readdirSync(path.join(store, 'heads')), []);
    } else if (mode === 'changed') {
      await runtime.configurePrivateVersionedPerformanceFiles({ boundary, publication });
      process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR = root;
      assert.throws(() => runtime.runOwnedPerformanceExport(async () => {}), /ROOT_CHANGED/);
      assert.deepEqual(fs.readdirSync(path.join(store, 'heads')), []);
    } else if (mode === 'http') {
      await runtime.configurePrivateVersionedPerformanceFiles({ boundary, publication });
      await assert.rejects(runtime.configurePrivateVersionedPerformanceFiles({ boundary, publication }), /ALREADY_BOUND/);
      assert.throws(() => runtime.runOwnedPerformanceExport(async () => {}), /NOT_ACTIVE/);
      let release, started;
      const hold = new Promise(resolve => { release = resolve; });
      const began = new Promise(resolve => { started = resolve; });
      const ciphertext = Buffer.from('SPX1 independently retained encrypted export');
      const target = path.join(live, 'receipt-1.xlsx.enc');
      let job, workError;
      const app = require('express')(); app.use(boundary.middleware);
      app.post('/export', async (_request, response) => {
        job = runtime.runOwnedPerformanceExport(async () => {
          started(); await hold; await runtime.publishPerformanceExportFile(target, ciphertext);
        });
        void job.catch(error => { workError = error; });
        response.status(202).json({ receipt: 'receipt-1' });
      });
      bindRuntimeHttpWriteAdmission(() => true);
      runtimeHttpRequests.install(app);
      const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
      try {
        const response = await fetch('http://127.0.0.1:' + server.address().port + '/export', { method: 'POST' });
        assert.equal(response.status, 202); await response.json(); await began;
        await assert.rejects(runtimeHttpRequests.waitForDrain(20), /DRAIN/);
        assert.notEqual(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', gate, 'true']).status, 0);
        assert.equal(fs.existsSync(target), false);
        release(); await job; if (workError) throw workError;
        await runtimeHttpRequests.waitForDrain(1000);
        assert.equal(spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', gate, 'true']).status, 0);
        await boundary.runBackground(async () => {
          const original = await files.inspect('receipt-1.xlsx.enc'); assert.equal(original.operation, 'PUT');
          assert.deepEqual(await files.readVersion('receipt-1.xlsx.enc', original.versionSha256), ciphertext);
          await runtime.removePerformanceExportFile(target);
          assert.equal(fs.existsSync(target), false);
          assert.equal((await files.inspect('receipt-1.xlsx.enc')).operation, 'DELETE');
          assert.deepEqual(await files.readVersion('receipt-1.xlsx.enc', original.versionSha256), ciphertext);
          assert.throws(runtime.assertPerformanceExportGraphErasureSupported, /RETAINED_COPY_REVIEW_REQUIRED/);
          await assert.rejects(runtime.publishPerformanceExportFile(path.join(root, 'escape.enc'), ciphertext), /PATH_INVALID/);
        });
      } finally { release(); if (job) await job; server.close(); server.closeAllConnections(); await once(server, 'close'); }
    } else throw Error('UNKNOWN_MODE');
  } finally { await boundary.stopAndDrain(2000); console.log('PERFORMANCE_NATIVE_WORK_CLOSED'); }
}
if (mode) run().catch(error => { console.error(error); process.exitCode = 1; });
else require('node:test').test('Performance exports retain actual HTTP completion and versioned deletion ancestry with immutable startup ownership', () => {
  for (const mode of ['http', 'late', 'wrong', 'changed']) {
    const result = spawnSync(process.execPath, [__filename, mode], { encoding: 'utf8' });
    assert.equal(result.signal, null); assert.equal(result.status, 0, JSON.stringify({ mode, stdout: result.stdout, stderr: result.stderr }));
    assert.equal((result.stdout.match(/PERFORMANCE_NATIVE_WORK_CLOSED/g) || []).length, 1);
  }
  console.log('PERFORMANCE_NATIVE_WORK_CLOSED');
});
