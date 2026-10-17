import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import test from 'node:test';

const { Client } = createRequire(import.meta.url)('pg');
const root = path.resolve(import.meta.dirname, '../..');
const canonical = process.env.SABALAN_LOCAL_REPOSITORY_ROOT;
const source = process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const pending = [
  { name: '20261014120000_hr_vehicle_assignment_plans', sha256: 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289' },
  { name: '20261014140000_online_deployment_control', sha256: '872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2' },
];
function verify() {
  const output = execFileSync('docker', ['compose', '-f', path.join(canonical, 'docker-compose.local.yml'), 'ps', '--format', 'json'], { encoding: 'utf8' });
  let rows; try { const parsed = JSON.parse(output); rows = Array.isArray(parsed) ? parsed : [parsed]; }
  catch { rows = output.trim().split(/\r?\n/).map(JSON.parse); }
  for (const service of ['postgres', 'backend', 'frontend', 'inquiry']) assert.ok(rows.some(row => row.Project === 'sabalanerp-local'
    && row.Service === service && row.State === 'running' && row.Health === 'healthy'));
}
function identities() {
  verify();
  return JSON.parse(execFileSync('docker', ['inspect', ...['backend', 'frontend', 'inquiry', 'postgres'].map(service => 'sabalanerp-local-' + service + '-1')], { encoding: 'utf8' }))
    .map(value => ({ id: value.Id, image: value.Image, startedAt: value.State.StartedAt }));
}
const child = (args, options) => new Promise((resolve, reject) => {
  const process = spawn(globalThis.process.execPath, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', overflow = false;
  for (const stream of [process.stdout, process.stderr]) stream.on('data', bytes => {
    if (Buffer.byteLength(output) + bytes.length > 4 * 1024 * 1024) overflow = true;
    else output += bytes.toString();
  });
  process.on('error', reject); process.on('close', (code, signal) => {
    if (code !== 0 || signal || overflow) reject(Error('NATIVE_FIXTURE_CHILD_FAILED_' + code));
    else resolve(output);
  });
});

test('the exact two pending production SQL files have bounded FK waits and transactional history on the measured 425-migration schema',
  { skip: !canonical || !source, timeout: 300000 }, async () => {
    // SQL rehearsal only. No production migration/lease/admission entry point.
    // Production data is never copied; this isolated database has actual schema.
    const before = identities();
    const url = new URL(source);
    assert.equal(url.protocol, 'postgresql:'); assert.ok(['127.0.0.1:55432', 'localhost:55432'].includes(url.host));
    assert.equal(url.pathname, '/sabalanerp'); assert.equal(url.searchParams.get('connection_limit'), '2');
    assert.equal(url.searchParams.get('pool_timeout'), '10'); assert.equal(url.searchParams.has('options'), false);
    const operation = randomBytes(8).toString('hex'), databaseName = 'sabalanerp_concurrency_' + operation;
    url.pathname = '/postgres'; url.searchParams.set('application_name', 'sabalan-migration-qa-admin-' + operation);
    const administrator = new Client({ connectionString: url.toString() });
    url.pathname = '/' + databaseName;
    const databaseUrl = url.toString();
    const connection = name => { const value = new URL(databaseUrl); value.searchParams.set('application_name', name); return new Client({ connectionString: value.toString() }); };
    const observer = connection('sabalan-migration-qa-observer-' + operation);
    const migrator = connection('sabalan-migration-qa-ddl-' + operation);
    const blocker = connection('sabalan-migration-qa-blocker-' + operation);
    const lost = connection('sabalan-migration-qa-lost-' + operation);
    lost.on('error', () => {});
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-migration-baseline-'));
    let created = false, successful = false, acknowledgement;
    const observations = [];
    try {
      const inventory = JSON.parse(fs.readFileSync(path.join(root, 'reports/qa/production-migration-inventory-20261017.json'), 'utf8'));
      const baseline = inventory.migrations.filter(row => row.finishedAt && !row.rolledBackAt).map(row => ({ name: row.name, checksum: row.checksum })).sort((a, b) => a.name.localeCompare(b.name));
      assert.equal(baseline.length, 425); assert.equal(new Set(baseline.map(row => row.name)).size, 425);
      const directory = path.join(root, 'backend/prisma/migrations');
      const names = fs.readdirSync(directory, { withFileTypes: true }).filter(row => row.isDirectory()).map(row => row.name).sort();
      assert.deepEqual(names.filter(name => !baseline.some(row => row.name === name)), pending.map(row => row.name));
      fs.mkdirSync(path.join(staging, 'migrations'));
      fs.copyFileSync(path.join(root, 'backend/prisma/schema.prisma'), path.join(staging, 'schema.prisma'));
      fs.copyFileSync(path.join(directory, 'migration_lock.toml'), path.join(staging, 'migrations/migration_lock.toml'));
      for (const row of baseline) {
        const bytes = fs.readFileSync(path.join(directory, row.name, 'migration.sql')); assert.equal(digest(bytes), row.checksum);
        fs.mkdirSync(path.join(staging, 'migrations', row.name)); fs.writeFileSync(path.join(staging, 'migrations', row.name, 'migration.sql'), bytes, { flag: 'wx' });
      }
      for (const row of pending) { row.sql = fs.readFileSync(path.join(directory, row.name, 'migration.sql')); assert.equal(digest(row.sql), row.sha256); }
      await administrator.connect(); await administrator.query(`CREATE DATABASE "${databaseName}"`); created = true;
      const prisma = path.join(root, 'backend/node_modules/prisma/build/index.js');
      const environment = { ...process.env, DATABASE_URL: databaseUrl };
      // An independent native test process must not inherit node:test's worker
      // context, which otherwise skips the nested --test run entirely.
      delete environment.NODE_TEST_CONTEXT;
      const migrated = await child([prisma, 'migrate', 'deploy', '--schema', path.join(staging, 'schema.prisma')], { cwd: path.join(root, 'backend'), env: environment });
      assert.match(migrated, /All migrations have been successfully applied/);
      await Promise.all([observer.connect(), migrator.connect(), blocker.connect(), lost.connect()]);
      const ledger = async () => (await observer.query('SELECT migration_name AS name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
      assert.deepEqual(await ledger(), baseline);
      const absent = async row => {
        assert.equal((await observer.query('SELECT count(*)::integer AS count FROM _prisma_migrations WHERE migration_name = $1', [row.name])).rows[0].count, 0);
        const tables = row === pending[0] ? ['driver_vehicle_assignment_plans'] : ['online_releases', 'online_runtime_slots', 'online_migration_steps'];
        for (const table of tables) assert.equal((await observer.query('SELECT to_regclass($1)::text AS name', ['public.' + table])).rows[0].name, null);
        if (row === pending[1]) assert.equal((await observer.query("SELECT count(*)::integer AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'sabalan_protect_online_%'")).rows[0].count, 0);
      };
      const apply = async (row, interrupt = false) => {
        await migrator.query('BEGIN');
        try {
          await migrator.query("SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='10s'");
          await migrator.query(row.sql.toString());
          if (interrupt) throw Error('INJECTED_BEFORE_HISTORY');
          await migrator.query('INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ($1,$2,clock_timestamp(),$3,clock_timestamp(),1)', [randomUUID(), row.sha256, row.name]);
          await migrator.query('COMMIT');
        } catch (error) { await migrator.query('ROLLBACK'); throw error; }
      };
      for (const [index, row] of pending.entries()) {
        const parent = index === 0 ? 'internal_driver_profiles' : 'deployment_operations';
        await blocker.query('BEGIN'); await blocker.query(`LOCK TABLE "${parent}" IN ROW EXCLUSIVE MODE`);
        try {
          const started = performance.now(); await assert.rejects(apply(row), error => error.code === '55P03');
          const elapsedMs = performance.now() - started; assert.ok(elapsedMs < 3000); await absent(row);
          observations.push({ name: row.name, blockedParent: parent, boundedFailureMs: elapsedMs, ddlAndHistoryRolledBack: true });
        } finally { await blocker.query('ROLLBACK'); }
        await assert.rejects(apply(row, true), /INJECTED_BEFORE_HISTORY/); await absent(row);
        if (index === 0) { await apply(row); continue; }
        // Commit is visible to an independent connection before the client loses
        // its acknowledgement. This is not a guessed success after a timeout.
        const id = randomUUID();
        acknowledgement = lost.query({ text: "BEGIN; SET LOCAL lock_timeout='250ms'; SET LOCAL statement_timeout='10s'; " + row.sql.toString() +
          ` INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES ('${id}','${row.sha256}',clock_timestamp(),'${row.name}',clock_timestamp(),1); COMMIT; SELECT pg_sleep(2);` })
          .then(() => ({ acknowledged: true }), () => ({ acknowledged: false }));
        const deadline = performance.now() + 5000;
        while (!(await ledger()).some(value => value.name === row.name) && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
        assert.ok((await ledger()).some(value => value.name === row.name));
        lost.connection.stream.destroy(); assert.deepEqual(await acknowledgement, { acknowledged: false });
        const remainingDeadline = performance.now() + 10000;
        let remaining;
        do {
          remaining = (await observer.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=$1 AND application_name=$2', [databaseName, 'sabalan-migration-qa-lost-' + operation])).rows[0].count;
          if (remaining) await new Promise(resolve => setTimeout(resolve, 20));
        } while (remaining && performance.now() < remainingDeadline);
        assert.equal(remaining, 0);
      }
      const final = await ledger();
      assert.deepEqual(final, [...baseline, ...pending.map(row => ({ name: row.name, checksum: row.sha256 }))]);
      const noWork = await child([prisma, 'migrate', 'deploy', '--schema', path.join(root, 'backend/prisma/schema.prisma')], { cwd: path.join(root, 'backend'), env: environment });
      assert.match(noWork, /No pending migrations to apply/);
      const hr = await child([path.join(root, 'backend/node_modules/tsx/dist/cli.mjs'), '--test', 'src/services/__tests__/hrVehicleOperations.integration.test.ts'], { cwd: path.join(root, 'backend'), env: environment });
      assert.match(hr, /# fail 0/); assert.match(hr, /# pass 9/);
      observations.push({ nativePrismaRecognizesBoth: true, lostAcknowledgementCommittedExactlyOnce: true, hrVehicleOperations: { passed: 9, failed: 0 } });
      assert.deepEqual(identities(), before); successful = true;
    } finally {
      await acknowledgement;
      await Promise.allSettled([observer.end(), migrator.end(), blocker.end(), lost.end()]);
      try {
        // Failed fixtures retain their database for inspection. No forced drop,
        // SQL termination or synthetic ledger repair can convert failure to PASS.
        if (created && successful) { verify(); await administrator.query(`DROP DATABASE "${databaseName}"`); }
      } finally { await administrator.end(); }
      // Delete only the exact locally-created schema-source staging directory.
      assert.equal(path.dirname(staging), os.tmpdir()); assert.ok(path.basename(staging).startsWith('sabalan-migration-baseline-'));
      fs.rmSync(staging, { recursive: true });
    }
    const report = { pendingProductionSqlRehearsalPassed: true, baselineAppliedCount: 425, databaseName, temporaryDatabaseDroppedWithoutForce: true,
      pending: pending.map(({ name, sha256 }) => ({ name, sha256 })), observations, canonicalBeforeAndAfter: before,
      fixtureSha256: digest(fs.readFileSync(import.meta.filename)), limits: ['empty actual schema, not production data', 'no production lease or migration entrypoint', 'no full financial/old-runtime compatibility proof'] };
    const reportPath = path.join(root, 'reports/qa/pending-production-migrations-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + operation + '.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ reportPath }));
  });
