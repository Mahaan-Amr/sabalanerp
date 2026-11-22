import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrivateClient } from './privateClientScope';

test('simultaneous private operations share only the identity probe and bind every read/write', async () => {
  let finish!: (identity: { userId: string; sessionId: string }) => void;
  const pending = new Promise<{ userId: string; sessionId: string }>(resolve => { finish = resolve; });
  let probes = 0;
  const headers: Record<string, string>[] = [];
  const client = createPrivateClient('user-a', async () => { probes++; return pending; }, binding => ({
    read: async () => { headers.push(binding); return 'read'; }, write: async () => { headers.push(binding); return 'write'; },
  }));
  const read = client.read(), write = client.write();
  finish({ userId: 'user-a', sessionId: 'session-a' });
  assert.deepEqual(await Promise.all([read, write]), ['read', 'write']);
  assert.equal(probes, 1);
  assert.deepEqual(headers, Array.from({ length: 2 }, () => ({ 'x-sabalan-expected-user': 'user-a', 'x-sabalan-expected-session': 'session-a' })));
  await client.read();
  assert.equal(probes, 2, 'identity must not become a time-based private-data cache');
});

test('changed owner or missing session metadata never invokes the private operation', async () => {
  for (const identity of [{ userId: 'user-b', sessionId: 'session-b' }, { userId: 'user-a', sessionId: undefined },
    { userId: 'user-a', sessionId: 'session-a,session-b' }]) {
    let calls = 0;
    const client = createPrivateClient('user-a', async () => identity as any, () => ({ read: async () => { calls++; } }));
    await assert.rejects(client.read(), { code: 'AUTH_CONTEXT_CHANGED' });
    assert.equal(calls, 0);
  }
});

test('a denied parallel operation prevents an older successful response from repainting private state', async () => {
  let finish!: (value: string) => void;
  const pending = new Promise<string>(resolve => { finish = resolve; });
  const client = createPrivateClient('user-a', async () => ({ userId: 'user-a', sessionId: 'session-a' }), () => ({
    slow: async () => pending,
    denied: async () => { throw Object.assign(new Error('cookie changed before private request'), { response: { status: 401 } }); },
  }));
  const old = client.slow();
  await assert.rejects(client.denied());
  const rejected = assert.rejects(old, { code: 'AUTH_CONTEXT_CHANGED' });
  finish('stale private response');
  await rejected;
});
