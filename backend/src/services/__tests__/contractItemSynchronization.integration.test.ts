import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { prisma } from '../../lib/prisma';
import { ContractItemSynchronizationError, synchronizeContractItems } from '../contractService';
import { CURRENT_CONTRACT_PRODUCT_POLICY_V2 } from '../contractProductGraphMigration';
import { readShipmentQuantityProjection } from '../shipmentQuantityProjectionStore';
import { rebindFrozenContractItemIdentities } from '../approvedPricing/prismaRepository';

after(() => prisma.$disconnect());

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

test('approved correction retires a removed row while keeping its financial history and historical quantities', async () => {
  const contract = await prisma.salesContract.findFirst({
    where: { partnerKind: null, items: { some: {
      retiredAt: null, productRowId: { not: null }, approvedPricingRows: { some: {} },
      logisticsLoadingLines: { none: {} }, logisticsLoadingDriverAllocations: { none: {} },
      logisticsLoadingCorrections: { none: {} }, shipmentQuantityEvidence: { none: { kind: { not: 'CONTRACTED_SET' } } },
    } } }, include: { items: { where: { retiredAt: null }, include: { _count: true } } },
  });
  assert(contract, 'local fixture needs one financially approved ordinary contract without physical work');
  const products = (contract.contractData as any).products;
  const target = contract.items.find(item => item._count.approvedPricingRows > 0 &&
    item._count.logisticsLoadingLines === 0 && item._count.logisticsLoadingDriverAllocations === 0 &&
    item._count.logisticsLoadingCorrections === 0 && products.some((product: any) => product.rowId === item.productRowId));
  assert(target);
  const relations = contract.items.map(item => ({ ...item, quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice), totalPrice: Number(item.totalPrice),
    mandatoryPercentage: item.mandatoryPercentage === null ? null : Number(item.mandatoryPercentage),
    originalTotalPrice: item.originalTotalPrice === null ? null : Number(item.originalTotalPrice) }));
  try {
    await prisma.$transaction(async tx => {
      const correction = await tx.accountingCorrectionRequest.create({ data: {
        contractId: contract.id, category: 'AMOUNT_PRICING', status: 'APPROVED_FOR_SALES_EDIT',
        accountantNote: 'retirement regression fixture', createdBy: contract.createdBy,
      } });
      const cutoff = new Date(Date.now() - 1_000).toISOString();
      const historicalBefore = await readShipmentQuantityProjection(tx, { contractId: contract.id }, { cutoff });
      const historicalPricing = await tx.contractApprovedPricingRow.findMany({ where: { linkedContractItemId: target.id } });
      const quantityEvidence = await tx.shipmentQuantityEvidence.findMany({ where: { contractItemId: target.id } });
      const retiredAt = new Date();
      const retirement = { correctionId: correction.id, retiredAt, actorId: contract.createdBy,
        contractRevision: contract.commercialRevision, contractData: contract.contractData,
        reason: correction.accountantNote };
      const remaining = relations.filter(item => item.id !== target.id);
      await assert.rejects(synchronizeContractItems(tx, contract.id, remaining,
        CURRENT_CONTRACT_PRODUCT_POLICY_V2, { ...retirement, correctionId: 'unauthorized-correction' }),
        /approved formal correction/);
      await tx.$executeRawUnsafe('SAVEPOINT operational_retirement_guard');
      await tx.shipmentQuantityEvidence.create({ data: {
        contractId: contract.id, contractItemId: target.id, productRowId: target.productRowId!,
        unit: 'count', kind: 'EVIDENCE_CONFLICT', quantity: 0, effectiveAt: retiredAt,
        sourceType: 'RETIREMENT_REGRESSION_FIXTURE', sourceId: correction.id, integrityHash: 'fixture-only',
      } });
      await assert.rejects(synchronizeContractItems(tx, contract.id, remaining,
        CURRENT_CONTRACT_PRODUCT_POLICY_V2, retirement),
        (error: unknown) => error instanceof ContractItemSynchronizationError && error.status === 409);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT operational_retirement_guard');
      await synchronizeContractItems(tx, contract.id, remaining, CURRENT_CONTRACT_PRODUCT_POLICY_V2, retirement);
      await tx.salesContract.update({ where: { id: contract.id }, data: {
        contractData: { ...(contract.contractData as any), products: products.filter((product: any) => product.rowId !== target.productRowId) },
      } });
      const retained = await tx.contractItem.findUniqueOrThrow({ where: { id: target.id } });
      assert.equal(retained.productRowId, target.productRowId);
      assert.equal(retained.productId, target.productId);
      assert.equal(retained.totalPrice.toString(), target.totalPrice.toString());
      assert.equal(retained.quantity.toString(), target.quantity.toString());
      assert.equal(retained.retiredByCorrectionId, correction.id);
      assert.deepEqual((retained.retirementEvidence as any).productSnapshot,
        products.find((product: any) => product.rowId === target.productRowId));
      assert.deepEqual(await tx.contractApprovedPricingRow.findMany({ where: { linkedContractItemId: target.id } }), historicalPricing);
      assert.deepEqual(await tx.shipmentQuantityEvidence.findMany({ where: { contractItemId: target.id } }), quantityEvidence);
      const current = await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id },
        include: { items: { where: { retiredAt: null } } } });
      assert.equal(current.items.some(item => item.id === target.id), false);
      assert.equal(current.items.length, contract.items.length - 1);
      assert.deepEqual(await readShipmentQuantityProjection(tx, { contractId: contract.id }, { cutoff }), historicalBefore);
      assert.equal((await readShipmentQuantityProjection(tx, { contractId: contract.id }))
        .rows.some(row => row.contractItemId === target.id), false);
      const binding = rebindFrozenContractItemIdentities({ snapshotItems: [target], liveItems: [retained], invoiceItems: [] });
      assert.equal(binding.rebindings.length, 0, 'historical item remains attached to its exact original identity');
      await tx.$executeRawUnsafe('SAVEPOINT retired_history_guard');
      await assert.rejects(tx.contractItem.update({ where: { id: target.id }, data: { quantity: 999 } }),
        /Retired contract item history is immutable/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT retired_history_guard');
      await assert.rejects(tx.contractItem.delete({ where: { id: target.id } }),
        /Retired contract item history is immutable/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT retired_history_guard');
      await assert.rejects(tx.logisticsLoadingLine.create({ data: {
        loadingId: 'retirement-fixture-unreachable-loading', sourceContractId: contract.id,
        sourceContractItemId: target.id, productRowId: target.productRowId,
        productId: target.productId, quantity: 1, unit: 'count',
      } }), /Retired contract item cannot receive new loading work/);
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT retired_history_guard');
      await assert.rejects(synchronizeContractItems(tx, contract.id, relations, CURRENT_CONTRACT_PRODUCT_POLICY_V2),
        (error: unknown) => error instanceof ContractItemSynchronizationError && error.status === 422);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
  assert.equal((await prisma.contractItem.findUniqueOrThrow({ where: { id: target.id } })).retiredAt, null,
    'transaction harness leaves all fixture data unchanged');
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
      error.status === 409 &&
      error.item?.contractItemId === protectedItem.id &&
      error.item?.productRowId === protectedItem.productRowId,
  );
});
