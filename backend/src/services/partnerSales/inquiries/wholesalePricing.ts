import type { Prisma } from '@prisma/client';
import type { PartnerInquiryRowV2, WholesalePricingBreakdown } from '@sabalanerp/partner-sales-contracts';
import type { PartnerInquiryDependencies } from './service';
import { parseInquiryDefinition } from './definition';

/** Read-only quotation facts and preview. Commitment freezes the same canonical calculation;
 * no customer price, current catalog amount or new arithmetic enters this view. */
export async function previewPartnerWholesaleRows(tx: Prisma.TransactionClient, input: {
  actorId: string; profileId: string; caseId?: string; rows: PartnerInquiryRowV2[];
  resolveConfiguration: PartnerInquiryDependencies['resolveConfiguration'];
}): Promise<PartnerInquiryRowV2[]> {
  const needsPricing = input.rows.some(row => row.approvedPrice?.currency === 'IRT' && row.wholesaleMandatory);
  const sources = needsPricing ? await tx.partnerInquiryRow.findMany({ where: { inquiry: {
    profileId: input.profileId, caseId: input.caseId ?? null }, outcome: 'APPROVED', successor: { is: null } },
    orderBy: [{ approval: { approvedAt: 'desc' } }, { id: 'desc' }],
    select: { definition: true, approval: { select: { wholesaleUnitPrice: true, wholesaleMandatory: true, currency: true } } } }) : [];
  return Promise.all(input.rows.map(async row => {
    const layerQuotes = new Map<string, { catalogProductId: string; rateToman: string; mandatory?: unknown }>();
    for (const source of sources) {
      const definition = parseInquiryDefinition(source.definition);
      if (!definition || !source.approval || source.approval.currency !== 'IRT' ||
          definition.configurationRef.recoveryId !== row.configurationRef.recoveryId ||
          definition.configurationRef.recoveryRevision !== row.configurationRef.recoveryRevision ||
          !definition.configurationRef.productRowId.startsWith('layer-material:')) continue;
      if (!layerQuotes.has(definition.configurationRef.productRowId)) layerQuotes.set(definition.configurationRef.productRowId,
        { catalogProductId: definition.identity.catalogProductId, rateToman: source.approval.wholesaleUnitPrice.toString(), mandatory: source.approval.wholesaleMandatory });
    }
    const resolved = await input.resolveConfiguration(tx, { actorId: input.actorId, reference: row.configurationRef });
    let wholesalePricing: WholesalePricingBreakdown | undefined;
    const configuration = resolved.ok ? [...row.configuration.filter(fact => !['سنگ اصلی', 'متراژ سنگ مصرفی اصلی', 'تعداد'].includes(fact.label)),
      ...resolved.value.configuration.filter(fact => ['سنگ اصلی', 'متراژ سنگ مصرفی اصلی', 'تعداد'].includes(fact.label))] : row.configuration;
    if (row.approvedPrice?.currency === 'IRT' && row.wholesaleMandatory && resolved.ok && resolved.value.quoteWholesale) {
      try { wholesalePricing = resolved.value.quoteWholesale(row.approvedPrice.amount, row.wholesaleMandatory, layerQuotes); }
      catch { /* Partial pricing cannot present an estimated purchase total. */ }
    }
    return { ...row, configuration, ...(wholesalePricing ? { wholesalePricing } : {}) };
  }));
}
