import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existingRelease, releaseExports } from './deployment-existing-release.mjs';
import { prepareConfiguration, configurationExports, persistConfiguration, cleanupConfiguration, validateWorkstations, markTrafficMayOpen, configurationRecoveryState } from './deployment-biometric-configuration.mjs';
import { releaseEnvironmentKeys } from './performance-deployment-environment.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const key = Buffer.alloc(32, 7).toString('base64');
const workstation = { commandSecretBase64: key, activeTransportKeyId: 'transport-v1', transportKeysBase64: { 'transport-v1': key } };
function containers(coordination) {
  const records = ['backend', 'frontend', 'inquiry', 'nginx', 'postgres', 'clamav'].map((service, index) => ({
    Id: service, Image: `sha256:${String(index + 1).repeat(64)}`,
    Config: { Labels: { 'com.docker.compose.service': service }, Env: [] },
    State: { Running: true, Health: { Status: 'healthy' } },
    Mounts: [],
  }));
  const identity = Object.fromEntries(releaseEnvironmentKeys.map(name => [name, name.endsWith('_COMMIT') ? 'a'.repeat(40) : name.endsWith('_IMAGE') ? records.find(c => name.includes(c.Id.toUpperCase()))?.Image : 'b'.repeat(64)]));
  records[0].Config.Env = [...Object.entries(identity).map(([name, value]) => `${name}=${value}`), 'BIOMETRIC_WORKSTATIONS_JSON={}', 'RECOVERY_COORDINATION_DIR=/app/recovery-coordination', 'JWT_SECRET=secret-do-not-output'];
  records[0].Mounts = [{ Destination: '/app/recovery-coordination', Source: coordination, RW: true }];
  return records;
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-config-release-'));
  const coordination = path.join(root, 'coordination'); fs.mkdirSync(coordination);
  const environment = path.join(root, '.env.prod');
  const original = 'JWT_SECRET=secret-do-not-output\nBIOMETRIC_CONNECTOR_MODE=unconfigured\nBIOMETRIC_WORKSTATIONS_JSON={}\n';
  fs.writeFileSync(environment, original);
  const provisioning = path.join(root, 'provisioning.json'); fs.writeFileSync(provisioning, JSON.stringify({ 'LAPTOP-01': workstation }));
  return { root, coordination, environment, provisioning, original, containers: containers(coordination) };
}
function dispose(f) {
  const pidFile = path.join(f.root, 'fixture-advisory.pid');
  if (fs.existsSync(pidFile)) {
    try { process.kill(Number(fs.readFileSync(pidFile, 'utf8'))); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  fs.rmSync(f.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

test('existing release preserves running code identity and binds all three application images', () => {
  const records = containers('/unused');
  const release = existingRelease(records);
  assert.equal(release.identity.PERFORMANCE_RELEASE_COMMIT, 'a'.repeat(40));
  const exports = releaseExports(release);
  assert.match(exports, /DEPLOYMENT_TARGET_COMMIT='a{40}'/);
  assert.ok(!exports.includes('JWT_SECRET'));
  records[1].Image = `sha256:${'f'.repeat(64)}`;
  assert.throws(() => existingRelease(records), /disagrees/);
});

test('existing release refuses incomplete identity, mutable images and unhealthy supporting services', () => {
  for (const modify of [records => { records[0].Config.Env = []; }, records => { records[1].Image = 'latest'; }, records => { records[5].State.Health.Status = 'unhealthy'; }]) {
    const records = containers('/unused'); modify(records); assert.throws(() => existingRelease(records));
  }
});

test('configuration is checkpoint-owned, changes only workstation registration, and restores exact previous bytes', () => {
  const f = fixture();
  try {
    prepareConfiguration(f.root, f.environment, f.provisioning, 'deploy-test', f.containers[0]);
    assert.equal(fs.readFileSync(f.environment, 'utf8'), f.original, 'preparing configuration must not change production');
    const pointer = JSON.parse(fs.readFileSync(path.join(f.root, '.deploy-state/biometric-configuration.json')));
    assert.ok(pointer.snapshotPath.startsWith(f.coordination + path.sep), 'secrets must be in protected checkpoint coordination storage');
    assert.ok(!JSON.stringify(pointer).includes(key));
    const exports = configurationExports(f.root);
    assert.ok(exports.includes('LAPTOP-01'));
    assert.ok(!exports.includes('JWT_SECRET'));
    assert.throws(() => prepareConfiguration(f.root, f.environment, f.provisioning, 'second-deploy', f.containers[0]), /recovery/);
    persistConfiguration(f.root);
    const candidate = fs.readFileSync(f.environment, 'utf8');
    assert.ok(candidate.includes('BIOMETRIC_CONNECTOR_MODE=unconfigured'));
    assert.equal(candidate.replace(/^BIOMETRIC_WORKSTATIONS_JSON=.*$/m, 'BIOMETRIC_WORKSTATIONS_JSON={}'), f.original);
    persistConfiguration(f.root, true);
    assert.equal(fs.readFileSync(f.environment, 'utf8'), f.original);
    assert.match(configurationExports(f.root, true), /='\{\}'$/);
    cleanupConfiguration(f.root);
    assert.ok(!fs.existsSync(pointer.snapshotPath));
  } finally { dispose(f); }
});

test('recovery fails closed on concurrent environment edits or modified protected snapshot', () => {
  const f = fixture();
  try {
    prepareConfiguration(f.root, f.environment, f.provisioning, 'deploy-test', f.containers[0]);
    fs.appendFileSync(f.environment, 'UNRELATED_CHANGE=true\n');
    assert.throws(() => persistConfiguration(f.root), /concurrently/);
    assert.throws(() => persistConfiguration(f.root, true), /concurrently/);
    const pointer = JSON.parse(fs.readFileSync(path.join(f.root, '.deploy-state/biometric-configuration.json')));
    fs.appendFileSync(pointer.snapshotPath, 'modified');
    assert.throws(() => configurationExports(f.root), /integrity/);
  } finally { dispose(f); }
});

test('interruption recovery binds its session and forbids rollback once traffic may open', () => {
  const f = fixture();
  try {
    prepareConfiguration(f.root, f.environment, f.provisioning, 'deploy-test', f.containers[0]);
    assert.equal(configurationRecoveryState(f.root, 'deploy-test'), false);
    assert.throws(() => configurationRecoveryState(f.root, 'another-session'), /different deployment/);
    markTrafficMayOpen(f.root);
    assert.equal(configurationRecoveryState(f.root, 'deploy-test'), true);
  } finally { dispose(f); }
});

test('provisioning rejects unsupported fields, injection and overwriting an existing workstation', () => {
  assert.throws(() => validateWorkstations({ "bad'identifier": workstation }));
  assert.throws(() => validateWorkstations({ LAPTOP: { ...workstation, allowedOrigin: 'https://evil.example' } }));
  assert.throws(() => validateWorkstations({ LAPTOP: { ...workstation, commandSecretBase64: 'invalid' } }));
  const f = fixture();
  try {
    f.containers[0].Config.Env = f.containers[0].Config.Env.map(v => v.startsWith('BIOMETRIC_WORKSTATIONS_JSON=') ? 'BIOMETRIC_WORKSTATIONS_JSON=' + JSON.stringify({ 'LAPTOP-01': workstation }) : v);
    assert.throws(() => prepareConfiguration(f.root, f.environment, f.provisioning, 'deploy-test', f.containers[0]), /already registered/);
  } finally { dispose(f); }
});

for (const failure of ['preflight', 'checkpoint', 'after-mutation', 'success']) test(`configuration release retains gates and recovers failure at ${failure} without source fetch/build`, () => {
  const f = fixture();
  let originalFailure;
  try {
    fs.mkdirSync(path.join(f.root, '.git'));
    const secrets = path.join(f.root, 'secrets'); fs.mkdirSync(secrets);
    fs.writeFileSync(path.join(secrets, 'local-rollback-key'), 'x'.repeat(32));
    fs.writeFileSync(path.join(secrets, 'remote-recovery-public.pem'), '-----BEGIN PUBLIC KEY-----');
    const remote = path.join(f.root, 'remote'); fs.mkdirSync(remote);
    const reports = path.join(f.root, 'reports'); fs.mkdirSync(reports);
    fs.mkdirSync(path.join(f.root, 'deploy/nginx'), { recursive: true });
    fs.writeFileSync(path.join(f.root, 'deploy/nginx/maintenance.html'), 'fixture');
    fs.mkdirSync(path.join(f.root, 'scripts'));
    fs.copyFileSync(path.join(repository, 'scripts/performance-deployment-environment.mjs'), path.join(f.root, 'scripts/performance-deployment-environment.mjs'));
    fs.writeFileSync(f.environment, f.original + `DEPLOYMENT_SECRET_DIR=${secrets.replaceAll('\\', '/')}\nDEPLOYMENT_REMOTE_MOUNT_HOST=${remote.replaceAll('\\', '/')}\nDEPLOYMENT_REPORT_DIR_HOST=reports\nDEPLOYMENT_OWNER=test\n`);
    const before = fs.readFileSync(f.environment, 'utf8');
    const recordsFile = path.join(f.root, 'containers.json'); fs.writeFileSync(recordsFile, JSON.stringify(f.containers));
    const bin = path.join(f.root, 'bin'); fs.mkdirSync(bin);
    const log = path.join(f.root, 'commands.log');
    const fakeDocker = path.join(f.root, 'fake-docker.cjs');
    fs.writeFileSync(fakeDocker, `const fs=require('fs');const path=require('path');const a=process.argv.slice(2);fs.appendFileSync(process.env.TEST_LOG,JSON.stringify(a)+'\\n');const records=JSON.parse(fs.readFileSync(process.env.TEST_CONTAINERS));const env=k=>(a.find(v=>v.startsWith(k+'='))||'').slice(k.length+1);const session=path.join(process.env.TEST_REPORTS,'active-deployment-session.json');
if(a[0]==='inspect' && a.includes('--format')){console.log(a.includes('{{.Image}}')?records.find(r=>r.Id===a.at(-1)).Image:'10.0.0.2');}
else if(a[0]==='inspect'){console.log(JSON.stringify(records.filter(r=>a.slice(1).includes(r.Id))));}
else if(a.includes('ps')){console.log(a.at(-1));}
else if(a.includes('config')){console.log('services: {}');}
else if(a.includes('dist/scripts/deployment-performance-identity.js')){fs.writeFileSync(require('path').join(process.env.TEST_REPORTS,'performance-database-'+a.find(v=>v.startsWith('DEPLOYMENT_ID=')).slice(14)+'.json'),JSON.stringify({schemaHash:'b'.repeat(64),policyHash:'b'.repeat(64)}));}
else if(a.includes('dist/scripts/validate-production-environment.js')){if(process.env.TEST_FAILURE==='preflight')process.exit(42);}
else if(a.includes('dist/scripts/deployment-control.js')){const c=a[a.indexOf('dist/scripts/deployment-control.js')+1];if(c==='prepare'){fs.writeFileSync(session,JSON.stringify({phase:'PREFLIGHT',leaseToken:'fixture-lease',rollbackPerformanceEnvironment:Object.fromEntries(records[0].Config.Env.filter(v=>v.startsWith('PERFORMANCE_')).map(v=>[v.split('=')[0],v.slice(v.indexOf('=')+1)]))}));}else if(c==='acquire'||c==='transition'){const s=JSON.parse(fs.readFileSync(session));s.phase=c==='acquire'?'LEASE_ACQUIRED':env('DEPLOYMENT_PHASE');fs.writeFileSync(session,JSON.stringify(s));}else if(c==='finish'||c==='cancel-preflight'){fs.rmSync(session,{force:true});}}
else if(a.includes('dist/scripts/deployment-checkpoint.js')){if(process.env.TEST_FAILURE==='checkpoint')process.exit(43);}
else if(a.includes('db:migrate:deploy')){if(process.env.TEST_FAILURE==='after-mutation')process.exit(44);}
else if(a.includes('exec')){const text=a.at(-1);if(text.includes('pg_sleep(21600)')){fs.writeFileSync(path.join(process.env.DEPLOYMENT_REPO_ROOT,'fixture-advisory.pid'),String(process.pid));setInterval(()=>{},1000);}else if(text.includes('pg_locks'))console.log('1');else if(text.includes('pg_stat_activity WHERE client_addr'))console.log('0');else if(text.includes('round(100.0'))console.log('20');else if(text.includes('pg_database_size'))console.log('1000000');else if(text.includes('df -Pk'))console.log('6000000');}
else if(a.includes('up')||a.includes('stop')||a.includes('dist/scripts/dry-run-contract-product-graph-migration.js')||a.includes('dist/scripts/audit-hr-onboarding-task-retirement.js')||a.includes('dist/scripts/migrate-all-contract-product-graphs.js')||a.includes('dist/scripts/reconcile-contract-financial-evidence.js')||a.includes('dist/scripts/deployment-drill-preflight.js')||a.includes('dist/scripts/deployment-notify.js')||a.includes('dist/scripts/deployment-gates.js')||a.includes('dist/scripts/deployment-rollback.js')||a.includes('dist/scripts/deployment-finalize-recovery.js')){}
else{process.exit(99);}`);
    fs.writeFileSync(path.join(bin, 'docker'), `#!/bin/sh\ncase "$*" in *pg_sleep*) exec /usr/bin/sleep 300;; esac\nexec node '${fakeDocker.replaceAll('\\', '/')}' "$@"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'git'), `#!/bin/sh\nprintf '%s\\n' "$*" >> "$TEST_GIT_LOG"\ncase "$1" in diff) exit 0;; rev-parse) printf 'cccccccccccccccccccccccccccccccccccccccc\\n';; *) exit 99;; esac\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'flock'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'curl'), '#!/bin/sh\nprintf 503\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'sleep'), '#!/bin/sh\nexec /usr/bin/sleep 0.02\n', { mode: 0o755 });
    const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/sh';
    const shellBin = bin.replaceAll('\\', '/').replace(/^([A-Za-z]):/, '/$1');
    const result = spawnSync(bash, ['-c', 'export PATH="$TEST_BIN:$PATH"; exec sh "$TEST_SCRIPT" "$TEST_ENV"'], {
      encoding: 'utf8', timeout: 120000,
      env: { ...process.env, TEST_BIN: shellBin, TEST_SCRIPT: path.join(repository, 'deploy/scripts/deploy.sh').replaceAll('\\', '/'), TEST_ENV: f.environment.replaceAll('\\', '/'), DEPLOYMENT_MODE: 'configuration', DEPLOYMENT_REPO_ROOT: f.root.replaceAll('\\', '/'), DEPLOYMENT_BIOMETRIC_PROVISIONING_FILE: f.provisioning.replaceAll('\\', '/'), TEST_LOG: log, TEST_GIT_LOG: path.join(f.root, 'git.log'), TEST_CONTAINERS: recordsFile, TEST_REPORTS: reports, TEST_FAILURE: failure },
    });
    assert.equal(result.status, { preflight: 42, checkpoint: 43, 'after-mutation': 44, success: 0 }[failure], `${result.stdout}\n${result.stderr}`);
    const commands = fs.readFileSync(log, 'utf8');
    assert.ok(!commands.includes('"build"'));
    assert.equal(commands.includes('deployment-checkpoint.js'), failure !== 'preflight');
    assert.equal(commands.includes('db:migrate:deploy'), ['after-mutation', 'success'].includes(failure));
    assert.equal(commands.includes('maintenance-on'), failure !== 'preflight');
    if (failure === 'after-mutation') assert.ok(commands.includes('deployment-rollback.js'));
    assert.ok(!/fetch|pull|checkout/.test(fs.readFileSync(path.join(f.root, 'git.log'), 'utf8')));
    if (failure === 'success') { assert.ok(fs.readFileSync(f.environment, 'utf8').includes('LAPTOP-01')); assert.ok(!commands.includes('deployment-rollback.js')); } else assert.equal(fs.readFileSync(f.environment, 'utf8'), before);
    assert.ok(!fs.existsSync(path.join(f.root, '.deploy-state/biometric-configuration.json')));
    assert.ok(!`${result.stdout}${result.stderr}`.includes(key));
  } catch (error) { originalFailure = error; throw error; }
  finally { try { dispose(f); } catch (error) { if (!originalFailure) throw error; } }
});

test('configuration uses the same lease, checkpoint, migration, rollback and release gates', () => {
  const script = fs.readFileSync(path.join(repository, 'deploy/scripts/deploy.sh'), 'utf8');
  assert.ok(script.indexOf('phase REMOTE_CHECKPOINT_VERIFIED') < script.indexOf('persist "${REPO_ROOT}"\n'));
  for (const step of ['control prepare', 'control acquire', 'verify_public_maintenance', 'deployment-checkpoint.js', 'npm run db:migrate:deploy', 'deployment-gates.js', 'phase GATES_PASSED', 'control maintenance-off']) assert.ok(script.includes(step));
  assert.match(script, /switch_to_previous_images\(\)[\s\S]*persist "\$\{REPO_ROOT\}" previous[\s\S]*DEPLOYMENT_BACKEND_IMAGE=/);
});
