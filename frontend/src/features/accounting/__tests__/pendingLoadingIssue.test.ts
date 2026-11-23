import assert from 'node:assert/strict';
import test from 'node:test';
import { clearOtherActorLoadingIssues, forgetLoadingIssue, rememberLoadingIssue, storedLoadingIssue } from '../pendingLoadingIssue';

test('a pending dispatch command survives the page and is retired only by its owning actor and exact identity', t => {
  const entries = new Map<string, string>();
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true, value: {
      getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => entries.set(key, value),
      removeItem: (key: string) => entries.delete(key),
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  });
  const command = { id: '64114da0-e0ce-4dbc-8188-9c963f004bda',
    recovery: { waybillId: 'old-waybill', invoiceId: 'old-invoice', reason: 'اصلاح اطلاعات راننده' } };
  rememberLoadingIssue('accountant-a', 'loading-a', command);
  assert.deepEqual(storedLoadingIssue('accountant-a', 'loading-a'), command);
  assert.equal(storedLoadingIssue('accountant-a', 'loading-b'), undefined);
  forgetLoadingIssue('accountant-a', 'loading-a', 'another-command');
  assert.deepEqual(storedLoadingIssue('accountant-a', 'loading-a'), command);
  forgetLoadingIssue('accountant-a', 'loading-a', command.id);
  assert.equal(storedLoadingIssue('accountant-a', 'loading-a'), undefined);
  rememberLoadingIssue('accountant-a', 'loading-a', command);
  clearOtherActorLoadingIssues('accountant-b');
  assert.equal(storedLoadingIssue('accountant-b', 'loading-a'), undefined);
  assert.equal(entries.size, 0);
});
