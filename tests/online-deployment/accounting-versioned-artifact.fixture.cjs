'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const bindingMode = process.argv[2]?.startsWith('binding-') ? process.argv[2] : null;
const test = bindingMode ? () => {} : require('node:test').test;
const { spawnSync } = require('node:child_process');
const { KernelWriteAdmission } = require('./kernelWriteAdmission');
const { RuntimeBoundaryJournal, runtimeBoundaryProvisionBytes, runtimeNativePostgresApplicationName } = require('./runtimeBoundaryJournal');
const { RuntimeTaskAdmission } = require('./runtimeTaskAdmission');
const { RuntimeWorkContext } = require('./runtimeWorkContext');
const { VersionedFilePublication } = require('./versionedFilePublication');
const { retainOfficialReportArtifact } = require('./accountingOfficialReportArtifact');

async function fixture(http = false) {
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
  const boundary = http ? new (require('./runtimeWorkBoundary').RuntimeWorkBoundary)(tasks, require('./httpRequestLifecycle').runtimeHttpRequests, () => {}) : null;
  const work = boundary ? boundary.context : new RuntimeWorkContext(tasks, () => {});
  const store = path.join(root, 'versions'), live = path.join(root, 'live');
  for (const directory of [store, live]) fs.mkdirSync(directory, { mode: 0o700 });
  const publisher = await VersionedFilePublication.open(store, live, work), files = await publisher.bindRoot(live);
  return { root, live, store, files, boundary, async close() {
    if (boundary) await boundary.stopAndDrain(1000); else await work.stopAndDrain(1000);
    console.log('ACCOUNTING_NATIVE_WORK_CLOSED');
  } };
}

test('official artifact is immutable and independently retrievable before recording its SQL hash', async () => {
  const v = await fixture(); try {
    let recorded = null, renders = 0;
    const input = { root: v.live, files: v.files, snapshotId: 'official-snapshot', format: 'pdf',
      existingHash: null, render: async () => { renders++; return Buffer.from('FROZEN OFFICIAL REPORT'); },
      recordHash: async hash => {
        const key = 'official-snapshot/' + hash + '.pdf', head = await v.files.inspect(key);
        assert.ok(head && head.operation === 'PUT', 'A real immutable PUT must precede the SQL callback');
        assert.equal((await v.files.readVersion(key, head.versionSha256)).toString(), 'FROZEN OFFICIAL REPORT');
        recorded = hash;
      } };
    const first = await retainOfficialReportArtifact(input);
    assert.equal(first.hash, recorded);
    const second = await retainOfficialReportArtifact({ ...input, existingHash: recorded,
      recordHash: async () => { throw Error('FROZEN_SQL_MUST_NOT_BE_REWRITTEN'); } });
    assert.deepEqual(second, first); assert.equal(renders, 1);
  } finally { await v.close(); }
});

test('wrong-root and counterfeit owners refuse before rendering, reading or recording a frozen report', async () => {
  const v = await fixture(); try {
    const wrong = path.join(v.live, 'other'); fs.mkdirSync(wrong, { mode: 0o700 });
    let rendered = 0, recorded = 0;
    const input = { root: v.live, files: v.files, snapshotId: 'official-snapshot', format: 'pdf',
      render: async () => { rendered++; return Buffer.from('MUST NOT RENDER'); }, recordHash: async () => { recorded++; } };
    for (const existingHash of [null, 'a'.repeat(64)]) {
      await assert.rejects(retainOfficialReportArtifact({ ...input, root: wrong, existingHash }), /FILE_VERSION_STORAGE_ROOT_MISMATCH/);
      await assert.rejects(retainOfficialReportArtifact({ ...input, files: { ...v.files }, existingHash }), /FILE_VERSION_STORAGE_ROOT_MISMATCH/);
    }
    assert.equal(rendered, 0); assert.equal(recorded, 0);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'heads')), []);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
  } finally { await v.close(); }
});

test('missing and tampered frozen artifacts fail without rerendering or replacing their immutable original', async () => {
  const v = await fixture(); try {
    let renders = 0;
    const input = { root: v.live, files: v.files, snapshotId: 'frozen-snapshot', format: 'xlsx', existingHash: null,
      render: async () => { renders++; return Buffer.from('OFFICIAL XLSX ORIGINAL'); }, recordHash: async () => {} };
    const first = await retainOfficialReportArtifact(input), key = `frozen-snapshot/${first.hash}.xlsx`;
    const original = await v.files.inspect(key), file = path.join(v.live, key);
    fs.writeFileSync(file, 'ALTERED BY UNREGISTERED WRITER');
    await assert.rejects(retainOfficialReportArtifact({ ...input, existingHash: first.hash }), /بازیابی فایل/);
    assert.equal(fs.readFileSync(file, 'utf8'), 'ALTERED BY UNREGISTERED WRITER');
    fs.unlinkSync(file);
    await assert.rejects(retainOfficialReportArtifact({ ...input, existingHash: first.hash }), /بازیابی فایل/);
    assert.equal(fs.existsSync(file), false); assert.equal(renders, 1);
    assert.equal((await v.files.readVersion(key, original.versionSha256)).toString(), 'OFFICIAL XLSX ORIGINAL');
  } finally { await v.close(); }
});

test('failed SQL recording retains the immutable bytes and exact retry reuses their existing version', async () => {
  const v = await fixture(); try {
    let renders = 0;
    const input = { root: v.live, files: v.files, snapshotId: 'sql-failed', format: 'pdf', existingHash: null,
      render: async () => { renders++; return Buffer.from('RETAIN AFTER SQL FAILURE'); },
      recordHash: async () => { throw Error('REAL SQL OWNER CALLBACK REFUSED'); } };
    await assert.rejects(retainOfficialReportArtifact(input), /REAL SQL OWNER CALLBACK REFUSED/);
    const [filename] = fs.readdirSync(path.join(v.live, 'sql-failed')), key = 'sql-failed/' + filename;
    const head = await v.files.inspect(key), objects = fs.readdirSync(path.join(v.store, 'objects'));
    assert.equal((await v.files.readVersion(key, head.versionSha256)).toString(), 'RETAIN AFTER SQL FAILURE');
    let recorded;
    const retried = await retainOfficialReportArtifact({ ...input, recordHash: async hash => { recorded = hash; } });
    assert.equal(retried.hash, recorded); assert.equal(renders, 2);
    assert.deepEqual(await v.files.inspect(key), head);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'objects')), objects);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'pending')), []);
  } finally { await v.close(); }
});

test('a real version owner failure cannot fall back to raw publication or recording SQL', async () => {
  const v = await fixture(); try {
    // Replace the enrolled directory incarnation to trigger the genuine owner,
    // rather than substituting its methods with a mocked publication port.
    fs.renameSync(v.live, v.live + '-held'); fs.mkdirSync(v.live, { mode: 0o700 });
    let recorded = 0;
    await assert.rejects(retainOfficialReportArtifact({ root: v.live, files: v.files, snapshotId: 'refused', format: 'pdf',
      existingHash: null, render: async () => Buffer.from('NO RAW FALLBACK'), recordHash: async () => { recorded++; } }),
    /FILE_VERSION_DIRECTORY_CHANGED/);
    assert.equal(recorded, 0); assert.deepEqual(fs.readdirSync(v.live), []);
    assert.deepEqual(fs.readdirSync(path.join(v.store, 'objects')), []);
  } finally { await v.close(); }
});

async function startupBindingCase(mode) {
  const v = await fixture(true); try {
    process.chdir(v.root);
    const runtime = require('./accountingFileRuntime');
    const { runtimeHttpRequests } = require('./httpRequestLifecycle');
    const root = runtime.ACCOUNTING_OFFICIAL_REPORT_ROOT;
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    const store = path.join(v.root, 'accounting-versions'); fs.mkdirSync(store, { mode: 0o700 });
    const publication = await VersionedFilePublication.open(store, root, v.boundary.context);
    const input = { boundary: v.boundary, publication };
    const probe = () => runtimeHttpRequests.middleware({ originalUrl: '/api/health' }, {}, () => {});
    if (mode === 'binding-success') {
      const pending = runtime.configurePrivateVersionedAccountingFiles(input);
      await assert.rejects(runtime.configurePrivateVersionedAccountingFiles(input), /ACCOUNTING_FILE_RUNTIME_ALREADY_BOUND/);
      await pending;
      const files = runtime.versionedAccountingReportFiles(); assert.ok(files);
      let hash;
      const result = await retainOfficialReportArtifact({ root, files, snapshotId: 'startup-bound', format: 'pdf', existingHash: null,
        render: async () => Buffer.from('BOUND OFFICIAL REPORT'), recordHash: async next => { hash = next; } });
      assert.equal(hash, result.hash);
      assert.equal((await files.read('startup-bound/' + hash + '.pdf')).toString(), 'BOUND OFFICIAL REPORT');
      await assert.rejects(runtime.configurePrivateVersionedAccountingFiles(input), /ACCOUNTING_FILE_RUNTIME_ALREADY_BOUND/);
    } else if (mode === 'binding-getter-first') {
      assert.equal(runtime.versionedAccountingReportFiles(), undefined);
      await assert.rejects(runtime.configurePrivateVersionedAccountingFiles(input), /ACCOUNTING_FILE_RUNTIME_ALREADY_OBSERVED/);
    } else if (mode === 'binding-probe-first') {
      probe(); await assert.rejects(runtime.configurePrivateVersionedAccountingFiles(input), /HTTP_OWNERSHIP_ALREADY_OBSERVED/);
    } else if (mode === 'binding-getter-during') {
      const pending = runtime.configurePrivateVersionedAccountingFiles(input);
      const rejected = assert.rejects(pending, /ACCOUNTING_FILE_RUNTIME_ALREADY_OBSERVED/);
      assert.throws(() => runtime.versionedAccountingReportFiles(), /ACCOUNTING_FILE_RUNTIME_NOT_READY/);
      await rejected;
      assert.throws(() => runtime.versionedAccountingReportFiles(), /ACCOUNTING_FILE_RUNTIME_NOT_READY/);
      await assert.rejects(runtime.configurePrivateVersionedAccountingFiles(input), /ACCOUNTING_FILE_RUNTIME_ALREADY_BOUND/);
    } else if (mode === 'binding-probe-during') {
      const pending = runtime.configurePrivateVersionedAccountingFiles(input);
      const rejected = assert.rejects(pending, /HTTP_OWNERSHIP_ALREADY_OBSERVED/); probe(); await rejected;
      assert.throws(() => runtime.versionedAccountingReportFiles(), /ACCOUNTING_FILE_RUNTIME_NOT_READY/);
    } else if (mode === 'binding-unsafe-root') {
      fs.chmodSync(root, 0o755);
      await assert.rejects(runtime.configurePrivateVersionedAccountingFiles(input), /FILE_VERSION_DIRECTORY_UNSAFE/);
      fs.chmodSync(root, 0o700);
      assert.throws(() => runtime.versionedAccountingReportFiles(), /ACCOUNTING_FILE_RUNTIME_NOT_READY/);
      await assert.rejects(runtime.configurePrivateVersionedAccountingFiles(input), /ACCOUNTING_FILE_RUNTIME_ALREADY_BOUND/);
    } else if (mode === 'binding-invalid-boundary' || mode === 'binding-wrong-root') {
      const invalid = mode === 'binding-invalid-boundary' ? { ...input, boundary: { ...v.boundary } }
        : { ...input, publication: await VersionedFilePublication.open(v.store, v.live, v.boundary.context) };
      await assert.rejects(runtime.configurePrivateVersionedAccountingFiles(invalid), /ACCOUNTING_FILE_RUNTIME_SCOPE_INVALID/);
      assert.deepEqual(fs.readdirSync(path.join(store, 'heads')), []);
    } else throw Error('UNKNOWN_TEST_MODE');
  } finally { await v.close(); }
}

test('startup Accounting ownership is genuine, immutable and cannot bind across first request or getter races', () => {
  const modes = ['binding-success', 'binding-getter-first', 'binding-probe-first', 'binding-getter-during',
    'binding-probe-during', 'binding-unsafe-root', 'binding-invalid-boundary', 'binding-wrong-root'];
  for (const mode of modes) {
    const result = spawnSync(process.execPath, [__filename, mode], { encoding: 'utf8' });
    assert.equal(result.signal, null); assert.equal(result.status, 0, JSON.stringify({ mode, stdout: result.stdout, stderr: result.stderr }));
    assert.equal((result.stdout.match(/ACCOUNTING_NATIVE_WORK_CLOSED/g) || []).length, 1);
  }
  console.log('ACCOUNTING_NATIVE_WORK_CLOSED');
});

if (bindingMode) startupBindingCase(bindingMode).catch(error => { console.error(error); process.exitCode = 1; });
