'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');
const path = require('node:path');
const { prisma, disconnectDatabase } = require('./lib/prisma');
const { loadOnlineRuntimeScope } = require('./services/onlineRuntimeScope');
const { assertRuntimeControlOwnership } = require('./services/runtimeControlOwnership');

(async () => {
  const input = loadOnlineRuntimeScope();
  assert.ok(input);
  // An online worker's private FD9 and exclusive worker FD12 do not grant
  // legacy destructive control, migrations or old-checkpoint restoration.
  assert.throws(() => assertRuntimeControlOwnership(), /OWNERSHIP_REQUIRED/);
  const [row] = await prisma.$queryRawUnsafe("SELECT current_setting('application_name') AS name");
  assert.equal(row.name, 'sabalan-rt-' + createHash('sha256').update(input.scope.runtimeId, 'ascii').digest('hex').slice(0, 48));
  if (input.scope.worker) {
    const bytes = fs.readFileSync(input.scope.coordinationDirectory + '/deployment-online-worker-native.json');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), process.env.BACKEND_NATIVE_CLAIM_SHA256);
  }
  if (input.scope.purpose === 'capture') {
    const probe = "const assert=require('node:assert/strict');const {applicationRuntimeDatabaseUrl}=require(process.argv[1]);assert.throws(()=>applicationRuntimeDatabaseUrl(),/AUTHORITY_UNPROVEN/);console.log('SUBSTITUTED_GATE_REFUSED')";
    const script = "import os,fcntl,sys;fd=os.open(sys.argv[1],os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);os.dup2(fd,10,inheritable=True);os.close(fd);os.execv(sys.argv[2],[sys.argv[2],'-e',sys.argv[3],sys.argv[4]])";
    const result = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', script,
      input.scope.coordinationDirectory + '/wrong-gate/deployment-write-admission.lock', process.execPath,
      probe, path.join(__dirname, 'services/runtimeNativeAuthority.js')], {
      env: process.env, timeout: 10000, encoding: 'utf8',
      stdio: Array.from({ length: 13 }, (_, fd) => fd === 0 ? 'ignore' : fd < 3 ? 'pipe' : [9, 10, 11, 12].includes(fd) ? fd : 'ignore'),
    });
    assert.equal(result.signal, null);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), 'SUBSTITUTED_GATE_REFUSED');
    // Capture has its own native database owner; an application pool must
    // close before waiting for the whole capture namespace's SQL closure.
    await disconnectDatabase();
    const accepted = await new Promise(resolve => {
      const child = spawn('/usr/bin/python3', ['-I', '-B', path.join(__dirname, 'capture.fixture.py')], {
        env: process.env,
        stdio: Array.from({ length: 13 }, (_, fd) => fd === 0 ? 'ignore' : fd < 3 ? 'pipe' : [9, 10, 11, 12].includes(fd) ? fd : 'ignore'),
      });
      let stdout = '', bytes = 0, error, late = false;
      const timer = setTimeout(() => { late = true; }, 10000);
      child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes <= 4096) stdout += chunk.toString(); });
      child.stderr.on('data', chunk => { bytes += chunk.length; });
      child.once('error', value => { error = value; });
      // A deadline is failure only after actual close, never permission to
      // kill a native SQL client or declare its server transaction complete.
      child.once('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, error, late, bytes, stdout }); });
    });
    if (accepted.status !== 0) process.stderr.write('CAPTURE_NAMESPACE_PROBE_REJECTED\n');
    assert.equal(accepted.signal, null);
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.late, false);
    assert.ok(accepted.bytes <= 4096);
    assert.equal(accepted.status, 0);
    assert.deepEqual(JSON.parse(accepted.stdout), { event: 'online-capture-closed', descriptors: 4, relations: 1, namespace: row.name });

  }
  console.log(JSON.stringify({ event: 'ready', pid: process.pid, namespace: row.name, purpose: input.scope.purpose }));
  if (['lost-runtime', 'lost-worker'].includes(process.argv[2])) {
    await prisma.$executeRawUnsafe(`DO $$ BEGIN PERFORM pg_sleep(3); INSERT INTO online_native_probe VALUES ('${process.argv[2]}', 123456789.12345678, 0.00000001); END $$`);
  } else {
    while (!fs.existsSync(input.scope.nativeDirectory + '/diagnostic-finish')) {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  await disconnectDatabase();
})().catch(async () => { console.error('ONLINE_NATIVE_WORKER_FAILED'); try { await disconnectDatabase(); } finally { process.exitCode = 1; } });
