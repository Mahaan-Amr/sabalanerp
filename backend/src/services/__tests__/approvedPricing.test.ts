import assert from 'node:assert/strict';
import test from 'node:test';
import { AccountingRecordStatus, FinancialRecordKind } from '@prisma/client';
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
import { canonicalOptimizerDerivedLengthWitness } from '../optimizerDerivedQuantityEvidence';

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
    inputHash: 'stair-layer-input-hash',
    resultHash: 'stair-layer-result-hash',
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

const optimizerDerivedSourceFixture = () => {
  const source = approvedPricingSourceFixture();
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
      rows: [{ deliveryId: 'delivery-1', deliveryProductId: 'delivery-product-1', quantity: '40.000' }],
      totalQuantity: '40.000',
    },
    wizardDelivery: { present: true, totalQuantity: '40.000' },
  }]);
});

test('keeps incomplete or conflicting optimizer-derived quantity evidence fail-closed', () => {
  const cases: readonly [string, (source: ApprovedPricingSource) => void, RegExp][] = [
    ['missing persisted Delivery', source => {
      (source.leaf.sourceSnapshot as any).deliveries = [];
    }, /persisted Delivery evidence is missing/],
    ['partial persisted Delivery', source => {
      (source.leaf.sourceSnapshot as any).deliveries[0].products[0].quantity = '39.999';
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
    ['more than scale-three precision', source => {
      (source.contract.contractData as any).products[0].smartCutPlan.totalRequestedLengthM = '40.0001';
    }, /must use scale-three precision/],
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
