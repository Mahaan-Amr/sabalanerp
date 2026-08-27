import { ApprovedInquirySchema, PartnerInquiryViewSchema, ResponderInquiryViewSchema } from '../inquiry';
import { PartnerSaleCaseSchema } from '../case';
import { CustomerContractOutputSchema, FulfillmentViewSchema, PartnerAccountViewSchema, PartnerCaseViewSchema, PartnerProfileViewSchema, SabalanInternalRecordViewSchema } from '../projections';

/** Synthetic namespaced payloads. Hashes are format fixtures, not signed evidence. */
export function createPartnerFixtures() {
  const hash = 'sha256-v1:' + 'a'.repeat(64);
  const owner = { caseId: 'fixture-313-case', revision: 1, integrityHash: hash };
  const party = { displayName: 'همکار آزمایشی', phone: '09120000000', address: 'نشانی آزمایشی تهران' };
  const customer = { displayName: 'مشتری آزمایشی', phone: '09120000001', address: 'نشانی آزمایشی مشتری' };
  const product = { productRowId: 'fixture-313-row', description: 'سنگ طولی آزمایشی', quantity: '2.000', unit: 'm' };
  const retailTotals = { net: '2000', discount: '0', tax: '0', charges: '0', payable: '2000', currency: 'IRR' };
  const sabalanTotals = { net: '1600', discount: '0', tax: '0', charges: '0', payable: '1600', currency: 'IRR' };
  const customerPlan = { planId: 'fixture-313-retail-plan', version: 1, effectiveDate: '2026-08-27', installments: [
    { installmentId: 'fixture-313-retail-installment', dueDate: '2026-08-30', amount: { amount: '2000', currency: 'IRR' }, method: 'CASH' },
  ] };
  const sabalanPlan = { planId: 'fixture-313-sabalan-plan', version: 1, effectiveDate: '2026-08-27', installments: [
    { installmentId: 'fixture-313-sabalan-installment', dueDate: '2026-08-28', amount: { amount: '1600', currency: 'IRR' }, method: 'BANK_TRANSFER' },
  ] };
  const deliveries = [{ deliveryId: 'fixture-313-delivery', date: '2026-08-29', destination: customer.address,
    items: [{ productRowId: product.productRowId, quantity: '2.000' }] }];
  return {
    inquiry: PartnerInquiryViewSchema.parse({ schemaVersion: 1, purpose: 'PARTNER_INQUIRY', inquiryId: 'fixture-313-inquiry', rows: [
      { rowId: 'fixture-313-inquiry-row', revision: 1, description: product.description, state: 'APPROVED',
        configuration: [{ label: 'عرض', value: '۴۰ سانتی‌متر' }], approvedPrice: { amount: '800', currency: 'IRR' },
        approvedAt: '2026-08-27T08:00:00.000Z', expiresAt: '2026-08-29T08:00:00.000Z', usedCaseNumbers: ['FIXTURE-CASE-313'] },
    ] }),
    responder: ResponderInquiryViewSchema.parse({ schemaVersion: 1, purpose: 'RESPONDER_INQUIRY', inquiryId: 'fixture-313-inquiry',
      partnerDisplayName: party.displayName, assignmentId: 'fixture-313-assignment', assignmentRevision: 1, rows: [
        { rowId: 'fixture-313-inquiry-row', revision: 1, used: true, approvedPrice: { amount: '800', currency: 'IRR' },
          identity: { schemaVersion: 1, partnerSellerId: 'fixture-313-partner', catalogProductId: 'fixture-313-stone', family: 'longitudinal', unit: 'm',
            configuration: [{ key: 'width-cm', value: '40' }], materialRateEvidenceId: 'fixture-313-rate', materialRateHash: hash,
            components: [], currency: 'IRR', calculationPolicyVersion: 'fixture-calculation-v1', roundingPolicyVersion: 'fixture-rounding-v1' } },
      ] }),
    approval: ApprovedInquirySchema.parse({ schemaVersion: 1, approvalId: 'fixture-313-approval', inquiryId: 'fixture-313-inquiry',
      rowId: 'fixture-313-inquiry-row', revision: 1, partnerSellerId: 'fixture-313-partner', configurationHash: hash, evidenceHash: hash,
      wholesaleUnitPrice: { amount: '800', currency: 'IRR' }, approvedAt: '2026-08-27T08:00:00.000Z', expiresAt: '2026-08-29T08:00:00.000Z',
      decision: { actorId: 'fixture-313-responder', assignmentId: 'fixture-313-assignment', assignmentRevision: 1,
        authorizationEvidenceId: 'fixture-313-authorization', commandId: 'fixture-313-decision' } }),
    case: PartnerSaleCaseSchema.parse({ schemaVersion: 1, caseId: owner.caseId, caseNumber: 'FIXTURE-CASE-313',
      partnerSellerId: 'fixture-313-partner', creatorId: 'fixture-313-partner', responsibleSellerId: 'fixture-313-partner', salesCreditOwnerId: 'fixture-313-partner',
      customerId: 'fixture-313-customer', state: 'DRAFT', head: owner,
      graph: { owner, schemaVersion: 1, graphHash: hash, productRowIds: [product.productRowId] },
      internalRecord: { kind: 'SABALAN_TO_PARTNER', recordId: 'fixture-313-internal', recordNumber: 'FIXTURE-INTERNAL-313', owner, commercialAccountId: 'fixture-313-account' },
      customerContract: { kind: 'PARTNER_CUSTOMER', contractId: 'fixture-313-contract', contractNumber: 'FIXTURE-CUSTOMER-313', owner } }),
    customer: CustomerContractOutputSchema.parse({ schemaVersion: 1, purpose: 'CUSTOMER_OUTPUT', contractNumber: 'FIXTURE-CUSTOMER-313', revision: 1,
      outputHash: hash, status: 'DRAFT', contractDate: '2026-08-27', seller: party, customer,
      products: [{ ...product, retailUnitPrice: '1000' }], totals: retailTotals, customerPaymentPlan: customerPlan, deliveries,
      legalText: 'تأمین و تحویل توسط سبلان', signatures: [], confirmation: 'NOT_SENT' }),
    partner: PartnerCaseViewSchema.parse({ schemaVersion: 1, purpose: 'PARTNER_CASE', owner, caseNumber: 'FIXTURE-CASE-313', customerContractNumber: 'FIXTURE-CUSTOMER-313',
      state: 'DRAFT', products: [{ ...product, wholesaleUnitPrice: '800', retailUnitPrice: '1000' }], retailTotals, sabalanTotals,
      resaleDifference: '400', customerPaymentPlan: customerPlan, sabalanPaymentPlan: sabalanPlan, deliveries }),
    accounting: SabalanInternalRecordViewSchema.parse({ schemaVersion: 1, purpose: 'ACCOUNTING', sourceKind: 'SABALAN_TO_PARTNER', owner,
      recordId: 'fixture-313-internal', recordNumber: 'FIXTURE-INTERNAL-313', caseNumber: 'FIXTURE-CASE-313', customerContractNumber: 'FIXTURE-CUSTOMER-313',
      commercialAccountId: 'fixture-313-account', debtor: party, state: 'DRAFT',
      products: [{ ...product, wholesaleUnitPrice: '800', approvalEvidenceId: 'fixture-313-approval' }], totals: sabalanTotals, sabalanPaymentPlan: sabalanPlan }),
    fulfillment: FulfillmentViewSchema.parse({ schemaVersion: 1, purpose: 'FULFILLMENT', sourceKind: 'SABALAN_TO_PARTNER', owner,
      recordId: 'fixture-313-internal', mode: 'DIRECT_TO_CUSTOMER', products: [product], deliveries }),
    account: PartnerAccountViewSchema.parse({ schemaVersion: 1, purpose: 'PARTNER_ACCOUNT', partnerSellerId: 'fixture-313-partner', purchases: [] }),
    profile: PartnerProfileViewSchema.parse({ schemaVersion: 1, purpose: 'ONBOARDING', profileId: 'fixture-313-profile', revision: 1,
      partnerSellerId: 'fixture-313-partner', status: 'PENDING', identityVerified: false, commercialTermsReady: false,
      creditTermsReady: false, responderReady: false, conversionCleared: false, cohortReady: false }),
  };
}

/** Each negative fixture names its expected contract outcome, not production evidence. */
export function createNegativePartnerFixtures() {
  const valid = createPartnerFixtures();
  return {
    staleCaseQuery: { schemaVersion: 1 as const, purpose: 'PARTNER_CASE' as const, expected: { ...valid.case.head, revision: 2 } },
    hiddenCaseQuery: { schemaVersion: 1 as const, purpose: 'PARTNER_CASE' as const, expected: { ...valid.case.head, caseId: 'fixture-other-owner-case' } },
    forbiddenCustomerOutput: { ...valid.customer, products: [{ ...valid.customer.products[0], wholesaleUnitPrice: '800' }] },
    malformedPair: { ...valid.case, internalRecord: null },
    expiredApprovalUseAt: valid.approval.expiresAt,
  };
}
