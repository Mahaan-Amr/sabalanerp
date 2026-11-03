import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountingRecordStatus, FinancialRecordKind, Prisma } from '@prisma/client';
import { projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import {
  buildApprovedPricingVersion,
  canonicalApprovedPricingHash,
  sealApprovedPricing,
} from '../approvedPricing/domain';
import {
  APPROVED_PRICING_FIXTURE_EXPECTED,
  approvedPricingSourceFixture,
} from '../approvedPricing/fixtures';
import type {
  ApprovedPricingRepository,
  ApprovedPricingSource,
  ApprovedPricingVersionInsert,
  ApprovedPricingVersionRecord,
} from '../approvedPricing/types';
import {
  canonicalOptimizerDerivedLengthWitness,
  optimizerQuantityPolicyProvenanceFromAudit,
  OptimizerQuantityEvidenceConflictError,
} from '../optimizerDerivedQuantityEvidence';
import {
  bindFrozenRowsToPostSnapshotCanonicalGraph,
  bindLegacyRowsToMigratedGraph,
  financialCommercialSnapshotMatches,
  reconstructLegacyV1DiscountEligibility,
  reconstructLegacyV1Pricing,
  reconstructLegacyV1Quantity,
  rebindFrozenContractItemIdentities,
  resolveFinancialApprovalGraphEvidence,
} from '../approvedPricing/prismaRepository';
import {
  ApprovedPricingEvidenceError,
  asApprovedPricingEvidenceError,
} from '../approvedPricing/evidenceError';
import { resolveCommercialQuantityPolicy } from '../commercialQuantityPolicy';
import { approvedPricingOperationalContractItemId } from '../approvedPricing/prismaEvidence';

test('keeps frozen pricing identity for integrity while exposing the live item operationally', () => {
  assert.equal(approvedPricingOperationalContractItemId({
    contractItemId: 'frozen-item',
    linkedContractItemId: 'live-item',
  }), 'live-item');
  assert.equal(approvedPricingOperationalContractItemId({
    contractItemId: 'ordinary-live-item',
    linkedContractItemId: 'ordinary-live-item',
  }), 'ordinary-live-item');
  assert.equal(approvedPricingOperationalContractItemId({
    contractItemId: 'recovered-frozen-item',
    linkedContractItemId: null,
  }), 'recovered-frozen-item');
});

test('rebinds a frozen source identity to the live item only through its stable product row', () => {
  const result = rebindFrozenContractItemIdentities({
    snapshotItems: [{ id: 'frozen-item', productId: 'product-1', productRowId: 'row-1', productType: 'longitudinal' }],
    liveItems: [{ id: 'live-item', productId: 'product-1', productRowId: 'row-1', productType: 'longitudinal' }],
    invoiceItems: [{ id: 'invoice-item', contractItemId: 'frozen-item' }],
  });

  assert.equal(result.idMap.get('frozen-item'), 'live-item');
  assert.deepEqual(result.rebindings, [{
    sourceContractItemId: 'frozen-item',
    linkedContractItemId: 'live-item',
    invoiceItemId: 'invoice-item',
    productRowId: 'row-1',
    rule: 'FROZEN_STABLE_PRODUCT_ROW_LIVE_ITEM_REBINDING_V1',
  }]);
});

test('rejects frozen identity rebinding when product identity is not exact', () => {
  assert.throws(() => rebindFrozenContractItemIdentities({
    snapshotItems: [{ id: 'frozen-item', productId: 'product-1', productRowId: 'row-1', productType: 'longitudinal' }],
    liveItems: [{ id: 'live-item', productId: 'different-product', productRowId: 'row-1', productType: 'longitudinal' }],
    invoiceItems: [{ id: 'invoice-item', contractItemId: 'frozen-item' }],
  }), ApprovedPricingEvidenceError);
});

const longitudinalCommercialPolicy = (roundingPolicy: 'rounding-v1' | 'rounding-v2') =>
  resolveCommercialQuantityPolicy({ graphSchemaVersion: 1, roundingPolicy, productFamily: 'longitudinal' });

test('defines versioned piece, measured, and billable roles for every canonical product family', () => {
  assert.deepEqual(resolveCommercialQuantityPolicy({
    graphSchemaVersion: 1,
    roundingPolicy: 'rounding-v2',
    productFamily: 'prepared',
    commercialUnit: 'count',
  }).billableQuantity, {
    role: 'BILLABLE_QUANTITY', basis: 'PIECE_COUNT', unit: 'count', scale: 0,
  });
  assert.equal(resolveCommercialQuantityPolicy({ graphSchemaVersion: 1, roundingPolicy: 'rounding-v1',
    productFamily: 'prepared', commercialUnit: 'ton' }).billableQuantity.scale, 3);
  for (const productFamily of ['longitudinal', 'slab']) {
    const policy = resolveCommercialQuantityPolicy({ graphSchemaVersion: 1, roundingPolicy: 'rounding-v1', productFamily });
    assert.equal(policy.version, 'commercial-quantity-v1');
    assert.equal(policy.pieceCount.scale, 0);
    assert.equal(policy.billableQuantity.basis, 'MEASURED_QUANTITY');
    assert.equal(policy.billableQuantity.scale, 3);
  }
  for (const productFamily of ['stair', 'volumetric']) {
    const policy = resolveCommercialQuantityPolicy({ graphSchemaVersion: 1, roundingPolicy: 'rounding-v1', productFamily });
    assert.equal(policy.billableQuantity.basis, 'PIECE_COUNT');
    assert.equal(policy.billableQuantity.unit, 'count');
    assert.equal(policy.billableQuantity.scale, 0);
  }
  assert.throws(() => resolveCommercialQuantityPolicy({
    graphSchemaVersion: 1,
    roundingPolicy: 'rounding-v2',
    productFamily: 'unknown',
  }), ApprovedPricingEvidenceError);
});

test('only typed evidence failures can become a financial review case', () => {
  const evidenceFailure = new ApprovedPricingEvidenceError('frozen evidence conflict');
  assert.equal(asApprovedPricingEvidenceError(evidenceFailure), evidenceFailure);
  assert.equal(asApprovedPricingEvidenceError(new globalThis.Error('database or programming failure')), null);
});

test('financial staleness follows commercial evidence instead of the contract lifecycle timestamp', () => {
  const snapshot = { customerId: 'customer-1', currency: 'تومان', totalAmount: '1250', contractData: { products: [{ id: 'p1' }] } };
  const current = { customerId: 'customer-1', currency: 'تومان', totalAmount: new Prisma.Decimal('1250.00'), contractData: { products: [{ id: 'p1' }] } };
  assert.equal(financialCommercialSnapshotMatches({ snapshot, current }), true);
  assert.equal(financialCommercialSnapshotMatches({ snapshot, current: { ...current, contractData: { products: [{ id: 'changed' }] } } }), false);
});

test('financial staleness excludes live CRM navigation collections on both sides of the snapshot boundary', () => {
  const customerFacts = { id: 'customer-1', companyName: 'مشتری نمونه', nationalCode: '0012345678' };
  const snapshot = {
    customerId: 'customer-1', currency: 'تومان', totalAmount: '1250',
    contractData: { products: [{ id: 'p1' }], customer: customerFacts },
  };
  const current = {
    customerId: 'customer-1', currency: 'تومان', totalAmount: new Prisma.Decimal('1250'),
    contractData: {
      products: [{ id: 'p1' }],
      customer: { ...customerFacts, contracts: [{ id: 'unrelated-history' }], projectAddresses: [{ id: 'live-crm-navigation' }] },
    },
  };
  assert.equal(financialCommercialSnapshotMatches({ snapshot, current }), true);
  assert.equal(financialCommercialSnapshotMatches({
    snapshot,
    current: { ...current, contractData: { ...current.contractData, customer: { ...current.contractData.customer, nationalCode: '0099999999' } } },
  }), false);
});

test('accepts a missing draft graph snapshot only from the exact deterministic legacy migration audit', () => {
  const currentGraphState = {
    schemaVersion: 1,
    revision: 1,
    graph: { schemaVersion: 1 },
    inputHash: 'same-hash',
    resultHash: 'same-hash',
    totalAmountToman: '100',
  };
  const resolved = resolveFinancialApprovalGraphEvidence({
    snapshotGraphState: null,
    currentGraphState,
    migrationAudit: {
      commandId: 'legacy-migration:contract-1:same-hash',
      resultRevision: 1,
      inputHash: 'same-hash',
      resultHash: 'same-hash',
      command: { kind: 'legacy-migration', backupReference: 'verified-backup' },
    },
  });
  assert.equal(resolved.graphState, currentGraphState);
  assert.deepEqual(resolved.compatibility, {
    evidenceOrigin: 'POST_SNAPSHOT_DETERMINISTIC_LEGACY_GRAPH_MIGRATION',
    migrationAuditCommandId: 'legacy-migration:contract-1:same-hash',
    snapshotOriginallyMissing: true,
  });
});

test('accepts a post-snapshot canonical graph only from its exact audited writer revision and hashes', () => {
  const currentGraphState = {
    schemaVersion: 1, revision: 2, graph: { schemaVersion: 1 },
    inputHash: 'canonical-hash', resultHash: 'canonical-hash', totalAmountToman: '100',
  };
  const resolved = resolveFinancialApprovalGraphEvidence({
    snapshotGraphState: null,
    currentGraphState,
    migrationAudit: {
      commandId: 'wizard-save:contract-1:2:canonical-hash', resultRevision: 2,
      inputHash: 'canonical-hash', resultHash: 'canonical-hash',
      command: { kind: 'canonical-wizard-save' },
    },
  });
  assert.equal(resolved.graphState, currentGraphState);
  assert.equal(resolved.compatibility?.evidenceOrigin, 'POST_SNAPSHOT_DETERMINISTIC_CANONICAL_GRAPH_BINDING');
  assert.throws(() => resolveFinancialApprovalGraphEvidence({
    snapshotGraphState: null,
    currentGraphState,
    migrationAudit: {
      commandId: 'wizard-save:contract-1:2:wrong', resultRevision: 2,
      inputHash: 'wrong', resultHash: 'canonical-hash', command: { kind: 'canonical-wizard-save' },
    },
  }), /no matching deterministic legacy migration/);
});

test('binds frozen rows to a later canonical graph only by a unique complete commercial tuple', () => {
  const binding = bindFrozenRowsToPostSnapshotCanonicalGraph({
    contractData: { products: [
      { productId: 'product-1', productType: 'longitudinal', quantity: '9375', totalPrice: '3000000000' },
      { productId: 'product-1', productType: 'longitudinal', quantity: '6250', totalPrice: '3000000000' },
    ] },
    snapshotItems: [
      { id: 'item-1', productId: 'product-1', productType: 'longitudinal', quantity: '9375', totalPrice: '3000000000' },
      { id: 'item-2', productId: 'product-1', productType: 'longitudinal', quantity: '6250', totalPrice: '3000000000' },
    ],
    graphRows: [
      { productRowId: 'row-b', catalogProductId: 'product-1', productType: 'longitudinal', legacySnapshot: { productId: 'product-1', productType: 'longitudinal', quantity: '6250', totalPrice: '3000000000' } },
      { productRowId: 'row-a', catalogProductId: 'product-1', productType: 'longitudinal', legacySnapshot: { productId: 'product-1', productType: 'longitudinal', quantity: '9375', totalPrice: '3000000000' } },
    ],
  });
  assert.deepEqual(binding.snapshotItems.map(item => item.productRowId), ['row-a', 'row-b']);
  assert.deepEqual(binding.assignments.map(assignment => assignment.rule), [
    'FROZEN_ITEM_AND_PRODUCT_UNIQUE_COMMERCIAL_TUPLE_V1',
    'FROZEN_ITEM_AND_PRODUCT_UNIQUE_COMMERCIAL_TUPLE_V1',
  ]);
  assert.throws(() => bindFrozenRowsToPostSnapshotCanonicalGraph({
    contractData: { products: [
      { productId: 'product-1', productType: 'longitudinal', quantity: '50', totalPrice: '100' },
      { productId: 'product-1', productType: 'longitudinal', quantity: '50', totalPrice: '100' },
    ] },
    snapshotItems: [
      { id: 'item-1', productId: 'product-1', productType: 'longitudinal', quantity: '50', totalPrice: '100' },
      { id: 'item-2', productId: 'product-1', productType: 'longitudinal', quantity: '50', totalPrice: '100' },
    ],
    graphRows: [
      { productRowId: 'row-a', catalogProductId: 'product-1', productType: 'longitudinal', legacySnapshot: { productId: 'product-1', productType: 'longitudinal', quantity: '50', totalPrice: '100' } },
      { productRowId: 'row-b', catalogProductId: 'product-1', productType: 'longitudinal', legacySnapshot: { productId: 'product-1', productType: 'longitudinal', quantity: '50', totalPrice: '100' } },
    ],
  }), /no unique canonical graph witness/);
});

test('reconstructs legacy v1 quantities from typed product evidence at scale three', () => {
  const length = reconstructLegacyV1Quantity({
    productRowId: 'legacy-row-1', productType: 'longitudinal',
    productSnapshot: { length: '58.33333333333334', quantity: '1', lengthUnit: 'm' },
  });
  assert.equal(length.requestedLengthMeters, '58.333');
  assert.equal(length.normalization.rawValue, '58.33333333333334');
  assert.equal(length.normalization.rule, 'LEGACY_GRAPH_V1_ROUND_HALF_UP_SCALE_THREE');
  const slab = reconstructLegacyV1Quantity({
    productRowId: 'legacy-row-2', productType: 'slab',
    productSnapshot: { squareMeters: '12.3456' },
  });
  assert.equal(slab.requestedAreaSquareMeters, '12.346');
});

test('reconstructs missing legacy discount eligibility only when the canonical graph has no layers', () => {
  const reconstructed = reconstructLegacyV1DiscountEligibility({
    contractData: { products: [{ rowId: 'row-1', meta: { pricing: {} } }] },
    graphRows: [{ productRowId: 'row-1' }],
    layerConfigurationCount: 0,
  });
  assert.equal((reconstructed.contractData as any).products[0].meta.isLayer, false);
  assert.deepEqual(reconstructed.assignments, [{
    productRowId: 'row-1',
    rawIsLayer: null,
    sealedIsLayer: false,
    rule: 'LEGACY_GRAPH_V1_EMPTY_LAYER_CONFIGURATION_NON_LAYER',
  }]);
  assert.throws(() => reconstructLegacyV1DiscountEligibility({
    contractData: { products: [{ rowId: 'row-1', meta: {} }] },
    graphRows: [{ productRowId: 'row-1' }],
    layerConfigurationCount: 1,
  }), /layer configurations exist/);
});

test('reconstructs legacy v1 monetary components with audited half-up Toman conversion', () => {
  const pricing = reconstructLegacyV1Pricing({
    productRowId: 'legacy-row-1',
    rawTotalAmountToman: '132500000.0000000001',
    productSnapshot: {
      currency: 'تومان', originalTotalPrice: '95000000', cuttingCost: '0',
      totalSubServiceCost: '0', finishingId: 'finish-1', finishingCost: '37500000',
      isMandatory: false, mandatoryPercentage: '20', appliedSubServices: [],
    },
  });
  assert.equal(pricing.baseAmountToman, '95000000');
  assert.equal(pricing.totalAmountToman, '132500000');
  assert.equal(pricing.normalization.difference, '-0.0000000001');
  assert.deepEqual(pricing.pricingComponents, [{
    id: 'base-material', kind: 'base-material', amountToman: '95000000',
  }, {
    id: 'legacy-finishing', kind: 'legacy-finishing', amountToman: '37500000',
  }]);
  assert.throws(() => reconstructLegacyV1Pricing({
    productRowId: 'legacy-row-1',
    rawTotalAmountToman: '132500001',
    productSnapshot: {
      currency: 'تومان', originalTotalPrice: '95000000', cuttingCost: '0',
      totalSubServiceCost: '0', finishingId: 'finish-1', finishingCost: '37500000',
      isMandatory: false, mandatoryPercentage: '20', appliedSubServices: [],
    },
  }), /do not reconcile/);
});

test('reconstructs graph-v1 stair cutting from its duplicated physical and tool lines', () => {
  const pricing = reconstructLegacyV1Pricing({
    productRowId: 'legacy-stair-1',
    rawTotalAmountToman: '2758000',
    productSnapshot: {
      productType: 'stair', currency: 'تومان', originalTotalPrice: '2730000',
      cuttingCost: '14000', totalSubServiceCost: '0', finishingId: null,
      isMandatory: false, mandatoryPercentage: '0', appliedSubServices: [],
      meta: { stair: { baseStoneQuantity: '2' }, tools: [{ toolId: 'cut-cross-1', totalPrice: '14000' }] },
    },
  });
  assert.equal(pricing.totalAmountToman, '2758000');
  assert.deepEqual(pricing.normalization.componentConversions, [{
    component: 'cutting', rawValue: '14000', duplicatedToolValue: '14000', sealedValue: '28000',
    difference: '14000', rule: 'LEGACY_STAIR_V1_CUTTING_PHYSICAL_AND_TOOL_LINES',
  }]);
});

test('rejects a missing draft graph snapshot when migration provenance does not match', () => {
  assert.throws(() => resolveFinancialApprovalGraphEvidence({
    snapshotGraphState: null,
    currentGraphState: {
      schemaVersion: 1,
      revision: 1,
      graph: { schemaVersion: 1 },
      inputHash: 'current-hash',
      resultHash: 'current-hash',
      totalAmountToman: '100',
    },
    migrationAudit: {
      commandId: 'legacy-migration:contract-1:other-hash',
      resultRevision: 1,
      inputHash: 'other-hash',
      resultHash: 'other-hash',
      command: { kind: 'legacy-migration' },
    },
  }), /no matching deterministic legacy migration/);
});

test('binds missing legacy row identities only by matching migrated ordinal and product identity', () => {
  const binding = bindLegacyRowsToMigratedGraph({
    contractData: { products: [{ productId: 'product-1', totalPrice: '100' }] },
    snapshotItems: [{ id: 'item-1', productId: 'product-1', productRowId: null }],
    currentItems: [{ id: 'item-1', productId: 'product-1', productRowId: null }],
    graphRows: [{ productRowId: 'migrated-row-1', catalogProductId: 'product-1' }],
  });
  assert.equal((binding.contractData as any).products[0].rowId, 'migrated-row-1');
  assert.equal(binding.snapshotItems[0]?.productRowId, 'migrated-row-1');
  assert.deepEqual(binding.assignments, [{
    contractItemId: 'item-1',
    productRowId: 'migrated-row-1',
    rawContractItemProductRowId: null,
    rawProductSnapshotRowId: null,
    rule: 'MIGRATED_GRAPH_ORDINAL_PRODUCT_IDENTITY_V1',
  }]);
  assert.throws(() => bindLegacyRowsToMigratedGraph({
    contractData: { products: [{ productId: 'different-product' }] },
    snapshotItems: [{ id: 'item-1', productId: 'product-1', productRowId: null }],
    currentItems: [{ id: 'item-1', productId: 'product-1', productRowId: null }],
    graphRows: [{ productRowId: 'migrated-row-1', catalogProductId: 'product-1' }],
  }), /does not match/);
});

class MemoryRepository implements ApprovedPricingRepository {
  readonly versions: ApprovedPricingVersionRecord[] = [];
  private tail: Promise<void> = Promise.resolve();

  constructor(readonly sources: Map<string, ApprovedPricingSource>) {}

  async readApprovalLeaf(id: string) { return this.sources.get(id)?.leaf ?? null; }
  async withContractLock<T>(_contractId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }
  async findByApproval(contractId: string, financialRecordId: string) {
    return this.versions.find(item => item.contractId === contractId && item.sourceFinancialRecordId === financialRecordId) ?? null;
  }
  async loadSource(id: string) { return this.sources.get(id) ?? null; }
  async nextVersionNumber(contractId: string) {
    return Math.max(0, ...this.versions.filter(item => item.contractId === contractId).map(item => item.versionNumber)) + 1;
  }
  async insertAndAdvance(version: ApprovedPricingVersionInsert) {
    this.versions.push(version);
    return version;
  }
}

test('freezes scale-three quantity, all-in attached costs, discount, context, and stable hashes', () => {
  const version = buildApprovedPricingVersion(approvedPricingSourceFixture(), 1, APPROVED_PRICING_FIXTURE_EXPECTED.versionId);
  assert.equal(version.grossAmount, APPROVED_PRICING_FIXTURE_EXPECTED.grossAmount);
  assert.equal(version.discountAmount, APPROVED_PRICING_FIXTURE_EXPECTED.discountAmount);
  assert.equal(version.netAmount, APPROVED_PRICING_FIXTURE_EXPECTED.netAmount);
  assert.deepEqual(version.rows[0]?.componentEvidence, {
    base: '1000.000000000000',
    discountBasis: '1000.000000000000',
    'finishing:finish-1': '100.000000000000',
    'tool:tool-1': '150.000000000000',
  });
  assert.equal(version.rows[0]?.contractedQuantity, APPROVED_PRICING_FIXTURE_EXPECTED.contractedQuantity);
  assert.equal(version.rows[0]?.unit, APPROVED_PRICING_FIXTURE_EXPECTED.unit);
  assert.equal(version.rows[0]?.integrityHash, APPROVED_PRICING_FIXTURE_EXPECTED.rowHash);
  assert.equal(version.integrityHash, APPROVED_PRICING_FIXTURE_EXPECTED.rootHash);
  assert.deepEqual(version.sourceEvidence.destination, {
    kind: 'PROJECT_ADDRESS', projectId: 'project-1', address: 'تهران، خیابان نمونه',
  });
});

test('seals an existing longitudinal contract from complete canonical pricing components without repricing it', () => {
  const source = approvedPricingSourceFixture();
  (source.contract.contractData as any).discount = {
    enabled: false, baseSubtotal: '5700000', percent: '0', amount: '0', currency: 'تومان',
  };
  source.leaf.amount = '67500000';
  source.leaf.invoiceItems = [{
    ...source.leaf.invoiceItems[0]!, totalPrice: '67500000',
  }];
  source.contract.items = [{ ...source.contract.items[0]!, totalPrice: '6750000' }];
  source.contract.currentItems = [{ ...source.contract.currentItems[0]!, totalPrice: '6750000' }];
  source.contract.productGraph = {
    ...source.contract.productGraph!,
    totalAmountToman: '6750000',
    rows: [{
      ...source.contract.productGraph!.rows[0]!,
      baseAmountToman: '5700000',
      totalAmountToman: '6750000',
      operations: [{ id: 'tool-1', kind: 'tool', amountToman: '750000' }],
      pricingComponents: [{
        id: 'base-material', kind: 'base-material', amountToman: '5700000',
      }, {
        id: 'longitudinal-cut', kind: 'longitudinal-cut', amountToman: '300000',
      }, {
        id: 'tool-1', kind: 'tool', amountToman: '750000',
      }],
    } as any],
  };

  const version = buildApprovedPricingVersion(source, 1, 'existing-contract-version');
  assert.equal(version.grossAmount, '6750000.000000000000');
  assert.deepEqual(version.rows[0]?.componentEvidence, {
    'base-material:base-material': '5700000.000000000000',
    discountBasis: '5700000.000000000000',
    'longitudinal-cut:longitudinal-cut': '300000.000000000000',
    'tool:tool-1': '750000.000000000000',
  });
});

test('seals canonical slab material and cutting components without dropping vertical cuts', () => {
  const source = approvedPricingSourceFixture();
  (source.contract.contractData as any).discount = {
    enabled: false, baseSubtotal: '5000000', percent: '0', amount: '0', currency: 'تومان',
  };
  source.leaf.amount = '53500000';
  source.leaf.invoiceItems = [{ ...source.leaf.invoiceItems[0]!, totalPrice: '53500000' }];
  source.contract.items = [{ ...source.contract.items[0]!, totalPrice: '5350000' }];
  source.contract.currentItems = [{ ...source.contract.currentItems[0]!, totalPrice: '5350000' }];
  source.contract.productGraph = {
    ...source.contract.productGraph!, totalAmountToman: '5350000',
    rows: [{
      ...source.contract.productGraph!.rows[0]!,
      baseAmountToman: '5000000', totalAmountToman: '5350000', operations: [],
      pricingComponents: [{
        id: 'slab-material', kind: 'slab-material', amountToman: '5000000',
      }, {
        id: 'slab-cut-longitudinal', kind: 'slab-cut-longitudinal', amountToman: '200000',
      }, {
        id: 'slab-cut-vertical', kind: 'slab-cut-vertical', amountToman: '150000',
      }],
    }],
  };

  const version = buildApprovedPricingVersion(source, 1, 'existing-slab-version');
  assert.equal(version.grossAmount, '5350000.000000000000');
  assert.equal(version.rows[0]?.componentEvidence['slab-cut-vertical:slab-cut-vertical'], '150000.000000000000');
});

test('seals a canonical stair row with all persisted layer pricing evidence', () => {
  const source = approvedPricingSourceFixture();
  (source.contract.contractData as any).discount = {
    enabled: false, baseSubtotal: '5700000', percent: '0', amount: '0', currency: 'تومان',
  };
  source.leaf.amount = '65000000';
  source.leaf.invoiceItems = [{ ...source.leaf.invoiceItems[0]!, totalPrice: '65000000' }];
  source.contract.items = [{ ...source.contract.items[0]!, totalPrice: '6500000' }];
  source.contract.currentItems = [{ ...source.contract.currentItems[0]!, totalPrice: '6500000' }];
  (source.contract.contractData as any).products[0].productType = 'stair';
  source.contract.items = source.contract.items.map(item => ({ ...item, productType: 'stair' }));
  source.contract.currentItems = source.contract.currentItems.map(item => ({ ...item, productType: 'stair' }));

  const graph = {
    schemaVersion: 1, revision: 1,
    calculationPolicy: {
      calculation: 'calculation-v1', packing: 'packing-v1',
      pricing: 'pricing-v1', rounding: 'rounding-v1',
    },
    catalogSnapshots: [], stairSystems: [], sourceBatches: [], remainingStones: [],
    allocations: [], operationGroups: [], toolSelections: [], finishingSelections: [],
    rows: [{
      productRowId: 'row-1', catalogProductId: 'product-1', catalogSnapshotVersion: 'snapshot-1',
      productType: 'stair', contractualTitle: 'Stair tread',
      commercial: {
        requestedQuantity: '4', baseAmountToman: '5700000', totalAmountToman: '6500000',
        calculationSnapshot: { pricingLines: [{
          lineId: 'base-material', quantity: '6', rateToman: '950000', amountToman: '5700000',
        }, {
          lineId: 'stair-cut', quantity: '15', rateToman: '20000', amountToman: '300000',
        }] },
      },
    }],
    layerConfigurations: [{
      layerConfigurationId: 'front-layer', parentProductRowId: 'row-1',
      result: {
        layerPricingLine: {
          lineId: 'layer-price', quantity: '1', rateToman: '200000', amountToman: '200000',
        },
        materialPricingLine: {
          lineId: 'base-material', quantity: '1', rateToman: '100000', amountToman: '100000',
        },
        cuttingPricingLines: [{
          lineId: 'longitudinal-cut', quantity: '5', rateToman: '20000', amountToman: '100000',
        }],
        sideOperationResults: [{
          operationCollectionId: 'front-polish',
          result: { pricingLines: [{
            lineId: 'tool:edge-polish', quantity: '1', rateToman: '100000', amountToman: '100000',
          }] },
        }],
      },
    }],
  } as any;
  const projection = projectCanonicalProductGraph(graph, 'accounting');
  source.contract.productGraph = {
    ...projection,
    roundingPolicy: graph.calculationPolicy.rounding,
    inputHash: 'stair-layer-input-hash',
    resultHash: 'stair-layer-result-hash',
    quantityPolicyProvenance: null,
    rows: projection.products.map(row => ({
      productRowId: row.productRowId,
      catalogProductId: 'product-1',
      contractualTitle: row.contractualTitle,
      productType: row.productType,
      baseAmountToman: row.baseAmountToman ?? null,
      totalAmountToman: row.totalAmountToman,
      requestedQuantity: row.quantity ?? null,
      requestedLengthMeters: row.lengthMeters ?? null,
      requestedAreaSquareMeters: row.areaSquareMeters ?? null,
      pricingComponents: row.pricingComponents,
      operations: row.operations,
    })),
  };

  const version = buildApprovedPricingVersion(source, 1, 'existing-stair-layer-version');
  assert.equal(version.grossAmount, '6500000.000000000000');
  assert.equal(
    version.rows[0]?.componentEvidence[
      'stair-layer-operation:tool:edge-polish:layer:front-layer:operation:front-polish:tool:edge-polish'
    ],
    '100000.000000000000'
  );
});

test('accepts explicit no-discount evidence without deriving a default', () => {
  const source = approvedPricingSourceFixture();
  (source.contract.contractData as any).discount = {
    enabled: false, baseSubtotal: '1000', percent: '0', amount: '0', currency: 'تومان',
  };
  source.leaf.amount = '12500';
  const version = buildApprovedPricingVersion(source, 1, 'no-discount-version');
  assert.equal(version.discountAmount, '0.000000000000');
  assert.equal(version.netAmount, version.grossAmount);
});

test('accepts graph-v1 money only through its audited historical storage-scale conversion', () => {
  const source = approvedPricingSourceFixture();
  (source.contract.contractData as any).discount = {
    enabled: false, baseSubtotal: '1000', percent: '0', amount: '0', currency: 'تومان',
  };
  const row = source.contract.productGraph!.rows[0] as any;
  row.totalAmountToman = '1251';
  row.legacyRawTotalAmountToman = '1250.51';
  row.operations[1].amountToman = '101';
  source.contract.productGraph!.schemaVersion = 1;
  source.contract.productGraph!.totalAmountToman = '1251';
  (source.contract.items[0] as any).totalPrice = '1250.51';
  (source.contract.currentItems[0] as any).totalPrice = '1250.51';
  (source.leaf.invoiceItems[0] as any).totalPrice = '12505.10';
  source.leaf.amount = '12505.10';
  const version = buildApprovedPricingVersion(source, 1, 'legacy-money-storage-version');
  assert.equal(version.netAmount, '1251.000000000000');
  assert.deepEqual((version.sourceEvidence.financialAmountNormalizations as any[]).at(-1), {
    scope: 'invoice', rawInvoiceAmount: '12505.1', sealedInvoiceAmount: '12510',
    difference: '4.9', rule: 'LEGACY_GRAPH_V1_AMOUNT_STORAGE_SCALE_TO_CANONICAL_TOMAN',
  });
});

const optimizerDerivedSourceFixture = () => {
  const source = approvedPricingSourceFixture();
  source.contract.productGraph!.schemaVersion = 1;
  source.contract.productGraph!.roundingPolicy = 'rounding-v1';
  const data = source.contract.contractData as any;
  data.products[0] = {
    ...data.products[0],
    quantity: 0,
    length: 40,
    lengthUnit: 'm',
    smartCutDerivedQuantity: true,
    smartCutPlan: {
      derivedQuantity: true,
      requestedQuantity: 1,
      totalRequestedLengthM: 40,
      productionPieces: [{ lengthM: 40, quantity: 1 }],
    },
  };
  data.deliveries = [{
    products: [{ productRowId: 'row-1', productId: 'product-1', unit: 'meter', quantity: 40 }],
  }];
  (source.contract.items as any)[0] = { ...source.contract.items[0], quantity: '0' };
  (source.contract.currentItems as any)[0] = { ...source.contract.currentItems[0], quantity: '0' };
  (source.contract.productGraph!.rows as any)[0] = {
    ...source.contract.productGraph!.rows[0],
    requestedQuantity: '1',
    requestedLengthMeters: '40',
    requestedAreaSquareMeters: '16',
  };
  source.leaf.sourceSnapshot = {
    id: 'contract-1',
    deliveries: [{
      id: 'delivery-1',
      status: 'SCHEDULED',
      products: [{
        id: 'delivery-product-1', deliveryId: 'delivery-1', productRowId: 'row-1',
        productId: 'product-1', quantity: '40',
      }],
    }],
  };
  (source.leaf.invoiceItems as any)[0] = { ...source.leaf.invoiceItems[0], quantity: '0' };
  return source;
};

test('reads the optimizer meter witness from an immutable legacy canonical graph row', () => {
  assert.equal(canonicalOptimizerDerivedLengthWitness({
    productRowId: 'row-1',
    productType: 'longitudinal',
    commercial: {
      legacySnapshot: {
        smartCutDerivedQuantity: true,
        smartCutPlan: { derivedQuantity: true, totalRequestedLengthM: '40' },
      },
    },
  }, undefined), '40');
});

test('resolves only recorded writer versions or the explicit legacy command format', () => {
  const base = {
    graphSchemaVersion: 1,
    roundingPolicy: 'rounding-v1',
    graphAuditCommandId: 'legacy-migration:contract-1:hash',
  };
  assert.equal(optimizerQuantityPolicyProvenanceFromAudit({
    ...base,
    graphAuditCommand: { kind: 'legacy-migration', writerVersion: 1, backupReference: 'verified-backup' },
  })?.producerVersion, 1);
  assert.equal(optimizerQuantityPolicyProvenanceFromAudit({
    ...base,
    graphAuditCommand: { kind: 'legacy-migration', backupReference: 'verified-backup' },
  })?.producerVersion, 0);
  assert.equal(optimizerQuantityPolicyProvenanceFromAudit({
    ...base,
    graphAuditCommand: { kind: 'legacy-migration', writerVersion: 2, backupReference: 'verified-backup' },
  }), null);
});

test('seals an optimizer-derived longitudinal zero sentinel from agreeing frozen witnesses', () => {
  const source = optimizerDerivedSourceFixture();

  const version = buildApprovedPricingVersion(source, 1, 'optimizer-derived-quantity-version');

  assert.equal(version.rows[0]?.contractedQuantity, '40.000');
  assert.equal(version.rows[0]?.unit, 'meter');
  assert.deepEqual(version.sourceEvidence.quantityNormalizations, [{
    evidenceOrigin: 'OPTIMIZER_DERIVED_LONGITUDINAL_ZERO_SENTINEL',
    productRowId: 'row-1',
    rawContractItemQuantity: '0.000',
    rawInvoiceItemQuantity: '0.000',
    sealedQuantity: '40.000',
    unit: 'meter',
    optimizerPlan: {
      totalRequestedLengthMeters: '40.000',
      productionQuantity: '40.000',
    },
    canonicalGraph: { requestedLengthMeters: '40.000' },
    persistedDeliveries: {
      rows: [{ deliveryId: 'delivery-1', deliveryProductId: 'delivery-product-1', rawQuantity: '40', quantity: '40.000' }],
      totalQuantity: '40.000',
    },
    wizardDelivery: {
      present: true,
      rows: [{ deliveryIndex: 0, productIndex: 0, rawQuantity: '40' }],
      totalQuantity: '40.000',
    },
    compatibility: {
      policy: 'CONTRACT_PRODUCT_GRAPH_V1_SCALE_TWO_PERSISTENCE',
      commercialQuantityPolicy: longitudinalCommercialPolicy('rounding-v1'),
      graphSchemaVersion: 1,
      rounding: 'ROUND_HALF_UP',
      sealedScale: 3,
      persistedScale: 2,
      producer: 'CANONICAL_WIZARD_SAVE',
      producerVersion: 1,
      graphAuditCommandId: 'wizard-save:contract-1:7:graph-result-hash',
      rawOptimizerQuantity: '40',
      rawProductionQuantity: '40',
      rawCanonicalGraphQuantity: '40',
      rawPersistedDeliveryTotal: '40',
      sealedQuantity: '40.000',
      persistedComparableQuantity: '40.00',
      persistedDifference: '0',
    },
  }]);
});

test('seals a graph-v1 optimizer float through its recorded scale-two persistence rule', () => {
  const source = optimizerDerivedSourceFixture();
  (source.contract.contractData as any).products[0].smartCutPlan = {
    ...(source.contract.contractData as any).products[0].smartCutPlan,
    requestedAreaSqm: '35.00000000000001',
    requestedWidthCm: '60',
    requestedLengthM: '58.33333333333334',
    totalRequestedLengthM: '58.33333333333334',
    sourceLengthConsumedM: '58.33333333333334',
    productionPieces: [{ lengthM: '58.33333333333334', widthCm: '60', quantity: '1' }],
  };
  (source.contract.productGraph!.rows as any)[0] = {
    ...source.contract.productGraph!.rows[0],
    requestedLengthMeters: '58.333333333333333333',
    requestedWidthMeters: '0.6',
    requestedAreaSquareMeters: '35',
  };
  (source.leaf.sourceSnapshot as any).deliveries[0].products[0].quantity = '58.33';
  (source.contract.contractData as any).deliveries[0].products[0].quantity = '58.33333333333334';

  const version = buildApprovedPricingVersion(source, 1, 'optimizer-derived-graph-v1-float');

  assert.equal(version.rows[0]?.contractedQuantity, '58.333');
  assert.deepEqual((version.sourceEvidence.quantityNormalizations as any[])[0]?.compatibility, {
    policy: 'CONTRACT_PRODUCT_GRAPH_V1_SCALE_TWO_PERSISTENCE',
    commercialQuantityPolicy: longitudinalCommercialPolicy('rounding-v1'),
    graphSchemaVersion: 1,
    rounding: 'ROUND_HALF_UP',
    sealedScale: 3,
    persistedScale: 2,
    producer: 'CANONICAL_WIZARD_SAVE',
    producerVersion: 1,
    graphAuditCommandId: 'wizard-save:contract-1:7:graph-result-hash',
    rawOptimizerQuantity: '58.33333333333334',
    rawProductionQuantity: '58.33333333333334',
    rawCanonicalGraphQuantity: '58.333333333333333333',
    sourceTransformation: 'ROUND_HALF_UP_SCALE_THREE',
    commercialEquivalences: [{
      leftSource: 'PRODUCT_GRAPH',
      rightSource: 'OPTIMIZER_TOTAL',
      rawLeft: '58.333333333333333333',
      rawRight: '58.33333333333334',
      comparableLeft: '58.333',
      comparableRight: '58.333',
      rawDifference: '-6.667e-15',
      rule: 'ROUND_HALF_UP_SCALE_THREE',
    }],
    rawPersistedDeliveryTotal: '58.33',
    sealedQuantity: '58.333',
    persistedComparableQuantity: '58.33',
    persistedDifference: '-0.00333333333334',
  });
});

test('seals a new rounding-v2 optimizer float through audited scale-three persistence', () => {
  const source = optimizerDerivedSourceFixture();
  source.contract.productGraph!.roundingPolicy = 'rounding-v2';
  (source.contract.contractData as any).products[0].smartCutPlan = {
    ...(source.contract.contractData as any).products[0].smartCutPlan,
    totalRequestedLengthM: '58.33333333333334',
    productionPieces: [{ lengthM: '58.33333333333334', quantity: '1' }],
  };
  (source.contract.productGraph!.rows as any)[0] = {
    ...source.contract.productGraph!.rows[0],
    requestedLengthMeters: '58.33333333333334',
  };
  (source.leaf.sourceSnapshot as any).deliveries[0].products[0].quantity = '58.333';
  (source.contract.contractData as any).deliveries[0].products[0].quantity = '58.33333333333334';

  const version = buildApprovedPricingVersion(source, 1, 'optimizer-derived-rounding-v2-float');

  assert.equal(version.rows[0]?.contractedQuantity, '58.333');
  assert.deepEqual((version.sourceEvidence.quantityNormalizations as any[])[0]?.compatibility, {
    policy: 'CONTRACT_PRODUCT_GRAPH_V2_SCALE_THREE_PERSISTENCE',
    commercialQuantityPolicy: longitudinalCommercialPolicy('rounding-v2'),
    graphSchemaVersion: 1,
    rounding: 'ROUND_HALF_UP',
    sealedScale: 3,
    persistedScale: 3,
    producer: 'CANONICAL_WIZARD_SAVE',
    producerVersion: 1,
    graphAuditCommandId: 'wizard-save:contract-1:7:graph-result-hash',
    rawOptimizerQuantity: '58.33333333333334',
    rawProductionQuantity: '58.33333333333334',
    rawCanonicalGraphQuantity: '58.33333333333334',
    rawPersistedDeliveryTotal: '58.333',
    sealedQuantity: '58.333',
    persistedComparableQuantity: '58.333',
    persistedDifference: '-0.00033333333334',
  });
});

test('uses explicit half-up rounding for an exact scale-three tie', () => {
  const source = optimizerDerivedSourceFixture();
  source.contract.productGraph!.roundingPolicy = 'rounding-v2';
  (source.contract.contractData as any).products[0].smartCutPlan = {
    ...(source.contract.contractData as any).products[0].smartCutPlan,
    totalRequestedLengthM: '1.2345',
    productionPieces: [{ lengthM: '1.2345', quantity: '1' }],
  };
  (source.contract.productGraph!.rows as any)[0] = {
    ...source.contract.productGraph!.rows[0],
    requestedLengthMeters: '1.2345',
  };
  (source.leaf.sourceSnapshot as any).deliveries[0].products[0].quantity = '1.235';
  (source.contract.contractData as any).deliveries[0].products[0].quantity = '1.2345';

  const version = buildApprovedPricingVersion(source, 1, 'optimizer-half-up-tie');
  assert.equal(version.rows[0]?.contractedQuantity, '1.235');
  assert.equal(
    (version.sourceEvidence.quantityNormalizations as any[])[0]?.compatibility.rounding,
    'ROUND_HALF_UP',
  );
});

test('treats floating-point residue as equal only after the recorded scale-three commercial conversion', () => {
  const source = optimizerDerivedSourceFixture();
  (source.contract.contractData as any).products[0].smartCutPlan = {
    ...(source.contract.contractData as any).products[0].smartCutPlan,
    totalRequestedLengthM: '50',
    productionPieces: [{ lengthM: '50.00000000000001', quantity: '1' }],
  };
  (source.contract.productGraph!.rows as any)[0].requestedLengthMeters = '50';
  (source.leaf.sourceSnapshot as any).deliveries[0].products[0].quantity = '50';
  (source.contract.contractData as any).deliveries[0].products[0].quantity = '50';

  const version = buildApprovedPricingVersion(source, 1, 'optimizer-floating-residue');
  const normalization = (version.sourceEvidence.quantityNormalizations as any[])[0];
  assert.equal(version.rows[0]?.contractedQuantity, '50.000');
  assert.deepEqual(normalization.compatibility.commercialEquivalences, [{
    leftSource: 'OPTIMIZER_PRODUCTION',
    rightSource: 'OPTIMIZER_TOTAL',
    rawLeft: '50.00000000000001',
    rawRight: '50',
    comparableLeft: '50.000',
    comparableRight: '50.000',
    rawDifference: '1e-14',
    rule: 'ROUND_HALF_UP_SCALE_THREE',
  }]);
});

test('reconciles the frozen 100302-style graph residue under rounding-v2 without guessing quantity', () => {
  const source = optimizerDerivedSourceFixture();
  source.contract.productGraph!.roundingPolicy = 'rounding-v2';
  (source.contract.contractData as any).products[0].smartCutPlan = {
    ...(source.contract.contractData as any).products[0].smartCutPlan,
    totalRequestedLengthM: '16.66666666666667',
    productionPieces: [{ lengthM: '16.66666666666667', quantity: '1' }],
  };
  (source.contract.productGraph!.rows as any)[0].requestedLengthMeters = '16.666666666666666667';
  (source.leaf.sourceSnapshot as any).deliveries[0].products[0].quantity = '16.667';
  (source.contract.contractData as any).deliveries[0].products[0].quantity = '16.66666666666667';

  const version = buildApprovedPricingVersion(source, 1, 'optimizer-100302-residue');
  assert.equal(version.rows[0]?.contractedQuantity, '16.667');
  assert.equal(
    (version.sourceEvidence.quantityNormalizations as any[])[0]
      .compatibility.commercialEquivalences[0].rawDifference,
    '-3.333e-15',
  );
});

test('keeps incomplete or conflicting optimizer-derived quantity evidence fail-closed', () => {
  const cases: readonly [string, (source: ApprovedPricingSource) => void, RegExp][] = [
    ['missing persisted Delivery', source => {
      (source.leaf.sourceSnapshot as any).deliveries = [];
    }, /persisted Delivery evidence is missing/],
    ['partial persisted Delivery', source => {
      (source.leaf.sourceSnapshot as any).deliveries[0].products[0].quantity = '39.99';
    }, /persisted Delivery quantity conflicts/],
    ['duplicate persisted Delivery row', source => {
      const products = (source.leaf.sourceSnapshot as any).deliveries[0].products;
      products.push({ ...products[0], id: 'delivery-product-duplicate' });
    }, /persisted Delivery row is duplicated/],
    ['conflicting wizard copy', source => {
      (source.contract.contractData as any).deliveries[0].products[0].quantity = 39;
    }, /wizard Delivery quantity conflicts/],
    ['incompatible wizard unit', source => {
      (source.contract.contractData as any).deliveries[0].products[0].unit = 'count';
    }, /wizard Delivery identity or unit conflicts/],
    ['conflicting positive invoice quantity', source => {
      (source.leaf.invoiceItems as any)[0] = { ...source.leaf.invoiceItems[0], quantity: '39' };
    }, /invoice quantity conflicts with sealed meters/],
    ['conflicting canonical graph', source => {
      (source.contract.productGraph!.rows as any)[0] = {
        ...source.contract.productGraph!.rows[0], requestedLengthMeters: '41',
      };
    }, /canonical graph quantity conflicts with optimizer plan/],
    ['different after scale-three precision', source => {
      (source.contract.contractData as any).products[0].smartCutPlan.totalRequestedLengthM = '40.0005';
    }, /optimizer quantities conflict/],
  ];

  for (const [label, mutate, expected] of cases) {
    const source = optimizerDerivedSourceFixture();
    mutate(source);
    assert.throws(
      () => buildApprovedPricingVersion(source, 1, `optimizer-derived-conflict-${label}`),
      expected,
      label,
    );
  }
});

test('captures exact raw optimizer conflict evidence without tolerance guessing', () => {
  const source = optimizerDerivedSourceFixture();
  (source.contract.contractData as any).products[0].smartCutPlan.productionPieces[0].quantity = '3';
  assert.throws(
    () => buildApprovedPricingVersion(source, 1, 'optimizer-structured-conflict'),
    (error: unknown) => {
      assert.ok(error instanceof OptimizerQuantityEvidenceConflictError);
      assert.equal(error.evidence?.productRowId, 'row-1');
      assert.equal(error.evidence?.rule, 'CONTRACT_PRODUCT_GRAPH_V1_SCALE_TWO_PERSISTENCE');
      assert.equal(error.evidence?.rawOptimizerQuantity, '40');
      assert.equal(error.evidence?.transformedOptimizerQuantity, '40.000');
      assert.equal(error.evidence?.rawProductionQuantity, '120');
      assert.equal(error.evidence?.transformedProductionQuantity, '120.000');
      assert.equal(error.evidence?.rawCanonicalGraphQuantity, '40');
      assert.equal(error.evidence?.transformedCanonicalGraphQuantity, '40.000');
      assert.equal(error.evidence?.difference, '80');
      assert.equal(error.evidence?.unit, 'meter');
      assert.deepEqual(error.evidence?.rawProductionPieces, [{ lengthM: 40, quantity: '3' }]);
      assert.deepEqual(error.evidence?.rawPersistedDeliveryRows, [{
        deliveryId: 'delivery-1',
        deliveryProductId: 'delivery-product-1',
        rawQuantity: '40',
        transformedQuantity: '40.00',
      }]);
      assert.deepEqual(error.evidence?.comparisonDifferences, [{
        key: 'OPTIMIZER_PRODUCTION_MINUS_OPTIMIZER_TOTAL',
        labelFa: 'اختلاف جمع قطعات تولیدی optimizer با کمیت کل optimizer',
        leftSource: 'OPTIMIZER_PRODUCTION',
        rightSource: 'OPTIMIZER_TOTAL',
        unit: 'meter',
        basis: 'HISTORICAL_TRANSFORMED',
        rule: 'ROUND_HALF_UP_SCALE_THREE',
        leftComparableValue: '120.000',
        rightComparableValue: '40.000',
        value: '80',
      }]);
      assert.match(error.userMessageFa, /مدیر حسابداری.*پروندهٔ بررسی کمیت/);
      assert.doesNotMatch(error.userMessageFa, /optimizer|80/);
      return true;
    },
  );
});

test('captures the exact named difference for graph, persisted Delivery, and invoice conflicts', () => {
  const cases: Array<{
    name: string;
    mutate: (source: ApprovedPricingSource) => void;
    key: string;
    value: string;
    basis: string;
    leftComparableValue: string;
    rightComparableValue: string;
  }> = [
    {
      name: 'Product Graph',
      mutate: source => {
        (source.contract.productGraph!.rows as any)[0].requestedLengthMeters = '41';
      },
      key: 'PRODUCT_GRAPH_MINUS_OPTIMIZER',
      value: '1',
      basis: 'HISTORICAL_TRANSFORMED',
      leftComparableValue: '41.000',
      rightComparableValue: '40.000',
    },
    {
      name: 'persisted Delivery',
      mutate: source => {
        (source.contract.contractData as any).products[0].smartCutPlan.totalRequestedLengthM = '40.005';
        (source.contract.contractData as any).products[0].smartCutPlan.productionPieces[0].lengthM = '40.005';
        (source.contract.productGraph!.rows as any)[0].requestedLengthMeters = '40.005';
        (source.contract.contractData as any).deliveries[0].products[0].quantity = '40.005';
        (source.leaf.sourceSnapshot as any).deliveries[0].products[0].quantity = '40.00';
      },
      key: 'PERSISTED_DELIVERY_MINUS_COMPARABLE_OPTIMIZER',
      value: '-0.01',
      basis: 'HISTORICAL_TRANSFORMED',
      leftComparableValue: '40.00',
      rightComparableValue: '40.01',
    },
    {
      name: 'invoice',
      mutate: source => {
        (source.leaf.invoiceItems as any)[0] = { ...source.leaf.invoiceItems[0], quantity: '39' };
      },
      key: 'INVOICE_MINUS_OPTIMIZER',
      value: '-1',
      basis: 'HISTORICAL_TRANSFORMED',
      leftComparableValue: '39.000',
      rightComparableValue: '40.000',
    },
  ];

  for (const item of cases) {
    const source = optimizerDerivedSourceFixture();
    item.mutate(source);
    assert.throws(
      () => buildApprovedPricingVersion(source, 1, `optimizer-named-difference-${item.name}`),
      (error: unknown) => {
        const evidenceError = asApprovedPricingEvidenceError(error);
        assert.ok(evidenceError, item.name);
        assert.deepEqual(evidenceError.evidence?.comparisonDifferences, [{
          key: item.key,
          labelFa: item.name === 'Product Graph'
            ? 'اختلاف Product Graph با کمیت کل optimizer'
            : item.name === 'persisted Delivery'
              ? 'اختلاف مجموع Delivery با کمیت تبدیل‌شده قابل‌مقایسه'
              : 'اختلاف کمیت پیش‌فاکتور با کمیت کل optimizer',
          leftSource: item.name === 'Product Graph'
            ? 'PRODUCT_GRAPH'
            : item.name === 'persisted Delivery'
              ? 'PERSISTED_DELIVERY_TOTAL'
              : 'INVOICE',
          rightSource: item.name === 'persisted Delivery' ? 'WIZARD_DELIVERY_TOTAL' : 'OPTIMIZER_TOTAL',
          value: item.value,
          unit: 'meter',
          basis: item.basis,
          rule: item.name === 'Product Graph'
            ? 'ROUND_HALF_UP_SCALE_THREE'
            : item.name === 'persisted Delivery'
              ? 'ROUND_HALF_UP_SCALE_TWO_PER_ROW_THEN_SUM'
              : 'ROUND_HALF_UP_SCALE_THREE',
          leftComparableValue: item.leftComparableValue,
          rightComparableValue: item.rightComparableValue,
        }], item.name);
        return true;
      },
    );
  }
});

test('accepts a missing redundant wizard Delivery copy when persisted evidence is complete', () => {
  const source = optimizerDerivedSourceFixture();
  delete (source.contract.contractData as any).deliveries;

  const version = buildApprovedPricingVersion(source, 1, 'optimizer-derived-no-wizard-copy');

  assert.equal(version.rows[0]?.contractedQuantity, '40.000');
  assert.deepEqual((version.sourceEvidence.quantityNormalizations as any[])[0]?.wizardDelivery, { present: false });
});

test('treats an empty legacy wizard Delivery collection as an absent redundant copy', () => {
  const source = optimizerDerivedSourceFixture();
  (source.contract.contractData as any).deliveries = [];

  const version = buildApprovedPricingVersion(source, 1, 'optimizer-derived-empty-wizard-copy');

  assert.equal(version.rows[0]?.contractedQuantity, '40.000');
  assert.deepEqual((version.sourceEvidence.quantityNormalizations as any[])[0]?.wizardDelivery, { present: false });
});

test('rejects ambiguous multi-row persisted conversion when wizard-era row evidence is absent', () => {
  const source = optimizerDerivedSourceFixture();
  delete (source.contract.contractData as any).deliveries;
  const persisted = (source.leaf.sourceSnapshot as any).deliveries[0].products[0];
  persisted.quantity = '20';
  (source.leaf.sourceSnapshot as any).deliveries.push({
    id: 'delivery-2',
    status: 'SCHEDULED',
    products: [{ ...persisted, id: 'delivery-product-2', deliveryId: 'delivery-2', quantity: '20' }],
  });

  assert.throws(
    () => buildApprovedPricingVersion(source, 1, 'optimizer-ambiguous-delivery-conversion'),
    /ambiguous multi-row persisted Delivery conversion/,
  );
});

test('rejects optimizer normalization when producer provenance is not recorded', () => {
  const source = optimizerDerivedSourceFixture();
  source.contract.productGraph!.quantityPolicyProvenance = null;

  assert.throws(
    () => buildApprovedPricingVersion(source, 1, 'optimizer-missing-provenance'),
    (error: unknown) => {
      const evidenceError = asApprovedPricingEvidenceError(error);
      assert.ok(evidenceError);
      assert.match(evidenceError.message, /Unsupported or missing optimizer quantity provenance/);
      assert.equal(evidenceError.evidence?.rule, undefined);
      assert.equal(evidenceError.evidence?.transformedOptimizerQuantity, undefined);
      assert.equal(evidenceError.evidence?.transformedProductionQuantity, undefined);
      assert.equal(evidenceError.evidence?.transformedCanonicalGraphQuantity, undefined);
      assert.equal(evidenceError.evidence?.reportedRoundingPolicy, 'rounding-v1');
      return true;
    },
  );
});

test('normalizes legacy explicit-null no-discount evidence at financial approval', () => {
  const source = approvedPricingSourceFixture();
  const data = source.contract.contractData as any;
  data.discount = null;
  delete data.products[0].meta.isLayer;
  source.leaf.amount = '12500';

  const version = buildApprovedPricingVersion(source, 1, 'legacy-null-no-discount-version');

  assert.equal(version.discountAmount, '0.000000000000');
  assert.equal(version.netAmount, version.grossAmount);
  assert.deepEqual(version.sourceEvidence.discount, {
    enabled: false,
    baseSubtotal: '1000.000000000000',
    percent: '0.000000000000',
    amount: '0.000000000000',
    currency: 'تومان',
    evidenceOrigin: 'LEGACY_WIZARD_NULL',
    selectedBasis: '1000.000000000000',
    selectedAmount: '0.000000000000',
  });
  assert.deepEqual(version.sourceEvidence.discountEligibility, {
    evidenceOrigin: 'LEGACY_WIZARD_MISSING_IS_LAYER_AS_FALSE',
    normalizedNonLayerProductRowIds: ['row-1'],
  });
});

test('keeps malformed legacy discount eligibility fail-closed', () => {
  const source = approvedPricingSourceFixture();
  const data = source.contract.contractData as any;
  data.discount = null;
  data.products[0].meta.isLayer = 'false';
  source.leaf.amount = '12500';

  assert.throws(
    () => buildApprovedPricingVersion(source, 1, 'legacy-malformed-eligibility-version'),
    /discount eligibility evidence is missing/,
  );
});

test('normalizes an absent legacy discount field only when frozen totals reconcile', () => {
  const source = approvedPricingSourceFixture();
  const data = source.contract.contractData as any;
  delete data.discount;
  data.payment.totalContractAmount = '1250';
  source.leaf.amount = '12500';

  const version = buildApprovedPricingVersion(source, 1, 'legacy-absent-no-discount-version');

  assert.equal(version.discountAmount, '0.000000000000');
  assert.deepEqual(version.sourceEvidence.discount, {
    enabled: false,
    baseSubtotal: '1000.000000000000',
    percent: '0.000000000000',
    amount: '0.000000000000',
    currency: 'تومان',
    evidenceOrigin: 'LEGACY_WIZARD_ABSENT_RECONCILED',
    reconciledPayableTotal: '1250.000000000000',
    reconciledGrossTotal: '1250.000000000000',
    selectedBasis: '1000.000000000000',
    selectedAmount: '0.000000000000',
  });
});

test('keeps an unreconciled absent legacy discount field fail-closed', () => {
  const source = approvedPricingSourceFixture();
  const data = source.contract.contractData as any;
  delete data.discount;
  data.payment.totalContractAmount = '1249';
  source.leaf.amount = '12500';

  assert.throws(
    () => buildApprovedPricingVersion(source, 1, 'legacy-absent-conflict-version'),
    /without discount evidence does not reconcile to zero discount/,
  );
});

test('keeps equal legacy totals fail-closed when non-product adjustments could hide a discount', () => {
  const source = approvedPricingSourceFixture();
  const data = source.contract.contractData as any;
  delete data.discount;
  data.payment.totalContractAmount = '1250';
  data.serviceRows = [{ serviceRowId: 'service-1', totalPrice: '100' }];
  data.discountAmount = '100';
  source.leaf.amount = '12500';

  assert.throws(
    () => buildApprovedPricingVersion(source, 1, 'legacy-absent-hidden-discount-version'),
    /conflicting discount or non-product adjustment evidence/,
  );
});

test('keeps malformed legacy adjustment evidence fail-closed', () => {
  const source = approvedPricingSourceFixture();
  const data = source.contract.contractData as any;
  delete data.discount;
  data.payment.totalContractAmount = '1250';
  data.discountAmount = 'unknown';
  source.leaf.amount = '12500';

  assert.throws(
    () => buildApprovedPricingVersion(source, 1, 'legacy-absent-malformed-adjustment-version'),
    /conflicting discount or non-product adjustment evidence/,
  );
});

test('keeps malformed legacy service-row containers and entries fail-closed', () => {
  for (const serviceRows of [
    { totalPrice: '0' },
    [null],
    [{}],
    [{ totalPrice: null }],
    [{ amount: undefined }],
    [{ totalPrice: '' }],
  ]) {
    const source = approvedPricingSourceFixture();
    const data = source.contract.contractData as any;
    delete data.discount;
    data.payment.totalContractAmount = '1250';
    data.serviceRows = serviceRows;
    source.leaf.amount = '12500';

    assert.throws(
      () => buildApprovedPricingVersion(source, 1, 'legacy-malformed-service-row-version'),
      /conflicting discount or non-product adjustment evidence/,
    );
  }
});

test('freezes a zero discount basis for a non-eligible row', () => {
  const source = approvedPricingSourceFixture();
  (source.contract.contractData as any).products[0].meta.isLayer = true;
  (source.contract.contractData as any).discount = {
    enabled: false, baseSubtotal: '0', percent: '0', amount: '0', currency: 'تومان',
  };
  source.leaf.amount = '12500';
  const version = buildApprovedPricingVersion(source, 1, 'non-eligible-version');
  assert.equal(version.rows[0]?.discountEligible, false);
  assert.equal(version.rows[0]?.componentEvidence.discountBasis, '0.000000000000');
});

test('FROM_SELECTED_ITEMS seals only the financially approved subset and allocates its discount', () => {
  const source = approvedPricingSourceFixture();
  const data = source.contract.contractData as any;
  data.discount = {
    ...data.discount, baseSubtotal: '1500', amount: '150',
  };
  data.products.push({
    rowId: 'row-2', productId: 'product-2', productType: 'prepared',
    preparedUnit: 'count', preparedQuantity: '2', quantity: '2', meta: { isLayer: false },
  });
  source.contract.items = [...source.contract.items, {
    id: 'item-2', productId: 'product-2', productRowId: 'row-2', productType: 'prepared',
    quantity: '2', totalPrice: '600',
  }];
  source.contract.currentItems = [...source.contract.currentItems, {
    id: 'item-2', productId: 'product-2', productRowId: 'row-2', productType: 'prepared',
    quantity: '2', totalPrice: '600',
  }];
  source.contract.productGraph = {
    ...source.contract.productGraph!,
    totalAmountToman: '1850',
    rows: [...source.contract.productGraph!.rows, {
      productRowId: 'row-2', catalogProductId: 'product-2', contractualTitle: 'قطعه آماده',
      productType: 'prepared', baseAmountToman: '500', totalAmountToman: '600',
      requestedQuantity: '2', requestedLengthMeters: null, requestedAreaSquareMeters: null,
      operations: [{ id: 'finish-2', kind: 'finishing', amountToman: '100' }],
    }],
  };
  source.leaf.metadata = { mode: 'FROM_SELECTED_ITEMS' };
  source.leaf.invoiceItems = [{
    id: 'invoice-item-2', contractItemId: 'item-2', productId: 'product-2', quantity: '2', totalPrice: '6000',
  }];
  source.leaf.amount = '5500';

  const version = buildApprovedPricingVersion(source, 1, 'selected-version');
  assert.deepEqual(version.rows.map(row => row.contractItemId), ['item-2']);
  assert.equal(version.grossAmount, '600.000000000000');
  assert.equal(version.discountAmount, '50.000000000000');
  assert.equal(version.netAmount, '550.000000000000');
});

test('financial-record evidence and post-candidate contract edits fail closed', () => {
  const amountConflict = approvedPricingSourceFixture();
  amountConflict.leaf.amount = '11499';
  assert.throws(() => buildApprovedPricingVersion(amountConflict, 1, 'amount-conflict'), /invoice amount conflicts/);

  const invoiceItemConflict = approvedPricingSourceFixture();
  invoiceItemConflict.leaf.invoiceItems = [{ ...invoiceItemConflict.leaf.invoiceItems[0]!, totalPrice: '12499' }];
  assert.throws(() => buildApprovedPricingVersion(invoiceItemConflict, 1, 'item-conflict'), /invoice item total conflicts/);

  const mutableEdit = approvedPricingSourceFixture();
  mutableEdit.contract.currentItems = [{ ...mutableEdit.contract.currentItems[0]!, totalPrice: '1251' }];
  assert.throws(() => buildApprovedPricingVersion(mutableEdit, 1, 'mutable-edit'), /changed after invoice candidate/);

  const manualMode = approvedPricingSourceFixture();
  manualMode.leaf.metadata = { mode: 'MANUAL' };
  assert.throws(() => buildApprovedPricingVersion(manualMode, 1, 'manual'), /cannot produce approved pricing/);
});

test('discount eligibility is explicit and collaboration sale has a valid no-project destination', () => {
  const missingEligibility = approvedPricingSourceFixture();
  delete (missingEligibility.contract.contractData as any).products[0].meta;
  assert.throws(() => buildApprovedPricingVersion(missingEligibility, 1, 'missing-eligibility'), /discount metadata is missing or null/);

  const collaboration = approvedPricingSourceFixture();
  const data = collaboration.contract.contractData as any;
  data.contractKind = 'collaboration';
  data.projectId = '';
  data.project = null;
  const version = buildApprovedPricingVersion(collaboration, 1, 'collaboration');
  assert.equal(version.sourceEvidence.project, null);
  assert.deepEqual(version.sourceEvidence.destination, {
    kind: 'COLLABORATION_SALE', projectId: null, address: null,
  });
});

test('canonical hash is independent of object key insertion order', () => {
  assert.equal(canonicalApprovedPricingHash({ b: 2, a: { d: 4, c: 3 } }), canonicalApprovedPricingHash({ a: { c: 3, d: 4 }, b: 2 }));
});

test('equal commercial content creates distinct immutable version identities', async () => {
  const first = approvedPricingSourceFixture();
  const second = approvedPricingSourceFixture();
  second.leaf = { ...second.leaf, id: 'invoice-approved-2', financiallyApprovedAt: new Date('2026-08-10T08:30:00.000Z') };
  const repository = new MemoryRepository(new Map([[first.leaf.id, first], [second.leaf.id, second]]));
  const one = await sealApprovedPricing(repository, first.leaf.id, () => 'version-1');
  const two = await sealApprovedPricing(repository, second.leaf.id, () => 'version-2');
  assert.equal(one.outcome, 'SEALED');
  assert.equal(two.outcome, 'SEALED');
  assert.equal(two.version.versionNumber, 2);
  assert.notEqual(one.version.id, two.version.id);
  assert.notEqual(one.version.integrityHash, two.version.integrityHash);
});

test('retry and concurrent retry return the one existing version', async () => {
  const source = approvedPricingSourceFixture();
  const repository = new MemoryRepository(new Map([[source.leaf.id, source]]));
  const [first, second] = await Promise.all([
    sealApprovedPricing(repository, source.leaf.id, () => 'one-version'),
    sealApprovedPricing(repository, source.leaf.id, () => 'must-not-be-used'),
  ]);
  assert.deepEqual(new Set([first.outcome, second.outcome]), new Set(['SEALED', 'REPLAYED']));
  assert.equal(repository.versions.length, 1);
  assert.equal(first.version.id, second.version.id);
});

test('invalid leaf fails before any repository mutation', async () => {
  const source = approvedPricingSourceFixture();
  source.leaf = { ...source.leaf, kind: FinancialRecordKind.RECEIVABLE, status: AccountingRecordStatus.POSTED };
  const repository = new MemoryRepository(new Map([[source.leaf.id, source]]));
  await assert.rejects(() => sealApprovedPricing(repository, source.leaf.id), /valid approved invoice leaf/);
  assert.equal(repository.versions.length, 0);
});

test('missing and conflicting evidence fail closed', () => {
  const missingDiscount = approvedPricingSourceFixture();
  delete (missingDiscount.contract.contractData as any).discount;
  assert.throws(() => buildApprovedPricingVersion(missingDiscount, 1, 'v1'), /Legacy contract payable total.*valid decimal/);

  const missingDestination = approvedPricingSourceFixture();
  (missingDestination.contract.contractData as any).project.address = null;
  assert.throws(() => buildApprovedPricingVersion(missingDestination, 1, 'v1'), /destination.*missing or null/);

  const missingCurrencyEvidence = approvedPricingSourceFixture();
  (missingCurrencyEvidence.contract.contractData as any).payment = null;
  assert.throws(() => buildApprovedPricingVersion(missingCurrencyEvidence, 1, 'v1'), /payment evidence.*missing or null/);

  const conflictingProduct = approvedPricingSourceFixture();
  conflictingProduct.contract.productGraph = {
    ...conflictingProduct.contract.productGraph!,
    rows: [{ ...conflictingProduct.contract.productGraph!.rows[0]!, catalogProductId: 'other-product' }],
  };
  assert.throws(() => buildApprovedPricingVersion(conflictingProduct, 1, 'v1'), /product identities conflict/);

  const conflictingComponents = approvedPricingSourceFixture();
  conflictingComponents.contract.productGraph = {
    ...conflictingComponents.contract.productGraph!,
    rows: [{ ...conflictingComponents.contract.productGraph!.rows[0]!, totalAmountToman: '1251' }],
  };
  assert.throws(() => buildApprovedPricingVersion(conflictingComponents, 1, 'v1'), /component evidence conflicts/);

  const conflictingProjectedOperation = approvedPricingSourceFixture();
  conflictingProjectedOperation.contract.productGraph = {
    ...conflictingProjectedOperation.contract.productGraph!,
    rows: [{
      ...conflictingProjectedOperation.contract.productGraph!.rows[0]!,
      pricingComponents: [{
        id: 'base-material', kind: 'base-material', amountToman: '1000',
      }, {
        id: 'tool-1', kind: 'tool', amountToman: '149',
      }, {
        id: 'finish-1', kind: 'finishing', amountToman: '100',
      }],
    } as any],
  };
  assert.throws(
    () => buildApprovedPricingVersion(conflictingProjectedOperation, 1, 'projected-operation-conflict'),
    /attached component evidence conflicts with pricing components/
  );

  const disguisedBase = approvedPricingSourceFixture();
  disguisedBase.contract.productGraph = {
    ...disguisedBase.contract.productGraph!,
    rows: [{
      ...disguisedBase.contract.productGraph!.rows[0]!,
      pricingComponents: [{
        id: 'corrupt-base', kind: 'base-material', amountToman: '1000',
      }, {
        id: 'tool-1', kind: 'tool', amountToman: '150',
      }, {
        id: 'finish-1', kind: 'finishing', amountToman: '100',
      }],
    }],
  };
  assert.throws(
    () => buildApprovedPricingVersion(disguisedBase, 1, 'disguised-base'),
    /canonical base component conflicts/
  );

  const conflictingGraphTotal = approvedPricingSourceFixture();
  conflictingGraphTotal.contract.productGraph = {
    ...conflictingGraphTotal.contract.productGraph!, totalAmountToman: '1251',
  };
  assert.throws(() => buildApprovedPricingVersion(conflictingGraphTotal, 1, 'v1'), /graph total conflicts/);

  const conflictingQuantity = approvedPricingSourceFixture();
  conflictingQuantity.contract.productGraph = {
    ...conflictingQuantity.contract.productGraph!,
    rows: [{ ...conflictingQuantity.contract.productGraph!.rows[0]!, requestedQuantity: '5' }],
  };
  assert.throws(() => buildApprovedPricingVersion(conflictingQuantity, 1, 'v1'), /canonical quantity conflicts/);
});
