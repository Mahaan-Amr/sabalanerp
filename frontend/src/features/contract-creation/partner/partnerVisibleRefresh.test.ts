import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerVisibleRefresh } from './partnerVisibleRefresh';
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
test('visible inquiry polling runs every ten seconds, coalesces focus and backs off temporary failures', async () => {
  let visible = true, calls = 0, fail = false;
  let scheduled: (() => void) | undefined, delay = 0;
  let release: (() => void) | undefined;
  const poll = createPartnerVisibleRefresh({ visible: () => visible,
    refresh: async () => { calls++; if (release) await new Promise<void>(done => { release = done; }); if (fail) throw new Error('temporary'); },
    schedule: (callback, milliseconds) => { scheduled = callback; delay = milliseconds; return 1; }, cancel: () => { scheduled = undefined; } });
  poll.start(); await flush(); assert.equal(calls, 1); assert.equal(delay, 10_000);
  visible = false; scheduled?.(); await flush(); assert.equal(calls, 1);
  visible = true; fail = true; poll.refresh(); await flush(); assert.equal(calls, 2); assert.equal(delay, 20_000);
  scheduled?.(); await flush(); assert.equal(delay, 40_000);
  fail = false; release = () => {}; poll.refresh(); poll.refresh(); assert.equal(calls, 4);
  release(); release = undefined; await flush(); assert.equal(delay, 10_000);
  poll.stop(); assert.equal(scheduled, undefined); poll.refresh(); assert.equal(calls, 4);
});

 test('a just-hydrated wizard delays redundant polling; explicit refresh stays immediate and stop cancels it', async () => {
  let calls = 0, scheduled: (() => void) | undefined, delay = 0;
  const poll = createPartnerVisibleRefresh({ initialDelayMs: 10_000, visible: () => true,
    refresh: async () => { calls++; }, schedule: (cb, ms) => { scheduled = cb; delay = ms; return 1; }, cancel: () => { scheduled = undefined; } });
  poll.start(); poll.start(); assert.equal(calls, 0); assert.equal(delay, 10_000);
  poll.refresh(); await flush(); assert.equal(calls, 1);
  scheduled?.(); await flush(); assert.equal(calls, 2);
  poll.stop(); assert.equal(scheduled, undefined);
});
