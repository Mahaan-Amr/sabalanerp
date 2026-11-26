import { Prisma, type PrismaClient } from '@prisma/client';
import { hashAccountingEvidence, type AccountingActor } from './accountingLedgerFoundation';
import { previewSepidarOpeningCheques, type SepidarOpeningChequeEvidence } from './sepidarOpeningChequePlan';

type Plan = ReturnType<typeof previewSepidarOpeningCheques>;
type Cheque = Plan['instruments'][number];
type Code = 'ADMISSION_CLOSED' | 'UNSUPPORTED_POSTING_OWNER' | 'INVALID_TARGET' | 'OPENING_AMOUNT_CONFLICT'
  | 'IDENTITY_CONFLICT' | 'REPLAY_CONFLICT';

export class SepidarOpeningChequeApplicationError extends Error {
  constructor(readonly code: Code) {
    super(code);
  }
}

function requireValid(condition: unknown, code: Code): asserts condition {
  if (!condition) throw new SepidarOpeningChequeApplicationError(code);
}

function eventEvidence(plan: Plan, cheque: Cheque, event: Cheque['events'][number]) {
  const reference = event.targetPosting.reference;
  return {
    snapshotSha256: plan.snapshotSha256,
    sourceInstrumentId: cheque.instrument.id,
    historyId: event.historyId,
    previousHistoryId: event.previousHistoryId,
    document: event.document,
    allocations: event.targetPosting.lines.map(line => ({
      sourceLineId: line.sourceLineId,
      targetAccountId: line.targetAccountId,
      signedRials: line.signedRials.toString(),
      ...(line.tracking ? { tracking: line.tracking } : {}),
    })),
    ...(reference.kind === 'CUSTOMER' ? { customerPartyId: reference.targetId } : { bankFinancialAccountId: reference.targetId }),
  };
}

function instrumentEvents(plan: Plan, cheque: Cheque, actorId: string, tillId: string) {
  const sourceInstrumentId = cheque.instrument.id;
  const identity = hashAccountingEvidence({ bookId: plan.bookId, sourceInstrumentId });
  const makeEvent = (sequence: number, eventType: string, occurredAt: string, evidence: Prisma.InputJsonValue,
    fromCustodianId: string | null, toCustodianId: string | null, ledgerVoucherId: string | null) => ({
    sequence, eventType, occurredAt: new Date(occurredAt), evidence, actorId, fromCustodianId, toCustodianId, ledgerVoucherId,
    evidenceHash: hashAccountingEvidence(evidence),
    idempotencyKey: 'sepidar-opening-cheque:' + identity + ':' + sequence,
  });
  const opening = makeEvent(1, 'RECEIVED', plan.basisAt, {
    snapshotSha256: plan.snapshotSha256,
    sourceInstrumentId,
    historyId: cheque.opening.historyId,
    originalReceiptHeaderId: cheque.instrument.sourceReceiptHeaderId,
    openingSourceLineId: cheque.opening.sourceLineId,
    openingLedgerLineId: cheque.opening.targetLineId,
    amountRials: cheque.opening.amountRials.toString(),
  }, null, tillId, null);
  const later = cheque.events.map(event => {
    const evidence = eventEvidence(plan, cheque, event);
    if (event.eventType === 'RETURNED') {
      return makeEvent(event.sequence, event.eventType, event.occurredAt, evidence, tillId, null, event.targetPosting.voucherId);
    }
    const bank = event.targetPosting.reference.targetId;
    const deposited = event.eventType === 'DEPOSITED';
    return makeEvent(event.sequence, event.eventType, event.occurredAt, evidence,
      deposited ? tillId : bank, deposited ? bank : null, event.targetPosting.voucherId);
  });
  return [opening, ...later];
}

function activeAt(record: { activeFrom: Date; activeTo: Date | null }, at: string) {
  const date = new Date(at);
  return record.activeFrom <= date && (record.activeTo === null || record.activeTo >= date);
}

const postedReversals = { where: { status: 'POSTED' }, select: { id: true }, take: 1 } as const;

function matchesVoucher(voucher: { bookId: string; status: string; documentDate: Date; occurredAt: Date;
  reversalOfId: string | null; reversals: readonly { id: string }[] },
  bookId: string, at: string) {
  return voucher.status === 'POSTED' && voucher.bookId === bookId && voucher.reversalOfId === null && voucher.reversals.length === 0
    && voucher.documentDate.toISOString() === at && voucher.occurredAt.toISOString() === at;
}

async function verifyTargets(tx: Prisma.TransactionClient, plan: Plan, evidence: SepidarOpeningChequeEvidence,
  legalEntityId: string, tillId: string) {
  const till = await tx.accountingFinancialAccount.findUnique({ where: { id: tillId } });
  requireValid(till && till.kind === 'CASH' && till.legalEntityId === legalEntityId && till.currency === 'IRR'
    && activeAt(till, plan.basisAt), 'INVALID_TARGET');
  const opening = await tx.accountingLedgerVoucher.findUnique({ where: { id: plan.openingVoucherId },
    include: { lines: { include: { dimensions: true } }, reversals: postedReversals } });
  requireValid(opening && matchesVoucher(opening, plan.bookId, plan.basisAt) && opening.sourceType === 'SEPIDAR_CHEQUE_OPENING'
    && opening.sourceId === plan.sourceOpeningVoucherId && opening.sourceVersion === 1
    && opening.sourceHash === hashAccountingEvidence({ snapshotSha256: plan.snapshotSha256,
      sourceOpeningVoucherId: plan.sourceOpeningVoucherId, basisAt: plan.basisAt }), 'INVALID_TARGET');
  const basisAmounts = new Map(evidence.openingLines.map(line => [line.id, line.amountRials]));
  const existing = await tx.accountingSepidarOpeningCheque.findMany({
    where: { openingLedgerLineId: { in: plan.instruments.map(cheque => cheque.opening.targetLineId) } },
  });
  const sourceIds = new Set(plan.instruments.map(cheque => cheque.instrument.id));
  requireValid(existing.every(anchor => anchor.bookId === plan.bookId && sourceIds.has(anchor.sourceInstrumentId)),
    'OPENING_AMOUNT_CONFLICT');

  const sourceAccounts = new Map(evidence.ledgerLines.map(line => [line.id, line.accountId]));
  for (const cheque of plan.instruments) {
    const { profileId, partyId } = cheque.instrument.target;
    const profile = await tx.accountingCustomerProfile.findUnique({ where: { id: profileId } });
    requireValid(profile && profile.accountingPartyId === partyId && profile.legalEntityId === legalEntityId
      && activeAt(profile, plan.basisAt), 'INVALID_TARGET');
    const basisLine = opening.lines.find(line => line.id === cheque.opening.targetLineId);
    requireValid(basisLine && basisLine.partyId === partyId && basisLine.accountId === cheque.opening.targetAccountId
      && basisLine.financialAccountId === null && basisLine.dimensions.length === 0 && BigInt(basisLine.creditRials.toString()) === 0n
      && BigInt(basisLine.debitRials.toString()) === basisAmounts.get(cheque.opening.sourceLineId), 'OPENING_AMOUNT_CONFLICT');

    for (const event of cheque.events) {
      const { voucherId, reference, lines } = event.targetPosting;
      const returned = event.eventType === 'RETURNED';
      if (returned) {
        requireValid(reference.kind === 'CUSTOMER' && reference.targetId === partyId && activeAt(profile, event.occurredAt), 'INVALID_TARGET');
      } else {
        const bank = await tx.accountingFinancialAccount.findUnique({ where: { id: reference.targetId } });
        requireValid(bank && bank.kind === 'BANK' && bank.legalEntityId === legalEntityId && bank.currency === 'IRR'
          && activeAt(bank, event.occurredAt), 'INVALID_TARGET');
      }
      const voucher = await tx.accountingLedgerVoucher.findUnique({ where: { id: voucherId }, include: {
        lines: { include: { dimensions: true, account: { select: { code: true, bookId: true } } } }, reversals: postedReversals,
      } });
      requireValid(voucher && matchesVoucher(voucher, plan.bookId, event.occurredAt)
        && voucher.sourceType === 'SEPIDAR_CHEQUE_EVENT' && voucher.sourceId === event.historyId && voucher.sourceVersion === 1
        && voucher.sourceHash === hashAccountingEvidence(eventEvidence(plan, cheque, event))
        && voucher.lines.length === lines.length, 'INVALID_TARGET');

      const voucherLines = new Map(voucher.lines.map(line => [line.id, line]));
      for (const allocation of lines) {
        const line = voucherLines.get(allocation.targetLineId);
        const isBank = sourceAccounts.get(allocation.sourceLineId) === 105;
        requireValid(line && line.accountId === allocation.targetAccountId && line.dimensions.length === 0
          && line.partyId === (isBank ? null : partyId) && line.financialAccountId === (isBank ? reference.targetId : null)
          && BigInt(line.debitRials.toString()) === (allocation.signedRials > 0n ? allocation.signedRials : 0n)
          && BigInt(line.creditRials.toString()) === (allocation.signedRials < 0n ? -allocation.signedRials : 0n), 'INVALID_TARGET');
        if (returned) {
          requireValid(line.account.bookId === plan.bookId
            && line.account.code === (allocation.signedRials > 0n ? '111201' : '111202'), 'INVALID_TARGET');
        }
        if (allocation.tracking) {
          const payload = { snapshotSha256: plan.snapshotSha256, row: {
            VoucherItemId: allocation.sourceLineId, VoucherRef: event.document.voucherId, ...allocation.tracking,
          } };
          const expectedHash = hashAccountingEvidence(payload);
          requireValid(line.evidenceType === 'SEPIDAR_ACC_VOUCHER_ITEM' && line.evidenceHash === expectedHash
            && hashAccountingEvidence(line.evidencePayload) === expectedHash, 'INVALID_TARGET');
        }
      }
    }
  }
}

async function recordInstrument(tx: Prisma.TransactionClient, plan: Plan, cheque: Cheque, legalEntityId: string,
  actorId: string, planSha256: string, tillId: string) {
  const { id: sourceInstrumentId, target, sayadId, serialNumber, bankName, amountRials, maturityAt } = cheque.instrument;
  const key = { bookId: plan.bookId, sourceInstrumentId };
  const events = instrumentEvents(plan, cheque, actorId, tillId);
  const instrument = {
    legalEntityId, profileId: target.profileId, direction: 'RECEIVABLE', sayadId, serialNumber, bankName,
    amountRials: amountRials.toString(), dueAt: new Date(maturityAt), status: cheque.finalStatus,
    clearedRials: cheque.clearedRials.toString(), unpaidRials: '0', custodianId: null, createdBy: actorId,
    evidenceHash: events[0].evidenceHash,
  };
  const opening = {
    ...key, sourceOpeningLineId: cheque.opening.sourceLineId, openingLedgerLineId: cheque.opening.targetLineId,
    amountRials: amountRials.toString(), snapshotSha256: plan.snapshotSha256, planSha256,
  };
  const prior = await tx.accountingSepidarOpeningCheque.findUnique({
    where: { bookId_sourceInstrumentId: key },
    include: { instrument: { include: { events: { orderBy: { sequence: 'asc' } }, receipt: { select: { id: true } } } } },
  });
  if (prior) {
    const loaded = prior.instrument;
    const instrumentMatches = Object.entries(instrument).every(([name, expected]) =>
      loaded[name as keyof typeof instrument]?.toString() === expected?.toString());
    const eventsMatch = loaded.events.length === events.length && events.every((expected, index) => {
      const actual = loaded.events[index];
      return actual.postingRuleVersion === null && Object.entries(expected).every(([field, value]) =>
        hashAccountingEvidence(actual[field as keyof typeof expected]) === hashAccountingEvidence(value));
    });
    requireValid(instrumentMatches && eventsMatch && !loaded.receipt && prior.openingEventId === loaded.events[0]?.id
      && Object.entries(opening).every(([name, expected]) => prior[name as keyof typeof opening].toString() === expected),
    'REPLAY_CONFLICT');
    return { instrumentId: prior.instrumentId, replayed: true };
  }

  const duplicate = await tx.accountingCheckInstrument.findFirst({
    where: { legalEntityId, OR: [
      ...(sayadId ? [{ sayadId }] : []),
      { profileId: target.profileId, serialNumber, bankName, dueAt: instrument.dueAt, amountRials: instrument.amountRials },
    ] },
    select: { id: true },
  });
  requireValid(!duplicate, 'IDENTITY_CONFLICT');
  const created = await tx.accountingCheckInstrument.create({
    data: { ...instrument, events: { create: events } },
    include: { events: { where: { sequence: 1 }, select: { id: true } } },
  });
  await tx.accountingSepidarOpeningCheque.create({
    data: { ...opening, instrumentId: created.id, openingEventId: created.events[0].id },
  });
  return { instrumentId: created.id, replayed: false };
}

type ApplyOpeningHistoriesInput = {
  evidence: SepidarOpeningChequeEvidence; custodyFinancialAccountId: string; actor: AccountingActor;
};

async function applyOpeningHistories(database: Pick<PrismaClient, '$transaction'>, input: ApplyOpeningHistoriesInput,
  lane: 'BANK' | 'BANK_AND_CUSTOMER_RETURN') {
  const releaseId = process.env.DEPLOYMENT_RELEASE_ID;
  requireValid(releaseId && input.actor.id.trim() && input.actor.profile === 'ACCOUNTANT', 'ADMISSION_CLOSED');
  const { custodyFinancialAccountId } = input;
  const actorId = input.actor.id;
  const evidence = structuredClone(input.evidence);
  const plan = previewSepidarOpeningCheques(evidence);
  const planSha256 = hashAccountingEvidence({ plan, custodyFinancialAccountId, ...(lane === 'BANK' ? {} : { lane }) });
  return database.$transaction(async tx => {
    const admission = await tx.$queryRaw<Array<{ admitted: boolean }>>`
      SELECT public.sepidar_opening_cheques_runtime_admitted(
        ${releaseId}, ${plan.bookId}, ${actorId}, ${planSha256}
      ) AS admitted`.catch(() => []);
    requireValid(admission[0]?.admitted === true, 'ADMISSION_CLOSED');
    requireValid(plan.instruments.every(cheque => {
      if (cheque.finalStatus === 'RETURNED') {
        return lane === 'BANK_AND_CUSTOMER_RETURN' && cheque.events.length === 1 && cheque.events[0].eventType === 'RETURNED';
      }
      return cheque.finalStatus === 'CLEARED' && cheque.events.length === 2
        && cheque.events[0].eventType === 'DEPOSITED' && cheque.events[1].eventType === 'CLEARED';
    }), 'UNSUPPORTED_POSTING_OWNER');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sepidar-opening-cheques:' + plan.bookId}))`;
    const voucherIds = [plan.openingVoucherId, ...plan.instruments.flatMap(cheque =>
      cheque.events.map(event => event.targetPosting.voucherId))];
    await tx.$queryRaw`SELECT id FROM public.accounting_ledger_vouchers
      WHERE id IN (${Prisma.join(voucherIds)}) ORDER BY id FOR SHARE`;
    const book = await tx.accountingBook.findUnique({ where: { id: plan.bookId } });
    requireValid(book, 'INVALID_TARGET');
    await verifyTargets(tx, plan, evidence, book.legalEntityId, custodyFinancialAccountId);
    const results: Array<{ instrumentId: string; replayed: boolean }> = [];
    for (const cheque of plan.instruments) {
      results.push(await recordInstrument(tx, plan, cheque, book.legalEntityId, actorId, planSha256, custodyFinancialAccountId));
    }
    return { planSha256, instruments: results };
  }, { isolationLevel: 'Serializable', timeout: 30_000 });
}

export function applySepidarOpeningBankHistories(database: Pick<PrismaClient, '$transaction'>, input: ApplyOpeningHistoriesInput) {
  return applyOpeningHistories(database, input, 'BANK');
}

/** Link reviewed bank and direct customer-return histories under their own protected plan digest. */
export function applySepidarOpeningBankAndCustomerReturnHistories(database: Pick<PrismaClient, '$transaction'>, input: ApplyOpeningHistoriesInput) {
  return applyOpeningHistories(database, input, 'BANK_AND_CUSTOMER_RETURN');
}
