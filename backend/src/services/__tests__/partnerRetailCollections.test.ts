import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as contracts from '@sabalanerp/partner-sales-contracts';
import { createPartnerRetailCollectionsService } from '../partnerSales/retailCollections/service';
import type {
  RetailCollectionCommandReceipt, RetailCollectionReceipt, RetailCollectionRepository,
  RetailCollectionSource, RetailCollectionTransaction,
} from '../partnerSales/retailCollections/repository';

const hash = (value: string) => `sha256-v1:${value.repeat(64)}`;
const initialPlan: RetailCollectionSource['customerPaymentPlan'] = {
  planId: 'plan-324-v1', version: 1, effectiveDate: '2026-08-01',
  installments: [
    { installmentId: 'installment-324-a', dueDate: '2026-08-10', amount: { amount: '400', currency: 'IRR' }, method: 'CASH' },
    { installmentId: 'installment-324-b', dueDate: '2026-09-10', amount: { amount: '600', currency: 'IRR' }, method: 'BANK_TRANSFER' },
  ],
};
const successorPlan = (): RetailCollectionSource['customerPaymentPlan'] => ({
  planId: 'plan-324-v2', version: 2, predecessorPlanId: 'plan-324-v1', effectiveDate: '2026-09-01',
  installments: [{ installmentId: 'installment-324-c', dueDate: '2026-10-10',
    amount: { amount: '750', currency: 'IRR' }, method: 'BANK_TRANSFER' }],
});

class RetailFixture implements RetailCollectionRepository, RetailCollectionTransaction {
  readonly commandReceipts: RetailCollectionCommandReceipt[] = [];
  source: RetailCollectionSource = {
    owner: { caseId: 'case-324', revision: 1, integrityHash: hash('a') },
    state: 'COMMITTED',
    partnerSellerId: 'partner-324',
    retailPayable: { amount: '1000', currency: 'IRR' },
    customerPaymentPlan: structuredClone(initialPlan),
    customerOutputPaymentPlan: structuredClone(initialPlan),
    privateReportPaymentPlan: structuredClone(initialPlan),
    planHistory: [], receipts: [], events: [],
    permission: {
      actorId: 'partner-324', persona: 'PARTNER', isAdmin: false, partnerSellerId: 'partner-324', partnerStatus: 'ACTIVE',
      root: { kind: 'CASE', id: 'case-324' }, purpose: 'PARTNER', channel: 'API', scope: 'OWN',
      resourceVisible: true, actionGranted: true, authorizationRevision: 1, lifecycleRevision: 1,
      evaluatedAt: '2026-08-30T09:00:00.000Z',
    },
  };

  constructor() { this.source.planHistory = [this.source.customerPaymentPlan]; }
  async transaction<T>(operation: (tx: RetailCollectionTransaction) => Promise<contracts.Result<T>>) { return operation(this); }
  async now() { return '2026-08-30T09:00:00.000Z'; }
  async readAuthorizedSource(_expected: contracts.RevisionRef, channel: 'DETAIL' | 'EXPORT' | 'API') {
    const value = structuredClone(this.source);
    value.permission.channel = channel;
    return { ok: true as const, value };
  }
  async readCommand(commandId: string, idempotency: contracts.IdempotencyIdentity) {
    return this.commandReceipts.find(item => item.commandId === commandId ||
      contracts.compareIdempotency(item.idempotency, idempotency) !== 'DISTINCT') || null;
  }
  async appendReceipt(input: { expected: contracts.RevisionRef; receipt: RetailCollectionReceipt;
    event: contracts.PartnerEvent; command: RetailCollectionCommandReceipt }) {
    this.source.receipts = [...this.source.receipts, structuredClone(input.receipt)];
    this.source.events = [...this.source.events, structuredClone(input.event)];
    this.commandReceipts.push(structuredClone(input.command));
    return { ok: true as const, value: input.command };
  }
  async appendDelayEvents(input: { expected: contracts.RevisionRef; events: readonly contracts.PartnerEvent[];
    command: RetailCollectionCommandReceipt }) {
    this.source.events = [...this.source.events, ...structuredClone(input.events)];
    this.commandReceipts.push(structuredClone(input.command));
    return { ok: true as const, value: input.command };
  }
  get events() { return this.source.events; }
}

async function receiptCommand(fixture: RetailFixture) {
  const intent = {
    type: 'RETAIL_RECEIPT' as const, expected: fixture.source.owner, expectedState: 'COMMITTED' as const,
    planId: 'plan-324-v1', receiptId: 'receipt-324-a',
    amount: { amount: '250', currency: 'IRR' as const }, effectiveDate: '2026-08-30',
    allocations: [{ installmentId: 'installment-324-a', amount: '250' }],
  };
  return contracts.PartnerCommandSchema.parse({
    schemaVersion: 1, commandId: 'command-324-receipt', correlationId: 'correlation-324', ...intent,
    idempotency: { actorId: 'partner-324', operation: 'RETAIL_RECEIPT', targetId: 'case-324', key: 'key-324-receipt',
      payloadHash: await contracts.canonicalHash(intent) },
  });
}

async function reversalCommand(fixture: RetailFixture) {
  const intent = {
    type: 'RETAIL_RECEIPT_REVERSE' as const, expected: fixture.source.owner, expectedState: 'COMMITTED' as const,
    receiptId: 'receipt-324-a', effectiveDate: '2026-08-31', reason: 'برگشت کامل وجه مشتری',
  };
  return contracts.PartnerCommandSchema.parse({
    schemaVersion: 1, commandId: 'command-324-reversal', correlationId: 'correlation-324', ...intent,
    idempotency: { actorId: 'partner-324', operation: 'RETAIL_RECEIPT_REVERSE', targetId: 'case-324', key: 'key-324-reversal',
      payloadHash: await contracts.canonicalHash(intent) },
  });
}

test('partial retail receipt changes only the private customer balance and emits a retail outcome', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  const result = await service.execute(await receiptCommand(fixture));
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.value.replayed, false);
  assert.deepEqual(result.value.eventIds, ['retail-event:receipt-324-a']);
  const view = await service.read(fixture.source.owner);
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.deepEqual(view.value.summary, {
    currency: 'IRR', retailPayable: '1000', received: '250', reversed: '0', netCollected: '250', balance: '750', status: 'PARTIAL',
  });
  assert.equal(fixture.events.length, 1);
  assert.equal(fixture.events[0].type, 'RETAIL_RECEIPT');
  assert.equal(JSON.stringify(fixture.events).includes('SABALAN_RECEIPT'), false);
});

test('reversal appends linked evidence and never rewrites the original receipt', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  assert.equal((await service.execute(await receiptCommand(fixture))).ok, true);
  const original = structuredClone(fixture.source.receipts[0]);
  const result = await service.execute(await reversalCommand(fixture));
  assert.equal(result.ok, true);
  const view = await service.read(fixture.source.owner);
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.equal(view.value.summary.netCollected, '0');
  assert.equal(view.value.summary.balance, '1000');
  assert.equal(view.value.summary.status, 'UNPAID');
  assert.deepEqual(fixture.source.receipts[0], original);
  assert.equal(fixture.source.receipts[1].originalReceiptId, original.receiptId);
  assert.equal(fixture.source.receipts[1].planId, original.planId);
  assert.equal(fixture.events[1].type, 'RETAIL_RECEIPT_REVERSED');
});

test('effective-dated successor keeps historical receipt allocations on the predecessor while carrying the net balance forward', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  assert.equal((await service.execute(await receiptCommand(fixture))).ok, true);
  const successor = successorPlan();
  fixture.source.owner = { ...fixture.source.owner, revision: 2, integrityHash: hash('b') };
  fixture.source.customerPaymentPlan = successor;
  fixture.source.customerOutputPaymentPlan = structuredClone(successor);
  fixture.source.privateReportPaymentPlan = structuredClone(successor);
  fixture.source.planHistory = [fixture.source.planHistory[0], successor];
  const view = await service.read(fixture.source.owner);
  assert.equal(view.ok, true);
  if (!view.ok) return;
  assert.deepEqual(view.value.customerPaymentPlan, successor);
  assert.equal(view.value.receipts[0].planId, 'plan-324-v1');
  assert.equal(view.value.receipts[0].allocations[0].installmentId, 'installment-324-a');
  assert.equal(view.value.summary.netCollected, '250');
  assert.equal(view.value.summary.balance, '750');
});

test('cumulative receipt allocations cannot exceed the historical installment amount', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  assert.equal((await service.execute(await receiptCommand(fixture))).ok, true);
  const intent = {
    type: 'RETAIL_RECEIPT' as const, expected: fixture.source.owner, expectedState: 'COMMITTED' as const,
    planId: 'plan-324-v1', receiptId: 'receipt-324-over', amount: { amount: '200', currency: 'IRR' as const },
    effectiveDate: '2026-08-31', allocations: [{ installmentId: 'installment-324-a', amount: '200' }],
  };
  const command = contracts.PartnerCommandSchema.parse({
    schemaVersion: 1, commandId: 'command-324-over', correlationId: 'correlation-324', ...intent,
    idempotency: { actorId: 'partner-324', operation: 'RETAIL_RECEIPT', targetId: 'case-324', key: 'key-324-over',
      payloadHash: await contracts.canonicalHash(intent) },
  });
  const result = await service.execute(command);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'STATE_CONFLICT');
  assert.equal(fixture.source.receipts.length, 1);
});

test('delay recording derives the overdue fact from the current plan and effective allocations', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  assert.equal((await service.execute(await receiptCommand(fixture))).ok, true);
  const result = await service.recordDelay({ commandId: 'command-324-delay', correlationId: 'correlation-324',
    expected: fixture.source.owner, planId: 'plan-324-v1', installmentId: 'installment-324-a' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.value.eventIds, ['retail-delay:plan-324-v1:installment-324-a']);
  const delayed = fixture.events.find(event => event.type === 'RETAIL_PAYMENT_DELAYED');
  assert.deepEqual(delayed && { planId: delayed.planId, installmentId: delayed.installmentId },
    { planId: 'plan-324-v1', installmentId: 'installment-324-a' });
  const view = await service.read(fixture.source.owner);
  assert.equal(view.ok, true);
  if (view.ok) assert.deepEqual(view.value.delays, [{ eventId: 'retail-delay:plan-324-v1:installment-324-a',
    planId: 'plan-324-v1', installmentId: 'installment-324-a', effectiveDate: '2026-08-30' }]);
});

test('private detail and export share the same owner scope and hide foreign, responder, and Accounting access', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  assert.equal((await service.execute(await receiptCommand(fixture))).ok, true);
  const detail = await service.read(fixture.source.owner);
  const exported = await service.export(fixture.source.owner);
  assert.deepEqual(exported, detail);

  const deniedContexts: contracts.PermissionContext[] = [
    { ...fixture.source.permission, actorId: 'partner-foreign', partnerSellerId: 'partner-foreign' },
    { ...fixture.source.permission, actorId: 'responder-324', persona: 'INTERNAL', purpose: 'RESPONDER', scope: 'ASSIGNED' },
    { ...fixture.source.permission, actorId: 'accounting-324', persona: 'INTERNAL', purpose: 'ACCOUNTING', scope: 'PURPOSE_BOUND' },
  ];
  for (const context of deniedContexts) {
    fixture.source.permission = context;
    const hiddenDetail = await service.read(fixture.source.owner);
    const hiddenExport = await service.export(fixture.source.owner);
    assert.equal(hiddenDetail.ok, false);
    assert.equal(hiddenExport.ok, false);
    if (!hiddenDetail.ok && !hiddenExport.ok) assert.deepEqual(hiddenDetail.error, hiddenExport.error);
  }
});

test('receipt history and reporting outcome events must remain a complete append-only pair', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  assert.equal((await service.execute(await receiptCommand(fixture))).ok, true);
  fixture.source.events = [];
  const missingOutcome = await service.read(fixture.source.owner);
  assert.equal(missingOutcome.ok, false);
  if (!missingOutcome.ok) assert.equal(missingOutcome.error.code, 'INTEGRITY_CONFLICT');
});

test('customer output and private report must carry the exact current customer plan', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  fixture.source.privateReportPaymentPlan.installments[0].dueDate = '2026-08-11';
  const result = await service.read(fixture.source.owner);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INTEGRITY_CONFLICT');
});

test('successor schedules must be future-dated and equal the balance at their effective date', async () => {
  for (const mutate of [
    (plan: RetailCollectionSource['customerPaymentPlan']) => { plan.effectiveDate = '2026-07-31'; },
    (plan: RetailCollectionSource['customerPaymentPlan']) => { plan.installments[0].dueDate = '2026-08-31'; },
    (plan: RetailCollectionSource['customerPaymentPlan']) => { plan.installments[0].amount.amount = '700'; },
  ]) {
    const fixture = new RetailFixture();
    const service = createPartnerRetailCollectionsService(fixture);
    assert.equal((await service.execute(await receiptCommand(fixture))).ok, true);
    const successor = successorPlan();
    mutate(successor);
    fixture.source.owner = { ...fixture.source.owner, revision: 2, integrityHash: hash('b') };
    fixture.source.customerPaymentPlan = structuredClone(successor);
    fixture.source.customerOutputPaymentPlan = structuredClone(successor);
    fixture.source.privateReportPaymentPlan = structuredClone(successor);
    fixture.source.planHistory = [fixture.source.planHistory[0], successor];
    const result = await service.read(fixture.source.owner);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, 'INTEGRITY_CONFLICT');
  }
});

test('delay operation rejects caller-selected effective dates', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  const result = await service.recordDelay({ commandId: 'command-324-delay', correlationId: 'correlation-324',
    expected: fixture.source.owner, planId: 'plan-324-v1', installmentId: 'installment-324-a',
    effectiveDate: '2026-01-01' } as never);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'INVALID_PAYLOAD');
});

test('backdated collection cannot rewrite the balance captured by an effective successor', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  assert.equal((await service.execute(await receiptCommand(fixture))).ok, true);
  const successor = successorPlan();
  fixture.source.owner = { ...fixture.source.owner, revision: 2, integrityHash: hash('b') };
  fixture.source.customerPaymentPlan = structuredClone(successor);
  fixture.source.customerOutputPaymentPlan = structuredClone(successor);
  fixture.source.privateReportPaymentPlan = structuredClone(successor);
  fixture.source.planHistory = [fixture.source.planHistory[0], successor];
  const intent = { type: 'RETAIL_RECEIPT' as const, expected: fixture.source.owner, expectedState: 'COMMITTED' as const,
    planId: 'plan-324-v1', receiptId: 'receipt-324-backdated', amount: { amount: '100', currency: 'IRR' as const },
    effectiveDate: '2026-08-31', allocations: [{ installmentId: 'installment-324-a', amount: '100' }] };
  const command = contracts.PartnerCommandSchema.parse({ schemaVersion: 1, commandId: 'command-324-backdated',
    correlationId: 'correlation-324', ...intent, idempotency: { actorId: 'partner-324', operation: 'RETAIL_RECEIPT',
      targetId: 'case-324', key: 'key-324-backdated', payloadHash: await contracts.canonicalHash(intent) } });
  const before = structuredClone(fixture.source.receipts);
  const result = await service.execute(command);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.code, 'STATE_CONFLICT');
  assert.deepEqual(fixture.source.receipts, before);
});

test('delay evidence must bind one real historical plan installment exactly once', async () => {
  const fixture = new RetailFixture();
  const service = createPartnerRetailCollectionsService(fixture);
  assert.equal((await service.recordDelay({ commandId: 'command-324-delay', correlationId: 'correlation-324',
    expected: fixture.source.owner, planId: 'plan-324-v1', installmentId: 'installment-324-a' })).ok, true);
  const saved = structuredClone(fixture.source.events[0]);
  if (saved.type !== 'RETAIL_PAYMENT_DELAYED') throw new Error('Wrong fixture event');
  fixture.source.events = [{ ...saved, installmentId: 'missing-installment' }];
  assert.equal((await service.read(fixture.source.owner)).ok, false);
  fixture.source.events = [saved, { ...saved, eventId: 'retail-delay:duplicate' }];
  assert.equal((await service.read(fixture.source.owner)).ok, false);
});
