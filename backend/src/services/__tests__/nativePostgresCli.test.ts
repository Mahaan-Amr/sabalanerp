import assert from 'node:assert/strict';
import test from 'node:test';
import { nativePostgresCliConnection } from '../nativePostgresCli';

test('native PostgreSQL tools retain SSL and application identity without Prisma pool parameters or password arguments', () => {
  const original = 'postgresql://drill:secret%40value@postgres:5432/sabalan_drill?schema=public&connection_limit=2&pool_timeout=10&pgbouncer=true&statement_cache_size=0&application_name=isolated-drill&sslmode=verify-full&sslrootcert=%2Fprivate%2Fca.pem&connect_timeout=12';
  const result = nativePostgresCliConnection(original, 'postgres');
  const url = new URL(result.url);
  assert.equal(url.pathname, '/postgres');
  assert.equal(url.password, '');
  assert.equal(result.environment.PGPASSWORD, 'secret@value');
  for (const key of ['schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'statement_cache_size']) assert.equal(url.searchParams.has(key), false);
  assert.equal(url.searchParams.get('application_name'), 'isolated-drill');
  assert.equal(url.searchParams.get('sslmode'), 'verify-full');
  assert.equal(url.searchParams.get('sslrootcert'), '/private/ca.pem');
  assert.equal(url.searchParams.get('connect_timeout'), '12');
  assert.match(original, /connection_limit=2/);
  assert.doesNotMatch(result.url, /secret|value/);
});

test('native password query moves to child environment and malformed input errors reveal no credentials', () => {
  const result = nativePostgresCliConnection('postgresql://drill:first@localhost/db?password=second&sslmode=require');
  assert.equal(result.environment.PGPASSWORD, 'second');
  assert.doesNotMatch(result.url, /first|second|password/);
  assert.throws(() => nativePostgresCliConnection('not-a-url-secret'), { code: 'NATIVE_POSTGRES_URL_INVALID' });
  assert.throws(() => nativePostgresCliConnection('https://secret@production/db'), { code: 'NATIVE_POSTGRES_URL_INVALID' });
});
