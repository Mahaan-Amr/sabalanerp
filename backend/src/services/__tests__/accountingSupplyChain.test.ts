import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SupplyChainAccountingError,
  createAccountingSupplyChainApplication as createBaseAccountingSupplyChainApplication,
  createInMemorySupplyChainRepository,
  hashSupplyChainEvidence,
} from '../accountingSupplyChain';

const createAccountingSupplyChainApplication = (
  repository: Parameters<typeof createBaseAccountingSupplyChainApplication>[0],
  dependencies: Omit<Parameters<typeof createBaseAccountingSupplyChainApplication>[1], 'resolveEvidence'>,
) => createBaseAccountingSupplyChainApplication(repository, {
  ...dependencies,
  resolveEvidence: async (item, allowedTypes) => ({ ...item, type: allowedTypes[0] }),
});

const now = new Date('2026-09-21T12:00:00.000Z');
const actor = { id: 'accountant-1', profile: 'ACCOUNTANT' as const };
const ledgerContext = {
  bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1',
  documentDate: new Date('2026-09-21T00:00:00.000Z'),
};
const evidence = (id: string, payload: unknown = { id, version: 1 }) => ({
  type: 'PURCHASE_EVIDENCE', id, version: 1, payload, hash: hashSupplyChainEvidence(payload),
});

const matchedInvoice = {
  bookId: 'book-1', fiscalYearId: 'year-1', periodId: 'period-1',
  idempotencyKey: 'supplier-invoice-request-1', correlationId: 'correlation-1',
  supplierPartyId: 'supplier-1', supplierInvoiceNumber: 'SUP-1405-1',
  documentDate: new Date('2026-09-21T00:00:00.000Z'), dueDate: new Date('2026-10-21T00:00:00.000Z'),
  actor,
  evidence: evidence('invoice-source-1'),
  lines: [{
    id: 'line-1', kind: 'INVENTORY' as const, description: 'بلوک سنگ تراورتن',
    quantity: '2.500', unit: 'TONNE', unitPriceRials: 4_000_000n,
    grossRials: 10_000_000n, discountRials: 500_000n, attributableFreightRials: 200_000n,
    recoverableTaxRials: 900_000n, nonRecoverableTaxRials: 100_000n,
    deductionRials: 50_000n, retentionRials: 150_000n, roundingRials: 0n,
    orderEvidence: evidence('purchase-order-1', { supplierPartyId: 'supplier-1', quantity: '2.500', unit: 'TONNE', unitPriceRials: '4000000' }),
    receiptEvidence: evidence('guard-receipt-1', { supplierPartyId: 'supplier-1', quantity: '2.500', unit: 'TONNE', warehouseId: 'warehouse-1', locationId: 'location-1', identityId: 'block-1' }),
    inventory: { identityId: 'block-1', warehouseId: 'warehouse-1', locationId: 'location-1', originId: 'quarry-lot-1', valuationMethod: 'SPECIFIC_IDENTIFICATION' as const },
  }],
};

test('matched inventory invoice posts once and creates one payable and immutable valuation layer', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: [] });
  const postings: any[] = [];
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => { postings.push(command); return { voucherId: 'voucher-1', statutoryNumber: 41 }; },
  });

  const result = await app.recognizeSupplierInvoice(matchedInvoice);
  const retry = await app.recognizeSupplierInvoice(matchedInvoice);
  const projection = await app.getSupplierProjection('supplier-1');
  const inventory = await app.getInventoryProjection({ identityId: 'block-1' });

  assert.equal(result.kind, 'POSTED');
  assert.equal(retry.kind, 'POSTED');
  assert.equal(retry.invoiceId, result.invoiceId);
  assert.equal(postings.length, 1);
  assert.deepEqual(projection, { payableRials: 10_500_000n, advanceRials: 0n, openItemCount: 1 });
  assert.equal(inventory.quantity, '2.500');
  assert.equal(inventory.unit, 'TONNE');
  assert.equal(inventory.valueRials, 9_800_000n);
  assert.equal(inventory.layers.length, 1);
  assert.deepEqual((await repository.listInventoryEvents('block-1')).map((item) => item.eventType), ['RECEIPT']);
  const aging = await app.getSupplierAging('supplier-1', new Date('2026-11-25T00:00:00.000Z'));
  assert.equal(aging.buckets.overdue31To60Rials, 10_500_000n);
  assert.equal(aging.totalRials, 10_500_000n);
  assert.equal((await repository.getParty('supplier-1'))?.roles.includes('SUPPLIER'), true);
});

test('application boundary resolves authoritative evidence and audits a denied command', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: [] });
  const app = createBaseAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async () => ({ voucherId: 'unreachable', statutoryNumber: 1 }),
    resolveEvidence: async () => { throw new SupplyChainAccountingError('EVIDENCE_NOT_AUTHORITATIVE', 'شاهد معتبر نیست.', 400); },
  });
  await assert.rejects(() => app.approveSupplierRelationship({ partyId: 'supplier-1', evidence: evidence('forged'), actor }),
    (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'EVIDENCE_NOT_AUTHORITATIVE');
  const audits = await repository.listCommandAudits();
  assert.equal(audits.length, 1);
  assert.equal(audits[0].result, 'DENIED');
  assert.equal(audits[0].commandName, 'approveSupplierRelationship');
  assert.equal(audits[0].sequence, 1n);
  assert.ok(audits[0].entryHash);
  assert.equal((await repository.getParty('supplier-1'))?.roles.length, 0);
});

test('application boundary rejects authentic evidence from an unrelated owning workflow', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: [] });
  const unrelated = { ...evidence('guard-entry'), type: 'GUARD_INBOUND_MOVEMENT' };
  const app = createBaseAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async () => ({ voucherId: 'unreachable', statutoryNumber: 1 }),
    resolveEvidence: async (item) => item,
  });
  await assert.rejects(() => app.approveSupplierRelationship({ partyId: 'supplier-1', evidence: unrelated, actor }),
    (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'EVIDENCE_NOT_APPLICABLE');
  assert.equal((await repository.getParty('supplier-1'))?.roles.length, 0);
  assert.equal((await repository.listCommandAudits())[0]?.result, 'DENIED');
});

test('physical movement appends an idempotent traceability event without changing valuation', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 43 }),
  });
  await app.recognizeSupplierInvoice(matchedInvoice);
  const before = await app.getInventoryProjection({ identityId: 'block-1' });
  const command = {
    identityId: 'block-1', quantity: '2.500', unit: 'TONNE', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'location-1', warehouseId: 'warehouse-2', locationId: 'yard-7',
    occurredAt: new Date('2026-09-22T08:00:00.000Z'), evidence: evidence('movement-1'), actor,
  };

  const movement = await app.recordPhysicalMovement(command);
  const retry = await app.recordPhysicalMovement(command);

  assert.equal(retry.id, movement.id);
  assert.deepEqual(await app.getInventoryProjection({ identityId: 'block-1' }), before);
  const events = await repository.listInventoryEvents('block-1');
  assert.deepEqual(events.map((item) => item.eventType), ['RECEIPT', 'MOVEMENT']);
  assert.equal(events[1].predecessorEventId, events[0].id);
  assert.equal(events[1].locationId, 'yard-7');
  await app.consumeInventory({ ...ledgerContext, identityId: 'block-1', quantity: '2.500', unit: 'TONNE', purpose: 'SALE', sourceWarehouseId: 'warehouse-2', sourceLocationId: 'yard-7',
    idempotencyKey: 'sale-after-movement', evidence: evidence('sale-after-movement'), actor });
  await assert.rejects(() => app.recordPhysicalMovement({ ...command, quantity: '0.100', sourceWarehouseId: 'warehouse-2',
    sourceLocationId: 'yard-7', evidence: evidence('movement-after-sale') }),
  (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'INSUFFICIENT_INVENTORY');
});

test('a supplier relationship provisions the role without creating debt or a journal entry', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['CUSTOMER'] });
  let postingCount = 0;
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async () => { postingCount += 1; return { voucherId: 'unexpected', statutoryNumber: 1 }; },
  });

  await app.approveSupplierRelationship({ partyId: 'supplier-1', evidence: evidence('relationship-1'), actor });

  assert.deepEqual((await repository.getParty('supplier-1'))?.roles.sort(), ['CUSTOMER', 'SUPPLIER']);
  assert.deepEqual(await app.getSupplierProjection('supplier-1'), { payableRials: 0n, advanceRials: 0n, openItemCount: 0 });
  assert.equal(postingCount, 0);
});

test('mismatched evidence fails closed into one exception without ledger, payable, or inventory effect', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  let postingCount = 0;
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async () => { postingCount += 1; return { voucherId: 'unexpected', statutoryNumber: 1 }; },
  });
  const command = {
    ...matchedInvoice,
    idempotencyKey: 'mismatch-request-1',
    evidence: evidence('invoice-source-mismatch'),
    lines: [{ ...matchedInvoice.lines[0], quantity: '2.750' }],
  };

  const result = await app.recognizeSupplierInvoice(command);
  const retry = await app.recognizeSupplierInvoice(command);

  assert.equal(result.kind, 'EXCEPTION');
  assert.equal(retry.kind, 'EXCEPTION');
  assert.equal(result.exceptionCode, 'PURCHASE_QUANTITY_MISMATCH');
  assert.equal(postingCount, 0);
  assert.deepEqual(await app.getSupplierProjection('supplier-1'), { payableRials: 0n, advanceRials: 0n, openItemCount: 0 });
  assert.equal((await app.getInventoryProjection({ identityId: 'block-1' })).quantity, '0');
  assert.equal((await repository.listExceptions()).length, 1);
});

test('services need accepted-service evidence and non-order purchases need an authorized reason', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async () => ({ voucherId: 'voucher-service', statutoryNumber: 42 }),
  });
  const serviceLine = {
    ...matchedInvoice.lines[0], kind: 'SERVICE' as const, quantity: '1', unit: 'SERVICE', inventory: undefined,
    orderEvidence: undefined, receiptEvidence: undefined,
  };
  const missingAcceptance = await app.recognizeSupplierInvoice({
    ...matchedInvoice, idempotencyKey: 'service-missing-acceptance', evidence: evidence('service-invoice-1'), lines: [serviceLine],
  });
  assert.equal(missingAcceptance.kind, 'EXCEPTION');
  assert.equal(missingAcceptance.exceptionCode, 'ACCEPTED_SERVICE_EVIDENCE_REQUIRED');

  await assert.rejects(() => app.recognizeSupplierInvoice({
    ...matchedInvoice,
    idempotencyKey: 'non-order-without-authority', evidence: evidence('non-order-invoice-1'),
    lines: [{ ...serviceLine, nonOrderException: { reason: 'فوری', authorized: false } }],
  }), (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'NON_ORDER_AUTHORIZATION_REQUIRED');
});

test('payment allocation and reversal remain immutable and preserve supplier advances', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 50 }),
  });
  const invoice = await app.recognizeSupplierInvoice(matchedInvoice);
  assert.equal(invoice.kind, 'POSTED');
  const payment = await app.recordSupplierPayment({
    ...ledgerContext,
    supplierPartyId: 'supplier-1', financialAccountId: 'bank-1', amountRials: 12_000_000n, occurredAt: now,
    idempotencyKey: 'payment-1', evidence: evidence('payment-evidence-1'), actor,
    allocations: [{ openItemId: invoice.openItemId!, amountRials: 8_000_000n }],
  });
  assert.deepEqual(await app.getSupplierProjection('supplier-1'), { payableRials: 2_500_000n, advanceRials: 4_000_000n, openItemCount: 1 });

  await app.reverseAllocation({ ...ledgerContext, allocationId: payment.allocationIds[0], reason: 'برگشت تطبیق اشتباه', idempotencyKey: 'allocation-reversal-1', evidence: evidence('allocation-reversal-1'), actor });
  assert.deepEqual(await app.getSupplierProjection('supplier-1'), { payableRials: 10_500_000n, advanceRials: 12_000_000n, openItemCount: 1 });
});

test('purchase return creates a linked correction, immutable allocation, and inventory return event', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 55 }),
  });
  const original = await app.recognizeSupplierInvoice(matchedInvoice);
  const correctionLine = {
    ...matchedInvoice.lines[0], id: 'return-line-1', quantity: '0.500', unitPriceRials: 3_920_000n,
    grossRials: 1_960_000n, discountRials: 0n, attributableFreightRials: 0n,
    recoverableTaxRials: 0n, nonRecoverableTaxRials: 0n, deductionRials: 0n,
    retentionRials: 0n, roundingRials: 0n, orderEvidence: undefined, receiptEvidence: undefined,
    inventory: undefined,
  };
  const command = {
    ...ledgerContext, correctionOfInvoiceId: original.invoiceId!, supplierInvoiceNumber: 'SUP-1405-1-R1',
    dueDate: ledgerContext.documentDate, reason: 'مرجوعی بخشی از بلوک خریداری‌شده', idempotencyKey: 'supplier-return-1',
    correlationId: 'supplier-return-correlation-1', evidence: evidence('supplier-return-document-1'), actor,
    lines: [correctionLine],
    inventoryReturns: [{ identityId: 'block-1', quantity: '0.500', unit: 'TONNE', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'location-1', warehouseId: 'warehouse-1', locationId: 'return-dock', evidence: evidence('guard-return-1') }],
  };

  const correction = await app.recordSupplierCorrection(command);
  const retry = await app.recordSupplierCorrection(command);

  assert.equal(retry.invoiceId, correction.invoiceId);
  assert.equal((await repository.getInvoice(correction.invoiceId!))?.correctionOfInvoiceId, original.invoiceId);
  assert.deepEqual(await app.getSupplierProjection('supplier-1'), { payableRials: 8_540_000n, advanceRials: 0n, openItemCount: 1 });
  assert.deepEqual(await app.getInventoryProjection({ identityId: 'block-1' }), {
    identityId: 'block-1', quantity: '2.000', unit: 'TONNE', valueRials: 7_840_000n,
    layers: (await app.getInventoryProjection({ identityId: 'block-1' })).layers,
  });
  assert.deepEqual((await repository.listInventoryEvents('block-1')).map((item) => item.eventType), ['RECEIPT', 'RETURN']);
});

test('inventory units never aggregate silently and specific layers cannot be over-consumed', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 60 }),
  });
  await app.recognizeSupplierInvoice(matchedInvoice);
  await assert.rejects(() => app.consumeInventory({
    ...ledgerContext,
    identityId: 'block-1', quantity: '1', unit: 'CUBIC_METRE', purpose: 'PRODUCTION', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'location-1',
    idempotencyKey: 'consume-wrong-unit', evidence: evidence('consume-wrong-unit'), actor,
  }), (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'INCOMPATIBLE_INVENTORY_UNIT');
  await assert.rejects(() => app.consumeInventory({
    ...ledgerContext,
    identityId: 'block-1', quantity: '3.000', unit: 'TONNE', purpose: 'PRODUCTION', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'location-1',
    idempotencyKey: 'consume-too-much', evidence: evidence('consume-too-much'), actor,
  }), (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'INSUFFICIENT_INVENTORY');
});

test('actual production cost absorbs normal waste and expenses abnormal waste reproducibly', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 70 }),
  });
  await app.recognizeSupplierInvoice(matchedInvoice);
  const production = await app.completeProduction({
    ...ledgerContext,
    batchId: 'batch-1', idempotencyKey: 'production-1', actor,
    evidence: evidence('production-evidence-1'),
    inputs: [{ identityId: 'block-1', quantity: '2.000', unit: 'TONNE', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'location-1' }],
    outputs: [{ identityId: 'slab-1', quantity: '80', unit: 'SQUARE_METRE', warehouseId: 'warehouse-1', locationId: 'finished-1' }],
    costPools: [
      { kind: 'DIRECT_LABOR' as const, amountRials: 1_000_000n, basis: 'HOUR', basisQuantity: '40', policyVersion: 2 },
      { kind: 'MACHINE' as const, amountRials: 500_000n, basis: 'HOUR', basisQuantity: '10', policyVersion: 4 },
    ],
    normalWaste: { quantity: '0.100', unit: 'TONNE' },
    abnormalWaste: { quantity: '0.050', unit: 'TONNE', reason: 'شکست ناشی از خطای دستگاه' },
  });

  assert.equal(production.outputValueRials, 9_144_000n);
  assert.equal(production.abnormalWasteExpenseRials, 196_000n);
  assert.equal((await app.getInventoryProjection({ identityId: 'slab-1' })).valueRials, 9_144_000n);
});

test('production allocates each versioned cost pool by its declared output basis', async () => {
  const repository = createInMemorySupplyChainRepository();
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 71 }),
  });
  const preview = await app.previewOpeningInventory({
    sourcePackageHash: 'b'.repeat(64), mappingVersion: 1, toolVersion: 'test-import/1', scope: { batch: 'multi-output' }, actor,
    sepidarControlRials: 4_000_000n,
    items: [{ sourceId: 'material-1', identityId: 'raw-1', warehouseId: 'warehouse-1', locationId: 'raw', unit: 'KILOGRAM', quantity: '100', valueRials: 4_000_000n, valuationMethod: 'SPECIFIC_IDENTIFICATION' }],
  });
  await app.commitOpeningInventory({ ...ledgerContext, runId: preview.runId, idempotencyKey: 'multi-output-opening', actor });
  await app.completeProduction({
    ...ledgerContext, batchId: 'batch-multi', idempotencyKey: 'production-multi', actor, evidence: evidence('production-multi'),
    inputs: [{ identityId: 'raw-1', quantity: '100', unit: 'KILOGRAM', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'raw' }],
    outputs: [
      { identityId: 'output-a', quantity: '50', unit: 'KILOGRAM', warehouseId: 'warehouse-1', locationId: 'finished', allocationBasisQuantities: { DIRECT_LABOR: '30' } },
      { identityId: 'output-b', quantity: '50', unit: 'KILOGRAM', warehouseId: 'warehouse-1', locationId: 'finished', allocationBasisQuantities: { DIRECT_LABOR: '10' } },
    ],
    costPools: [{ kind: 'DIRECT_LABOR', amountRials: 800_000n, basis: 'HOUR', basisQuantity: '40', policyVersion: 3 }],
  });
  assert.equal((await app.getInventoryProjection({ identityId: 'output-a' })).valueRials, 2_600_000n);
  assert.equal((await app.getInventoryProjection({ identityId: 'output-b' })).valueRials, 2_200_000n);
});

test('opening inventory preview quarantines uncertainty and commit is idempotent only after exact reconciliation', async () => {
  const repository = createInMemorySupplyChainRepository();
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 80 }),
  });
  const previewCommand = {
    sourcePackageHash: 'a'.repeat(64), mappingVersion: 3, toolVersion: 'sepidar-opening-import/1.0.0', scope: { warehouseIds: ['warehouse-1'] }, actor,
    sepidarControlRials: 6_000_000n,
    items: [
      { sourceId: 'row-1', identityId: 'opening-block-1', warehouseId: 'warehouse-1', locationId: 'location-1', unit: 'TONNE', quantity: '1.500', valueRials: 6_000_000n, valuationMethod: 'SPECIFIC_IDENTIFICATION' as const },
      { sourceId: 'row-2', identityId: 'uncertain-block', warehouseId: 'warehouse-1', locationId: 'quarantine', unit: 'TONNE', quantity: '0.500', valueRials: 0n, valuationMethod: 'SPECIFIC_IDENTIFICATION' as const, uncertainty: 'ارزش منبع نامشخص است' },
      { sourceId: 'row-bad', identityId: 'rejected:row-bad', warehouseId: 'REJECTED', locationId: 'REJECTED', unit: 'UNKNOWN', quantity: '0.000001', valueRials: 0n, valuationMethod: 'SPECIFIC_IDENTIFICATION' as const, disposition: 'REJECTED' as const, rejectionReason: 'مقدار منبع نامعتبر است', rawPayload: { quantity: 'not-a-number' } },
    ],
  };
  const preview = await app.previewOpeningInventory(previewCommand);
  const previewRetry = await app.previewOpeningInventory(previewCommand);
  assert.equal(previewRetry.runId, preview.runId);
  assert.equal(preview.reconciled, true);
  assert.equal(preview.quarantinedCount, 1);
  assert.equal((await repository.getOpeningRun(preview.runId))?.rejectedCount, 1);
  const committed = await app.commitOpeningInventory({ ...ledgerContext, runId: preview.runId, idempotencyKey: 'opening-commit-1', actor });
  const retried = await app.commitOpeningInventory({ ...ledgerContext, runId: preview.runId, idempotencyKey: 'opening-commit-1', actor });
  assert.equal(committed.voucherId, retried.voucherId);
  assert.equal((await app.getInventoryProjection({ identityId: 'opening-block-1' })).quantity, '1.500');
  assert.equal((await app.getInventoryProjection({ identityId: 'uncertain-block' })).quantity, '0');
  const successor = await app.previewOpeningInventory({ ...previewCommand,
    sourcePackageHash: 'c'.repeat(64), mappingVersion: 4, predecessorRunId: preview.runId,
  });
  assert.equal((await repository.getOpeningRun(preview.runId))?.successorRunId, successor.runId);
});

test('homogeneous consumables use moving weighted average without rewriting historical layers', async () => {
  const repository = createInMemorySupplyChainRepository();
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 90 }),
  });
  for (const [sourceId, quantity, valueRials] of [['c-1', '10.000', 1_000_000n], ['c-2', '10.000', 3_000_000n]] as const) {
    const preview = await app.previewOpeningInventory({
      sourcePackageHash: hashSupplyChainEvidence({ sourceId }).padEnd(64, '0').slice(0, 64), mappingVersion: 1, toolVersion: 'test-import/1', scope: { sourceId }, actor,
      sepidarControlRials: valueRials,
      items: [{ sourceId, identityId: 'consumable-resin', warehouseId: 'warehouse-1', locationId: 'materials', unit: 'KILOGRAM', quantity, valueRials, valuationMethod: 'MOVING_WEIGHTED_AVERAGE' }],
    });
    await app.commitOpeningInventory({ ...ledgerContext, runId: preview.runId, idempotencyKey: `commit-${sourceId}`, actor });
  }

  const consumed = await app.consumeInventory({
    ...ledgerContext,
    identityId: 'consumable-resin', quantity: '5.000', unit: 'KILOGRAM', purpose: 'PRODUCTION', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'materials',
    idempotencyKey: 'consume-resin-1', evidence: evidence('consume-resin-1'), actor,
  });
  const retried = await app.consumeInventory({
    ...ledgerContext,
    identityId: 'consumable-resin', quantity: '5.000', unit: 'KILOGRAM', purpose: 'PRODUCTION', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'materials',
    idempotencyKey: 'consume-resin-1', evidence: evidence('consume-resin-1'), actor,
  });
  const projection = await app.getInventoryProjection({ identityId: 'consumable-resin' });
  assert.equal(consumed.valueRials, 1_000_000n);
  assert.equal(retried.voucherId, consumed.voucherId);
  assert.equal((await repository.listConsumptions('consumable-resin')).length, 1);
  assert.equal((await repository.listInventoryEvents('consumable-resin')).filter((item) => item.eventType === 'TRANSFORMATION_INPUT').length, 1);
  assert.equal(projection.quantity, '15.000');
  assert.equal(projection.valueRials, 3_000_000n);
  assert.deepEqual(projection.layers.map((layer) => layer.valueRials), [1_000_000n, 3_000_000n]);
});

test('reservation is a separate fact and does not change physical or valued inventory', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 91 }),
  });
  await app.recognizeSupplierInvoice(matchedInvoice);
  const before = await app.getInventoryProjection({ identityId: 'block-1' });
  const reservation = await app.reserveInventory({
    identityId: 'block-1', quantity: '1.000', unit: 'TONNE', purposeId: 'sales-contract-1',
    idempotencyKey: 'reservation-1', evidence: evidence('reservation-1'), actor,
  });
  const after = await app.getInventoryProjection({ identityId: 'block-1' });
  assert.equal(reservation.status, 'ACTIVE');
  assert.deepEqual(after, before);
  await assert.rejects(() => app.reserveInventory({
    identityId: 'block-1', quantity: '99.001', unit: 'TONNE', purposeId: 'sales-contract-2',
    idempotencyKey: 'reservation-overbook', evidence: evidence('reservation-overbook'), actor,
  }), (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'INSUFFICIENT_INVENTORY');
  const released = await app.releaseInventoryReservation({ reservationId: reservation.id, evidence: evidence('reservation-release-1'), actor });
  assert.equal(released.status, 'RELEASED');
  const second = await app.reserveInventory({
    identityId: 'block-1', quantity: '2.000', unit: 'TONNE', purposeId: 'sales-contract-2',
    idempotencyKey: 'reservation-2', evidence: evidence('reservation-2'), actor,
  });
  assert.equal(second.status, 'ACTIVE');
  await assert.rejects(() => app.consumeInventory({
    ...ledgerContext, identityId: 'block-1', quantity: '1.000', unit: 'TONNE', purpose: 'SALE', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'location-1',
    idempotencyKey: 'unrelated-consumption', evidence: evidence('unrelated-consumption'), actor,
  }), (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'INSUFFICIENT_INVENTORY');
  await app.consumeInventory({
    ...ledgerContext, identityId: 'block-1', quantity: '2.000', unit: 'TONNE', purpose: 'SALE', sourceWarehouseId: 'warehouse-1', sourceLocationId: 'location-1', reservationId: second.id,
    reservationPurposeId: 'sales-contract-2',
    idempotencyKey: 'reserved-consumption', evidence: evidence('reserved-consumption'), actor,
  });
  assert.equal((await repository.getReservation(second.id))?.status, 'RELEASED');
});

test('a bounced payable check reverses its allocations and reopens the supplier balance', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 93 }),
  });
  const invoice = await app.recognizeSupplierInvoice({ ...matchedInvoice, idempotencyKey: 'bounce-invoice', evidence: evidence('bounce-invoice') });
  const issued = await app.issuePayableCheck({
    ...ledgerContext, sayadId: '2234567890123456', amountRials: 5_000_000n, supplierPartyId: 'supplier-1',
    financialAccountId: 'bank-1', dueDate: new Date('2026-10-01T00:00:00.000Z'),
    idempotencyKey: 'bounce-check', evidence: evidence('bounce-check'), actor,
    allocations: [{ openItemId: invoice.openItemId!, amountRials: 5_000_000n }],
  });
  await app.transitionCheck({ ...ledgerContext, checkId: issued.checkId, to: 'DELIVERED', reason: 'تحویل چک به تأمین‌کننده', evidence: evidence('bounce-delivery'), actor });
  await app.transitionCheck({ ...ledgerContext, checkId: issued.checkId, to: 'BOUNCED', reason: 'برگشت چک از حساب بانکی', evidence: evidence('bounce-bank'), actor });
  assert.deepEqual(await app.getSupplierProjection('supplier-1'), { payableRials: 10_500_000n, advanceRials: 0n, openItemCount: 1 });
  const replacement = await app.issuePayableCheck({
    ...ledgerContext, sayadId: '2234567890123457', amountRials: 5_000_000n, supplierPartyId: 'supplier-1', financialAccountId: 'bank-1',
    dueDate: new Date('2026-10-10T00:00:00.000Z'), idempotencyKey: 'replacement-check', evidence: evidence('replacement-check'), actor,
    allocations: [{ openItemId: invoice.openItemId!, amountRials: 5_000_000n }], replacesCheckId: issued.checkId,
  });
  assert.equal(replacement.status, 'ISSUED');
  assert.deepEqual((await app.getCheckTimeline(issued.checkId)).map((item) => item.status), ['ISSUED', 'DELIVERED', 'BOUNCED', 'REPLACED']);
});

test('an assigned customer check preserves receipt, endorsement, delivery, and bounce lineage', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 94 }),
  });
  const invoice = await app.recognizeSupplierInvoice({ ...matchedInvoice, idempotencyKey: 'assigned-invoice', evidence: evidence('assigned-invoice') });
  const assigned = await app.assignCustomerCheck({
    ...ledgerContext, sayadId: '3234567890123456', amountRials: 4_000_000n, supplierPartyId: 'supplier-1',
    financialAccountId: 'receivable-checks-1', dueDate: new Date('2026-10-05T00:00:00.000Z'), sourceCustomerPaymentId: 'customer-payment-383',
    idempotencyKey: 'assigned-check', receiptEvidence: evidence('customer-check-receipt'), endorsementEvidence: evidence('customer-check-endorsement'), actor,
    allocations: [{ openItemId: invoice.openItemId!, amountRials: 4_000_000n }],
  });
  await app.transitionCheck({ ...ledgerContext, checkId: assigned.checkId, to: 'DELIVERED', reason: 'تحویل چک واگذارشده به تأمین‌کننده', evidence: evidence('assigned-delivery'), actor });
  await app.transitionCheck({ ...ledgerContext, checkId: assigned.checkId, to: 'BOUNCED', reason: 'برگشت چک واگذارشده از بانک', evidence: evidence('assigned-bounce'), actor });
  assert.deepEqual((await app.getCheckTimeline(assigned.checkId)).map((item) => item.status), ['RECEIVED', 'ENDORSED', 'DELIVERED', 'BOUNCED']);
  assert.deepEqual(await app.getSupplierProjection('supplier-1'), { payableRials: 10_500_000n, advanceRials: 0n, openItemCount: 1 });
});

test('payable check keeps immutable custody lineage and rejects an impossible transition', async () => {
  const repository = createInMemorySupplyChainRepository();
  await repository.seedParty({ id: 'supplier-1', roles: ['SUPPLIER'] });
  const app = createAccountingSupplyChainApplication(repository, {
    now: () => now,
    post: async (command) => ({ voucherId: `voucher-${command.idempotencyKey}`, statutoryNumber: 92 }),
  });
  const invoice = await app.recognizeSupplierInvoice({ ...matchedInvoice, idempotencyKey: 'check-invoice-1', evidence: evidence('check-invoice-1') });
  const issued = await app.issuePayableCheck({
    ...ledgerContext,
    sayadId: '1234567890123456', amountRials: 5_000_000n, supplierPartyId: 'supplier-1',
    financialAccountId: 'bank-1', dueDate: new Date('2026-10-01T00:00:00.000Z'),
    idempotencyKey: 'check-issue-1', evidence: evidence('check-issue-1'), actor,
    allocations: [{ openItemId: invoice.openItemId!, amountRials: 5_000_000n }],
  });
  assert.deepEqual(await app.getSupplierProjection('supplier-1'), { payableRials: 5_500_000n, advanceRials: 0n, openItemCount: 1 });
  await app.transitionCheck({ ...ledgerContext, checkId: issued.checkId, to: 'DELIVERED', reason: 'تحویل به تأمین‌کننده', evidence: evidence('check-delivery-1'), actor });
  await app.transitionCheck({ ...ledgerContext, checkId: issued.checkId, to: 'CLEARED', reason: 'تأیید وصول از بانک', evidence: evidence('check-clearing-1'), actor });
  await assert.rejects(() => app.transitionCheck({
    ...ledgerContext,
    checkId: issued.checkId, to: 'CANCELLED', reason: 'لغو پس از وصول', evidence: evidence('check-cancel-1'), actor,
  }), (error: unknown) => error instanceof SupplyChainAccountingError && error.code === 'INVALID_CHECK_TRANSITION');
  assert.deepEqual((await app.getCheckTimeline(issued.checkId)).map((item) => item.status), ['ISSUED', 'DELIVERED', 'CLEARED']);
});
