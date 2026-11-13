import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { validateQaRenderedConfig, validateQaRuntimeEnvironment, validateQaTargetBinding } from '../../deploy/scripts/qa-rehearsal-target.mjs';

const qaEnvironment = {
  DOMAIN: 'erp.qa.test',
  INQUIRY_DOMAIN: 'inquiry.qa.test',
  PUBLIC_APP_URL: 'https://erp.qa.test',
  FRONTEND_URL: 'https://erp.qa.test',
  NEXT_PUBLIC_API_URL: 'https://erp.qa.test',
  DEPLOYMENT_NGINX_BIND_ADDRESS: '127.0.0.1',
  DEPLOYMENT_BACKUP_HOST: 'qa-backup.test',
  DEPLOYMENT_SECRET_DIR: '/srv/sabalanerp-qa/secrets',
  DEPLOYMENT_REMOTE_MOUNT_HOST: '/srv/sabalanerp-qa/remote',
  DEPLOYMENT_REPORT_DIR_HOST: '/srv/sabalanerp-qa/reports',
  DEPLOYMENT_BACKUP_SSH_KEY_FILE: '/srv/sabalanerp-qa/ssh/backup-key',
  DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE: '/srv/sabalanerp-qa/ssh/operations-key',
  DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE: '/srv/sabalanerp-qa/ssh/known-hosts',
  SMS_IR_ENVIRONMENT: 'production',
  SMS_IR_API_URL: 'http://127.0.0.1:9',
  SMS_IR_API_KEY: `qa-disabled-${'0'.repeat(32)}`,
};

function renderedConfig() {
  const output = execFileSync('docker', ['compose', '--profile', 'deployment', '-p', 'sabalanerp', '-f', 'docker-compose.rehearsal.yml', 'config', '--format', 'json'], {
    env: { ...process.env, ...qaEnvironment },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(output);
}

test('real rehearsal Compose graph isolates business services and allows only ClamAV egress', () => {
  assert.doesNotThrow(() => validateQaRenderedConfig(renderedConfig()));
});

test('QA target refuses shell variables that would override private Compose values', () => {
  assert.doesNotThrow(() => validateQaRuntimeEnvironment(qaEnvironment, { PATH: '/usr/bin' }));
  assert.throws(() => validateQaRuntimeEnvironment(qaEnvironment, { DOMAIN: 'production.example' }));
  assert.throws(() => validateQaRuntimeEnvironment(qaEnvironment, { COMPOSE_PROJECT_NAME: 'sabalanerp-local' }));
  assert.throws(() => validateQaRuntimeEnvironment(qaEnvironment, { DOCKER_HOST: 'tcp://production.example:2375' }));
});

test('QA target rejects another Engine and a live SMS endpoint before controller selection', () => {
  const plan = {
    format: 'sabalan-qa-rehearsal-target/v1',
    repositoryRoot: '/opt/sabalanerp',
    qaRoot: '/srv/sabalanerp-qa',
    machineId: 'qa-machine-id',
    hostname: 'qa-host',
    engineId: 'qa-engine-id',
    applicationCommit: 'c'.repeat(40),
    applicationTree: 'd'.repeat(40),
    composeSha256: 'a'.repeat(64),
    environmentSha256: 'b'.repeat(64),
    domain: 'erp.qa.test',
    inquiryDomain: 'inquiry.qa.test',
    backupHost: 'qa-backup.test',
    productionBackupHost: 'production-backup.example',
  };
  const observed = {
    platform: 'linux', uid: 0, repositoryRoot: '/opt/sabalanerp',
    machineId: 'qa-machine-id', hostname: 'qa-host', engineId: 'qa-engine-id',
    applicationCommit: 'c'.repeat(40), applicationTree: 'd'.repeat(40), cleanCheckout: true,
    dockerRoot: '/var/lib/docker', composeSha256: 'a'.repeat(64),
    environmentSha256: 'b'.repeat(64), environment: qaEnvironment,
  };
  assert.equal(validateQaTargetBinding(plan, observed), 'docker-compose.rehearsal.yml');
  assert.throws(() => validateQaTargetBinding(plan, { ...observed, engineId: 'desktop-engine' }));
  assert.throws(() => validateQaTargetBinding(plan, { ...observed, cleanCheckout: false }));
  assert.throws(() => validateQaTargetBinding(plan, {
    ...observed, environment: { ...qaEnvironment, SMS_IR_API_URL: 'https://api.sms.ir/v1' },
  }));
  assert.throws(() => validateQaTargetBinding(plan, {
    ...observed, environment: { ...qaEnvironment, DEPLOYMENT_REMOTE_MOUNT_HOST: '/srv/production/checkpoints' },
  }));
});
