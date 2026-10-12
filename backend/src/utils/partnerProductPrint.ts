import { Prisma } from '@prisma/client';
import type { CustomerContractOutput, WholesalePricingBreakdown } from '@sabalanerp/partner-sales-contracts';

/** Render-only DTO. No graph, envelope, catalog entity or opposite-side money
 * crosses either print boundary. It is never persisted into signed evidence. */
export interface PartnerPrintMeasurement {
  length?: string; width?: string; count?: string; area?: string;
}
export interface PartnerPrintOperation extends PartnerPrintMeasurement {
  id: string; code?: string; name: string; category: string;
  quantity?: string; unit?: string; edges?: string;
  rate?: string; amount?: string;
}
export interface PartnerProductPrintDetails extends PartnerPrintMeasurement {
  productRowId: string; code?: string; category?: string; productType?: string;
  sources: Array<PartnerPrintMeasurement & { code?: string; name: string }>;
  operations: PartnerPrintOperation[];
  materialAmount?: string; materialRate?: string;
  mandatory: Array<{ name: string; percentage: string; amount: string }>;
  aggregateAmount?: string;
}

const object = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const array = (v: unknown) => Array.isArray(v) ? v.map(object) : [];
const text = (v: unknown) => typeof v === 'string' && v.trim() ? v : undefined;
const decimal = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && /^(0|[1-9]\d*)(\.\d+)?$/.test(String(v)) ? String(v) : undefined;
const D = Prisma.Decimal.clone({ precision: 100 });
const positive = (v: unknown) => { const value = decimal(v); return value !== undefined && new D(value).gt(0) ? value : undefined; };
const sum = (values: string[]) => values.reduce((total, value) => total.plus(value), new D(0));
const edgeNames: Record<string, string> = { front: 'جلو', back: 'عقب', left: 'چپ', right: 'راست' };
const cutNames: Record<string, string> = { 'longitudinal-cut': 'برش طولی', longitudinalCutRateToman: 'برش طولی',
  'cross-cut': 'برش عرضی', crossCutRateToman: 'برش عرضی', 'calibration-cut': 'کالیبراسیون', calibrationCutRateToman: 'کالیبراسیون',
  'slab-cut-longitudinal': 'برش طولی', 'slab-cut-cross': 'برش عرضی', 'slab-cut-vertical': 'برش عمودی اسلب', 'slab-cut-square-meter': 'برش اسلب بر اساس مساحت' };
const edges = (v: unknown) => Array.isArray(v) ? v.map(edge => edgeNames[String(edge)]).filter(Boolean).join('، ') || undefined : undefined;

/** Catalog codes are display identities, never prices. Prefer recorded codes;
 * this lookup fills only absent codes without altering historical evidence. */
export async function readPartnerPrintCodes(database: Prisma.TransactionClient, graphValue: unknown) {
  const graph = object(graphValue), rows = array(graph.rows);
  const ids = [...new Set(rows.map(row => text(row.catalogProductId)).filter((id): id is string => !!id))];
  const tools = array(graph.toolSelections).map(selection => ({ id: String(selection.toolSelectionId), catalogId: text(selection.catalogItemId) }));
  const finishings = array(graph.finishingSelections).map(selection => ({ id: String(selection.finishingSelectionId), catalogId: text(selection.catalogItemId) }));
  for (const layer of array(graph.layerConfigurations)) for (const side of array(object(layer.result).sideOperationResults)) {
    for (const [key, idKey, target] of [['tools', 'toolSelectionId', tools], ['finishings', 'finishingSelectionId', finishings]] as const)
      for (const selection of array(object(side.result)[key])) target.push({ id: `${String(layer.layerConfigurationId)}:${String(selection[idKey])}`, catalogId: text(selection.catalogItemId) });
  }
  const catalogIds = (items: typeof tools) => [...new Set(items.map(item => item.catalogId).filter((id): id is string => !!id))];
  const toolIds = catalogIds(tools), finishingIds = catalogIds(finishings);
  const [products, toolCatalog, finishingCatalog] = await Promise.all([
    ids.length ? database.product.findMany({ where: { id: { in: ids } }, select: { id: true, code: true } }) : [],
    toolIds.length ? database.subService.findMany({ where: { id: { in: toolIds } }, select: { id: true, code: true } }) : [],
    finishingIds.length ? database.stoneFinishing.findMany({ where: { id: { in: finishingIds } }, select: { id: true, code: true } }) : [],
  ] as const);
  const catalog = new Map(products.map(product => [product.id, product.code] as const));
  const codes = new Map<string, string | undefined>(rows.map(row => [String(row.productRowId), catalog.get(String(row.catalogProductId))] as const));
  for (const [items, entries] of [[tools, toolCatalog], [finishings, finishingCatalog]] as const) {
    const lookup = new Map(entries.map(item => [item.id, item.code] as const));
    for (const item of items) if (item.catalogId) codes.set(item.id, lookup.get(item.catalogId));
  }
  return codes;
}

export function fillPartnerPrintCodes(details: PartnerProductPrintDetails, codes: ReadonlyMap<string, string | undefined>): PartnerProductPrintDetails {
  return { ...details, code: details.code || codes.get(details.productRowId),
    operations: details.operations.map(operation => ({ ...operation, code: operation.code || codes.get(operation.id) })) };
}

/** Extract only geometry and operation identity from the exact revision graph.
 * Monetary fields in commercial/legacy/calculation snapshots are not copied. */
export function partnerPhysicalPrintDetails(productRowId: string, graphValue: unknown): PartnerProductPrintDetails | undefined {
  const graph = object(graphValue), row = array(graph.rows).find(row => row.productRowId === productRowId);
  if (!row) return undefined;
  const commercial = object(row.commercial), snapshot = object(commercial.calculationSnapshot), legacy = object(commercial.legacySnapshot);
  const catalog = array(graph.catalogSnapshots).find(item => item.catalogProductId === row.catalogProductId && item.snapshotVersion === row.catalogSnapshotVersion);
  const facts = object(catalog?.facts), catalogLegacy = object(facts.legacySnapshot);
  const code = text(commercial.stoneCode) || text(legacy.stoneCode) || text(legacy.code) || text(catalogLegacy.code);
  const part = text(object(row.stairPart).part) || text(legacy.stairPartType);
  const category = part ? ({ tread: 'کف پله', riser: 'خیز پله', landing: 'پاگرد' } as Record<string, string>)[part] : undefined;
  const details: PartnerProductPrintDetails = { productRowId, code, category, productType: text(row.productType),
    length: decimal(commercial.requestedLengthMeters), width: decimal(commercial.requestedWidthMeters),
    count: decimal(commercial.requestedQuantity), area: decimal(commercial.requestedAreaSquareMeters), sources: [], operations: [], mandatory: [] };
  const addSource = (name: string, length?: string, width?: string, count?: string, area?: string, sourceCode = code) => {
    if (!length || !width || !count) return;
    details.sources.push({ name, code: sourceCode, length, width, count,
      area: area || new D(length).mul(width).mul(count).toFixed() });
  };
  const packing = object(snapshot.packingPlan), consumed = array(packing.consumedSources);
  const sourceRows = array(snapshot.sourceRows);
  if (sourceRows.length) {
    for (const source of sourceRows) {
      const consumedCount = consumed.filter(item => item.sourceBatchId === source.sourceBatchId ||
        (typeof source.sourceRowId === 'string' && typeof item.sourceBatchId === 'string' && item.sourceBatchId.endsWith(`:${source.sourceRowId}`))).length;
      if (consumedCount) addSource(String(row.contractualTitle || ''), decimal(source.lengthMeters), decimal(source.widthMeters), String(consumedCount));
    }
  } else {
    const motherWidth = decimal(snapshot.motherWidthMeters) || decimal(facts.motherWidthMeters);
    const motherLength = decimal(snapshot.motherLengthMeters) || decimal(facts.motherLengthMeters);
    const count = consumed.length ? String(consumed.length) : positive(snapshot.sourcePiecesConsumed);
    // Longitudinal policy explicitly consumes sources of its requested length;
    // stair/slab use their recorded mother/source length instead.
    const sourceLength = motherLength || (row.productType === 'longitudinal' ? details.length : undefined);
    if (!array(graph.allocations).some(item => item.targetProductRowId === productRowId) &&
        (row.productType === 'stair' || row.productType === 'slab' || (motherWidth && details.width && new D(motherWidth).gt(details.width))))
      addSource(String(row.contractualTitle || ''), sourceLength, motherWidth, count);
  }
  // Historical remainder consumption must come from its actual source stock.
  const stocks = [...array(graph.sourceBatches).flatMap(batch => array(batch.initialRemainders)),
    ...array(graph.layerConfigurations).flatMap(layer => array(object(layer.result).generatedRemainders))];
  for (const allocation of array(graph.allocations).filter(item => item.targetProductRowId === productRowId)) {
    const source = stocks.find(stock => stock.remainingStoneId === allocation.sourceRemainingStoneId);
    if (source) addSource(String(row.contractualTitle || ''), decimal(source.lengthMeters), decimal(source.widthMeters), decimal(allocation.consumedSourcePieces));
  }
  if (!details.sources.length) {
    const smart = object(legacy.smartCutPlan), stair = object(object(legacy.meta).stair);
    const count = positive(smart.sourceBandsNeeded) || positive(stair.baseStoneQuantity);
    const widthCm = positive(smart.sourceWidthCm) || positive(legacy.originalWidth);
    const length = positive(object(stair.standardLength).meters) || positive(legacy.originalLength) ||
      (count && positive(smart.sourceLengthConsumedM) ? new D(String(smart.sourceLengthConsumedM)).div(count).toFixed() : undefined);
    if (count && widthCm && length) addSource(String(row.contractualTitle || ''), length, new D(widthCm).div(100).toFixed(), count,
      positive(smart.consumedAreaSqm) || positive(stair.pricingSquareMeters));
  }
  const addOperation = (id: string, name: string, category: string, quantity?: string, unit?: string, selectedEdges?: string, operationCode?: string) => {
    if (details.operations.some(item => item.id === id)) return;
    details.operations.push({ id, name, category, quantity, unit, edges: selectedEdges, code: operationCode });
  };
  const lines = [...array(snapshot.pricingLines), ...array(snapshot.cuttingPricingLines)];
  for (const line of lines) {
    const id = text(line.lineId), name = id && cutNames[id];
    if (id && name && positive(line.quantity)) addOperation(`cut:${id}`, name, 'برش', decimal(line.quantity), id === 'slab-cut-square-meter' ? 'squareMeter' : 'meter');
  }
  const groups = new Set(array(graph.operationGroups).filter(group => group.productRowId === productRowId).map(group => group.operationGroupId));
  for (const [key, category, idKey] of [['toolSelections', 'ابزار', 'toolSelectionId'], ['finishingSelections', 'پرداخت سنگ', 'finishingSelectionId']]) {
    for (const selection of array(graph[key]).filter(item => groups.has(item.operationGroupId))) {
      const id = text(selection[idKey]), name = text(selection.name);
      if (id && name) addOperation(id, name, category, decimal(selection.finalQuantity), text(selection.unit), edges(selection.edges || selection.targetEdges), text(selection.code));
    }
  }
  for (const layer of array(graph.layerConfigurations).filter(item => item.parentProductRowId === productRowId)) {
    const input = object(layer.input), result = object(layer.result), title = text(input.layerTitle) || 'لایه';
    const id = String(layer.layerConfigurationId), line = object(result.layerPricingLine);
    const layerConsumed = array(object(result.packingPlan).consumedSources);
    for (const [index, source] of array(object(input.source).sourceRows).entries()) {
      const count = layerConsumed.filter(piece => typeof piece.sourceBatchId === 'string' && typeof source.sourceRowId === 'string' && piece.sourceBatchId.endsWith(`:${source.sourceRowId}`)).length;
      const length = decimal(source.lengthMeters), width = decimal(source.widthMeters);
      if (count && length && width) details.operations.push({ id: `${id}:source:${index}`, name: `سنگ مصرفی لایه: ${title}`, category: 'سنگ مصرفی',
        length, width, count: String(count), area: new D(length).mul(width).mul(count).toFixed() });
    }
    for (const [index, strip] of array(result.physicalStrips).entries()) {
      const length = decimal(strip.lengthMeters), width = decimal(strip.widthMeters), count = decimal(strip.quantity);
      details.operations.push({ id: `${id}:geometry:${index}`, name: `${title}${edgeNames[String(strip.side)] ? ` (${edgeNames[String(strip.side)]})` : ''}`, category: 'لایه',
        length, width, count, ...(length && width && count ? { area: new D(length).mul(width).mul(count).toFixed() } : {}) });
    }
    addOperation(`${id}:service`, `اجرای لایه: ${title}`, 'لایه', decimal(line.quantity), text(input.layerUnit), edges(input.targetSides));
    const materialLine = object(result.materialPricingLine);
    if (positive(materialLine.quantity)) addOperation(`${id}:material`, `سنگ مصرفی لایه: ${title}`, 'سنگ مصرفی', decimal(materialLine.quantity), 'squareMeter');
    for (const cut of array(result.cuttingPricingLines)) {
      const cutId = String(cut.lineId), name = cutId.endsWith(':cut:cross') ? 'برش عرضی' : cutId.endsWith(':cut:longitudinal') ? 'برش طولی' : cutId.endsWith(':cut:calibration') ? 'کالیبراسیون' : undefined;
      if (name && positive(cut.quantity)) addOperation(cutId, `${name} لایه: ${title}`, 'برش', decimal(cut.quantity), 'meter');
    }
    for (const side of array(result.sideOperationResults)) {
      for (const [key, category, idKey] of [['tools', 'ابزار', 'toolSelectionId'], ['finishings', 'پرداخت سنگ', 'finishingSelectionId']]) {
        for (const operation of array(object(side.result)[key])) {
          const name = text(operation.name), selectionId = text(operation[idKey]);
          if (name && selectionId) addOperation(`${id}:${selectionId}`, `${name} لایه: ${title}`, category, decimal(operation.finalQuantity), text(operation.unit), edges(operation.edges));
        }
      }
    }
  }
  return details;
}

/** Approved wholesale breakdown is the sole monetary authority for internal
 * printing. Physical operations never borrow their retail rate or amount. */
export function partnerWholesalePrintDetails(details: PartnerProductPrintDetails, pricing: WholesalePricingBreakdown, quantity: string): PartnerProductPrintDetails {
  const result = { ...details, operations: details.operations.map(operation => ({ ...operation })),
    materialAmount: pricing.materialAmount,
    materialRate: positive(quantity) ? new D(pricing.materialAmount).div(quantity).toFixed() : undefined,
    mandatory: pricing.mandatoryCharges.map(charge => ({ name: charge.subjectId.startsWith('layer-material:') ? 'حکمی سبلان · سنگ جدید لایه' : 'حکمی سبلان', percentage: charge.percentage, amount: charge.amount })) };
  const charges = pricing.ancillaryCharges;
  if (charges && sum(charges.map(charge => charge.amount)).eq(pricing.componentAmount)) {
    for (const charge of charges) {
      const operation = result.operations.find(operation => operation.id === charge.id);
      const line = { id: charge.id, name: charge.label, category: charge.label.startsWith('ابزار') ? 'ابزار' : charge.label.startsWith('پرداخت') ? 'پرداخت سنگ' : /برش|کالیبراسیون/.test(charge.label) ? 'برش' : 'خدمات',
        quantity: charge.quantity, unit: charge.unit, rate: charge.unitPrice, amount: charge.amount };
      if (operation) Object.assign(operation, { rate: charge.unitPrice, amount: charge.amount, quantity: charge.quantity ?? operation.quantity, unit: charge.unit ?? operation.unit });
      else result.operations.push(line);
    }
    return result;
  }
  return { ...result, ...(positive(pricing.componentAmount) ? { aggregateAmount: pricing.componentAmount } : {}) };
}

/** Customer amounts come only from matching retail evidence. If historical
 * components cannot reconcile exactly, keep the agreed row amount intact. */
export function partnerCustomerPrintDetails(output: CustomerContractOutput, graphValue: unknown, codes: ReadonlyMap<string, string | undefined> = new Map()): PartnerProductPrintDetails[] {
  const graph = object(graphValue);
  return output.products.flatMap(product => {
    const physical = partnerPhysicalPrintDetails(product.productRowId, graph);
    const row = array(graph.rows).find(row => row.productRowId === product.productRowId);
    if (!physical || !row) return [];
    const commercial = object(row.commercial), snapshot = object(commercial.calculationSnapshot);
    const result = fillPartnerPrintCodes({ ...physical, code: product.productCode || physical.code }, codes);
    const total = product.retailLineTotal || new D(product.quantity).mul(product.retailUnitPrice).toFixed();
    if (!decimal(commercial.totalAmountToman)) return [result];
    const conversion = output.totals.currency === 'IRR' ? new D(10) : new D(1);
    if (!new D(String(commercial.totalAmountToman)).mul(conversion).eq(total)) return [result];
    // Read-only reconstruction of the frozen operation witnesses; never rates
    // from today's catalogs, and never the wholesale envelope.
    const candidates = [...array(snapshot.pricingLines), ...array(snapshot.cuttingPricingLines)];
    const money = new Map<string, { rate?: string; amount: string }>();
    for (const line of candidates) {
      const id = text(line.lineId), amount = decimal(line.amountToman);
      if (id && amount) money.set(`cut:${id}`, { rate: decimal(line.rateToman), amount });
    }
    for (const [key, idKey] of [['toolSelections', 'toolSelectionId'], ['finishingSelections', 'finishingSelectionId']])
      for (const operation of array(graph[key])) {
        const id = text(operation[idKey]), amount = decimal(operation.amountToman);
        if (id && amount) money.set(id, { rate: decimal(operation.rateToman), amount });
      }
    for (const layer of array(graph.layerConfigurations).filter(layer => layer.parentProductRowId === product.productRowId)) {
      const id = String(layer.layerConfigurationId), layerResult = object(layer.result);
      for (const [suffix, value] of [['service', layerResult.layerPricingLine], ['material', layerResult.materialPricingLine]] as const) {
        const line = object(value), amount = decimal(line.amountToman);
        if (amount) money.set(`${id}:${suffix}`, { rate: decimal(line.rateToman), amount });
      }
      for (const cut of array(layerResult.cuttingPricingLines)) {
        const amount = decimal(cut.amountToman); if (amount) money.set(String(cut.lineId), { rate: decimal(cut.rateToman), amount });
      }
      for (const side of array(layerResult.sideOperationResults))
        for (const [key, idKey] of [['tools', 'toolSelectionId'], ['finishings', 'finishingSelectionId']])
          for (const operation of array(object(side.result)[key])) {
            const amount = decimal(operation.amountToman); if (amount) money.set(`${id}:${String(operation[idKey])}`, { rate: decimal(operation.rateToman), amount });
          }
    }
    const base = decimal(commercial.baseAmountToman), mandatory = decimal(snapshot.mandatoryAmountToman) || '0';
    const priced = result.operations.map(operation => ({ ...operation, ...money.get(operation.id) }));
    const billable = priced.filter(operation => !operation.id.includes(':geometry:') && !operation.id.includes(':source:'));
    if (!base || billable.some(operation => operation.amount === undefined) || !sum([base, mandatory, ...billable.map(operation => operation.amount!)]).mul(conversion).eq(total)) return [result];
    const convert = (value: string) => new D(value).mul(conversion).toFixed();
    return [{ ...result, materialAmount: convert(base),
      materialRate: decimal(commercial.baseRateToman) ? convert(String(commercial.baseRateToman)) : undefined,
      operations: priced.map(operation => ({ ...operation, amount: operation.amount !== undefined ? convert(operation.amount) : undefined, rate: operation.rate !== undefined ? convert(operation.rate) : undefined })),
      mandatory: positive(mandatory) && decimal(snapshot.mandatoryPercentage) ? [{ name: 'حکمی', percentage: String(snapshot.mandatoryPercentage), amount: convert(mandatory) }] : [] }];
  });
}
