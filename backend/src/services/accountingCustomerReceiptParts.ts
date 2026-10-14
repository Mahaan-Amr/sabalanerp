import { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError, type CustomerTreasuryActor } from './accountingCustomerTreasury';
import { createReceivableCheckPrisma, recordCustomerReceiptPrisma } from './accountingCustomerTreasuryPrisma';
import { randomUUID } from 'node:crypto';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';

export type CustomerReceiptPart = {
  key: string; kind: 'BANK' | 'CASH' | 'CARD' | 'CHECK'; amountRials: bigint;
  financialAccountId: string; ledgerAccountId: string;
  check?: { serialNumber: string; sayadId?: string; bankName: string; dueAt: Date };
  feeRials?: bigint; feeLedgerAccountId?: string;
};
export async function recordCustomerReceiptPartsWithin(tx: Prisma.TransactionClient, input: {
  profileId: string; legalEntityId: string; bookId: string; fiscalYearId: string; periodId: string;
  customerAdvanceLedgerId: string; receivableLedgerId: string; parts: CustomerReceiptPart[]; amountRials: bigint;
  occurredAt: Date; reason: string; reference: string; idempotencyKey: string; actor: CustomerTreasuryActor;
}) {
  const invalid = (message: string): never => { throw new AccountingCustomerTreasuryError('RECEIPT_PARTS_INVALID', message, 409); };
  if (!input.parts.length || new Set(input.parts.map(part => part.key)).size !== input.parts.length
    || input.parts.reduce((sum, part) => sum + part.amountRials, 0n) !== input.amountRials || input.idempotencyKey.length < 8) invalid('جمع اجزای دریافت یا شناسه‌های آنها معتبر نیست.');
  const receipts: Array<Awaited<ReturnType<typeof recordCustomerReceiptPrisma>>> = [];
  for (const part of input.parts) {
    if (!part.key.trim() || part.amountRials <= 0n || !['BANK', 'CASH', 'CARD', 'CHECK'].includes(part.kind)) invalid('نوع، مبلغ یا شناسه جزء دریافت معتبر نیست.');
    const [financial, account, prior] = await Promise.all([
      tx.accountingFinancialAccount.findUnique({ where: { id: part.financialAccountId } }),
      tx.accountingLedgerAccount.findUnique({ where: { id: part.ledgerAccountId } }),
      tx.accountingTreasuryTransaction.findUnique({ where: { idempotencyKey: `${input.idempotencyKey}:${part.key}` } }),
    ]);
    if (!financial || financial.legalEntityId !== input.legalEntityId || financial.currency !== 'IRR' || financial.activeFrom > input.occurredAt
      || (financial.activeTo && financial.activeTo < input.occurredAt)) invalid('حساب مالی جزء دریافت متعلق به شرکت و معتبر باشد.');
    if (!account || account.bookId !== input.bookId || account.level !== 'MOIN' || account.retiredAt || account.statementRole !== 'ASSET'
      || account.normalSide !== 'DEBIT' || [input.customerAdvanceLedgerId, input.receivableLedgerId].includes(account.id)
      || (part.kind === 'CHECK' ? account.partyRequirement !== 'REQUIRED' || account.financialAccountRequirement !== 'FORBIDDEN' : account.financialAccountRequirement === 'FORBIDDEN')) invalid('حساب دفتر جزء دریافت با ماهیت ابزار منطبق نیست.');
    const payload = { profileId: input.profileId, parts: input.parts, amountRials: input.amountRials, reason: input.reason, reference: input.reference };
    let checkId = prior?.checkInstrumentId ?? undefined;
    if (part.kind === 'CHECK') {
      if (!part.check?.serialNumber.trim() || !part.check.bankName.trim() || !Number.isFinite(part.check.dueAt.getTime())) invalid('شماره، بانک و سررسید چک لازم است.');
      if (!checkId) checkId = (await createReceivableCheckPrisma(tx, { legalEntityId: input.legalEntityId, profileId: input.profileId,
        ...part.check!, amountRials: part.amountRials, occurredAt: input.occurredAt, evidence: payload, actor: input.actor })).id;
    } else if (part.check) invalid('اطلاعات چک فقط برای جزء چکی مجاز است.');
    const receipt = await recordCustomerReceiptPrisma(tx, { profileId: input.profileId, bookId: input.bookId, fiscalYearId: input.fiscalYearId,
      periodId: input.periodId, amountRials: part.amountRials, occurredAt: input.occurredAt, financialAccountId: part.financialAccountId,
      bankAccountLedgerId: part.ledgerAccountId, customerAdvanceLedgerId: input.customerAdvanceLedgerId,
      componentKind: part.kind, receiptGroupId: input.idempotencyKey, checkInstrumentId: checkId,
      source: { type: part.kind === 'CHECK' ? 'CHECK_INSTRUMENT' : 'CUSTOMER_ACCOUNT_RECEIPT', id: checkId ?? `${input.idempotencyKey}:${part.key}`, version: 1, payload },
      idempotencyKey: `${input.idempotencyKey}:${part.key}`, correlationId: input.idempotencyKey, actor: input.actor });
    receipts.push(receipt);
    const fee = part.feeRials ?? 0n;
    if (fee < 0n || fee > part.amountRials || (fee > 0n && part.kind === 'CHECK')) invalid('کارمزد این جزء دریافت معتبر نیست؛ کارمزد چک را با مدرک بانکی مستقل ثبت کنید.');
    if (fee > 0n) {
      const expense = part.feeLedgerAccountId ? await tx.accountingLedgerAccount.findUnique({ where: { id: part.feeLedgerAccountId } }) : null;
      if (!expense || expense.bookId !== input.bookId || expense.level !== 'MOIN' || expense.statementRole !== 'EXPENSE' || expense.retiredAt
        || expense.partyRequirement === 'REQUIRED' || expense.financialAccountRequirement === 'REQUIRED') invalid('حساب هزینه کارمزد شرکت معتبر باشد.');
      const feePayload = { receiptId: receipt.id, part, reason: input.reason, reference: input.reference };
      const evidence = { type: 'CUSTOMER_RECEIPT_FEE', id: receipt.id, version: 1, payload: feePayload, hash: hashAccountingEvidence(feePayload) };
      const line = (accountId: string, debit: boolean, financialAccountId?: string) => ({ accountId, financialAccountId,
        debitRials: debit ? fee : 0n, creditRials: debit ? 0n : fee, dimensions: [], description: 'کارمزد شرکت برای دریافت مشتری',
        originalAmount: fee.toString(), originalCurrency: 'IRR', rawAmountBeforeRounding: fee.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1, evidence });
      const app = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `ACC-${randomUUID()}` });
      const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
        idempotencyKey: `${input.idempotencyKey}:${part.key}:fee`, correlationId: input.idempotencyKey, description: input.reason,
        documentDate: input.occurredAt, occurredAt: input.occurredAt, source: evidence, actor: input.actor,
        lines: [line(expense!.id, true), line(part.ledgerAccountId, false, part.financialAccountId)] });
      await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: input.reason });
    }
  }
  return { id: input.idempotencyKey, receiptIds: receipts.map(receipt => receipt.id) };
}
