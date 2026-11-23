import assert from 'node:assert/strict';
import test from 'node:test';
import axios from 'axios';
import { bindActorRequests } from './actorScopedHttp';

test('a retained request keeps its actor and existing idempotency metadata', async () => {
  const client = axios.create({
    adapter: async config => ({
      data: { actor: config.headers.get('x-sabalan-expected-user'), idempotency: config.headers.get('x-idempotency-key') },
      headers: {}, status: 200, statusText: 'OK', config,
    }),
  });
  const scoped = bindActorRequests(client, 'accounting-one', () => 0);
  const response = await scoped.post('/accounting/dispatch-candidates/fixture', {}, {
    headers: { 'x-idempotency-key': 'original-command' },
  });
  assert.deepEqual(response.data, { actor: 'accounting-one', idempotency: 'original-command' });
});

test('an expired private scope rejects its delayed result and cannot start a follow-up command', async () => {
  let release: () => void = () => assert.fail('Expected a request in flight');
  let dispatched = 0;
  let generation: number | undefined = 0;
  const client = axios.create({
    adapter: config => new Promise(resolve => {
      dispatched++;
      release = () => resolve({ data: 'private report', headers: {}, status: 200, statusText: 'OK', config });
    }),
  });
  const scoped = bindActorRequests(client, 'sales-one', () => generation);
  const pending = scoped.get('/sales/reports/summary');
  generation = undefined;
  release();
  await assert.rejects(pending, { code: 'AUTH_CONTEXT_CHANGED' });
  await assert.rejects(scoped.post('/sales/reports/presets', {}), { code: 'AUTH_CONTEXT_CHANGED' });
  assert.equal(dispatched, 1);
});
