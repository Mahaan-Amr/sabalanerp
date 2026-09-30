import assert from 'node:assert/strict';
import test from 'node:test';
import { confirmationResendCooldownError } from '../contractConfirmationPolicy';

test('customer resend uses the same cooldown boundary for both contract kinds', () => {
  const sent = new Date('2026-09-28T00:00:00Z');
  assert.equal(confirmationResendCooldownError(null, sent, 60), undefined);
  assert.match(confirmationResendCooldownError(sent, new Date(sent.getTime() + 59_999), 60)!, /1 ثانیه/);
  assert.equal(confirmationResendCooldownError(sent, new Date(sent.getTime() + 60_000), 60), undefined);
  assert.match(confirmationResendCooldownError(sent, new Date(sent.getTime() + 9_000), 10)!, /1 ثانیه/);
});
