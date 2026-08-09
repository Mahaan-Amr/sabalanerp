import assert from 'node:assert/strict';
import test from 'node:test';

import api from '../api';

test('each mutation attempt gets a fresh correlation id while retry idempotency remains stable', async () => {
  const observedHeaders: Array<Record<string, string>> = [];
  const previousAdapter = api.defaults.adapter;

  api.defaults.adapter = async (config) => {
    observedHeaders.push(config.headers.toJSON() as Record<string, string>);
    throw Object.assign(new Error('simulated transport failure'), { config });
  };

  try {
    const request = () => api.post('/test/mutation-correlation-seam', { dispatchId: 'dispatch-255' });
    await assert.rejects(request(), /simulated transport failure/);
    await assert.rejects(request(), /simulated transport failure/);
  } finally {
    api.defaults.adapter = previousAdapter;
  }

  assert.equal(observedHeaders.length, 2);
  const firstIdempotency = observedHeaders[0]['x-idempotency-key'];
  const secondIdempotency = observedHeaders[1]['x-idempotency-key'];
  const firstCorrelation = observedHeaders[0]['x-correlation-id'];
  const secondCorrelation = observedHeaders[1]['x-correlation-id'];

  assert.ok(firstIdempotency);
  assert.equal(secondIdempotency, firstIdempotency);
  assert.ok(firstCorrelation);
  assert.ok(secondCorrelation);
  assert.notEqual(secondCorrelation, firstCorrelation);
  assert.notEqual(firstCorrelation, firstIdempotency);
  assert.notEqual(secondCorrelation, secondIdempotency);
});

test('an explicit correlation id is preserved while retry idempotency remains stable', async () => {
  const observedHeaders: Array<Record<string, string>> = [];
  const previousAdapter = api.defaults.adapter;
  const explicitCorrelationId = 'accounting-dispatch-correlation-255';

  api.defaults.adapter = async (config) => {
    observedHeaders.push(config.headers.toJSON() as Record<string, string>);
    throw Object.assign(new Error('simulated transport failure'), { config });
  };

  try {
    const request = () => api.post(
      '/test/explicit-mutation-correlation-seam',
      { dispatchId: 'dispatch-255' },
      { headers: { 'x-correlation-id': explicitCorrelationId } },
    );
    await assert.rejects(request(), /simulated transport failure/);
    await assert.rejects(request(), /simulated transport failure/);
  } finally {
    api.defaults.adapter = previousAdapter;
  }

  assert.equal(observedHeaders.length, 2);
  assert.equal(observedHeaders[0]['x-correlation-id'], explicitCorrelationId);
  assert.equal(observedHeaders[1]['x-correlation-id'], explicitCorrelationId);
  assert.ok(observedHeaders[0]['x-idempotency-key']);
  assert.equal(observedHeaders[1]['x-idempotency-key'], observedHeaders[0]['x-idempotency-key']);
});
