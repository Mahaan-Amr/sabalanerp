import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { validateQaNetworkNamespace, validateQaRenderedConfig, validateQaRenderedMounts, validateQaRuntimeEnvironment, validateQaTargetBinding } from '../../deploy/scripts/qa-rehearsal-target.mjs';

const qaEnvironment = {
  DOMAIN: 'erp.qa.test',
  INQUIRY_DOMAIN: 'inquiry.qa.test',
  PUBLIC_APP_URL: 'https://erp.qa.test',
  FRONTEND_URL: 'https://erp.qa.test',
  NEXT_PUBLIC_API_URL: 'https://erp.qa.test',
  DEPLOYMENT_NGINX_BIND_ADDRESS: '127.0.0.1',
  DEPLOYMENT_BACKUP_HOST: 'qa-backup.test',
  DEPLOYMENT_BACKUP_TARGET: 'qa',
  DEPLOYMENT_BACKUP_USER: 'sabalan-qa-backup',
  DEPLOYMENT_BACKUP_OPERATIONS_USER: 'sabalan-qa-backup-ops',
  DEPLOYMENT_SECRET_DIR: '/srv/sabalanerp-qa/secrets',
  DEPLOYMENT_REMOTE_MOUNT_HOST: '/srv/sabalanerp-qa/remote',
  DEPLOYMENT_REPORT_DIR_HOST: '/srv/sabalanerp-qa/reports',
  DEPLOYMENT_BACKUP_SSH_KEY_FILE: '/srv/sabalanerp-qa/ssh/backup-key',
  DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE: '/srv/sabalanerp-qa/ssh/operations-key',
  DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE: '/srv/sabalanerp-qa/ssh/known-hosts',
  SMS_IR_ENVIRONMENT: 'production',
  SMS_IR_API_URL: 'http://127.0.0.1:9',
  SMS_IR_API_KEY: `qa-disabled-${'0'.repeat(32)}`,
  WEB_PUSH_VAPID_SUBJECT: 'mailto:qa-disabled@erp.qa.test',
  WEB_PUSH_VAPID_PUBLIC_KEY: 'A'.repeat(87),
  WEB_PUSH_VAPID_PRIVATE_KEY: 'B'.repeat(43),
  BIOMETRIC_CONNECTOR_MODE: 'unconfigured',
  BIOMETRIC_WORKSTATIONS_JSON: '{}',
  TAXPAYER_DELIVERY_BROKER_ENDPOINT: '',
  TAXPAYER_BROKER_URL: '',
};

function renderedConfig(overrides = {}) {
  const output = execFileSync('docker', ['compose', '--profile', 'deployment', '-p', 'sabalanerp', '-f', 'docker-compose.rehearsal.yml', 'config', '--format', 'json'], {
    env: { ...process.env, ...qaEnvironment, QA_REHEARSAL_FAIL_BACKEND_COMMIT: '',
      QA_REHEARSAL_FAIL_BACKEND_SOURCE_HASH: '', ...overrides, DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256:'a'.repeat(64) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  return JSON.parse(output);
}

test('real rehearsal Compose graph isolates business services and scopes ingress to Nginx loopback', () => {
  const config = renderedConfig();
  assert.equal(config.services.clamav.extra_hosts, undefined);
  assert.deepEqual(Object.keys(config.networks).sort(), ['app_network', 'clamav_egress', 'qa_ingress']);
  assert.deepEqual(Object.keys(config.services.nginx.networks).sort(), ['app_network', 'qa_ingress']);
  assert.deepEqual(config.networks.qa_ingress.driver_opts,
    { 'com.docker.network.bridge.enable_ip_masquerade': 'false' });
  assert.doesNotThrow(() => validateQaRenderedConfig(config));
});

test('QA backend healthcheck uses real readiness except for the exact sealed candidate identity', async () => {
  const candidate = 'c'.repeat(40), sourceHash = 'd'.repeat(64);
  const armed = renderedConfig({ QA_REHEARSAL_FAIL_BACKEND_COMMIT: candidate,
    QA_REHEARSAL_FAIL_BACKEND_SOURCE_HASH: sourceHash });
  const command = armed.services.backend.healthcheck.test[1];
  assert.ok(command.startsWith('node -e "') && command.endsWith('"'));
  const script = command.slice(9, -1);
  const defaultEnvironment = renderedConfig().services.backend.environment;
  let readinessStatus = 200;
  const server = createServer((request, response) => {
    response.writeHead(request.url === '/api/ready' ? readinessStatus : 404).end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const check = (commit, hash, environment = armed.services.backend.environment) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { stdio: 'ignore', env: {
      ...process.env, ...environment, PORT: String(server.address().port),
      APP_COMMIT: commit, PERFORMANCE_RELEASE_SOURCE_HASH: hash,
    } });
    child.on('error', reject);
    child.on('exit', code => resolve(code));
  });
  try {
    assert.equal(await check(candidate, sourceHash, defaultEnvironment), 0);
    assert.equal(await check('b'.repeat(40), sourceHash), 0);
    assert.equal(await check(candidate, 'e'.repeat(64)), 0);
    assert.equal(await check(candidate, sourceHash), 51);
    readinessStatus = 503;
    assert.equal(await check(candidate, sourceHash, defaultEnvironment), 1);
  } finally { server.close(); }
});

test('QA selector refuses unexpected ingress attachments or internal-only Nginx', () => {
  const config = renderedConfig();
  config.services.backend.networks.qa_ingress = null;
  assert.throws(() => validateQaRenderedConfig(config));
  delete config.services.backend.networks.qa_ingress;
  delete config.services.nginx.networks.qa_ingress;
  assert.throws(() => validateQaRenderedConfig(config));
  config.services.nginx.networks.qa_ingress = null;
  config.networks.qa_ingress.driver_opts['com.docker.network.bridge.enable_ip_masquerade'] = 'true';
  assert.throws(() => validateQaRenderedConfig(config));
});

test('QA selector refuses a ClamAV host-gateway alias reintroduced by an override', () => {
  const config = renderedConfig();
  config.services.clamav.extra_hosts = ['sabalan-clamav-egress=host-gateway'];
  assert.throws(() => validateQaRenderedConfig(config));
});

test('real rehearsal graph binds every deployment recovery volume to the QA project', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-real-mount-test-'));
  try {
    const qaRoot = path.join(root, 'qa');
    const secretDir = path.join(qaRoot, 'secrets');
    const remoteDir = path.join(qaRoot, 'remote');
    const reportDir = path.join(qaRoot, 'reports');
    for (const dir of [qaRoot, secretDir, remoteDir, reportDir]) fs.mkdirSync(dir);
    const trust = path.join(secretDir, 'partner-release-trust-public.der');
    fs.writeFileSync(trust, 'QA-only public trust fixture');
    const config = renderedConfig();
    const sources = {
      '/run/deployment-secrets/partner-release-trust-public.der': trust,
      '/run/deployment-secrets': secretDir,
      '/app/deployment-remote': remoteDir,
      '/app/deployment-reports': reportDir,
    };
    for (const service of Object.values(config.services)) {
      for (const volume of service.volumes ?? []) {
        if (Object.hasOwn(sources, volume.target)) volume.source = sources[volume.target];
      }
    }
    const environment = { ...qaEnvironment, DEPLOYMENT_SECRET_DIR: secretDir,
      DEPLOYMENT_REMOTE_MOUNT_HOST: remoteDir, DEPLOYMENT_REPORT_DIR_HOST: reportDir };
    assert.doesNotThrow(() => validateQaRenderedMounts(config, {
      qaRoot, repositoryRoot: process.cwd(), environment,
    }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('QA target refuses shell variables that would override private Compose values', () => {
  assert.doesNotThrow(() => validateQaRuntimeEnvironment(qaEnvironment, { PATH: '/usr/bin' }));
  assert.throws(() => validateQaRuntimeEnvironment(qaEnvironment, { DOMAIN: 'production.example' }));
  assert.throws(() => validateQaRuntimeEnvironment(qaEnvironment, { COMPOSE_PROJECT_NAME: 'sabalanerp-local' }));
  assert.throws(() => validateQaRuntimeEnvironment(qaEnvironment, { DOCKER_HOST: 'tcp://production.example:2375' }));
  assert.throws(() => validateQaRuntimeEnvironment(qaEnvironment,
    { QA_REHEARSAL_FAIL_BACKEND_COMMIT: 'c'.repeat(40) }));
});

test('QA target refuses interpolation in a protected path even when the inherited variable is otherwise allowed', () => {
  const environment = { ...qaEnvironment, DEPLOYMENT_SECRET_DIR: '/srv/sabalanerp-qa/${QA_ESCAPE}' };
  assert.throws(() => validateQaTargetBinding({
    format: 'sabalan-qa-rehearsal-target/v2', repositoryRoot: '/opt/sabalanerp', qaRoot: '/srv/sabalanerp-qa',
    machineId: 'qa-machine-id', hostname: 'qa-host', engineId: 'qa-engine-id',
    networkNamespace: 'sabalanerp-qa', networkNamespaceIdentity: 'net:[4026533001]',
    applicationCommit: 'c'.repeat(40), applicationTree: 'd'.repeat(40),
    composeSha256: 'a'.repeat(64), environmentSha256: 'b'.repeat(64),
    domain: 'erp.qa.test', inquiryDomain: 'inquiry.qa.test', backupHost: 'qa-backup.test',
    productionBackupHost: 'production-backup.example',
  }, {
    platform: 'linux', uid: 0, repositoryRoot: '/opt/sabalanerp', machineId: 'qa-machine-id',
    hostname: 'qa-host', engineId: 'qa-engine-id', applicationCommit: 'c'.repeat(40),
    applicationTree: 'd'.repeat(40), cleanCheckout: true, dockerRoot: '/var/lib/docker',
    composeSha256: 'a'.repeat(64), environmentSha256: 'b'.repeat(64), environment,
  }));
});

test('QA target refuses an escaped rendered secret bind and symlinked custody source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-mount-test-'));
  try {
    const qaRoot = path.join(root, 'qa');
    const repositoryRoot = path.join(root, 'repository');
    fs.mkdirSync(qaRoot);
    fs.mkdirSync(repositoryRoot);
    const secretDir = path.join(qaRoot, 'secrets');
    const remoteDir = path.join(qaRoot, 'remote');
    const reportDir = path.join(qaRoot, 'reports');
    const outside = path.join(root, 'production-secrets');
    fs.mkdirSync(secretDir);
    fs.mkdirSync(remoteDir);
    fs.mkdirSync(reportDir);
    fs.mkdirSync(outside);
    const trust = path.join(secretDir, 'partner-release-trust-public.der');
    fs.writeFileSync(trust, 'QA-only public trust fixture');
    const sources = {
      '/run/deployment-secrets/partner-release-trust-public.der': trust,
      '/run/deployment-secrets': secretDir,
      '/app/deployment-remote': remoteDir,
      '/app/deployment-reports': reportDir,
    };
    const volumes = renderedConfig().services.deployment.volumes.map(volume =>
      Object.hasOwn(sources, volume.target) ? { ...volume, source: sources[volume.target] } : { ...volume });
    const config = { services: { deployment: { volumes } } };
    const clamav = volumes.find(volume => volume.target === '/app/recovery-sources/clamav');
    const secret = volumes.find(volume => volume.target === '/run/deployment-secrets');
    const env = { ...qaEnvironment, DEPLOYMENT_SECRET_DIR: secretDir,
      DEPLOYMENT_REMOTE_MOUNT_HOST: remoteDir, DEPLOYMENT_REPORT_DIR_HOST: reportDir };
    assert.doesNotThrow(() => validateQaRenderedMounts(config, { qaRoot, repositoryRoot, environment: env }));
    clamav.type = 'bind'; clamav.source = outside;
    assert.throws(() => validateQaRenderedMounts(config, { qaRoot, repositoryRoot, environment: env }));
    clamav.type = 'volume'; clamav.source = 'clamav_database';
    secret.source = outside;
    assert.throws(() => validateQaRenderedMounts(config, { qaRoot, repositoryRoot, environment: env }));
    fs.symlinkSync(outside, path.join(qaRoot, 'linked-secrets'), process.platform === 'win32' ? 'junction' : 'dir');
    env.DEPLOYMENT_SECRET_DIR = path.join(qaRoot, 'linked-secrets');
    secret.source = env.DEPLOYMENT_SECRET_DIR;
    assert.throws(() => validateQaRenderedMounts(config, { qaRoot, repositoryRoot, environment: env }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('QA target refuses a directory in place of the Partner trust public-key file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-trust-mount-test-'));
  try {
    const qaRoot = path.join(root, 'qa');
    const repositoryRoot = path.join(root, 'repository');
    const secretDir = path.join(qaRoot, 'secrets');
    const trust = path.join(secretDir, 'partner-release-trust-public.der');
    fs.mkdirSync(qaRoot);
    fs.mkdirSync(repositoryRoot);
    fs.mkdirSync(secretDir);
    fs.writeFileSync(trust, 'public test fixture');
    const config = { services: { backend: { volumes: renderedConfig().services.backend.volumes.map(volume =>
      volume.target === '/run/deployment-secrets/partner-release-trust-public.der'
        ? { ...volume, source: trust } : volume) } } };
    const env = { ...qaEnvironment, DEPLOYMENT_SECRET_DIR: secretDir };
    assert.doesNotThrow(() => validateQaRenderedMounts(config, { qaRoot, repositoryRoot, environment: env }));
    fs.rmSync(trust);
    fs.mkdirSync(trust);
    assert.throws(() => validateQaRenderedMounts(config, { qaRoot, repositoryRoot, environment: env }));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('QA target rejects another Engine and a live SMS endpoint before controller selection', () => {
  const plan = {
    format: 'sabalan-qa-rehearsal-target/v2',
    repositoryRoot: '/opt/sabalanerp',
    qaRoot: '/srv/sabalanerp-qa',
    machineId: 'qa-machine-id',
    hostname: 'qa-host',
    engineId: 'qa-engine-id',
    networkNamespace: 'sabalanerp-qa',
    networkNamespaceIdentity: 'net:[4026533001]',
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
  assert.throws(() => validateQaTargetBinding(plan, {
    ...observed, environment: { ...qaEnvironment, DEPLOYMENT_BACKUP_SSH_KEY_FILE: '/srv/sabalanerp-qa/secrets/production-key' },
  }));
  const sourceHash = 'e'.repeat(64);
  const fault = { ...qaEnvironment, QA_REHEARSAL_FAIL_BACKEND_COMMIT: plan.applicationCommit,
    QA_REHEARSAL_FAIL_BACKEND_SOURCE_HASH: sourceHash };
  assert.throws(() => validateQaTargetBinding(plan, { ...observed,
    environment: { ...fault, QA_REHEARSAL_FAIL_BACKEND_COMMIT: '' }, performanceSourceHash: sourceHash }));
  assert.throws(() => validateQaTargetBinding(plan, { ...observed,
    environment: { ...fault, QA_REHEARSAL_FAIL_BACKEND_COMMIT: 'f'.repeat(40) }, performanceSourceHash: sourceHash }));
  assert.throws(() => validateQaTargetBinding(plan, { ...observed,
    environment: fault, performanceSourceHash: 'f'.repeat(64) }));
  assert.equal(validateQaTargetBinding(plan, { ...observed, environment: fault,
    performanceSourceHash: sourceHash }), 'docker-compose.rehearsal.yml');
});

test('QA target refuses configured external delivery effects before controller selection', () => {
  const plan = {
    format: 'sabalan-qa-rehearsal-target/v2', repositoryRoot: '/opt/sabalanerp', qaRoot: '/srv/sabalanerp-qa',
    machineId: 'qa-machine-id', hostname: 'qa-host', engineId: 'qa-engine-id',
    networkNamespace: 'sabalanerp-qa', networkNamespaceIdentity: 'net:[4026533001]',
    applicationCommit: 'c'.repeat(40), applicationTree: 'd'.repeat(40),
    composeSha256: 'a'.repeat(64), environmentSha256: 'b'.repeat(64),
    domain: 'erp.qa.test', inquiryDomain: 'inquiry.qa.test', backupHost: 'qa-backup.test',
    productionBackupHost: 'production-backup.example',
  };
  const observed = {
    platform: 'linux', uid: 0, repositoryRoot: '/opt/sabalanerp', machineId: 'qa-machine-id',
    hostname: 'qa-host', engineId: 'qa-engine-id', applicationCommit: 'c'.repeat(40),
    applicationTree: 'd'.repeat(40), cleanCheckout: true, dockerRoot: '/var/lib/docker',
    composeSha256: 'a'.repeat(64), environmentSha256: 'b'.repeat(64), environment: qaEnvironment,
  };
  assert.equal(validateQaTargetBinding(plan, observed), 'docker-compose.rehearsal.yml');
  for (const [name, value] of [
    ['WEB_PUSH_VAPID_SUBJECT', 'mailto:production@example.com'],
    ['WEB_PUSH_VAPID_PRIVATE_KEY', ''],
    ['WEB_PUSH_VAPID_PUBLIC_KEY', ''],
    ['BIOMETRIC_CONNECTOR_MODE', 'physical'],
    ['BIOMETRIC_WORKSTATIONS_JSON', '{"station":"host"}'],
    ['TAXPAYER_DELIVERY_BROKER_ENDPOINT', 'https://broker.example'],
    ['TAXPAYER_BROKER_URL', 'https://broker.example'],
  ]) {
    assert.throws(() => validateQaTargetBinding(plan, {
      ...observed, environment: { ...qaEnvironment, [name]: value },
    }), name);
  }
  const missingDisabledSetting = { ...qaEnvironment };
  delete missingDisabledSetting.WEB_PUSH_VAPID_PRIVATE_KEY;
  assert.throws(() => validateQaTargetBinding(plan, {
    ...observed, environment: missingDisabledSetting,
  }));
  assert.throws(() => validateQaRuntimeEnvironment(missingDisabledSetting, {
    WEB_PUSH_VAPID_PRIVATE_KEY: 'inherited-live-key',
  }));
});

test('QA target requires the controller and native daemon inside the pinned private network namespace', () => {
  const plan = { networkNamespace: 'sabalanerp-qa', networkNamespaceIdentity: 'net:[4026533001]' };
  const observed = {
    networkNamespaceIdentity: 'net:[4026533001]',
    namedNetworkNamespaceIdentity: 'net:[4026533001]',
    daemonNetworkNamespaceIdentity: 'net:[4026533001]',
    initialNetworkNamespaceIdentity: 'net:[4026531833]',
    daemonExecutable: '/usr/bin/dockerd',
    daemonArguments: ['--host=unix:///run/docker.sock', '--data-root=/var/lib/docker',
      '--pidfile=/run/docker.pid', '--bridge=none', '--iptables=true'],
  };
  assert.doesNotThrow(() => validateQaNetworkNamespace(plan, observed));
  assert.throws(() => validateQaNetworkNamespace(plan, {
    ...observed, initialNetworkNamespaceIdentity: observed.networkNamespaceIdentity,
  }));
  assert.throws(() => validateQaNetworkNamespace(plan, {
    ...observed, daemonNetworkNamespaceIdentity: observed.initialNetworkNamespaceIdentity,
  }));
  assert.throws(() => validateQaNetworkNamespace(plan, {
    ...observed, daemonArguments: observed.daemonArguments.filter(arg => arg !== '--iptables=true'),
  }));
  assert.throws(() => validateQaNetworkNamespace(plan, {
    ...observed, namedNetworkNamespaceIdentity: 'net:[4026533002]',
  }));
});
