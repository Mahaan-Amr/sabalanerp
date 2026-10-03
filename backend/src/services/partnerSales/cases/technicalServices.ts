import { Prisma } from '@prisma/client';
import { canonicalHash, partnerError, type PartnerTechnicalDraft, type Result } from '@sabalanerp/partner-sales-contracts';
export interface ResolvedTechnicalService {
  serviceRowId: string; sourceType: 'tool' | 'cutting' | 'finishing'; catalogItemId: string;
  catalogSnapshotVersion: string; title: string; description?: string; unit: 'meter' | 'squareMeter' | 'count';
  quantity: string; retailUnitPrice: { amount: string; currency: 'IRT' }; wholesaleUnitPriceAmount: string;
  rateEvidenceId: string;
}
/** Resolve independent services under the recovery transaction. No inquiry or
 * graph stone identity is manufactured for a catalog service. */
export async function resolvePartnerTechnicalServices(tx: Prisma.TransactionClient, draft: PartnerTechnicalDraft): Promise<Result<ResolvedTechnicalService[]>> {
  const rows: ResolvedTechnicalService[] = [];
  const ids = new Set(draft.rows.map(row => row.productRowId));
  for (const intent of draft.serviceRows ?? []) {
    if (ids.has(intent.serviceRowId)) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    ids.add(intent.serviceRowId);
    const source = intent.sourceType === 'tool' ? await tx.subService.findUnique({ where: { id: intent.catalogItemId } })
      : intent.sourceType === 'cutting' ? await tx.cuttingType.findUnique({ where: { id: intent.catalogItemId } })
        : await tx.stoneFinishing.findUnique({ where: { id: intent.catalogItemId } });
    if (!source || !source.isActive || source.updatedAt.toISOString() !== intent.catalogSnapshotVersion) {
      return { ok: false, error: partnerError('ROW_STALE') };
    }
    const unit = 'calculationBase' in source && source.calculationBase === 'squareMeters' ? 'squareMeter' : 'meter';
    const rate = 'unitPrice' in source ? source.unitPrice : source.pricePerMeter;
    if (!rate || rate.isNegative() || intent.unit !== unit || !intent.quantity || !intent.retailUnitPrice ||
        new Prisma.Decimal(intent.quantity).lte(0) || new Prisma.Decimal(intent.retailUnitPrice.amount).lte(0)) {
      return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    }
    const ExactDecimal = Prisma.Decimal.clone({ precision: intent.retailUnitPrice.amount.length + 4 });
    const retail = new ExactDecimal(intent.retailUnitPrice.amount).div(intent.retailUnitPrice.currency === 'IRR' ? 10 : 1).toFixed();
    const rateEvidenceId = await canonicalHash({ purpose: 'PARTNER_SERVICE_RATE', sourceType: intent.sourceType,
      catalogItemId: intent.catalogItemId, catalogSnapshotVersion: intent.catalogSnapshotVersion, unit, amount: rate.toFixed(), currency: 'IRT' });
    rows.push({ ...intent, title: intent.title.trim() || source.namePersian, quantity: intent.quantity,
      retailUnitPrice: { amount: retail, currency: 'IRT' }, wholesaleUnitPriceAmount: rate.toFixed(), rateEvidenceId });
  }
  return { ok: true, value: rows };
}
