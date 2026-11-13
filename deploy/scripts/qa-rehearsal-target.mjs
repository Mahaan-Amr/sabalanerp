/** Selects the isolated #432 graph only after binding its private plan to this host. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const COMPOSE_FILE = 'docker-compose.rehearsal.yml';
const SERVICE_NAMES = ['backend', 'clamav', 'deployment', 'frontend', 'inquiry', 'nginx', 'postgres'];
const sha256 = raw => createHash('sha256').update(raw).digest('hex');
const keys = value => Object.keys(value ?? {}).sort();

export function validateQaRenderedConfig(config) {
  assert.equal(config.name, 'sabalanerp');
  assert.deepEqual(keys(config.services), SERVICE_NAMES);
  assert.deepEqual(keys(config.networks), ['app_network', 'clamav_egress']);
  assert.equal(config.networks.app_network.internal, true);
  assert.notEqual(config.networks.clamav_egress.internal, true);
  for (const service of SERVICE_NAMES) {
    assert.deepEqual(keys(config.services[service].networks), service === 'clamav'
      ? ['app_network', 'clamav_egress'] : ['app_network']);
    if (service !== 'nginx') assert.equal(config.services[service].ports, undefined);
  }
  assert.deepEqual(config.services.nginx.ports.map(({ target, published, host_ip }) => ({ target, published, host_ip })), [
    { target: 80, published: '80', host_ip: '127.0.0.1' },
    { target: 443, published: '443', host_ip: '127.0.0.1' },
  ]);
}

export function validateQaRuntimeEnvironment(environment, inherited) {
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
    'hostname', 'inquiryDomain', 'machineId', 'productionBackupHost', 'qaRoot', 'repositoryRoot',
  ]);
  assert.equal(plan.format, 'sabalan-qa-rehearsal-target/v1');
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
  const privatePaths = [
    'DEPLOYMENT_SECRET_DIR', 'DEPLOYMENT_REMOTE_MOUNT_HOST', 'DEPLOYMENT_REPORT_DIR_HOST',
    'DEPLOYMENT_BACKUP_SSH_KEY_FILE', 'DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE',
    'DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE',
  ].map(name => env[name]);
  for (const privatePath of privatePaths) {
    assert.ok(typeof privatePath === 'string' && privatePath.startsWith(`${plan.qaRoot}/`));
    assert.equal(path.posix.normalize(privatePath), privatePath);
  }
  assert.equal(new Set(privatePaths).size, privatePaths.length);
  assert.equal(env.DOCKER_HOST, undefined);
  assert.equal(env.DOCKER_CONTEXT, undefined);
  // The backend still passes the real production-environment validator in QA.
  // Its only SMS endpoint is a deliberately unreachable container loopback port.
  assert.equal(env.SMS_IR_ENVIRONMENT, 'production');
  assert.equal(env.SMS_IR_API_URL, 'http://127.0.0.1:9');
  assert.match(env.SMS_IR_API_KEY, /^qa-disabled-[a-zA-Z0-9]{32,}$/);
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

function main() {
  assert.equal(process.argv.length, 6);
  const [planFile, planSha256, repositoryRoot, environmentFile] = process.argv.slice(2);
  assert.match(planSha256, /^[a-f0-9]{64}$/);
  const plan = JSON.parse(privateRead(planFile, planSha256, 65536));
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
  validateQaTargetBinding(plan, observed);
  const rendered = JSON.parse(execFileSync('docker', ['compose', '--profile', 'deployment', '-p', 'sabalanerp',
    '--env-file', environmentFile, '-f', composePath, 'config', '--format', 'json'], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }));
  validateQaRenderedConfig(rendered);
  process.stdout.write(`${COMPOSE_FILE}\n`);
}

if (typeof process !== 'undefined' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch { process.stderr.write('QA_REHEARSAL_TARGET_INVALID\n'); process.exitCode = 1; }
}
