import assert from 'node:assert/strict';
import test from 'node:test';
import { readNotificationWindow } from './notificationWindow';

test('catch-up retains loaded depth, follows fresh cursors and deduplicates shifted rows', async () => {
  const cursors: Array<string | undefined> = [];
  const result = await readNotificationWindow(2, async cursor => {
    cursors.push(cursor);
    return cursor ? { items: [{ id: 'b' }, { id: 'c' }], nextCursor: 'c', hasMore: true }
      : { items: [{ id: 'new' }, { id: 'b' }], nextCursor: 'b', hasMore: true };
  });
  assert.deepEqual(cursors, [undefined, 'b']);
  assert.deepEqual(result, { items: [{ id: 'new' }, { id: 'b' }, { id: 'c' }], nextCursor: 'c', hasMore: true });
});

test('deleted or exhausted pages stop without requesting an absent cursor', async () => {
  let calls = 0;
  const result = await readNotificationWindow(4, async () => { calls++; return { items: [], nextCursor: null, hasMore: false }; });
  assert.equal(calls, 1);
  assert.deepEqual(result, { items: [], nextCursor: null, hasMore: false });
});
