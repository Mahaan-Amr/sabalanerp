import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CustomerPaymentPlanSchema, PartnerWholesaleQuoteSchema, SabalanPaymentPlanSetSchema } from '../src';

const valid = {
  expected: { caseId: 'case-1', revision: 1, integrityHash: `sha256-v1:${'a'.repeat(64)}` },
  idempotencyKey: 'plan-command-1',
  plan: { effectiveDate: '2026-09-14', installments: [{ installmentId: 'installment-1',
    dueDate: '2026-10-14', amount: { amount: '1200000', currency: 'IRT' as const }, method: 'BANK_TRANSFER' as const }] },
};

test('Accounting supplies only mutable Sabalan payment terms, never case-owned plan identity', () => {
  assert.equal(SabalanPaymentPlanSetSchema.safeParse(valid).success, true);
  assert.equal(SabalanPaymentPlanSetSchema.safeParse({ ...valid, plan: { ...valid.plan, planId: 'caller-owned' } }).success, false);
});

test('check installments preserve their required instrument evidence', () => {
  const withoutEvidence = { ...valid, plan: { ...valid.plan, installments: [{ ...valid.plan.installments[0], method: 'CHECK' }] } };
  assert.equal(SabalanPaymentPlanSetSchema.safeParse(withoutEvidence).success, false);
  assert.equal(SabalanPaymentPlanSetSchema.safeParse({ ...withoutEvidence, plan: { ...withoutEvidence.plan,
    installments: [{ ...withoutEvidence.plan.installments[0], check: { number: '123', bank: 'ملت', dueDate: '2026-10-14' } }] } }).success, true);
});

test('customer check plan keeps ordinary optional number and bank without weakening Sabalan evidence', () => {
  const customerPlan = { planId: 'customer-plan', version: 1, effectiveDate: '2026-09-14',
    installments: [{ installmentId: 'customer-check', dueDate: '2026-10-14',
      amount: { amount: '1200000', currency: 'IRT' as const }, method: 'CHECK' as const,
      check: { number: '', bank: '', dueDate: '2026-10-14', ownerName: 'علی رضایی', handoverDate: '2026-09-20' } }] };
  assert.equal(CustomerPaymentPlanSchema.safeParse(customerPlan).success, true);
  assert.equal(SabalanPaymentPlanSetSchema.safeParse({ ...valid, plan: { ...valid.plan,
    installments: customerPlan.installments } }).success, false);
});

test('partner wholesale quote exposes only canonical per-row purchase amounts', () => {
  const quote = PartnerWholesaleQuoteSchema.parse({ schemaVersion: 1, recoveryId: 'recovery-1', recoveryRevision: 2,
    graphHash: `sha256-v1:${'a'.repeat(64)}`, rows: [{ productRowId: 'row-1',
      wholesaleUnitPrice: { amount: '12345.67', currency: 'IRT' } }] });
  assert.equal(quote.rows[0].wholesaleUnitPrice.amount, '12345.67');
  assert.equal('catalogRate' in quote.rows[0], false);
});
