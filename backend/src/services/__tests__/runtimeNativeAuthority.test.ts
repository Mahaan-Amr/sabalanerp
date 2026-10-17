import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationRuntimeDatabaseUrl } from '../runtimeNativeAuthority';

test('ordinary development and passive candidates cannot acquire control by supplying partial native authority', () => {
  const source = 'postgresql://user:private-password@localhost/db?connection_limit=2&pool_timeout=10';
  assert.equal(applicationRuntimeDatabaseUrl({ DATABASE_URL: source }), source);
  assert.equal(applicationRuntimeDatabaseUrl({ NODE_ENV: 'production', BACKEND_RUNTIME_ROLE: 'candidate', DATABASE_URL: source }), source);
  assert.equal(applicationRuntimeDatabaseUrl({ NODE_ENV: 'production', BACKEND_RUNTIME_ROLE: 'control', DATABASE_URL: source }), source);
  for (const environment of [
    { NODE_ENV: 'production', DATABASE_URL: source },
    { DATABASE_URL: source, BACKEND_NATIVE_POSTGRES_APPLICATION_NAME: 'sabalan-runtime-' + 'a'.repeat(48) },
    { BACKEND_RUNTIME_ROLE: 'candidate', DATABASE_URL: source, BACKEND_NATIVE_AUTHORITY_FILE: '/tmp/claim.json' },
  ]) {
    assert.throws(() => applicationRuntimeDatabaseUrl(environment), error => error instanceof Error
      && error.message === 'RUNTIME_NATIVE_AUTHORITY_UNPROVEN' && !error.message.includes('private-password'));
  }
});
