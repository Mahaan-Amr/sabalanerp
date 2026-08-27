import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planLegacyProductGraphMigration } from '../legacyMigration';
import { projectCanonicalProductGraph } from '../projections';
import { parseCanonicalProductGraph, serializeCanonicalProductGraph } from '../productGraphSerialization';
import { replayRemainderAllocations } from '../remainderPolicy';
import { executeProductGraphCommand } from '../productGraph';
import { parseStableIdentity } from '../stableIdentity';
import { readLegacyProductGraph } from '../legacyReadAdapter';
import { calculateStairLayerConfiguration } from '../stairLayerPolicy';

const products = JSON.parse(readFileSync(`${__dirname}/fixtures/remaining-child-chain.json`, 'utf8'));
const policy = { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v2' };
const input = { contractId: 'remaining-recovery-regression', revision: 1, calculationPolicy: policy, products,
  recoverRemainingChildrenOnWrite: true };
const before = JSON.stringify(products);
const plan = planLegacyProductGraphMigration(input);
assert.ok(plan.ok, JSON.stringify(plan.ok ? {} : plan.conflicts));
if (!plan.ok) throw new Error('Recovery failed');
const projection = projectCanonicalProductGraph(plan.graph, 'accounting');
assert.deepEqual(projection.products.slice(1, 4).map(row => row.baseAmountToman), ['0', '0', '0']);
assert.equal(plan.graph.allocations.length, 3);
assert.deepEqual(plan.graph.allocations.map(a => a.consumedSourcePieces), [5, 5, 1]);
assert.deepEqual(plan.graph.rows.map(row => row.commercial.totalAmountToman),
  ['6545000', '125000', '125000', '100000', '16176875']);
assert.deepEqual(plan.graph.remainingStones.map(s => [s.widthMeters, s.quantity]).sort(),
  [['0.001', 5], ['0.02', 1], ['0.03', 11]].sort());
assert.equal(JSON.stringify(products), before, 'Recovery must never mutate the submitted draft');
assert.deepEqual(parseCanonicalProductGraph(JSON.parse(serializeCanonicalProductGraph(plan.graph))), plan.graph);
for (const audience of ['step5', 'confirmation', 'pdf', 'accounting', 'workshop', 'delivery', 'logistics'] as const) {
  const rows: ReturnType<typeof projectCanonicalProductGraph>['products'] = projectCanonicalProductGraph(plan.graph, audience).products;
  assert.deepEqual(rows.slice(1, 4).map(row => row.baseAmountToman), ['0', '0', '0'], `${audience} retains zero paid-material charge`);
}
const tamperedDistribution = JSON.parse(serializeCanonicalProductGraph(plan.graph));
tamperedDistribution.allocations[0].intentSnapshot.sourcePieceQuantities = [2, 2];
assert.throws(() => parseCanonicalProductGraph(tamperedDistribution), /distribution/);
const tamperedOwner = JSON.parse(serializeCanonicalProductGraph(plan.graph));
tamperedOwner.allocations[0].intentSnapshot.secondaryOwnerProductRowId = 'unrelated-owner';
assert.throws(() => parseCanonicalProductGraph(tamperedOwner), /owner/);
assert.deepEqual(planLegacyProductGraphMigration(input), plan, 'Recovery must be deterministic');
const replay = replayRemainderAllocations({ policyVersion: policy.packing, pricingPolicyVersion: policy.pricing,
  roundingPolicyVersion: policy.rounding, baseInventory: plan.graph.sourceBatches.flatMap(b => b.initialRemainders ?? []),
  childIntents: plan.graph.allocations.map(a => a.intentSnapshot!) });
assert.ok(replay.ok);
if (replay.ok) assert.deepEqual(replay.result.inventory, plan.graph.remainingStones, 'Saved allocation intents replay exactly');
const deleteIndependent = executeProductGraphCommand({ graph: plan.graph, command: {
  commandId: parseStableIdentity('audit-mutation', 'test-delete-independent'), type: 'delete-row',
  baseRevision: plan.graph.revision, calculationPolicy: plan.graph.calculationPolicy,
  sellerIntent: { productRowId: plan.graph.rows[4].productRowId }, catalogSnapshots: []
} });
assert.ok(deleteIndependent.ok, JSON.stringify(deleteIndependent.ok ? {} : deleteIndependent.conflicts));
if (deleteIndependent.ok) {
  assert.deepEqual(deleteIndependent.graph.allocations, plan.graph.allocations, 'Editing an independent product preserves allocation lineage');
  assert.deepEqual(deleteIndependent.graph.remainingStones, plan.graph.remainingStones.filter(s => s.ownerProductRowId !== plan.graph.rows[4].productRowId));
}
const deleteProducer = executeProductGraphCommand({ graph: plan.graph, command: {
  commandId: parseStableIdentity('audit-mutation', 'test-delete-secondary-producer'), type: 'delete-row',
  baseRevision: plan.graph.revision, calculationPolicy: plan.graph.calculationPolicy,
  sellerIntent: { productRowId: plan.graph.rows[1].productRowId }, catalogSnapshots: []
} });
assert.equal(deleteProducer.ok, false, 'Cannot remove a producer while another child consumes its secondary stone');
const blocked = (name: string, mutate: (p: any[]) => void, cause?: string) => {
  const changed = structuredClone(products);
  mutate(changed);
  const snapshot = JSON.stringify(changed);
  const result = planLegacyProductGraphMigration({ ...input, products: changed });
  assert.equal(result.ok, false, name);
  if (!result.ok && cause) assert.ok(result.conflicts.some(c => 'causeCode' in c && c.causeCode === cause), `${name}: ${JSON.stringify(result.conflicts)}`);
  assert.equal(JSON.stringify(changed), snapshot, `${name}: draft preserved`);
};
blocked('missing allocation order', p => delete p[1].meta.remainingSource.allocationOrder, 'missing-allocation-order');
blocked('duplicate order', p => { p[2].meta.remainingSource.allocationOrder = 0; p[2].remainingStoneAllocationOrder = 0; }, 'duplicate-allocation-order');
blocked('nonzero material is not coerced', p => p[1].originalTotalPrice = 1, 'unproven-zero-material');
blocked('unknown material is not zero', p => p[1].meta.pricing.materialCost = null, 'missing-numeric-evidence');
blocked('unknown cutting rate is not guessed', p => delete p[1].cuttingBreakdown[0].rate, 'missing-numeric-evidence');
blocked('changed rate cannot silently reprice', p => p[1].cuttingBreakdown[0].rate = 21000, 'cutting-price-or-geometry-drift');
blocked('missing lineage', p => delete p[2].meta.remainingSource.consumedSourceStoneIds, 'missing-physical-lineage');
blocked('duplicate physical consumption', p => p[1].meta.remainingSource.consumedSourceStoneIds[1] = p[1].meta.remainingSource.consumedSourceStoneIds[0], 'duplicate-physical-lineage');
blocked('already consumed primary source', p => p[2].meta.remainingSource.consumedSourceStoneIds[0] = p[1].meta.remainingSource.consumedSourceStoneIds[0], 'missing-or-already-consumed-source');
blocked('unknown generated identity', p => p[1].meta.remainingSource.generatedRemainingStoneIds[0] = 'invented-stone', 'secondary-lineage-mismatch');
blocked('resurrected consumed stock', p => p[0].remainingStones.push(p[0].remainingStoneSourceInventory[0]), 'final-inventory-mismatch');
blocked('lost final inventory', p => p[0].remainingStones.pop(), 'final-inventory-mismatch');
blocked('different catalog', p => p[1].productId = 'wrong-catalog', 'contradictory-source-ownership');
blocked('missing source witness', p => delete p[0].remainingStoneSourceInventory, 'missing-source-inventory');
blocked('geometry beyond floating point residue', p => p[0].remainingStoneSourceInventory[0].width += 0.001, 'ambiguous-source-geometry');
blocked('compensating row drift is rejected', p => { p[0].totalPrice += 1; p[4].totalPrice -= 1; }, 'row-total-drift');
blocked('operation amount missing canonical operations', p => { p[1].meta.pricing.toolsCost = 100; p[1].totalPrice += 100; }, 'operation-price-drift');
blocked('missing consumed child never replenishes inventory', p => { p.splice(1, 3); p[0].remainingStones = p[0].remainingStoneSourceInventory; }, 'consumed-source-child-mismatch');
blocked('unrepresented historical consumption', p => p[0].usedRemainingStones.push({ ...p[0].usedRemainingStones[0], id: 'used-missing-child' }), 'consumed-source-child-mismatch');
blocked('source material price contradiction', p => p[0].originalTotalPrice += 1, 'source-material-price-drift');
blocked('missing children and usage cache cannot hide consumed inventory', p => {
  p.splice(1, 3); p[0].usedRemainingStones = [];
}, 'final-inventory-mismatch');
{
  const partial = structuredClone(products);
  const [root, first, second] = partial;
  const firstSource = first.meta.remainingSource;
  firstSource.consumedSourceStoneIds = firstSource.consumedSourceStoneIds.slice(0, 3);
  firstSource.generatedRemainingStoneIds = [firstSource.generatedRemainingStoneIds[2]];
  const generatedId = firstSource.generatedRemainingStoneIds[0];
  const repriceCut = (p: any, meters: number) => {
    p.totalPrice = p.cuttingCost = p.physicalCuttingCost = meters * 20000;
    p.cuttingBreakdown = [{ type: 'longitudinal', meters, rate: 20000, cost: p.cuttingCost }];
    p.meta.pricing.totalPrice = p.meta.pricing.cuttingCost = p.cuttingCost;
  };
  repriceCut(first, 3.75);
  second.quantity = 1;
  second.squareMeters = 0.07375;
  second.meta.remainingSource.allocatedQuantity = 1;
  second.meta.remainingSource.physicalPieces = second.meta.remainingSource.physicalPieces.slice(0, 1);
  second.meta.remainingSource.sourceRemainingStoneId = generatedId;
  second.meta.remainingSource.sourceRemainingStone.id = generatedId;
  second.meta.remainingSource.sourceRemainingStone.quantity = 1;
  second.meta.remainingSource.consumedSourceStoneIds = [generatedId];
  second.meta.remainingSource.generatedRemainingStoneIds = [`${generatedId}:secondary:1`];
  repriceCut(second, 1.25);
  root.usedRemainingStones.forEach((used: any, index: number) => {
    const child = partial[index + 1];
    used.quantity = child.quantity; used.cuttingCost = child.cuttingCost;
    used.physicalPieces = child.meta.remainingSource.physicalPieces;
  });
  root.remainingStones = [{ ...root.remainingStoneSourceInventory[0], quantity: 2 },
    { ...root.remainingStones[0], id: `${generatedId}:secondary:1`, quantity: 1 }, root.remainingStones[1]];
  const result = planLegacyProductGraphMigration({ ...input, products: partial });
  assert.ok(result.ok, JSON.stringify(result.ok ? {} : result.conflicts));
  if (result.ok) {
    assert.deepEqual(result.graph.allocations[0].intentSnapshot?.sourcePieceQuantities, [2, 2, 1]);
    assert.ok(result.graph.remainingStones.some(s => s.widthMeters === '0.12' && s.quantity === 2), 'Unused original units remain available without restoring consumed units');
  }
}
const historical = planLegacyProductGraphMigration({ ...input, recoverRemainingChildrenOnWrite: false });
assert.ok(historical.ok);
if (historical.ok) assert.equal(historical.graph.allocations.length, 0, 'Read/migration behavior remains opt-in');
{
  const stair = structuredClone(products[4]);
  const base = readLegacyProductGraph({ ...input, products: [stair], recoverRemainingChildrenOnWrite: false });
  assert.ok(base.ok);
  if (!base.ok) throw new Error('Stair source fixture invalid');
  const layerInput = {
    calculationPolicyVersion: policy.calculation, packingPolicyVersion: policy.packing, pricingPolicyVersion: policy.pricing,
    roundingPolicyVersion: policy.rounding, layerConfigurationId: 'review-layer', parentProductRowId: stair.rowId,
    sourceBatchId: 'review-layer-source', creationOrder: 1, layerCatalogItemId: 'layer-double',
    layerCatalogSnapshotVersion: 'layer-catalog-v1', layerTitle: 'Double layer', layerUnit: 'set', layerRateToman: '80000',
    layersPerParentPiece: 1, widthMeters: '0.01', widthDisplayUnit: 'cm', targetSides: ['front'],
    source: { kind: 'paid-remainder', selectedRemainingStoneIds: [base.graph.remainingStones[0].remainingStoneId] },
    kerfMeters: '0', calibrationEnabled: false, longitudinalCutRateToman: '100', crossCutRateToman: '100',
    calibrationCutRateToman: '100', sideOperations: []
  } as any;
  const layer = calculateStairLayerConfiguration({ input: layerInput,
    parent: { lengthMeters: '1.25', crossDimensionMeters: '0.32', quantity: 11 } as any,
    availableInventory: base.graph.remainingStones });
  assert.ok(layer.ok);
  if (!layer.ok) throw new Error('Layer fixture invalid');
  const layerRow = { rowId: 'review-layer', productId: stair.productId, productType: 'stair', parentProductRowId: stair.rowId,
    totalPrice: Number(layer.result.totalAmountToman), meta: { isLayer: true, layerSourcePlan: { canonicalInput: layerInput } } };
  const rows = [stair, layerRow];
  const old = planLegacyProductGraphMigration({ ...input, products: rows, recoverRemainingChildrenOnWrite: false });
  const repaired = planLegacyProductGraphMigration({ ...input, products: rows });
  assert.ok(old.ok);
  assert.deepEqual(repaired, old, 'Canonical layer-only allocation is already owned by layer replay, not legacy child recovery');
}
{
  const independent = structuredClone(products[4]);
  independent.originalTotalPrice += 0.000000001;
  independent.remainingStones[0].id = 'previous-ui-generated-id';
  const result = planLegacyProductGraphMigration({ ...input, products: [independent] });
  assert.ok(result.ok, 'A source with no remaining children does not enter paid-child price recovery');
}
{
  const legacyIndependent = structuredClone(products[4]);
  delete legacyIndependent.stairPartPolicyInput;
  delete legacyIndependent.operationPolicyInput;
  const old = planLegacyProductGraphMigration({ ...input, products: [legacyIndependent], recoverRemainingChildrenOnWrite: false });
  assert.ok(old.ok, JSON.stringify(old));
  assert.deepEqual(planLegacyProductGraphMigration({ ...input, products: [legacyIndependent] }), old,
    'Unrelated historical source without a canonical source policy is not forced into child recovery');
}
console.log('remaining child recovery regression passed');
