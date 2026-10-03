import { parseCanonicalProductGraph, projectCanonicalProductGraph, type CanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import {
  CaseDraftIntentSchema, PaymentPlanSchema, canonicalHash, partnerError, roundPartnerContractTotals,
  type ApprovedInquiry, type PartnerCommand, type PartnerTechnicalSavedView, type Result,
} from '@sabalanerp/partner-sales-contracts';
import { technicalGraphMeasures } from './technicalGraphMeasures';
import { multiply, subtract, sum } from '../reporting/money';

import type { ResolvedTechnicalService } from './technicalServices';

export type DisplayParty = { displayName: string; phone: string; address: string };
export type ResolvedCaseDraft = {
  profileId: string; partnerSellerId: string; customerId: string; projectId?: string;
  commercialAccountId: string; departmentId: string; sabalanTermsVersionId: string;
  graph: CanonicalProductGraph;
  serviceRows?: ResolvedTechnicalService[];
  technicalSnapshot: PartnerTechnicalSavedView;
  rows: Array<{ productRowId: string; configurationHash: string; quantity: string; unit: string;
    precisionPolicyVersion: string; description: string; productCode?: string; retailUnitPriceAmount: string;
    wholesaleUnitPriceAmount?: string; retailLineTotalAmount?: string; wholesaleLineTotalAmount?: string }>;
  partner: DisplayParty; customer: Omit<DisplayParty, 'address'> & { address?: string }; project?: { title: string; address?: string }; legalText: string;
  sabalanPaymentPlan: ReturnType<typeof PaymentPlanSchema.parse>;
  additionalMaterialApprovals?: Array<{ pricingSubjectId: string; configurationHash: string;
    catalogProductId: string; wholesaleUnitPriceAmount: string }>;
};
export type ApprovedCaseRow = ResolvedCaseDraft['rows'][number] & {
  retailUnitPrice: { amount: string; currency: 'IRR' | 'IRT' }; approval?: ApprovedInquiry; frozen?: boolean;
};

export async function validateResolvedDraft(command: Extract<PartnerCommand, { type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE' }>,
  resolved: ResolvedCaseDraft): Promise<Result<{ graph: CanonicalProductGraph; graphHash: string }>> {
  const parsed = CaseDraftIntentSchema.safeParse(command.intent);
  if (!parsed.success || resolved.partnerSellerId !== command.idempotency.actorId || resolved.customerId !== command.intent.customerId ||
      resolved.projectId !== command.intent.projectId) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  let graph: CanonicalProductGraph;
  try { graph = parseCanonicalProductGraph(resolved.graph); }
  catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
  const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph });
  let measures: ReturnType<typeof technicalGraphMeasures>;
  try { measures = technicalGraphMeasures(graph); }
  catch { return { ok: false, error: partnerError('CONFIG_MISMATCH') }; }
  const graphIds = graph.rows.map(row => row.productRowId);
  const savedIds = resolved.rows.map(row => row.productRowId);
  const intentIds = command.intent.rows.map(row => row.productRowId);
  const exact = (left: string[], right: string[]) => left.length === right.length &&
    new Set(left).size === left.length && left.every(id => right.includes(id));
  const snapshot = resolved.technicalSnapshot;
  const services = resolved.serviceRows ?? [];
  if (!exact(services.map(row => row.serviceRowId), command.intent.serviceRows?.map(row => row.serviceRowId) ?? []) ||
      !exact(services.map(row => row.serviceRowId), snapshot.serviceRows?.map(row => row.serviceRowId) ?? []) ||
      services.some(row => !snapshot.serviceRows?.some(saved => saved.serviceRowId === row.serviceRowId && saved.quantity === row.quantity && saved.unit === row.unit))) return { ok: false, error: partnerError('CONFIG_MISMATCH') };
  if (graphHash !== command.intent.graphHash || snapshot.graphHash !== graphHash ||
      snapshot.recoveryId !== command.intent.recoveryId || snapshot.recoveryRevision !== command.intent.recoveryRevision ||
      !exact(graphIds, savedIds) || !exact(graphIds, intentIds) || !exact(graphIds,
        snapshot.rows.map(row => row.configurationRef.productRowId)) || resolved.rows.some(row => {
        const measure = measures.find(item => item.productRowId === row.productRowId);
        const technical = snapshot.rows.find(item => item.configurationRef.productRowId === row.productRowId);
        return !measure || !technical || measure.quantity !== row.quantity || measure.unit !== row.unit ||
          technical.quantity !== row.quantity || technical.unit !== row.unit ||
          technical.configurationRef.recoveryId !== snapshot.recoveryId ||
          technical.configurationRef.recoveryRevision !== snapshot.recoveryRevision;
      })) {
    return { ok: false, error: partnerError('CONFIG_MISMATCH') };
  }
  return { ok: true, value: { graph, graphHash } };
}

export function buildRevisionEvidence(input: { command: Extract<PartnerCommand, { type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE' }>;
  resolved: ResolvedCaseDraft; graph: CanonicalProductGraph; graphHash: string; rows: ApprovedCaseRow[] }) {
  const services = input.resolved.serviceRows ?? [];
  const currency = input.rows[0]?.retailUnitPrice.currency ?? services[0]?.retailUnitPrice.currency;
  const pricingReady = (input.rows.length + services.length) > 0 && input.rows.every(row => row.approval && row.wholesaleUnitPriceAmount !== undefined);
  if (!currency || input.rows.some(row => row.retailUnitPrice.currency !== currency ||
      (row.approval && row.approval.wholesaleUnitPrice.currency !== currency))) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
  }
  const graphProducts = new Map(projectCanonicalProductGraph(input.graph, 'pdf').products.map(row => [row.productRowId, row]));
  const products = input.rows.map(row => { const graph = graphProducts.get(row.productRowId); return ({ productRowId: row.productRowId, description: row.description,
    quantity: row.quantity, unit: row.unit, ...(row.wholesaleUnitPriceAmount !== undefined
      ? { wholesaleUnitPrice: row.wholesaleUnitPriceAmount } : {}),
    ...(row.wholesaleLineTotalAmount !== undefined ? { wholesaleLineTotal: row.wholesaleLineTotalAmount } : {}),
    retailUnitPrice: row.retailUnitPrice.amount, ...(row.approval ? { approvalEvidenceId: row.approval.approvalId } : {}),
    configurationHash: row.configurationHash, ...(row.productCode ? { productCode: row.productCode } : {}),
    ...(graph ? { productType: graph.productType, ...(graph.lengthMeters ? { lengthMeters: graph.lengthMeters } : {}),
      ...(graph.widthMeters ? { widthMeters: graph.widthMeters } : {}),
      ...(graph.areaSquareMeters ? { areaSquareMeters: graph.areaSquareMeters } : {}),
      ...(graph.quantity ? { count: graph.quantity } : {}) } : {}),
    retailLineTotal: row.retailLineTotalAmount ?? multiply(row.quantity, row.retailUnitPrice.amount) }); });
  for (const service of services) products.push({ productRowId: service.serviceRowId, description: service.title,
    quantity: service.quantity, unit: service.unit, productType: 'service', retailUnitPrice: service.retailUnitPrice.amount,
    wholesaleUnitPrice: service.wholesaleUnitPriceAmount, retailLineTotal: multiply(service.quantity, service.retailUnitPrice.amount),
    wholesaleLineTotal: multiply(service.quantity, service.wholesaleUnitPriceAmount), configurationHash: service.rateEvidenceId });
  // Effective unit rates can repeat; source totals are the server's exact row evidence.
  const retailNet = sum(products.map(row => row.retailLineTotal));
  const wholesaleNet = pricingReady
    ? sum(products.map(row => row.wholesaleLineTotal ?? multiply(row.quantity, row.wholesaleUnitPrice!))) : undefined;
  const discount = input.command.intent.retailDiscount.amount;
  if (input.command.intent.retailDiscount.currency !== currency || subtract(retailNet, discount).startsWith('-')) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
  }
  const retailTotals = roundPartnerContractTotals({ net: retailNet, discount: sum([discount]), tax: '0', charges: '0', currency });
  const wholesaleTotals = pricingReady
    ? roundPartnerContractTotals({ net: wholesaleNet!, discount: '0', tax: '0', charges: '0', currency }) : undefined;
  const retailPayable = retailTotals.payable;
  const planTotal = sum(input.command.intent.customerPaymentPlan.installments.map(item => item.amount.amount));
  const sabalanPlanTotal = sum(input.resolved.sabalanPaymentPlan.installments.map(item => item.amount.amount));
  if (input.command.intent.customerPaymentPlan.installments.some(item => item.amount.currency !== currency) ||
      (input.command.intent.preparationCompleted !== false && planTotal !== retailPayable)) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
  }
  if (input.resolved.sabalanPaymentPlan.installments.some(item => item.amount.currency !== currency) ||
      (pricingReady && input.resolved.sabalanPaymentPlan.installments.length > 0 && sabalanPlanTotal !== wholesaleTotals!.payable)) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
  }
  // Product revisions may retain obsolete allocations for the seller to repair.
  // Inquiry submission does not assert that preparation is complete; completed
  // drafts still require exact row identities and quantities before confirmation.
  if (input.command.intent.preparationCompleted !== false) {
    const quantities = new Map(input.rows.map(row => [row.productRowId, row.quantity]));
    const delivered = new Map<string, string>();
    for (const delivery of input.command.intent.deliveries) for (const item of delivery.items) {
      if (!quantities.has(item.productRowId)) return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
      delivered.set(item.productRowId, sum([delivered.get(item.productRowId) ?? '0', item.quantity]));
    }
    const serviceQuantities = new Map(services.map(row => [row.serviceRowId, row.quantity]));
    const scheduledServices = new Map<string, string>();
    for (const delivery of input.command.intent.deliveries) {
      const entries = delivery.serviceItems ?? [];
      if (new Set(entries.map(item => item.serviceRowId)).size !== entries.length) return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
      for (const item of entries) {
        if (!serviceQuantities.has(item.serviceRowId) || !/[1-9]/.test(item.quantity)) return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
        scheduledServices.set(item.serviceRowId, sum([scheduledServices.get(item.serviceRowId) ?? '0', item.quantity]));
      }
    }
    if ([...scheduledServices].some(([id, quantity]) => subtract(serviceQuantities.get(id)!, quantity).startsWith('-')) ||
        services.some(row => subtract(row.quantity, scheduledServices.get(row.serviceRowId) ?? '0') !== '0')) return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
    if ([...delivered].some(([id, quantity]) => subtract(quantities.get(id)!, quantity).startsWith('-')) ||
        input.rows.some(row => subtract(row.quantity, delivered.get(row.productRowId) ?? '0') !== '0')) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
    }
  }
  return { ok: true, value: {
    graph: input.graph, graphHash: input.graphHash,
    partySnapshots: { partner: input.resolved.partner, customer: input.resolved.customer },
    pricingState: pricingReady ? 'READY_TO_FINALIZE' as const : 'AWAITING_INQUIRY' as const,
    wholesaleEnvelope: pricingReady ? { schemaVersion: 1, status: 'PRICED' as const,
      products: products.map(({ retailUnitPrice: _retail, ...row }) => row),
      totals: wholesaleTotals!, termsVersionId: input.resolved.sabalanTermsVersionId }
      : { schemaVersion: 1, status: 'UNPRICED' as const, products: [] },
    retailEnvelope: { schemaVersion: 1, products: products.map(({ wholesaleUnitPrice: _wholesale, wholesaleLineTotal: _wholesaleTotal, approvalEvidenceId: _approval,
      configurationHash: _configuration, ...row }) => row), totals: retailTotals,
      belowCostConfirmed: input.command.intent.belowCostConfirmed,
      ...(input.command.intent.preparationCompleted !== undefined
        ? { preparationCompleted: input.command.intent.preparationCompleted } : {}) },
    paymentEvidence: { customerPaymentPlan: input.command.intent.customerPaymentPlan,
      ...(pricingReady ? { sabalanPaymentPlan: input.resolved.sabalanPaymentPlan } : {}) },
    customerContent: { contractDate: input.command.intent.contractDate, legalText: input.resolved.legalText,
      ...(input.resolved.projectId ? { projectId: input.resolved.projectId } : {}),
      ...(input.resolved.project ? { project: input.resolved.project } : {}),
      deliveries: input.command.intent.deliveries, confirmation: 'NOT_SENT', signatures: [] },
    products,
    ...(pricingReady ? { resaleDifference: subtract(retailPayable, wholesaleTotals!.payable) } : {}),
  } } as const;
}
