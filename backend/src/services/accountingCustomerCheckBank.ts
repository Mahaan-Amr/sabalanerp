import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError, type CustomerTreasuryActor } from './accountingCustomerTreasury';
import { effectiveCustomerReceiptRials } from './accountingCustomerReceiptBalance';
import { reverseReceiptConsumptionWithin, type CustomerReceiptAllocationReversal } from './accountingCustomerReceiptCorrection';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';
import { requireCustomerConsumptionDate } from './accountingCustomerTreasuryPrisma';
import { requireCustomerReceiptSourceDate } from './accountingCustomerReceiptSource';

export type CustomerCheckBankCommand = {
  kind: 'CHECK_DEPOSIT' | 'CHECK_SETTLE'; profileId: string; receiptId: string; amountRials: bigint; unpaidRials: bigint;
  expectedSequence: number; financialAccountId: string; bankLedgerId?: string; collectionLedgerId?: string;
  reversals: CustomerReceiptAllocationReversal[]; bookId: string; fiscalYearId: string; periodId: string;
  receivableLedgerId: string; customerAdvanceLedgerId: string; postingRuleVersion: number;
  occurredAt: Date; reason: string; reference: string; idempotencyKey: string; actor: CustomerTreasuryActor;
};
const fail = (code: string, message: string): never => { throw new AccountingCustomerTreasuryError(code, message, 409); };
export async function recordCustomerCheckBankWithin(tx: Prisma.TransactionClient, input: CustomerCheckBankCommand) {
  const hash = hashAccountingEvidence({ ...input, actor: undefined });
  const prior = await tx.accountingCheckInstrumentEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  const receipt = await tx.accountingTreasuryTransaction.findUnique({ where: { id: input.receiptId }, include: {
    profile: true, checkInstrument: true, adjustments: { include: { ledgerVoucher: true } },
  } });
  if (!receipt || receipt.profileId !== input.profileId || receipt.kind !== 'CUSTOMER_RECEIPT' || receipt.componentKind !== 'CHECK'
    || !receipt.checkInstrument || !receipt.profile || !receipt.postedVoucherId) fail('RECEIPT_CHECK_INVALID', 'دریافت و ابزار چکی متعلق به مشتری و مرتبط باشند.');
  const check = receipt!.checkInstrument!;
  await requireCustomerReceiptSourceDate(tx, receipt!, input.occurredAt);
  if (prior) {
    if (prior.checkInstrumentId !== check.id || prior.evidenceHash !== hash) fail('IDEMPOTENCY_KEY_REUSED', 'کلید عملیات بانکی برای اطلاعات دیگری استفاده شده است.');
    return prior;
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${check.id}))`;
  const events = await tx.accountingCheckInstrumentEvent.findMany({ where: { checkInstrumentId: check.id }, orderBy: { sequence: 'desc' } });
  const last = events[0];
  if (!last || input.expectedSequence !== last.sequence || !Number.isInteger(input.expectedSequence)
    || input.occurredAt < last.occurredAt || input.idempotencyKey.length < 8) fail('CHECK_CHANGED', 'نسخه یا تاریخ عملیات چک تغییر کرده یا معتبر نیست.');
  const [financial, original] = await Promise.all([
    tx.accountingFinancialAccount.findUnique({ where: { id: input.financialAccountId } }),
    tx.accountingLedgerVoucher.findUnique({ where: { id: receipt!.postedVoucherId! }, include: { lines: { include: { account: true } } } }),
  ]);
  if (!financial || financial.legalEntityId !== check.legalEntityId || financial.currency !== 'IRR' || financial.activeFrom > input.occurredAt
    || (financial.activeTo && financial.activeTo < input.occurredAt)) fail('FINANCIAL_ACCOUNT_INVALID', 'حساب بانکی نتیجه ابزار معتبر نیست.');
  if (!original || original.status !== 'POSTED' || original.bookId !== input.bookId || original.documentDate > input.occurredAt) fail('CHECK_POSTING_INVALID', 'سند دریافت ابزار با دفتر و تاریخ عملیات منطبق نیست.');
  const custody = receipt!.sourceAssetLedgerId ? [{ accountId: receipt!.sourceAssetLedgerId }] : original!.lines.filter(line => line.account.statementRole === 'ASSET' && line.account.partyRequirement === 'REQUIRED' && BigInt(line.debitRials.toString()) > 0n);
  if (custody.length !== 1) fail('CHECK_POSTING_INVALID', 'حساب ابزار در سند دریافت قابل تشخیص نیست.');
  const deposit = events.find(event => event.eventType === 'DEPOSITED');
  const depositedEvidence = deposit?.evidence as { assetLedgerId?: string } | undefined;
  let sourceAsset = check.status === 'DEPOSITED' ? depositedEvidence?.assetLedgerId ?? receipt!.sourceAssetLedgerId : custody[0].accountId;
  if (!sourceAsset) fail('CHECK_POSTING_INVALID', 'حساب ابزار در گردش واگذاری قابل تشخیص نیست.');
  const partyId = receipt!.profile!.accountingPartyId;
  const sequence = last.sequence + 1;
  const evidence = { type: 'CHECK_INSTRUMENT', id: check.id, version: sequence,
    payload: { ...input, actor: undefined, assetLedgerId: input.kind === 'CHECK_DEPOSIT' ? input.collectionLedgerId : sourceAsset },
    hash: '' };
  evidence.hash = hashAccountingEvidence(evidence.payload);
  const line = (accountId: string, amount: bigint, debit: boolean, financialAccountId?: string) => ({ accountId,
    ...(financialAccountId ? { financialAccountId } : { partyId }), debitRials: debit ? amount : 0n, creditRials: debit ? 0n : amount,
    description: input.reason, dimensions: [], originalAmount: amount.toString(), originalCurrency: 'IRR',
    rawAmountBeforeRounding: amount.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1, evidence });
  const app = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `ACC-${randomUUID()}` });
  let lines: ReturnType<typeof line>[];
  let status: string;
  const cleared = BigInt(check.clearedRials.toString());
  const unpaid = BigInt(check.unpaidRials.toString());
  if (input.kind === 'CHECK_DEPOSIT') {
    if (check.status !== 'RECEIVED' || input.amountRials !== 0n || input.unpaidRials !== 0n || financial!.kind !== 'BANK'
      || !input.collectionLedgerId) fail('INVALID_CHECK_TRANSITION', 'واگذاری فقط برای چک نزد صندوق و حساب بانکی معتبر انجام می‌شود.');
    const collection = await tx.accountingLedgerAccount.findUnique({ where: { id: input.collectionLedgerId! } });
    if (!collection || collection.bookId !== input.bookId || collection.retiredAt || collection.level !== 'MOIN' || collection.statementRole !== 'ASSET'
      || collection.partyRequirement !== 'REQUIRED' || collection.financialAccountRequirement !== 'FORBIDDEN'
      || [sourceAsset, input.receivableLedgerId, input.customerAdvanceLedgerId].includes(collection.id)) fail('CHECK_POSTING_INVALID', 'حساب اسناد در جریان وصول معتبر و مستقل باشد.');
    const value = BigInt(check.amountRials.toString()) - cleared - unpaid;
    lines = [line(collection!.id, value, true), line(sourceAsset!, value, false)];
    status = 'DEPOSITED';
  } else {
    await requireCustomerConsumptionDate(tx, { receiptId: input.receiptId }, input.occurredAt);
    if (financial!.kind !== 'BANK') fail('FINANCIAL_ACCOUNT_INVALID', 'وصول چک به حساب بانکی معتبر نیاز دارد.');
    if (!['DEPOSITED', 'RECEIVED'].includes(check.status) || input.amountRials < 0n || input.unpaidRials < 0n
      || input.amountRials + input.unpaidRials <= 0n || cleared + unpaid + input.amountRials + input.unpaidRials > BigInt(check.amountRials.toString())) fail('CHECK_OUTCOME_INVALID', 'مبالغ وصول و عدم پرداخت با وضعیت و مبلغ چک منطبق نیست.');
    const bank = input.bankLedgerId ? await tx.accountingLedgerAccount.findUnique({ where: { id: input.bankLedgerId } }) : null;
    if (input.amountRials > 0n && (!bank || bank.bookId !== input.bookId || bank.statementRole !== 'ASSET' || bank.financialAccountRequirement === 'FORBIDDEN')) fail('FINANCIAL_ACCOUNT_INVALID', 'حساب دفترکل وصول معتبر نیست.');
    await reverseReceiptConsumptionWithin(tx, { ...input });
    const [uses, refunds] = await Promise.all([
      tx.accountingSettlementAllocationLine.findMany({ where: { allocation: { treasuryTransactionId: receipt!.id, reversesId: null, reversedById: null } } }),
      tx.accountingTreasuryTransaction.aggregate({ where: { refundOfId: receipt!.id, kind: 'CUSTOMER_REFUND' }, _sum: { amountRials: true } }),
    ]);
    const valid = effectiveCustomerReceiptRials(receipt!) - input.unpaidRials;
    if (uses.reduce((sum, row) => sum + BigInt(row.amountRials.toString()), 0n) + BigInt(refunds._sum.amountRials?.toString() ?? '0') > valid) fail('CHECK_ALLOCATION_REVERSAL_REQUIRED', 'تخصیص یا استرداد مربوط به بخش پرداخت‌نشده را تعیین تکلیف کنید.');
    lines = [...(input.amountRials > 0n ? [line(input.bankLedgerId!, input.amountRials, true, input.financialAccountId)] : []),
      ...(input.unpaidRials > 0n ? [line(input.customerAdvanceLedgerId, input.unpaidRials, true)] : []),
      line(sourceAsset!, input.amountRials + input.unpaidRials, false)];
    const remaining = BigInt(check.amountRials.toString()) - cleared - unpaid - input.amountRials - input.unpaidRials;
    status = remaining > 0n ? check.status : unpaid + input.unpaidRials === 0n ? 'CLEARED' : cleared + input.amountRials === 0n ? 'BOUNCED' : 'PARTIAL_SETTLED';
  }
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
    idempotencyKey: input.idempotencyKey, correlationId: input.idempotencyKey, documentDate: input.occurredAt, occurredAt: input.occurredAt,
    description: input.reason, source: evidence, actor: input.actor, lines });
  const posted = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: input.reason });
  if (input.unpaidRials > 0n) await tx.accountingCustomerReceiptAdjustment.create({ data: { receiptId: receipt!.id, kind: 'CHECK_NONPAYMENT',
    deltaRials: (-input.unpaidRials).toString(), occurredAt: input.occurredAt, ledgerVoucherId: posted.id,
    idempotencyKey: input.idempotencyKey, commandHash: hash, reason: input.reason, reference: input.reference, createdBy: input.actor.id } });
  const event = await tx.accountingCheckInstrumentEvent.create({ data: { checkInstrumentId: check.id, sequence, idempotencyKey: input.idempotencyKey,
    eventType: input.kind === 'CHECK_DEPOSIT' ? 'DEPOSITED' : status === 'DEPOSITED' || status === 'RECEIVED' ? 'PARTIAL_BANK_OUTCOME' : status,
    occurredAt: input.occurredAt, actorId: input.actor.id, postingRuleVersion: input.postingRuleVersion, ledgerVoucherId: posted.id,
    evidence: JSON.parse(JSON.stringify(evidence.payload, (_key, value) => typeof value === 'bigint' ? value.toString() : value)), evidenceHash: hash } });
  await tx.accountingCheckInstrument.update({ where: { id: check.id }, data: { status,
    clearedRials: (cleared + input.amountRials).toString(), unpaidRials: (unpaid + input.unpaidRials).toString(),
    ...(input.kind === 'CHECK_DEPOSIT' ? { custodianId: input.financialAccountId } : {}) } });
  return event;
}
