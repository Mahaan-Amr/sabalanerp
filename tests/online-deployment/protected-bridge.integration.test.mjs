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

test('the actual protected bridge requires native ownership and atomically applies only its exact SQL and history',
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
    
    const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-migration-baseline-'));
    let created = false, successful = false;
    const observations = [];
    const intentPath = path.join(root, 'reports/qa/protected-bridge-' + operation + '-intent.json');
    fs.writeFileSync(intentPath, JSON.stringify({ format: 'sabalan-private-fixture-intent/v1', databaseName,
      fixtureSha256: digest(fs.readFileSync(import.meta.filename)), canonical: before }) + '\n', { flag: 'wx' });
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
      await Promise.all([observer.connect(), migrator.connect(), blocker.connect()]);
      const ledger = async () => (await observer.query('SELECT migration_name AS name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
      assert.deepEqual(await ledger(), baseline);
      const absent = async row => {
        assert.equal((await observer.query('SELECT count(*)::integer AS count FROM _prisma_migrations WHERE migration_name = $1', [row.name])).rows[0].count, 0);
        const tables = row === pending[0] ? ['driver_vehicle_assignment_plans'] : ['online_releases', 'online_runtime_slots', 'online_migration_steps'];
        for (const table of tables) assert.equal((await observer.query('SELECT to_regclass($1)::text AS name', ['public.' + table])).rows[0].name, null);
        if (row === pending[1]) assert.equal((await observer.query("SELECT count(*)::integer AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'sabalan_protect_online_%'")).rows[0].count, 0);
      };
      verify();
      const [slot] = JSON.parse(execFileSync('docker', ['inspect', 'sabalanerp-local-backend-candidate-1'], { encoding: 'utf8' }));
      assert.equal(slot.Config.Labels['com.docker.compose.project'], 'sabalanerp-local');
      assert.equal(slot.Config.Labels['com.docker.compose.service'], 'backend-candidate');
      assert.ok(slot.State.Running && slot.State.Health.Status === 'healthy');
      assert.ok(slot.Config.Env.includes('BACKEND_RUNTIME_ROLE=candidate'));
      assert.equal(slot.Image, before[0].image);
      const mounted = slot.Mounts.find(value => value.Destination === '/app/online-runtime-acceptance');
      assert.equal(mounted?.Name, 'sabalanerp-local_online_runtime_acceptance'); assert.equal(mounted.RW, true);
      const privateDirectory = '/app/online-runtime-acceptance/protected-bridge-' + randomBytes(16).toString('hex');
      const owner = { deploymentId: 'bridge-' + operation, releaseId: 'bridge-release-' + operation, leaseToken: randomBytes(32).toString('hex') };
      const checkpoint = { deploymentId: owner.deploymentId, releaseId: owner.releaseId, localVerified: true,
        remoteVerified: true, restoreVerified: true, manifestReadable: true, checksum: 'a'.repeat(64) };
      // Private authority-state fixture, never a claim that a real recovery
      // archive or production deployment was verified by these test flags.
      await observer.query(`INSERT INTO deployment_operations (id,"activeKey","releaseId","targetCommit",owner,phase,"leaseToken","leaseExpiresAt","heartbeatAt","startedAt","updatedAt","checkpointJson")
        VALUES ($1,'production',$2,$3,'private-bridge-fixture','MUTATION_STARTED',$4,clock_timestamp()+interval '10 minutes',clock_timestamp(),clock_timestamp(),clock_timestamp(),$5)`,
        [owner.deploymentId, owner.releaseId, 'b'.repeat(40), owner.leaseToken, checkpoint]);
      const files = Object.fromEntries(['protectedBridgeMigrations', 'runtimeControlOwnership'].map(name =>
        [name + '.js', fs.readFileSync(path.join(root, 'backend/dist/services', name + '.js'))]));
      files['worker.cjs'] = fs.readFileSync(path.join(root, 'tests/online-deployment/protected-bridge.worker.cjs'));
      for (const row of pending) files[row.name + '.sql'] = row.sql;
      const provision = `const fs=require('fs'),path=require('path'),input=JSON.parse(fs.readFileSync(0,'utf8'));
        const root=input.root;fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(path.join(root,'coordination'),{mode:0o700});
        for(const[name,bytes]of Object.entries(input.files)){if(path.basename(name)!==name)throw Error('UNSAFE_FILE');
          fs.writeFileSync(path.join(root,name),Buffer.from(bytes,'base64'),{flag:'wx',mode:0o400});}
        fs.writeFileSync(path.join(root,'configuration.json'),JSON.stringify(input.configuration),{flag:'wx',mode:0o400});
        fs.writeFileSync(path.join(root,'coordination/deployment-maintenance.json'),JSON.stringify(input.configuration.owner),{flag:'wx',mode:0o600});`;
      verify(); execFileSync('docker', ['exec', '-i', slot.Id, 'node', '-e', provision], { input: JSON.stringify({ root: privateDirectory,
        files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')])),
        configuration: { root: privateDirectory, databaseName, owner, migrations: pending.map(row => row.name) } }) });
      const invoke = command => {
        verify();
        const output = execFileSync('docker', ['exec', slot.Id, 'sh', '-c',
          'set -eu; umask 077; export RECOVERY_COORDINATION_DIR="$1/coordination"; export BACKEND_RUNTIME_ROLE=control; export BACKEND_CONTROL_LOCK_FILE="$1/coordination/deployment-runtime-control.lock"; export BACKEND_CONTROL_LOCK_FD=9; exec 9>>"$BACKEND_CONTROL_LOCK_FILE"; flock --nonblock 9; exec node "$1/worker.cjs" "$1/configuration.json" "$2"',
          'protected-bridge-fixture', privateDirectory, JSON.stringify(command)], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
        return JSON.parse(output.trim());
      };
      const fails = (command, code) => { const value = invoke(command); assert.equal(value.ok, false); assert.equal(value.code, code); return value; };
      fails({ index: 0, tamper: true }, 'PROTECTED_BRIDGE_SQL_IDENTITY_MISMATCH');
      fails({ index: 0, wrongOwner: true }, 'PROTECTED_BRIDGE_CHECKPOINT_LEASE_UNPROVEN');
      fails({ index: 0, dropLock: true }, 'RUNTIME_CONTROL_OWNERSHIP_REQUIRED');
      await observer.query('UPDATE deployment_operations SET "checkpointJson"=$2 WHERE id=$1', [owner.deploymentId, { ...checkpoint, remoteVerified: false }]);
      fails({ index: 0 }, 'PROTECTED_BRIDGE_CHECKPOINT_LEASE_UNPROVEN');
      await observer.query('UPDATE deployment_operations SET "checkpointJson"=$2, "leaseExpiresAt"=clock_timestamp() WHERE id=$1', [owner.deploymentId, checkpoint]);
      fails({ index: 0 }, 'PROTECTED_BRIDGE_CHECKPOINT_LEASE_UNPROVEN');
      await observer.query("UPDATE deployment_operations SET \"leaseExpiresAt\"=clock_timestamp()+interval '10 minutes' WHERE id=$1", [owner.deploymentId]);
      await absent(pending[0]);
      // Actual DDL trigger expires the owned lease inside the real adapter's
      // transaction. Its post-DDL authority check must roll back both effects.
      await observer.query(`CREATE FUNCTION public.qa_expire_bridge_lease() RETURNS event_trigger AS $$ BEGIN
        UPDATE public.deployment_operations SET "leaseExpiresAt"=clock_timestamp() WHERE id='${owner.deploymentId}'; END; $$ LANGUAGE plpgsql`);
      await observer.query("CREATE EVENT TRIGGER qa_expire_bridge_lease ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.qa_expire_bridge_lease()");
      try { fails({ index: 0 }, 'PROTECTED_BRIDGE_CHECKPOINT_LEASE_UNPROVEN'); await absent(pending[0]); }
      finally { await observer.query('DROP EVENT TRIGGER qa_expire_bridge_lease'); await observer.query('DROP FUNCTION public.qa_expire_bridge_lease()'); }
      for (const [index, row] of pending.entries()) {
        const parent = index === 0 ? 'internal_driver_profiles' : 'deployment_operations';
        await blocker.query('BEGIN'); await blocker.query(`LOCK TABLE "${parent}" IN ROW EXCLUSIVE MODE`);
        try {
          const started = performance.now(), value = invoke({ index });
          assert.equal(value.ok, false); assert.equal(value.sqlState, '55P03'); await absent(row);
          const elapsedMs = performance.now() - started; assert.ok(elapsedMs < 10000);
          observations.push({ name: row.name, blockedParent: parent, nativeProcessAndBoundedFailureMs: elapsedMs });
        } finally { await blocker.query('ROLLBACK'); }
        const applied = invoke({ index }); assert.equal(applied.ok, true); assert.equal(applied.value.applied, true);
        const again = invoke({ index }); assert.equal(again.ok, true); assert.equal(again.value.applied, false);
        const receipt = (await observer.query('SELECT logs FROM _prisma_migrations WHERE migration_name=$1', [row.name])).rows[0].logs;
        assert.match(JSON.parse(receipt).catalogSha256, /^[a-f0-9]{64}$/);
        if (index === 0) {
          await observer.query('ALTER TABLE public.driver_vehicle_assignment_plans ALTER COLUMN "blockedReason" TYPE varchar(128)');
          fails({ index }, 'PROTECTED_BRIDGE_SCHEMA_DRIFT');
          await observer.query('ALTER TABLE public.driver_vehicle_assignment_plans ALTER COLUMN "blockedReason" TYPE text');
          assert.equal(invoke({ index }).value.applied, false);
        }
      }
      const namespaces = await observer.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=$1 AND application_name=$2', [databaseName, 'sabalan-bridge-' + operation]);
      assert.equal(namespaces.rows[0].count, 0);
      observations.push({ compiledSourceSha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])),
        privateEvidenceRetained: privateDirectory, nativeControlLockRequired: true, postDdlLeaseLossRolledBack: true,
        checkpointLeaseRejections: true, catalogDriftRejected: true, completedWorkerSessions: 0 });
      const final = await ledger();
      assert.deepEqual(final, [...baseline, ...pending.map(row => ({ name: row.name, checksum: row.sha256 }))]);
      const noWork = await child([prisma, 'migrate', 'deploy', '--schema', path.join(root, 'backend/prisma/schema.prisma')], { cwd: path.join(root, 'backend'), env: environment });
      assert.match(noWork, /No pending migrations to apply/);
      const hr = await child([path.join(root, 'backend/node_modules/tsx/dist/cli.mjs'), '--test', 'src/services/__tests__/hrVehicleOperations.integration.test.ts'], { cwd: path.join(root, 'backend'), env: environment });
      assert.match(hr, /# fail 0/); assert.match(hr, /# pass 9/);
      observations.push({ nativePrismaRecognizesBoth: true, atomicHistoryAndIdempotentRetry: true, hrVehicleOperations: { passed: 9, failed: 0 } });
      assert.deepEqual(identities(), before); successful = true;
    } finally {
      await Promise.allSettled([observer.end(), migrator.end(), blocker.end()]);
      try {
        // Failed fixtures retain their database for inspection. No forced drop,
        // SQL termination or synthetic ledger repair can convert failure to PASS.
        if (created && successful) { verify(); await administrator.query(`DROP DATABASE "${databaseName}"`); }
      } finally { await administrator.end(); }
      // Delete only the exact locally-created schema-source staging directory.
      assert.equal(path.dirname(staging), os.tmpdir()); assert.ok(path.basename(staging).startsWith('sabalan-migration-baseline-'));
      fs.rmSync(staging, { recursive: true });
    }
    const report = { ownedProtectedBridgePassed: true, baselineAppliedCount: 425, databaseName, temporaryDatabaseDroppedWithoutForce: true,
      pending: pending.map(({ name, sha256 }) => ({ name, sha256 })), observations, canonicalBeforeAndAfter: before,
      fixtureSha256: digest(fs.readFileSync(import.meta.filename)), limits: ['empty actual schema, not production data', 'synthetic private lease/checkpoint metadata, not a production verified checkpoint', 'no full financial/old-runtime compatibility proof'] };
    const reportPath = path.join(root, 'reports/qa/protected-bridge-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + operation + '.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ reportPath }));
  });
