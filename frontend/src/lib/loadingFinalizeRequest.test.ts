import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLoadingFinalizeRequest } from './loadingFinalizeRequest';

test('finalizing a loading always sends a stable idempotency key', () => {
  const first = buildLoadingFinalizeRequest('loading-1');
  const retry = buildLoadingFinalizeRequest('loading-1');

  assert.equal(first.path, '/logistics/loadings/loading-1/finalize');
  assert.deepEqual(first.body, {});
  assert.equal(first.config.headers['Idempotency-Key'], 'logistics-loading-finalize:loading-1');
  assert.deepEqual(retry, first);
});
