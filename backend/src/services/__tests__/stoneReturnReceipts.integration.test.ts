import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { publishGuardInboundOperationalEvidence } from '../accountingOperationalEvidence';
import { readStoneReturnAvailability } from '../stoneReturnAvailability';
import { readStoneReturnReceipt, recordStoneReturnReceipt } from '../stoneReturnReceipts';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('Logistics receipt is recoverable in Accounting and posts only accepted sellable stock', { skip: !url }, async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  const rollback = new Error('rollback isolated fixture');
  try {
    await assert.rejects(db.$transaction(async tx => {
      const customer = await tx.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'مرجوعی' } });
      const product = await tx.product.create({ data: {
        code: randomUUID(), name: 'stone return fixture', namePersian: 'سنگ آزمون',
        cuttingDimensionCode: '1', cuttingDimensionName: 'slab', cuttingDimensionNamePersian: 'اسلب',
        stoneTypeCode: '1', stoneTypeName: 'granite', stoneTypeNamePersian: 'گرانیت',
        widthCode: '1', widthValue: 60, widthName: '۶۰',
        thicknessCode: '1', thicknessValue: 2, thicknessName: '۲',
        mineCode: '1', mineName: 'mine', mineNamePersian: 'معدن',
        finishCode: '1', finishName: 'flamed', finishNamePersian: 'فلیم',
        colorCode: '1', colorName: 'grey', colorNamePersian: 'خاکستری',
        qualityCode: '1', qualityName: 'first', qualityNamePersian: 'درجه یک', images: [],
      } });
      const actorId = randomUUID();
      const command = {
        requestId: randomUUID(), customerId: customer.id, productId: product.id, unit: 'squareMeter',
        receivedQuantity: '40', acceptedQuantity: '35', rejectionReason: 'لب‌پریدگی',
      };
      const first = await recordStoneReturnReceipt(tx, actorId, command);
      const reviewed = await readStoneReturnReceipt(tx, first.data.id);
      assert.deepEqual(
        [reviewed.receivedQuantity, reviewed.acceptedQuantity, reviewed.rejectedQuantity, reviewed.rejectionReason],
        ['40', '35', '5', 'لب‌پریدگی'],
      );
      assert.equal(reviewed.guardReturnMovementId, null);
      assert.ok(reviewed.inventoryIdentityId);
      assert.deepEqual((await readStoneReturnAvailability(tx, [product.id])).get(product.id), [{ unit: 'squareMeter', quantity: '35' }]);

      const retry = await recordStoneReturnReceipt(tx, actorId, { ...command, acceptedQuantity: '35.00' });
      assert.equal(retry.replayed, true);
      assert.equal(retry.data.id, first.data.id);
      await assert.rejects(recordStoneReturnReceipt(tx, actorId, { ...command, acceptedQuantity: '30' }), /قبلاً با اطلاعات دیگری/);

      const rejected = await recordStoneReturnReceipt(tx, actorId, { ...command, requestId: randomUUID(), acceptedQuantity: '0' });
      assert.equal(rejected.data.inventoryIdentityId, null);
      assert.deepEqual((await readStoneReturnAvailability(tx, [product.id])).get(product.id), [{ unit: 'squareMeter', quantity: '35' }]);

      const movement = await tx.securityVehicleMovement.create({ data: {
        movementNumber: randomUUID(), direction: 'INBOUND', purpose: 'SALES_RETURN', status: 'INFO_COMPLETED',
        customerId: customer.id, occurredAt: new Date(), createdBy: actorId,
      } });
      await publishGuardInboundOperationalEvidence(tx, { sourceId: movement.id, sourceVersion: 1,
        sourcePayload: { movementId: movement.id, movementNumber: movement.movementNumber }, occurredAt: movement.occurredAt,
      });
      const witnessed = { ...command, requestId: randomUUID(), guardReturnMovementId: movement.id };
      const result = await recordStoneReturnReceipt(tx, actorId, witnessed);
      assert.equal((await readStoneReturnReceipt(tx, result.data.id)).guardReturnMovementId, movement.id);
      await assert.rejects(recordStoneReturnReceipt(tx, actorId, { ...witnessed, requestId: randomUUID() }), /همین سنگ و واحد/);
      assert.deepEqual((await readStoneReturnAvailability(tx, [product.id])).get(product.id), [{ unit: 'squareMeter', quantity: '70' }]);
      throw rollback;
    }, { timeout: 30_000 }), error => error === rollback);
  } finally {
    await db.$disconnect();
  }
});
