import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { parseCanonicalProductGraph, projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { executeAccountingAction } from '../../accountingService';
import { productQuantityPolicy } from '../../approvedPricing';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, any> : {};

export const createProductionApprovedPricingFixture = async (prisma: PrismaClient, input: {
  runId: string; quantity?: string; amount?: string;
}) => {
  const quantity = input.quantity || '1';
  const amount = input.amount || '100';
  const candidates = await prisma.salesContract.findMany({ where: { productGraphState: { isNot: null },
    items: { some: { productRowId: { not: null } } } }, include: { customer: true, productGraphState: true, items: true },
  orderBy: { createdAt: 'asc' }, take: 100 });
  const template = candidates.map(candidate => {
    if (!candidate.productGraphState) return null;
    const graph = parseCanonicalProductGraph(candidate.productGraphState.graph);
    const row = graph.rows[0];
    const item = row && candidate.items.find(value => value.productRowId === row.productRowId
      && value.productId === row.catalogProductId && value.productType === row.productType);
    return row && item ? { candidate, graph, row, item } : null;
  }).find((value): value is NonNullable<typeof value> => value !== null);
  if (!template) throw new Error('BLOCKED: no exact catalog/product identity exists for an isolated test fixture');
  const contractId = randomUUID();
  const itemId = randomUUID();
  const productRowId = `contract-row-${randomUUID()}`;
  const itemBillingQuantity = ['longitudinal', 'slab'].includes(template.row.productType) ? '1' : quantity;
  const unitPrice = new Prisma.Decimal(amount).dividedBy(itemBillingQuantity).toFixed(12);
  const authoredQuantity = template.row.productType === 'longitudinal' ? { length: quantity, lengthUnit: 'm' }
    : template.row.productType === 'slab' ? { squareMeters: quantity }
      : template.row.productType === 'prepared' ? { preparedQuantity: quantity, preparedUnit: 'count', unit: 'count' } : {};
  const canonicalQuantity = template.row.productType === 'longitudinal'
    ? { requestedLengthMeters: quantity, requestedQuantity: itemBillingQuantity }
    : template.row.productType === 'slab' ? { requestedAreaSquareMeters: quantity } : { requestedQuantity: quantity };
  const productSnapshot = { rowId: productRowId, productRowId, productId: template.item.productId,
    productType: template.row.productType, name: template.row.contractualTitle, quantity: itemBillingQuantity, ...authoredQuantity,
    meta: { isLayer: false } };
  const graph = parseCanonicalProductGraph({ ...template.graph, revision: 1,
    catalogSnapshots: template.graph.catalogSnapshots.filter(snapshot => snapshot.catalogProductId === template.row.catalogProductId
      && snapshot.snapshotVersion === template.row.catalogSnapshotVersion),
    rows: [{ ...template.row, productRowId, parentProductRowId: undefined, sourceProductRowId: undefined,
      commercial: { ...canonicalQuantity, baseAmountToman: amount, totalAmountToman: amount } }],
    stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [], allocations: [], operationGroups: [],
    toolSelections: [], finishingSelections: [] });
  const quantityPolicy = productQuantityPolicy(template.row.productType, `Product ${productRowId}`);
  const snapshotQuantity = quantityPolicy.snapshot(productSnapshot, `Product ${productRowId}`);
  const projectedRow = projectCanonicalProductGraph(graph, 'accounting').products[0];
  const canonicalProjectedQuantity = quantityPolicy.canonical({ productRowId: projectedRow.productRowId,
    catalogProductId: graph.rows[0].catalogProductId, contractualTitle: projectedRow.contractualTitle,
    productType: projectedRow.productType, baseAmountToman: projectedRow.baseAmountToman ?? null,
    totalAmountToman: projectedRow.totalAmountToman ?? null, requestedQuantity: projectedRow.quantity ?? null,
    requestedLengthMeters: projectedRow.lengthMeters ?? null, requestedAreaSquareMeters: projectedRow.areaSquareMeters ?? null,
    operations: projectedRow.operations.map(operation => ({ id: operation.id, kind: operation.kind,
      amountToman: operation.amountToman })) }, `Product ${productRowId}`);
  if (snapshotQuantity.quantity !== new Prisma.Decimal(quantity).toFixed(3)
    || canonicalProjectedQuantity !== snapshotQuantity.quantity) {
    throw new Error(`Synthetic product quantity policy mismatch: ${JSON.stringify({ itemBillingQuantity,
      requestedQuantity: quantity, snapshotQuantity, canonicalProjectedQuantity })}`);
  }
  if (projectCanonicalProductGraph(graph, 'accounting').totalAmountToman !== amount) throw new Error('Synthetic pricing graph total changed.');
  const graphHash = createHash('sha256').update(JSON.stringify(graph)).digest('hex');
  const project = await prisma.projectAddress.create({ data: { customerId: template.candidate.customerId,
    address: `Issue 260 destination ${contractId}`, projectName: `Issue 260 ${contractId}` } });
  const contractData = { contractKind: 'collaboration', customerId: template.candidate.customerId,
    customer: { id: template.candidate.customerId, firstName: template.candidate.customer.firstName,
      lastName: template.candidate.customer.lastName, companyName: template.candidate.customer.companyName },
    projectId: project.id, project: { id: project.id, address: project.address, projectName: project.projectName },
    payment: { currency: template.candidate.currency }, products: [productSnapshot],
    discount: { enabled: false, baseSubtotal: amount, percent: '0', amount: '0', currency: template.candidate.currency } };
  const contract = await prisma.salesContract.create({ data: { id: contractId, contractNumber: `ISSUE260-${randomUUID()}`,
    title: 'Issue 260 concurrency fixture', titlePersian: 'Issue 260', content: '', status: 'APPROVED',
    customerId: template.candidate.customerId, departmentId: template.candidate.departmentId,
    createdBy: template.candidate.createdBy, responsibleSellerId: template.candidate.responsibleSellerId,
    currency: template.candidate.currency, totalAmount: new Prisma.Decimal(amount), contractData: json(contractData),
    items: { create: { id: itemId, productId: template.item.productId, productRowId,
      productType: template.row.productType, quantity: new Prisma.Decimal(itemBillingQuantity), unitPrice: new Prisma.Decimal(unitPrice),
      totalPrice: new Prisma.Decimal(amount), description: template.row.contractualTitle } },
    productGraphState: { create: { schemaVersion: graph.schemaVersion, revision: graph.revision, graph: json(graph),
      policySnapshot: json(graph.calculationPolicy), inputHash: graphHash, resultHash: graphHash,
      totalAmountToman: new Prisma.Decimal(amount) } } }, include: { customer: true, items: true } });
  const actorUser = await prisma.user.findUniqueOrThrow({ where: { id: contract.createdBy }, select: { id: true, role: true } });
  const actor = { userId: actorUser.id, role: actorUser.role };
  const created = await executeAccountingAction({ kind: 'CREATE_INVOICE', contractId: contract.id,
    mode: 'FROM_CONTRACT_TOTAL', idempotencyKey: `issue260-create-${input.runId}-${randomUUID()}` }, actor);
  const invoiceId = String((record(created.affected).financialRecordIds as unknown[])?.[0] || '');
  const invoice = await prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoiceId }, include: { invoiceItems: true } });
  const approvalBase = { kind: 'APPROVE_FINANCIAL_INVOICE' as const,
    systemInvoiceDate: new Date().toISOString().slice(0, 10), sepidarAmount: invoice.amount.toString() };
  await executeAccountingAction({ ...approvalBase, invoiceId: invoice.id,
    systemInvoiceNumber: `260${Date.now()}${Math.floor(Math.random() * 10_000)}` }, actor);
  const head = await prisma.contractApprovedPricingHead.findUniqueOrThrow({ where: { contractId: contract.id },
    include: { currentVersion: { include: { rows: true } } } });
  const pricingRow = head.currentVersion.rows.find(row => row.contractItemId === itemId);
  if (!pricingRow) throw new Error('Production financial approval omitted the synthetic stable row.');
  const readiness = await prisma.contractPricingReadinessResult.findFirstOrThrow({ where: { contractId: contract.id,
    pricingVersionId: head.currentVersion.id, status: 'READY' } });
  const economics = { authored: { quantity: new Prisma.Decimal(quantity).toFixed(3), amount: new Prisma.Decimal(amount).toFixed(12),
    unitPrice }, actual: { contractedQuantity: pricingRow.contractedQuantity.toFixed(3),
    rowCanonicalAllInTotal: pricingRow.canonicalAllInTotal.toFixed(12),
    versionGrossAmount: head.currentVersion.grossAmount.toFixed(12), productType: pricingRow.unit,
    itemQuantity: contract.items.find(item => item.id === itemId)?.quantity.toFixed(3),
    itemUnitPrice: contract.items.find(item => item.id === itemId)?.unitPrice.toFixed(12),
    itemTotalPrice: contract.items.find(item => item.id === itemId)?.totalPrice.toFixed(12) } };
  if (economics.actual.rowCanonicalAllInTotal !== economics.authored.amount
    || economics.actual.versionGrossAmount !== economics.authored.amount
    || economics.actual.contractedQuantity !== economics.authored.quantity) {
    throw new Error(`Production approval changed the authored quantity or exact row/version economics: ${JSON.stringify(economics)}`);
  }
  return { contract, project, item: contract.items.find(item => item.id === itemId)!, productRowId,
    productId: template.item.productId, actor, invoice, approvalBase, head, pricingRow, readiness, graphHash,
    economics, normalizationManifest: { kind: 'SYNTHETIC_TEST_EVIDENCE', contractId, graphHash,
      rows: [{ productRowId, contractItemId: itemId, quantity, unit: pricingRow.unit, unitPrice,
        baseAmountToman: amount, totalAmountToman: amount, discountEligible: true }] } };
};
