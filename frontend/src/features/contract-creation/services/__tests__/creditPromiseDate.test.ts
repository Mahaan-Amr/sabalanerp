import assert from 'node:assert/strict';
import test from 'node:test';
import { creditPromiseDate } from '../creditPromiseDate';
test('Tehran promise dates preserve their calendar day during submission', () => {
  assert.equal(creditPromiseDate('1405/07/11'), '2026-10-03');
  assert.equal(creditPromiseDate('2026-10-03T00:00:00.000Z'), '2026-10-03');
  assert.equal(creditPromiseDate(''), undefined);
});
