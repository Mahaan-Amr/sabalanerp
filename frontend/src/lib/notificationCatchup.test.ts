import assert from 'node:assert/strict';
import test from 'node:test';
import { NotificationCatchup } from './notificationCatchup';

test('a burst of hints during a read produces one trailing authoritative read', async () => {
  let finish!: () => void, enter!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let calls = 0;
  const catchup = new NotificationCatchup(async () => { if (++calls === 1) { enter(); await pending; } });
  const first = catchup.refresh();
  await entered;
  for (let i = 0; i < 100; i++) void catchup.refresh();
  finish(); await first;
  assert.equal(calls, 2);
  catchup.stop(); await catchup.refresh();
  assert.equal(calls, 2);
});

test('a failed read can retry on a later hint', async () => {
  let calls = 0;
  const catchup = new NotificationCatchup(async () => { if (++calls === 1) throw new Error('disconnected'); });
  await assert.rejects(catchup.refresh(), /disconnected/);
  await catchup.refresh();
  assert.equal(calls, 2);
  catchup.stop();
});

test('disposal during a pending read suppresses the queued trailing read', async () => {
  let finish!: () => void, enter!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const entered = new Promise<void>(resolve => { enter = resolve; });
  let calls = 0;
  const catchup = new NotificationCatchup(async () => { calls++; enter(); await pending; });
  const active = catchup.refresh(); await entered;
  void catchup.refresh(); catchup.stop(); finish(); await active;
  assert.equal(calls, 1);
});
