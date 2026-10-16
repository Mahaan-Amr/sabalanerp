import { Prisma } from '@prisma/client';
import { AccountingCustomerTreasuryError, type CustomerTreasuryActor } from './accountingCustomerTreasury';
import { createAccountingSupplyChainApplication, hashSupplyChainEvidence, type ImmutableEvidence } from './accountingSupplyChain';
import { createAccountingSupplyChainPrismaRepository } from './accountingSupplyChainPrismaRepository';
import { createSupplyChainLedgerPosting } from './accountingSupplyChainPosting';
import { hashAccountingEvidence } from './accountingLedgerFoundation';
import { requireSettlementSource } from './accountingCustomerTreasuryPrisma';
import { requireCustomerReceiptSourceDate } from './accountingCustomerReceiptSource';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === 'bigint' ? v.toString() : v));
export async function recordCustomerCheckEndorsementWithin(tx: Prisma.TransactionClient, input: {
  kind: 'CHECK_ENDORSE' | 'CHECK_RECIPIENT_RETURN'; profileId: string; receiptId: string; expectedSequence: number;
  supplierPartyId?: string; allocations: Array<{ openItemId: string; amountRials: bigint }>;
  bookId: string; fiscalYearId: string; periodId: string; occurredAt: Date; reason: string; reference: string; idempotencyKey: string; actor: CustomerTreasuryActor;
}) {
  const fail = (message: string): never => { throw new AccountingCustomerTreasuryError('CHECK_ENDORSEMENT_INVALID', message, 409); };
  const hash = hashAccountingEvidence({ ...input, actor: undefined });
  const prior = await tx.accountingCheckInstrumentEvent.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (prior) { if (prior.evidenceHash !== hash) fail('کلید گردش چک برای اطلاعات دیگری استفاده شده است.'); return prior; }
  const receipt = await tx.accountingTreasuryTransaction.findUnique({ where: { id: input.receiptId }, include: { profile: true, checkInstrument: { include: { events: { orderBy: { sequence: 'desc' } } } } } });
  if (!receipt?.checkInstrument || !receipt.profile || receipt.profileId !== input.profileId || receipt.kind !== 'CUSTOMER_RECEIPT' || receipt.componentKind !== 'CHECK') fail('دریافت و ابزار مرتبط این مشتری را انتخاب کنید.');
  const check = receipt!.checkInstrument!;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-check:${check.id}`}))`;
  await requireSettlementSource(tx, receipt!.postedVoucherId, input.bookId, input.occurredAt);
  await requireCustomerReceiptSourceDate(tx, receipt!, input.occurredAt);
  const last = check.events[0];
  if (!last || last.sequence !== input.expectedSequence || input.occurredAt < last.occurredAt || input.idempotencyKey.length < 8) fail('نسخه یا تاریخ گردش چک معتبر نیست؛ پرونده را به‌روز کنید.');
  const voucher = await tx.accountingLedgerVoucher.findUniqueOrThrow({ where: { id: receipt!.postedVoucherId! }, include: { lines: { include: { account: true } } } });
  const custody = receipt!.sourceAssetLedgerId ?? voucher.lines.find(row => row.account.statementRole === 'ASSET' && row.account.partyRequirement === 'REQUIRED' && BigInt(row.debitRials.toString()) > 0n)?.accountId;
  if (!custody || !check.sayadId || !/^\d{16}$/.test(check.sayadId)) fail('معین حضانت و شناسه صیاد معتبر برای واگذاری لازم است.');
  const makeEvidence = (type: string, payload: unknown): ImmutableEvidence => ({ type, id: input.idempotencyKey, version: last.sequence + 1, payload, hash: hashSupplyChainEvidence(payload) });
  const paymentEvidence = makeEvidence('CUSTOMER_PAYMENT_STATUS', { receiptId: receipt!.id, postedVoucherId: receipt!.postedVoucherId, checkId: check.id, sourceHash: receipt!.sourceHash });
  const transitionEvidence = makeEvidence(input.kind === 'CHECK_ENDORSE' ? 'TREASURY_CUSTOMER_CHECK_ENDORSEMENT' : 'TREASURY_CHECK_STATUS', { ...input, actor: undefined, checkId: check.id });
  const app = createAccountingSupplyChainApplication(createAccountingSupplyChainPrismaRepository(tx), {
    now: () => input.occurredAt, post: createSupplyChainLedgerPosting(tx, { accountId: custody!, partyId: receipt!.profile!.accountingPartyId }), customerCheckCoordination: true,
    resolveEvidence: async (candidate, allowed) => {
      const known = [paymentEvidence, transitionEvidence].find(evidence => evidence.type === candidate.type && evidence.id === candidate.id && evidence.version === candidate.version && evidence.hash === candidate.hash);
      if (!known || !allowed.includes(known.type)) fail('شاهد گردش ابزار معتبر نیست.');
      return known!;
    },
  });
  let supplierCheckId: string;
  let ledgerVoucherId: string;
  if (input.kind === 'CHECK_ENDORSE') {
    if (check.status !== 'RECEIVED' || BigInt(check.clearedRials.toString()) !== 0n || BigInt(check.unpaidRials.toString()) !== 0n || !input.supplierPartyId) fail('فقط چک معتبر نزد صندوق و بدون نتیجه بانکی قابل خرج‌کردن است.');
    const supplier = await tx.accountingParty.findUnique({ where: { id: input.supplierPartyId! }, include: { roles: true } });
    if (!supplier || supplier.legalEntityId !== receipt!.profile!.legalEntityId || supplier.activeFrom > input.occurredAt || (supplier.activeTo && supplier.activeTo < input.occurredAt)
      || !supplier.roles.some(role => role.role === 'SUPPLIER' && role.effectiveFrom <= input.occurredAt && (!role.effectiveTo || role.effectiveTo >= input.occurredAt))) fail('گیرنده باید تأمین‌کننده فعال همین شرکت باشد.');
    const reused = await tx.accountingPayableCheck.findUnique({ where: { sayadId: check.sayadId! } });
    const result = await app.assignCustomerCheck({ bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId, documentDate: input.occurredAt,
      sayadId: check.sayadId!, amountRials: BigInt(check.amountRials.toString()), supplierPartyId: supplier!.id, financialAccountId: receipt!.financialAccountId, dueDate: check.dueAt,
      sourceCustomerPaymentId: receipt!.id, idempotencyKey: input.idempotencyKey, receiptEvidence: paymentEvidence, endorsementEvidence: transitionEvidence, actor: input.actor,
      allocations: input.allocations, reuseReturnedCheckId: reused?.status === 'RETURNED' ? reused.id : undefined });
    if (!result.voucherId) fail('گردش تأمین‌کننده قبلاً با فرمان دیگری ثبت شده است.');
    supplierCheckId = result.checkId; ledgerVoucherId = result.voucherId!;
  } else {
    if (check.status !== 'ENDORSED' || !check.custodianId || input.allocations.length) fail('چک خرج‌شده مرتبط را برای بازگشت از گیرنده انتخاب کنید.');
    const supplierCheck = await tx.accountingPayableCheck.findUnique({ where: { id: check.custodianId! } });
    if (!supplierCheck || supplierCheck.sourceCustomerPaymentId !== receipt!.id || supplierCheck.kind !== 'ASSIGNED_CUSTOMER'
      || !['ENDORSED', 'DELIVERED', 'DEPOSITED'].includes(supplierCheck.status)) fail('گردش گیرنده با ابزار مشتری منطبق نیست.');
    await app.transitionCheck({ checkId: supplierCheck!.id, to: 'RETURNED', bookId: input.bookId, fiscalYearId: input.fiscalYearId, periodId: input.periodId,
      documentDate: input.occurredAt, reason: input.reason, evidence: transitionEvidence, actor: input.actor });
    const posted = await tx.accountingLedgerVoucher.findUniqueOrThrow({ where: { idempotencyKey: `ledger:check-state:${transitionEvidence.id}:${transitionEvidence.version}` } });
    supplierCheckId = supplierCheck!.id; ledgerVoucherId = posted.id;
  }
  const event = await tx.accountingCheckInstrumentEvent.create({ data: { checkInstrumentId: check.id, sequence: last.sequence + 1,
    eventType: input.kind === 'CHECK_ENDORSE' ? 'ENDORSED' : 'RECIPIENT_RETURNED', occurredAt: input.occurredAt, actorId: input.actor.id,
    idempotencyKey: input.idempotencyKey, ledgerVoucherId, evidence: json({ ...input, supplierCheckId, custodyLedgerId: custody }), evidenceHash: hash } });
  await tx.accountingCheckInstrument.update({ where: { id: check.id }, data: { status: input.kind === 'CHECK_ENDORSE' ? 'ENDORSED' : 'RECEIVED', custodianId: input.kind === 'CHECK_ENDORSE' ? supplierCheckId : null } });
  return event;
}
