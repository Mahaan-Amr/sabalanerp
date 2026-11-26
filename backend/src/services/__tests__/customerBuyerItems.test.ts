import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { readCustomerBuyerItems } from '../customerBuyerItems';

test('buyer items retain repeat purchases in different contract states and compare only stone prices', async () => {
  const product = { namePersian: 'نام کاتالوگ' };
  const contractData = { products: [
    { rowId: 'row-1', stoneName: 'نام قرارداد', productType: 'longitudinal', length: 250, lengthUnit: 'cm',
      quantity: 4, squareMeters: '3.25', currency: 'IRR' },
  ] };
  const base = {
    createdAt: new Date('2026-11-25T08:00:00Z'), currency: 'ریال', commercialFlowVersion: 0,
    isInactive: false, productGraphState: null,
  };
  const rows = [
    { ...base, id: 'draft', status: 'DRAFT', contractNumber: '100', contractData,
      items: [{ id: 'draft-item', productRowId: 'row-1', productId: 'same-stone', product,
        quantity: new Prisma.Decimal(4), isMandatory: true, mandatoryPercentage: new Prisma.Decimal(20),
        originalTotalPrice: new Prisma.Decimal(1000), totalPrice: new Prisma.Decimal(1500) }] },
    { ...base, id: 'cancelled', status: 'CANCELLED', contractNumber: '99',
      contractData: { products: [{ rowId: 'row-2', unit: 'squareMeter' }] },
      items: [{ id: 'cancelled-item', productRowId: 'row-2', productId: 'same-stone', product,
        quantity: new Prisma.Decimal('7.5'), isMandatory: false, mandatoryPercentage: null,
        originalTotalPrice: null, totalPrice: new Prisma.Decimal(1100) }] },
  ];
  const tx = { salesContract: { findMany: async (args: Prisma.SalesContractFindManyArgs) => {
    assert.equal(args.where?.customerId, 'customer');
    assert.equal(args.where?.status, undefined);
    assert.deepEqual(args.select?.items && typeof args.select.items === 'object' && args.select.items.where, { retiredAt: null });
    return rows;
  } } } as unknown as Prisma.TransactionClient;
  const result = await readCustomerBuyerItems(tx, {
    customerId: 'customer', actor: { id: 'viewer', role: 'ADMIN' }, includeOrdinary: true, correlationId: 'test',
  });

  assert.deepEqual(result.map(row => [row.id, row.productKey, row.contract.status]), [
    ['draft-item', 'same-stone', 'DRAFT'], ['cancelled-item', 'same-stone', 'CANCELLED'],
  ]);
  assert.deepEqual([result[0].name, result[0].squareMeters, result[0].linearMeters, result[0].pieceCount],
    ['نام قرارداد', '3.25', '10', '4']);
  assert.deepEqual([result[0].beforeToman, result[0].afterToman, result[0].totalToman], ['100', '120', '150']);
  assert.deepEqual([result[1].squareMeters, result[1].linearMeters, result[1].pieceCount, result[1].beforeToman],
    ['7.5', null, null, null]);
});
