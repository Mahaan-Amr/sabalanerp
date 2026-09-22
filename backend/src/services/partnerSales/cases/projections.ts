import {
  CustomerContractOutputSchema, FulfillmentViewSchema, PartnerCaseViewSchema, SabalanInternalRecordViewSchema,
  canonicalHash, partnerError, type Result,
} from '@sabalanerp/partner-sales-contracts';
import type { buildRevisionEvidence } from './revisions';

export type CaseRevisionProjectionEvidence = Extract<ReturnType<typeof buildRevisionEvidence>, { ok: true }>['value'];

export async function buildCaseProjections(input: { caseId: string; revision: number; integrityHash: string;
  caseNumber: string; internalRecordId?: string; internalRecordNumber?: string; customerContractNumber?: string;
  commercialAccountId: string; state: 'DRAFT'; evidence: CaseRevisionProjectionEvidence }): Promise<Result<{
    partner: ReturnType<typeof PartnerCaseViewSchema.parse>;
    accounting?: ReturnType<typeof SabalanInternalRecordViewSchema.parse>;
    fulfillment?: ReturnType<typeof FulfillmentViewSchema.parse>;
    customer?: ReturnType<typeof CustomerContractOutputSchema.parse>;
  }>> {
  try {
    const owner = { caseId: input.caseId, revision: input.revision, integrityHash: input.integrityHash };
    const product = (row: CaseRevisionProjectionEvidence['products'][number]) => ({ productRowId: row.productRowId,
      description: row.description, quantity: row.quantity, unit: row.unit });
    const deliveries = input.evidence.customerContent.deliveries;
    const customerCore = input.customerContractNumber ? { schemaVersion: 1 as const, purpose: 'CUSTOMER_OUTPUT' as const,
      contractNumber: input.customerContractNumber, revision: input.revision, status: 'DRAFT' as const,
      contractDate: input.evidence.customerContent.contractDate, seller: input.evidence.partySnapshots.partner,
      customer: input.evidence.partySnapshots.customer,
      products: input.evidence.products.map(row => ({ ...product(row), retailUnitPrice: row.retailUnitPrice,
        ...(row.productCode ? { productCode: row.productCode } : {}), ...(row.productType ? { productType: row.productType } : {}),
        ...(row.lengthMeters ? { lengthMeters: row.lengthMeters } : {}), ...(row.widthMeters ? { widthMeters: row.widthMeters } : {}),
        ...(row.areaSquareMeters ? { areaSquareMeters: row.areaSquareMeters } : {}), ...(row.count ? { count: row.count } : {}),
        ...(row.retailLineTotal ? { retailLineTotal: row.retailLineTotal } : {}) })),
      ...(input.evidence.customerContent.project ? { project: input.evidence.customerContent.project } : {}),
      totals: input.evidence.retailEnvelope.totals,
      customerPaymentPlan: input.evidence.paymentEvidence.customerPaymentPlan, deliveries,
      legalText: input.evidence.customerContent.legalText, signatures: [], confirmation: 'NOT_SENT' as const } : undefined;
    const customer = customerCore ? CustomerContractOutputSchema.parse({ ...customerCore,
      outputHash: await canonicalHash({ purpose: 'PARTNER_CUSTOMER_OUTPUT', owner, content: customerCore }) }) : undefined;
    const priced = input.evidence.pricingState === 'READY_TO_FINALIZE' && input.evidence.wholesaleEnvelope.status !== 'UNPRICED';
    const linked = Boolean(input.internalRecordId && input.internalRecordNumber && input.customerContractNumber);
    const accounting = priced && linked ? SabalanInternalRecordViewSchema.parse({ schemaVersion: 1, purpose: 'ACCOUNTING',
      sourceKind: 'SABALAN_TO_PARTNER', owner, recordId: input.internalRecordId!,
      recordNumber: input.internalRecordNumber!, caseNumber: input.caseNumber,
      customerContractNumber: input.customerContractNumber!, commercialAccountId: input.commercialAccountId,
      debtor: input.evidence.partySnapshots.partner, state: input.state,
      products: input.evidence.products.map(row => ({ ...product(row), wholesaleUnitPrice: row.wholesaleUnitPrice!,
        approvalEvidenceId: row.approvalEvidenceId! })), totals: input.evidence.wholesaleEnvelope.totals,
      sabalanPaymentPlan: input.evidence.paymentEvidence.sabalanPaymentPlan! }) : undefined;
    const fulfillment = priced && linked ? FulfillmentViewSchema.parse({ schemaVersion: 1, purpose: 'FULFILLMENT',
      sourceKind: 'SABALAN_TO_PARTNER', owner, recordId: input.internalRecordId!, mode: 'DIRECT_TO_CUSTOMER',
      products: input.evidence.products.map(product), deliveries }) : undefined;
    const partner = PartnerCaseViewSchema.parse({ schemaVersion: 1, purpose: 'PARTNER_CASE', owner,
      caseNumber: input.caseNumber, ...(input.customerContractNumber
        ? { customerContractNumber: input.customerContractNumber } : {}), state: input.state,
      pricingState: input.evidence.pricingState, customerConfirmationState: 'NOT_SENT',
      products: input.evidence.products.map(row => ({ ...product(row), ...(priced
        ? { wholesaleUnitPrice: row.wholesaleUnitPrice } : {}), retailUnitPrice: row.retailUnitPrice })),
      retailTotals: input.evidence.retailEnvelope.totals,
      ...(priced ? { sabalanTotals: input.evidence.wholesaleEnvelope.totals,
        resaleDifference: input.evidence.resaleDifference } : {}),
      customerPaymentPlan: input.evidence.paymentEvidence.customerPaymentPlan,
      ...(priced ? { sabalanPaymentPlan: input.evidence.paymentEvidence.sabalanPaymentPlan } : {}), deliveries });
    return { ok: true, value: { partner, ...(accounting ? { accounting } : {}),
      ...(fulfillment ? { fulfillment } : {}), ...(customer ? { customer } : {}) } };
  } catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
}
