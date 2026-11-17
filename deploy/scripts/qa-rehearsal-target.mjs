/** Selects the isolated #432 graph only after binding its private plan to this host. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertQaRemoteMountAtRuntime } from './qa-remote-mount-guard.mjs';
import { performanceSourceHash } from '../../scripts/performance-source-identity.mjs';

const COMPOSE_FILE = 'docker-compose.rehearsal.yml';
const SCANNER_FREE_COMPOSE_FILE = 'docker-compose.rehearsal-scanner-free.yml';
const SERVICE_NAMES = ['backend', 'clamav', 'deployment', 'frontend', 'inquiry', 'nginx', 'postgres'];
const sha256 = raw => createHash('sha256').update(raw).digest('hex');
const keys = value => Object.keys(value ?? {}).sort();

export function validateQaNetworkNamespace(plan, observed) {
  assert.equal(plan.networkNamespace, 'sabalanerp-qa');
  assert.match(plan.networkNamespaceIdentity, /^net:\[[1-9][0-9]*\]$/);
  assert.equal(observed.networkNamespaceIdentity, plan.networkNamespaceIdentity);
  assert.equal(observed.namedNetworkNamespaceIdentity, plan.networkNamespaceIdentity);
  assert.equal(observed.daemonNetworkNamespaceIdentity, plan.networkNamespaceIdentity);
  assert.notEqual(observed.initialNetworkNamespaceIdentity, plan.networkNamespaceIdentity);
  assert.equal(observed.daemonExecutable, '/usr/bin/dockerd');
  for (const flag of ['--host=unix:///run/docker.sock', '--data-root=/var/lib/docker',
    '--pidfile=/run/docker.pid', '--bridge=none', '--iptables=true']) {
    assert.ok(observed.daemonArguments.includes(flag));
  }
  assert.equal(observed.daemonArguments.some(arg => arg.startsWith('--iptables=') && arg !== '--iptables=true'), false);
}

function observeQaNetworkNamespace() {
  const daemonPid = fs.readFileSync('/run/docker.pid', 'utf8').trim();
  assert.match(daemonPid, /^[1-9][0-9]*$/);
  const daemonProc = `/proc/${daemonPid}`;
  const daemonArguments = fs.readFileSync(`${daemonProc}/cmdline`, 'utf8').split('\0').filter(Boolean).slice(1);
  const named = fs.statSync('/run/netns/sabalanerp-qa');
  return {
    networkNamespaceIdentity: fs.readlinkSync('/proc/self/ns/net'),
    namedNetworkNamespaceIdentity: `net:[${named.ino}]`,
    daemonNetworkNamespaceIdentity: fs.readlinkSync(`${daemonProc}/ns/net`),
    initialNetworkNamespaceIdentity: fs.readlinkSync('/proc/1/ns/net'),
    daemonExecutable: fs.readlinkSync(`${daemonProc}/exe`), daemonArguments,
  };
}

export function validateQaRenderedConfig(config, planSha256, { scannerRetained = true } = {}) {
  assert.equal(config.name, 'sabalanerp');
  const services = scannerRetained ? SERVICE_NAMES : SERVICE_NAMES.filter(name => name !== 'clamav');
  const networks = scannerRetained ? ['app_network', 'clamav_egress', 'qa_ingress'] : ['app_network', 'qa_ingress'];
  assert.deepEqual(keys(config.services), services);
  assert.deepEqual(keys(config.networks), networks);
  assert.equal(config.networks.app_network.internal, true);
  if (scannerRetained) assert.notEqual(config.networks.clamav_egress.internal, true);
  assert.equal(config.networks.qa_ingress.driver, 'bridge');
  assert.notEqual(config.networks.qa_ingress.internal, true);
  assert.deepEqual(config.networks.qa_ingress.driver_opts,
    { 'com.docker.network.bridge.enable_ip_masquerade': 'false' });
  if (scannerRetained) assert.equal(config.services.clamav.extra_hosts, undefined);
  assert.equal(config.services.deployment.environment.SABALAN_BACKUP_TARGET, 'qa');
  assert.match(config.services.deployment.environment.SABALAN_QA_PLAN_SHA256,/^[a-f0-9]{64}$/);
  if(planSha256)assert.equal(config.services.deployment.environment.SABALAN_QA_PLAN_SHA256,planSha256);
  for (const service of services) {
    assert.deepEqual(keys(config.services[service].networks), service === 'clamav'
      ? ['app_network', 'clamav_egress'] : service === 'nginx'
        ? ['app_network', 'qa_ingress'] : ['app_network']);
    if (service !== 'nginx') assert.equal(config.services[service].ports, undefined);
  }
  assert.deepEqual(config.services.nginx.ports.map(({ target, published, host_ip }) => ({ target, published, host_ip })), [
    { target: 80, published: '80', host_ip: '127.0.0.1' },
    { target: 443, published: '443', host_ip: '127.0.0.1' },
  ]);
}

const BACKEND_MOUNTS = {
    '/app/storage/contracts': 'backend_storage_contracts',
    '/app/storage/hr-hiring': 'backend_storage_hr_hiring',
    '/app/storage/accounting-contracts': 'backend_storage_accounting_contracts',
    '/app/storage/dispatch-documents': 'backend_storage_dispatch_documents',
    '/app/storage/support-tickets': 'backend_storage_support_tickets',
    '/app/storage/performance-exports': 'backend_storage_performance_exports',
    '/app/uploads': 'backend_uploads',
    '/app/storage/recovery': 'backend_recovery',
    '/app/recovery-coordination': 'recovery_coordination',
    '/app/recovery-sources/inquiry': 'inquiry_data',
    '/run/deployment-secrets/partner-release-trust-public.der': 'secret-trust',
};

const QA_MOUNTS = {
  postgres: { '/var/lib/postgresql/data': 'postgres_data' },
  clamav: { '/var/lib/clamav': 'clamav_database' },
  backend: BACKEND_MOUNTS,
  deployment: {
    ...BACKEND_MOUNTS,
    '/app/recovery-sources/clamav': 'clamav_database',
    '/run/deployment-secrets': 'secret-dir',
    '/app/deployment-remote': 'remote-dir',
    '/app/deployment-reports': 'report-dir',
  },
  frontend: {},
  inquiry: { '/data': 'inquiry_data', '/app/recovery-coordination': 'recovery_coordination' },
  nginx: {
    '/etc/nginx/nginx.conf': 'nginx-conf',
    '/etc/nginx/conf.d/app.conf.template': 'nginx-app',
    '/etc/nginx/maintenance-check.conf': 'nginx-check',
    '/usr/share/nginx/html/maintenance.html': 'nginx-maintenance',
    '/app/recovery-coordination': 'recovery_coordination',
    '/var/www/certbot': 'certbot_www',
    '/etc/letsencrypt': 'certbot_conf',
  },
};

export function validateQaRenderedMounts(config, { qaRoot, repositoryRoot, environment, scannerRetained = true }) {
  assert.equal(fs.realpathSync(qaRoot), qaRoot);
  const binds = {
    'secret-trust': path.join(environment.DEPLOYMENT_SECRET_DIR, 'partner-release-trust-public.der'),
    'secret-dir': environment.DEPLOYMENT_SECRET_DIR,
    'remote-dir': environment.DEPLOYMENT_REMOTE_MOUNT_HOST,
    'report-dir': environment.DEPLOYMENT_REPORT_DIR_HOST,
    'nginx-conf': path.join(repositoryRoot, 'deploy/nginx/nginx.conf'),
    'nginx-app': path.join(repositoryRoot, 'deploy/nginx/conf.d/app.conf.template'),
    'nginx-check': path.join(repositoryRoot, 'deploy/nginx/maintenance-check.conf'),
    'nginx-maintenance': path.join(repositoryRoot, 'deploy/nginx/maintenance.html'),
  };
  const expectedMounts = { ...QA_MOUNTS };
  if (!scannerRetained) {
    const { '/app/recovery-sources/clamav': _scanner, ...deployment } = QA_MOUNTS.deployment;
    expectedMounts.deployment = deployment;
    delete expectedMounts.clamav;
  }
  for (const [service, targets] of Object.entries(expectedMounts)) {
    if (!config.services[service]) continue;
    const volumes = config.services[service].volumes ?? [];
    assert.deepEqual(volumes.map(volume => volume.target).sort(), keys(targets));
    for (const volume of volumes) {
      const expected = targets[volume.target];
      if (Object.hasOwn(binds, expected)) {
        assert.equal(volume.type, 'bind');
        assert.equal(volume.source, binds[expected]);
        assert.ok(path.isAbsolute(volume.source));
        assert.equal(fs.realpathSync(volume.source), volume.source);
        const sourceStat = fs.lstatSync(volume.source);
        if (expected === 'secret-trust' || expected.startsWith('nginx-')) {
          assert.equal(sourceStat.isFile(), true);
        } else {
          assert.equal(sourceStat.isDirectory(), true);
        }
        const boundary = expected.startsWith('nginx-') ? repositoryRoot : qaRoot;
        assert.ok(volume.source.startsWith(`${boundary}${path.sep}`));
        if (!['remote-dir', 'report-dir'].includes(expected)) assert.equal(volume.read_only, true);
      } else {
        assert.equal(volume.type, 'volume');
        assert.equal(volume.source, expected);
      }
    }
  }
  if (config.volumes) {
    assert.deepEqual(keys(config.volumes), [...new Set(Object.values(expectedMounts).flatMap(Object.values)
      .filter(name => !Object.hasOwn(binds, name)))].sort());
    for (const [name, definition] of Object.entries(config.volumes)) {
      assert.notEqual(definition.external, true);
      assert.ok(definition.name === undefined || definition.name === `sabalanerp_${name}`);
      assert.equal(definition.driver_opts, undefined);
    }
  }
}

export function validateQaRuntimeEnvironment(environment, inherited) {
  for (const name of ['QA_REHEARSAL_FAIL_BACKEND_COMMIT', 'QA_REHEARSAL_FAIL_BACKEND_SOURCE_HASH']) {
    if (Object.hasOwn(inherited, name)) assert.equal(inherited[name], environment[name] || '');
  }
  for (const name of [
    'WEB_PUSH_VAPID_SUBJECT', 'WEB_PUSH_VAPID_PUBLIC_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY',
    'TAXPAYER_DELIVERY_BROKER_ENDPOINT', 'TAXPAYER_BROKER_URL',
    'BIOMETRIC_CONNECTOR_MODE', 'BIOMETRIC_WORKSTATIONS_JSON',
  ]) assert.ok(Object.hasOwn(environment, name));
  for (const name of keys(inherited)) {
    assert.ok(!name.startsWith('COMPOSE_') && name !== 'DOCKER_HOST' && name !== 'DOCKER_CONTEXT');
    if (Object.hasOwn(environment, name)) assert.equal(inherited[name], environment[name]);
  }
  for (const name of keys(environment)) {
    assert.ok(!name.startsWith('COMPOSE_') && name !== 'DOCKER_HOST' && name !== 'DOCKER_CONTEXT');
  }
}

export function validateQaTargetBinding(plan, observed) {
  assert.deepEqual(keys(plan), [
    'applicationCommit', 'applicationTree', 'backupHost', 'composeSha256', 'domain', 'engineId', 'environmentSha256', 'format',
    'hostname', 'inquiryDomain', 'machineId', 'networkNamespace', 'networkNamespaceIdentity',
    'productionBackupHost', 'qaRoot', 'repositoryRoot',
  ]);
  assert.equal(plan.format, 'sabalan-qa-rehearsal-target/v2');
  assert.equal(observed.platform, 'linux');
  assert.equal(observed.uid, 0);
  assert.equal(plan.repositoryRoot, '/opt/sabalanerp');
  assert.equal(plan.qaRoot, '/srv/sabalanerp-qa');
  assert.equal(observed.repositoryRoot, plan.repositoryRoot);
  for (const name of ['machineId', 'hostname', 'engineId']) {
    assert.ok(typeof plan[name] === 'string' && plan[name].length > 0);
    assert.equal(observed[name], plan[name]);
  }
  assert.equal(observed.dockerRoot, '/var/lib/docker');
  for (const name of ['applicationCommit', 'applicationTree']) {
    assert.match(plan[name], /^[a-f0-9]{40}$/);
    assert.equal(observed[name], plan[name]);
  }
  assert.equal(observed.cleanCheckout, true);
  for (const name of ['composeSha256', 'environmentSha256']) {
    assert.match(plan[name], /^[a-f0-9]{64}$/);
    assert.equal(observed[name], plan[name]);
  }
  assert.match(plan.domain, /^[a-z0-9-]+\.qa\.test$/);
  assert.match(plan.inquiryDomain, /^[a-z0-9-]+\.qa\.test$/);
  assert.notEqual(plan.domain, plan.inquiryDomain);
  assert.match(plan.backupHost, /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
  assert.match(plan.productionBackupHost, /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/);
  assert.notEqual(plan.backupHost, plan.productionBackupHost);
  const env = observed.environment;
  assert.equal(env.DOMAIN, plan.domain);
  assert.equal(env.INQUIRY_DOMAIN, plan.inquiryDomain);
  for (const name of ['PUBLIC_APP_URL', 'FRONTEND_URL', 'NEXT_PUBLIC_API_URL']) {
    assert.equal(env[name], `https://${plan.domain}`);
  }
  assert.equal(env.DEPLOYMENT_NGINX_BIND_ADDRESS, '127.0.0.1');
  assert.equal(env.DEPLOYMENT_BACKUP_HOST, plan.backupHost);
  assert.equal(env.DEPLOYMENT_BACKUP_TARGET, 'qa');
  assert.equal(env.DEPLOYMENT_BACKUP_USER, 'sabalan-qa-backup');
  assert.equal(env.DEPLOYMENT_BACKUP_OPERATIONS_USER, 'sabalan-qa-backup-ops');
  assert.equal(env.DEPLOYMENT_REMOTE_MOUNT_HOST, `${plan.qaRoot}/remote`);
  for (const name of ['DEPLOYMENT_BACKUP_SSH_KEY_FILE', 'DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE', 'DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE']) {
    assert.match(env[name], /^\/srv\/sabalanerp-qa\/ssh\/[a-zA-Z0-9_.-]+$/);
  }
  const privatePaths = [
    'DEPLOYMENT_SECRET_DIR', 'DEPLOYMENT_REMOTE_MOUNT_HOST', 'DEPLOYMENT_REPORT_DIR_HOST',
    'DEPLOYMENT_BACKUP_SSH_KEY_FILE', 'DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE',
    'DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE',
  ].map(name => env[name]);
  for (const privatePath of privatePaths) {
    assert.ok(typeof privatePath === 'string' && privatePath.startsWith(`${plan.qaRoot}/`));
    assert.equal(path.posix.normalize(privatePath), privatePath);
    assert.ok(!privatePath.includes('$'));
  }
  assert.equal(new Set(privatePaths).size, privatePaths.length);
  assert.equal(env.DOCKER_HOST, undefined);
  assert.equal(env.DOCKER_CONTEXT, undefined);
  // The backend still passes the real production-environment validator in QA.
  // Its only SMS endpoint is a deliberately unreachable container loopback port.
  assert.equal(env.SMS_IR_ENVIRONMENT, 'production');
  assert.equal(env.SMS_IR_API_URL, 'http://127.0.0.1:9');
  assert.match(env.SMS_IR_API_KEY, /^qa-disabled-[a-zA-Z0-9]{32,}$/);
  assert.equal(env.WEB_PUSH_VAPID_SUBJECT, `mailto:qa-disabled@${plan.domain}`);
  assert.match(env.WEB_PUSH_VAPID_PUBLIC_KEY, /^[A-Za-z0-9_-]{87}$/);
  assert.match(env.WEB_PUSH_VAPID_PRIVATE_KEY, /^[A-Za-z0-9_-]{43}$/);
  for (const name of ['TAXPAYER_DELIVERY_BROKER_ENDPOINT', 'TAXPAYER_BROKER_URL']) {
    assert.equal(env[name], '');
  }
  assert.equal(env.BIOMETRIC_CONNECTOR_MODE, 'unconfigured');
  assert.equal(env.BIOMETRIC_WORKSTATIONS_JSON, '{}');
  const faultCommit = env.QA_REHEARSAL_FAIL_BACKEND_COMMIT || '';
  const faultSourceHash = env.QA_REHEARSAL_FAIL_BACKEND_SOURCE_HASH || '';
  if (faultCommit || faultSourceHash) {
    assert.match(faultCommit, /^[a-f0-9]{40}$/);
    assert.match(faultSourceHash, /^[a-f0-9]{64}$/);
    assert.equal(faultCommit, plan.applicationCommit);
    assert.equal(faultSourceHash, observed.performanceSourceHash);
  }
  return COMPOSE_FILE;
}

function privateRead(file, expectedSha256, maximum) {
  assert.ok(path.isAbsolute(file) && fs.realpathSync(file) === file);
  const stat = fs.lstatSync(file, { bigint: true });
  assert.ok(stat.isFile() && stat.uid === 0n && stat.nlink === 1n && (stat.mode & 0o777n) === 0o400n);
  assert.ok(stat.size > 0n && stat.size <= BigInt(maximum));
  const raw = fs.readFileSync(file);
  assert.equal(sha256(raw), expectedSha256);
  return raw;
}

function environmentValues(raw) {
  const result = {};
  for (const line of raw.toString('utf8').split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const equal = line.indexOf('=');
    assert.ok(equal > 0);
    const name = line.slice(0, equal);
    assert.match(name, /^[A-Z][A-Z0-9_]*$/);
    assert.equal(Object.hasOwn(result, name), false);
    let value = line.slice(equal + 1);
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    result[name] = value;
  }
  return result;
}

async function main() {
  assert.equal(process.argv.length, 6);
  const [planFile, planSha256, repositoryRoot, environmentFile] = process.argv.slice(2);
  assert.match(planSha256, /^[a-f0-9]{64}$/);
  const plan = JSON.parse(privateRead(planFile, planSha256, 65536));
  const networkNamespace = observeQaNetworkNamespace();
  validateQaNetworkNamespace(plan, networkNamespace);
  const envRaw = privateRead(environmentFile, plan.environmentSha256, 1024 * 1024);
  const environment = environmentValues(envRaw);
  validateQaRuntimeEnvironment(environment, process.env);
  const composePath = path.join(repositoryRoot, COMPOSE_FILE);
  const dockerInfo = JSON.parse(execFileSync('docker', ['info', '--format', '{{json .}}'], { encoding: 'utf8' }));
  const observed = {
    platform: process.platform, uid: process.getuid(), repositoryRoot: fs.realpathSync(repositoryRoot),
    machineId: fs.readFileSync('/etc/machine-id', 'utf8').trim(), hostname: os.hostname(),
    engineId: dockerInfo.ID, dockerRoot: dockerInfo.DockerRootDir,
    applicationCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
    applicationTree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: repositoryRoot, encoding: 'utf8' }).trim(),
    cleanCheckout: execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: repositoryRoot, encoding: 'utf8' }).trim() === '',
    composeSha256: sha256(fs.readFileSync(composePath)),
    environmentSha256: sha256(envRaw), environment,
  };
  if (environment.QA_REHEARSAL_FAIL_BACKEND_COMMIT || environment.QA_REHEARSAL_FAIL_BACKEND_SOURCE_HASH) {
    observed.performanceSourceHash = await performanceSourceHash();
  }
  validateQaTargetBinding(plan, observed);
  // Docker resolves bind sources in the daemon's mount namespace. A mounted
  // SSHFS path in this controller alone does not prove remote checkpointing.
  assertQaRemoteMountAtRuntime(environment.DEPLOYMENT_REMOTE_MOUNT_HOST, plan.backupHost);
  assert.equal(fs.realpathSync(plan.qaRoot), plan.qaRoot);
  for (const name of [
    'DEPLOYMENT_SECRET_DIR', 'DEPLOYMENT_REMOTE_MOUNT_HOST', 'DEPLOYMENT_REPORT_DIR_HOST',
    'DEPLOYMENT_BACKUP_SSH_KEY_FILE', 'DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE',
    'DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE',
  ]) {
    assert.equal(fs.realpathSync(environment[name]), environment[name]);
  }
  const render = compose => JSON.parse(execFileSync('docker', ['compose', '--profile', 'deployment', '-p', 'sabalanerp',
    '--env-file', environmentFile, '-f', compose, 'config', '--format', 'json'], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }));
  const rendered = render(composePath);
  validateQaRenderedConfig(rendered, planSha256);
  validateQaRenderedMounts(rendered, { qaRoot: plan.qaRoot, repositoryRoot, environment });
  // The sealed application tree authenticates the second Compose file too.
  const scannerFree = render(path.join(repositoryRoot, SCANNER_FREE_COMPOSE_FILE));
  validateQaRenderedConfig(scannerFree, planSha256, { scannerRetained: false });
  validateQaRenderedMounts(scannerFree, { qaRoot: plan.qaRoot, repositoryRoot, environment, scannerRetained: false });
  process.stdout.write(`${COMPOSE_FILE}\n`);
}

if (typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('QA_REHEARSAL_TARGET_INVALID\n'); process.exitCode = 1; });
}
