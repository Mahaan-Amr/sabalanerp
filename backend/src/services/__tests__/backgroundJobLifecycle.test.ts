import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BackgroundJobGroup } from '../backgroundJobLifecycle';

test('drain waits for actual job completion and prevents subsequent work', async () => {
  let complete!: () => void;
  const running = new Promise<void>(resolve => { complete = resolve; });
  let executions = 0;
  const group = new BackgroundJobGroup(async work => work());
  group.start({ name: 'delivery', intervalMs: 60_000, run: async () => { executions += 1; await running; } });
  let drained = false;
  const drain = group.stop(1000).then(() => { drained = true; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(drained, false);
  complete();
  await drain;
  assert.equal(executions, 1);
  assert.throws(() => group.start({ name: 'later', intervalMs: 1, run: async () => {} }), /STOPPING/);
});
