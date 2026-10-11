import assert from 'node:assert/strict';
import test from 'node:test';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import type { PartnerDraftIntent } from './partnerCaseSubmission';
import { partnerCaseResultStep, partnerNumberedRecoveryRevision } from './partnerWizardEntry';
import { partnerWizardPersistenceKey } from './partnerWizardPersistence';

test('pricing presentation refreshes keep persistence identity, while commercial edits and revisions change it', () => {
  const intent: PartnerDraftIntent = { ...createPartnerFixtures().draftSubmissionReference,
    contractDate: '2026-10-11', preparationCompleted: false,
    rows: [{ productRowId: 'stone', retailUnitPrice: { amount: '1000', currency: 'IRT' } }],
    customerPaymentPlan: { planId: 'plan', version: 1, effectiveDate: '2026-10-11', installments: [] },
    deliveries: [], retailDiscount: { amount: '0', currency: 'IRT' }, belowCostConfirmed: false };
  const original = { step: 'pricing' as const, intent };
  const key = partnerWizardPersistenceKey(original);
  for (let poll = 0; poll < 6; poll++) assert.equal(partnerWizardPersistenceKey({ ...original,
    intent: { ...intent, rows: intent.rows.map(row => ({ ...row })) } }), key);
  assert.notEqual(partnerWizardPersistenceKey({ ...original, step: 'delivery' }), key);
  assert.notEqual(partnerWizardPersistenceKey({ ...original, intent: { ...intent, recoveryRevision: intent.recoveryRevision + 1 } }), key);
  assert.notEqual(partnerWizardPersistenceKey({ ...original, intent: { ...intent,
    rows: intent.rows.map(row => ({ ...row, retailUnitPrice: { ...row.retailUnitPrice, amount: '42' } })) } }), key);
  assert.equal(partnerWizardPersistenceKey(null), null);
});

test('numbered draft resumes the last saved step instead of resetting to pricing', () => {
  for (const step of ['date', 'customer', 'project', 'products', 'pricing', 'delivery', 'payment', 'confirmation'] as const) {
    assert.equal(partnerCaseResultStep(step, true), step);
  }
  assert.equal(partnerCaseResultStep('payment', true, true), 'date');
});

test('resume requests the retained validated revision, never the newer technical checkpoint', () => {
  const retained = { recoveryId: 'same-case', recoveryRevision: 12 };
  assert.equal(partnerNumberedRecoveryRevision(retained, 'same-case', 16), 12);
  assert.equal(partnerNumberedRecoveryRevision(retained, 'same-case', 12), 12);
  assert.throws(() => partnerNumberedRecoveryRevision(retained, 'different-case', 16));
  assert.throws(() => partnerNumberedRecoveryRevision(retained, 'same-case', 11));
  assert.deepEqual(retained, { recoveryId: 'same-case', recoveryRevision: 12 });
});
