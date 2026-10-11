import assert from 'node:assert/strict';
import test from 'node:test';
import { createDutyCountRequests } from './dutyCountRequests';

test('concurrent counters share the flight; a mutation during it refreshes before publishing', async () => {
  const pending: Array<{ resolve: (value: number) => void; reject: (error: Error) => void }> = [];
  const requests = createDutyCountRequests(async () => new Promise<number>((resolve, reject) => pending.push({ resolve, reject })));
  const actor = {};
  const first = requests(actor, 'sales');
  const second = requests(actor, 'sales');
  assert.equal(pending.length, 1);
  requests(actor, 'sales', true);
  pending[0].resolve(3);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.length, 2);
  pending[1].resolve(4);
  assert.deepEqual(await Promise.all([first, second]), [4, 4]);
  const fresh = requests(actor, 'sales');
  assert.equal(pending.length, 3, 'settled counts must never be cached');
  pending[2].resolve(5);
  assert.equal(await fresh, 5);
});

test('workspaces and authentication sessions are isolated and failures can retry', async () => {
  let loads = 0;
  const requests = createDutyCountRequests(async () => { loads++; throw new Error('offline'); });
  const actor = {};
  const results = await Promise.allSettled([requests(actor, 'sales'), requests(actor, 'sales'),
    requests(actor, 'accounting'), requests({}, 'sales')]);
  assert.ok(results.every(result => result.status === 'rejected'));
  assert.equal(loads, 3);
  await assert.rejects(requests(actor, 'sales'), /offline/);
  assert.equal(loads, 4);
});
