import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountingContractsLoader } from '../accountingContractsLoader';

for (const order of [[0, 1], [1, 0]]) test(`only current search publishes with response order ${order}`, async () => {
  const pending: Array<{ resolve: (value: string) => void; signal: AbortSignal }> = [];
  const events: string[] = [];
  const loader = createAccountingContractsLoader<string, string>({
    read: (_, signal) => new Promise(resolve => pending.push({ resolve, signal })),
    start: () => events.push('start'), success: value => events.push(value),
    failure: () => events.push('error'), settled: () => events.push('settled'),
  });
  const flights = [loader.load(''), loader.load('حسن زارع')];
  assert.equal(pending[0].signal.aborted, true);
  for (const index of order) {
    pending[index].resolve(index === 0 ? 'FULL LIST' : 'SEARCHED RESULT');
    await flights[index];
    if (index === 0) assert.equal(events.includes('FULL LIST'), false);
  }
  assert.deepEqual(events, ['start', 'start', 'SEARCHED RESULT', 'settled']);
});

test('obsolete errors and unmounted responses do not clear current loading or show errors', async () => {
  let rejectOld!: (reason: Error) => void;
  let resolveCurrent!: (value: string) => void;
  const events: string[] = [];
  const loader = createAccountingContractsLoader<number, string>({
    read: value => value === 0 ? new Promise((_, reject) => { rejectOld = reject; })
      : new Promise(resolve => { resolveCurrent = resolve; }),
    start: () => events.push('start'), success: value => events.push(value),
    failure: () => events.push('error'), settled: () => events.push('settled'),
  });
  const old = loader.load(0), current = loader.load(1);
  rejectOld(new Error('late failure')); await old;
  assert.deepEqual(events, ['start', 'start']);
  loader.cancel(); resolveCurrent('unmounted'); await current;
  assert.deepEqual(events, ['start', 'start']);
});

test('current failure settles and an explicit retry can recover', async () => {
  let fail = true; const events: string[] = [];
  const loader = createAccountingContractsLoader<void, string>({
    read: async () => { if (fail) throw new Error('offline'); return 'recovered'; },
    start: () => events.push('start'), success: value => events.push(value),
    failure: () => events.push('error'), settled: () => events.push('settled'),
  });
  await loader.load(); fail = false; await loader.load();
  assert.deepEqual(events, ['start', 'error', 'settled', 'start', 'recovered', 'settled']);
});
