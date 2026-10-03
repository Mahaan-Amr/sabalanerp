import { Prisma } from '@prisma/client';
import { roundContractPayableTotal, type CanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import type { Money, PartnerTechnicalDraft } from '@sabalanerp/partner-sales-contracts';
import { calculatePartnerCanonicalRetail } from './canonicalWholesale';

/** Same canonical customer pricing used by the Case quote, without saving a draft or submitting an inquiry. */
export function partnerCustomerGraphTotal(graph: Pick<CanonicalProductGraph, 'rows' | 'layerConfigurations'>,
  draft: PartnerTechnicalDraft, discount: Money, discountPercent?: string): Money {
  const roots = new Map(draft.rows.map(row => [row.productRowId, row]));
  let subtotal = new Prisma.Decimal(0);
  for (const row of graph.rows) {
    const source = roots.get(row.productRowId);
    if (source && !source.retailUnitPrice) throw new Error('Customer material rate required');
    const price = source?.retailUnitPrice;
    const rate = price ? new Prisma.Decimal(price.amount).div(price.currency === 'IRR' ? 10 : 1).toFixed() : '0';
    subtotal = subtotal.plus(calculatePartnerCanonicalRetail(row, rate, graph.layerConfigurations).totalAmount);
  }
  for (const service of draft.serviceRows ?? []) {
    if (!service.quantity || !service.retailUnitPrice || new Prisma.Decimal(service.quantity).lte(0) || new Prisma.Decimal(service.retailUnitPrice.amount).lte(0)) throw new Error('Service price and quantity required');
    subtotal = subtotal.plus(new Prisma.Decimal(service.quantity).mul(service.retailUnitPrice.amount).div(service.retailUnitPrice.currency === 'IRR' ? 10 : 1));
  }
  const reduction = discountPercent === undefined
    ? new Prisma.Decimal(discount.amount).div(discount.currency === 'IRR' ? 10 : 1)
    : subtotal.mul(discountPercent).div(100);
  if (reduction.isNegative() || reduction.gt(subtotal)) throw new Error('Invalid customer discount');
  return { amount: roundContractPayableTotal(subtotal.minus(reduction).toFixed(), 'IRT').roundedAmount, currency: 'IRT' };
}
