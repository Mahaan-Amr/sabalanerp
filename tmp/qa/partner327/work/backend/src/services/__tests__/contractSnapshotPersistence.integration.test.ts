import assert from 'node:assert/strict';
import { Prisma } from '@prisma/client';
import { projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { prisma } from '../../lib/prisma';
import { createContract, type ContractTransactionRunner } from '../contractService';
import { buildLegacyContractMigrationPlan } from '../contractProductGraphMigration';

const rollback = Symbol('contract snapshot persistence rollback');
const transactionHarness: ContractTransactionRunner = {
  async $transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) {
    let result!: T;
    try {
      await prisma.$transaction(async tx => {
        result = await work(tx);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
    return result;
  },
};

const run = async () => {
  const candidates = await prisma.salesContract.findMany({
    where: {
      productGraphState: { isNot: null },
      items: { some: { productRowId: { not: null } } },
    },
    include: { items: true },
    orderBy: { createdAt: 'asc' },
    take: 100,
  });
  const source = candidates.find(candidate => {
    const data = candidate.contractData;
    if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
    const plan = buildLegacyContractMigrationPlan({
      id: candidate.id,
      totalAmount: candidate.totalAmount,
      contractData: data,
    }, 1);
    return plan.ok && projectCanonicalProductGraph(plan.graph, 'accounting').products
      .every(product => product.baseAmountToman != null);
  });
  assert(source, 'sabalanerp-local needs one fully priced contract with an item');

  const contractData = JSON.parse(JSON.stringify(source.contractData));
  contractData.customer = {
    ...(contractData.customer || {}),
    id: source.customerId,
    companyName: 'QA stable legal identity',
    customFields: { economicCode: '411111111111', liveCrmScore: 99 },
    salesContracts: [{
      id: 'recursive-history-contract',
      payload: 'x'.repeat(4_200_000),
    }],
    communications: [{ id: 'crm-communication' }],
  };
  contractData.discount = {
    enabled: false,
    percent: 0,
    amount: 0,
    currency: source.currency,
    baseSubtotal: String(source.totalAmount),
  };

  const created = await createContract({
    title: `${source.title} snapshot QA`,
    titlePersian: `${source.titlePersian} آزمون مرز اسنپ‌شات`,
    customerId: source.customerId,
    departmentId: source.departmentId,
    content: source.content,
    totalAmount: source.totalAmount == null ? undefined : Number(source.totalAmount.toString()),
    currency: source.currency,
    contractData,
    _relations: {
      items: source.items.map(item => ({
        productId: item.productId,
        productRowId: item.productRowId,
        productType: item.productType,
        quantity: Number(item.quantity.toString()),
        unitPrice: Number(item.unitPrice.toString()),
        totalPrice: Number(item.totalPrice.toString()),
        description: item.description,
        isMandatory: item.isMandatory,
        mandatoryPercentage: item.mandatoryPercentage == null ? null : Number(item.mandatoryPercentage.toString()),
        originalTotalPrice: item.originalTotalPrice == null ? null : Number(item.originalTotalPrice.toString()),
        stairSystemId: item.stairSystemId,
        stairPartType: item.stairPartType,
      })),
    },
  }, source.createdBy, undefined, transactionHarness);

  const savedData = created.contractData as Record<string, any>;
  assert.equal(savedData.customer.id, source.customerId);
  assert.equal(savedData.customer.companyName, 'QA stable legal identity');
  assert.deepEqual(savedData.customer.customFields, { economicCode: '411111111111' });
  assert.equal(savedData.customer.salesContracts, undefined);
  assert.equal(savedData.customer.communications, undefined);
  assert(Array.isArray(savedData.products));
  assert(Buffer.byteLength(JSON.stringify(savedData), 'utf8') < 200_000);
};

run()
  .then(() => console.log('contract creation persists a bounded customer snapshot: ok'))
  .finally(() => prisma.$disconnect());
