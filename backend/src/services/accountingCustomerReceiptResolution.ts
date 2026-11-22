import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { requireCustomerSourceSharesWithin } from './customerSemanticCompatibility';
import { AccountingCustomerTreasuryError, type CustomerTreasuryActor } from './accountingCustomerTreasury';
import { createReceivableCheckPrisma, allocateCustomerReceiptPrisma, reverseCustomerAllocationPrisma, requireCustomerConsumptionDate, requireSettlementSource } from './accountingCustomerTreasuryPrisma';
import { effectiveCustomerReceiptRials, collectedCustomerCheckRials } from './accountingCustomerReceiptBalance';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';
import type { CustomerReceiptPart } from './accountingCustomerReceiptParts';

export type CustomerResolvedReceiptShare = { partKey: string; allocations: Array<{ openItemId: string; amountRials: bigint }>;
  refunds: Array<{ refundId: string; amountRials: bigint }> };
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v));
const money = (value: { toString(): string }) => BigInt(value.toString());
export async function resolveCustomerReceiptWithin(tx: Prisma.TransactionClient, input: {
  profileId: string; receiptId: string; expectedAmountRials: bigint; parts: Array<CustomerReceiptPart & { existingCheckId?: string }>;
  shares: CustomerResolvedReceiptShare[]; bookId: string; fiscalYearId: string; periodId: string; occurredAt: Date;
  customerAdvanceLedgerId: string; receivableLedgerId: string; reason: string; reference: string; idempotencyKey: string; actor: CustomerTreasuryActor;
}) {
  await requireCustomerSourceSharesWithin(tx);
  const fail = (message: string): never => { throw new AccountingCustomerTreasuryError('RECEIPT_RESOLUTION_INVALID', message, 409); };
  const commandHash = hashAccountingEvidence({ ...input, actor: undefined });
  const prior = await tx.accountingCustomerReceiptResolution.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) { if (prior.commandHash !== commandHash) fail('کلید تطبیق برای اطلاعات دیگری استفاده شده است.'); return { id: prior.id }; }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.receiptId}))`;
  const original = await tx.accountingTreasuryTransaction.findUnique({ where: { id: input.receiptId }, include: {
    profile: true, sourceResolution: true, adjustments: { include: { ledgerVoucher: true } }, allocations: { where: { reversesId: null, reversedById: null }, include: { lines: true } },
  } });
  if (!original?.profile || original.profileId !== input.profileId || original.kind !== 'CUSTOMER_RECEIPT' || original.checkInstrumentId || original.sourceParentId || original.sourceResolution) fail('دریافت قدیمیِ فاقد تطبیق را انتخاب کنید.');
  const current = effectiveCustomerReceiptRials(original!);
  if (current !== input.expectedAmountRials || current <= 0n || !input.parts.length || input.parts.reduce((sum, row) => sum + row.amountRials, 0n) !== current
    || new Set(input.parts.map(row => row.key)).size !== input.parts.length || new Set(input.shares.map(row => row.partKey)).size !== input.shares.length
    || input.shares.length !== input.parts.length || input.shares.some(row => !input.parts.some(part => part.key === row.partKey))) fail('مبلغ مؤثر، اجزا و سهم‌های تأییدشده تطبیق منطبق نیست.');
  await requireCustomerConsumptionDate(tx, { receiptId: original!.id }, input.occurredAt);
  await requireSettlementSource(tx, original!.postedVoucherId, input.bookId, input.occurredAt);
  if (original!.adjustments.some(row => row.occurredAt > input.occurredAt)) fail('تطبیق نباید پیش از اصلاح ثبت‌شده انجام شود.');
  const refunds = await tx.accountingTreasuryTransaction.findMany({ where: { refundOfId: original!.id, kind: 'CUSTOMER_REFUND' } });
  const expected = new Map<string, bigint>();
  for (const allocation of original!.allocations) for (const line of allocation.lines) expected.set(line.openItemId, (expected.get(line.openItemId) ?? 0n) + money(line.amountRials));
  const assigned = new Map<string, bigint>();
  for (const share of input.shares) {
    if (new Set(share.allocations.map(row => row.openItemId)).size !== share.allocations.length || new Set(share.refunds.map(row => row.refundId)).size !== share.refunds.length) fail('ریز تخصیص یا استرداد هر ابزار تکراری است.');
    for (const line of share.allocations) { if (line.amountRials <= 0n) fail('سهم مصرف باید مثبت باشد.'); assigned.set(line.openItemId, (assigned.get(line.openItemId) ?? 0n) + line.amountRials); }
    if (share.refunds.some(row => row.amountRials <= 0n || !refunds.some(refund => refund.id === row.refundId))) fail('استرداد قدیمی متعلق به دریافت نیست.');
    if (share.allocations.reduce((sum, row) => sum + row.amountRials, 0n) + share.refunds.reduce((sum, row) => sum + row.amountRials, 0n) > input.parts.find(row => row.key === share.partKey)!.amountRials) fail('مصرف و استرداد از مبلغ ابزار بیشتر است.');
  }
  if (assigned.size !== expected.size || [...expected].some(([id, amount]) => assigned.get(id) !== amount)
    || refunds.some(refund => input.shares.flatMap(row => row.refunds).filter(row => row.refundId === refund.id).reduce((sum, row) => sum + row.amountRials, 0n) !== money(refund.amountRials))) fail('تمام مصرف‌ها و استردادهای قبلی باید دقیقاً میان ابزارها تطبیق شوند.');
  const voucher = await tx.accountingLedgerVoucher.findUniqueOrThrow({ where: { id: original!.postedVoucherId! }, include: { lines: { include: { account: true } } } });
  const oldAssets = voucher.lines.filter(row => row.account.statementRole === 'ASSET' && row.accountId !== input.receivableLedgerId && money(row.debitRials) > 0n);
  if (oldAssets.length !== 1) fail('سند قدیمی برای تطبیق حساب منشأ یکتا ندارد.');
  const evidence = { type: 'CUSTOMER_RECEIPT_RESOLUTION', id: input.idempotencyKey, version: 1, payload: { ...input, actor: undefined }, hash: commandHash };
  const line = (accountId: string, value: bigint, debit: boolean, partyId?: string, financialAccountId?: string) => ({ accountId, partyId, financialAccountId,
    debitRials: debit ? value : 0n, creditRials: debit ? 0n : value, description: input.reason, dimensions: [], originalAmount: value.toString(),
    originalCurrency: 'IRR', rawAmountBeforeRounding: value.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1, evidence });
  const assets: ReturnType<typeof line>[] = [];
  const carrying = new Map<string, { accountId: string; partyId?: string; financialAccountId?: string; value: bigint }>();
  const addCarrying = (accountId: string, value: bigint, partyId?: string, financialAccountId?: string) => {
    const key = `${accountId}:${partyId ?? ''}:${financialAccountId ?? ''}`;
    const prior = carrying.get(key);
    carrying.set(key, { accountId, partyId, financialAccountId, value: (prior?.value ?? 0n) + value });
  };
  addCarrying(oldAssets[0].accountId, current, oldAssets[0].partyId ?? undefined, oldAssets[0].financialAccountId ?? undefined);
  const carriedEvents = new Set<string>();
  const children: Array<{ id: string; key: string }> = [];
  for (const part of input.parts) {
    const [financial, account] = await Promise.all([tx.accountingFinancialAccount.findUnique({ where: { id: part.financialAccountId } }), tx.accountingLedgerAccount.findUnique({ where: { id: part.ledgerAccountId } })]);
    const existing = part.existingCheckId ? await tx.accountingCheckInstrument.findUnique({ where: { id: part.existingCheckId }, include: { receipt: true, events: { orderBy: { sequence: 'asc' } } } }) : null;
    const collected = part.kind === 'CHECK' && existing?.status === 'CLEARED';
    const evidencedCollection = existing ? collectedCustomerCheckRials(existing, input.occurredAt) : 0n;
    if (!part.key.trim() || part.amountRials <= 0n || !['BANK', 'CASH', 'CARD', 'CHECK'].includes(part.kind) || part.feeRials || part.feeLedgerAccountId
      || !financial || financial.legalEntityId !== original!.profile!.legalEntityId || financial.currency !== 'IRR' || financial.activeFrom > input.occurredAt || (financial.activeTo && financial.activeTo < input.occurredAt)
      || !account || account.bookId !== input.bookId || account.level !== 'MOIN' || account.retiredAt || account.statementRole !== 'ASSET' || account.normalSide !== 'DEBIT'
      || [input.receivableLedgerId, input.customerAdvanceLedgerId].includes(account.id)
      || (part.kind === 'CHECK' && !collected ? account.partyRequirement !== 'REQUIRED' || account.financialAccountRequirement !== 'FORBIDDEN' : account.financialAccountRequirement === 'FORBIDDEN')) fail('نوع ابزار، حساب منشأ و حساب مالی تطبیق معتبر نیست؛ کارمزد مسیر مستقل دارد.');
    let checkId: string | undefined;
    if (part.kind === 'CHECK') {
      if (part.existingCheckId) {
        if (!existing || existing.profileId !== input.profileId || existing.legalEntityId !== original!.profile!.legalEntityId || existing.receipt || money(existing.amountRials) !== part.amountRials
          || !['RECEIVED', 'DEPOSITED', 'CLEARED'].includes(existing.status) || money(existing.unpaidRials) !== 0n || existing.events.some(event => event.occurredAt > input.occurredAt)
          || (collected ? evidencedCollection !== part.amountRials : evidencedCollection !== money(existing.clearedRials) || evidencedCollection >= part.amountRials)) fail('ابزار موجود باید متعلق به مشتری، دارای وضعیت مستند، بدون دریافت مرتبط و با مبلغ منطبق باشد.');
        for (const event of existing!.events) if (event.ledgerVoucherId && event.ledgerVoucherId !== original!.postedVoucherId && !carriedEvents.has(event.ledgerVoucherId)) {
          const movement = await tx.accountingLedgerVoucher.findUnique({ where: { id: event.ledgerVoucherId }, include: { lines: { include: { account: true } } } });
          if (!movement || movement.status !== 'POSTED' || movement.bookId !== input.bookId || movement.documentDate > input.occurredAt
            || movement.sourceType !== 'CHECK_INSTRUMENT' || movement.sourceId !== existing!.id) fail('سند گردش تاریخی ابزار با دفتر و هویت آن منطبق نیست.');
          carriedEvents.add(movement!.id);
          for (const entry of movement!.lines.filter(row => row.account.statementRole === 'ASSET')) addCarrying(entry.accountId,
            money(entry.debitRials) - money(entry.creditRials), entry.partyId ?? undefined, entry.financialAccountId ?? undefined);
        }
        const deposit = existing!.events.filter(event => event.eventType === 'DEPOSITED').at(-1);
        const depositAccount = (deposit?.evidence as { assetLedgerId?: string } | undefined)?.assetLedgerId;
        if (existing!.status === 'DEPOSITED' && depositAccount && depositAccount !== part.ledgerAccountId) fail('معین اسناد در جریان وصول با مدرک واگذاری موجود منطبق نیست.');
        checkId = existing!.id;
      } else {
        if (!part.check?.serialNumber.trim() || !part.check.bankName.trim() || !Number.isFinite(part.check.dueAt.getTime())) fail('مدرک شماره، بانک و سررسید ابزار قدیمی لازم است.');
        checkId = (await createReceivableCheckPrisma(tx, { ...part.check!, amountRials: part.amountRials, profileId: input.profileId, legalEntityId: original!.profile!.legalEntityId,
          occurredAt: input.occurredAt, evidence: evidence.payload, actor: input.actor })).id;
      }
      const share = input.shares.find(row => row.partKey === part.key)!;
      let refunded = 0n;
      for (const assignedRefund of [...share.refunds].sort((a, b) => refunds.find(row => row.id === a.refundId)!.occurredAt.getTime() - refunds.find(row => row.id === b.refundId)!.occurredAt.getTime())) {
        refunded += assignedRefund.amountRials;
        const refund = refunds.find(row => row.id === assignedRefund.refundId)!;
        if (!existing || collectedCustomerCheckRials(existing, refund.occurredAt) < refunded + share.allocations.reduce((sum, row) => sum + row.amountRials, 0n)) fail('استرداد قبلی را نمی‌توان به چک فاقد وصول مستند و وجه آزاد کافی نسبت داد؛ سهم وجه وصول‌شده را تطبیق دهید.');
      }
    } else if (part.check || part.existingCheckId) fail('اطلاعات چک فقط برای ابزار چکی مجاز است.');
    if (part.kind === 'CHECK' && !collected && evidencedCollection > 0n) {
      const bank = part.collectedLedgerAccountId ? await tx.accountingLedgerAccount.findUnique({ where: { id: part.collectedLedgerAccountId } }) : null;
      if (!bank || bank.bookId !== input.bookId || bank.level !== 'MOIN' || bank.retiredAt || bank.statementRole !== 'ASSET' || bank.normalSide !== 'DEBIT'
        || bank.partyRequirement === 'REQUIRED' || bank.financialAccountRequirement !== 'REQUIRED' || financial!.kind !== 'BANK') fail('برای وصول جزئی تاریخی، معین بانکیِ بخش وصول‌شده را مشخص کنید.');
      assets.push(line(bank!.id, evidencedCollection, true, undefined, financial!.id));
    }
    assets.push(line(account!.id, part.kind === 'CHECK' && !collected ? part.amountRials - evidencedCollection : part.amountRials, true,
      part.kind === 'CHECK' && !collected ? original!.profile!.accountingPartyId : undefined, part.kind === 'CHECK' && !collected ? undefined : financial!.id));
    const child = await tx.accountingTreasuryTransaction.create({ data: { profileId: input.profileId, contractId: original!.contractId, financialAccountId: financial!.id,
      kind: 'CUSTOMER_RECEIPT', direction: 'INBOUND', amountRials: part.amountRials.toString(), componentKind: part.kind, checkInstrumentId: checkId,
      receiptGroupId: input.idempotencyKey, sourceParentId: original!.id, sourceAssetLedgerId: account!.id, occurredAt: original!.occurredAt, postedVoucherId: original!.postedVoucherId,
      sourceType: 'CUSTOMER_RECEIPT_RESOLUTION', sourceId: `${input.idempotencyKey}:${part.key}`, sourceVersion: 1, sourceHash: commandHash, idempotencyKey: `${input.idempotencyKey}:${part.key}`, createdBy: input.actor.id } });
    children.push({ id: child.id, key: part.key });
    for (const assignedRefund of input.shares.find(row => row.partKey === part.key)!.refunds) {
      const refund = refunds.find(row => row.id === assignedRefund.refundId)!;
      await tx.accountingTreasuryTransaction.create({ data: { profileId: input.profileId, kind: 'CUSTOMER_REFUND', direction: 'OUTBOUND', financialAccountId: refund.financialAccountId,
        amountRials: assignedRefund.amountRials.toString(), refundOfId: child.id, legacyRefundId: refund.id, sourceParentId: original!.id, postedVoucherId: refund.postedVoucherId,
        occurredAt: refund.occurredAt, sourceType: 'CUSTOMER_RECEIPT_RESOLUTION_REFUND', sourceId: `${child.id}:${refund.id}`, sourceVersion: 1, sourceHash: commandHash,
        idempotencyKey: `${input.idempotencyKey}:${part.key}:refund:${refund.id}`, createdBy: input.actor.id } });
    }
  }
  // Only reclassify the asset. Customer advance, revenue, tax and cash receipt totals are unchanged.
  if ([...carrying.values()].some(row => row.value < 0n) || [...carrying.values()].reduce((sum, row) => sum + row.value, 0n) !== current) fail('مانده حساب‌های منشأ با گردش تاریخی ابزار منطبق نیست؛ سندهای ناقص را پیش از تطبیق تعیین تکلیف کنید.');
  for (const row of carrying.values()) if (row.value > 0n) assets.push(line(row.accountId, row.value, false, row.partyId, row.financialAccountId));
  const app = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `ACC-${randomUUID()}` });
  const draft = await app.createManualDraft({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId, documentDate: input.occurredAt, occurredAt: input.occurredAt,
    source: evidence, actor: input.actor, description: input.reason, idempotencyKey: input.idempotencyKey, correlationId: input.idempotencyKey, lines: assets });
  const posted = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: input.reason });
  const context = { bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId, documentDate: input.occurredAt, customerAdvanceLedgerId: input.customerAdvanceLedgerId,
    receivableLedgerId: input.receivableLedgerId, actor: input.actor, correlationId: input.idempotencyKey, reason: input.reason, reference: input.reference };
  for (const allocation of original!.allocations) await reverseCustomerAllocationPrisma(tx, { ...context, allocationId: allocation.id, idempotencyKey: `${input.idempotencyKey}:reverse:${allocation.id}` });
  for (const share of input.shares) if (share.allocations.length) await allocateCustomerReceiptPrisma(tx, { ...context, treasuryTransactionId: children.find(row => row.key === share.partKey)!.id,
    allocations: share.allocations, idempotencyKey: `${input.idempotencyKey}:allocate:${share.partKey}` });
  const result = await tx.accountingCustomerReceiptResolution.create({ data: { receiptId: original!.id, occurredAt: input.occurredAt, commandHash, idempotencyKey: input.idempotencyKey,
    evidence: json({ ...input, children, ledgerVoucherId: posted.id }), createdBy: input.actor.id } });
  return { id: result.id };
}
