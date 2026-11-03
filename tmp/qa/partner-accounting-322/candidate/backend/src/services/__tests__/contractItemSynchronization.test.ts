import assert from 'node:assert/strict';
import test from 'node:test';
import type { Prisma } from '@prisma/client';
import { synchronizeContractItems } from '../contractService';
import { CURRENT_CONTRACT_PRODUCT_POLICY_V2 } from '../contractProductGraphMigration';

test('contract edits preserve the database identity of an existing stable product row', async () => {
  const calls: Array<{ operation: string; args: unknown }> = [];
  const tx = {
    contractItem: {
      findMany: async () => [{ id: 'item-1', productRowId: 'row-1' }],
      update: async (args: unknown) => {
        calls.push({ operation: 'update', args });
        return {};
      },
      create: async (args: unknown) => {
        calls.push({ operation: 'create', args });
        return {};
      },
      delete: async (args: unknown) => {
        calls.push({ operation: 'delete', args });
        return {};
      },
    },
  } as unknown as Prisma.TransactionClient;

  await synchronizeContractItems(tx, 'contract-1', [{
    productId: 'product-1',
    productRowId: 'row-1',
    productType: 'longitudinal',
    quantity: 50,
    unitPrice: 8_500_000,
    totalPrice: 425_000_000,
  }], CURRENT_CONTRACT_PRODUCT_POLICY_V2);

  assert.deepEqual(calls.map(call => call.operation), ['update']);
  const updateArgs = calls[0]?.args as { data: { quantity: { toFixed(scale: number): string } } };
  assert.equal(updateArgs.data.quantity.toFixed(3), '50.000');
  assert.deepEqual({
    ...updateArgs,
    data: { ...updateArgs.data, quantity: updateArgs.data.quantity.toFixed(3) },
  }, {
    where: { id: 'item-1' },
    data: {
      productId: 'product-1',
      productRowId: 'row-1',
      productType: 'longitudinal',
      quantity: '50.000',
      unitPrice: 8_500_000,
      totalPrice: 425_000_000,
      description: null,
      isMandatory: false,
      mandatoryPercentage: null,
      originalTotalPrice: null,
      stairSystemId: null,
      stairPartType: null,
    },
  });
});
