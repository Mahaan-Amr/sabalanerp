import type { CanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { QuantitySchema, type PartnerTechnicalSavedView } from '@sabalanerp/partner-sales-contracts';
import { Prisma } from '@prisma/client';

export type TechnicalGraphMeasure = Pick<PartnerTechnicalSavedView['rows'][number], 'quantity' | 'unit'> & { productRowId: string };

/** Allowlisted requested commercial measures, not packing piece counts or money.
 * This projection never seals Accounting precision or changes frozen witnesses. */
export function technicalGraphMeasures(graph: CanonicalProductGraph): TechnicalGraphMeasure[] {
  return graph.rows.map(row => {
    const facts = row.commercial;
    let unit: TechnicalGraphMeasure['unit'], quantity: string;
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
        else if (mode === 'piece-count') quantity = new Prisma.Decimal(length).mul(QuantitySchema.parse(facts.requestedQuantity)).toFixed();
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
