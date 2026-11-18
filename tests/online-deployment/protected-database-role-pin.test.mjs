import assert from 'node:assert/strict';
import { test } from 'node:test';
import { databaseRoleIdentity, pinExistingDatabaseRoles } from '../../deploy/scripts/protected-database-role-pin.mjs';

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
