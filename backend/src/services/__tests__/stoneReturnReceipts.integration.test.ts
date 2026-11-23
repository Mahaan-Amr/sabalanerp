import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import path from 'node:path';
import { publishGuardInboundOperationalEvidence } from '../accountingOperationalEvidence';
import { readStoneReturnAvailability } from '../stoneReturnAvailability';
import { readStoneReturnReceipt, recordStoneReturnReceipt } from '../stoneReturnReceipts';

import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const sourceDatabaseUrl = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('Logistics receipt is recoverable in Accounting and posts only accepted sellable stock', { skip: !sourceDatabaseUrl, timeout: 240_000 }, async () => {
  const isolated = await createTemporaryConcurrencyDatabase({
    repositoryRoot: path.resolve(__dirname, '../../../..'),
    sourceDatabaseUrl: sourceDatabaseUrl!, migrateEmptySchema: true,
  });
  const db = isolated.client();
  try {
    const customer = await db.crmCustomer.create({ data: { firstName: 'مشتری', lastName: 'مرجوعی' } });
    const product = await db.product.create({ data: {
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
    const concurrent = await Promise.all([
      recordStoneReturnReceipt(db, actorId, command),
      recordStoneReturnReceipt(db, actorId, command),
    ]);
    assert.equal(concurrent.filter(result => result.replayed).length, 1);
    assert.equal(concurrent[0].data.id, concurrent[1].data.id);
    const [first] = concurrent;
    const reviewed = await readStoneReturnReceipt(db, first.data.id);
    assert.deepEqual(
      [reviewed.receivedQuantity, reviewed.acceptedQuantity, reviewed.rejectedQuantity, reviewed.rejectionReason],
      ['40', '35', '5', 'لب‌پریدگی'],
    );
    assert.equal(reviewed.guardReturnMovementId, null);
    assert.ok(reviewed.inventoryIdentityId);
    assert.deepEqual((await readStoneReturnAvailability(db, [product.id])).get(product.id), [{ unit: 'squareMeter', quantity: '35' }]);

    const retry = await recordStoneReturnReceipt(db, actorId, { ...command, acceptedQuantity: '35.00' });
    assert.equal(retry.replayed, true);
    assert.equal(retry.data.id, first.data.id);
    await assert.rejects(recordStoneReturnReceipt(db, actorId, { ...command, acceptedQuantity: '30' }), /قبلاً با اطلاعات دیگری/);

    const rejected = await recordStoneReturnReceipt(db, actorId, { ...command, requestId: randomUUID(), acceptedQuantity: '0' });
    assert.equal(rejected.data.inventoryIdentityId, null);
    assert.deepEqual((await readStoneReturnAvailability(db, [product.id])).get(product.id), [{ unit: 'squareMeter', quantity: '35' }]);

    const movement = await db.securityVehicleMovement.create({ data: {
      movementNumber: randomUUID(), direction: 'INBOUND', purpose: 'SALES_RETURN', status: 'INFO_COMPLETED',
      customerId: customer.id, occurredAt: new Date(), createdBy: actorId,
    } });
    await publishGuardInboundOperationalEvidence(db, { sourceId: movement.id, sourceVersion: 1,
      sourcePayload: { movementId: movement.id, movementNumber: movement.movementNumber }, occurredAt: movement.occurredAt,
    });
    const witnessed = { ...command, requestId: randomUUID(), guardReturnMovementId: movement.id };
    const guardResults = await Promise.allSettled([
      recordStoneReturnReceipt(db, actorId, witnessed),
      recordStoneReturnReceipt(db, actorId, { ...witnessed, requestId: randomUUID() }),
    ]);
    const accepted = guardResults.find(result => result.status === 'fulfilled');
    const duplicate = guardResults.find(result => result.status === 'rejected');
    assert.ok(accepted);
    assert.match(String(duplicate?.reason), /همین سنگ و واحد/);
    assert.equal((await readStoneReturnReceipt(db, accepted.value.data.id)).guardReturnMovementId, movement.id);
    assert.deepEqual((await readStoneReturnAvailability(db, [product.id])).get(product.id), [{ unit: 'squareMeter', quantity: '70' }]);
  } finally {
    try {
      await db.$disconnect();
    } finally {
      await isolated.cleanup();
    }
  }
});
