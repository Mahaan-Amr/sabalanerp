import assert from 'node:assert/strict';
import test from 'node:test';
import { createContract } from '../contractService';

test('creation uses a bounded per-call budget and does not retry transaction expiry', async () => {
  let attempts = 0;
  const expired = Object.assign(new Error('expired'), { code: 'P2028' });
  const runner = { async $transaction<T>(_work: unknown, options?: { maxWait?: number; timeout?: number }): Promise<T> {
    attempts += 1;
    assert.deepEqual(options, { maxWait: 5_000, timeout: 15_000 });
    throw expired;
  } };
  await assert.rejects(() => createContract({ title: 'test', titlePersian: 'آزمون',
    customerId: 'test', departmentId: 'test', content: '' }, 'test', undefined, runner), expired);
  assert.equal(attempts, 1);
});
