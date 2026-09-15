import { Prisma } from '@prisma/client';
import { parseCanonicalDecimal, type CanonicalLayerConfiguration, type CanonicalProductRow } from '@sabalanerp/contract-product-graph';

export type PartnerCanonicalWholesale = {
  materialQuantity: string;
  materialAmount: string;
  componentAmount: string;
  totalAmount: string;
};

const canonical = (value: Prisma.Decimal.Value) => parseCanonicalDecimal(new Prisma.Decimal(value).toFixed());

/** Reuses the ordinary Contract engine's canonical material and component evidence.
 * The inquiry replaces only the catalog material rate; it never reprices cuts,
 * tools, finishing, mandatory charges, or paid-remainder material. */
export function calculatePartnerCanonicalWholesale(row: CanonicalProductRow,
  approvedMaterialRateToman: string, layers: readonly CanonicalLayerConfiguration[] = [],
  additionalMaterialRates: ReadonlyMap<string, string> = new Map()): PartnerCanonicalWholesale {
  const base = new Prisma.Decimal(row.commercial.baseAmountToman ?? '0');
  const total = new Prisma.Decimal(row.commercial.totalAmountToman ?? '0');
  const catalogRate = new Prisma.Decimal(row.commercial.baseRateToman ?? '0');
  const materialQuantity = base.isZero() ? new Prisma.Decimal(0) : (() => {
    if (catalogRate.lte(0)) throw new Error('Canonical material rate is missing');
    return base.div(catalogRate);
  })();
  const rowLayers = layers.filter(layer => layer.parentProductRowId === row.productRowId && layer.input.source.kind === 'new-material');
  const originalLayerMaterial = rowLayers.reduce((sum, layer) => sum.plus(layer.result.materialSourceSplit.newMaterialAmountToman), new Prisma.Decimal(0));
  const repricedLayerMaterial = rowLayers.reduce((sum, layer) => {
    if (layer.input.source.kind !== 'new-material') return sum;
    const rate = layer.input.source.catalogProductId === row.catalogProductId
      ? approvedMaterialRateToman : additionalMaterialRates.get(layer.input.source.catalogProductId);
    if (!rate) throw new Error('Approved additional material rate is missing');
    return sum.plus(new Prisma.Decimal(layer.result.materialSourceSplit.newMaterialSquareMeters).mul(rate));
  }, new Prisma.Decimal(0));
  const componentAmount = total.minus(base).minus(originalLayerMaterial);
  if (componentAmount.isNegative()) throw new Error('Canonical component amount is invalid');
  const materialAmount = materialQuantity.mul(approvedMaterialRateToman);
  return { materialQuantity: canonical(materialQuantity), materialAmount: canonical(materialAmount.plus(repricedLayerMaterial)),
    componentAmount: canonical(componentAmount), totalAmount: canonical(materialAmount.plus(repricedLayerMaterial).plus(componentAmount)) };
}
