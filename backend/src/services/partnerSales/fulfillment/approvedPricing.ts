import { Prisma } from '@prisma/client';
import { PartnerEventSchema, canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { latestPartnerFinancialApproval, readPartnerOfficialPurchase } from '../accounting/officialPurchase';
import { multiply, sum } from '../reporting/money';
import type { PartnerLoadingSource } from './repository';
import type { LockedPartnerApprovedPricingVersion } from '../../pricedAllocationLedger';

const jsonObject = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const fixedMoney = (value: string) => {
  const [whole, fraction = ''] = value.split('.');
  if (whole.length > 26 || fraction.length > 12) throw new Error('Partner approved price exceeds the shipment money storage boundary.');
  return `${whole}.${fraction.padEnd(12, '0')}`;
};
export class PartnerShipmentPricingConflictError extends Error {}
function requirePricing(condition: unknown, message: string): asserts condition {
  if (!condition) throw new PartnerShipmentPricingConflictError(message);
}

/** Resolves the published whole internal sale approval. No retail contract,
 * item, or mutable catalog row participates in wholesale shipment pricing. */
export async function readPartnerApprovedShipmentPricing(tx: Prisma.TransactionClient, source: PartnerLoadingSource):
Promise<LockedPartnerApprovedPricingVersion & { preparationEvidenceHash: string }> {
  const events = await tx.partnerCaseEvent.findMany({ where: { caseId: source.owner.caseId },
    orderBy: [{ sequence: 'asc' }, { id: 'asc' }], select: { evidence: true } });
  const published = events.flatMap(row => {
    const parsed = PartnerEventSchema.safeParse(jsonObject(row.evidence)?.publicEvent);
    return parsed.success ? [parsed.data] : [];
  });
  const approval = latestPartnerFinancialApproval(published);
  const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
  const purchase = await readPartnerOfficialPurchase(tx, { internalRecordId: source.internalRecordId,
    approval, cutoff: now, asOf: now, voided: false });
  requirePricing(approval, 'تأیید مالی رسمی سند فروش عمده برای نهایی‌سازی بارگیری لازم است.');
  requirePricing(purchase.covered && purchase.official, 'تأیید مالی رسمی سند فروش عمده برای نهایی‌سازی بارگیری لازم است.');
  const official = purchase.official;
  const approved = approval;
  requirePricing(official.invoice.status === 'ISSUED', 'تأیید مالی رسمی سند فروش عمده برای نهایی‌سازی بارگیری لازم است.');
  const preparation = official.invoice.preparation;
  if (preparation.owner.caseId !== source.owner.caseId || preparation.internalRecordId !== source.internalRecordId ||
      preparation.products.length !== new Set(preparation.products.map(row => row.productRowId)).size) {
    throw new PartnerShipmentPricingConflictError('شواهد قیمت مصوب فروش عمده با منبع بارگیری همخوان نیست.');
  }
  for (const row of source.rows) {
    const priced = preparation.products.find(product => product.productRowId === row.productRowId);
    requirePricing(priced && priced.unit === row.unit, 'ردیف تحویل در سند فروش عمده مصوب وجود ندارد.');
  }
  const rows = await Promise.all(preparation.products.map(async (row, ordinal) => {
    const total = fixedMoney(multiply(row.quantity, row.wholesaleUnitPrice));
    return { id: row.approvalEvidenceId, productRowId: row.productRowId, ordinal,
      contractedQuantity: new Prisma.Decimal(row.quantity).toFixed(3), unit: row.unit,
      canonicalAllInTotal: total, discountEligible: false, componentEvidence: {
        wholesaleUnitPrice: row.wholesaleUnitPrice, approvalEvidenceId: row.approvalEvidenceId,
        financialApprovalEvidenceId: approved.financialApprovalEvidenceId }, integrityHash: await canonicalHash({
          schemaVersion: 1, sourceKind: 'PARTNER_CASE', owner: preparation.owner,
          productRowId: row.productRowId, quantity: row.quantity, unit: row.unit,
          wholesaleUnitPrice: row.wholesaleUnitPrice, approvalEvidenceId: row.approvalEvidenceId,
          financialApprovalEvidenceId: approved.financialApprovalEvidenceId }) };
  }));
  const gross = fixedMoney(sum(rows.map(row => row.canonicalAllInTotal)));
  if (gross !== fixedMoney(preparation.totals.net) || preparation.totals.discount !== '0') {
    throw new PartnerShipmentPricingConflictError('جمع ردیف‌های قیمت مصوب با سند مالی همخوان نیست.');
  }
  const readinessEvidenceHash = await canonicalHash({ schemaVersion: 1, purpose: 'PARTNER_SHIPMENT_PRICING_READY',
    owner: preparation.owner, internalRecordId: preparation.internalRecordId,
    invoiceRecordId: official.invoice.invoiceRecordId,
    financialApprovalEvidenceId: approved.financialApprovalEvidenceId,
    preparationEvidenceHash: preparation.evidenceHash });
  const base = { sourceKind: 'PARTNER_CASE' as const, caseId: source.owner.caseId, internalRecordId: source.internalRecordId,
    id: approved.financialApprovalEvidenceId, versionNumber: preparation.owner.revision,
    sourceFinancialRecordId: official.invoice.invoiceRecordId, approvedAt: approved.recordedAt,
    approvedBy: approved.actorId, schemaVersion: 1, currency: preparation.amount.currency,
    grossAmount: gross, discountAmount: '0.000000000000', netAmount: gross, readinessEvidenceHash, rows };
  const { readinessEvidenceHash: _readiness, ...hashable } = base;
  return { ...base, preparationEvidenceHash: preparation.evidenceHash, integrityHash: await canonicalHash(hashable) };
}
