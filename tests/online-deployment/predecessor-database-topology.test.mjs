import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readPredecessorDatabaseTopology } from '../../deploy/scripts/predecessor-database-topology.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const compose = ['compose', '-f', 'docker-compose.prod.yml', '--profile', 'deployment'];
const env = {
  POSTGRES_DB: 'fixture',
  POSTGRES_USER: 'fixture_owner',
  POSTGRES_PASSWORD: 'owner-fixture',
  BACKEND_DATABASE_USER: 'sabalan_application_runtime',
  BACKEND_DATABASE_PASSWORD: 'runtime-fixture',
  DEPLOYMENT_DATABASE_USER: 'fixture_owner',
  DEPLOYMENT_DATABASE_PASSWORD: 'owner-fixture',
};

function render(overrides = {}) {
  const result = spawnSync('docker', [...compose, 'config', '--format', 'json'], {
    cwd: root,
    env: { ...process.env, ...env, ...overrides },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout);
}

test('predecessor renders restricted backend and privileged control without changing the scanner graph', () => {
  const config = render();
  const { backend, deployment, clamav } = config.services;
  const topology = readPredecessorDatabaseTopology(config, backend.environment.DATABASE_URL);
  assert.deepEqual(topology, { split: true, controlUser: 'fixture_owner' });
  assert.equal(new URL(backend.environment.DATABASE_URL).username, env.BACKEND_DATABASE_USER);
  assert.equal(new URL(deployment.environment.DATABASE_URL).username, env.DEPLOYMENT_DATABASE_USER);
  assert.equal(deployment.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER, env.BACKEND_DATABASE_USER);
  assert.equal(backend.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER, undefined);
  assert.ok(!JSON.stringify(backend.environment).includes(env.POSTGRES_PASSWORD));
  assert.equal(backend.depends_on.clamav.condition, 'service_healthy');
  assert.ok(clamav);
});

test('split and unsplit credentials cannot be substituted during protected rollout', () => {
  const config = render();
  const runtimeUrl = config.services.backend.environment.DATABASE_URL;
  const legacy = render(Object.fromEntries(Object.keys(env).filter(key => key.includes('DATABASE_')).map(key => [key, ''])));
  assert.deepEqual(readPredecessorDatabaseTopology(legacy, legacy.services.backend.environment.DATABASE_URL), { split: false });
  assert.equal(legacy.services.deployment.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER, env.POSTGRES_USER);
  for (const attempt of [
    () => readPredecessorDatabaseTopology(legacy, runtimeUrl),
    () => readPredecessorDatabaseTopology(config, legacy.services.backend.environment.DATABASE_URL),
    () => readPredecessorDatabaseTopology(config, undefined),
    () => readPredecessorDatabaseTopology(config, runtimeUrl.replace('runtime-fixture', 'other-fixture')),
    () => {
      const unsafe = render({ BACKEND_DATABASE_PASSWORD: '' });
      return readPredecessorDatabaseTopology(unsafe, unsafe.services.backend.environment.DATABASE_URL);
    },
  ]) assert.throws(attempt, /PREDECESSOR_DATABASE_TOPOLOGY_UNPROVEN/);
});
