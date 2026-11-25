import assert from 'node:assert/strict';
import test from 'node:test';
import { createAccountingRegisterLoader, isCurrentAccountingRegisterRow } from '../accountingRegisterLoader';

const original = { items: [{ id: 'receipt-1', amount: '1250000' }], total: 8, focus: 'receipt-1' };

test('refresh retains rows, total and focus, blocks actions on a read error, and can retry', async () => {
  let fail = false;
  const loader = createAccountingRegisterLoader({
    read: async () => {
      if (fail) throw new Error('offline');
      return original;
    },
    failureMessage: () => 'Try again',
    publish: () => {},
  });
  await loader.load();
  fail = true;
  const refreshing = loader.load();
  assert.equal(loader.current().status, 'refreshing');
  assert.equal(loader.current().data, original);
  await refreshing;
  assert.deepEqual(loader.current(), { status: 'error', data: original, message: 'Try again' });
  fail = false;
  await loader.load();
  assert.deepEqual(loader.current(), { status: 'ready', data: original });
});

test('a superseded response cannot change current rows, including after access is revoked', async () => {
  const pending: Array<(value: typeof original) => void> = [];
  const loader = createAccountingRegisterLoader({
    read: () => new Promise<typeof original>(resolve => pending.push(resolve)),
    failureMessage: () => 'Try again',
    publish: () => {},
  });
  const old = loader.load();
  const next = loader.load();
  pending[1](original);
  await next;
  assert.equal(loader.current().data, original);
  assert.equal(loader.clearOnDenial({ response: { status: 403 } }), true);
  pending[0](original);
  await old;
  assert.deepEqual(loader.current(), { status: 'denied', data: null, reason: 'permission' });
});

test('a different filter starts without old rows and cancellation discards an unmounted actor response', async () => {
  let respond!: (value: typeof original) => void;
  const previous = createAccountingRegisterLoader({
    read: () => new Promise<typeof original>(resolve => { respond = resolve; }),
    failureMessage: () => 'Try again',
    publish: () => { assert.equal(previous.current().data, null); },
  });
  const read = previous.load();
  previous.cancel();
  const next = createAccountingRegisterLoader({
    read: async () => ({ items: [], total: 0, focus: null }),
    failureMessage: () => 'Try again',
    publish: () => {},
  });
  assert.equal(next.current().data, null);
  await next.load();
  respond(original);
  await read;
  assert.deepEqual(next.current(), { status: 'ready', data: { items: [], total: 0, focus: null } });
});

test('a rejected refresh clears the private snapshot and cannot reveal it on a retry', async () => {
  let allowed = true;
  const loader = createAccountingRegisterLoader({
    read: async () => {
      if (!allowed) throw { code: 'AUTH_CONTEXT_CHANGED' };
      return original;
    },
    failureMessage: () => 'Try again',
    publish: () => {},
  });
  await loader.load();
  allowed = false;
  await loader.load();
  assert.deepEqual(loader.current(), { status: 'denied', data: null, reason: 'actor' });
  const retry = loader.load();
  assert.deepEqual(loader.current(), { status: 'loading', data: null });
  await retry;
  assert.deepEqual(loader.current(), { status: 'denied', data: null, reason: 'actor' });
});

test('a selected payment projection survives an equal snapshot and cannot submit against changed data', () => {
  const target = { id: 'payment-1', projectionId: 'payment-1-effective', amount: '500000', status: 'RECEIVED' };
  const earlier = { ...target, projectionId: 'payment-1-earlier' };
  const key = (row: typeof target) => row.projectionId;
  assert.equal(isCurrentAccountingRegisterRow([earlier, { ...target }], target, key), true);
  assert.equal(isCurrentAccountingRegisterRow([earlier], target, key), false);
  assert.equal(isCurrentAccountingRegisterRow([{ ...target, status: 'REVERSED' }], target, key), false);
  assert.equal(isCurrentAccountingRegisterRow([{ ...target, amount: '350000' }], target, key), false);
});
