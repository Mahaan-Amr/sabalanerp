import assert from 'node:assert/strict';
import test from 'node:test';
import { completeHandoffs } from '../dispatchDocuments/completeHandoffs';

test('all print audits complete in order even when one fails', async () => {
  const calls: string[] = [];
  let running = false;
  const operation = (name: string, fail = false) => async () => {
    assert.equal(running, false);
    running = true;
    await Promise.resolve();
    calls.push(name);
    running = false;
    if (fail) throw new Error(name);
  };
  await assert.rejects(() => completeHandoffs([operation('first'), operation('second', true), operation('third')]), /second/);
  assert.deepEqual(calls, ['first', 'second', 'third']);
});
