import assert from 'node:assert/strict';
import { replayRemainingStoneAllocations } from '../remainingStoneAllocationReplayService';
import type { ContractProduct, RemainingStone } from '../../types/contract.types';
import { ensureContractProductRowIds } from '../../utils/contractProductIdentity';
import { getAvailableRemainingStoneInventory } from '../../utils/remainingStoneGuards';
import {
  hasUnresolvedLegacyRemainingChildAddOns,
  recalculateRemainingChildAddOns,
  resolveLegacyRemainingChildAddOns
} from '../remainingStoneChildAddOnService';

const stock = (width: number, length: number, quantity = 1): RemainingStone => ({
  id: `stock-${width}-${length}-${quantity}`,
  width,
  length,
  quantity,
  squareMeters: (width * length * quantity) / 100,
  isAvailable: true,
  sourceCutId: `cut-${width}-${length}`
});

const catalogProduct = {
  id: 'catalog-stone-1',
  code: 'STONE-1',
  name: 'Stone',
  namePersian: 'سنگ تست',
  widthValue: 60,
  basePrice: 1000
} as any;

const source = (rowId: string, inventory: RemainingStone[]): ContractProduct => ({
  rowId,
  productId: catalogProduct.id,
  product: catalogProduct,
  productType: 'longitudinal',
  stoneCode: 'STONE-1',
  stoneName: 'سنگ منبع',
  diameterOrWidth: 60,
  length: 3,
  width: 40,
  quantity: 1,
  squareMeters: 1.2,
  pricePerSquareMeter: 1000,
  totalPrice: 1200,
  description: '',
  currency: 'تومان',
  lengthUnit: 'm',
  widthUnit: 'cm',
  isMandatory: false,
  mandatoryPercentage: 0,
  originalTotalPrice: 1200,
  isCut: true,
  cutType: 'longitudinal',
  originalWidth: 60,
  originalLength: 3,
  cuttingCost: 0,
  cuttingCostPerMeter: 50,
  cutDescription: '',
  remainingStoneSourceInventory: inventory,
  remainingStones: inventory,
  cutDetails: [],
  usedRemainingStones: [],
  totalUsedRemainingWidth: 0,
  totalUsedRemainingLength: 0,
  appliedSubServices: [],
  totalSubServiceCost: 0,
  usedLengthForSubServices: 0,
  usedSquareMetersForSubServices: 0
});

const child = (rowId: string, sourceRowId: string, order: number): ContractProduct => ({
  ...source(rowId, []),
  rowId,
  parentProductRowId: sourceRowId,
  remainingStoneAllocationOrder: order,
  stoneCode: `CHILD-${order}`,
  stoneName: `فرزند ${order + 1}`,
  width: 20,
  diameterOrWidth: 20,
  length: 3,
  quantity: 1,
  squareMeters: 0.6,
  pricePerSquareMeter: 0,
  unitPrice: 0,
  totalPrice: 0,
  originalTotalPrice: 0,
  isMandatory: false,
  mandatoryPercentage: 0,
  cuttingCostPerMeter: 50,
  remainingStoneSourceInventory: undefined,
  meta: {
    remainingSource: {
      sourceProductRowId: sourceRowId,
      allocationId: `allocation-${rowId}`,
      allocationOrder: order
    }
  }
});

{
  const parent = source('source-secondary-remnants', [stock(14, 0.8)]);
  const allocatedChild = child('child-two-axis-cut', parent.rowId as string, 0);
  allocatedChild.width = 7;
  allocatedChild.diameterOrWidth = 7;
  allocatedChild.length = 0.6;
  allocatedChild.squareMeters = 0.042;
  allocatedChild.cuttingCostPerMeter = 20_000;

  const result = replayRemainingStoneAllocations({
    products: [parent, allocatedChild],
    sourceRowId: parent.rowId as string
  });

  assert.equal(result.ok, true);
  const replayedParent = result.products[0];
  const replayedChild = result.products[1];
  const available = getAvailableRemainingStoneInventory(replayedParent);

  assert.deepEqual(
    available.map((stone) => [Number(stone.width.toFixed(6)), Number(stone.length.toFixed(6))]),
    [[7, 0.2], [7, 0.8]]
  );
  assert.equal(Number(available.reduce((sum, stone) => sum + stone.squareMeters, 0).toFixed(6)), 0.07);
  assert.deepEqual(replayedChild.cuttingBreakdown, [
    { type: 'longitudinal', meters: 0.6, rate: 20_000, cost: 12_000 },
    { type: 'cross', meters: 0.07, rate: 20_000, cost: 1_400 }
  ]);
  assert.equal(replayedChild.cuttingCost, 13_400);
  assert.equal(replayedChild.totalPrice, 13_400);
}

{
  const parent = source('source-a', [stock(60, 3)]);
  const first = child('child-a', parent.rowId as string, 0);
  first.appliedSubServices = [{
    id: 'applied-tool',
    subServiceId: 'tool-1',
    subService: { id: 'tool-1', name: 'Tool', namePersian: 'ابزار تست', pricePerMeter: 100, calculationBase: 'length' } as any,
    meter: 3,
    cost: 300,
    calculationBase: 'length'
  }];
  first.finishingId = 'finish-1';
  first.finishingName = 'پرداخت تست';
  first.finishingCalculationBase = 'squareMeters';
  first.finishingQuantity = 0.6;
  first.finishingUnitPrice = 200;
  first.finishingCost = 120;
  const second = child('child-b', parent.rowId as string, 1);

  const result = replayRemainingStoneAllocations({
    products: [parent, first, second],
    sourceRowId: parent.rowId as string
  });

  assert.equal(result.ok, true);
  const replayedParent = result.products.find((product) => product.rowId === parent.rowId)!;
  const replayedFirst = result.products.find((product) => product.rowId === first.rowId)!;
  assert.equal(Number(replayedParent.remainingStones.reduce((sum, item) => sum + item.squareMeters, 0).toFixed(6)), 0.6);
  assert.equal(replayedParent.usedRemainingStones.length, 2);
  assert.equal(replayedFirst.pricePerSquareMeter, 0);
  assert.equal(replayedFirst.originalTotalPrice, 0);
  assert.equal(replayedFirst.totalPrice, 570);
  assert.equal(replayedFirst.meta?.pricing?.materialCost, 0);
}

{
  const parent = source('source-conflict', [stock(60, 3)]);
  const first = child('child-first', parent.rowId as string, 0);
  const second = child('child-second', parent.rowId as string, 1);
  const originalProducts = [parent, first, second];
  const result = replayRemainingStoneAllocations({
    products: originalProducts,
    sourceRowId: parent.rowId as string,
    sourceInventory: [stock(30, 3)]
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts.length, 1);
  assert.equal(result.conflicts[0].childRowId, second.rowId);
  assert.equal(result.products, originalProducts);
  assert.equal(parent.remainingStones[0].width, 60);
}

{
  const firstSource = source('duplicate-source-a', [stock(60, 3)]);
  const secondSource = source('duplicate-source-b', [stock(60, 3)]);
  const allocatedChild = child('duplicate-child', secondSource.rowId as string, 0);
  const result = replayRemainingStoneAllocations({
    products: [firstSource, secondSource, allocatedChild],
    sourceRowId: secondSource.rowId as string
  });

  assert.equal(result.ok, true);
  assert.equal(result.products[0].remainingStones[0].squareMeters, firstSource.remainingStones[0].squareMeters);
  assert.equal(result.products[1].usedRemainingStones.length, 1);
  assert.equal(result.products[2].parentProductRowId, secondSource.rowId);
}

{
  const parent = source('source-delete', [stock(60, 3)]);
  const survivor = child('surviving-child', parent.rowId as string, 1);
  const result = replayRemainingStoneAllocations({
    products: [parent, survivor],
    sourceRowId: parent.rowId as string
  });

  assert.equal(result.ok, true);
  assert.equal(Number(result.products[0].remainingStones.reduce((sum, item) => sum + item.squareMeters, 0).toFixed(6)), 1.2);
  assert.equal(result.products[1].remainingStoneAllocationOrder, 1);
}

{
  const parent = source('source-addon-conflict', [stock(60, 3)]);
  const conflictingChild = child('child-addon-conflict', parent.rowId as string, 0);
  conflictingChild.finishingId = 'finish-1';
  conflictingChild.finishingName = 'پرداخت نامعتبر';
  conflictingChild.finishingCalculationBase = 'squareMeters';
  conflictingChild.finishingQuantity = 1;
  conflictingChild.finishingUnitPrice = 100;

  const result = replayRemainingStoneAllocations({
    products: [parent, conflictingChild],
    sourceRowId: parent.rowId as string
  });

  assert.equal(result.ok, false);
  assert.equal(result.conflicts[0].childRowId, conflictingChild.rowId);
  assert.match(result.conflicts[0].reason, /پرداخت سنگ/);
}

{
  const legacySource = { ...source('legacy-source', [stock(60, 3)]), rowId: undefined };
  const legacyChild = {
    ...child('legacy-child', 'temporary', 0),
    rowId: undefined,
    parentProductRowId: undefined,
    parentProductIndex: 0,
    meta: { remainingSource: { sourceProductIndex: 0, partitionId: 'legacy-allocation' } }
  } as ContractProduct;
  const migrated = ensureContractProductRowIds([legacySource, legacyChild]);
  const reordered = ensureContractProductRowIds([migrated[1], migrated[0]]);

  assert.equal(migrated[1].parentProductRowId, migrated[0].rowId);
  assert.equal(reordered[0].parentProductRowId, reordered[1].rowId);
  assert.equal(reordered[0].parentProductIndex, 1);
  assert.equal(reordered[0].meta?.remainingSource?.sourceProductIndex, 1);
}

{
  const product = child('edge-tool-child', 'edge-tool-source', 0);
  product.quantity = 2;
  product.squareMeters = 1.2;
  product.appliedSubServices = [{
    id: 'edge-tool',
    subServiceId: 'edge-tool-catalog',
    subService: { id: 'edge-tool-catalog', namePersian: 'ابزار لبه', pricePerMeter: 100 } as any,
    meter: 999,
    cost: 99900,
    calculationBase: 'length',
    edges: { front: true, left: true }
  }];
  const recalculated = recalculateRemainingChildAddOns(product);

  assert.equal(recalculated.ok, true);
  assert.equal(Number(recalculated.product.appliedSubServices[0].meter.toFixed(6)), 6.4);
  assert.equal(recalculated.product.totalSubServiceCost, 640);
  assert.equal(recalculated.product.meta?.tools?.[0]?.computedMeters, 6.4);
}

{
  const parent = source('legacy-addon-source', [stock(60, 3)]);
  const legacyChild = child('legacy-addon-child', parent.rowId as string, 0);
  legacyChild.meta.tools = [{
    toolId: 'legacy-tool',
    name: 'ابزار قدیمی',
    pricePerMeter: 100,
    calculationBase: 'length',
    computedMeters: 3,
    edges: { front: true }
  }];
  legacyChild.meta.finishing = {
    id: 'legacy-finishing',
    name: 'پرداخت قدیمی',
    unitPrice: 200,
    calculationBase: 'squareMeters',
    quantity: 0.6
  };

  assert.equal(hasUnresolvedLegacyRemainingChildAddOns(legacyChild), true);
  const blocked = replayRemainingStoneAllocations({
    products: [parent, legacyChild],
    sourceRowId: parent.rowId as string
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.products[1].meta?.tools?.length, 1);

  const adopted = resolveLegacyRemainingChildAddOns(legacyChild, 'adopt');
  assert.equal(adopted.ok, true);
  assert.equal(adopted.product.legacyRemainingAddOnResolution, 'adopted');
  assert.equal(adopted.product.appliedSubServices.length, 1);
  assert.equal(adopted.product.finishingId, 'legacy-finishing');

  const removed = resolveLegacyRemainingChildAddOns(legacyChild, 'remove');
  assert.equal(removed.ok, true);
  assert.equal(removed.product.legacyRemainingAddOnResolution, 'removed');
  assert.equal(removed.product.meta?.tools, undefined);
  assert.equal(removed.product.meta?.finishing, undefined);
}

console.log('remainingStoneAllocationReplayService tests passed');
