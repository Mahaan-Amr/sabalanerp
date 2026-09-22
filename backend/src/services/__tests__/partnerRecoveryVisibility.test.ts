import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldExposePartnerRecovery } from '../partnerSales/cases/recoveryVisibility';

test('a recovery bound to a cancelled Case is not exposed as a fresh Partner draft', () => {
  assert.equal(shouldExposePartnerRecovery('cancelled-case', new Set()), false);
});

test('an unbound recovery and a recovery bound to an editable owned Case remain visible', () => {
  const editable = new Set(['editable-case']);
  assert.equal(shouldExposePartnerRecovery(undefined, editable), true);
  assert.equal(shouldExposePartnerRecovery('editable-case', editable), true);
});
