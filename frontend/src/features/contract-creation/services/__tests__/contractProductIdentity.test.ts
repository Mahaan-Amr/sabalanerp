import assert from 'node:assert/strict';
import type { ContractProduct, ContractWizardData, DeliverySchedule } from '../../types/contract.types';
import {
  normalizeContractProductRowIdentities,
  prepareStairEditReplacementRowIdentities,
  resolveEditedContractProductRowId
} from '../../utils/contractProductIdentity';
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

console.log('contract product identity tests passed');
