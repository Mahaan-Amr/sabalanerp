#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Host owner for one QA-only production-state copy. All arguments are private
// root-owned paths; no secret or rendered Compose configuration is printed.
const root = '/srv/sabalanerp-qa';
const repository = '/opt/sabalanerp';
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const privateFile = (file, mode) => {
  assert.ok(file.startsWith(`${root}/`) && path.posix.normalize(file) === file && fs.realpathSync(file) === file);
  const stat = fs.lstatSync(file);
  assert.ok(stat.isFile() && stat.uid === 0 && stat.nlink === 1 && (stat.mode & 0o777) === mode);
};

function main() {
  assert.equal(process.platform, 'linux');
  assert.equal(process.getuid(), 0);
  assert.equal(process.cwd(), repository);
  assert.equal(process.argv.length, 10);
  const [qaPlanFile, qaPlanSha256, qaEnvFile, restorePlanFile, restorePlanSha256,
    runEnvFile, applicationKeysFile, overlayFile] = process.argv.slice(2);
  for (const value of [qaPlanSha256, restorePlanSha256]) assert.match(value, /^[a-f0-9]{64}$/);
  privateFile(qaPlanFile, 0o400);
  privateFile(qaEnvFile, 0o400);
  privateFile(restorePlanFile, 0o400);
  privateFile(runEnvFile, 0o600);
  privateFile(applicationKeysFile, 0o400);
  privateFile(overlayFile, 0o400);
  assert.equal(sha(qaPlanFile), qaPlanSha256);
  assert.equal(sha(restorePlanFile), restorePlanSha256);
  const restorePlan = JSON.parse(fs.readFileSync(restorePlanFile, 'utf8'));
  assert.equal(restorePlan.format, 'sabalan-qa-production-state-restore/v1');
  assert.equal(restorePlan.qaOnly, true);
  assert.equal(restorePlan.qaTargetPlanSha256, qaPlanSha256);
  const runRoot = path.dirname(restorePlanFile);
  assert.match(runRoot, /^\/srv\/sabalanerp-qa\/restore-runs\/[a-zA-Z0-9_-]+$/);
  assert.equal(path.basename(restorePlanFile), 'restore-plan.json');
  assert.equal(path.dirname(runEnvFile), runRoot);
  assert.equal(path.dirname(overlayFile), runRoot);
  privateFile(`${runRoot}/checkpoint.json`, 0o600);
  privateFile(`${root}/source-checkpoint/${restorePlan.checkpointId}.sabrec`, 0o400);
  privateFile(`${root}/source-checkpoint/${restorePlan.checkpointId}.sabrec.json`, 0o400);
  privateFile(`${root}/restore-keys/remote-recovery-private.pem`, 0o400);
  const selector = fileURLToPath(new URL('./qa-rehearsal-target.mjs', import.meta.url));
  const selected = execFileSync(process.execPath, [selector, qaPlanFile, qaPlanSha256, repository, qaEnvFile], {
    cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  assert.equal(selected, 'docker-compose.rehearsal.yml');
  const compose = ['compose', '-p', 'sabalanerp', '--env-file', qaEnvFile, '--env-file', runEnvFile,
    '--env-file', applicationKeysFile, '-f', path.join(repository, selected), '-f', overlayFile];
  const base = JSON.parse(execFileSync('docker', ['compose', '-p', 'sabalanerp', '--env-file', qaEnvFile,
    '-f', path.join(repository, selected), '--profile', 'deployment', 'config', '--format', 'json'], {
    cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const rendered = JSON.parse(execFileSync('docker', [...compose, '--profile', 'deployment', 'config', '--format', 'json'], {
    cwd: repository, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const service = rendered.services?.deployment;
  assert.ok(service);
  const { environment: _baseDeploymentEnvironment, image: _baseDeploymentImage,
    pull_policy: _baseDeploymentPullPolicy, volumes: _baseDeploymentVolumes, ...baseDeploymentStructure } = base.services.deployment;
  const { environment: _deploymentEnvironment, image: _deploymentImage,
    pull_policy: _deploymentPullPolicy, volumes: _deploymentVolumes, ...deploymentStructure } = service;
  assert.deepEqual(deploymentStructure, baseDeploymentStructure);
  assert.deepEqual(Object.keys(rendered.services).sort(), Object.keys(base.services).sort());
  for (const [name, definition] of Object.entries(base.services)) {
    if (name !== 'deployment') {
      const { environment: _baseEnvironment, ...baseStructure } = definition;
      const { environment: _renderedEnvironment, ...renderedStructure } = rendered.services[name];
      assert.deepEqual(renderedStructure, baseStructure);
    }
  }
  assert.deepEqual(rendered.networks, base.networks);
  assert.deepEqual(rendered.volumes, base.volumes);
  assert.equal(service.environment?.NODE_ENV, 'test');
  assert.equal(service.environment?.DEPLOYMENT_DRILL_ISOLATED, 'true');
  assert.equal(service.environment?.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256, qaPlanSha256);
  assert.equal(service.environment?.QA_PRODUCTION_STATE_RESTORE_PLAN_SHA256, restorePlanSha256);
  assert.equal(service.environment?.QA_PRODUCTION_STATE_RESTORE_PLAN_FILE, '/qa-evidence/restore-plan.json');
  assert.equal(service.environment?.DEPLOYMENT_REMOTE_RECOVERY_PRIVATE_KEY_FILE, '/run/secrets/recovery-private.pem');
  assert.equal(service.environment?.INQUIRY_RECOVERY_COORDINATED, 'false');
  assert.equal(service.environment?.DEPLOYMENT_REPORT_DIR, '/qa-evidence/reports');
  assert.equal(service.environment?.RECOVERY_STORAGE_DIR, '/app/storage/recovery');
  assert.equal(service.environment?.RECOVERY_COORDINATION_DIR, '/app/recovery-coordination');
  assert.equal(service.environment?.INQUIRY_RECOVERY_SOURCE_DIR, '/app/recovery-sources/inquiry');
  const database = new URL(service.environment?.DATABASE_URL || '');
  const identityOnly = new URL(service.environment?.PRODUCTION_DATABASE_URL || '');
  assert.equal(database.hostname, 'postgres');
  assert.equal(database.pathname, `/${restorePlan.databaseName}`);
  assert.equal(database.searchParams.get('connection_limit'), '2');
  assert.equal(database.searchParams.get('pool_timeout'), '10');
  assert.ok(identityOnly.hostname.endsWith('.invalid') && !identityOnly.username && !identityOnly.password);
  assert.ok(typeof service.environment?.DEPLOYMENT_DRILL_DATABASE_MARKER === 'string'
    && service.environment.DEPLOYMENT_DRILL_DATABASE_MARKER.length >= 32);
  assert.equal(service.pull_policy, 'never');
  assert.match(service.image, /^sha256:[a-f0-9]{64}$/);
  const baseVolumes = new Map(base.services.deployment.volumes.map(volume => [volume.target, volume]));
  assert.deepEqual(service.volumes.map(volume => volume.target).sort(),
    [...baseVolumes.keys(), '/qa-checkpoint', '/qa-evidence', '/run/secrets/recovery-private.pem'].sort());
  for (const volume of service.volumes) {
    if (baseVolumes.has(volume.target)) assert.deepEqual(volume, baseVolumes.get(volume.target));
  }
  const binds = new Map((service.volumes || []).filter(volume => volume.type === 'bind')
    .map(volume => [volume.target, volume]));
  assert.deepEqual([...binds.keys()].filter(target => ['/qa-checkpoint', '/qa-evidence', '/run/secrets/recovery-private.pem'].includes(target)).sort(),
    ['/qa-checkpoint', '/qa-evidence', '/run/secrets/recovery-private.pem'].sort());
  assert.equal(binds.get('/qa-evidence')?.source, runRoot);
  assert.notEqual(binds.get('/qa-evidence')?.read_only, true);
  assert.equal(binds.get('/qa-checkpoint')?.source, `${root}/source-checkpoint`);
  assert.equal(binds.get('/qa-checkpoint')?.read_only, true);
  assert.equal(binds.get('/run/secrets/recovery-private.pem')?.source, `${root}/restore-keys/remote-recovery-private.pem`);
  assert.equal(binds.get('/run/secrets/recovery-private.pem')?.read_only, true);
  // The plan/selector and rendered graph are checked immediately before the
  // one-off owner; no service creation or restore occurs on selector failure.
  execFileSync('docker', [...compose, 'ps'], { cwd: repository, stdio: ['ignore', 'ignore', 'ignore'] });
  execFileSync('docker', [...compose, '--profile', 'deployment', 'run', '--rm', '--no-deps', 'deployment',
    'sh', 'scripts/with-backend-control-ownership.sh', 'node', 'dist/scripts/qa-production-state-restore.js'],
  { cwd: repository, stdio: 'inherit' });
}

try { main(); } catch { process.stderr.write('QA_PRODUCTION_STATE_RESTORE_REFUSED\n'); process.exitCode = 1; }
