import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { createContract, type ContractTransactionRunner } from '../contractService';
import { buildLegacyContractMigrationPlan } from '../contractProductGraphMigration';

const prisma = new PrismaClient();
const rollback = Symbol('contract creation discount evidence rollback');
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
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
      !Object.prototype.hasOwnProperty.call(data, 'discount') || (data as any).discount !== null) return false;
    const plan = buildLegacyContractMigrationPlan({
      id: candidate.id,
      totalAmount: candidate.totalAmount,
      contractData: data,
    }, 1);
    return plan.ok && projectCanonicalProductGraph(plan.graph, 'accounting').products
      .every(product => product.baseAmountToman != null);
  });
  assert(source, 'local QA database must contain one fully priced legacy wizard contract with explicit-null discount evidence');

  const createFromSource = (
    label: string,
    discount: unknown,
    eligibilityShape: 'explicit' | 'current-draft-omitted' = 'explicit',
  ) => {
    const contractData = JSON.parse(JSON.stringify(source.contractData));
    contractData.customer = {
      ...(contractData.customer || {}),
      id: source.customerId,
      salesContracts: [{
        id: 'recursive-history-contract',
        contractData: {
          customer: {
            id: source.customerId,
            salesContracts: [{ id: 'older-history-contract' }],
          },
        },
      }],
      communications: [{ id: 'crm-communication' }],
    };
    contractData.products = contractData.products.map((product: any) => {
      const meta = { ...(product.meta || {}) };
      if (eligibilityShape === 'explicit' || product.meta?.isLayer === true) {
        meta.isLayer = product.meta?.isLayer === true;
      } else {
        delete meta.isLayer;
      }
      return {
        ...product,
        ...(eligibilityShape === 'current-draft-omitted'
          ? { layerTypeId: null, layerTypeName: null, layerTypePrice: null }
          : {}),
        meta,
      };
    });
    contractData.discount = discount;
    return createContract({
      title: `${source.title} QA ${label}`,
      titlePersian: `${source.titlePersian} آزمون`,
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
  };

  const createdFromCurrentDraft = await createFromSource(
    'current-draft-omitted-layer-evidence',
    null,
    'current-draft-omitted',
  );
  const currentDraftProducts = (createdFromCurrentDraft.contractData as any).products;
  assert(
    currentDraftProducts.every((product: any) => typeof product.meta?.isLayer === 'boolean'),
    'new contract snapshots must persist explicit layer eligibility for every product row',
  );

  for (const [label, discount] of [
      ['null', null],
      ['incomplete-zero', { enabled: false, percent: 0, amount: 0 }],
      ['enabled-only-zero', { enabled: false }],
    ] as const) {
      const created = await createFromSource(label, discount);

      const savedData = created.contractData as any;
      assert.equal(savedData.customer.salesContracts, undefined);
      assert.equal(savedData.customer.communications, undefined);
      assert.equal(savedData.customer.id, source.customerId);
      assert.equal(savedData.discount.enabled, false);
      assert.equal(savedData.discount.percent, 0);
      assert.equal(savedData.discount.amount, 0);
      assert.equal(savedData.discount.currency, source.currency);
      assert.equal(typeof savedData.discount.baseSubtotal, 'string');
      const savedBaseSubtotal = Number(savedData.discount.baseSubtotal);
      assert(Number.isFinite(savedBaseSubtotal) && savedBaseSubtotal >= 0);
  }

  for (const [label, discount] of [
    ['malformed-zero', { enabled: false, percent: 'bad', amount: 0 }],
    ['conflicting-zero', { enabled: false, percent: 0, amount: 1 }],
    ['missing-enabled-zero', { percent: 0, amount: 0 }],
  ] as const) {
    await assert.rejects(
      createFromSource(label, discount),
      /zero-discount evidence is malformed or conflicting/,
    );
  }
};

run()
  .then(() => console.log('contract creation persists explicit zero-discount evidence: ok'))
  .finally(() => prisma.$disconnect());
