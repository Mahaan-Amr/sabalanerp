import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  databaseRoleIdentity, pinExistingDatabaseRoles, preflightFirstDatabaseRoleSplit, preflightFirstDatabaseRoleSplitRelease,
} from '../../deploy/scripts/protected-database-role-pin.mjs';

const bootstrap = {
  POSTGRES_USER: 'bootstrap_owner', POSTGRES_PASSWORD: 'bootstrap:test@private', POSTGRES_DB: 'sabalanerp',
};
const controlUrl = 'postgresql://bootstrap_owner:bootstrap%3Atest%40private@postgres:5432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
const runtimeUrl = 'postgresql://sabalan_application_runtime:private@postgres:5432/sabalanerp?schema=public&connection_limit=10&pool_timeout=10';
const compose = (runtime = runtimeUrl, control = controlUrl, postgres = bootstrap) => ({ services: {
  backend: { environment: { DATABASE_URL: runtime } },
  deployment: { environment: { DATABASE_URL: control } },
  postgres: { environment: postgres },
} });

test('ordinary rollout accepts existing legacy or already split runtime with the established bootstrap control', () => {
  for (const existingRuntime of [controlUrl, runtimeUrl]) {
    const rendered = compose(existingRuntime);
    const pin = pinExistingDatabaseRoles(rendered, existingRuntime, bootstrap);
    assert.equal(pin, databaseRoleIdentity(rendered));
    assert.match(pin, /^[a-f0-9]{64}$/);
    assert.notEqual(pin, databaseRoleIdentity(compose(existingRuntime, controlUrl.replace('connection_limit=2', 'connection_limit=3'))));
  }
});

test('ordinary rollout refuses role, credential, and database changes before a new release or rollback', () => {
  const baseline = compose();
  for (const rendered of [
    compose(controlUrl),
    compose(runtimeUrl.replace(':private@', ':rotated@')),
    compose(runtimeUrl, controlUrl.replace('bootstrap_owner', 'new_control')),
    compose(runtimeUrl, controlUrl.replace('bootstrap%3Atest%40private', 'redacted-other-password')),
    compose(runtimeUrl, controlUrl.replace('@postgres:', '@other:')),
    compose(runtimeUrl, controlUrl.replace('/sabalanerp?', '/other?')),
    compose(runtimeUrl, controlUrl, { ...bootstrap, POSTGRES_PASSWORD: 'other' }),
  ]) {
    assert.throws(() => pinExistingDatabaseRoles(rendered, runtimeUrl, bootstrap), /^Error: PROTECTED_DATABASE_ROLE_CONFIGURATION_CHANGED$/);
    assert.notEqual(databaseRoleIdentity(rendered), databaseRoleIdentity(baseline));
  }
});

const legacyRuntime = runtimeUrl.replace('sabalan_application_runtime:private', 'bootstrap_owner:bootstrap%3Atest%40private');
const roleSplitCompose = (runtime, checkpointUser) => {
  const rendered = compose(runtime);
  rendered.name = 'sabalanerp';
  rendered.services.deployment.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER = checkpointUser;
  rendered.services.backend.image = 'backend-fixture';
  return rendered;
};
const baseline = () => roleSplitCompose(legacyRuntime, bootstrap.POSTGRES_USER);
const proposed = () => roleSplitCompose(runtimeUrl, 'sabalan_application_runtime');

test('first-split preflight fingerprints both configurations without changing the ordinary release pin', () => {
  const before = baseline();
  const after = proposed();
  const observation = preflightFirstDatabaseRoleSplit(before, after, legacyRuntime, bootstrap);
  assert.deepEqual(observation, {
    beforePin: databaseRoleIdentity(before),
    afterPin: databaseRoleIdentity(after),
    runtimeRole: 'sabalan_application_runtime',
  });
  assert.notEqual(observation.beforePin, observation.afterPin);
  assert.throws(() => pinExistingDatabaseRoles(after, legacyRuntime, bootstrap), /PROTECTED_DATABASE_ROLE_CONFIGURATION_CHANGED/);
});

test('first-split preflight rejects unrelated configuration changes and role drift', () => {
  const reject = /^Error: PROTECTED_DATABASE_ROLE_CONFIGURATION_CHANGED$/;
  const before = baseline();
  for (const change of [
    after => { after.services.backend.environment.DATABASE_URL = runtimeUrl.replace(':private@', ':bootstrap%3Atest%40private@'); },
    after => { after.services.backend.environment.DATABASE_URL = runtimeUrl.replace('pool_timeout=10', 'pool_timeout=99'); },
    after => { after.services.deployment.environment.DEPLOYMENT_CHECKPOINT_RUNTIME_USER = 'bootstrap_owner'; },
    after => { after.services.deployment.environment.DATABASE_URL = controlUrl.replace('connection_limit=2', 'connection_limit=3'); },
    after => { after.services.backend.image = 'different-backend-fixture'; },
    after => { after.name = 'unexpected-project'; },
  ]) {
    const after = proposed();
    change(after);
    assert.throws(() => preflightFirstDatabaseRoleSplit(before, after, legacyRuntime, bootstrap), reject);
  }
  assert.throws(() => preflightFirstDatabaseRoleSplit(before, proposed(), runtimeUrl, bootstrap), reject);
  const offTargetLegacyUrl = legacyRuntime.replace('@postgres:', '@other:');
  assert.throws(() => preflightFirstDatabaseRoleSplit(
    roleSplitCompose(offTargetLegacyUrl, bootstrap.POSTGRES_USER),
    roleSplitCompose(runtimeUrl.replace('@postgres:', '@other:'), 'sabalan_application_runtime'),
    offTargetLegacyUrl,
    bootstrap,
  ), reject);
});

function installedRelease() {
  const services = ['backend', 'frontend', 'inquiry', 'nginx', 'postgres'];
  const images = Object.fromEntries(services.map((service, i) => [service, 'sha256:' + String(i + 1).repeat(64)]));
  const commit = 'a'.repeat(40);
  const identity = Object.fromEntries([
    'SOURCE_HASH', 'SCHEMA_HASH', 'POLICY_HASH', 'INFRASTRUCTURE_HASH',
  ].map(key => ['PERFORMANCE_RELEASE_' + key, 'b'.repeat(64)]));
  const backend = {
    ...identity,
    PERFORMANCE_RUNTIME_INFRASTRUCTURE_HASH: 'b'.repeat(64),
    PERFORMANCE_RELEASE_COMMIT: commit,
    PERFORMANCE_RELEASE_BACKEND_IMAGE: images.backend,
    PERFORMANCE_RELEASE_FRONTEND_IMAGE: images.frontend,
    PERFORMANCE_RELEASE_INQUIRY_IMAGE: images.inquiry,
    APP_COMMIT: commit,
    DATABASE_URL: legacyRuntime,
  };
  const rows = services.map((service, i) => ({
    Id: String(i + 1).repeat(64),
    Image: images[service],
    State: { Running: true, Health: { Status: 'healthy' } },
    Config: {
      Labels: {
        'com.docker.compose.project': 'sabalanerp',
        'com.docker.compose.service': service,
        ...(service === 'backend' ? { 'io.sabalan.release.upload-policy': 'no-malware-scan' } : {}),
      },
      Env: Object.entries(service === 'backend' ? backend : service === 'postgres' ? bootstrap : {})
        .map(([key, value]) => key + '=' + value),
    },
  }));
  const withImages = config => {
    for (const [service, image] of Object.entries(images)) {
      config.services[service] = { ...config.services[service], image };
    }
    config.services.deployment.image = images.backend;
    return config;
  };
  return { rows, images, commit, before: withImages(baseline()), after: withImages(proposed()) };
}

test('first-split release preflight binds the scanner-free serving graph and PostgreSQL image', () => {
  const { rows, images, commit, before, after } = installedRelease();
  const observation = preflightFirstDatabaseRoleSplitRelease(before, after, rows);
  assert.deepEqual(observation.images, images);
  assert.equal(observation.releaseCommit, commit);
  assert.equal(observation.containers.postgres, rows[4].Id);

  const drifted = structuredClone(rows);
  drifted[0].Config.Labels['com.docker.compose.project'] = 'other';
  assert.throws(() => preflightFirstDatabaseRoleSplitRelease(before, after, drifted));
  assert.throws(() => preflightFirstDatabaseRoleSplitRelease(before, after, rows.slice(0, -1)));
  after.services.postgres.image = images.nginx;
  assert.throws(() => preflightFirstDatabaseRoleSplitRelease(before, after, rows));
});
