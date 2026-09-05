import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { SabalanInternalRecordViewSchema, FulfillmentViewSchema, PartnerCaseViewSchema } from '../src';

const ref = { caseId: 'case-313', revision: 1, integrityHash: 'sha256-v1:' + 'a'.repeat(64) };
const plan = { planId: 'plan-313', version: 1, effectiveDate: '2026-08-27', installments: [] };
const totals = { net: '2000', discount: '0', tax: '0', charges: '0', payable: '2000', currency: 'IRR' };
const product = { productRowId: 'row-313', description: 'سنگ', quantity: '2.000', unit: 'm' };
test('Accounting, fulfillment and Partner views keep independent financial purposes', () => {
  const internal = { schemaVersion: 1, purpose: 'ACCOUNTING', sourceKind: 'SABALAN_TO_PARTNER', owner: ref,
    recordId: 'internal-313', recordNumber: 'INT-313', caseNumber: 'CASE-313', customerContractNumber: 'C-313',
    commercialAccountId: 'account-313', debtor: { displayName: 'همکار', phone: '09120000000', address: 'تهران' },
    products: [{ ...product, wholesaleUnitPrice: '1000', approvalEvidenceId: 'approval-313' }], totals, sabalanPaymentPlan: plan, state: 'COMMITTED' };
  assert.equal(SabalanInternalRecordViewSchema.safeParse(internal).success, true);
  assert.equal(SabalanInternalRecordViewSchema.safeParse({ ...internal, retailTotal: '3000' }).success, false);
  assert.equal(FulfillmentViewSchema.safeParse({ schemaVersion: 1, purpose: 'FULFILLMENT', sourceKind: 'SABALAN_TO_PARTNER',
    owner: ref, recordId: 'internal-313', mode: 'DIRECT_TO_CUSTOMER', products: [product], deliveries: [] }).success, true);
  const partner = { schemaVersion: 1, purpose: 'PARTNER_CASE', owner: ref, caseNumber: 'CASE-313', customerContractNumber: 'C-313',
    state: 'DRAFT', products: [{ ...product, wholesaleUnitPrice: '1000', retailUnitPrice: '1000' }],
    retailTotals: totals, sabalanTotals: totals, resaleDifference: '0', customerPaymentPlan: plan, sabalanPaymentPlan: plan, deliveries: [] };
  assert.equal(PartnerCaseViewSchema.safeParse(partner).success, true);
  assert.equal(PartnerCaseViewSchema.safeParse({ ...partner, internalRecordNumber: 'INT-313' }).success, false);
});
