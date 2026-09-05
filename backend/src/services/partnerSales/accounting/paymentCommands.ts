import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type CheckAccountingStatus } from '@prisma/client';
import { InstantSchema, MoneySchema, PartnerEventSchema, SabalanInternalRecordViewSchema, canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import { readPersistedPartnerEvents } from '../events/persisted';
import { subtract, sum, negate } from '../reporting/money';
import { latestPartnerFinancialApproval, readPartnerOfficialPurchase } from './officialPurchase';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE, matchesFinancialPreparation, prepareCommittedAccountingSource } from './source';
import { PartnerAccountingCommandError, PartnerAccountingTechnicalError } from './errors';
import { partnerCheckTransitions } from './paymentPolicy';
import { readPartnerAccountingCapabilities } from './capabilities';
import { hasPartnerAccountingEvidence } from './provenance';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { readPartnerInvoiceSource } from './invoiceSource';

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const invalid = () => new PartnerAccountingCommandError('INVALID_PAYLOAD', 'اطلاعات دریافت معتبر نیست؛ مبلغ، تاریخ و روش پرداخت را بررسی کنید.');
const conflict = () => new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'شواهد حساب همکار سازگار نیست؛ رسیدگی حسابداری پرونده لازم است.');

type CollectionCommand = {
  kind: string; receivableId?: string; paymentEventId?: string; contractId?: string;
  idempotencyKey?: string; correlationId?: string; amount?: string | number; method?: string;
  receivedAt?: string; occurredAt?: string; status?: string; note?: string; reason?: string;
  check?: { checkNumber?: string; ownerName?: string; dueDate?: string; handoverDate?: string; nationalCode?: string };
};

function effectiveInstant(value: string | undefined, now: Date): Date {
  if (!value) return now;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00.000Z` : value;
  if (!InstantSchema.safeParse(iso).success) throw invalid();
  const result = new Date(iso);
  if (result > now) throw invalid();
  return result;
}

/** The existing Accounting command boundary dispatches here only for its explicit
 * Partner receivable source. It writes the same receipt, cheque, receivable and
 * audit ledgers as ordinary Accounting; never a retail contract or shadow debt.
 * The Case lock serializes payment, correction and void effects. */
export async function executePartnerCollectionAction(database: PrismaClient, command: CollectionCommand,
  actor: { userId: string }): Promise<{ paymentEventId: string; replay: boolean } | null> {
  if (!['REGISTER_RECEIPT', 'UPDATE_CHECK_STATUS', 'REVERSE_RECEIPT'].includes(command.kind)) return null;
  let partnerTarget = false;
  const result = await database.$transaction(async tx => {
    if (command.kind === 'REGISTER_RECEIPT' && command.paymentEventId) throw invalid();
    const targetPayment = command.paymentEventId
      ? await tx.accountingPaymentStatus.findUnique({ where: { id: command.paymentEventId } }) : null;
    if (targetPayment && command.receivableId && targetPayment.receivableId !== command.receivableId) throw conflict();
    // A payment's persisted owner wins over every caller-supplied hint. A
    // contradictory hint must never route a Partner payment into legacy code.
    const receivableId = targetPayment?.receivableId || command.receivableId;
    const target = receivableId ? await tx.accountingReceivable.findUnique({ where: { id: receivableId },
      include: { invoiceRecord: true } }) : null;
    if (target?.invoiceRecord?.sourceKind !== PARTNER_INTERNAL_ACCOUNTING_SOURCE) {
      if (hasPartnerAccountingEvidence([targetPayment?.metadata, target?.metadata,
        target?.invoiceRecord?.metadata, target?.invoiceRecord?.sourceSnapshot])) throw conflict();
      return null;
    }
    partnerTarget = true;
    if (command.receivableId && command.receivableId !== target.id) throw conflict();
    const caseId = object(target.invoiceRecord.metadata)?.partnerCaseId;
    if (typeof caseId !== 'string' || !command.idempotencyKey?.trim() || command.idempotencyKey.length > 200 ||
        !command.correlationId?.trim() || command.correlationId.length > 200) throw invalid();
    await lockPartnerOperationsControl(tx);
    await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${caseId} FOR UPDATE`;
    const allowed = await createAuditedPartnerAuthorization(tx, { actorId: actor.userId, purpose: 'ACCOUNTING', channel: 'API' },
      { correlationId: command.correlationId, reason: command.reason || command.note })
      .authorize('ACCOUNTING_WRITE', { kind: 'CASE', id: caseId });
    // Return denial before any business mutation so its central decision audit survives.
    if (!allowed.ok || !(await readPartnerAccountingCapabilities(tx, actor.userId)).payments) return { denied: true as const };
    const currentInvoice = await tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: target.invoiceRecord.id } });
    await readPartnerInvoiceSource(tx, currentInvoice, caseId);
    const identity = { actorId: actor.userId, operation: `ACCOUNTING_${command.kind}`, targetScope: caseId, key: command.idempotencyKey };
    const { correlationId: _correlationId, ...payload } = command;
    const payloadHash = await canonicalHash(payload);
    const previous = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
    if (previous) {
      if (previous.payloadHash !== payloadHash) throw new PartnerAccountingCommandError('IDEMPOTENCY_CONFLICT', 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است؛ صفحه را تازه کنید.');
      const paymentEventId = object(previous.outcome)?.paymentEventId;
      if (typeof paymentEventId !== 'string') throw conflict();
      return { paymentEventId, replay: true };
    }
    const row = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId }, include: {
      head: true, profile: { select: { userId: true } }, events: { orderBy: { sequence: 'asc' } } } });
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    const events = readPersistedPartnerEvents(row, row.events);
    const approval = latestPartnerFinancialApproval(events);
    const purchase = await readPartnerOfficialPurchase(tx, { internalRecordId: row.internalRecordId!, approval,
      cutoff: clock.now, asOf: clock.now, voided: row.state === 'VOIDED' });
    const receivable = await tx.accountingReceivable.findUniqueOrThrow({ where: { id: target.id }, include: { invoiceRecord: true } });
    const official = purchase.official;
    const view = SabalanInternalRecordViewSchema.safeParse(object(row.head.internalProjection)?.accounting);
    const commitment = events.find(event => event.type === 'CASE_COMMITTED');
    if (!view.success || !commitment || commitment.type !== 'CASE_COMMITTED' || row.state !== 'COMMITTED' ||
        !purchase.covered || !official || official.receivable.id !== receivable.id || command.contractId ||
        view.data.owner.revision !== row.headRevision || view.data.owner.integrityHash !== row.integrityHash ||
        receivable.status === 'VOIDED' || !['ISSUED', 'POSTED'].includes(receivable.invoiceRecord!.status)) throw conflict();
    const prepared = await prepareCommittedAccountingSource({ view: { ...view.data, state: row.state },
      partnerSellerId: row.profile.userId, commitment }, { caseId, revision: row.headRevision, integrityHash: row.integrityHash });
    if (!prepared.ok || !matchesFinancialPreparation(prepared.value, official.invoice.preparation) ||
        official.receivable.partnerSellerId !== row.profile.userId ||
        official.receivable.commercialAccountId !== prepared.value.debtor.commercialAccountId ||
        subtract(receivable.paidAmount.toString(), official.received.amount) !== '0' ||
        subtract(receivable.remainingAmount.toString(), official.balance.amount) !== '0') throw conflict();
    const occurredAt = effectiveInstant(command.receivedAt || command.occurredAt, clock.now);
    const movement = (kind: string, amount: string) => ({ kind, amount, effectiveAt: occurredAt.toISOString(),
      recordedAt: clock.now.toISOString(), confidence: 'authoritative' });
    let delta = '0';
    let before: Awaited<ReturnType<typeof tx.accountingPaymentStatus.findUnique>> = null;
    let payment;
    if (command.kind === 'REGISTER_RECEIPT') {
      if (await partnerPredecessorIsFrozen(tx, caseId, row.headRevision)) {
        throw new PartnerAccountingCommandError('INTEGRITY_CONFLICT', 'دریافت جدید تا تعیین تکلیف اصلاح پرونده همکار متوقف است؛ تعیین وضعیت دریافت‌های قبلی همچنان ممکن است.');
      }
      if (typeof command.amount !== 'string' || !MoneySchema.safeParse({ amount: command.amount, currency: receivable.currency }).success ||
          !['CASH', 'BANK_TRANSFER', 'CHECK'].includes(command.method || '')) throw invalid();
      const amount = sum([command.amount]);
      // The existing official ledger is Decimal(18,2). Reject loss instead of silently rounding.
      if (amount === '0' || amount.split('.')[0].length > 16 || (amount.split('.')[1]?.length ?? 0) > 2 ||
          subtract(receivable.remainingAmount.toString(), amount).startsWith('-')) throw invalid();
      const method = command.method as 'CASH' | 'BANK_TRANSFER' | 'CHECK';
      const checkDueInstant = command.check?.dueDate && (/^\d{4}-\d{2}-\d{2}$/.test(command.check.dueDate)
        ? `${command.check.dueDate}T00:00:00.000Z` : command.check.dueDate);
      if (method === 'CHECK' && (!command.check?.checkNumber?.trim() || !command.check.ownerName?.trim() ||
          !InstantSchema.safeParse(checkDueInstant).success)) throw invalid();
      delta = method === 'CHECK' ? '0' : amount;
      payment = await tx.accountingPaymentStatus.create({ data: { receivableId: receivable.id, method, amount,
        currency: receivable.currency, status: 'RECEIVED', checkStatus: method === 'CHECK' ? 'RECEIVED' : null,
        checkNumber: command.check?.checkNumber, checkOwnerName: command.check?.ownerName,
        checkDueDate: checkDueInstant ? new Date(checkDueInstant) : null,
        handoverDate: command.check?.handoverDate ? effectiveInstant(command.check.handoverDate, clock.now) : null,
        occurredAt, notes: command.note, createdBy: actor.userId,
        metadata: json({ partnerCaseId: caseId, owner: official.receivable.owner,
          nationalCode: command.check?.nationalCode, collectionMovements: delta === '0' ? [] : [movement('RECEIVED', delta)] }) } });
    } else {
      before = command.paymentEventId ? await tx.accountingPaymentStatus.findUnique({ where: { id: command.paymentEventId } }) : null;
      if (!before || before.receivableId !== receivable.id || before.contractId || before.currency !== receivable.currency) throw conflict();
      const metadata = object(before.metadata);
      if (!Array.isArray(metadata?.collectionMovements)) throw conflict();
      const movements = [...metadata.collectionMovements];
      const realized = sum(movements.map(item => String(object(item)?.amount)));
      if (occurredAt < (before.occurredAt || before.createdAt)) throw invalid();
      let status = before.status, checkStatus = before.checkStatus;
      if (command.kind === 'UPDATE_CHECK_STATUS') {
        const next = command.status as CheckAccountingStatus;
        if (before.method !== 'CHECK' || !checkStatus || !partnerCheckTransitions[checkStatus]?.includes(next)) throw invalid();
        checkStatus = next;
        if (next === 'CLEARED') delta = subtract(before.amount.toString(), realized);
        if (['BOUNCED', 'RETURNED'].includes(next)) delta = negate(realized);
        if (sum([delta]) !== '0') movements.push(movement(`CHECK_${next}`, delta));
        status = next === 'CLEARED' ? 'RECONCILED' : 'RECEIVED';
      } else {
        if (before.method === 'CHECK' || !command.reason?.trim() || before.status === 'REVERSED') throw invalid();
        delta = negate(realized);
        if (sum([delta]) === '0') throw conflict();
        movements.push(movement('REVERSED', delta));
        status = 'REVERSED';
      }
      payment = await tx.accountingPaymentStatus.update({ where: { id: before.id }, data: {
        status, checkStatus, occurredAt, notes: command.note || command.reason || before.notes,
        metadata: json({ ...metadata, collectionMovements: movements }) } });
    }
    const paidAmount = sum([receivable.paidAmount.toString(), delta]);
    const remainingAmount = subtract(receivable.originalAmount.toString(), paidAmount);
    if (paidAmount.startsWith('-') || remainingAmount.startsWith('-')) throw invalid();
    await tx.accountingReceivable.update({ where: { id: receivable.id }, data: { paidAmount, remainingAmount,
      status: remainingAmount === '0' ? 'SETTLED' : paidAmount !== '0' ? 'PARTIALLY_PAID' : 'OPEN' } });
    if (sum([delta]) !== '0' && !delta.startsWith('-')) {
      const event = PartnerEventSchema.parse({ schemaVersion: 1, type: 'SABALAN_RECEIPT', eventId: randomUUID(),
        commandId: command.idempotencyKey, correlationId: command.correlationId, actorId: actor.userId,
        recordedAt: clock.now.toISOString(), effectiveDate: occurredAt.toISOString().slice(0, 10),
        owner: official.receivable.owner, internalRecordId: row.internalRecordId,
        accountingReceiptId: payment.id, amount: { amount: delta, currency: receivable.currency } });
      const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId }, _max: { sequence: true } });
      await tx.partnerCaseEvent.create({ data: { id: event.eventId, caseId, caseRevision: event.owner.revision,
        integrityHash: event.owner.integrityHash, sequence: (maximum._max.sequence ?? 0) + 1, type: event.type,
        actorId: event.actorId, commandId: event.commandId, correlationId: event.correlationId,
        effectiveDate: new Date(`${event.effectiveDate}T00:00:00.000Z`), evidence: json({ publicEvent: event }) } });
    }
    await tx.accountingAuditLog.create({ data: { action: command.kind, actorId: actor.userId,
      entityType: 'AccountingPaymentStatus', entityId: payment.id,
      ...(before ? { beforeState: json(before) } : {}), afterState: json(payment), note: command.note || command.reason } });
    const outcome = { paymentEventId: payment.id, replay: false };
    await tx.partnerCommandOutcome.create({ data: { id: `partner-accounting:${(await canonicalHash(identity)).slice(10)}`,
      ...identity, payloadHash, outcome } });
    return outcome;
  }, { timeout: 15_000 }).catch(error => {
    if (!partnerTarget || error instanceof PartnerAccountingCommandError) throw error;
    throw new PartnerAccountingTechnicalError(error);
  });
  if (result && 'denied' in result) throw new PartnerAccountingCommandError('FORBIDDEN', 'اجازه ثبت یا تغییر دریافت این پرونده همکار را ندارید؛ مدیر حسابداری باید مجوز پرونده را بررسی کند.');
  return result;
}
