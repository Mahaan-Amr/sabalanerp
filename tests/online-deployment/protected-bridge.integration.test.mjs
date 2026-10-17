import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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
    const restoredDatabaseName = 'sabalanerp_concurrency_' + randomBytes(8).toString('hex');
    const faultDatabaseName = 'sabalanerp_concurrency_' + randomBytes(8).toString('hex');
    url.pathname = '/postgres'; url.searchParams.set('application_name', 'sabalan-migration-qa-admin-' + operation);
    const administrator = new Client({ connectionString: url.toString() });
    url.pathname = '/' + databaseName;
    const databaseUrl = url.toString();
    const connection = name => { const value = new URL(databaseUrl); value.searchParams.set('application_name', name); return new Client({ connectionString: value.toString() }); };
    const observer = connection('sabalan-migration-qa-observer-' + operation);
    const migrator = connection('sabalan-migration-qa-ddl-' + operation);
    const blocker = connection('sabalan-migration-qa-blocker-' + operation);
    
    let created = false, restoredCreated = false, faultCreated = false, successful = false, restoredObserver;
    let faultObserver, faultBlocker, faultHeld;
    const observations = [];
    const intentPath = path.join(root, 'reports/qa/protected-bridge-' + operation + '-intent.json');
    fs.writeFileSync(intentPath, JSON.stringify({ format: 'sabalan-private-fixture-intent/v1', databaseName, restoredDatabaseName, faultDatabaseName,
      fixtureSha256: digest(fs.readFileSync(import.meta.filename)), canonical: before }) + '\n', { flag: 'wx' });
    try {
      const inventory = JSON.parse(fs.readFileSync(path.join(root, 'reports/qa/production-migration-inventory-20261017.json'), 'utf8'));
      const baseline = inventory.migrations.filter(row => row.finishedAt && !row.rolledBackAt).map(row => ({ name: row.name, checksum: row.checksum })).sort((a, b) => a.name.localeCompare(b.name));
      assert.equal(baseline.length, 425); assert.equal(new Set(baseline.map(row => row.name)).size, 425);
      const directory = path.join(root, 'backend/prisma/migrations');
      const names = fs.readdirSync(directory, { withFileTypes: true }).filter(row => row.isDirectory()).map(row => row.name).sort();
      assert.deepEqual(names.filter(name => !baseline.some(row => row.name === name)), pending.map(row => row.name));
      for (const row of baseline) {
        const bytes = fs.readFileSync(path.join(directory, row.name, 'migration.sql')); assert.equal(digest(bytes), row.checksum);
      }
      for (const row of pending) { row.sql = fs.readFileSync(path.join(directory, row.name, 'migration.sql')); assert.equal(digest(row.sql), row.sha256); }
      await administrator.connect(); await administrator.query(`CREATE DATABASE "${databaseName}"`); created = true;
      const prisma = path.join(root, 'backend/node_modules/prisma/build/index.js');
      const environment = { ...process.env, DATABASE_URL: databaseUrl };
      // An independent native test process must not inherit node:test's worker
      // context, which otherwise skips the nested --test run entirely.
      delete environment.NODE_TEST_CONTEXT;
      await Promise.all([observer.connect(), migrator.connect(), blocker.connect()]);
      const ledger = async () => (await observer.query('SELECT migration_name AS name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows;
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
        remoteVerified: true, restoreVerified: true, manifestReadable: true, checksum: 'a'.repeat(64), createdAt: new Date().toISOString() };
      // Private authority-state fixture, never a claim that a real recovery
      // archive or production deployment was verified by these test flags.
      const files = Object.fromEntries(['protectedBridgeMigrations', 'runtimeControlOwnership'].map(name =>
        ['dist/services/' + name + '.js', fs.readFileSync(path.join(root, 'backend/dist/services', name + '.js'))]));
      files['dist/lib/prisma.js'] = fs.readFileSync(path.join(root, 'backend/dist/lib/prisma.js'));
      files['dist/scripts/deployment-owned-migrations.js'] = fs.readFileSync(path.join(root, 'backend/dist/scripts/deployment-owned-migrations.js'));
      // Freeze the actual control command and its complete local module
      // closure; no substitute bootstrap/adoption implementation is tested.
      const collect = relative => {
        if (files[relative]) return;
        const bytes = fs.readFileSync(path.join(root, 'backend', relative)); files[relative] = bytes;
        if (!relative.endsWith('.js')) return;
        for (const match of bytes.toString().matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
          let dependency = path.posix.normalize(path.posix.join(path.posix.dirname(relative), match[1]));
          if (!dependency.endsWith('.json')) dependency += '.js';
          assert.ok(dependency.startsWith('dist/')); collect(dependency);
        }
      };
      collect('dist/scripts/deployment-control.js');
      files['prisma/schema.prisma'] = fs.readFileSync(path.join(root, 'backend/prisma/schema.prisma'));
      files['prisma/migrations/migration_lock.toml'] = fs.readFileSync(path.join(directory, 'migration_lock.toml'));
      for (const name of ['protected-bootstrap-owner.py', 'protected-bootstrap-state.py']) {
        files['scripts/' + name] = fs.readFileSync(path.join(root, 'deploy/scripts', name));
      }
      files['worker.cjs'] = fs.readFileSync(path.join(root, 'tests/online-deployment/protected-bridge.worker.cjs'));
      files['cli-worker.cjs'] = fs.readFileSync(path.join(root, 'tests/online-deployment/protected-bridge-cli.worker.cjs'));
      for (const row of pending) files[row.name + '.sql'] = row.sql;
      for (const name of names) files['prisma/migrations/' + name + '/migration.sql'] = fs.readFileSync(path.join(directory, name, 'migration.sql'));
      const provision = `const fs=require('fs'),path=require('path'),input=JSON.parse(fs.readFileSync(0,'utf8'));
        const root=input.root;fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(path.join(root,'coordination'),{mode:0o700});
        for(const[name,bytes]of Object.entries(input.files)){if(!name.split('/').every(part=>/^[a-zA-Z0-9_.-]+$/.test(part)&&part!=='.'&&part!=='..'))throw Error('UNSAFE_FILE');
          fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true,mode:0o700});
          fs.writeFileSync(path.join(root,name),Buffer.from(bytes,'base64'),{flag:'wx',mode:0o400});}
        fs.writeFileSync(path.join(root,'configuration.json'),JSON.stringify(input.configuration),{flag:'wx',mode:0o400});
        fs.writeFileSync(path.join(root,'coordination/deployment-maintenance.json'),JSON.stringify(input.configuration.owner),{flag:'wx',mode:0o600});
        fs.writeFileSync(path.join(root,'coordination/deployment-checkpoint.json'),JSON.stringify(input.checkpoint),{flag:'wx',mode:0o600});
        fs.mkdirSync(path.join(root,'reports'),{mode:0o700});
        fs.writeFileSync(path.join(root,'reports/active-deployment-session.json'),JSON.stringify({...input.configuration.owner,
          bootstrap:true,phase:'MUTATION_STARTED',targetCommit:'b'.repeat(40),owner:'private-bridge-fixture'}),{flag:'wx',mode:0o600});`;
      verify(); execFileSync('docker', ['exec', '-i', slot.Id, 'node', '-e', provision], { input: JSON.stringify({ root: privateDirectory,
        files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')])),
        checkpoint, configuration: { root: privateDirectory, databaseName, owner, migrations: pending.map(row => row.name) } }) });
      const invoke = (command, configurationFile = 'configuration.json') => {
        assert.ok(['configuration.json', 'configuration-restored.json'].includes(configurationFile));
        verify();
        const output = execFileSync('docker', ['exec', slot.Id, 'sh', '-c',
          'set -eu; umask 077; export RECOVERY_COORDINATION_DIR="$1/coordination"; export BACKEND_RUNTIME_ROLE=control; export BACKEND_CONTROL_LOCK_FILE="$1/coordination/deployment-runtime-control.lock"; export BACKEND_CONTROL_LOCK_FD=9; exec 9>>"$BACKEND_CONTROL_LOCK_FILE"; flock --nonblock 9; exec node "$1/worker.cjs" "$1/$3" "$2"',
          'protected-bridge-fixture', privateDirectory, JSON.stringify(command), configurationFile], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
        return JSON.parse(output.trim());
      };
      const invokeCli = (command = '') => {
        assert.ok(['', 'bootstrap-migrate-baseline', 'bootstrap-adopt'].includes(command));
        verify();
        const value = spawnSync('docker', ['exec', slot.Id, 'sh', '-c',
          'set -eu; umask 077; export RECOVERY_COORDINATION_DIR="$1/coordination"; export BACKEND_RUNTIME_ROLE=control; export BACKEND_CONTROL_LOCK_FILE="$1/coordination/deployment-runtime-control.lock"; export BACKEND_CONTROL_LOCK_FD=9; exec 9>>"$BACKEND_CONTROL_LOCK_FILE"; flock --nonblock 9; if [ -n "$2" ]; then exec node "$1/cli-worker.cjs" "$1/configuration.json" "$2"; else exec node "$1/cli-worker.cjs" "$1/configuration.json"; fi',
          'protected-bridge-cli-fixture', privateDirectory, command], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
        assert.equal(value.error, undefined); assert.equal(value.signal, null);
        const messages = (value.stdout + '\n' + value.stderr).split(/\r?\n/).filter(line => line.startsWith('{')).map(line => JSON.parse(line));
        return { status: value.status, messages };
      };
      // Kill the REAL intermediate Prisma CLI during blocked native DDL. A
      // second real transaction in that exact namespace deliberately outlives
      // the reaped engine, proving SQL completion is a separate boundary.
      await administrator.query(`CREATE DATABASE "${faultDatabaseName}"`); faultCreated = true;
      const faultUrl = new URL(databaseUrl); faultUrl.pathname = '/' + faultDatabaseName;
      faultObserver = new Client({ connectionString: faultUrl.toString() });
      faultBlocker = new Client({ connectionString: faultUrl.toString() });
      await faultObserver.connect(); await faultBlocker.connect();
      await faultObserver.query(`CREATE FUNCTION public.qa_block_bootstrap() RETURNS event_trigger AS $$ BEGIN
        PERFORM pg_advisory_xact_lock(741936499); END; $$ LANGUAGE plpgsql`);
      await faultObserver.query("CREATE EVENT TRIGGER qa_block_bootstrap ON ddl_command_end WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION public.qa_block_bootstrap()");
      await faultBlocker.query('SELECT pg_advisory_lock(741936499)');
      const faultDirectory = '/app/online-runtime-acceptance/protected-bridge-' + randomBytes(16).toString('hex');
      const faultOwner = { deploymentId: 'fault-' + operation, releaseId: 'fault-release-' + operation, leaseToken: randomBytes(32).toString('hex') };
      verify(); execFileSync('docker', ['exec', '-i', slot.Id, 'node', '-e', provision], { input: JSON.stringify({ root: faultDirectory,
        files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString('base64')])),
        checkpoint: { ...checkpoint, deploymentId: faultOwner.deploymentId, releaseId: faultOwner.releaseId },
        configuration: { root: faultDirectory, databaseName: faultDatabaseName, owner: faultOwner, migrations: pending.map(row => row.name) } }) });
      verify();
      const faultProcess = spawn('docker', ['exec', slot.Id, 'sh', '-c',
        'set -eu; umask 077; export RECOVERY_COORDINATION_DIR="$1/coordination"; export BACKEND_RUNTIME_ROLE=control; export BACKEND_CONTROL_LOCK_FILE="$1/coordination/deployment-runtime-control.lock"; export BACKEND_CONTROL_LOCK_FD=9; exec 9>>"$BACKEND_CONTROL_LOCK_FILE"; flock --nonblock 9; exec node "$1/cli-worker.cjs" "$1/configuration.json" bootstrap-migrate-baseline',
        'protected-bootstrap-fault', faultDirectory], { stdio: ['ignore', 'pipe', 'pipe'] });
      let faultOutput = '';
      for (const stream of [faultProcess.stdout, faultProcess.stderr]) stream.on('data', bytes => {
        assert.ok(Buffer.byteLength(faultOutput) + bytes.length < 1024 * 1024); faultOutput += bytes.toString();
      });
      const faultClosed = new Promise((resolve, reject) => {
        faultProcess.once('error', reject); faultProcess.once('close', (code, signal) => resolve({ code, signal }));
      });
      const waitFor = async predicate => {
        const deadline = performance.now() + 30000;
        while (!await predicate()) {
          assert.ok(performance.now() < deadline, 'native fault boundary must become observable');
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      };
      let blockedNative;
      await waitFor(async () => {
        [blockedNative] = (await faultObserver.query(`SELECT pid,application_name AS namespace,left(query,256) AS query
          FROM pg_stat_activity WHERE datname=$1 AND application_name LIKE 'sabalan-bootstrap-%'
            AND wait_event_type='Lock' AND wait_event='advisory'`, [faultDatabaseName])).rows;
        return Boolean(blockedNative);
      });
      faultUrl.searchParams.set('application_name', blockedNative.namespace);
      faultHeld = new Client({ connectionString: faultUrl.toString() }); await faultHeld.connect();
      await faultHeld.query('BEGIN'); await faultHeld.query('SELECT 1');
      verify();
      const killed = JSON.parse(execFileSync('docker', ['exec', slot.Id, 'python3', '-c',
        `import json,os,pathlib,signal,sys
root=pathlib.Path(sys.argv[1]); state=json.loads((root/'coordination/deployment-bootstrap-native.json').read_text())
assert state['phase']=='ACTIVE' and state['deploymentId']==sys.argv[2]
pid=state['pid']; assert pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip()==state['bootId']
assert os.readlink('/proc/'+str(pid)+'/ns/pid')==state['pidNamespace']
assert pathlib.Path('/proc/'+str(pid)+'/stat').read_text().split(') ',1)[1].split()[19]==state['startTicks']
children=pathlib.Path('/proc/'+str(pid)+'/task/'+str(pid)+'/children').read_text().split(); assert len(children)==1
child=int(children[0]); command=pathlib.Path('/proc/'+str(child)+'/cmdline').read_bytes().split(b'\\0')
assert any(value.endswith(b'/prisma/build/index.js') for value in command)
os.kill(child,signal.SIGKILL); print(json.dumps({'guardianPid':pid,'killedIntermediateCliPid':child,'namespace':state['namespace']}))`,
        faultDirectory, faultOwner.deploymentId], { encoding: 'utf8' }));
      assert.equal(killed.namespace, blockedNative.namespace);
      await waitFor(async () => {
        verify();
        return execFileSync('docker', ['exec', slot.Id, 'python3', '-c',
          "import pathlib,sys; print(pathlib.Path('/proc/'+sys.argv[1]+'/task/'+sys.argv[1]+'/children').read_text().strip())", String(killed.guardianPid)],
        { encoding: 'utf8' }).trim() === '';
      });
      verify();
      const competing = spawnSync('docker', ['exec', slot.Id, 'flock', '--nonblock', faultDirectory + '/coordination/deployment-runtime-control.lock', 'true'], { encoding: 'utf8' });
      assert.equal(competing.status, 1); assert.equal(competing.signal, null); assert.equal(competing.error, undefined);
      verify();
      const stillActive = JSON.parse(execFileSync('docker', ['exec', slot.Id, 'cat', faultDirectory + '/coordination/deployment-bootstrap-native.json'], { encoding: 'utf8' }));
      assert.equal(stillActive.phase, 'ACTIVE'); assert.equal(faultProcess.exitCode, null);
      await faultHeld.query('ROLLBACK'); await faultHeld.end(); faultHeld = undefined;
      await faultBlocker.query('SELECT pg_advisory_unlock(741936499)');
      const terminal = await faultClosed; assert.equal(terminal.code, 1); assert.equal(terminal.signal, null);
      assert.ok(faultOutput.includes('PROTECTED_BOOTSTRAP_NATIVE_FAILED'));
      verify();
      const completed = JSON.parse(execFileSync('docker', ['exec', slot.Id, 'cat', faultDirectory + '/coordination/deployment-bootstrap-native.json'], { encoding: 'utf8' }));
      assert.equal(completed.phase, 'QUIESCENT'); assert.equal(completed.nativeReaped, true);
      assert.equal(completed.databaseQuiet, true); assert.equal(completed.failed, true);
      assert.equal(completed.nativeStatus, -9);
      observations.push({ intermediateNativeCliKilledDuringActualDdl: { ...killed, blockedNative },
        guardianReapedDescendantsBeforeSqlCompletion: true, independentTaggedTransactionRetainedOwnership: true,
        exclusiveTakeoverRefusedUntilSqlQuiet: true, failedNativeTerminalCompletion: completed,
        faultPrivateEvidenceRetained: faultDirectory, faultDatabaseName });
      const bootstrapped = invokeCli('bootstrap-migrate-baseline'); assert.equal(bootstrapped.status, 0);
      assert.deepEqual(await ledger(), baseline); await absent(pending[0]); await absent(pending[1]);
      const adopted = invokeCli('bootstrap-adopt'); assert.equal(adopted.status, 0);
      assert.equal((await observer.query('SELECT phase FROM deployment_operations WHERE id=$1', [owner.deploymentId])).rows[0].phase, 'MUTATION_STARTED');
      observations.push({ actualProtectedBootstrapPrefix: 425, actualControlAdoptsBeforeOwnedBridge: true });
      const artifact = operation => {
        verify(); execFileSync('docker', ['exec', slot.Id, 'node', '-e',
          `const fs=require('fs'),path=require('path'),root=process.argv[1],action=process.argv[2];
          const directory=path.join(root,'prisma/migrations/29990101000000_unreviewed_probe');
          if(action==='add'){fs.mkdirSync(directory,{mode:0o700});fs.writeFileSync(path.join(directory,'migration.sql'),'CREATE TABLE unknown_probe (id text);',{flag:'wx',mode:0o400});}
          else if(action==='remove'){fs.unlinkSync(path.join(directory,'migration.sql'));fs.rmdirSync(directory);}
          else throw Error('UNKNOWN_FIXTURE_ARTIFACT_OPERATION');`, privateDirectory, operation]);
      };
      artifact('add');
      try {
        const unsupported = invokeCli(); assert.equal(unsupported.status, 1);
        assert.equal(unsupported.messages.at(-1).code, 'PROTECTED_BRIDGE_MIGRATION_UNSUPPORTED');
        await absent(pending[0]); await absent(pending[1]); assert.deepEqual(await ledger(), baseline);
      } finally { artifact('remove'); }
      const initialStatus = spawnSync(process.execPath, [prisma, 'migrate', 'status', '--schema', path.join(root, 'backend/prisma/schema.prisma')],
        { cwd: path.join(root, 'backend'), env: environment, encoding: 'utf8' });
      assert.equal(initialStatus.error, undefined); assert.equal(initialStatus.signal, null); assert.equal(initialStatus.status, 1);
      for (const row of pending) assert.ok((initialStatus.stdout + initialStatus.stderr).includes(row.name));
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
        if (index === 0) {
          const applied = invoke({ index }); assert.equal(applied.ok, true); assert.equal(applied.value.applied, true);
        } else {
          const applied = invokeCli(); assert.equal(applied.status, 0);
          assert.ok(applied.messages.some(value => value.migration === row.name && value.applied === true));
          assert.equal(applied.messages.at(-1).pendingCount, 1);
        }
        const again = invoke({ index }); assert.equal(again.ok, true); assert.equal(again.value.applied, false);
        const receipt = (await observer.query('SELECT logs FROM _prisma_migrations WHERE migration_name=$1', [row.name])).rows[0].logs;
        assert.match(JSON.parse(receipt).catalogSha256, /^[a-f0-9]{64}$/);
        if (index === 0) {
          await observer.query('ALTER TABLE public.driver_vehicle_assignment_plans ALTER COLUMN "blockedReason" TYPE varchar(128)');
          fails({ index }, 'PROTECTED_BRIDGE_SCHEMA_DRIFT');
          await observer.query('ALTER TABLE public.driver_vehicle_assignment_plans ALTER COLUMN "blockedReason" TYPE text');
          assert.equal(invoke({ index }).value.applied, false);
          // FK enforcement lives on both the referencing and referenced
          // tables. Constraint text alone cannot detect a disabled RI trigger.
          for (const table of ['driver_vehicle_assignment_plans', 'internal_driver_profiles']) {
            const [trigger] = (await observer.query(`SELECT t.tgname AS name,t.tgenabled AS enabled
              FROM pg_trigger t JOIN pg_constraint k ON k.oid=t.tgconstraint
              WHERE k.conrelid='public.driver_vehicle_assignment_plans'::regclass AND k.contype='f'
                AND t.tgrelid=$1::regclass ORDER BY t.tgname LIMIT 1`, ['public.' + table])).rows;
            assert.ok(trigger); assert.equal(trigger.enabled, 'O');
            const quoted = value => '"' + value.replaceAll('"', '""') + '"';
            await observer.query(`ALTER TABLE public.${quoted(table)} DISABLE TRIGGER ${quoted(trigger.name)}`);
            try {
              fails({ index }, 'PROTECTED_BRIDGE_SCHEMA_DRIFT');
              const refused = invokeCli(); assert.equal(refused.status, 1);
              assert.equal(refused.messages.at(-1).code, 'PROTECTED_BRIDGE_SCHEMA_DRIFT');
              await absent(pending[1]);
            }
            finally { await observer.query(`ALTER TABLE public.${quoted(table)} ENABLE TRIGGER ${quoted(trigger.name)}`); }
            assert.equal(invoke({ index }).value.applied, false);
          }
        }
      }
      const namespaces = await observer.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=$1 AND application_name=$2', [databaseName, 'sabalan-bridge-' + operation]);
      assert.equal(namespaces.rows[0].count, 0);
      observations.push({ compiledSourceSha256: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, digest(bytes)])),
        privateEvidenceRetained: privateDirectory, nativeControlLockRequired: true, postDdlLeaseLossRolledBack: true,
        checkpointLeaseRejections: true, catalogDriftRejected: true, completedWorkerSessions: 0 });
      const final = await ledger();
      assert.deepEqual(final, [...baseline, ...pending.map(row => ({ name: row.name, checksum: row.sha256 }))]);
      const noop = invokeCli(); assert.equal(noop.status, 0); assert.equal(noop.messages.at(-1).pendingCount, 0);
      // Deliberate fault injection is confined to this disposable fixture DB.
      // Preserve and restore the exact receipt bytes; production history is
      // never repaired or adopted by the migration command.
      const originalReceipt = (await observer.query('SELECT logs FROM _prisma_migrations WHERE migration_name=$1', [pending[0].name])).rows[0].logs;
      for (const [logs, code] of [[null, 'PROTECTED_BRIDGE_HISTORY_REQUIRES_INSPECTION'],
        ['{invalid', 'PROTECTED_BRIDGE_HISTORY_REQUIRES_INSPECTION'],
        ['{}', 'PROTECTED_BRIDGE_SCHEMA_DRIFT']]) {
        await observer.query('UPDATE _prisma_migrations SET logs=$2 WHERE migration_name=$1', [pending[0].name, logs]);
        try {
          const refused = invokeCli(); assert.equal(refused.status, 1); assert.equal(refused.messages.at(-1).code, code);
        } finally { await observer.query('UPDATE _prisma_migrations SET logs=$2 WHERE migration_name=$1', [pending[0].name, originalReceipt]); }
      }
      await observer.query('ALTER TABLE public.driver_vehicle_assignment_plans ALTER COLUMN "blockedReason" TYPE varchar(128)');
      try {
        const refused = invokeCli(); assert.equal(refused.status, 1); assert.equal(refused.messages.at(-1).code, 'PROTECTED_BRIDGE_SCHEMA_DRIFT');
      } finally { await observer.query('ALTER TABLE public.driver_vehicle_assignment_plans ALTER COLUMN "blockedReason" TYPE text'); }
      const validatedNoop = invokeCli(); assert.equal(validatedNoop.status, 0); assert.equal(validatedNoop.messages.at(-1).pendingCount, 0);
      await observer.query("UPDATE deployment_operations SET phase='GATES_PASSED' WHERE id=$1", [owner.deploymentId]);
      try {
        const unownedNoop = invokeCli(); assert.equal(unownedNoop.status, 1);
        assert.equal(unownedNoop.messages.at(-1).code, 'PROTECTED_BRIDGE_CHECKPOINT_LEASE_UNPROVEN');
      } finally { await observer.query("UPDATE deployment_operations SET phase='MUTATION_STARTED' WHERE id=$1", [owner.deploymentId]); }
      const finalStatus = spawnSync(process.execPath, [prisma, 'migrate', 'status', '--schema', path.join(root, 'backend/prisma/schema.prisma')],
        { cwd: path.join(root, 'backend'), env: environment, encoding: 'utf8' });
      assert.equal(finalStatus.error, undefined); assert.equal(finalStatus.signal, null); assert.equal(finalStatus.status, 0);
      observations.push({ actualDeploymentCliAppliesAndNoops: true, unsupportedLaterMigrationRejectedBeforeAnyDdl: true,
        appliedBridgeDriftPreventsLaterDdl: true, zeroPendingCatalogDriftRejected: true,
        zeroPendingMissingMalformedAndInvalidReceiptsRejected: true,
        nativeConfigurationStatusRejectsPending: true, nativeConfigurationStatusAcceptsComplete: true });
      const noWork = await child([prisma, 'migrate', 'deploy', '--schema', path.join(root, 'backend/prisma/schema.prisma')], { cwd: path.join(root, 'backend'), env: environment });
      assert.match(noWork, /No pending migrations to apply/);
      const hr = await child([path.join(root, 'backend/node_modules/tsx/dist/cli.mjs'), '--test', 'src/services/__tests__/hrVehicleOperations.integration.test.ts'], { cwd: path.join(root, 'backend'), env: environment });
      assert.match(hr, /# fail 0/); assert.match(hr, /# pass 9/);
      observations.push({ nativePrismaRecognizesBoth: true, atomicHistoryAndIdempotentRetry: true, hrVehicleOperations: { passed: 9, failed: 0 } });
      // Restore into a second isolated DATABASE on the SAME existing service.
      // Native pg_dump/psql must recreate RI names; there is no second daemon.
      const triggerNames = client => client.query(`SELECT t.tgname AS name FROM pg_trigger t JOIN pg_constraint k ON k.oid=t.tgconstraint
        WHERE k.conrelid='public.driver_vehicle_assignment_plans'::regclass AND k.contype='f' ORDER BY t.tgname`);
      const originalNames = (await triggerNames(observer)).rows;
      await administrator.query(`CREATE DATABASE "${restoredDatabaseName}"`); restoredCreated = true;
      verify();
      execFileSync('docker', ['exec', before[3].id, 'sh', '-c',
        'set -eu; set -o pipefail; pg_dump --no-owner --no-privileges --username "$POSTGRES_USER" --dbname "$1" | psql -X -q -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$2"',
        'private-bridge-logical-restore', databaseName, restoredDatabaseName], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
      const restoreUrl = new URL(databaseUrl); restoreUrl.pathname = '/' + restoredDatabaseName;
      restoredObserver = new Client({ connectionString: restoreUrl.toString() }); await restoredObserver.connect();
      const restoredNames = (await triggerNames(restoredObserver)).rows;
      assert.equal(restoredNames.length, originalNames.length); assert.notDeepEqual(restoredNames, originalNames);
      verify();
      execFileSync('docker', ['exec', slot.Id, 'node', '-e',
        "const fs=require('fs'),path=require('path'),root=process.argv[1],name=process.argv[2];const value=JSON.parse(fs.readFileSync(path.join(root,'configuration.json'),'utf8'));value.databaseName=name;fs.writeFileSync(path.join(root,'configuration-restored.json'),JSON.stringify(value),{flag:'wx',mode:0o400});",
        privateDirectory, restoredDatabaseName]);
      for (const index of [0, 1]) {
        const replay = invoke({ index }, 'configuration-restored.json'); assert.equal(replay.ok, true); assert.equal(replay.value.applied, false);
      }
      assert.deepEqual((await restoredObserver.query('SELECT migration_name AS name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name')).rows, final);
      assert.equal((await restoredObserver.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=$1 AND application_name=$2',
        [restoredDatabaseName, 'sabalan-bridge-' + restoredDatabaseName.slice(-16)])).rows[0].count, 0);
      observations.push({ nativeLogicalRestoreValidated: true, internalTriggerNamesActuallyChanged: true,
        restoredOwnedReceiptsValidatedWithoutReapplying: 2, restoredDatabaseName });
      assert.deepEqual(identities(), before); successful = true;
    } finally {
      await Promise.allSettled([observer.end(), migrator.end(), blocker.end(), restoredObserver?.end(),
        faultHeld?.end(), faultObserver?.end(), faultBlocker?.end()]);
      try {
        // Failed fixtures retain their database for inspection. No forced drop,
        // SQL termination or synthetic ledger repair can convert failure to PASS.
        if (created && successful) { verify(); await administrator.query(`DROP DATABASE "${databaseName}"`); }
        if (restoredCreated && successful) { verify(); await administrator.query(`DROP DATABASE "${restoredDatabaseName}"`); }
        if (faultCreated && successful) { verify(); await administrator.query(`DROP DATABASE "${faultDatabaseName}"`); }
      } finally { await administrator.end(); }
    }
    const report = { ownedProtectedBridgePassed: true, baselineAppliedCount: 425, databaseName, temporaryDatabaseDroppedWithoutForce: true,
      pending: pending.map(({ name, sha256 }) => ({ name, sha256 })), observations, canonicalBeforeAndAfter: before,
      fixtureSha256: digest(fs.readFileSync(import.meta.filename)), limits: ['empty actual schema, not production data', 'synthetic private lease/checkpoint metadata, not a production verified checkpoint', 'no full financial/old-runtime compatibility proof'] };
    const reportPath = path.join(root, 'reports/qa/protected-bridge-' + new Date().toISOString().slice(0, 10).replaceAll('-', '') + '-' + operation + '.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ reportPath }));
  });
