'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { prisma, disconnectDatabase } = require('./lib/prisma');
const { applicationRuntimeDatabaseUrl } = require('./services/runtimeNativeAuthority');
const { assertRuntimeControlOwnership } = require('./services/runtimeControlOwnership');

(async () => {
  assertRuntimeControlOwnership();
  for (const change of [url => { url.hostname = 'foreign.invalid'; }, url => { url.pathname = '/foreign'; },
    url => { url.username = 'foreign'; }, url => { url.searchParams.append('pool_timeout', '5'); },
    url => { url.searchParams.set('application_name', 'foreign'); }]) {
    const url = new URL(process.env.DATABASE_URL); change(url);
    assert.throws(() => applicationRuntimeDatabaseUrl({ ...process.env, DATABASE_URL: url.toString() }), /AUTHORITY_UNPROVEN/);
  }
  assert.throws(() => applicationRuntimeDatabaseUrl({ ...process.env, BACKEND_RUNTIME_ROLE: 'candidate' }), /AUTHORITY_UNPROVEN/);
  assert.throws(() => applicationRuntimeDatabaseUrl({ ...process.env, BACKEND_NATIVE_CLAIM_SHA256: 'a'.repeat(64) }), /AUTHORITY_UNPROVEN/);
  const [row] = await prisma.$queryRawUnsafe("SELECT current_setting('application_name') AS name");
  assert.equal(row.name, process.env.BACKEND_NATIVE_POSTGRES_APPLICATION_NAME);
  if (process.argv[2] === 'native-descendant') {
    // Native libpq arguments intentionally do not pass the Prisma URL. The
    // inherited namespace still covers this detached process after Node exits.
    const url = new URL(process.env.DATABASE_URL);
    const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c',
      "DO $$ BEGIN PERFORM pg_sleep(2); INSERT INTO native_owner_probe VALUES ('descendant', 123456789.12345678, 0.00000001); END $$"], {
      detached: true, stdio: 'ignore', env: { ...process.env, PGHOST: url.hostname, PGPORT: url.port,
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password) },
    });
    child.unref();
    console.log(JSON.stringify({ event: 'ready', pid: process.pid, namespace: row.name, child: child.pid }));
    await disconnectDatabase();
    return;
  }
  console.log(JSON.stringify({ event: 'ready', pid: process.pid, namespace: row.name }));
  if (process.argv[2] === 'lost-runtime') {
    await prisma.$executeRawUnsafe("DO $$ BEGIN PERFORM pg_sleep(3); INSERT INTO native_owner_probe VALUES ('lost-runtime', 123456789.12345678, 0.00000001); END $$");
  } else if (process.argv[2] === 'guard-death') {
    await prisma.$executeRawUnsafe("DO $$ BEGIN PERFORM pg_sleep(3); INSERT INTO native_owner_probe VALUES ('guard-death', 123456789.12345678, 0.00000001); END $$");
  }
  await disconnectDatabase();
})().catch(error => { console.error(error.code || 'NATIVE_OWNER_WORKER_FAILED'); process.exitCode = 1; });
