import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import { createContract, updateContract } from '../contractService';
import { CONTRACT_DISCOUNT_REENTRY_REQUIRED } from '../contractDiscountSavePolicy';

const prisma = new PrismaClient();
const rollback = Symbol('contract edit eligibility regression rollback');
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/audited-longitudinal-discount.json'), 'utf8'));

async function run() {
  let createdId: string | undefined;
  await assert.rejects(prisma.$transaction(async tx => {
    const reference = await tx.salesContract.findFirst({ select: { customerId: true, createdBy: true, departmentId: true, content: true, contractData: true } });
    const catalog = await tx.product.findFirst({ select: { id: true } });
    assert(reference && catalog, 'the existing local database must contain a customer, seller, department and product');
    const customer = await tx.crmCustomer.findUnique({ where: { id: reference.customerId },
      select: { id: true, firstName: true, lastName: true, companyName: true } });
    assert(customer);
    const client = new Proxy(tx, {
      get(target, property) {
        if (property === '$transaction') return (work: (transaction: Prisma.TransactionClient) => unknown) => work(tx);
        return Reflect.get(target, property);
      },
    }) as unknown as PrismaClient;
    const product = { ...structuredClone(fixture.product), productId: catalog.id };
    const sourceData = reference.contractData as any;
    const contractData = { contractKind: sourceData.contractKind || 'standard', customerId: customer.id, customer,
      projectId: sourceData.projectId, project: sourceData.project,
      products: [product], discount: structuredClone(fixture.discount),
      payment: { currency: 'تومان', totalContractAmount: 26000000, payments: [] } };
    const created = await createContract({ title: 'Discount eligibility edit regression', titlePersian: 'آزمون اصلاح شواهد تخفیف',
      customerId: customer.id, departmentId: reference.departmentId, content: reference.content, totalAmount: 26000000,
      currency: 'تومان', contractData, _relations: { items: [{ productId: catalog.id,
        productRowId: product.rowId, productType: 'longitudinal', quantity: 0, unitPrice: 650000, totalPrice: 26250000 }],
        deliveries: [{ deliveryDate: '2026-09-29T00:00:00Z', deliveryAddress: 'Regression address',
          products: [{ productId: catalog.id, productRowId: product.rowId, quantity: 87.5 }] }] } },
      reference.createdBy, undefined, client);
    createdId = created.id;
    const editedData = JSON.parse(JSON.stringify(created.contractData));
    assert.equal(editedData.products[0].meta.isLayer, false);
    delete editedData.products[0].meta.isLayer;
    const edited = await updateContract(created.id, { contractData: editedData }, reference.createdBy, client);
    assert.equal((edited.contractData as any).products[0].meta.isLayer, false);
    assert.equal(edited.totalAmount?.toString(), '26000000');
    assert.deepEqual((edited.contractData as any).discount, (created.contractData as any).discount);
    const staleDiscountData = structuredClone(edited.contractData) as any;
    const changedProduct = staleDiscountData.products[0];
    changedProduct.pricePerSquareMeter = 600000;
    changedProduct.longitudinalPolicyInput.baseRateToman = '600000';
    changedProduct.originalTotalPrice = 21000000;
    changedProduct.totalPrice = 24500000;
    changedProduct.meta.pricing.materialBase = 21000000;
    changedProduct.meta.pricing.totalPrice = 24500000;
    staleDiscountData.payment.totalContractAmount = 24250000;
    await assert.rejects(updateContract(created.id, { contractData: staleDiscountData, totalAmount: 24250000 }, reference.createdBy, client),
      { message: CONTRACT_DISCOUNT_REENTRY_REQUIRED });
    const afterRejectedSave = await tx.salesContract.findUniqueOrThrow({ where: { id: created.id } });
    assert.deepEqual(afterRejectedSave.contractData, edited.contractData, 'rejected discount must not persist any commercial changes');
    assert.equal(afterRejectedSave.totalAmount?.toString(), edited.totalAmount?.toString());
    const graph = await tx.salesContractProductGraphState.findUnique({ where: { contractId: created.id } });
    assert.equal((graph?.graph as any).rows[0].commercial.legacySnapshot.meta.isLayer, false);
    const financialCountBefore = await tx.accountingFinancialRecord.count({ where: { contractId: created.id } });
    assert.equal(financialCountBefore, 0);
    const explicitlyReenteredData = structuredClone(staleDiscountData);
    explicitlyReenteredData.discount = {
      ...explicitlyReenteredData.discount,
      baseSubtotal: 21000000,
      inputMode: 'AMOUNT_TOMAN',
      percent: Number((250000 * 100 / 21000000).toFixed(12)),
    };
    const saved = await updateContract(created.id, {
      contractData: explicitlyReenteredData, totalAmount: 24250000,
    }, reference.createdBy, client);
    const savedDiscount = (saved.contractData as any).discount;
    assert.equal(savedDiscount.amount, 250000, 'explicit reentry may preserve the agreed amount');
    assert.equal(savedDiscount.baseSubtotal, 21000000);
    assert.equal(Math.round(savedDiscount.baseSubtotal * savedDiscount.percent / 100), savedDiscount.amount);
    assert.equal(savedDiscount.rangeId, (edited.contractData as any).discount.rangeId);
    assert.equal(savedDiscount.maxDiscountPercent, (edited.contractData as any).discount.maxDiscountPercent);
    assert.equal(saved.totalAmount?.toString(), '24250000');
    const persistedAfterReentry = await tx.salesContract.findUniqueOrThrow({ where: { id: created.id } });
    assert.deepEqual((persistedAfterReentry.contractData as any).discount, savedDiscount);
    assert.equal(await tx.accountingFinancialRecord.count({ where: { contractId: created.id } }), financialCountBefore,
      'commercial correction must not create or change financial record ownership');
    throw rollback;
  }, { timeout: 30000 }), error => error === rollback);
  assert(createdId);
  assert.equal(await prisma.salesContract.findUnique({ where: { id: createdId } }), null, 'test transaction must leave no contract behind');
  console.log('Contract edit preserves explicit discount eligibility and unchanged amounts: PASS (rolled back)');
}

run().finally(() => prisma.$disconnect());
