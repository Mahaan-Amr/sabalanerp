import { Prisma } from '@prisma/client';
import {
  parseCanonicalDecimal,
  type CanonicalLayerConfiguration,
  type CanonicalProductRow,
} from '@sabalanerp/contract-product-graph';

export type PartnerCanonicalWholesale = {
  materialQuantity: string;
  materialAmount: string;
  componentAmount: string;
  totalAmount: string;
};

const canonical = (value: Prisma.Decimal.Value) => parseCanonicalDecimal(new Prisma.Decimal(value).toFixed());
const isObjectRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function partnerQuotedQuantity(row: CanonicalProductRow) {
  if (row.productType === 'longitudinal') {
    return new Prisma.Decimal(row.commercial.requestedAreaSquareMeters ?? '0');
  }
  if (row.productType === 'stair' || row.productType === 'prepared') {
    return new Prisma.Decimal(row.commercial.requestedQuantity ?? '0');
  }
  if (row.productType === 'slab') {
    const snapshot = row.commercial.calculationSnapshot;
    const packingPlan = snapshot?.packingPlan;
    const consumedSources = isObjectRecord(packingPlan) ? packingPlan.consumedSources : undefined;
    if (!Array.isArray(consumedSources)) {
      throw new Error('Canonical slab consumed-source evidence is missing');
    }
    return new Prisma.Decimal(consumedSources.length);
  }
  throw new Error('Partner pricing is not supported for this product family');
}

/** Reuses the ordinary Contract engine's canonical material and component evidence.
 * The inquiry replaces only the catalog material rate; it never reprices cuts,
 * tools, finishing, mandatory charges, or paid-remainder material. */
export function calculatePartnerCanonicalWholesale(row: CanonicalProductRow,
  approvedMaterialRateToman: string, layers: readonly CanonicalLayerConfiguration[] = [],
  additionalMaterialRates: ReadonlyMap<string, string> = new Map()): PartnerCanonicalWholesale {
  const base = new Prisma.Decimal(row.commercial.baseAmountToman ?? '0');
  const total = new Prisma.Decimal(row.commercial.totalAmountToman ?? '0');
  const materialQuantity = base.isZero() ? new Prisma.Decimal(0) : partnerQuotedQuantity(row);
  if (!base.isZero() && materialQuantity.lte(0)) throw new Error('Canonical Partner pricing quantity is missing');
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

/** Applies the Partner's customer-facing stone rate to the same canonical
 * material basis while preserving every system-owned ancillary component.
 * A layer made from a different catalog stone keeps the ordinary Contract
 * engine's catalog material rate because the Partner supplies only the main
 * Product-family rate. */
export function calculatePartnerCanonicalRetail(row: CanonicalProductRow,
  partnerMaterialRateToman: string, layers: readonly CanonicalLayerConfiguration[] = []): PartnerCanonicalWholesale {
  const additionalRates = new Map<string, string>();
  for (const layer of layers) {
    if (layer.parentProductRowId !== row.productRowId || layer.input.source.kind !== 'new-material' ||
        layer.input.source.catalogProductId === row.catalogProductId) continue;
    const quantity = new Prisma.Decimal(layer.result.materialSourceSplit.newMaterialSquareMeters);
    const amount = new Prisma.Decimal(layer.result.materialSourceSplit.newMaterialAmountToman);
    if (quantity.lte(0) || amount.isNegative()) throw new Error('Canonical layer material is invalid');
    const rate = canonical(amount.div(quantity));
    const previous = additionalRates.get(layer.input.source.catalogProductId);
    if (previous && previous !== rate) throw new Error('Canonical layer material rate is inconsistent');
    additionalRates.set(layer.input.source.catalogProductId, rate);
  }
  return calculatePartnerCanonicalWholesale(row, partnerMaterialRateToman, layers, additionalRates);
}
