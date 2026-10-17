import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { observeRuntimeDatabaseWork, runtimeDatabaseUrl, type RuntimeDatabaseIdentity } from '../runtimeDatabaseBoundary';
import { runtimePostgresApplicationName, type RuntimeBoundaryScope } from '../runtimeBoundaryJournal';
import { assertSabalanerpLocalPostgresTarget, assertTemporaryConcurrencyDatabaseName, temporaryDatabaseUrl } from './shipmentStatementConcurrency/database';

const requireRoot = createRequire(path.resolve(process.cwd(), '../package.json'));
const { Client } = requireRoot('pg');
function scope(): RuntimeBoundaryScope {
  const runtimeId = randomBytes(32).toString('hex');
  return { runtimeId, image: 'sha256:' + 'a'.repeat(64), registrySha256: 'b'.repeat(64), generation: 1,
    postgresApplicationName: runtimePostgresApplicationName(runtimeId), gate: { device: '1', inode: '2', ownerUid: 0 } };
}

test('runtime pool binding refuses ambiguous identity and unbounded pools without exposing URL secrets', () => {
  const identity = scope(), source = 'postgresql://user:secret@localhost:55432/test?connection_limit=2&pool_timeout=5';
  const bound = new URL(runtimeDatabaseUrl(source, identity));
  assert.equal(bound.searchParams.get('application_name'), identity.postgresApplicationName);
  assert.equal(bound.searchParams.getAll('application_name').length, 1);
  assert.equal(runtimeDatabaseUrl(bound.toString(), identity), bound.toString());
  for (const url of [source + '&application_name=foreign', source + '&options=-capplication_name=foreign',
    source + '&application_name=' + identity.postgresApplicationName + '&application_name=' + identity.postgresApplicationName,
    source.replace('connection_limit=2', 'connection_limit=0'), source.replace('&pool_timeout=5', '')]) {
    assert.throws(() => runtimeDatabaseUrl(url, identity), error => error instanceof Error
      && error.message.startsWith('RUNTIME_DATABASE_') && !error.message.includes('secret'));
  }
});

test('actual PostgreSQL retains exact runtime work after client loss; observation never kills or certifies it',
  { skip: !process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL, timeout: 240000 }, async () => {
    // This test needs PostgreSQL protocol/session behavior, not business schema.
    // Create only an isolated empty database in the verified existing service.
    const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT || path.resolve(process.cwd(), '..');
    const verify = () => assertSabalanerpLocalPostgresTarget(execFileSync('docker',
      ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json', 'postgres'], { encoding: 'utf8' }));
    verify();
    const databaseName = assertTemporaryConcurrencyDatabaseName('sabalanerp_concurrency_' + randomBytes(8).toString('hex'));
    const databaseUrl = temporaryDatabaseUrl(process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL!, databaseName);
    const adminUrl = new URL(databaseUrl); adminUrl.pathname = '/postgres';
    const administrator = new Client({ connectionString: adminUrl.toString() });
    await administrator.connect();
    let created = false;
    const temporary = { databaseUrl };
    const observer = new PrismaClient({ datasources: { db: { url: databaseUrl } } }), runtime = scope(), foreign = scope();
    const worker = new Client({ connectionString: runtimeDatabaseUrl(temporary.databaseUrl, runtime) });
    const unrelated = new Client({ connectionString: runtimeDatabaseUrl(temporary.databaseUrl, foreign) });
    const pool = new PrismaClient({ datasources: { db: { url: runtimeDatabaseUrl(temporary.databaseUrl, runtime) } } });
    let pending: Promise<unknown> | undefined;
    try {
      await administrator.query(`CREATE DATABASE "${databaseName}"`); created = true;
      const [identity] = await observer.$queryRaw<RuntimeDatabaseIdentity[]>`
        SELECT current_database() AS "databaseName", d.oid::text AS "databaseOid", c.system_identifier::text AS "systemIdentifier"
        FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname = current_database()`;
      let owned = true;
      const observe = (scopes = [runtime]) => observeRuntimeDatabaseWork({ database: observer, identity, scopes,
        assertBoundaryOwned() { if (!owned) throw Error('TEST_BOUNDARY_LOST'); } });
      await observer.$executeRaw`CREATE TABLE runtime_boundary_probe (id integer PRIMARY KEY, value text NOT NULL)`;
      worker.on('error', () => {}); unrelated.on('error', () => {});
      await worker.connect(); await unrelated.connect();
      await unrelated.query('BEGIN');
      await pool.$queryRaw`SELECT 1`;
      const connected = await observe();
      assert.equal(connected.sessions.length, 2); // native worker + pooled Prisma connection
      assert.ok(connected.sessions.every(row => row.applicationName === runtime.postgresApplicationName));
      assert.equal((await observe([foreign])).sessions[0].state, 'idle in transaction');
      await pool.$disconnect();
      pending = worker.query("BEGIN; INSERT INTO runtime_boundary_probe VALUES (1, 'committed-before-ack'); SELECT pg_sleep(2); COMMIT")
        .then(() => ({ acknowledged: true }), () => ({ acknowledged: false }));
      const deadline = performance.now() + 5000;
      let active = false;
      while (performance.now() < deadline) {
        const value = await observe();
        if (value.sessions.some(row => row.state === 'active' && row.transactionStart)) { active = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(active, true);
      worker.connection.stream.destroy(); // lose acknowledgement, not a server-side cancellation
      assert.deepEqual(await pending, { acknowledged: false });
      const afterClientLoss = await observe();
      assert.ok(afterClientLoss.sessions.some(row => row.state === 'active'), 'Backend work must remain visible after client death');
      let remaining = afterClientLoss;
      const settledDeadline = performance.now() + 10000;
      while (remaining.sessions.length && performance.now() < settledDeadline) {
        await new Promise(resolve => setTimeout(resolve, 20)); remaining = await observe();
      }
      assert.equal(remaining.sessions.length, 0); assert.equal(remaining.preparedTransactionCount, '0');
      assert.deepEqual(await observer.$queryRaw`SELECT id, value FROM runtime_boundary_probe`,
        [{ id: 1, value: 'committed-before-ack' }]);
      // Exact matching excludes the unrelated still-open transaction; it survives our observation.
      assert.equal((await observe([foreign])).sessions[0].state, 'idle in transaction');
      await assert.rejects(observe([runtime, { ...runtime, runtimeId: runtime.runtimeId.slice(0, 48) + 'f'.repeat(16) }]), /NAMESPACE_COLLISION/);
      await assert.rejects(observeRuntimeDatabaseWork({ database: observer, identity: { ...identity, systemIdentifier: '1' },
        scopes: [runtime], assertBoundaryOwned() {} }), /OBSERVER_IDENTITY_UNPROVEN/);
      owned = false; await assert.rejects(observe(), /TEST_BOUNDARY_LOST/);
      console.log('RUNTIME_DATABASE_LOST_ACK_COMMIT_PRESERVED_AND_FOREIGN_TRANSACTION_UNCHANGED');
    } finally {
      await pending;
      await Promise.allSettled([worker.end(), unrelated.end(), pool.$disconnect(), observer.$disconnect()]);
      try {
        if (created) {
          verify();
          // No FORCE or guessed termination. Unknown remaining sessions retain the database.
          await administrator.query(`DROP DATABASE "${databaseName}"`);
        }
      } finally { await administrator.end(); }
    }
  });
