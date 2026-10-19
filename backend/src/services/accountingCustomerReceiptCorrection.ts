import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { requireCustomerSourceSharesWithin } from './customerSemanticCompatibility';
import { AccountingCustomerTreasuryError, type CustomerTreasuryActor } from './accountingCustomerTreasury';
import { allocateCustomerReceiptPrisma, reverseCustomerAllocationPrisma, requireCustomerConsumptionDate } from './accountingCustomerTreasuryPrisma';
import { effectiveCustomerReceiptRials } from './accountingCustomerReceiptBalance';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';
import { requireCustomerReceiptSourceDate } from './accountingCustomerReceiptSource';

export type CustomerReceiptAllocationReversal = { allocationId: string; lines: Array<{ openItemId: string; amountRials: bigint }> };
export type CustomerReceiptCorrection = {
  profileId: string; receiptId: string; kind: 'CORRECT_RECEIPT' | 'CANCEL_RECEIPT'; amountRials: bigint; expectedAmountRials: bigint;
  reversals: CustomerReceiptAllocationReversal[]; bookId: string; fiscalYearId: string; periodId: string;
  customerAdvanceLedgerId: string; receivableLedgerId: string; occurredAt: Date; reason: string; reference: string;
  idempotencyKey: string; actor: CustomerTreasuryActor;
};
const fail = (code: string, message: string): never => { throw new AccountingCustomerTreasuryError(code, message, 409); };

export async function reverseReceiptConsumptionWithin(tx: Prisma.TransactionClient, input: {
  profileId: string; receiptId: string; reversals: CustomerReceiptAllocationReversal[]; bookId: string; fiscalYearId: string; periodId: string;
  customerAdvanceLedgerId: string; receivableLedgerId: string; occurredAt: Date; reason: string; reference: string; idempotencyKey: string; actor: CustomerTreasuryActor;
}) {
  if (new Set(input.reversals.map(row => row.allocationId)).size !== input.reversals.length) fail('ALLOCATION_REVERSAL_INVALID', 'تخصیص برگشتی تکراری است.');
  const context = { bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    customerAdvanceLedgerId: input.customerAdvanceLedgerId, receivableLedgerId: input.receivableLedgerId,
    documentDate: input.occurredAt, correlationId: input.idempotencyKey, reason: input.reason, reference: input.reference, actor: input.actor };
  for (const selected of input.reversals) {
    // The allocation owner reverses a whole immutable revision; unchanged amounts are re-applied in the same transaction.
    const original = await tx.accountingSettlementAllocation.findUnique({ where: { id: selected.allocationId }, include: { lines: true } });
    if (!original || original.treasuryTransactionId !== input.receiptId || original.reversesId || original.reversedById) fail('ALLOCATION_REVERSAL_INVALID', 'تخصیص منتخب متعلق به دریافت و فعال نیست.');
    if (new Set(selected.lines.map(row => row.openItemId)).size !== selected.lines.length || !selected.lines.length) fail('ALLOCATION_REVERSAL_INVALID', 'ریز مصرف برگشتی معتبر نیست.');
    const remaining = original!.lines.map(line => {
      const reduction = selected.lines.find(row => row.openItemId === line.openItemId)?.amountRials ?? 0n;
      if (reduction < 0n || reduction > BigInt(line.amountRials.toString())) fail('ALLOCATION_REVERSAL_INVALID', 'مبلغ برگشت از تخصیص بیشتر است.');
      return { openItemId: line.openItemId, amountRials: BigInt(line.amountRials.toString()) - reduction };
    }).filter(line => line.amountRials > 0n);
    if (selected.lines.some(line => line.amountRials <= 0n || !original!.lines.some(row => row.openItemId === line.openItemId))) fail('ALLOCATION_REVERSAL_INVALID', 'بدهی و مبلغ برگشتی منطبق نیست.');
    const voucher = original!.ledgerVoucherId ? await tx.accountingLedgerVoucher.findUnique({ where: { id: original!.ledgerVoucherId } }) : null;
    if (!voucher || voucher.documentDate > input.occurredAt) fail('CORRECTION_DATE_INVALID', 'اصلاح نباید پیش از تخصیص وابسته ثبت شود.');
    await reverseCustomerAllocationPrisma(tx, { ...context, allocationId: original!.id, idempotencyKey: `${input.idempotencyKey}:reverse:${original!.id}` });
    if (remaining.length) await allocateCustomerReceiptPrisma(tx, { ...context, treasuryTransactionId: input.receiptId,
      allocations: remaining, idempotencyKey: `${input.idempotencyKey}:keep:${original!.id}` });
  }
}

export async function correctCustomerReceiptWithin(tx: Prisma.TransactionClient, input: CustomerReceiptCorrection) {
  await requireCustomerSourceSharesWithin(tx);
  if (input.idempotencyKey.length < 8) fail('ACCOUNTING_EVIDENCE_REQUIRED', 'کلید مستقل فرمان اصلاح لازم است.');
  const commandHash = hashAccountingEvidence({ ...input, actor: undefined });
  const prior = await tx.accountingCustomerReceiptAdjustment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) {
    if (prior.receiptId !== input.receiptId || prior.commandHash !== commandHash) fail('IDEMPOTENCY_KEY_REUSED', 'کلید اصلاح برای اطلاعات دیگری استفاده شده است.');
    return prior;
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.receiptId}))`;
  const receipt = await tx.accountingTreasuryTransaction.findUnique({ where: { id: input.receiptId }, include: {
    profile: true, checkInstrument: true, sourceResolution: true, adjustments: { include: { ledgerVoucher: true } },
    allocations: { where: { reversesId: null, reversedById: null }, include: { lines: true } },
  } });
  if (!receipt || receipt.profileId !== input.profileId || receipt.kind !== 'CUSTOMER_RECEIPT' || !receipt.profile || !receipt.postedVoucherId) fail('RECEIPT_NOT_FOUND', 'دریافت متعلق به این مشتری و قطعی باشد.');
  const current = effectiveCustomerReceiptRials(receipt!);
  await requireCustomerReceiptSourceDate(tx, receipt!, input.occurredAt);
  if (receipt!.sourceResolution) fail('RECEIPT_SOURCE_RESOLVED', 'دریافت تطبیق‌شده را از طریق ابزارهای مستقل آن اصلاح کنید.');
  await requireCustomerConsumptionDate(tx, { receiptId: input.receiptId }, input.occurredAt);
  if (current !== input.expectedAmountRials) fail('RECEIPT_CHANGED', 'مبلغ مؤثر دریافت تغییر کرده است؛ اطلاعات را دوباره بررسی کنید.');
  const next = input.kind === 'CANCEL_RECEIPT' ? 0n : input.amountRials;
  if (next < 0n || next === current) fail('INVALID_CORRECTION_AMOUNT', 'مبلغ اصلاحی معتبر و متفاوت باشد.');
  const cheque = receipt!.componentKind === 'CHECK' || receipt!.sourceType === 'CHECK_INSTRUMENT';
  if (cheque && (input.kind !== 'CANCEL_RECEIPT' || receipt!.checkInstrument?.status !== 'RECEIVED'
    || BigInt(receipt!.checkInstrument.clearedRials.toString()) > 0n || BigInt(receipt!.checkInstrument.unpaidRials.toString()) > 0n)) fail('CHECK_CORRECTION_REQUIRES_REPLACEMENT', 'برای اصلاح چک از لغو دریافت نزد صندوق و دریافت ابزار جایگزین استفاده کنید؛ ابزار بانکی مسیر جدا دارد.');
  const originalVoucher = await tx.accountingLedgerVoucher.findUnique({ where: { id: receipt!.postedVoucherId! }, include: { lines: { include: { account: true } } } });
  if (!originalVoucher || originalVoucher.status !== 'POSTED' || originalVoucher.bookId !== input.bookId || originalVoucher.documentDate > input.occurredAt
    || receipt!.adjustments.some(row => row.occurredAt > input.occurredAt)) fail('CORRECTION_DATE_INVALID', 'سند دریافت و تاریخ اصلاح منطبق نیستند.');
  const resolvedAsset = receipt!.sourceAssetLedgerId ? await tx.accountingLedgerAccount.findUniqueOrThrow({ where: { id: receipt!.sourceAssetLedgerId } }) : null;
  const assets = resolvedAsset ? [{ accountId: resolvedAsset.id, partyId: resolvedAsset.partyRequirement === 'REQUIRED' ? receipt!.profile!.accountingPartyId : null,
    financialAccountId: resolvedAsset.financialAccountRequirement === 'REQUIRED' ? receipt!.financialAccountId : null }] : originalVoucher!.lines.filter(line => line.account.statementRole === 'ASSET' && line.accountId !== input.receivableLedgerId && BigInt(line.debitRials.toString()) > 0n);
  if (assets.length !== 1) fail('RECEIPT_SOURCE_AMBIGUOUS', 'حساب منشأ دریافت برای اصلاح نیازمند تطبیق است.');
  const refunded = await tx.accountingTreasuryTransaction.aggregate({ where: { refundOfId: input.receiptId, kind: 'CUSTOMER_REFUND' }, _sum: { amountRials: true } });
  if (next < BigInt(refunded._sum.amountRials?.toString() ?? '0')) fail('CORRECTION_REFUND_CONFLICT', 'مبلغ صحیح از استرداد انجام‌شده کمتر است؛ ابتدا پرداخت و مستندات استرداد را تعیین تکلیف کنید.');
  const reversals = input.kind === 'CANCEL_RECEIPT' ? receipt!.allocations.map(allocation => ({ allocationId: allocation.id,
    lines: allocation.lines.map(line => ({ openItemId: line.openItemId, amountRials: BigInt(line.amountRials.toString()) })) })) : input.reversals;
  await reverseReceiptConsumptionWithin(tx, { ...input, reversals });
  const used = await tx.accountingSettlementAllocationLine.findMany({ where: { allocation: { treasuryTransactionId: input.receiptId, reversesId: null, reversedById: null } } });
  if (used.reduce((sum, line) => sum + BigInt(line.amountRials.toString()), 0n) + BigInt(refunded._sum.amountRials?.toString() ?? '0') > next) fail('CORRECTION_ALLOCATION_REQUIRED', 'پیش از اصلاح، تخصیص مازاد را برای برگشت انتخاب کنید.');
  const delta = next - current;
  const value = delta < 0n ? -delta : delta;
  const sourcePayload = { ...input, actor: undefined, reversals };
  const source = { type: 'CUSTOMER_RECEIPT_CORRECTION', id: input.idempotencyKey, version: 1, payload: sourcePayload, hash: hashAccountingEvidence(sourcePayload) };
  const line = (accountId: string, debit: boolean, partyId?: string, financialAccountId?: string) => ({ accountId, partyId, financialAccountId,
    debitRials: debit ? value : 0n, creditRials: debit ? 0n : value, description: input.reason, dimensions: [],
    originalAmount: value.toString(), originalCurrency: 'IRR', rawAmountBeforeRounding: value.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1, evidence: source });
  const app = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `ACC-${randomUUID()}` });
  const asset = assets[0];
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    idempotencyKey: input.idempotencyKey, correlationId: input.idempotencyKey, documentDate: input.occurredAt, occurredAt: input.occurredAt,
    description: input.reason, source, actor: input.actor, lines: [line(asset.accountId, delta > 0n, asset.partyId ?? undefined, asset.financialAccountId ?? undefined),
      line(input.customerAdvanceLedgerId, delta < 0n, receipt!.profile!.accountingPartyId)] });
  const posted = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: input.reason });
  if (cheque) {
    const check = receipt!.checkInstrument!;
    const last = await tx.accountingCheckInstrumentEvent.findFirst({ where: { checkInstrumentId: check.id }, orderBy: { sequence: 'desc' } });
    await tx.accountingCheckInstrumentEvent.create({ data: { checkInstrumentId: check.id, sequence: (last?.sequence ?? 0) + 1, eventType: 'CANCELLED',
      occurredAt: input.occurredAt, actorId: input.actor.id, ledgerVoucherId: posted.id, evidence: JSON.parse(JSON.stringify(source.payload, (_key, v) => typeof v === 'bigint' ? v.toString() : v)), evidenceHash: commandHash } });
    await tx.accountingCheckInstrument.update({ where: { id: check.id }, data: { status: 'CANCELLED' } });
  }
  return tx.accountingCustomerReceiptAdjustment.create({ data: { receiptId: input.receiptId, kind: input.kind, deltaRials: delta.toString(),
    occurredAt: input.occurredAt, ledgerVoucherId: posted.id, idempotencyKey: input.idempotencyKey, commandHash,
    reason: input.reason, reference: input.reference, createdBy: input.actor.id } });
}
