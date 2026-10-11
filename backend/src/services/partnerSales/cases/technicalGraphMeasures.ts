import type { CanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { QuantitySchema, type PartnerTechnicalSavedView } from '@sabalanerp/partner-sales-contracts';
import { Prisma } from '@prisma/client';
import { partnerQuotedQuantity } from './canonicalWholesale';

export type TechnicalGraphMeasure = Pick<PartnerTechnicalSavedView['rows'][number], 'quantity' | 'unit'> & { productRowId: string };

/** Allowlisted commercial measures. Current cut stone uses consumed square meters;
 * immutable legacy graphs retain their original negotiated units.
 * This projection never seals Accounting precision or changes frozen witnesses. */
export function technicalGraphMeasures(graph: CanonicalProductGraph): TechnicalGraphMeasure[] {
  return graph.rows.map(row => {
    const facts = row.commercial;
    let unit: TechnicalGraphMeasure['unit'], quantity: string;
    if (facts.calculationSnapshot?.partnerPricingBasis === 'ordinary-sale-v1' &&
        ['longitudinal', 'stair', 'slab'].includes(row.productType)) {
      return { productRowId: row.productRowId, unit: 'squareMeter', quantity: QuantitySchema.parse(partnerQuotedQuantity(row).toFixed()) };
    }
    switch (row.productType) {
      case 'prepared': case 'volumetric': {
        const selectedUnit = facts.calculationSnapshot?.unit;
        if (selectedUnit !== 'ton' && selectedUnit !== 'count' && selectedUnit !== 'squareMeter') throw new Error('Missing prepared unit');
        unit = selectedUnit === 'ton' ? 'ton' : selectedUnit === 'count' ? 'count' : 'squareMeter';
        quantity = QuantitySchema.parse(facts.requestedQuantity);
        break;
      }
      case 'longitudinal': {
        unit = 'meter';
        const length = QuantitySchema.parse(facts.requestedLengthMeters);
        const mode = facts.calculationSnapshot?.quantityMode;
        if (mode === 'total-linear-meters') quantity = length;
        else if (mode === 'piece-count') {
          const count = QuantitySchema.parse(facts.requestedQuantity);
          // Local precision covers the complete decimal product. Never alter
          // Prisma's global arithmetic settings or round a frozen witness.
          const ExactDecimal = Prisma.Decimal.clone({ precision: length.length + count.length + 2 });
          quantity = new ExactDecimal(length).mul(count).toFixed();
        }
        else throw new Error('Missing longitudinal quantity mode');
        break;
      }
      case 'slab': unit = 'squareMeter'; quantity = QuantitySchema.parse(facts.requestedAreaSquareMeters); break;
      case 'stair': unit = 'count'; quantity = QuantitySchema.parse(facts.requestedQuantity); break;
      default: throw new Error('Unsupported canonical product family');
    }
    return { productRowId: row.productRowId, unit, quantity };
  });
}
