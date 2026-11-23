import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import path from 'node:path';
import { createAccountingSupplyChainApplication, hashSupplyChainEvidence, SupplyChainAccountingError } from '../accountingSupplyChain';
import { createAccountingSupplyChainPrismaRepository } from '../accountingSupplyChainPrismaRepository';
import { publishGuardInboundOperationalEvidence, resolveAccountingOperationalEvidence } from '../accountingOperationalEvidence';
import { readProductCatalogAvailabilityPage, readStoneReturnAvailability } from '../stoneReturnAvailability';
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
      qualityCode: '1', qualityName: 'first', qualityNamePersian: 'درجه یک', images: [], isAvailable: false,
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

    const catalogPage = (available: boolean) => readProductCatalogAvailabilityPage(db, { id: product.id }, available, 0, 1);
    const availablePage = await catalogPage(true);
    assert.deepEqual(availablePage.products.map(row => row.id), [product.id]);
    assert.equal(availablePage.total, 1);
    assert.equal(availablePage.products[0].isAvailable, false);
    assert.equal((await catalogPage(false)).total, 0);

    const application = createAccountingSupplyChainApplication(createAccountingSupplyChainPrismaRepository(db), {
      now: () => new Date(),
      post: async () => assert.fail('Reserving physical stock cannot post accounting value'),
      resolveEvidence: (evidence, allowedTypes) => resolveAccountingOperationalEvidence(db, evidence, allowedTypes),
    });
    const inventoryIdentity = reviewed.inventoryIdentityId;
    async function reservationApproval(purposeId: string) {
      const payload = { identityId: inventoryIdentity, quantity: '35', purposeId };
      const hash = hashSupplyChainEvidence(payload);
      const type = 'INVENTORY_RESERVATION_APPROVAL';
      await db.accountingOperationalEvidenceReceipt.create({ data: {
        ownerWorkspace: 'inventory', sourceType: type, sourceId: purposeId, sourceVersion: 1,
        sourceHash: hash, sourcePayload: payload, occurredAt: new Date(),
      } });
      return { type, id: purposeId, version: 1, hash, payload };
    }
    const reserve = async (purposeId: string) => application.reserveInventory({
      identityId: inventoryIdentity, purposeId, quantity: '35', unit: 'squareMeter',
      idempotencyKey: purposeId, evidence: await reservationApproval(purposeId), actor: { id: actorId, profile: 'ACCOUNTANT' },
    });
    const attempts = await Promise.allSettled([reserve('first-sale'), reserve('competing-sale')]);
    assert.equal(attempts.filter(attempt => attempt.status === 'fulfilled').length, 1);
    const conflict = attempts.find(attempt => attempt.status === 'rejected');
    assert.ok(conflict?.reason instanceof SupplyChainAccountingError);
    assert.equal(conflict.reason.code, 'INSUFFICIENT_INVENTORY');
    assert.equal((await readStoneReturnAvailability(db, [product.id])).has(product.id), false);
    assert.equal((await catalogPage(true)).total, 0);
    assert.deepEqual((await catalogPage(false)).products.map(row => row.id), [product.id]);
    const valued = await application.getInventoryProjection({ identityId: inventoryIdentity });
    assert.deepEqual(valued.layers, []);
    assert.equal(valued.valueRials, 0n);

    const retry = await recordStoneReturnReceipt(db, actorId, { ...command, acceptedQuantity: '35.00' });
    assert.equal(retry.replayed, true);
    assert.equal(retry.data.id, first.data.id);
    await assert.rejects(recordStoneReturnReceipt(db, actorId, { ...command, acceptedQuantity: '30' }), /قبلاً با اطلاعات دیگری/);

    const rejected = await recordStoneReturnReceipt(db, actorId, { ...command, requestId: randomUUID(), acceptedQuantity: '0' });
    assert.equal(rejected.data.inventoryIdentityId, null);
    assert.equal((await readStoneReturnAvailability(db, [product.id])).has(product.id), false);

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
    assert.deepEqual((await readStoneReturnAvailability(db, [product.id])).get(product.id), [{ unit: 'squareMeter', quantity: '35' }]);
  } finally {
    try {
      await db.$disconnect();
    } finally {
      await isolated.cleanup();
    }
  }
});
