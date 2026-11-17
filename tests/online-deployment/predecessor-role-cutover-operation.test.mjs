import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as scannerPolicy from '../../deploy/scripts/preserved-clamav.mjs';
import { pendingRoleCutover, verifySameImageCutoverPlan } from '../../deploy/scripts/predecessor-role-cutover-operation.mjs';

test('ordinary recovery stops on a dedicated session or a surviving role-cutover hold', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'role-operation-'));
  try {
    const state = path.join(root, '.deploy-state');
    const reports = path.join(root, 'reports');
    fs.mkdirSync(state, { mode: 0o700 });
    fs.mkdirSync(reports, { mode: 0o700 });
    const session = path.join(reports, 'active-deployment-session.json');
    assert.equal(pendingRoleCutover(root, session), false);
    fs.writeFileSync(session, JSON.stringify({ purpose: 'predecessor-role-cutover' }), { mode: 0o600 });
    assert.equal(pendingRoleCutover(root, session), true);
    fs.writeFileSync(session, JSON.stringify({ purpose: 'ordinary' }), { mode: 0o600 });
    assert.equal(pendingRoleCutover(root, session), false);
    const hold = path.join(state, 'predecessor-role-cutover-active.json');
    fs.writeFileSync(hold, 'interrupted');
    fs.unlinkSync(session);
    assert.equal(pendingRoleCutover(root, session), true);
    fs.unlinkSync(hold);
    fs.writeFileSync(path.join(reports, 'predecessor-role-cutover-open-intent.json'), 'opening may have happened');
    assert.equal(pendingRoleCutover(root, session), true);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const services = ['backend', 'frontend', 'inquiry', 'nginx', 'postgres', 'clamav'];
const imageIds = Object.fromEntries(services.map((name, index) => [name, 'sha256:' + String(index + 1).repeat(64)]));
const containerIds = Object.fromEntries(services.map((name, index) => [name, String(index + 1).repeat(64)]));
const commit = 'a'.repeat(40);
const sourceHash = 'b'.repeat(64);
const databaseUrl = 'postgresql://bootstrap:fixture-value@postgres:5432/sabalan?schema=public&connection_limit=10&pool_timeout=10';
const browserBuildId = 'erp_protected_fixture';
const bytes = { environment: Buffer.from('exact env'), compose: Buffer.from('exact compose') };

function fixture() {
  const rows = services.map(service => ({
    Id: containerIds[service], Image: imageIds[service],
    State: { Running: true, Restarting: false, Dead: false, Health: { Status: 'healthy' },
      Pid: 999, StartedAt: '2026-11-17T00:00:00Z' },
    Config: { Labels: {
      'com.docker.compose.project': 'sabalanerp', 'com.docker.compose.service': service,
      'io.sabalan.performance.source-commit': commit, 'io.sabalan.performance.source-hash': sourceHash,
      ...(service === 'frontend' ? { 'io.sabalan.browser.build-id': browserBuildId } : {}),
    },
    Env: service === 'backend' ? [`DATABASE_URL=${databaseUrl}`, `APP_COMMIT=${commit}`,
      `PERFORMANCE_RELEASE_COMMIT=${commit}`, `PERFORMANCE_RELEASE_SOURCE_HASH=${sourceHash}`,
      ...['SCHEMA_HASH', 'POLICY_HASH', 'INFRASTRUCTURE_HASH'].map(name => `PERFORMANCE_RELEASE_${name}=${sourceHash}`),
      `PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH=${sourceHash}`,
      ...services.slice(0, 3).map(name => `PERFORMANCE_RELEASE_${name.toUpperCase()}_IMAGE=${imageIds[name]}`),
    ] : [] },
    HostConfig: {}, Mounts: [], NetworkSettings: { Networks: {} },
  }));
  const pg = { POSTGRES_USER: 'bootstrap', POSTGRES_PASSWORD: 'fixture-value', POSTGRES_DB: 'sabalan' };
  const config = { name: 'sabalanerp', services: {
    ...Object.fromEntries(services.map(service => [service, { image: imageIds[service] }])),
    backend: { image: imageIds.backend, environment: { DATABASE_URL: databaseUrl } },
    deployment: { image: imageIds.backend, environment: { DATABASE_URL: databaseUrl, DEPLOYMENT_CHECKPOINT_RUNTIME_USER: 'bootstrap' } },
    postgres: { image: imageIds.postgres, environment: pg },
  } };
  const clamav = rows.at(-1);
  const { canonical, selectionBinding } = scannerPolicy;
  const selection = {
    format: 'sabalan-preserved-clamav/v1', containerId: clamav.Id, image: clamav.Image,
    startedAt: clamav.State.StartedAt, hostPid: clamav.State.Pid,
    stableConfigurationSha256: sha(canonical({ Config: clamav.Config, HostConfig: clamav.HostConfig,
      Mounts: clamav.Mounts, Networks: clamav.NetworkSettings.Networks })),
    initialIdentitySha256: 'c'.repeat(64), initialHealthSha256: 'd'.repeat(64),
  };
  const plan = {
    format: 'sabalan-predecessor-role-cutover-plan/v1', sourceCommit: commit, sourceHash, browserBuildId,
    environmentSha256: sha(bytes.environment), composeSha256: sha(bytes.compose),
    images: imageIds, containers: containerIds, preservedClamav: selectionBinding(selection, 'e'.repeat(64)),
  };
  return { plan, rows, config, bytes };
}

test('qualifies the reviewed unchanged graph and exact legacy runtime URL without exposing credentials', () => {
  const input = fixture();
  const receipt = verifySameImageCutoverPlan(input);
  assert.deepEqual(receipt, {
    format: 'sabalan-predecessor-role-cutover-preflight/v1', sourceCommit: commit, sourceHash, browserBuildId,
    images: imageIds, containers: containerIds, preservedClamavSelectionSha256: input.plan.preservedClamav.selectionSha256,
    databaseTopology: 'legacy', canMutate: false, canOpenTraffic: false,
  });
  assert.ok(!JSON.stringify(receipt).includes('fixture-value'));

  input.rows[0].Config.Env[0] = input.rows[0].Config.Env[0].replace('fixture-value', 'stale-password');
  assert.throws(() => verifySameImageCutoverPlan(input));

  const wrongScanner = fixture();
  wrongScanner.rows.at(-1).State.Pid += 1;
  assert.throws(() => verifySameImageCutoverPlan(wrongScanner));

  const wrongBind = fixture();
  wrongBind.bytes = { ...bytes, environment: Buffer.from('modified env') };
  assert.throws(() => verifySameImageCutoverPlan(wrongBind));

  const wrongBrowser = fixture();
  wrongBrowser.rows[1].Config.Labels['io.sabalan.browser.build-id'] = 'erp_different';
  assert.throws(() => verifySameImageCutoverPlan(wrongBrowser));
});
test('canonical launcher holds FD9 and performs only pinned read-only observations', {
  skip: process.platform !== 'linux' || process.getuid() !== 0,
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'role-launcher-'));
  try {
    const { plan, rows, config } = fixture();
    for (const name of ['secrets', 'remote', 'reports', 'bin', 'deploy/nginx']) {
      fs.mkdirSync(path.join(root, name), { mode: 0o700, recursive: true });
    }
    const git = spawnSync('git', ['init', '--quiet', root], { encoding: 'utf8' });
    assert.equal(git.status, 0, git.stderr);
    fs.writeFileSync(path.join(root, 'secrets/local-rollback-key'), 'x'.repeat(32));
    fs.writeFileSync(path.join(root, 'secrets/remote-recovery-public.pem'), 'BEGIN PUBLIC KEY');
    const nginx = path.join(root, 'deploy/nginx/maintenance.html');
    fs.writeFileSync(nginx, 'fixture', { mode: 0o600 });
    const environment = path.join(root, 'env');
    const envText = ['DEPLOYMENT_SECRET_DIR=' + path.join(root, 'secrets'),
      'DEPLOYMENT_REMOTE_MOUNT_HOST=' + path.join(root, 'remote'),
      'DEPLOYMENT_REPORT_DIR_HOST=' + path.join(root, 'reports'),
      'DEPLOYMENT_OWNER=fixture', ''].join('\n');
    fs.writeFileSync(environment, envText, { mode: 0o600 });
    plan.environmentSha256 = sha(envText);
    const compose = 'name: sabalanerp\n';
    fs.writeFileSync(path.join(root, 'docker-compose.prod.yml'), compose);
    plan.composeSha256 = sha(compose);
    const planFile = path.join(root, 'plan.json');
    fs.writeFileSync(planFile, JSON.stringify(plan), { mode: 0o600 });
    const planSha = sha(fs.readFileSync(planFile));
    const observationFile = path.join(root, 'observations.json');
    fs.writeFileSync(observationFile, JSON.stringify({ rows, config, ids: Object.values(containerIds) }));
    const log = path.join(root, 'docker.log');
    fs.writeFileSync(path.join(root, 'bin/docker'), [
      '#!/usr/bin/env node',
      "const fs = require('node:fs');",
      'const args = process.argv.slice(2);',
      'const data = JSON.parse(fs.readFileSync(process.env.ROLE_FIXTURE_OBSERVATIONS));',
      "const output = args.includes('ps') ? data.ids.join('\\n') : args.includes('inspect') ? JSON.stringify(data.rows) : args.includes('config') ? JSON.stringify(data.config) : null;",
      "fs.appendFileSync(process.env.ROLE_FIXTURE_DOCKER_LOG, JSON.stringify(args) + '\\n');",
      'if (output === null) process.exit(99);',
      'process.stdout.write(output);',
    ].join('\n'), { mode: 0o700 });
    const runner = new URL('../../deploy/scripts/deploy.sh', import.meta.url);
    const run = (...args) => spawnSync('sh', [runner.pathname, ...args], {
      encoding: 'utf8', cwd: root,
      env: { ...process.env, PATH: path.join(root, 'bin') + ':' + process.env.PATH, DEPLOYMENT_REPO_ROOT: root,
        ROLE_FIXTURE_OBSERVATIONS: observationFile, ROLE_FIXTURE_DOCKER_LOG: log, DEPLOYMENT_MODE: 'release' },
    });
    const readOnly = run('--predecessor-role-cutover-preflight', environment, planFile, planSha);
    assert.equal(readOnly.status, 0, readOnly.stderr);
    assert.equal(JSON.parse(readOnly.stdout).canMutate, false);
    assert.equal(JSON.parse(readOnly.stdout).canOpenTraffic, false);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, 4);
    assert.equal(calls.every(args => args.includes('ps') || args.includes('inspect') || args.includes('config')), true);
    assert.equal(fs.statSync(nginx).mode & 0o777, 0o600);

    const mismatch = run('--predecessor-role-cutover-preflight', environment, planFile, '0'.repeat(64));
    assert.notEqual(mismatch.status, 0);
    assert.equal(mismatch.stdout, '');

    fs.writeFileSync(path.join(root, 'reports/predecessor-role-cutover-active.json'), 'interrupted\n', { mode: 0o600 });
    const blocked = run(environment);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /PREDECESSOR_ROLE_CUTOVER_REQUIRES_OWNED_RECOVERY/);
    assert.equal(fs.readFileSync(log, 'utf8').trim().split('\n').length, calls.length);
    assert.equal(fs.statSync(nginx).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { force: true, recursive: true });
  }
});
test('dedicated post-checkpoint routing publishes or rolls back under the same owner and never rolls back after intent', {
  skip: process.platform !== 'linux',
}, () => {
  const script = fs.readFileSync(new URL('../../deploy/scripts/deploy.sh', import.meta.url), 'utf8');
  const start = script.indexOf('role_cutover_failure() {');
  const end = script.indexOf('\nrecover_failure() {', start);
  const roleRecovery = script.slice(start, end);
  const mutation = script.indexOf('phase MUTATION_STARTED\nMUTATION_STARTED=1');
  const ordinary = script.indexOf('if [ "${DEPLOYMENT_CLAMAV_REPAIR}" = true ]; then', mutation);
  const roleContinuation = script.slice(mutation, ordinary);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'role-router-'));
  try {
    fs.mkdirSync(path.join(workspace, 'reports'));
    const fixed = path.join(workspace, 'reports', 'predecessor-role-cutover-open-intent.json');
    const inherited = `set -eu
ROLE_CUTOVER=1
SESSION_PREPARED=1
MAINTENANCE_ACTIVE=1
DB_LEASE_ACQUIRED=1
MUTATION_STARTED=1
LEGACY_BACKEND_SIGNAL_PENDING=0
DEPLOYMENT_PHASE=MUTATION_STARTED
DEPLOYMENT_ID=deploy-fixture
REPO_ROOT="$1"
SESSION_HOST_PATH="$REPO_ROOT/reports/active-deployment-session.json"
role_clock() { printf 'clock-%s-%s-%s\\n' "$1" "$2" "$3"; }
phase() { DEPLOYMENT_PHASE="$1"; printf 'phase-%s\\n' "$1"; }
run_owned_role_foreground() { printf 'foreground-%s\\n' "$DEPLOYMENT_PHASE"; }
verify_public_maintenance() { printf 'maintenance-503\\n'; }
protected_advisory_owned() { printf 'same-advisory\\n'; }
drain_release_for_rollback() { printf 'drain-same-backend\\n'; }
cleanup_locks() { printf 'cleanup-owned-locks\\n'; }
`;
    const run = suffix => spawnSync('/bin/sh', ['-c', inherited + roleRecovery + '\n' + suffix, 'role-fixture', workspace], {
      cwd: workspace, encoding: 'utf8',
    });
    const applied = run(roleContinuation);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /phase-MUTATION_STARTED\nforeground-MUTATION_STARTED\ncleanup-owned-locks/);
    const rolledBack = run('role_cutover_failure');
    assert.equal(rolledBack.status, 0, rolledBack.stderr);
    assert.match(rolledBack.stdout, /maintenance-503\nsame-advisory\nclock-start-rollback-900\ndrain-same-backend\nphase-ROLLBACK_STARTED\nforeground-ROLLBACK_STARTED/);
    fs.writeFileSync(fixed, 'unacknowledged opening');
    const unknown = run('role_cutover_failure');
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stdout, '');
    assert.match(unknown.stderr, /traffic may have opened/);
  } finally {
    fs.rmSync(workspace, { force: true, recursive: true });
  }
});