import { Prisma } from '@prisma/client';
import { parseCanonicalProductGraph, type CanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import {
  CaseDraftIntentSchema, PaymentPlanSchema, canonicalHash, partnerError,
  type ApprovedInquiry, type PartnerCommand, type Result,
} from '@sabalanerp/partner-sales-contracts';

export type DisplayParty = { displayName: string; phone: string; address: string };
export type ResolvedCaseDraft = {
  profileId: string; partnerSellerId: string; customerId: string; projectId?: string;
  commercialAccountId: string; departmentId: string; sabalanTermsVersionId: string;
  graph: CanonicalProductGraph;
  rows: Array<{ productRowId: string; configurationHash: string; quantity: string; unit: string;
    precisionPolicyVersion: string; description: string }>;
  partner: DisplayParty; customer: DisplayParty; legalText: string;
  sabalanPaymentPlan: ReturnType<typeof PaymentPlanSchema.parse>;
};
export type ApprovedCaseRow = ResolvedCaseDraft['rows'][number] & {
  retailUnitPrice: { amount: string; currency: 'IRR' | 'IRT' }; approval: ApprovedInquiry;
};

const decimal = (value: string) => new Prisma.Decimal(value);
const sum = (values: string[]) => values.reduce((total, value) => total.add(value), new Prisma.Decimal(0));
const text = (value: Prisma.Decimal) => value.toString();

export async function validateResolvedDraft(command: Extract<PartnerCommand, { type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE' }>,
  resolved: ResolvedCaseDraft): Promise<Result<{ graph: CanonicalProductGraph; graphHash: string }>> {
  const parsed = CaseDraftIntentSchema.safeParse(command.intent);
  if (!parsed.success || resolved.partnerSellerId !== command.idempotency.actorId || resolved.customerId !== command.intent.customerId ||
      resolved.sabalanTermsVersionId !== command.intent.sabalanTermsVersionId || resolved.projectId !== command.intent.projectId) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  }
  let graph: CanonicalProductGraph;
  try { graph = parseCanonicalProductGraph(resolved.graph); }
  catch { return { ok: false, error: partnerError('INTEGRITY_CONFLICT') }; }
  const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph });
  const graphIds = graph.rows.map(row => row.productRowId);
  const savedIds = resolved.rows.map(row => row.productRowId);
  const intentIds = command.intent.rows.map(row => row.productRowId);
  const exact = (left: string[], right: string[]) => left.length === right.length &&
    new Set(left).size === left.length && left.every(id => right.includes(id));
  if (graphHash !== command.intent.graphHash || !exact(graphIds, savedIds) || !exact(graphIds, intentIds) ||
      resolved.rows.some(row => !graph.rows.some(graphRow => graphRow.productRowId === row.productRowId))) {
    return { ok: false, error: partnerError('CONFIG_MISMATCH') };
  }
  return { ok: true, value: { graph, graphHash } };
}

export function buildRevisionEvidence(input: { command: Extract<PartnerCommand, { type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE' }>;
  resolved: ResolvedCaseDraft; graph: CanonicalProductGraph; graphHash: string; rows: ApprovedCaseRow[] }) {
  const currency = input.rows[0]?.approval.wholesaleUnitPrice.currency;
  if (!currency || input.rows.some(row => row.retailUnitPrice.currency !== currency || row.approval.wholesaleUnitPrice.currency !== currency)) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
  }
  const products = input.rows.map(row => ({ productRowId: row.productRowId, description: row.description,
    quantity: row.quantity, unit: row.unit, wholesaleUnitPrice: row.approval.wholesaleUnitPrice.amount,
    retailUnitPrice: row.retailUnitPrice.amount, approvalEvidenceId: row.approval.approvalId,
    configurationHash: row.configurationHash }));
  const retailNet = sum(input.rows.map(row => decimal(row.quantity).mul(row.retailUnitPrice.amount).toString()));
  const wholesaleNet = sum(input.rows.map(row => decimal(row.quantity).mul(row.approval.wholesaleUnitPrice.amount).toString()));
  const discount = decimal(input.command.intent.retailDiscount.amount);
  if (input.command.intent.retailDiscount.currency !== currency || discount.greaterThan(retailNet)) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
  }
  const retailPayable = retailNet.sub(discount);
  const planTotal = sum(input.command.intent.customerPaymentPlan.installments.map(item => item.amount.amount));
  const sabalanPlanTotal = sum(input.resolved.sabalanPaymentPlan.installments.map(item => item.amount.amount));
  if (input.command.intent.customerPaymentPlan.installments.some(item => item.amount.currency !== currency) ||
      input.resolved.sabalanPaymentPlan.installments.some(item => item.amount.currency !== currency) ||
      !planTotal.equals(retailPayable) || !sabalanPlanTotal.equals(wholesaleNet)) {
    return { ok: false, error: partnerError('INTEGRITY_CONFLICT') } as const;
  }
  const quantities = new Map(input.rows.map(row => [row.productRowId, decimal(row.quantity)]));
  const delivered = new Map<string, Prisma.Decimal>();
  for (const delivery of input.command.intent.deliveries) for (const item of delivery.items) {
    if (!quantities.has(item.productRowId)) return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
    delivered.set(item.productRowId, (delivered.get(item.productRowId) ?? decimal('0')).add(item.quantity));
  }
  if ([...delivered].some(([id, quantity]) => quantity.greaterThan(quantities.get(id)!))) {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') } as const;
  }
  const totals = (net: Prisma.Decimal, reduction: Prisma.Decimal) => ({ net: text(net), discount: text(reduction),
    tax: '0', charges: '0', payable: text(net.sub(reduction)), currency });
  return { ok: true, value: {
    graph: input.graph, graphHash: input.graphHash,
    partySnapshots: { partner: input.resolved.partner, customer: input.resolved.customer },
    wholesaleEnvelope: { schemaVersion: 1, products: products.map(({ retailUnitPrice: _retail, ...row }) => row),
      totals: totals(wholesaleNet, decimal('0')), termsVersionId: input.resolved.sabalanTermsVersionId },
    retailEnvelope: { schemaVersion: 1, products: products.map(({ wholesaleUnitPrice: _wholesale, approvalEvidenceId: _approval,
      configurationHash: _configuration, ...row }) => row), totals: totals(retailNet, discount),
      belowCostConfirmed: input.command.intent.belowCostConfirmed },
    paymentEvidence: { customerPaymentPlan: input.command.intent.customerPaymentPlan,
      sabalanPaymentPlan: input.resolved.sabalanPaymentPlan },
    customerContent: { contractDate: input.command.intent.contractDate, legalText: input.resolved.legalText,
      ...(input.resolved.projectId ? { projectId: input.resolved.projectId } : {}),
      deliveries: input.command.intent.deliveries, confirmation: 'NOT_SENT', signatures: [] },
    products,
    resaleDifference: text(retailPayable.sub(wholesaleNet)),
  } } as const;
}
