import assert from 'node:assert/strict';
import test from 'node:test';
import { isSupportedHiringInvitationTemplate, resolveHiringInvitationTemplate } from '../hiringSmsTemplate';

test('approved and explicit previous configuration both send only the approved invitation template', () => {
  for (const value of ['343360', '343660']) {
    assert.equal(isSupportedHiringInvitationTemplate(value), true);
    assert.equal(resolveHiringInvitationTemplate(value), 343660);
  }
  assert.equal(resolveHiringInvitationTemplate(), 343660);
});

test('unknown template configuration fails closed without permissive numeric parsing', () => {
  for (const value of ['', '343660x', '343360 ', '12345']) {
    assert.equal(isSupportedHiringInvitationTemplate(value), false);
    if (value) assert.throws(() => resolveHiringInvitationTemplate(value), /Unsupported/);
  }
});
