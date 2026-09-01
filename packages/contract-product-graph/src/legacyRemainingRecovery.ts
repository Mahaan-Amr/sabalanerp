import Decimal from 'decimal.js';
import { parseCanonicalDecimal as canonical } from './canonicalDecimal';
import { parseStableIdentity } from './stableIdentity';
import { replayRemainderAllocations, type PaidRemainderStock, type RemainderChildIntent } from './remainderPolicy';
import type { CanonicalAllocation, CanonicalProductGraph, CanonicalProductRow } from './productGraph';
import type { LegacyProductGraphConflict } from './legacyReadAdapter';

type RecordValue = Readonly<Record<string, unknown>>;
const record = (v: unknown): RecordValue => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const list = (v: unknown): readonly RecordValue[] => Array.isArray(v) ? v.map(record) : [];
const rowId = (p: RecordValue) => String(p.rowId ?? p.productRowId ?? '');
const source = (p: RecordValue) => record(record(p.meta).remainingSource);
const decimal = (v: unknown): Decimal => {
  if ((typeof v !== 'number' && typeof v !== 'string') || v === '' || !new Decimal(v).isFinite()) {
    throw new Error('missing-numeric-evidence');
  }
  return new Decimal(v);
};
const equal = (a: unknown, b: unknown) => decimal(a).eq(decimal(b));
const text = (v: unknown): string => {
  if (typeof v !== 'string' || !v || v !== v.trim()) throw new Error('missing-stable-identity');
  return v;
};
const strings = (v: unknown): string[] => {
  if (!Array.isArray(v)) throw new Error('missing-physical-lineage');
  const result = v.map(text);
  if (new Set(result).size !== result.length) throw new Error('duplicate-physical-lineage');
  return result;
};
const integer = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) throw new Error('invalid-piece-count');
  return v;
};
// Compatibility only for IEEE-754 residue in the legacy geometry writer, never money or user dimensions.
const sameGeometry = (legacy: unknown, exact: string, scale = 1): boolean => {
  const actual = decimal(legacy).toNumber();
  const expected = new Decimal(exact).times(scale).toNumber();
  return Math.abs(actual - expected) <= Number.EPSILON * 32 * Math.max(1, Math.abs(actual), Math.abs(expected));
};
const geometryMatches = (legacy: RecordValue, stock: PaidRemainderStock) =>
  sameGeometry(legacy.length, stock.lengthMeters) && sameGeometry(legacy.width, stock.widthMeters, 100);

// For equal-length strips, generated/no-generated residue plus capacity can uniquely constrain
// each source's piece count. A sum with multiple feasible distributions is not evidence.
const uniqueSourceDistribution = (consumed: string[], generated: string[], sourceWidth: string,
  width: string, kerf: string, quantity: number): number[] => {
  if (generated.some(id => !consumed.some(sourceId => id === `${sourceId}:secondary:1`))) throw new Error('secondary-lineage-mismatch');
  const span = decimal(width).plus(kerf);
  if (span.lte(0)) throw new Error('invalid-piece-dimensions');
  const wholeCount = decimal(sourceWidth).plus(kerf).div(span);
  const residueMaximum = decimal(sourceWidth).div(span).ceil().minus(1).toNumber();
  const ranges = consumed.map(id => {
    if (generated.includes(`${id}:secondary:1`)) return [1, Math.min(quantity, residueMaximum)];
    if (!wholeCount.isInteger()) throw new Error('secondary-lineage-mismatch');
    return [wholeCount.toNumber(), wholeCount.toNumber()];
  });
  if (ranges.some(([min, max]) => min < 1 || min > max)) throw new Error('invalid-physical-layout');
  const minimum = ranges.reduce((s, [min]) => s + min, 0);
  const maximum = ranges.reduce((s, [, max]) => s + max, 0);
  if (quantity < minimum || quantity > maximum) throw new Error('invalid-physical-layout');
  if (quantity === minimum) return ranges.map(([min]) => min);
  if (quantity === maximum) return ranges.map(([, max]) => max);
  if (ranges.filter(([min, max]) => min !== max).length === 1) {
    return ranges.map(([min, max]) => min === max ? min : min + quantity - minimum);
  }
  throw new Error('ambiguous-physical-layout');
};

export type RemainingRecovery = { readonly ok: true; readonly graph: CanonicalProductGraph } |
  { readonly ok: false; readonly conflicts: readonly LegacyProductGraphConflict[] };

/** Write-only compatibility bridge. No mutation, price inference, or geometry-only source selection. */
export const recoverLegacyRemainingChildren = (
  graph: CanonicalProductGraph, products: readonly RecordValue[]
): RemainingRecovery => {
  const children = products.filter(p => Object.keys(source(p)).length > 0 ||
    (p.parentProductRowId && record(p.meta).isLayer !== true && p.productType === 'longitudinal'));
  const consumedSources = products.filter(p => record(p.meta).isLayer !== true && list(p.usedRemainingStones).length > 0);
  const witnessedSources = products.filter(p => list(p.remainingStoneSourceInventory).length > 0);
  if (!children.length && !consumedSources.length && !witnessedSources.length) return { ok: true, graph };
  let affected = rowId(children[0] ?? consumedSources[0] ?? witnessedSources[0]);
  try {
    const productsById = new Map(products.map(p => [rowId(p), p]));
    const rootIds = new Set([...children.map(p => text(source(p).sourceProductRowId)),
      ...consumedSources.map(rowId), ...witnessedSources.map(rowId)]);
    let inventory = [...graph.remainingStones];
    const pools = new Map<string, Set<string>>();
    const physicalToStock = new Map<string, string>();
    const usedPhysicalIds = new Set<string>();
    const aliases = new Map<string, string>();
    const initialGroupAliases = new Set<string>();
    const addPool = (stockId: string, ids: string[]) => {
      for (const id of ids) {
        if (usedPhysicalIds.has(id)) throw new Error('duplicate-physical-lineage');
        usedPhysicalIds.add(id);
        physicalToStock.set(id, stockId);
        aliases.set(id, stockId);
      }
      pools.set(stockId, new Set([...(pools.get(stockId) ?? []), ...ids]));
    };
    for (const root of rootIds) {
      affected = root;
      const product = productsById.get(root);
      const canonicalRow = graph.rows.find(r => r.productRowId === root);
      if (!product || !canonicalRow || source(product).sourceProductRowId) throw new Error('unproven-paid-source');
      const rootChildren = children.filter(p => source(p).sourceProductRowId === root);
      const used = list(product.usedRemainingStones);
      const stocks = graph.sourceBatches.filter(b => b.ownerProductRowId === root).flatMap(b => b.initialRemainders ?? []);
      // Historical independent rows without canonical stock remain opaque snapshots. This bridge
      // must neither manufacture inventory for them nor require paid-child evidence when none exists.
      if (!rootChildren.length && !used.length && !stocks.length && canonicalRow.commercial.baseAmountToman === undefined) {
        rootIds.delete(root);
        continue;
      }
      if (canonicalRow.commercial.baseAmountToman === undefined) throw new Error('unproven-paid-source');
      const canonicalLayerConsumesSource = graph.layerConfigurations.some(l => l.input.source.kind !== 'new-material' &&
        l.input.source.selectedRemainingStoneIds.some(id => graph.sourceBatches.some(b => b.ownerProductRowId === root &&
          b.initialRemainders?.some(s => id === s.remainingStoneId || id.startsWith(`${s.remainingStoneId}:layer-remainder:`)))));
      if (canonicalLayerConsumesSource) {
        // Canonical layers already replay against their original stock. Their UI usage cache is not
        // a legacy partition ledger; do not re-interpret it or restore the pre-layer inventory.
        if (!rootChildren.length && !used.some(entry => String(entry.id).startsWith('used-'))) {
          rootIds.delete(root);
          continue;
        }
        throw new Error('ambiguous-layer-consumption-order');
      }
      if (rootChildren.length && !equal(product.originalTotalPrice, canonicalRow.commercial.baseAmountToman)) throw new Error('source-material-price-drift');
      if (used.length !== rootChildren.length) throw new Error('consumed-source-child-mismatch');
      const seenUsed = new Set<string>();
      for (const entry of used) {
        const child = rootChildren.find(p => entry.id === `used-${source(p).allocationId}`);
        if (!child || seenUsed.has(String(entry.id)) || !equal(entry.width, child.width) ||
          !equal(entry.length, child.length) || !equal(entry.quantity, child.quantity) ||
          !equal(entry.cuttingCost, child.cuttingCost)) throw new Error('consumed-source-child-mismatch');
        seenUsed.add(String(entry.id));
      }
      const originals = list(product.remainingStoneSourceInventory);
      if (!stocks.length || !originals.length) throw new Error('missing-source-inventory');
      for (const original of originals) {
        const matches = stocks.filter(s => geometryMatches(original, s));
        if (matches.length !== 1 || original.isAvailable !== true) throw new Error('ambiguous-source-geometry');
        const match = matches[0];
        const id = text(original.id);
        const quantity = integer(original.quantity);
        if (aliases.has(id)) throw new Error('duplicate-source-identity');
        addPool(match.remainingStoneId, quantity === 1 ? [id] : Array.from({ length: quantity }, (_, i) => `${id}:unit:${i + 1}`));
        aliases.set(id, match.remainingStoneId);
        initialGroupAliases.add(id);
      }
      for (const stock of stocks) {
        if (pools.get(stock.remainingStoneId)?.size !== stock.quantity ||
          !inventory.some(s => s.remainingStoneId === stock.remainingStoneId && s.quantity === stock.quantity)) {
          throw new Error('source-inventory-mismatch');
        }
      }
    }
    const orders = new Set<string>();
    const allocationIds = new Set<string>();
    const ordered = children.map(p => {
      affected = rowId(p);
      const s = source(p);
      const order = s.allocationOrder;
      if (typeof order !== 'number' || !Number.isSafeInteger(order) || order < 0 ||
        (p.remainingStoneAllocationOrder !== undefined && p.remainingStoneAllocationOrder !== order)) throw new Error('missing-allocation-order');
      const key = `${s.sourceProductRowId}:${order}`;
      if (orders.has(key)) throw new Error('duplicate-allocation-order');
      orders.add(key);
      return { p, order };
    }).sort((a, b) => a.order - b.order || rowId(a.p).localeCompare(rowId(b.p)));
    const allocations: CanonicalAllocation[] = [];
    const repairedRows = new Map<string, CanonicalProductRow>();
    for (const { p, order } of ordered) {
      affected = rowId(p);
      const s = source(p);
      const root = text(s.sourceProductRowId);
      const childRow = graph.rows.find(r => r.productRowId === affected);
      if (!childRow || p.parentProductRowId !== root || p.productId !== productsById.get(root)?.productId ||
        p.longitudinalPolicyInput !== undefined || p.isMandatory === true) throw new Error('contradictory-source-ownership');
      if (!equal(p.originalTotalPrice, 0) || !equal(record(record(p.meta).pricing).materialCost, 0)) throw new Error('unproven-zero-material');
      for (const value of [p.pricePerSquareMeter, p.unitPrice, p.mandatoryPercentage]) {
        if (value !== undefined && !equal(value, 0)) throw new Error('conflicting-material-price');
      }
      const allocationId = text(s.allocationId);
      if (allocationIds.has(allocationId)) throw new Error('duplicate-allocation-identity');
      allocationIds.add(allocationId);
      const selectedId = aliases.get(text(s.sourceRemainingStoneId));
      const selected = inventory.find(stock => stock.remainingStoneId === selectedId);
      const consumed = strings(s.consumedSourceStoneIds);
      const generated = strings(s.generatedRemainingStoneIds);
      const sourceSnapshot = record(s.sourceRemainingStone);
      if (!selected || !consumed.length || selected.ownerProductRowId !== root ||
        sourceSnapshot.id !== s.sourceRemainingStoneId || !geometryMatches(sourceSnapshot, selected) ||
        integer(sourceSnapshot.quantity) !== selected.quantity ||
        consumed.some(id => physicalToStock.get(id) !== selectedId || !pools.get(selectedId!)?.has(id))) {
        throw new Error('missing-or-already-consumed-source');
      }
      const quantity = integer(p.quantity);
      if (quantity !== s.allocatedQuantity || p.lengthUnit !== 'm' || p.widthUnit !== 'cm' ||
        !sameGeometry(p.length, selected.lengthMeters)) throw new Error('unsupported-physical-layout');
      const lengthMeters = canonical(decimal(p.length).toFixed());
      const widthMeters = canonical(decimal(p.width).div(100).toFixed());
      const pieces = list(s.physicalPieces);
      if (pieces.length !== quantity || pieces.some(piece => piece.quantity !== 1 ||
        !equal(piece.length, p.length) || !equal(piece.width, p.width)) ||
        !equal(p.squareMeters, decimal(p.length).times(decimal(p.width)).times(quantity).div(100).toFixed())) {
        throw new Error('physical-piece-evidence-mismatch');
      }
      if (p.sawKerfEnabled !== false && p.sawKerfEnabled !== true) throw new Error('missing-kerf-policy');
      const kerfMeters = p.sawKerfEnabled ? canonical(decimal(p.sawKerfCm).div(100).toFixed()) : canonical('0');
      const distribution = uniqueSourceDistribution(consumed, generated, selected.widthMeters, widthMeters, kerfMeters, quantity);
      const breakdown = list(p.cuttingBreakdown);
      if (new Set(breakdown.map(b => b.type)).size !== breakdown.length ||
        breakdown.some(b => !['longitudinal', 'cross', 'calibration'].includes(String(b.type)))) throw new Error('invalid-cutting-evidence');
      const rate = (type: string) => {
        const line = breakdown.find(b => b.type === type);
        return line ? canonical(decimal(line.rate).toFixed()) : undefined;
      };
      if (p.calibrationCutEnabled !== undefined && typeof p.calibrationCutEnabled !== 'boolean') throw new Error('missing-calibration-policy');
      const calibrationEnabled = p.calibrationCutEnabled === true || breakdown.some(b => b.type === 'calibration' && decimal(b.meters).gt(0));
      if (p.calibrationCutEnabled === false && calibrationEnabled) throw new Error('conflicting-calibration-evidence');
      const intent: RemainderChildIntent = {
        allocationId: parseStableIdentity('allocation', allocationId), allocationOrder: order,
        childProductRowId: childRow.productRowId, sourceProductRowId: parseStableIdentity('product-row', root),
        secondaryOwnerProductRowId: parseStableIdentity('product-row', root),
        selectedRemainingStoneId: selected.remainingStoneId, catalogProductId: childRow.catalogProductId,
        lengthMeters, widthMeters, quantity, kerfMeters, calibrationEnabled,
        sourcePieceQuantities: distribution,
        ...(rate('longitudinal') !== undefined ? { longitudinalCutRateToman: rate('longitudinal') } : {}),
        ...(rate('cross') !== undefined ? { crossCutRateToman: rate('cross') } : {}),
        ...(rate('calibration') !== undefined ? { calibrationCutRateToman: rate('calibration') } : {})
      };
      const replay = replayRemainderAllocations({ policyVersion: graph.calculationPolicy.packing,
        pricingPolicyVersion: graph.calculationPolicy.pricing, roundingPolicyVersion: graph.calculationPolicy.rounding,
        baseInventory: inventory, childIntents: [intent] });
      if (!replay.ok) throw new Error(replay.conflicts[0].code);
      const allocation = replay.result.allocations[0];
      for (const [type, meters] of [['longitudinal', allocation.packingPlan.longitudinalCutMeters],
        ['cross', allocation.packingPlan.crossCutMeters], ['calibration', allocation.packingPlan.calibrationMeters]]) {
        const line = breakdown.find(b => b.type === type);
        const calculated = allocation.cuttingPricingLines.find(b => b.lineId === `${allocationId}:${type}-cut`);
        if (line ? !equal(line.meters, meters) || !equal(line.cost, calculated?.amountToman ?? 0) : !equal(meters, 0)) {
          throw new Error('cutting-price-or-geometry-drift');
        }
      }
      if (!equal(p.cuttingCost, allocation.cuttingAmountToman)) throw new Error('cutting-price-drift');
      for (const amount of [p.physicalCuttingCost, record(record(p.meta).pricing).cuttingCost]) {
        if (amount !== undefined && !equal(amount, allocation.cuttingAmountToman)) throw new Error('cutting-price-drift');
      }
      const secondaries = replay.result.inventory.filter(stock => allocation.generatedRemainingStoneIds.includes(stock.remainingStoneId));
      const expectedGenerated = allocation.packingPlan.remainders.map(r => `${consumed[r.sourceOrdinal]}:secondary:1`);
      if (JSON.stringify([...expectedGenerated].sort()) !== JSON.stringify([...generated].sort()) || secondaries.length > 1) {
        throw new Error('secondary-lineage-mismatch');
      }
      for (const id of consumed) pools.get(selectedId!)!.delete(id);
      if (secondaries.length) addPool(secondaries[0].remainingStoneId, generated);
      inventory = [...replay.result.inventory];
      allocations.push({ ...allocation, intentSnapshot: intent });
      const groups = new Set(graph.operationGroups.filter(g => g.productRowId === affected).map(g => g.operationGroupId));
      const toolAmount = graph.toolSelections.filter(t => groups.has(t.operationGroupId)).reduce((sum, t) => sum.plus(t.amountToman), new Decimal(0));
      const finishingAmount = graph.finishingSelections.filter(f => groups.has(f.operationGroupId)).reduce((sum, f) => sum.plus(f.amountToman), new Decimal(0));
      const pricing = record(record(p.meta).pricing);
      for (const [actual, expected] of [[pricing.toolsCost, toolAmount], [pricing.finishingCost, finishingAmount],
        [p.totalSubServiceCost, toolAmount], [p.finishingCost, finishingAmount]]) {
        if (actual !== undefined && !equal(actual, String(expected))) throw new Error('operation-price-drift');
      }
      const total = decimal(allocation.cuttingAmountToman).plus(toolAmount).plus(finishingAmount);
      if (!equal(p.totalPrice, total.toFixed()) || (pricing.totalPrice !== undefined && !equal(pricing.totalPrice, total.toFixed()))) throw new Error('row-total-drift');
      repairedRows.set(affected, { ...childRow, commercial: { ...childRow.commercial,
        requestedLengthMeters: lengthMeters, requestedWidthMeters: widthMeters,
        requestedQuantity: canonical(String(quantity)), requestedAreaSquareMeters: canonical(decimal(p.squareMeters).toFixed()),
        baseRateToman: canonical('0'), baseAmountToman: canonical('0'), totalAmountToman: canonical(total.toFixed()),
        calculationSnapshot: { ...childRow.commercial.calculationSnapshot,
          materialPricing: { amountToman: '0', reason: 'paid-in-source-product' },
          remainderCutting: { allocationId, longitudinalMeters: allocation.packingPlan.longitudinalCutMeters,
            crossMeters: allocation.packingPlan.crossCutMeters, calibrationMeters: allocation.packingPlan.calibrationMeters,
            amountToman: allocation.cuttingAmountToman },
          recovery: { version: 'remaining-write-recovery-v1', consumedSourceStoneIds: consumed, generatedRemainingStoneIds: generated }
        }
      } });
    }
    for (const root of rootIds) {
      affected = root;
      const stocks = inventory.filter(s => s.ownerProductRowId === root);
      const legacy = list(productsById.get(root)!.remainingStones).filter(s => s.isAvailable === true);
      const hasChildAllocations = children.some(p => source(p).sourceProductRowId === root);
      const matched = new Map<string, number>();
      for (const remaining of legacy) {
        const candidates = stocks.filter(s => geometryMatches(remaining, s) &&
          (!hasChildAllocations || (aliases.get(String(remaining.id)) === s.remainingStoneId &&
          pools.get(s.remainingStoneId)?.size === s.quantity &&
          (pools.get(s.remainingStoneId)?.has(String(remaining.id)) || initialGroupAliases.has(String(remaining.id))))));
        if (candidates.length !== 1) throw new Error('final-inventory-mismatch');
        const id = candidates[0].remainingStoneId;
        matched.set(id, (matched.get(id) ?? 0) + integer(remaining.quantity));
      }
      if (stocks.some(s => matched.get(s.remainingStoneId) !== s.quantity)) throw new Error('final-inventory-mismatch');
    }
    const rows = graph.rows.map(r => repairedRows.get(r.productRowId) ?? r);
    for (const row of rows) {
      affected = row.productRowId;
      // Same whole-toman monetary reconciliation as legacyMigration; this is not geometric tolerance.
      if (!decimal(row.commercial.totalAmountToman).toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        .eq(decimal(productsById.get(affected)?.totalPrice).toDecimalPlaces(0, Decimal.ROUND_HALF_UP))) throw new Error('row-total-drift');
    }
    return { ok: true, graph: { ...graph, rows, remainingStones: inventory, allocations } };
  } catch (error) {
    return { ok: false, conflicts: [{ code: 'legacy-remaining-recovery-required',
      path: ['products', affected, 'remainingSource'], productRowId: affected,
      causeCode: error instanceof Error ? error.message : 'invalid-remaining-evidence',
      message: 'Remaining-stone evidence cannot be reconstructed without changing consumption or money.' }] };
  }
};
