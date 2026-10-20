import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sha = /^[a-f0-9]{64}$/;
function readPrivate(file: string, maximum = 16 * 1024 * 1024) {
  assert.ok(path.isAbsolute(file) && path.resolve(file) === file && fs.realpathSync(file) === file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid!())
      && (before.mode & 0o777n) === 0o400n && before.size > 0n && before.size <= BigInt(maximum));
    const bytes = Buffer.alloc(Number(before.size)); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, null); assert.ok(n > 0); offset += n; }
    assert.equal(fs.readSync(fd, Buffer.alloc(1), 0, 1, null), 0);
    for (const after of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(file, { bigint: true })]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'uid', 'mode', 'nlink'] as const) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(fd); }
}

type Source = { name: string; liveRoot: string; storeRoot: string; cutSha256: string;
  restoreReceipt: { path: string; sha256: string }; files: Array<{ key: string; sha256: string; bytes: number }> };
function confined(root: string, candidate: string) {
  assert.ok(path.isAbsolute(candidate) && path.resolve(candidate) === candidate && fs.realpathSync(candidate) === candidate);
  const relative = path.relative(root, candidate);
  assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}
function inventory(source: Source) {
  const actual: Source['files'] = [];
  const walk = (directory: string, prefix: string) => {
    const before = fs.lstatSync(directory, { bigint: true });
    assert.ok(before.isDirectory() && before.uid === BigInt(process.getuid!()) && !(before.mode & 0o022n));
    const children = fs.readdirSync(directory).sort();
    assert.ok(!prefix || children.length > 0, 'RESTORED_BASELINE_EMPTY_SUBDIRECTORY');
    for (const child of children) {
      const key = prefix + child, file = path.join(directory, child), value = fs.lstatSync(file, { bigint: true });
      assert.ok(!value.isSymbolicLink() && value.dev === before.dev);
      if (value.isDirectory()) walk(file, key + '/');
      else {
        assert.ok(value.isFile() && value.nlink === 1n && value.uid === before.uid && !(value.mode & 0o022n)
          && value.size <= 2n * 1024n ** 3n);
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
        const hash = createHash('sha256'); let bytes = 0;
        try {
          const buffer = Buffer.alloc(262144);
          for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break;
            bytes += n; assert.ok(bytes <= Number(value.size)); hash.update(buffer.subarray(0, n)); }
          for (const after of [fs.fstatSync(fd, { bigint: true }), fs.lstatSync(file, { bigint: true })]) {
            for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'uid', 'mode', 'nlink'] as const) assert.equal(after[field], value[field]);
          }
          assert.equal(bytes, Number(value.size)); fs.fsyncSync(fd);
        } finally { fs.closeSync(fd); }
        actual.push({ key, sha256: hash.digest('hex'), bytes });
        assert.ok(actual.length <= 10000);
      }
    }
    const after = fs.lstatSync(directory, { bigint: true });
    for (const key of ['dev', 'ino', 'mtimeNs', 'ctimeNs', 'uid', 'mode'] as const) assert.equal(after[key], before[key]);
  };
  walk(source.liveRoot, '');
  actual.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  assert.deepEqual(actual, source.files, 'RESTORED_BASELINE_CAPTURE_INVENTORY_MISMATCH');
  assert.ok(actual.reduce((total, file) => total + file.bytes, 0) <= 32 * 1024 ** 3);
  return digest(Buffer.from(JSON.stringify(actual)));
}

/** Diagnostic restored-chain bootstrap, before ANY restored HTTP/Inquiry actor.
 * Preserves captured history separately; this is a fresh, provenance-bound
 * baseline over independently restored bytes, never adoption of source state. */
async function main() {
  assert.equal(process.platform, 'linux'); assert.equal(process.env.NODE_ENV, 'test');
  assert.equal(process.umask(), 0o077); assert.equal(process.argv[2], 'restore-file-baseline');
  const { loadOnlineRuntimeScope } = await import('../../backend/src/services/onlineRuntimeScope');
  const issued = loadOnlineRuntimeScope(); assert.ok(issued);
  assert.equal(issued.scope.purpose, 'jobs'); assert.equal(issued.scope.role, 'control');
  const bytes = readPrivate(process.env.APPLICATION_RESTORED_BASELINE_MANIFEST!);
  assert.match(process.env.APPLICATION_RESTORED_BASELINE_SHA256 || '', sha);
  assert.equal(digest(bytes), process.env.APPLICATION_RESTORED_BASELINE_SHA256);
  const manifest = JSON.parse(bytes.toString()) as { format: string; captureId: string;
    capturedManifest: { path: string; sha256: string }; sources: Source[] };
  assert.equal(manifest.format, 'sabalan-application-restored-file-baseline/v1'); assert.match(manifest.captureId, sha);
  assert.match(manifest.capturedManifest.sha256, sha);
  const capturedBytes = readPrivate(manifest.capturedManifest.path);
  assert.equal(digest(capturedBytes), manifest.capturedManifest.sha256);
  const captured = JSON.parse(capturedBytes.toString());
  assert.equal(captured.format, 'sabalan-coherent-component/v3');
  assert.equal(captured.phase, 'CAPTURED_AWAITING_NATIVE_CLOSURE');
  assert.equal(captured.captureId, manifest.captureId);
  assert.ok(Array.isArray(captured.versionedCuts));
  assert.ok(Array.isArray(manifest.sources) && manifest.sources.length > 0 && manifest.sources.length <= 64);
  assert.equal(captured.versionedCuts.length, manifest.sources.length);
  const cwd = fs.realpathSync(process.cwd());
  const versions = process.env.APPLICATION_ACCEPTANCE_VERSION_ROOT!; confined(cwd, versions);
  const names = new Set<string>(), lives = new Set<string>(), stores = new Set<string>();
  for (const source of manifest.sources) {
    assert.match(source.name, /^[a-z][a-z0-9-]{0,63}$/); assert.ok(!names.has(source.name)); names.add(source.name);
    confined(cwd, source.liveRoot); confined(versions, source.storeRoot);
    assert.match(source.cutSha256, sha); assert.match(source.restoreReceipt.sha256, sha);
    const selected = captured.versionedCuts.filter((cut: any) => cut.name === source.name);
    assert.equal(selected.length, 1); assert.equal(selected[0].captureId, manifest.captureId);
    assert.equal(selected[0].sha256, source.cutSha256);
    const restoredBytes = readPrivate(source.restoreReceipt.path);
    assert.equal(digest(restoredBytes), source.restoreReceipt.sha256);
    const restored = JSON.parse(restoredBytes.toString());
    assert.equal(restored.format, 'sabalan-versioned-file-restore/v1');
    assert.equal(restored.sealSha256, source.cutSha256);
    assert.deepEqual(restored.files, source.files, 'RESTORED_BASELINE_SELECTED_RESTORE_MISMATCH');
    assert.ok(!lives.has(source.liveRoot) && !stores.has(source.storeRoot)); lives.add(source.liveRoot); stores.add(source.storeRoot);
    assert.deepEqual(fs.readdirSync(source.storeRoot), [], 'RESTORED_BASELINE_FRESH_STORE_REQUIRED');
    assert.ok(Array.isArray(source.files)); inventory(source);
  }
  const roster = () => {
    assert.equal(loadOnlineRuntimeScope(), issued);
    for (const [kind, allowed] of [['native', ['deployment-runtime-control.lock']], ['work', ['scope.json']]] as const) {
      const directory = path.join(issued.scope.coordinationDirectory, 'online', kind);
      for (const name of fs.readdirSync(directory)) {
        assert.match(name, /^[a-f0-9]{64}$/);
        const target = path.join(directory, name); assert.equal(fs.realpathSync(target), target);
        assert.ok(fs.lstatSync(target).isDirectory());
        if (name !== issued.scope.runtimeId) assert.deepEqual(fs.readdirSync(target).sort(), [...allowed].sort(), 'RESTORED_BASELINE_OTHER_ACTOR_STARTED');
      }
    }
  };
  roster();
  const { createScopedRuntimeWork } = await import('../../backend/src/services/onlineRuntimeWork');
  const boundary = await createScopedRuntimeWork({ registrySha256: issued.scope.manifestSha256, generation: 1, canJoin: () => true });
  const { VersionedFilePublication } = await import('../../backend/src/services/versionedFilePublication');
  const { prisma: db, disconnectDatabase } = await import('../../backend/src/lib/prisma');
  const publications: Array<{ source: Source; publication: Awaited<ReturnType<typeof VersionedFilePublication.open>> }> = [];
  let gate: number | undefined;
  try {
    await boundary.runBackground(async () => {
      const [observed] = await db.$queryRaw<Array<{ database: string; foreignSessions: number; prepared: number }>>`
        SELECT current_database() AS database,
          (SELECT count(*)::int FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()) AS "foreignSessions",
          (SELECT count(*)::int FROM pg_prepared_xacts WHERE database=current_database()) AS prepared`;
      assert.deepEqual(observed, { database: issued.scope.database.name, foreignSessions: 0, prepared: 0 });
      for (const source of manifest.sources) publications.push({ source,
        publication: await VersionedFilePublication.open(source.storeRoot, source.liveRoot, boundary.context) });
    });
    await disconnectDatabase();
    await boundary.stopAndDrain(5000); roster();
    // No shared work remains. This descriptor is retained by this original
    // native worker while flock's child operates on the SAME OFD at FD20.
    gate = fs.openSync(issued.scope.gate.file, fs.constants.O_RDWR | fs.constants.O_NOFOLLOW);
    const descriptors: Array<'ignore' | number> = Array(21).fill('ignore'); descriptors[20] = gate;
    const locked = spawnSync('/usr/bin/flock', ['--exclusive', '--nonblock', '20'], { stdio: descriptors });
    assert.equal(locked.status, 0, 'RESTORED_BASELINE_EXCLUSIVE_GATE_UNAVAILABLE'); roster();
    const proofs: object[] = [];
    for (const { source, publication } of publications) {
      const inventorySha256 = inventory(source);
      const proof = await publication.adoptLegacy(manifest.captureId, gate); roster();
      assert.equal(inventory(source), inventorySha256);
      proofs.push({ name: source.name, inventorySha256, ...proof });
    }
    assert.equal(digest(readPrivate(process.env.APPLICATION_RESTORED_BASELINE_MANIFEST!)), digest(bytes));
    assert.equal(digest(readPrivate(manifest.capturedManifest.path)), manifest.capturedManifest.sha256);
    for (const source of manifest.sources) assert.equal(digest(readPrivate(source.restoreReceipt.path)), source.restoreReceipt.sha256);
    const completed = { event: 'restored-file-baseline-complete', manifestSha256: digest(bytes),
      captureId: manifest.captureId, capturedManifestSha256: manifest.capturedManifest.sha256,
      runtimeId: issued.scope.runtimeId, proofs, productionAdmission: false };
    const proofFile = process.env.APPLICATION_RESTORED_BASELINE_MANIFEST! + '.completed.json';
    const proof = fs.openSync(proofFile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o400);
    try { fs.writeFileSync(proof, JSON.stringify(completed) + '\n'); fs.fsyncSync(proof); } finally { fs.closeSync(proof); }
    const parent = fs.openSync(path.dirname(proofFile), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
    roster(); console.log(JSON.stringify(completed));
  } finally {
    if (gate !== undefined) fs.closeSync(gate);
    await disconnectDatabase(); await boundary.stopAndDrain(5000);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
