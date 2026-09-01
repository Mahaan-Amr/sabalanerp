import assert from 'node:assert/strict';
import test from 'node:test';
import { localTarget, validateRuntime, validateNamespace, verifyLocalHttp } from './harness/safety.mjs';

test('Partner QA rejects remote, redirected, alternate database and production targets', () => {
  assert.equal(localTarget({}).frontend, 'http://127.0.0.1:3000');
  for (const overrides of [
    { PARTNER_QA_URL: 'https://erp.example.com' },
    { PARTNER_QA_URL: 'http://127.0.0.1:3000@evil.example' },
    { PARTNER_QA_URL: 'http://127.0.0.1:3000/path' },
    { DATABASE_URL: 'postgresql://localhost/production' },
    { PGHOST: 'production' },
    { COMPOSE_PROJECT_NAME: 'other-stack' },
    { DOCKER_HOST: 'ssh://production' },
    { NODE_ENV: 'production' },
  ]) assert.throws(() => localTarget(overrides), /Partner QA/);
});

test('runtime must prove local database and credential-free SMS sandbox', () => {
  const safe = { project: 'sabalanerp-local', nodeEnv: 'development', databaseHost: 'postgres', databaseName: 'sabalanerp', smsEnvironment: 'sandbox', smsCredentialsPresent: false };
  assert.doesNotThrow(() => validateRuntime(safe));
  for (const overrides of [
    { project: 'production' }, { databaseName: 'production' },
    { databaseHost: 'remote' }, { smsCredentialsPresent: true },
    { smsEnvironment: 'production' }, { nodeEnv: 'production' }, { nodeEnv: undefined },
  ]) assert.throws(() => validateRuntime({ ...safe, ...overrides }), /Partner QA/);
});

test('fixture cleanup accepts only complete, unpredictable run namespaces', () => {
  assert.equal(validateNamespace('partner-qa-12345678-1234-4234-9234-123456789abc'), 'partner-qa-12345678-1234-4234-9234-123456789abc');
  for (const invalid of ['', 'partner-qa-', 'admin', 'partner-qa-%', '../partner-qa-123']) {
    assert.throws(() => validateNamespace(invalid), /namespace/);
  }
});

test('readiness probes release response bodies and never reuse idle connections or retry failures', async () => {
  const calls = [];
  const response = (ok) => ({ ok, body: { async cancel() { calls.push('released'); } } });
  await verifyLocalHttp(async (url, options) => {
    assert.equal(options.headers.Connection, 'close');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    calls.push(url);
    return response(true);
  });
  assert.deepEqual(calls, ['http://127.0.0.1:5000/api/ready', 'released', 'http://127.0.0.1:3000/login', 'released']);
  calls.length = 0;
  await assert.rejects(verifyLocalHttp(async () => response(false)), /readiness failed/);
  assert.deepEqual(calls, ['released']);
  let attempts = 0;
  await assert.rejects(verifyLocalHttp(async () => { attempts++; throw new Error('connection unavailable'); }), /connection unavailable/);
  assert.equal(attempts, 1);
});
