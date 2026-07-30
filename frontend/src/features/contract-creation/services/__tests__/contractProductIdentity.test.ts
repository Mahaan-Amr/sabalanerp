import assert from 'node:assert/strict';
import type { ContractProduct, ContractWizardData, DeliverySchedule } from '../../types/contract.types';
import {
  duplicateContractProductForIndependentEditing,
  normalizeContractProductRowIdentities,
  prepareStairEditReplacementRowIdentities,
  resolveEditedContractProductRowId
} from '../../utils/contractProductIdentity';
import {
  calculateProductOperations,
  parseCanonicalDecimal,
  parseStableIdentity,
  planLegacyProductGraphMigration
} from '@sabalanerp/contract-product-graph';
import {
  reconcileDeliveryProductReferences,
  removeInvalidDeliveryProductReference,
  setDeliveryProductAmount
} from '../../utils/deliveryScheduleController';
import { reconcileContractProductGraph } from '../../utils/contractProductGraphReconciliation';
import { validateWizardStep } from '../validationService';

const product = (
  rowId: string,
  quantity: number,
  totalPrice: number,
  overrides: Partial<ContractProduct> = {}
): ContractProduct => ({
  rowId,
  productId: 'shared-catalog-stone',
  productType: 'stair',
  stairPartType: 'tread',
  stoneName: 'same visible stone name',
  quantity,
  length: 1.2,
  lengthUnit: 'm',
  width: 40,
  widthUnit: 'cm',
  squareMeters: quantity * 0.48,
  pricePerSquareMeter: 4_950_000,
  totalPrice,
  usedRemainingStones: [],
  totalUsedRemainingWidth: 0,
  totalUsedRemainingLength: 0,
  appliedSubServices: [],
  totalSubServiceCost: 0,
  usedLengthForSubServices: 0,
  usedSquareMetersForSubServices: 0,
  ...overrides
} as ContractProduct);

{
  const first = product('accidentally-shared-row-id', 6, 28_992_000);
  const second = product('accidentally-shared-row-id', 14, 41_265_280);
  const result = normalizeContractProductRowIdentities([first, second]);

  assert.deepEqual(result.blockedDuplicateRowIds, []);
  assert.deepEqual(result.repairedDuplicateRowIds, ['accidentally-shared-row-id']);
  assert.notEqual(result.products[0].rowId, result.products[1].rowId);
  assert.deepEqual(
    result.products.map(({ quantity, squareMeters, totalPrice }) => ({ quantity, squareMeters, totalPrice })),
    [
      { quantity: 6, squareMeters: 2.88, totalPrice: 28_992_000 },
      { quantity: 14, squareMeters: 6.72, totalPrice: 41_265_280 }
    ]
  );

  const oldAmbiguousDelivery: DeliverySchedule[] = [{
    deliveryDate: '1405/05/04',
    projectManagerName: 'project manager',
    receiverName: 'receiver',
    products: [{
      productRowId: 'accidentally-shared-row-id',
      productIndex: 0,
      productId: 'shared-catalog-stone',
      quantity: 6,
      amount: 6,
      unit: 'count' as const
    }]
  }];
  const deliveryResult = reconcileDeliveryProductReferences(result.products, oldAmbiguousDelivery);
  assert.equal(deliveryResult.conflicts.length, 1);
  assert.equal(deliveryResult.conflicts[0].code, 'missing-product-row');

  const clearedDeliveries = removeInvalidDeliveryProductReference(
    deliveryResult.deliveries,
    deliveryResult.conflicts[0].deliveryIndex,
    deliveryResult.conflicts[0].productItemIndex
  );
  const firstFilledDelivery = setDeliveryProductAmount(clearedDeliveries[0], result.products, 0, 6);
  const fullyFilledDelivery = setDeliveryProductAmount(firstFilledDelivery, result.products, 1, 14);
  assert.equal(fullyFilledDelivery.products.length, 2);
  assert.notEqual(fullyFilledDelivery.products[0].productRowId, fullyFilledDelivery.products[1].productRowId);

  const deliveryValidation = validateWizardStep(5, {
    products: result.products,
    serviceRows: [],
    deliveries: [fullyFilledDelivery]
  } as unknown as ContractWizardData);
  assert.equal(deliveryValidation.isValid, true);
}

{
  const oldProduct = product('old-edited-row', 6, 28_992_000, { stairSystemId: 'stair-system-1' });
  const firstSessionRow = product('old-edited-row', 6, 28_992_000, { stairSystemId: 'draft-session' });
  const secondSessionRow = product('new-independent-row', 3, 10_509_600, { stairSystemId: 'draft-session' });
  const replacements = prepareStairEditReplacementRowIdentities(
    [firstSessionRow, secondSessionRow],
    oldProduct,
    4
  );

  assert.equal(replacements[0].rowId, 'old-edited-row');
  assert.equal(replacements[1].rowId, 'new-independent-row');
  assert.equal(replacements[0].stairSystemId, 'stair-system-1');
  assert.equal(replacements[1].stairSystemId, 'stair-system-1');

  assert.equal(
    resolveEditedContractProductRowId([firstSessionRow, secondSessionRow], 1),
    'new-independent-row'
  );
}

{
  const firstParent = product('ambiguous-parent-row', 6, 28_992_000);
  const secondParent = product('ambiguous-parent-row', 3, 10_509_600);
  const remainingChild = product('remaining-child-row', 1, 38_000, {
    productType: 'longitudinal',
    parentProductRowId: 'ambiguous-parent-row',
    meta: {
      remainingSource: {
        sourceProductRowId: 'ambiguous-parent-row',
        sourceProductIndex: 0
      }
    }
  });
  const result = normalizeContractProductRowIdentities([firstParent, secondParent, remainingChild]);

  assert.deepEqual(result.repairedDuplicateRowIds, []);
  assert.deepEqual(result.blockedDuplicateRowIds, ['ambiguous-parent-row']);
  assert.equal(result.products[0].rowId, 'ambiguous-parent-row');
  assert.equal(result.products[1].rowId, 'ambiguous-parent-row');
  assert.equal(result.products[2].parentProductRowId, 'ambiguous-parent-row');
  assert.equal(
    reconcileContractProductGraph(result.products).some((conflict) => conflict.rowId === 'ambiguous-parent-row'),
    true
  );
}

{
  const source = product('source-row', 3, 936_300, {
    productType: 'longitudinal',
    longitudinalPolicyInput: {
      calculationPolicyVersion: 'calculation-v1',
      packingPolicyVersion: 'packing-v1',
      pricingPolicyVersion: 'pricing-v1',
      roundingPolicyVersion: 'rounding-v1',
      sourceBatchId: parseStableIdentity('source-batch', 'source-batch:source-row'),
      motherWidthMeters: parseCanonicalDecimal('0.6'),
      lengthMeters: parseCanonicalDecimal('1.5'),
      widthMeters: parseCanonicalDecimal('0.2'),
      quantity: 3,
      lastManualField: 'width',
      lastManualDimension: 'width',
      lengthDisplayUnit: 'm',
      widthDisplayUnit: 'cm',
      baseMaterialPricing: 'manual-positive',
      baseRateToman: parseCanonicalDecimal('1000000'),
      mandatoryEnabled: false,
      mandatoryPercentage: parseCanonicalDecimal('20'),
      rememberedMandatoryPercentage: parseCanonicalDecimal('20'),
      sawKerfEnabled: false,
      sawKerfMeters: parseCanonicalDecimal('0'),
      calibrationEnabled: false,
      calibrationSelection: 'manual',
      longitudinalCutRateToman: parseCanonicalDecimal('10000'),
      calibrationCutRateToman: parseCanonicalDecimal('10000')
    },
    operationPolicyInput: {
      policyVersion: 'calculation-v1',
      pricingPolicyVersion: 'pricing-v1',
      roundingPolicyVersion: 'rounding-v1',
      productRowId: parseStableIdentity('product-row', 'source-row'),
      lengthMeters: parseCanonicalDecimal('1.5'),
      widthMeters: parseCanonicalDecimal('0.2'),
      quantity: 3,
      groups: [{
        operationGroupId: parseStableIdentity('operation-group', 'source-group'),
        scope: parseCanonicalDecimal('3')
      }],
      tools: [{
        toolSelectionId: parseStableIdentity('tool-selection', 'source-tool'),
        operationGroupId: parseStableIdentity('operation-group', 'source-group'),
        catalogItemId: 'tool-1',
        catalogSnapshotVersion: 'catalog-v1',
        name: 'ابزار تست',
        unit: 'meter',
        rateToman: parseCanonicalDecimal('1000'),
        edges: ['front']
      }],
      finishings: [{
        finishingSelectionId: parseStableIdentity('finishing-selection', 'source-finishing'),
        operationGroupId: parseStableIdentity('operation-group', 'source-group'),
        catalogItemId: 'finishing-1',
        catalogSnapshotVersion: 'catalog-v1',
        name: 'پرداخت تست',
        unit: 'squareMeter',
        rateToman: parseCanonicalDecimal('2000'),
        incompatibleCatalogItemIds: []
      }]
    },
    appliedSubServices: [{
      id: 'source-tool',
      subServiceId: 'tool-1',
      meter: 1.5,
      cost: 1_500,
      calculationBase: 'length'
    } as any],
    finishings: [{
      selectionId: 'source-finishing',
      finishingId: 'finishing-1',
      name: 'پرداخت تست',
      calculationBase: 'squareMeters',
      unitPrice: 2_000,
      automaticQuantity: 0.9,
      quantity: 0.9,
      quantityMode: 'auto',
      overrideStatus: 'current',
      cost: 1_800
    }]
  });

  const duplicate = duplicateContractProductForIndependentEditing(source, 0);

  assert.notEqual(duplicate.rowId, source.rowId);
  assert.equal(duplicate.totalPrice, source.totalPrice);
  assert.notEqual(
    duplicate.longitudinalPolicyInput?.sourceBatchId,
    source.longitudinalPolicyInput?.sourceBatchId
  );
  assert.equal(duplicate.operationPolicyInput?.productRowId, duplicate.rowId);
  assert.notEqual(
    duplicate.operationPolicyInput?.groups[0]?.operationGroupId,
    source.operationPolicyInput?.groups[0]?.operationGroupId
  );
  assert.equal(
    duplicate.operationPolicyInput?.tools[0]?.operationGroupId,
    duplicate.operationPolicyInput?.groups[0]?.operationGroupId
  );
  assert.notEqual(
    duplicate.operationPolicyInput?.tools[0]?.toolSelectionId,
    source.operationPolicyInput?.tools[0]?.toolSelectionId
  );
  assert.notEqual(
    duplicate.operationPolicyInput?.finishings[0]?.finishingSelectionId,
    source.operationPolicyInput?.finishings[0]?.finishingSelectionId
  );
  assert.equal(
    duplicate.appliedSubServices[0]?.id,
    duplicate.operationPolicyInput?.tools[0]?.toolSelectionId
  );
  assert.equal(
    duplicate.finishings?.[0]?.selectionId,
    duplicate.operationPolicyInput?.finishings[0]?.finishingSelectionId
  );

  const recoveredDraft = normalizeContractProductRowIdentities([
    source,
    {
      ...structuredClone(source),
      rowId: 'already-independent-row'
    }
  ]);
  assert.equal(recoveredDraft.products[0].rowId, 'source-row');
  assert.equal(recoveredDraft.products[1].rowId, 'already-independent-row');
  assert.equal(
    recoveredDraft.products[1].operationPolicyInput?.productRowId,
    'already-independent-row'
  );
  assert.notEqual(
    recoveredDraft.products[1].operationPolicyInput?.tools[0]?.toolSelectionId,
    source.operationPolicyInput?.tools[0]?.toolSelectionId
  );
  assert.notEqual(
    recoveredDraft.products[1].longitudinalPolicyInput?.sourceBatchId,
    source.longitudinalPolicyInput?.sourceBatchId
  );

  const canonicalSave = planLegacyProductGraphMigration({
    contractId: 'duplicated-longitudinal-contract',
    revision: 0,
    calculationPolicy: {
      calculation: 'calculation-v1',
      packing: 'packing-v1',
      pricing: 'pricing-v1',
      rounding: 'rounding-v1'
    },
    products: JSON.parse(JSON.stringify([source, duplicate])) as Readonly<Record<string, unknown>>[]
  });
  assert.equal(
    canonicalSave.ok,
    true,
    canonicalSave.ok ? undefined : JSON.stringify(canonicalSave.conflicts)
  );

  const repeatedGroup = structuredClone(source);
  repeatedGroup.rowId = 'repeatable-operation-row';
  repeatedGroup.operationPolicyInput = {
    ...structuredClone(source.operationPolicyInput!),
    productRowId: parseStableIdentity('product-row', 'repeatable-operation-row'),
    groups: [
      structuredClone(source.operationPolicyInput!.groups[0]),
      structuredClone(source.operationPolicyInput!.groups[0])
    ],
    tools: [
      structuredClone(source.operationPolicyInput!.tools[0]),
      structuredClone(source.operationPolicyInput!.tools[0])
    ]
  };
  repeatedGroup.appliedSubServices = [
    structuredClone(source.appliedSubServices[0]),
    structuredClone(source.appliedSubServices[0])
  ];
  repeatedGroup.totalSubServiceCost = 3_000;
  repeatedGroup.totalPrice = source.totalPrice;
  const repairedOperations = normalizeContractProductRowIdentities([repeatedGroup]);
  const repairedInput = repairedOperations.products[0].operationPolicyInput!;

  assert.deepEqual(repairedOperations.blockedOperationRowIds, []);
  assert.deepEqual(repairedOperations.repairedOperationRowIds, ['repeatable-operation-row']);
  assert.equal(repairedInput.groups.length, 1);
  assert.equal(repairedInput.tools.length, 2);
  assert.notEqual(
    repairedInput.tools[0].toolSelectionId,
    repairedInput.tools[1].toolSelectionId
  );
  assert.equal(
    repairedInput.tools[0].operationGroupId,
    repairedInput.groups[0].operationGroupId
  );
  assert.equal(
    repairedInput.tools[1].operationGroupId,
    repairedInput.groups[0].operationGroupId
  );
  assert.equal(
    repairedOperations.products[0].appliedSubServices[0].id,
    repairedInput.tools[0].toolSelectionId
  );
  assert.equal(
    repairedOperations.products[0].appliedSubServices[1].id,
    repairedInput.tools[1].toolSelectionId
  );
  const originalOperationTotal = calculateProductOperations(
    source.operationPolicyInput!
  );
  const repairedOperationTotal = calculateProductOperations(repairedInput);
  assert.equal(originalOperationTotal.ok, true);
  assert.equal(repairedOperationTotal.ok, true);
  if (!originalOperationTotal.ok || !repairedOperationTotal.ok) {
    throw new Error('Expected operation calculations to remain valid.');
  }
  repairedOperations.products[0].totalPrice =
    source.totalPrice +
    Number(repairedOperationTotal.result.totalAmountToman) -
    Number(originalOperationTotal.result.totalAmountToman);
  const repairedCanonicalSave = planLegacyProductGraphMigration({
    contractId: 'repaired-operation-identities',
    revision: 0,
    calculationPolicy: {
      calculation: 'calculation-v1',
      packing: 'packing-v1',
      pricing: 'pricing-v1',
      rounding: 'rounding-v1'
    },
    products: JSON.parse(JSON.stringify(repairedOperations.products)) as
      Readonly<Record<string, unknown>>[]
  });
  assert.equal(
    repairedCanonicalSave.ok,
    true,
    repairedCanonicalSave.ok
      ? undefined
      : JSON.stringify(repairedCanonicalSave.conflicts)
  );

  const contradictoryGroups = structuredClone(repeatedGroup);
  contradictoryGroups.rowId = 'ambiguous-operation-row';
  contradictoryGroups.operationPolicyInput = {
    ...contradictoryGroups.operationPolicyInput!,
    productRowId: parseStableIdentity('product-row', 'ambiguous-operation-row'),
    groups: [
      structuredClone(source.operationPolicyInput!.groups[0]),
      {
        ...structuredClone(source.operationPolicyInput!.groups[0]),
        scope: parseCanonicalDecimal('2')
      }
    ]
  };
  const blockedOperations = normalizeContractProductRowIdentities([contradictoryGroups]);
  assert.deepEqual(blockedOperations.repairedOperationRowIds, []);
  assert.deepEqual(blockedOperations.blockedOperationRowIds, ['ambiguous-operation-row']);
}

console.log('contract product identity tests passed');
