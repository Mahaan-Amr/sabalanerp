import { Prisma } from '@prisma/client';
import type { WholesalePricingBreakdown } from '@sabalanerp/partner-sales-contracts';
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
  wholesalePricing?: WholesalePricingBreakdown;
};

const canonical = (value: Prisma.Decimal.Value) => parseCanonicalDecimal(new Prisma.Decimal(value).toFixed());
const isObjectRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
export function readWholesaleMandatory(value: unknown): { enabled: boolean; percentage: string } | undefined {
  if (value == null) return undefined;
  if (!isObjectRecord(value) || typeof value.enabled !== 'boolean' || typeof value.percentage !== 'string' ||
      !/^(0|[1-9]\d*)(\.\d+)?$/.test(value.percentage) || new Prisma.Decimal(value.percentage).gt(100)) throw new Error('Invalid wholesale mandatory policy');
  return { enabled: value.enabled, percentage: value.percentage };
}

export function partnerQuotedQuantity(row: CanonicalProductRow) {
  const snapshot = row.commercial.calculationSnapshot;
  if (snapshot?.partnerPricingBasis === 'ordinary-sale-v1') {
    if (row.productType !== 'prepared') {
      const lines = Array.isArray(snapshot.pricingLines) ? snapshot.pricingLines.filter(line =>
        isObjectRecord(line) && line.lineId === 'base-material') : [];
      const material = row.productType === 'slab' && isObjectRecord(snapshot.materialPricingLine)
        ? snapshot.materialPricingLine : lines.length === 1 ? lines[0] : undefined;
      if (isObjectRecord(material) && typeof material.quantity === 'string') return new Prisma.Decimal(material.quantity);
      if (snapshot.pricingLines !== undefined || snapshot.materialPricingLine !== undefined || row.productType === 'longitudinal') {
        throw new Error('Canonical material pricing quantity is missing');
      }
    }
    if (row.productType === 'stair') {
      if (typeof snapshot.consumedMotherAreaSquareMeters !== 'string') throw new Error('Canonical stair material area is missing');
      return new Prisma.Decimal(snapshot.consumedMotherAreaSquareMeters);
    }
    if (row.productType === 'slab') {
      if (typeof snapshot.materialAreaSquareMeters !== 'string') throw new Error('Canonical slab material area is missing');
      return new Prisma.Decimal(snapshot.materialAreaSquareMeters);
    }
  }
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

/** Reuses canonical family quantities and fixed component evidence. Material
 * and its percentage charge use this agreement's rate; paid material stays paid. */
export function calculatePartnerCanonicalWholesale(row: CanonicalProductRow,
  approvedMaterialRateToman: string, layers: readonly CanonicalLayerConfiguration[] = [],
  additionalMaterialRates: ReadonlyMap<string, string> = new Map(), wholesaleMandatory?: unknown,
  additionalMandatoryPolicies: ReadonlyMap<string, unknown> = new Map()): PartnerCanonicalWholesale {
  const base = new Prisma.Decimal(row.commercial.baseAmountToman ?? '0');
  const total = new Prisma.Decimal(row.commercial.totalAmountToman ?? '0');
  const snapshot = row.commercial.calculationSnapshot;
  const chargeMaterial = !base.isZero();
  const materialQuantity = chargeMaterial ? partnerQuotedQuantity(row) : new Prisma.Decimal(0);
  if (chargeMaterial && materialQuantity.lte(0)) throw new Error('Canonical Partner pricing quantity is missing');
  const rowLayers = layers.filter(layer => layer.parentProductRowId === row.productRowId && layer.input.source.kind === 'new-material');
  const originalLayerMaterial = rowLayers.reduce((sum, layer) => sum.plus(layer.result.materialSourceSplit.newMaterialAmountToman), new Prisma.Decimal(0));
  const repricedLayerMaterial = rowLayers.reduce((sum, layer) => {
    if (layer.input.source.kind !== 'new-material') return sum;
    const rate = layer.input.source.catalogProductId === row.catalogProductId
      ? approvedMaterialRateToman : additionalMaterialRates.get(layer.input.source.catalogProductId);
    if (!rate) throw new Error('Approved additional material rate is missing');
    return sum.plus(new Prisma.Decimal(layer.result.materialSourceSplit.newMaterialSquareMeters).mul(rate));
  }, new Prisma.Decimal(0));
  const materialAmount = materialQuantity.mul(approvedMaterialRateToman);
  let componentAmount = total.minus(base).minus(originalLayerMaterial);
  const explicitMandatory = readWholesaleMandatory(wholesaleMandatory);
  const mandatoryCharges: WholesalePricingBreakdown['mandatoryCharges'] = [];
  const addMandatory = (subjectId: string, basis: Prisma.Decimal, percentage: string) => {
    const amount = basis.mul(percentage).div(100);
    mandatoryCharges.push({ subjectId, basisAmount: canonical(basis), percentage, amount: canonical(amount) });
    return amount;
  };
  if (chargeMaterial && snapshot?.partnerPricingBasis === 'ordinary-sale-v1' && snapshot.mandatoryEnabled === true) {
    if (typeof snapshot.mandatoryPercentage !== 'string' || typeof snapshot.mandatoryAmountToman !== 'string') {
      throw new Error('Canonical mandatory pricing evidence is missing');
    }
    const percentage = new Prisma.Decimal(snapshot.mandatoryPercentage);
    const originalMandatory = new Prisma.Decimal(snapshot.mandatoryAmountToman);
    if (percentage.isNegative() || percentage.gt(100) || originalMandatory.isNegative()) {
      throw new Error('Canonical mandatory pricing evidence is invalid');
    }
    componentAmount = componentAmount.minus(originalMandatory);
    if (componentAmount.isNegative()) throw new Error('Canonical component amount is invalid');
    if (explicitMandatory === undefined) componentAmount = componentAmount.plus(addMandatory(row.productRowId, materialAmount, canonical(percentage)));
  }
  if (chargeMaterial && explicitMandatory) {
    if (explicitMandatory.enabled) componentAmount = componentAmount.plus(addMandatory(row.productRowId, materialAmount, explicitMandatory.percentage));
    const lines = Array.isArray(snapshot?.pricingLines) ? snapshot.pricingLines.filter(isObjectRecord) : [];
    const crossCuts = lines.filter(line => line.lineId === 'crossCutRateToman' || line.lineId === 'cross-cut');
    for (const line of crossCuts) {
      if (typeof line.amountToman !== 'string' || typeof line.quantity !== 'string' || typeof line.rateToman !== 'string') {
        throw new Error('Missing frozen cross-cut pricing evidence');
      }
      componentAmount = componentAmount.minus(line.amountToman);
      if (!explicitMandatory.enabled) componentAmount = componentAmount.plus(new Prisma.Decimal(line.quantity).mul(line.rateToman));
    }
  }
  for (const layer of rowLayers) {
    if (layer.input.source.kind !== 'new-material') continue;
    const mainStone = layer.input.source.catalogProductId === row.catalogProductId;
    const policy = mainStone ? explicitMandatory : readWholesaleMandatory(additionalMandatoryPolicies.get(layer.layerConfigurationId));
    if (!policy) continue;
    const rate = mainStone ? approvedMaterialRateToman : additionalMaterialRates.get(layer.input.source.catalogProductId);
    if (!rate) throw new Error('Approved additional material rate is missing');
    if (policy.enabled) componentAmount = componentAmount.plus(addMandatory(`layer-material:${layer.layerConfigurationId}`,
      new Prisma.Decimal(layer.result.materialSourceSplit.newMaterialSquareMeters).mul(rate), policy.percentage));
    for (const line of layer.result.cuttingPricingLines ?? []) if (line.lineId.endsWith(':cut:cross')) {
      componentAmount = componentAmount.minus(line.amountToman);
      if (!policy.enabled) componentAmount = componentAmount.plus(new Prisma.Decimal(line.quantity).mul(line.rateToman));
    }
  }
  if (componentAmount.isNegative()) throw new Error('Canonical component amount is invalid');
  const finalMaterial = canonical(materialAmount.plus(repricedLayerMaterial));
  const finalTotal = canonical(materialAmount.plus(repricedLayerMaterial).plus(componentAmount));
  return { materialQuantity: canonical(materialQuantity), materialAmount: finalMaterial,
    componentAmount: canonical(componentAmount), totalAmount: finalTotal,
    ...(explicitMandatory || additionalMandatoryPolicies.size ? { wholesalePricing: {
      materialAmount: finalMaterial, componentAmount: canonical(componentAmount.minus(mandatoryCharges.reduce((sum, line) => sum.plus(line.amount), new Prisma.Decimal(0)))),
      totalAmount: finalTotal, mandatoryCharges,
    } } : {}) };
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
