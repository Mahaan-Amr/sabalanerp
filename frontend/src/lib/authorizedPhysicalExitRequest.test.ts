import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAuthorizedPhysicalExitRequest } from './authorizedPhysicalExitRequest';

test('recording an authorized physical exit sends the required command headers', () => {
  const request = buildAuthorizedPhysicalExitRequest('authorization-1', 'correlation-1');

  assert.equal(request.path, '/security/exit-desk/authorizations/authorization-1/exit');
  assert.deepEqual(request.body, {});
  assert.equal(
    request.config.headers['Idempotency-Key'],
    'security-authorized-physical-exit:authorization-1',
  );
  assert.equal(request.config.headers['X-Correlation-ID'], 'correlation-1');
});

test('a retry keeps the same idempotency key while allowing a new correlation id', () => {
  const first = buildAuthorizedPhysicalExitRequest('authorization-1', 'correlation-1');
  const retry = buildAuthorizedPhysicalExitRequest('authorization-1', 'correlation-2');

  assert.equal(retry.config.headers['Idempotency-Key'], first.config.headers['Idempotency-Key']);
  assert.notEqual(retry.config.headers['X-Correlation-ID'], first.config.headers['X-Correlation-ID']);
});
