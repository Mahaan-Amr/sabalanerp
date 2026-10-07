import { Prisma } from '@prisma/client';
import type { CanonicalProductGraph, CanonicalProductRow } from '@sabalanerp/contract-product-graph';
import type { WholesalePricingBreakdown } from '@sabalanerp/partner-sales-contracts';
import { readWholesaleMandatory } from '../cases/canonicalWholesale';

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const cutLabels: Record<string, string> = {
  'longitudinal-cut': 'برش طولی', longitudinalCutRateToman: 'برش طولی', 'slab-cut-longitudinal': 'برش طولی',
  'cross-cut': 'برش عرضی', crossCutRateToman: 'برش عرضی', 'slab-cut-cross': 'برش عرضی',
  'calibration-cut': 'کالیبراسیون', calibrationCutRateToman: 'کالیبراسیون',
  'slab-cut-square-meter': 'برش اسلب بر اساس مساحت', 'slab-cut-vertical': 'برش عمودی اسلب',
};
const cutLabel = (id: string) => cutLabels[id];

/** Names and amounts come only from frozen operations. A complete sum is required;
 * a missing witness must never be disguised as a named fee or reprice the quote. */
export function describeWholesaleAncillaryCharges(row: CanonicalProductRow, graph: CanonicalProductGraph,
  pricing: WholesalePricingBreakdown, mandatory?: unknown, layerPolicies: ReadonlyMap<string, unknown> = new Map()): WholesalePricingBreakdown['ancillaryCharges'] {
  const charges: NonNullable<WholesalePricingBreakdown['ancillaryCharges']> = [];
  const add = (id: string, label: string | undefined, amount: unknown, quantity?: unknown, unitPrice?: unknown, unit?: string) => {
    if (!label || typeof amount !== 'string' || new Prisma.Decimal(amount).lte(0)) return;
    const basis = typeof quantity === 'string' && typeof unitPrice === 'string' && unit
      ? { quantity, unitPrice, unit } : {};
    charges.push({ id, label, amount, ...basis });
  };
  const policy = readWholesaleMandatory(mandatory);
  const snapshot = row.commercial.calculationSnapshot;
  const mainLines = [...(Array.isArray(snapshot?.pricingLines) ? snapshot.pricingLines : []),
    ...(Array.isArray(snapshot?.cuttingPricingLines) ? snapshot.cuttingPricingLines : [])];
  const seen = new Set<string>();
  for (const line of mainLines) {
    if (!record(line) || typeof line.lineId !== 'string' || seen.has(line.lineId)) continue;
    seen.add(line.lineId);
    const label = cutLabel(line.lineId);
    const mainCross = line.lineId === 'cross-cut' || line.lineId === 'crossCutRateToman';
    if (policy?.enabled && mainCross) continue;
    const restoreCross = policy?.enabled === false && mainCross && typeof line.quantity === 'string' && typeof line.rateToman === 'string';
    add(`cut:${line.lineId}`, label, restoreCross ? new Prisma.Decimal(line.quantity as string).mul(line.rateToman as string).toFixed() : line.amountToman, line.quantity, line.rateToman, line.lineId === 'slab-cut-square-meter' ? 'squareMeter' : 'meter');
  }
  const groups = new Set(graph.operationGroups.filter(group => group.productRowId === row.productRowId).map(group => group.operationGroupId));
  for (const tool of graph.toolSelections) if (groups.has(tool.operationGroupId)) add(tool.toolSelectionId, `ابزار: ${tool.name}`, tool.amountToman, tool.finalQuantity, tool.rateToman, tool.unit);
  for (const finish of graph.finishingSelections) if (groups.has(finish.operationGroupId)) add(finish.finishingSelectionId, `پرداخت: ${finish.name}`, finish.amountToman, finish.finalQuantity, finish.rateToman, finish.unit);
  for (const layer of graph.layerConfigurations.filter(layer => layer.parentProductRowId === row.productRowId)) {
    const title = layer.input.layerTitle;
    if (layer.input.source.kind !== 'new-material') add(`${layer.layerConfigurationId}:material`, `سنگ مصرفی لایه: ${title}`, layer.result.materialAmountToman, layer.result.materialPricingLine?.quantity, layer.result.materialPricingLine?.rateToman, 'squareMeter');
    add(`${layer.layerConfigurationId}:service`, `اجرای لایه: ${title}`, layer.result.layerAmountToman, layer.result.layerPricingLine.quantity, layer.result.layerPricingLine.rateToman, layer.input.layerUnit);
    const layerPolicy = layer.input.source.kind === 'new-material' ? layer.input.source.catalogProductId === row.catalogProductId
      ? policy : readWholesaleMandatory(layerPolicies.get(layer.layerConfigurationId)) : undefined;
    for (const line of layer.result.cuttingPricingLines) {
      const kind = line.lineId.endsWith(':cut:cross') ? 'برش عرضی' : line.lineId.endsWith(':cut:longitudinal') ? 'برش طولی'
        : line.lineId.endsWith(':cut:calibration') ? 'کالیبراسیون' : undefined;
      if (kind === 'برش عرضی' && layerPolicy?.enabled) continue;
      const amount = kind === 'برش عرضی' && layerPolicy?.enabled === false ? new Prisma.Decimal(line.quantity).mul(line.rateToman).toFixed() : line.amountToman;
      add(line.lineId, kind ? `${kind} لایه: ${title}` : undefined, amount, line.quantity, line.rateToman, 'meter');
    }
    for (const side of layer.result.sideOperationResults) {
      for (const tool of side.result.tools) add(`${layer.layerConfigurationId}:${tool.toolSelectionId}`, `ابزار لایه ${title}: ${tool.name}`, tool.amountToman, tool.finalQuantity, tool.rateToman, tool.unit);
      for (const finish of side.result.finishings) add(`${layer.layerConfigurationId}:${finish.finishingSelectionId}`, `پرداخت لایه ${title}: ${finish.name}`, finish.amountToman, finish.finalQuantity, finish.rateToman, finish.unit);
    }
  }
  const total = charges.reduce((amount, charge) => amount.plus(charge.amount), new Prisma.Decimal(0));
  return total.eq(pricing.componentAmount) ? charges : undefined;
}
