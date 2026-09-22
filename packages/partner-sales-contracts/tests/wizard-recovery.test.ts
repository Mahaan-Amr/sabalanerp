import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { PartnerWizardRecoverySaveSchema, PartnerWizardRecoverySnapshotSchema } from '../src';
import { createPartnerFixtures } from '../src/testing';

function intent() {
  const fixture = createPartnerFixtures();
  const binding = fixture.inquiry.rows[0].approvedRowBinding;
  assert.ok(binding);
  return {
    ...fixture.draftSubmissionReference,
    contractDate: fixture.customer.contractDate,
    rows: [{ productRowId: fixture.partner.products[0].productRowId,
      approvedRowBinding: binding, retailUnitPrice: { amount: '1000', currency: 'IRR' as const } }],
    customerPaymentPlan: fixture.partner.customerPaymentPlan,
    retailDiscount: { amount: '0', currency: 'IRR' as const },
    belowCostConfirmed: false,
    deliveries: fixture.partner.deliveries,
  };
}

test('wizard recovery persists the seven-step intent with optimistic revision', () => {
  const value = { schemaVersion: 1 as const, expectedWizardRevision: 0,
    editLease: { recoveryId: intent().recoveryId, browserSessionId: 'browser-1', leaseToken: 'lease-1', baseRevision: 0 },
    step: 'products' as const, intent: intent() };
  assert.equal(PartnerWizardRecoverySaveSchema.safeParse(value).success, true);
  const snapshot = { schemaVersion: 1 as const, wizardRevision: 1, step: value.step,
    intent: value.intent, updatedAt: new Date().toISOString() };
  assert.equal(PartnerWizardRecoverySnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(PartnerWizardRecoverySaveSchema.safeParse({ ...value, step: 'unknown' }).success, false);
  assert.equal(PartnerWizardRecoverySaveSchema.safeParse({ ...value, editLease: undefined }).success, false);
  assert.equal(PartnerWizardRecoverySaveSchema.safeParse({ ...value, unexpected: true }).success, false);
  assert.equal(PartnerWizardRecoverySnapshotSchema.safeParse({ ...snapshot, wizardRevision: 0 }).success, false);
});

test('wizard recovery persists the Case-scoped pricing gate between products and delivery', () => {
  const value = { schemaVersion: 1 as const, expectedWizardRevision: 1,
    editLease: { recoveryId: intent().recoveryId, browserSessionId: 'browser-1', leaseToken: 'lease-1', baseRevision: 0 },
    step: 'pricing' as const, intent: intent() };
  assert.equal(PartnerWizardRecoverySaveSchema.safeParse(value).success, true);
  assert.equal(PartnerWizardRecoverySnapshotSchema.safeParse({ schemaVersion: 1, wizardRevision: 2,
    step: value.step, intent: value.intent, updatedAt: new Date().toISOString() }).success, true);
});
