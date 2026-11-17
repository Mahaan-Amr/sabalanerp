import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProductionDatabaseRoleConfiguration } from '../../scripts/production-database-role-boundary.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runtimeUrl = 'postgresql://sabalan_application_runtime:runtime-private@postgres:5432/sabalanerp?schema=public&connection_limit=10&pool_timeout=10&application_name=sabalanerp-backend';
const controlUrl = 'postgresql://bootstrap_owner:control-private@postgres:5432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10&application_name=sabalanerp-deployment';
const allocationControllerUrl = 'postgresql://sabalan_allocation_controller:allocation-private@postgres:5432/sabalanerp?schema=public&connection_limit=1&pool_timeout=10&application_name=sabalanerp-allocation-control';
const roleConfiguration = { runtimeUrl, controlUrl, allocationControllerUrl, bootstrapUser: 'bootstrap_owner' };

function rendered() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-role-compose-'));
  try {
    const envFile = path.join(directory, 'env');
    fs.writeFileSync(envFile, [
      'POSTGRES_DB=sabalanerp', 'POSTGRES_USER=bootstrap_owner', 'POSTGRES_PASSWORD=control-private',
      `BACKEND_DATABASE_URL=${runtimeUrl}`, `DEPLOYMENT_DATABASE_URL=${controlUrl}`,
      `CUSTOMER_ALLOCATION_CONTROLLER_DATABASE_URL=${allocationControllerUrl}`,
    ].join('\n') + '\n');
    const result = spawnSync('docker', ['compose', '--profile', 'deployment', '--env-file', envFile, '-f', path.join(root, 'docker-compose.prod.yml'), '-f', path.join(root, 'docker-compose.database-role-split.yml'), 'config', '--format', 'json'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr.replaceAll('control-private', '[REDACTED]').replaceAll('runtime-private', '[REDACTED]'));
    return JSON.parse(result.stdout);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

test('rendered production services separate application and privileged database credentials', () => {
  const services = rendered().services;
  assert.equal(services.backend.environment.DATABASE_URL, runtimeUrl);
  assert.equal(services.deployment.environment.DATABASE_URL, controlUrl);
  assert.notEqual(new URL(services.backend.environment.DATABASE_URL).username, new URL(services.deployment.environment.DATABASE_URL).username);
  assert.equal(services.postgres.environment.POSTGRES_USER, 'bootstrap_owner');
  assert.equal(services.backend.environment.POSTGRES_USER, undefined);
  assert.equal(services.backend.environment.POSTGRES_PASSWORD, undefined);
  assert.ok(!JSON.stringify(services.backend.environment).includes('control-private'));
  assert.ok(!JSON.stringify(services).includes('allocation-private'));
  const publicKey = services.backend.volumes.filter(mount => mount.target === '/run/deployment-secrets/system-recovery-owner-public.pem');
  assert.equal(publicKey.length, 1);
  assert.equal(publicKey[0].read_only, true);
  assert.equal(services.backend.environment.SYSTEM_RECOVERY_OWNER_PUBLIC_KEY_FILE, publicKey[0].target);
  assert.ok(!JSON.stringify(services.backend).includes('system-recovery-owner-private'));
  assert.ok(!services.backend.volumes.some(mount => mount.target === '/run/deployment-secrets'));
});

test('role configuration rejects a URL-encoded bootstrap login without disclosing credentials', () => {
  const encoded = runtimeUrl.replace('sabalan_application_runtime', '%62ootstrap_owner');
  assert.throws(() => assertProductionDatabaseRoleConfiguration({ ...roleConfiguration, runtimeUrl: encoded }), error => {
    assert.match(error.message, /distinct/);
    assert.ok(!error.message.includes('runtime-private'));
    assert.ok(!error.message.includes('control-private'));
    return true;
  });
});

test('role configuration requires distinct bounded logins on one database', () => {
  assert.deepEqual(assertProductionDatabaseRoleConfiguration(roleConfiguration),
    { runtimeUser: 'sabalan_application_runtime', controlUser: 'bootstrap_owner', allocationControllerUser: 'sabalan_allocation_controller' });
  for (const changed of [
    { runtimeUrl: controlUrl },
    { runtimeUrl: runtimeUrl.replace('connection_limit=10&', '') },
    { runtimeUrl: runtimeUrl.replace('/sabalanerp?', '/different?') },
    { controlUrl: controlUrl.replace('pool_timeout=10', 'pool_timeout=') },
    { allocationControllerUrl: controlUrl },
    { allocationControllerUrl: allocationControllerUrl.replace('@postgres:', '@different:') },
    { allocationControllerUrl: allocationControllerUrl + '&host=other' },
    { runtimeUrl: runtimeUrl + '&schema=other' },
  ]) {
    assert.throws(() => assertProductionDatabaseRoleConfiguration({ ...roleConfiguration, ...changed }));
  }
});
