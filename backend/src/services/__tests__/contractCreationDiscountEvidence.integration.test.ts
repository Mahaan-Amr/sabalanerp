import assert from 'node:assert/strict';
import { Prisma, PrismaClient } from '@prisma/client';
import { projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { createContract, type ContractTransactionRunner } from '../contractService';
import { contractDiscountEligibleBase } from '../contractDiscountEvidence';
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
    eligibilityShape:
      | 'explicit'
      | 'current-draft-omitted'
      | 'stair-v2-parent-omitted' = 'explicit',
  ) => {
    const contractData = JSON.parse(JSON.stringify(source.contractData));
    let stairParentWritten = false;
    contractData.products = contractData.products.map((product: any) => {
      const meta = { ...(product.meta || {}) };
      const makeStairParent =
        eligibilityShape === 'stair-v2-parent-omitted' &&
        product.meta?.isLayer !== true &&
        !stairParentWritten;
      if (makeStairParent) {
        stairParentWritten = true;
        meta.stairStepperV2 = true;
        delete meta.isLayer;
      } else if (eligibilityShape === 'explicit' || product.meta?.isLayer === true) {
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

  const createdFromStairParent = await createFromSource(
    'stair-v2-parent-omitted-layer-evidence',
    null,
    'stair-v2-parent-omitted',
  );
  const stairParent = (createdFromStairParent.contractData as any).products.find(
    (product: any) => product.meta?.stairStepperV2 === true,
  );
  assert(stairParent, 'fixture must contain one ordinary stair V2 parent');
  assert.equal(
    stairParent.meta.isLayer,
    false,
    'ordinary stair V2 parents must persist explicit non-layer discount eligibility',
  );

  const createdFromPositiveDiscountStair = await createFromSource(
    'stair-v2-parent-positive-discount',
    { enabled: true, percent: 5, amount: 1 },
    'stair-v2-parent-omitted',
  );
  const positiveDiscountStairParent =
    (createdFromPositiveDiscountStair.contractData as any).products.find(
      (product: any) => product.meta?.stairStepperV2 === true,
    );
  assert.equal(
    positiveDiscountStairParent?.meta?.isLayer,
    false,
    'positive-discount stair contracts must not defer missing eligibility evidence to accounting',
  );
  const positiveDiscountProducts =
    (createdFromPositiveDiscountStair.contractData as any).products as any[];
  const positiveDiscountSnapshot = new Map(
    positiveDiscountProducts.map(product => [product.rowId, product]),
  );
  const positiveDiscountPlan = buildLegacyContractMigrationPlan({
    id: createdFromPositiveDiscountStair.id,
    totalAmount: createdFromPositiveDiscountStair.totalAmount,
    contractData: createdFromPositiveDiscountStair.contractData,
  }, 1);
  assert(positiveDiscountPlan.ok, 'the created stair snapshot must rebuild its canonical graph');
  const positiveDiscountProjection = projectCanonicalProductGraph(
    positiveDiscountPlan.graph,
    'accounting',
  );
  const positiveDiscountEligibleBase = contractDiscountEligibleBase(
    positiveDiscountSnapshot,
    positiveDiscountProjection.products,
  );
  const expectedPositiveDiscountBase = positiveDiscountProjection.products.reduce(
    (sum, product) => positiveDiscountSnapshot.get(product.productRowId)?.meta?.isLayer === false
      ? sum.plus(product.baseAmountToman || 0)
      : sum,
    new Prisma.Decimal(0),
  );
  assert(
    positiveDiscountProjection.products.some(
      product => product.productRowId === positiveDiscountStairParent?.rowId,
    ),
    'the stair parent must survive into the accounting projection',
  );
  assert.equal(
    positiveDiscountEligibleBase.toString(),
    expectedPositiveDiscountBase.toString(),
    'accounting must include ordinary stair V2 parents and exclude only explicit layer rows',
  );

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

  const preparedProductRowId = 'prepared-product-regression-row';
  const preparedContractData = JSON.parse(JSON.stringify(source.contractData));
  const preparedProduct = {
    rowId: preparedProductRowId,
    productRowId: preparedProductRowId,
    productId: source.items[0]!.productId,
    productType: 'prepared',
    stoneName: 'Prepared product regression fixture',
    preparedKind: 'readyPiece',
    preparedUnit: 'count',
    preparedQuantity: 200,
    quantity: 200,
    unitPrice: 200_000,
    pricePerSquareMeter: 200_000,
    originalTotalPrice: 40_000_000,
    totalPrice: 40_000_000,
    appliedSubServices: [],
    totalSubServiceCost: 0,
    finishings: [],
    isMandatory: false,
    mandatoryPercentage: 0,
  };
  preparedContractData.products = [
    ...preparedContractData.products,
    preparedProduct,
  ];
  preparedContractData.discount = null;
  const sourceTotalAmount = Number(source.totalAmount?.toString() ?? 0);
  assert(Number.isFinite(sourceTotalAmount));
  const mixedContractTotal = sourceTotalAmount + 40_000_000;
  preparedContractData.payment = {
    currency: source.currency,
    totalContractAmount: mixedContractTotal,
    payments: [],
  };
  const createdMixedContract = await createContract({
    title: `${source.title} mixed prepared evidence QA`,
    titlePersian: `${source.titlePersian} آزمون ترکیبی محصول آماده`,
    customerId: source.customerId,
    departmentId: source.departmentId,
    content: source.content,
    totalAmount: mixedContractTotal,
    currency: source.currency,
    contractData: preparedContractData,
    _relations: {
      items: [
        ...source.items.map(item => ({
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
        {
          productId: source.items[0]!.productId,
          productRowId: preparedProductRowId,
          productType: 'prepared',
          quantity: 200,
          unitPrice: 200_000,
          totalPrice: 40_000_000,
          description: null,
          isMandatory: false,
          mandatoryPercentage: null,
          originalTotalPrice: 40_000_000,
          stairSystemId: null,
          stairPartType: null,
        },
      ],
    },
  }, source.createdBy, undefined, transactionHarness);
  const savedMixedData = createdMixedContract.contractData as any;
  const mixedPlan = buildLegacyContractMigrationPlan({
    id: createdMixedContract.id,
    totalAmount: createdMixedContract.totalAmount,
    contractData: savedMixedData,
  }, 1);
  assert(mixedPlan.ok, 'the mixed prepared contract must rebuild its canonical graph');
  const mixedProjection = projectCanonicalProductGraph(mixedPlan.graph, 'accounting');
  assert(
    mixedProjection.products.some(product => product.productType !== 'prepared'),
    'the regression fixture must retain at least one non-prepared product',
  );
  const preparedProjection = mixedProjection.products.find(
    product => product.productRowId === preparedProductRowId,
  );
  assert.equal(preparedProjection?.baseAmountToman, '40000000');
  const mixedProductSnapshots = new Map<string, Readonly<Record<string, unknown>>>(
    savedMixedData.products.map((product: any) => [String(product.rowId), product as Record<string, unknown>] as const),
  );
  const expectedMixedBase = contractDiscountEligibleBase(
    mixedProductSnapshots,
    mixedProjection.products,
  );
  assert.equal(savedMixedData.discount.baseSubtotal, expectedMixedBase.toString());
  assert.equal(
    savedMixedData.products.find((product: any) => product.rowId === preparedProductRowId)?.meta?.isLayer,
    false,
  );
};

run()
  .then(() => console.log('contract creation persists explicit zero-discount evidence: ok'))
  .finally(() => prisma.$disconnect());
