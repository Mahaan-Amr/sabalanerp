import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserSessionContinuation } from './browserSessionContinuation';

test('fresh account-bound probes coalesce only while pending and block account substitution', async () => {
  let userId = 'owner_a', sessionId = 'session_a', probes = 0;
  const scope = new BrowserSessionContinuation(async expected => {
    probes++; if (expected && expected !== userId) throw Object.assign(Error('denied'), { response: { status: 401 } });
    return { userId, sessionId };
  });
  const leases = await Promise.all([scope.acquire(), scope.acquire()]); assert.equal(probes, 1);
  await scope.acquire(); assert.equal(probes, 2);
  userId = 'owner_b'; sessionId = 'session_b';
  await assert.rejects(scope.acquire()); assert.equal(scope.snapshot(), 'owner_a');
  assert.throws(() => scope.assertCurrent(leases[0]), /برای ادامه/);
  assert.throws(() => scope.completeLogin({ userId, sessionId }, scope.beginLogin()));
  assert.equal(scope.expectedUserId(), 'owner_a');
});

test('same-owner recovery invalidates old parallel results and never replays a mutation', async () => {
  const scope = new BrowserSessionContinuation(async () => ({ userId: 'owner_a', sessionId: 'session_a' }));
  const before = await scope.acquire(); let changes = 0;
  const unsubscribe = scope.subscribe(() => { changes++; });
  scope.invalidate(); scope.invalidate(); assert.equal(changes, 1);
  await assert.rejects(scope.acquire());
  scope.completeLogin({ userId: 'owner_a', sessionId: 'session_new' }, scope.beginLogin());
  assert.equal(scope.snapshot(), null); assert.throws(() => scope.assertCurrent(before));
  scope.invalidate(before); assert.equal(scope.snapshot(), null, 'late failure from the old generation cannot block recovered work');
  assert.equal(changes, 2); unsubscribe(); scope.clear(); assert.equal(scope.expectedUserId(), undefined);
});

test('late bootstrap and login results cannot take ownership after explicit logout', () => {
  const scope = new BrowserSessionContinuation(async () => ({ userId: 'owner_a', sessionId: 'session_a' }));
  const pending = scope.beginLogin(); scope.clear();
  assert.throws(() => scope.acceptBootstrap({ userId: 'owner_a', sessionId: 'session_a' }, pending));
  assert.throws(() => scope.completeLogin({ userId: 'owner_a', sessionId: 'session_a' }, pending));
  assert.equal(scope.expectedUserId(), undefined);
});

test('a simultaneous initial identity read can join the same newly established owner', async () => {
  const identity = { userId: 'owner_a', sessionId: 'session_a' };
  const scope = new BrowserSessionContinuation(async () => identity), pending = scope.beginLogin();
  await scope.acquire(); assert.deepEqual(scope.acceptBootstrap(identity, pending), identity);
  assert.throws(() => scope.acceptBootstrap({ userId: 'owner_b', sessionId: 'session_b' }, pending));
});

test('clearing a tab scope cannot let an older pending probe claim its new owner', async () => {
  let finish!: (identity: { userId: string; sessionId: string }) => void;
  const scope = new BrowserSessionContinuation(() => new Promise(resolve => { finish = resolve; }));
  const pending = scope.acquire(); scope.clear(); finish({ userId: 'old_owner', sessionId: 'old_session' });
  await assert.rejects(pending);
  assert.equal(scope.expectedUserId(), undefined);
});
