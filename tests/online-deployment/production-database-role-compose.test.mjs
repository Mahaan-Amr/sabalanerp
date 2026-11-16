import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertProductionDatabaseRoleConfiguration } from '../../scripts/production-database-role-boundary.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runtimeUrl = 'postgresql://runtime_user:runtime-private@postgres:5432/sabalanerp?schema=public&connection_limit=10&pool_timeout=10&application_name=sabalanerp-backend';
const controlUrl = 'postgresql://bootstrap_owner:control-private@postgres:5432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10&application_name=sabalanerp-deployment';

function rendered() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-role-compose-'));
  try {
    const envFile = path.join(directory, 'env');
    fs.writeFileSync(envFile, [
      'POSTGRES_DB=sabalanerp', 'POSTGRES_USER=bootstrap_owner', 'POSTGRES_PASSWORD=control-private',
      `BACKEND_DATABASE_URL=${runtimeUrl}`, `DEPLOYMENT_DATABASE_URL=${controlUrl}`,
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
});

test('role configuration rejects a URL-encoded bootstrap login without disclosing credentials', () => {
  const encoded = runtimeUrl.replace('runtime_user', '%62ootstrap_owner');
  assert.throws(() => assertProductionDatabaseRoleConfiguration({ runtimeUrl: encoded, controlUrl, bootstrapUser: 'bootstrap_owner' }), error => {
    assert.match(error.message, /distinct/);
    assert.ok(!error.message.includes('runtime-private'));
    assert.ok(!error.message.includes('control-private'));
    return true;
  });
});

test('role configuration requires distinct bounded logins on one database', () => {
  assert.deepEqual(assertProductionDatabaseRoleConfiguration({ runtimeUrl, controlUrl, bootstrapUser: 'bootstrap_owner' }),
    { runtimeUser: 'runtime_user', controlUser: 'bootstrap_owner' });
  for (const changed of [
    { runtimeUrl: controlUrl },
    { runtimeUrl: runtimeUrl.replace('connection_limit=10&', '') },
    { runtimeUrl: runtimeUrl.replace('/sabalanerp?', '/different?') },
    { controlUrl: controlUrl.replace('pool_timeout=10', 'pool_timeout=') },
  ]) {
    assert.throws(() => assertProductionDatabaseRoleConfiguration({ runtimeUrl, controlUrl, bootstrapUser: 'bootstrap_owner', ...changed }));
  }
});
