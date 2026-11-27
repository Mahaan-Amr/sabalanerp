import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1, type AccountingActor, type LedgerLineInput } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';
import { SEPIDAR_CHEQUE_SUPPLIER_ENDORSEMENT } from './accountingSupplyChain';
import { previewSepidarOpeningCheques, readSepidarOpeningChequeEvidence, type SepidarOpeningChequeEvidence } from './sepidarOpeningChequePlan';

type Plan = ReturnType<typeof previewSepidarOpeningCheques>;
type Cheque = Plan['instruments'][number];
type HistoryLane = 'BANK' | 'BANK_AND_CUSTOMER_RETURN' | 'HISTORICAL_RECIPIENT' | 'HISTORICAL_SUPPLIER_PAYABLE';
const historicalRecipientAccounts = new Map([[103, '111003'], [124, '111303']]);
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
  const settlement = reference.historicalSupplierSettlement;
  const destination = settlement ? { supplierPartyId: reference.targetId, settlementId: settlement.settlementId,
    sourcePartyId: settlement.sourcePartyId, reviewSha256: settlement.reviewSha256 }
    : reference.kind === 'PAYMENT_RECIPIENT' ? { recipientDimensionMemberId: reference.targetId }
    : reference.kind === 'CUSTOMER' ? { customerPartyId: reference.targetId } : { bankFinancialAccountId: reference.targetId };
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
    ...destination,
  };
}

function voucherSource(type: string, id: string, payload: unknown) {
  return { type, id, payload, version: 1, hash: hashAccountingEvidence(payload) };
}

function voucherLine(amount: bigint, line: Omit<LedgerLineInput, 'debitRials' | 'creditRials'>): LedgerLineInput {
  return { ...line, debitRials: amount > 0n ? amount : 0n, creditRials: amount < 0n ? -amount : 0n,
    rawAmountBeforeRounding: (amount < 0n ? -amount : amount).toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1 };
}

function eventLineOwner(reference: Cheque['events'][number]['targetPosting']['reference'], account: number, customerPartyId: string) {
  const isBank = account === 105;
  const recipientCounter = reference.kind === 'PAYMENT_RECIPIENT' && account !== 118;
  const supplierCounter = reference.kind === 'SUPPLIER' && account === 193;
  return { recipientCounter,
    partyId: supplierCounter ? reference.targetId : isBank || recipientCounter ? undefined : customerPartyId,
    financialAccountId: isBank ? reference.targetId : undefined };
}

/** Derive balanced ledger commands from the same source evidence used by the application verifier. */
export function prepareSepidarOpeningChequeVouchers(
  evidence: SepidarOpeningChequeEvidence,
  target: { clearingAccountId: string; recipientDimensionTypeId?: string },
) {
  const plan = previewSepidarOpeningCheques(evidence);
  const sourceAccounts = new Map(evidence.ledgerLines.map(line => [line.id, line.accountId]));
  const chequeByOpeningLine = new Map(plan.instruments.map(cheque => [cheque.opening.sourceLineId, cheque]));
  const openingPayload = {
    snapshotSha256: plan.snapshotSha256, sourceOpeningVoucherId: plan.sourceOpeningVoucherId, basisAt: plan.basisAt,
  };
  const openingSource = voucherSource('SEPIDAR_CHEQUE_OPENING', plan.sourceOpeningVoucherId, openingPayload);
  requireValid(target.clearingAccountId.trim() && !evidence.openingLines.some(line => line.targetAccountId === target.clearingAccountId)
    && !evidence.events.some(event => event.posting.lines.some(line => line.targetAccountId === target.clearingAccountId)), 'INVALID_TARGET');
  const openingLines = evidence.openingLines.map(row => voucherLine(row.amountRials, {
    accountId: row.targetAccountId, partyId: chequeByOpeningLine.get(row.id)!.instrument.target.partyId, dimensions: [],
    evidence: voucherSource('SEPIDAR_ACC_VOUCHER_ITEM', row.id, {
      snapshotSha256: plan.snapshotSha256, row: { VoucherItemId: row.id, VoucherRef: plan.sourceOpeningVoucherId,
        AmountRials: row.amountRials.toString() },
    }),
  }));
  const openingTotal = openingLines.reduce((total, line) => total + line.debitRials, 0n);
  openingLines.push(voucherLine(-openingTotal, { accountId: target.clearingAccountId, dimensions: [],
    evidence: voucherSource('SEPIDAR_CHEQUE_OPENING', plan.sourceOpeningVoucherId,
      { ...openingPayload, openingTotalRials: openingTotal.toString() }),
  }));
  const events = plan.instruments.flatMap(cheque => cheque.events.map(event => {
    const { reference } = event.targetPosting;
    const source = voucherSource('SEPIDAR_CHEQUE_EVENT', event.historyId, eventEvidence(plan, cheque, event));
    const lines = event.targetPosting.lines.map(line => {
      const { recipientCounter, partyId, financialAccountId } = eventLineOwner(
        reference, sourceAccounts.get(line.sourceLineId)!, cheque.instrument.target.partyId,
      );
      const dimensionTypeId = target.recipientDimensionTypeId;
      requireValid(!recipientCounter || dimensionTypeId?.trim(), 'INVALID_TARGET');
      return voucherLine(line.signedRials, { accountId: line.targetAccountId, partyId, financialAccountId,
        dimensions: recipientCounter ? [{ typeId: dimensionTypeId!, memberId: reference.targetId }] : [],
        evidence: voucherSource('SEPIDAR_ACC_VOUCHER_ITEM', line.sourceLineId, {
          snapshotSha256: plan.snapshotSha256, row: {
            VoucherItemId: line.sourceLineId, VoucherRef: event.document.voucherId, ...line.tracking,
          },
        }),
      });
    });
    return { occurredAt: event.occurredAt, source, lines };
  }));
  return { bookId: plan.bookId, opening: { occurredAt: plan.basisAt, source: openingSource, lines: openingLines }, events };
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
    if (event.eventType === 'RETURNED' || event.eventType === 'ENDORSED') {
      return makeEvent(event.sequence, event.eventType, event.occurredAt, evidence, tillId, null, event.targetPosting.voucherId);
    }
    if (event.eventType === 'RECIPIENT_RETURNED') {
      return makeEvent(event.sequence, event.eventType, event.occurredAt, evidence, null, tillId, event.targetPosting.voucherId);
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

async function verifyHistoricalRecipient(tx: Prisma.TransactionClient, bookId: string, event: Cheque['events'][number]) {
  const { sourceId, targetId } = event.targetPosting.reference;
  const member = await tx.accountingDimensionMember.findUnique({ where: { id: targetId }, include: { dimensionType: true } });
  requireValid(member && member.sourceId === sourceId && member.dimensionType.bookId === bookId
    && member.dimensionType.code === 'SEPIDAR_DL' && member.dimensionType.sourceKind === 'SEPIDAR_ACC_DL', 'INVALID_TARGET');
  for (const entity of [member, member.dimensionType]) {
    requireValid(activeAt({ activeFrom: entity.effectiveFrom, activeTo: entity.effectiveTo }, event.occurredAt), 'INVALID_TARGET');
  }
  return member;
}

async function verifyHistoricalSupplierBinding(tx: Prisma.TransactionClient, bookId: string,
  event: Cheque['events'][number], legalEntityId: string) {
  const { reference } = event.targetPosting;
  const historical = reference.historicalSupplierSettlement;
  requireValid(historical, 'INVALID_TARGET');
  const [supplier, binding] = await Promise.all([
    tx.accountingParty.findUnique({ where: { id: reference.targetId }, include: { roles: true } }),
    tx.accountingSepidarTargetLink.findUnique({ where: { bookId_sourceTable_sourceKey_targetKind: {
      bookId, sourceTable: 'GNR.Party', sourceKey: historical.sourcePartyId, targetKind: 'PARTY',
    } } }),
  ]);
  requireValid(supplier && supplier.legalEntityId === legalEntityId && activeAt(supplier, event.occurredAt)
    && supplier.roles.some(role => role.role === 'SUPPLIER' && activeAt({ activeFrom: role.effectiveFrom, activeTo: role.effectiveTo }, event.occurredAt))
    && binding?.targetId === supplier.id && binding.reviewStatus === 'USER_APPROVED' && binding.reviewedBy
    && binding.reviewEvidence === historical.reviewSha256, 'INVALID_TARGET');
  return { historical, supplier };
}

async function verifyHistoricalSupplierPayable(tx: Prisma.TransactionClient, plan: Plan, cheque: Cheque,
  event: Cheque['events'][number], legalEntityId: string) {
  const { voucherId } = event.targetPosting;
  const { historical, supplier } = await verifyHistoricalSupplierBinding(tx, plan.bookId, event, legalEntityId);
  const settlement = await tx.accountingSupplierSettlementTransaction.findUnique({ where: { id: historical.settlementId }, include: {
    allocations: { select: { id: true }, take: 1 }, payableChecks: { select: { id: true }, take: 1 },
  } });
  const expectedHash = hashAccountingEvidence(eventEvidence(plan, cheque, event));
  requireValid(settlement && settlement.voucherId === voucherId && settlement.supplierPartyId === supplier.id
    && settlement.kind === 'ASSIGNED_CUSTOMER_CHECK' && settlement.financialAccountId === null
    && BigInt(settlement.amountRials.toString()) === cheque.instrument.amountRials && settlement.occurredAt.toISOString() === event.occurredAt
    && settlement.sourceType === SEPIDAR_CHEQUE_SUPPLIER_ENDORSEMENT && settlement.sourceId === event.historyId
    && settlement.sourceVersion === 1 && settlement.sourceHash === expectedHash && hashAccountingEvidence(settlement.sourcePayload) === expectedHash
    && settlement.allocations.length === 0 && settlement.payableChecks.length === 0, 'INVALID_TARGET');
}

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
      const recipient = reference.kind === 'PAYMENT_RECIPIENT' ? await verifyHistoricalRecipient(tx, plan.bookId, event) : null;
      const supplierEndorsement = reference.kind === 'SUPPLIER';
      if (supplierEndorsement) {
        await verifyHistoricalSupplierPayable(tx, plan, cheque, event, legalEntityId);
      } else if (returned) {
        requireValid(reference.kind === 'CUSTOMER' && reference.targetId === partyId && activeAt(profile, event.occurredAt), 'INVALID_TARGET');
      } else if (!recipient) {
        const bank = await tx.accountingFinancialAccount.findUnique({ where: { id: reference.targetId } });
        requireValid(bank && bank.kind === 'BANK' && bank.legalEntityId === legalEntityId && bank.currency === 'IRR'
          && activeAt(bank, event.occurredAt), 'INVALID_TARGET');
      }
      const voucher = await tx.accountingLedgerVoucher.findUnique({ where: { id: voucherId }, include: {
        lines: { include: { dimensions: true, account: { select: { code: true, bookId: true, dimensionRules: true } } } }, reversals: postedReversals,
      } });
      requireValid(voucher && matchesVoucher(voucher, plan.bookId, event.occurredAt)
        && voucher.sourceType === 'SEPIDAR_CHEQUE_EVENT' && voucher.sourceId === event.historyId && voucher.sourceVersion === 1
        && voucher.sourceHash === hashAccountingEvidence(eventEvidence(plan, cheque, event))
        && voucher.lines.length === lines.length, 'INVALID_TARGET');

      const voucherLines = new Map(voucher.lines.map(line => [line.id, line]));
      for (const allocation of lines) {
        const line = voucherLines.get(allocation.targetLineId);
        const sourceAccount = sourceAccounts.get(allocation.sourceLineId)!;
        const owner = eventLineOwner(reference, sourceAccount, partyId);
        const recipientCounter = owner.recipientCounter ? recipient : null;
        const supplierCounter = supplierEndorsement && sourceAccount === 193;
        requireValid(line && line.accountId === allocation.targetAccountId
          && line.partyId === (owner.partyId ?? null) && line.financialAccountId === (owner.financialAccountId ?? null)
          && BigInt(line.debitRials.toString()) === (allocation.signedRials > 0n ? allocation.signedRials : 0n)
          && BigInt(line.creditRials.toString()) === (allocation.signedRials < 0n ? -allocation.signedRials : 0n), 'INVALID_TARGET');
        if (recipientCounter) {
          requireValid(line.account.bookId === plan.bookId && line.account.code === historicalRecipientAccounts.get(sourceAccount)
            && line.dimensions.length === 1 && line.dimensions[0].dimensionTypeId === recipientCounter.dimensionTypeId
            && line.dimensions[0].memberId === recipientCounter.id && line.account.dimensionRules.some(rule =>
              rule.dimensionTypeId === recipientCounter.dimensionTypeId && rule.requirement === 'OPTIONAL'), 'INVALID_TARGET');
        } else {
          requireValid(line.dimensions.length === 0, 'INVALID_TARGET');
          if (recipient) requireValid(line.account.bookId === plan.bookId && line.account.code === '111202', 'INVALID_TARGET');
        }
        if (returned) {
          requireValid(line.account.bookId === plan.bookId
            && line.account.code === (allocation.signedRials > 0n ? '111201' : '111202'), 'INVALID_TARGET');
        }
        if (supplierEndorsement) {
          requireValid(line.account.bookId === plan.bookId
            && line.account.code === (supplierCounter ? '211001' : '111202'), 'INVALID_TARGET');
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

/** Validate posted cheque vouchers on a consistent snapshot without opening the write admission. */
export async function inspectSepidarOpeningChequeTargets(
  database: Pick<PrismaClient, '$transaction'>,
  input: Omit<ApplyOpeningHistoriesInput, 'actor'>,
) {
  const evidence = structuredClone(input.evidence);
  const { custodyFinancialAccountId } = input;
  const plan = previewSepidarOpeningCheques(evidence);
  await database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const book = await tx.accountingBook.findUnique({ where: { id: plan.bookId } });
    requireValid(book, 'INVALID_TARGET');
    await verifyTargets(tx, plan, evidence, book.legalEntityId, custodyFinancialAccountId);
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
  return {
    bookId: plan.bookId,
    basisAt: plan.basisAt,
    snapshotSha256: plan.snapshotSha256,
    instruments: plan.instruments.length,
    subsequentEvents: plan.instruments.reduce((count, cheque) => count + cheque.events.length, 0),
  };
}

type ApplyOpeningBatchInput = ApplyOpeningHistoriesInput & {
  clearingAccountId: string;
  recipientDimensionTypeId?: string;
  fiscalYearId: string;
  periodId: string;
};

function openingBatchPreparation(input: Omit<ApplyOpeningBatchInput, 'actor'>) {
  const { evidence, custodyFinancialAccountId, clearingAccountId, recipientDimensionTypeId, fiscalYearId, periodId } = input;
  const prepared = prepareSepidarOpeningChequeVouchers(evidence, { clearingAccountId, recipientDimensionTypeId });
  const planSha256 = hashAccountingEvidence({
    purpose: 'SEPIDAR_OPENING_CHEQUE_VOUCHERS_AND_HISTORY', evidence, prepared, custodyFinancialAccountId,
    clearingAccountId, recipientDimensionTypeId, fiscalYearId, periodId,
  });
  return { prepared, planSha256 };
}

export function sepidarOpeningChequeBatchDigest(input: Omit<ApplyOpeningBatchInput, 'actor'>) {
  return openingBatchPreparation(input).planSha256;
}

export function describeSepidarOpeningChequeBatch(bytes: Buffer, target: Omit<ApplyOpeningBatchInput, 'evidence' | 'actor'>
  & { actorId: string }) {
  const evidence = readSepidarOpeningChequeEvidence(bytes.toString('utf8'));
  const { actorId, custodyFinancialAccountId, clearingAccountId, fiscalYearId, periodId, recipientDimensionTypeId } = target;
  const planSha256 = sepidarOpeningChequeBatchDigest({ evidence, custodyFinancialAccountId, clearingAccountId,
    fiscalYearId, periodId, recipientDimensionTypeId });
  return {
    format: 'sepidar-opening-cheque-batch-preparation-v1', bookId: evidence.bookId, basisAt: evidence.basisAt,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'), planSha256,
    actorId, custodyFinancialAccountId, clearingAccountId, fiscalYearId, periodId, recipientDimensionTypeId,
    instrumentCount: evidence.instruments.length, eventCount: evidence.events.length,
    openingRials: evidence.openingLines.reduce((sum, line) => sum + line.amountRials, 0n).toString(),
  };
}

async function requireOpeningAdmission(tx: Prisma.TransactionClient, releaseId: string, bookId: string, actorId: string, digest: string) {
  const admission = await tx.$queryRaw<Array<{ admitted: boolean }>>`
    SELECT public.sepidar_opening_cheques_runtime_admitted(
      ${releaseId}, ${bookId}, ${actorId}, ${digest}
    ) AS admitted`.catch(() => []);
  requireValid(admission[0]?.admitted === true, 'ADMISSION_CLOSED');
}

async function lockOpeningBook(tx: Prisma.TransactionClient, bookId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'sepidar-opening-cheques:' + bookId}))`;
}

const chequeAccountCodes = new Map([
  [103, '111003'], [105, '111005'], [117, '111201'], [118, '111202'], [119, '111203'], [124, '111303'], [193, '211001'],
]);

/** Validate production destinations before enrollment without posting or locking rows. */
export async function inspectSepidarOpeningChequeBatchDestinations(
  database: Pick<PrismaClient, '$transaction'>, input: Omit<ApplyOpeningBatchInput, 'actor'>,
) {
  const batch = structuredClone(input);
  const { evidence, custodyFinancialAccountId, fiscalYearId, periodId, clearingAccountId, recipientDimensionTypeId } = batch;
  const plan = previewSepidarOpeningCheques(evidence);
  const { planSha256 } = openingBatchPreparation(batch);
  const sourceAccounts = new Map(evidence.ledgerLines.map(line => [line.id, line.accountId]));
  const accounts = new Map([[clearingAccountId, '119901']]);
  for (const cheque of plan.instruments) {
    accounts.set(cheque.opening.targetAccountId, '111202');
    for (const event of cheque.events) {
      for (const line of event.targetPosting.lines) {
        const code = chequeAccountCodes.get(sourceAccounts.get(line.sourceLineId)!);
        requireValid(code && (!accounts.has(line.targetAccountId) || accounts.get(line.targetAccountId) === code), 'INVALID_TARGET');
        accounts.set(line.targetAccountId, code);
      }
    }
  }
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [book, period, destinationAccounts, till] = await Promise.all([
      tx.accountingBook.findUnique({ where: { id: plan.bookId } }),
      tx.accountingPostingPeriod.findUnique({ where: { id: periodId }, include: { fiscalYear: true } }),
      tx.accountingLedgerAccount.findMany({ where: { id: { in: [...accounts.keys()] } } }),
      tx.accountingFinancialAccount.findUnique({ where: { id: custodyFinancialAccountId } }),
    ]);
    requireValid(book && period && period.fiscalYearId === fiscalYearId && period.fiscalYear.bookId === book.id
      && period.fiscalYear.status === 'ACTIVE' && period.status === 'OPEN'
      && period.startsAt <= new Date(plan.basisAt)
      && plan.instruments.every(cheque => cheque.events.every(event => new Date(event.occurredAt) <= period.endsAt)), 'INVALID_TARGET');
    requireValid(destinationAccounts.length === accounts.size && destinationAccounts.every(account =>
      account.bookId === plan.bookId && account.level === 'MOIN' && account.code === accounts.get(account.id) && !account.retiredAt), 'INVALID_TARGET');
    requireValid(till && till.kind === 'CASH' && till.legalEntityId === book.legalEntityId && till.currency === 'IRR'
      && activeAt(till, plan.basisAt), 'INVALID_TARGET');
    for (const cheque of plan.instruments) {
      const { profileId, partyId } = cheque.instrument.target;
      const profile = await tx.accountingCustomerProfile.findUnique({ where: { id: profileId } });
      requireValid(profile && profile.accountingPartyId === partyId && profile.legalEntityId === book.legalEntityId
        && activeAt(profile, plan.basisAt), 'INVALID_TARGET');
      for (const event of cheque.events) {
        const { reference } = event.targetPosting;
        if (reference.kind === 'SUPPLIER') {
          await verifyHistoricalSupplierBinding(tx, plan.bookId, event, book.legalEntityId);
        } else if (reference.kind === 'PAYMENT_RECIPIENT') {
          const member = await verifyHistoricalRecipient(tx, plan.bookId, event);
          requireValid(member.dimensionTypeId === recipientDimensionTypeId, 'INVALID_TARGET');
        } else if (reference.kind === 'BANK') {
          const bank = await tx.accountingFinancialAccount.findUnique({ where: { id: reference.targetId } });
          requireValid(bank && bank.kind === 'BANK' && bank.legalEntityId === book.legalEntityId && bank.currency === 'IRR'
            && activeAt(bank, event.occurredAt), 'INVALID_TARGET');
        } else {
          requireValid(reference.targetId === partyId && activeAt(profile, event.occurredAt), 'INVALID_TARGET');
        }
      }
    }
    return { planSha256, instrumentCount: plan.instruments.length, accountCount: destinationAccounts.length };
  }, { isolationLevel: 'RepeatableRead', timeout: 30_000 });
}

export async function inspectSepidarOpeningChequeBatchAdmission(
  database: Pick<PrismaClient, '$transaction'>, input: ApplyOpeningBatchInput,
) {
  const releaseId = process.env.DEPLOYMENT_RELEASE_ID;
  const batch = structuredClone(input);
  const { actor } = batch;
  requireValid(releaseId && actor.id.trim() && actor.profile === 'ACCOUNTANT', 'ADMISSION_CLOSED');
  const { prepared, planSha256 } = openingBatchPreparation(batch);
  await database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await requireOpeningAdmission(tx, releaseId, prepared.bookId, actor.id, planSha256);
  }, { isolationLevel: 'RepeatableRead', timeout: 10_000 });
  return { planSha256, instrumentCount: batch.evidence.instruments.length, eventCount: prepared.events.length };
}

/** Used by a protected cheque importer after admission for the exact voucher and history plan. */
export async function applySepidarOpeningChequeBatch(database: Pick<PrismaClient, '$transaction'>, input: ApplyOpeningBatchInput) {
  const releaseId = process.env.DEPLOYMENT_RELEASE_ID;
  const batch = structuredClone(input);
  const { actor, evidence, custodyFinancialAccountId, clearingAccountId, fiscalYearId, periodId } = batch;
  requireValid(releaseId && actor.id.trim() && actor.profile === 'ACCOUNTANT', 'ADMISSION_CLOSED');
  const { prepared, planSha256 } = openingBatchPreparation(batch);
  return database.$transaction(async tx => {
    const bookId = prepared.bookId;
    await requireOpeningAdmission(tx, releaseId, bookId, actor.id, planSha256);
    await lockOpeningBook(tx, bookId);
    const book = await tx.accountingBook.findUnique({ where: { id: bookId } });
    const clearing = await tx.accountingLedgerAccount.findUnique({ where: { id: clearingAccountId }, include: { dimensionRules: true } });
    requireValid(book && clearing && clearing.bookId === bookId && clearing.code === '119901' && clearing.level === 'MOIN'
      && clearing.statementRole === 'ASSET' && clearing.currencyBehavior === 'BASE_ONLY'
      && clearing.partyRequirement === 'FORBIDDEN' && clearing.financialAccountRequirement === 'FORBIDDEN'
      && !clearing.dimensionRules.some(rule => rule.requirement === 'REQUIRED') && !clearing.retiredAt
      && activeAt({ activeFrom: clearing.effectiveFrom, activeTo: clearing.effectiveTo }, prepared.opening.occurredAt), 'INVALID_TARGET');

    const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true),
      { now: () => new Date(), nextReference: randomUUID });
    const post = async (command: typeof prepared.opening | typeof prepared.events[number]) => {
      const key = 'sepidar-cheque-batch:' + hashAccountingEvidence({ bookId, type: command.source.type, id: command.source.id });
      const at = new Date(command.occurredAt);
      const draft = await ledger.createManualDraft({
        bookId, fiscalYearId, periodId, documentDate: at, occurredAt: at, idempotencyKey: key, correlationId: key,
        description: 'انتقال گردش مستند چک از سپیدار', source: command.source, lines: command.lines, actor,
      });
      const posted = await ledger.postVoucher({ voucherId: draft.id, actor, reason: 'انتقال گردش مستند چک از سپیدار' });
      requireValid(posted.status === 'POSTED', 'INVALID_TARGET');
      const savedLines = await tx.accountingLedgerLine.findMany({
        where: { voucherId: posted.id }, select: { id: true, evidenceId: true, evidenceType: true },
      });
      const lines = new Map(savedLines.filter(line => line.evidenceType === 'SEPIDAR_ACC_VOUCHER_ITEM')
        .map(line => [line.evidenceId, line.id]));
      requireValid(lines.size === savedLines.length - (command.source.type === 'SEPIDAR_CHEQUE_OPENING' ? 1 : 0), 'INVALID_TARGET');
      return { voucherId: posted.id, lines };
    };

    const opening = await post(prepared.opening);
    const postedEvents = new Map<string, Awaited<ReturnType<typeof post>>>();
    const instrumentById = new Map(evidence.instruments.map(item => [item.id, item]));
    const eventsById = new Map(evidence.events.map(event => [event.id, event]));
    const commands = [...prepared.events].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt)
      || left.source.id.localeCompare(right.source.id, 'en', { numeric: true }));
    for (const command of commands) {
      const event = eventsById.get(command.source.id)!;
      const posted = await post(command);
      postedEvents.set(event.id, posted);
      const historical = event.posting.reference.historicalSupplierSettlement;
      if (!historical) continue;
      const existing = await tx.accountingSupplierSettlementTransaction.findUnique({ where: { id: historical.settlementId }, select: { id: true } });
      if (!existing) await tx.accountingSupplierSettlementTransaction.create({ data: {
        id: historical.settlementId, supplierPartyId: event.posting.reference.targetId, voucherId: posted.voucherId,
        kind: 'ASSIGNED_CUSTOMER_CHECK', amountRials: instrumentById.get(event.chequeId)!.amountRials.toString(),
        occurredAt: new Date(event.occurredAt), sourceType: SEPIDAR_CHEQUE_SUPPLIER_ENDORSEMENT, sourceId: event.id,
        sourceVersion: command.source.version, sourceHash: command.source.hash, sourcePayload: command.source.payload as Prisma.InputJsonValue,
        createdBy: actor.id,
      } });
    }
    const boundEvidence: SepidarOpeningChequeEvidence = {
      ...evidence,
      openingVoucherId: opening.voucherId,
      instruments: evidence.instruments.map(item => ({ ...item, target: { ...item.target,
        openingPostingLineId: opening.lines.get(item.sourceOpeningLineId)! } })),
      events: evidence.events.map(event => {
        const posted = postedEvents.get(event.id)!;
        return { ...event, posting: { ...event.posting, voucherId: posted.voucherId,
          lines: event.posting.lines.map(line => ({ ...line, targetLineId: posted.lines.get(line.sourceLineId)! })) } };
      }),
    };
    const plan = previewSepidarOpeningCheques(boundEvidence);
    await verifyTargets(tx, plan, boundEvidence, book.legalEntityId, custodyFinancialAccountId);
    const instruments: Array<Awaited<ReturnType<typeof recordInstrument>>> = [];
    for (const cheque of plan.instruments) {
      instruments.push(await recordInstrument(tx, plan, cheque, book.legalEntityId, actor.id, planSha256, custodyFinancialAccountId));
    }
    return { planSha256, instruments, openingVoucherId: opening.voucherId, eventVouchers: postedEvents.size };
  }, { isolationLevel: 'Serializable', timeout: 60_000 });
}

async function applyOpeningHistories(database: Pick<PrismaClient, '$transaction'>, input: ApplyOpeningHistoriesInput,
  lane: HistoryLane) {
  const releaseId = process.env.DEPLOYMENT_RELEASE_ID;
  requireValid(releaseId && input.actor.id.trim() && input.actor.profile === 'ACCOUNTANT', 'ADMISSION_CLOSED');
  const { custodyFinancialAccountId } = input;
  const actorId = input.actor.id;
  const evidence = structuredClone(input.evidence);
  const plan = previewSepidarOpeningCheques(evidence);
  const planSha256 = hashAccountingEvidence({ plan, custodyFinancialAccountId, ...(lane === 'BANK' ? {} : { lane }) });
  return database.$transaction(async tx => {
    await requireOpeningAdmission(tx, releaseId, plan.bookId, actorId, planSha256);
    requireValid(plan.instruments.every(cheque => {
      let events = cheque.events;
      if ((lane === 'HISTORICAL_RECIPIENT' || lane === 'HISTORICAL_SUPPLIER_PAYABLE') && events[0]?.eventType === 'ENDORSED'
        && events[0].targetPosting.reference.kind === 'PAYMENT_RECIPIENT' && events[1]?.eventType === 'RECIPIENT_RETURNED') {
        events = events.slice(2);
      }
      if (cheque.finalStatus === 'ENDORSED') {
        return lane === 'HISTORICAL_SUPPLIER_PAYABLE' && events.length === 1 && events[0].eventType === 'ENDORSED'
          && events[0].targetPosting.reference.kind === 'SUPPLIER' && !!events[0].targetPosting.reference.historicalSupplierSettlement;
      }
      if (cheque.finalStatus === 'RETURNED') return lane !== 'BANK' && events.length === 1 && events[0].eventType === 'RETURNED';
      return cheque.finalStatus === 'CLEARED' && events.length === 2
        && events[0].eventType === 'DEPOSITED' && events[1].eventType === 'CLEARED';
    }), 'UNSUPPORTED_POSTING_OWNER');
    await lockOpeningBook(tx, plan.bookId);
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

export function applySepidarOpeningHistoricalRecipientHistories(database: Pick<PrismaClient, '$transaction'>, input: ApplyOpeningHistoriesInput) {
  return applyOpeningHistories(database, input, 'HISTORICAL_RECIPIENT');
}

export function applySepidarOpeningHistoricalSupplierHistories(database: Pick<PrismaClient, '$transaction'>, input: ApplyOpeningHistoriesInput) {
  return applyOpeningHistories(database, input, 'HISTORICAL_SUPPLIER_PAYABLE');
}
