import assert from 'node:assert/strict';
import type { ContractProduct, DeliverySchedule } from '../../types/contract.types';
import {
  reconcileDeliveryProductReferences,
  removeInvalidDeliveryProductReference
} from '../../utils/deliveryScheduleController';

const product = (rowId: string, productId: string, overrides: Partial<ContractProduct> = {}): ContractProduct => ({
  rowId,
  productId,
  productType: 'stair',
  stoneName: rowId,
  quantity: 1,
  length: 1,
  lengthUnit: 'm',
  width: 35,
  widthUnit: 'cm',
  squareMeters: 0.35,
  pricePerSquareMeter: 1,
  totalPrice: 1,
  ...overrides
} as ContractProduct);

const delivery = (productIndex: number, productId: string): DeliverySchedule => ({
  deliveryDate: '1405/04/28',
  projectManagerName: 'مدیر پروژه',
  receiverName: 'تحویل گیرنده',
  products: [{ productIndex, productId, quantity: 1, amount: 1, unit: 'count' }]
});

{
  const products = [product('row-a', 'shared-catalog'), product('row-b', 'shared-catalog')];
  const result = reconcileDeliveryProductReferences(products, [delivery(1, 'shared-catalog')]);

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.deliveries[0].products[0].productRowId, 'row-b');
  assert.equal(result.deliveries[0].products[0].productIndex, 1);
}

{
  const products = [product('duplicate-row', 'catalog-a'), product('duplicate-row', 'catalog-b')];
  const result = reconcileDeliveryProductReferences(products, [delivery(0, 'catalog-a')]);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, 'duplicate-product-row-id');
  assert.equal(result.deliveries[0].products[0].productRowId, undefined);
}

{
  const products = [product('row-a', 'catalog-a'), product('row-b', 'catalog-b')];
  const result = reconcileDeliveryProductReferences(products, [delivery(1, 'catalog-a')]);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, 'legacy-product-mismatch');
  assert.equal(result.conflicts[0].quantity, 1);
  assert.equal(result.deliveries[0].products[0].productRowId, undefined);

  const afterExplicitRemoval = removeInvalidDeliveryProductReference(
    result.deliveries,
    result.conflicts[0].deliveryIndex,
    result.conflicts[0].productItemIndex
  );
  assert.equal(afterExplicitRemoval[0].products.length, 0);
  assert.deepEqual(reconcileDeliveryProductReferences(products, afterExplicitRemoval).conflicts, []);
}

{
  const originalProducts = [product('stair-parent', 'stair-catalog'), product('row-b', 'catalog-b')];
  const migrated = reconcileDeliveryProductReferences(originalProducts, [delivery(1, 'catalog-b')]);
  const layer = product('stair-layer', 'stair-catalog', {
    parentProductRowId: 'stair-parent',
    meta: { isLayer: true }
  });
  const afterStairEdit = reconcileDeliveryProductReferences(
    [originalProducts[0], layer, originalProducts[1]],
    migrated.deliveries
  );

  assert.deepEqual(afterStairEdit.conflicts, []);
  assert.equal(afterStairEdit.deliveries[0].products[0].productRowId, 'row-b');
  assert.equal(afterStairEdit.deliveries[0].products[0].productIndex, 2);
  assert.equal(afterStairEdit.deliveries[0].products[0].quantity, 1);
}

{
  const canonicalDelivery = delivery(0, 'old-catalog');
  canonicalDelivery.products[0].productRowId = 'row-a';
  const result = reconcileDeliveryProductReferences(
    [product('row-a', 'new-catalog')],
    [canonicalDelivery]
  );

  assert.deepEqual(result.conflicts, []);
  assert.equal(result.deliveries[0].products[0].productId, 'new-catalog');
  assert.equal(result.deliveries[0].products[0].quantity, 1);
}

{
  const previousProducts = [product('row-a', 'catalog-a', { quantity: 22 })];
  const editedProducts = [product('row-a', 'catalog-a', { quantity: 21 })];
  const fullyAssignedDelivery = delivery(0, 'catalog-a');
  fullyAssignedDelivery.products[0] = {
    ...fullyAssignedDelivery.products[0],
    productRowId: 'row-a',
    quantity: 22,
    amount: 22
  };

  const result = reconcileDeliveryProductReferences(
    editedProducts,
    [fullyAssignedDelivery],
    previousProducts
  );

  assert.equal(
    result.deliveries[0].products[0].amount,
    21,
    'a fully assigned delivery follows the edited contract product count'
  );
}

{
  const previousProducts = [product('row-a', 'catalog-a', { quantity: 22 })];
  const editedProducts = [product('row-a', 'catalog-a', { quantity: 21 })];
  const firstDelivery = delivery(0, 'catalog-a');
  firstDelivery.products[0] = {
    ...firstDelivery.products[0],
    productRowId: 'row-a',
    quantity: 10,
    amount: 10
  };
  const finalDelivery = delivery(0, 'catalog-a');
  finalDelivery.products[0] = {
    ...finalDelivery.products[0],
    productRowId: 'row-a',
    quantity: 12,
    amount: 12
  };

  const result = reconcileDeliveryProductReferences(
    editedProducts,
    [firstDelivery, finalDelivery],
    previousProducts
  );

  assert.deepEqual(
    result.deliveries.map((scheduledDelivery) => scheduledDelivery.products[0].amount),
    [10, 11],
    'earlier delivery allocations stay stable and the final allocation absorbs the product edit'
  );
}

{
  const previousProducts = [product('row-a', 'catalog-a', { quantity: 22 })];
  const editedProducts = [product('row-a', 'catalog-a', { quantity: 21 })];
  const partiallyAssignedDelivery = delivery(0, 'catalog-a');
  partiallyAssignedDelivery.products[0] = {
    ...partiallyAssignedDelivery.products[0],
    productRowId: 'row-a',
    quantity: 10,
    amount: 10
  };

  const result = reconcileDeliveryProductReferences(
    editedProducts,
    [partiallyAssignedDelivery],
    previousProducts
  );

  assert.equal(
    result.deliveries[0].products[0].amount,
    10,
    'an intentional partial allocation is not silently rewritten'
  );
}

{
  const canonicalDelivery = delivery(0, 'catalog-a');
  canonicalDelivery.products[0].productRowId = 'deleted-row';
  const result = reconcileDeliveryProductReferences([product('row-a', 'catalog-a')], [canonicalDelivery]);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, 'missing-product-row');
}

{
  const layer = product('stair-layer', 'stair-catalog', {
    parentProductRowId: 'stair-parent',
    meta: { isLayer: true }
  });
  const result = reconcileDeliveryProductReferences([layer], [delivery(0, 'stair-catalog')]);

  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].code, 'non-deliverable-product');
  assert.equal(result.deliveries[0].products[0].productRowId, undefined);
}

console.log('delivery product identity tests passed');
