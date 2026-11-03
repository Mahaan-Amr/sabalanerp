import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../lib/prisma';
import { ContractItemSynchronizationError, synchronizeContractItems } from '../contractService';
import { CURRENT_CONTRACT_PRODUCT_POLICY_V2 } from '../contractProductGraphMigration';

const rollback = Symbol('contract item synchronization rollback');

test('an edit keeps approved-pricing rows attached to their original contract-item IDs', async () => {
  const contract = await prisma.salesContract.findFirst({
    where: { items: { some: { approvedPricingRows: { some: {} } } } },
    include: { items: { orderBy: { createdAt: 'asc' } } },
  });
  assert(contract, 'sabalanerp-local needs one contract with approved pricing evidence');
  assert(contract.items.length > 0);
  assert(contract.items.every(item => item.productRowId));

  const target = contract.items[0];
  const originalItemId = target.id;
  const nextUnitPrice = Number(target.unitPrice.toString()) + 1;

  try {
    await prisma.$transaction(async tx => {
      await synchronizeContractItems(tx, contract.id, contract.items.map(item => ({
        productId: item.productId,
        productRowId: item.productRowId,
        productType: item.productType,
        quantity: Number(item.quantity.toString()),
        unitPrice: item.id === target.id ? nextUnitPrice : Number(item.unitPrice.toString()),
        totalPrice: Number(item.totalPrice.toString()),
        description: item.description,
        isMandatory: item.isMandatory,
        mandatoryPercentage: item.mandatoryPercentage == null
          ? null
          : Number(item.mandatoryPercentage.toString()),
        originalTotalPrice: item.originalTotalPrice == null
          ? null
          : Number(item.originalTotalPrice.toString()),
        stairSystemId: item.stairSystemId,
        stairPartType: item.stairPartType,
      })), CURRENT_CONTRACT_PRODUCT_POLICY_V2);

      const persisted = await tx.contractItem.findUniqueOrThrow({ where: { id: originalItemId } });
      assert.equal(Number(persisted.unitPrice.toString()), nextUnitPrice);
      assert.equal(persisted.productRowId, target.productRowId);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
});

test('removing a row with approved evidence returns a business conflict instead of a database failure', async () => {
  const contract = await prisma.salesContract.findFirst({
    where: { items: { some: { approvedPricingRows: { some: {} } } } },
    include: {
      items: {
        include: { approvedPricingRows: { select: { id: true }, take: 1 } },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  assert(contract);
  const protectedItem = contract.items.find(item => item.approvedPricingRows.length > 0);
  assert(protectedItem);

  await assert.rejects(
    prisma.$transaction(tx => synchronizeContractItems(
      tx,
      contract.id,
      contract.items.filter(item => item.id !== protectedItem.id).map(item => ({
        productId: item.productId,
        productRowId: item.productRowId,
        productType: item.productType,
        quantity: Number(item.quantity.toString()),
        unitPrice: Number(item.unitPrice.toString()),
        totalPrice: Number(item.totalPrice.toString()),
        description: item.description,
        isMandatory: item.isMandatory,
        mandatoryPercentage: item.mandatoryPercentage == null
          ? null
          : Number(item.mandatoryPercentage.toString()),
        originalTotalPrice: item.originalTotalPrice == null
          ? null
          : Number(item.originalTotalPrice.toString()),
        stairSystemId: item.stairSystemId,
        stairPartType: item.stairPartType,
      })),
      CURRENT_CONTRACT_PRODUCT_POLICY_V2,
    )),
    (error: unknown) => error instanceof ContractItemSynchronizationError &&
      error.code === 'contract-item-has-downstream-evidence' &&
      error.status === 409,
  );
});
