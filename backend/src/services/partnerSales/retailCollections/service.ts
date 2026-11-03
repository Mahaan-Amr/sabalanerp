import type { PartnerCommand } from './contracts';
import { contracts, type PartnerErrorCode, type Result, type RevisionRef } from './contracts';
import type {
  RetailCollectionCommandReceipt, RetailCollectionReceipt, RetailCollectionRepository, RetailCollectionSource,
  RetailCollectionTransaction,
} from './repository';
import { subtract, sum } from '../reporting/money';

type RetailCommand = Extract<PartnerCommand, { type: 'RETAIL_RECEIPT' | 'RETAIL_RECEIPT_REVERSE' }>;
type CollectionStatus = 'UNPAID' | 'PARTIAL' | 'SETTLED' | 'OVERPAID';

type RetailCollectionView = {
  owner: RevisionRef;
  customerPaymentPlan: RetailCollectionSource['customerPaymentPlan'];
  planHistory: RetailCollectionSource['planHistory'];
  receipts: RetailCollectionSource['receipts'];
  delays: readonly { eventId: string; planId: string; installmentId: string; effectiveDate: string }[];
  summary: {
    currency: RetailCollectionSource['retailPayable']['currency'];
    retailPayable: string;
    received: string;
    reversed: string;
    netCollected: string;
    balance: string;
    status: CollectionStatus;
  };
};

type RetailDelayRequest = {
  commandId: string;
  correlationId: string;
  expected: RevisionRef;
  planId: string;
  installmentId: string;
};

const failure = <T = never>(code: PartnerErrorCode): Result<T> => ({ ok: false, error: contracts.partnerError(code) });

function validateSource(source: RetailCollectionSource, expected: RevisionRef, channel: 'DETAIL' | 'EXPORT' | 'API'): Result<RetailCollectionSource> {
  const owner = contracts.RevisionRefSchema.safeParse(source.owner);
  const payable = contracts.MoneySchema.safeParse(source.retailPayable);
  const permission = contracts.PermissionContextSchema.safeParse(source.permission);
  const current = contracts.PaymentPlanSchema.safeParse(source.customerPaymentPlan);
  const customerOutput = contracts.PaymentPlanSchema.safeParse(source.customerOutputPaymentPlan);
  const privateReport = contracts.PaymentPlanSchema.safeParse(source.privateReportPaymentPlan);
  const plans = source.planHistory.map(plan => contracts.PaymentPlanSchema.safeParse(plan));
  if (!owner.success || !payable.success || !permission.success || !current.success || !customerOutput.success
      || !privateReport.success || plans.some(plan => !plan.success)) return failure('INTEGRITY_CONFLICT');
  const conflict = contracts.checkExpectedRevision(expected, owner.data);
  if (conflict) return { ok: false, error: conflict };
  const context = permission.data;
  if (context.root.kind !== 'CASE' || context.root.id !== source.owner.caseId || context.purpose !== 'PARTNER'
      || context.channel !== channel || context.persona !== 'PARTNER' || context.scope !== 'OWN'
      || context.actorId !== source.partnerSellerId || context.partnerSellerId !== source.partnerSellerId
      || !context.resourceVisible || !context.actionGranted || !['ACTIVE', 'SUSPENDED'].includes(context.partnerStatus)
      || (context.grantExpiresAt && context.grantExpiresAt <= context.evaluatedAt)) return failure('NOT_FOUND');
  if (!['COMMITTED', 'VOIDED'].includes(source.state)) return failure('STATE_CONFLICT');
  const orderedPlans = plans.map(plan => plan.success ? plan.data : current.data).sort((left, right) => left.version - right.version);
  const planIds = new Set<string>();
  const versions = new Set<number>();
  const installmentIds = new Set<string>();
  for (const plan of orderedPlans) {
    if (planIds.has(plan.planId) || versions.has(plan.version) || plan.installments.length === 0) return failure('INTEGRITY_CONFLICT');
    planIds.add(plan.planId); versions.add(plan.version);
    if (plan.installments.some(item => item.amount.amount === '0' || item.amount.currency !== payable.data.currency
      || item.dueDate < plan.effectiveDate
      || installmentIds.has(item.installmentId))) return failure('INTEGRITY_CONFLICT');
    plan.installments.forEach(item => installmentIds.add(item.installmentId));
    const predecessor = orderedPlans[plan.version - 2];
    if (plan.version === 1 ? plan.predecessorPlanId !== undefined
      : plan.predecessorPlanId !== predecessor?.planId || plan.effectiveDate < predecessor.effectiveDate) return failure('INTEGRITY_CONFLICT');
  }
  const persistedCurrent = orderedPlans.find(plan => plan.planId === current.data.planId);
  if (!persistedCurrent || current.data.version !== orderedPlans[orderedPlans.length - 1]?.version
      || contracts.canonicalJson(current.data) !== contracts.canonicalJson(persistedCurrent)
      || contracts.canonicalJson(current.data) !== contracts.canonicalJson(customerOutput.data)
      || contracts.canonicalJson(current.data) !== contracts.canonicalJson(privateReport.data)) {
    return failure('INTEGRITY_CONFLICT');
  }
  const events = source.events.map(event => contracts.PartnerEventSchema.safeParse(event));
  if (events.some(event => !event.success || event.data.owner.caseId !== owner.data.caseId)
      || new Set(events.map(event => event.success ? event.data.eventId : '')).size !== events.length) return failure('INTEGRITY_CONFLICT');
  return { ok: true, value: { ...source, owner: owner.data, retailPayable: payable.data,
    customerPaymentPlan: current.data, customerOutputPaymentPlan: customerOutput.data,
    privateReportPaymentPlan: privateReport.data, planHistory: orderedPlans } };
}

function project(source: RetailCollectionSource): Result<RetailCollectionView> {
  const originals = new Map<string, RetailCollectionReceipt>();
  const receiptIds = new Set<string>();
  const reversedByOriginal = new Map<string, string[]>();
  const received: string[] = [];
  const reversed: string[] = [];
  const planIds = new Set(source.planHistory.map(plan => plan.planId));
  for (const receipt of source.receipts) {
    if (!contracts.IdSchema.safeParse(receipt.receiptId).success || !planIds.has(receipt.planId)
        || !contracts.MoneySchema.safeParse(receipt.amount).success || receipt.amount.currency !== source.retailPayable.currency
        || !contracts.DateSchema.safeParse(receipt.effectiveDate).success || !contracts.InstantSchema.safeParse(receipt.recordedAt).success
        || !contracts.IdSchema.safeParse(receipt.actorId).success || !contracts.IdSchema.safeParse(receipt.commandId).success
        || !contracts.IdSchema.safeParse(receipt.correlationId).success || receiptIds.has(receipt.receiptId)) return failure('INTEGRITY_CONFLICT');
    receiptIds.add(receipt.receiptId);
    if (receipt.kind === 'RECEIPT') {
      const plan = source.planHistory.find(item => item.planId === receipt.planId);
      const installmentIds = new Set(plan?.installments.map(item => item.installmentId));
      if (receipt.originalReceiptId || originals.has(receipt.receiptId) || receipt.actorId !== source.partnerSellerId
          || !plan || !receipt.allocations.length || new Set(receipt.allocations.map(item => item.installmentId)).size !== receipt.allocations.length
          || receipt.allocations.some(item => item.amount === '0' || !installmentIds.has(item.installmentId))
          || sum(receipt.allocations.map(item => item.amount)) !== receipt.amount.amount) return failure('INTEGRITY_CONFLICT');
      originals.set(receipt.receiptId, receipt); received.push(receipt.amount.amount);
    } else {
      const original = receipt.originalReceiptId ? originals.get(receipt.originalReceiptId) : undefined;
      if (!original || original.planId !== receipt.planId || receipt.effectiveDate < original.effectiveDate
          || receipt.allocations.length || !receipt.reason) return failure('INTEGRITY_CONFLICT');
      const amounts = reversedByOriginal.get(original.receiptId) || [];
      amounts.push(receipt.amount.amount); reversedByOriginal.set(original.receiptId, amounts);
      if (subtract(original.amount.amount, sum(amounts)).startsWith('-')) return failure('INTEGRITY_CONFLICT');
      reversed.push(receipt.amount.amount);
    }
  }
  const outcomeEvents = source.events.filter(event => event.type === 'RETAIL_RECEIPT' || event.type === 'RETAIL_RECEIPT_REVERSED');
  if (outcomeEvents.length !== source.receipts.length) return failure('INTEGRITY_CONFLICT');
  const outcomeIds = new Set<string>();
  for (const receipt of source.receipts) {
    const outcome = outcomeEvents.find(event => event.type === 'RETAIL_RECEIPT'
      ? receipt.kind === 'RECEIPT' && event.receiptId === receipt.receiptId
      : receipt.kind === 'REVERSAL' && event.reversalId === receipt.receiptId);
    if (!outcome || outcomeIds.has(outcome.eventId) || outcome.planId !== receipt.planId
        || outcome.commandId !== receipt.commandId || outcome.correlationId !== receipt.correlationId
        || outcome.actorId !== receipt.actorId || outcome.recordedAt !== receipt.recordedAt
        || outcome.effectiveDate !== receipt.effectiveDate
        || contracts.canonicalJson(outcome.amount) !== contracts.canonicalJson(receipt.amount)
        || (outcome.type === 'RETAIL_RECEIPT'
          ? contracts.canonicalJson(outcome.allocations) !== contracts.canonicalJson(receipt.allocations)
          : outcome.originalReceiptId !== receipt.originalReceiptId || outcome.reason !== receipt.reason)) return failure('INTEGRITY_CONFLICT');
    outcomeIds.add(outcome.eventId);
  }
  const delayedInstallments = new Set<string>();
  for (const event of source.events) {
    if (event.type !== 'RETAIL_PAYMENT_DELAYED') continue;
    const plan = source.planHistory.find(item => item.planId === event.planId);
    const installment = plan?.installments.find(item => item.installmentId === event.installmentId);
    const key = `${event.planId}:${event.installmentId}`;
    if (!plan || !installment || delayedInstallments.has(key) || event.actorId !== source.partnerSellerId
        || event.effectiveDate < plan.effectiveDate || event.effectiveDate <= installment.dueDate) return failure('INTEGRITY_CONFLICT');
    delayedInstallments.add(key);
  }
  const allocations = effectiveAllocations(source);
  if (!allocations.ok) return allocations;
  const installments = new Map(source.planHistory.flatMap(plan => plan.installments).map(item => [item.installmentId, item]));
  if ([...allocations.value].some(([installmentId, amount]) => !installments.has(installmentId)
    || subtract(installments.get(installmentId)!.amount.amount, amount).startsWith('-'))) return failure('INTEGRITY_CONFLICT');
  for (const plan of source.planHistory) {
    const receiptsBefore = source.receipts.filter(item => item.effectiveDate < plan.effectiveDate);
    const collectedBefore = subtract(sum(receiptsBefore.filter(item => item.kind === 'RECEIPT').map(item => item.amount.amount)),
      sum(receiptsBefore.filter(item => item.kind === 'REVERSAL').map(item => item.amount.amount)));
    const scheduled = sum(plan.installments.map(item => item.amount.amount));
    if (subtract(source.retailPayable.amount, collectedBefore) !== scheduled) return failure('INTEGRITY_CONFLICT');
  }
  const receivedTotal = sum(received);
  const reversedTotal = sum(reversed);
  const netCollected = subtract(receivedTotal, reversedTotal);
  const balance = subtract(source.retailPayable.amount, netCollected);
  const status: CollectionStatus = balance.startsWith('-') ? 'OVERPAID' : balance === '0' ? 'SETTLED' : netCollected === '0' ? 'UNPAID' : 'PARTIAL';
  return { ok: true, value: { owner: source.owner,
    customerPaymentPlan: source.customerPaymentPlan, planHistory: source.planHistory, receipts: source.receipts,
    delays: source.events.filter((event): event is Extract<typeof event, { type: 'RETAIL_PAYMENT_DELAYED' }> => event.type === 'RETAIL_PAYMENT_DELAYED')
      .map(event => ({ eventId: event.eventId, planId: event.planId, installmentId: event.installmentId, effectiveDate: event.effectiveDate })),
    summary: { currency: source.retailPayable.currency, retailPayable: source.retailPayable.amount,
      received: receivedTotal, reversed: reversedTotal, netCollected, balance, status } } };
}

function effectiveAllocations(source: RetailCollectionSource): Result<Map<string, string>> {
  const totals = new Map<string, string>();
  const reversals = new Map<string, string>();
  for (const row of source.receipts) {
    if (row.kind !== 'REVERSAL' || !row.originalReceiptId) continue;
    reversals.set(row.originalReceiptId, sum([reversals.get(row.originalReceiptId) || '0', row.amount.amount]));
  }
  for (const receipt of source.receipts) {
    if (receipt.kind !== 'RECEIPT') continue;
    const reversed = reversals.get(receipt.receiptId) || '0';
    if (reversed !== '0' && subtract(receipt.amount.amount, reversed) !== '0') return failure('INTEGRITY_CONFLICT');
    if (reversed !== '0') continue;
    if (!receipt.allocations.length || sum(receipt.allocations.map(item => item.amount)) !== receipt.amount.amount) return failure('INTEGRITY_CONFLICT');
    for (const allocation of receipt.allocations) {
      totals.set(allocation.installmentId, sum([totals.get(allocation.installmentId) || '0', allocation.amount]));
    }
  }
  return { ok: true, value: totals };
}

function receiptIntent(command: RetailCommand) {
  if (command.type === 'RETAIL_RECEIPT') return { type: command.type, expected: command.expected, expectedState: command.expectedState, planId: command.planId,
    receiptId: command.receiptId, amount: command.amount, effectiveDate: command.effectiveDate, allocations: command.allocations };
  return { type: command.type, expected: command.expected, expectedState: command.expectedState, receiptId: command.receiptId,
    effectiveDate: command.effectiveDate, reason: command.reason };
}

async function loadMutableSource(tx: RetailCollectionTransaction, expected: RevisionRef, expectedState: 'COMMITTED') {
  const loaded = await tx.readAuthorizedSource(expected, 'API');
  if (!loaded.ok) return loaded;
  const validated = validateSource(loaded.value, expected, 'API');
  if (!validated.ok) return validated;
  const evidence = project(validated.value);
  if (!evidence.ok) return evidence;
  if (validated.value.state !== expectedState || validated.value.permission.partnerStatus !== 'ACTIVE') return failure('STATE_CONFLICT');
  return { ok: true as const, value: validated.value };
}

async function replayCommand(tx: RetailCollectionTransaction, commandId: string,
  idempotency: RetailCollectionCommandReceipt['idempotency'], intentHash: string): Promise<Result<RetailCollectionCommandReceipt | null>> {
  const replay = await tx.readCommand(commandId, idempotency);
  if (replay && (replay.intentHash !== intentHash || contracts.compareIdempotency(replay.idempotency, idempotency) !== 'REPLAY')) {
    return failure('IDEMPOTENCY_CONFLICT');
  }
  return { ok: true, value: replay };
}

export function createPartnerRetailCollectionsService(repository: RetailCollectionRepository) {
  const read = (expected: RevisionRef, channel: 'DETAIL' | 'EXPORT' = 'DETAIL') => repository.transaction(async tx => {
    if (!contracts.RevisionRefSchema.safeParse(expected).success) return failure('INVALID_PAYLOAD');
    const loaded = await tx.readAuthorizedSource(expected, channel);
    if (!loaded.ok) return loaded;
    const source = validateSource(loaded.value, expected, channel);
    return source.ok ? project(source.value) : source;
  });

  return {
    read,
    export: (expected: RevisionRef) => read(expected, 'EXPORT'),
    recordDelay: (input: RetailDelayRequest): Promise<Result<{ commandId: string; replayed: boolean; eventIds: readonly string[] }>> => repository.transaction(async tx => {
      const keys = ['commandId', 'correlationId', 'expected', 'installmentId', 'planId'];
      if (!input || typeof input !== 'object' || Object.keys(input).sort().join('|') !== keys.sort().join('|')
          || !contracts.IdSchema.safeParse(input.commandId).success || !contracts.IdSchema.safeParse(input.correlationId).success
          || !contracts.IdSchema.safeParse(input.planId).success || !contracts.IdSchema.safeParse(input.installmentId).success
          || !contracts.RevisionRefSchema.safeParse(input.expected).success) return failure('INVALID_PAYLOAD');
      const loaded = await loadMutableSource(tx, input.expected, 'COMMITTED');
      if (!loaded.ok) return loaded;
      const source = loaded.value;
      const intent = { type: 'RETAIL_PAYMENT_DELAYED' as const, expected: input.expected,
        planId: input.planId, installmentId: input.installmentId };
      const intentHash = await contracts.canonicalHash(intent);
      const idempotency = { actorId: source.permission.actorId, operation: intent.type, targetId: input.expected.caseId,
        key: `delay:${input.planId}:${input.installmentId}`, payloadHash: intentHash };
      const replay = await replayCommand(tx, input.commandId, idempotency, intentHash);
      if (!replay.ok) return replay;
      if (replay.value) {
        return { ok: true, value: { commandId: replay.value.commandId, replayed: true, eventIds: replay.value.eventIds } };
      }
      if (source.customerPaymentPlan.planId !== input.planId) return failure('STATE_CONFLICT');
      const installment = source.customerPaymentPlan.installments.find(item => item.installmentId === input.installmentId);
      if (!installment) return failure('NOT_FOUND');
      const allocated = effectiveAllocations(source);
      if (!allocated.ok) return allocated;
      const outstanding = subtract(installment.amount.amount, allocated.value.get(installment.installmentId) || '0');
      const recordedAt = await tx.now();
      if (!contracts.InstantSchema.safeParse(recordedAt).success) return failure('INTEGRITY_CONFLICT');
      const effectiveDate = recordedAt.slice(0, 10);
      if (installment.dueDate >= effectiveDate || outstanding === '0' || outstanding.startsWith('-')) return failure('STATE_CONFLICT');
      const existing = source.events.find(event => event.type === 'RETAIL_PAYMENT_DELAYED'
        && event.planId === input.planId && event.installmentId === input.installmentId);
      if (existing) return failure('STATE_CONFLICT');
      const eventId = `retail-delay:${input.planId}:${input.installmentId}`;
      const event = contracts.PartnerEventSchema.parse({ schemaVersion: 1, type: intent.type, eventId,
        commandId: input.commandId, correlationId: input.correlationId, actorId: source.permission.actorId,
        recordedAt, effectiveDate, owner: source.owner, planId: input.planId, installmentId: input.installmentId });
      const command: RetailCollectionCommandReceipt = { commandId: input.commandId, intentHash,
        idempotency, eventIds: [eventId] };
      const committed = await tx.appendDelayEvents({ expected: input.expected, events: [event], command });
      return committed.ok ? { ok: true, value: { commandId: committed.value.commandId, replayed: false,
        eventIds: committed.value.eventIds } } : committed;
    }),
    execute: (input: PartnerCommand): Promise<Result<{ commandId: string; replayed: boolean; eventIds: readonly string[] }>> => repository.transaction(async tx => {
      const parsed = contracts.PartnerCommandSchema.safeParse(input);
      if (!parsed.success || !['RETAIL_RECEIPT', 'RETAIL_RECEIPT_REVERSE'].includes(parsed.data.type)) return failure('INVALID_PAYLOAD');
      const command = parsed.data as RetailCommand;
      if (command.expectedState !== 'COMMITTED') return failure('STATE_CONFLICT');
      const loaded = await loadMutableSource(tx, command.expected, command.expectedState);
      if (!loaded.ok) return loaded;
      const source = loaded.value;
      if (command.idempotency.actorId !== source.permission.actorId) return failure('FORBIDDEN');
      const intentHash = await contracts.canonicalHash(receiptIntent(command));
      if (intentHash !== command.idempotency.payloadHash) return failure('INVALID_PAYLOAD');
      const replay = await replayCommand(tx, command.commandId, command.idempotency, intentHash);
      if (!replay.ok) return replay;
      if (replay.value) {
        return { ok: true, value: { commandId: replay.value.commandId, replayed: true, eventIds: replay.value.eventIds } };
      }
      const recordedAt = await tx.now();
      if (!contracts.InstantSchema.safeParse(recordedAt).success) return failure('INTEGRITY_CONFLICT');
      let receipt: RetailCollectionReceipt;
      let event: contracts.PartnerEvent;
      let eventId: string;
      if (command.type === 'RETAIL_RECEIPT') {
        if (source.receipts.some(item => item.receiptId === command.receiptId)) return failure('IDEMPOTENCY_CONFLICT');
        const plan = source.planHistory.find(item => item.planId === command.planId);
        const installments = new Map(plan?.installments.map(item => [item.installmentId, item]));
        const allocated = effectiveAllocations(source);
        if (!allocated.ok) return allocated;
        if (!plan || command.amount.amount === '0' || command.amount.currency !== source.retailPayable.currency || !command.allocations.length
            || new Set(command.allocations.map(item => item.installmentId)).size !== command.allocations.length
            || command.allocations.some(item => item.amount === '0' || !installments.has(item.installmentId))
            || sum(command.allocations.map(item => item.amount)) !== command.amount.amount) return failure('INVALID_PAYLOAD');
        if (command.allocations.some(item => subtract(installments.get(item.installmentId)!.amount.amount,
          sum([allocated.value.get(item.installmentId) || '0', item.amount])).startsWith('-'))) return failure('STATE_CONFLICT');
        receipt = { receiptId: command.receiptId, planId: command.planId, kind: 'RECEIPT',
          amount: command.amount, effectiveDate: command.effectiveDate, recordedAt, actorId: source.permission.actorId,
          commandId: command.commandId, correlationId: command.correlationId, allocations: command.allocations };
        eventId = `retail-event:${command.receiptId}`;
        event = contracts.PartnerEventSchema.parse({ schemaVersion: 1, type: 'RETAIL_RECEIPT', eventId,
          commandId: command.commandId, correlationId: command.correlationId, actorId: source.permission.actorId,
          recordedAt, effectiveDate: command.effectiveDate, owner: source.owner, planId: command.planId,
          receiptId: command.receiptId, amount: command.amount, allocations: command.allocations });
      } else {
        const original = source.receipts.find(item => item.kind === 'RECEIPT' && item.receiptId === command.receiptId);
        if (!original) return failure('NOT_FOUND');
        const alreadyReversed = sum(source.receipts.filter(item => item.kind === 'REVERSAL' && item.originalReceiptId === original.receiptId)
          .map(item => item.amount.amount));
        const remaining = subtract(original.amount.amount, alreadyReversed);
        if (remaining === '0' || remaining.startsWith('-')) return failure('STATE_CONFLICT');
        const reversalId = `retail-reversal:${command.commandId}`;
        receipt = { receiptId: reversalId, planId: original.planId, kind: 'REVERSAL', originalReceiptId: original.receiptId,
          amount: { amount: remaining, currency: original.amount.currency }, effectiveDate: command.effectiveDate,
          recordedAt, actorId: source.permission.actorId, commandId: command.commandId, correlationId: command.correlationId,
          reason: command.reason, allocations: [] };
        eventId = `retail-event:${reversalId}`;
        event = contracts.PartnerEventSchema.parse({ schemaVersion: 1, type: 'RETAIL_RECEIPT_REVERSED', eventId,
          commandId: command.commandId, correlationId: command.correlationId, actorId: source.permission.actorId,
          recordedAt, effectiveDate: command.effectiveDate, owner: source.owner, planId: original.planId,
          originalReceiptId: original.receiptId, reversalId, amount: receipt.amount, reason: command.reason });
      }
      const commandReceipt: RetailCollectionCommandReceipt = { commandId: command.commandId, intentHash,
        idempotency: command.idempotency, eventIds: [eventId] };
      const prospective = project({ ...source, receipts: [...source.receipts, receipt], events: [...source.events, event] });
      if (!prospective.ok) return failure('STATE_CONFLICT');
      const committed = await tx.appendReceipt({ expected: command.expected, receipt, event, command: commandReceipt });
      return committed.ok ? { ok: true, value: { commandId: committed.value.commandId, replayed: false, eventIds: committed.value.eventIds } } : committed;
    }),
  };
}
