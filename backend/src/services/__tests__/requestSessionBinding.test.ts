import assert from 'node:assert/strict';
import test from 'node:test';
import { matchesRequestSessionBinding } from '../requestSessionBinding';

test('browser scope can only narrow authoritative cookie identity; legacy requests remain compatible', () => {
  const session = { id: 'session-a', userId: 'user-a' };
  const check = (expectedUser?: string, expectedSession?: string, userOnlyProbe = false) =>
    matchesRequestSessionBinding({ expectedUser, expectedSession, userOnlyProbe }, session);
  assert.equal(check(), true);
  assert.equal(check('user-a', 'session-a'), true);
  assert.equal(check('user-b', 'session-a'), false);
  assert.equal(check('user-a', 'session-b'), false);
  assert.equal(check('user-a'), false);
  assert.equal(check(undefined, 'session-a'), false);
  assert.equal(check('user-a', undefined, true), true);
  assert.equal(check('user-a,user-b', 'session-a'), false);
  assert.equal(check('user-a', 'session-a,session-b'), false);
});
