import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { AccountingCustomerTreasuryError, type CustomerTreasuryActor } from './accountingCustomerTreasury';
import { projectCustomerAccountPrisma, projectCustomerAccountsPrisma, customerStatementMovements, recordCustomerReceiptPrisma, allocateCustomerReceiptPrisma, reverseCustomerAllocationPrisma } from './accountingCustomerTreasuryPrisma';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from './accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from './accountingLedgerPrismaRepository';
import { withAccountingReadScope } from './partnerSales/accounting/readScope';
import { customerCreditBalance } from './specialCustomerCredit';

type Database = PrismaClient | Prisma.TransactionClient;
const fail = (code: string, message: string, status = 409): never => { throw new AccountingCustomerTreasuryError(code, message, status); };
const amount = (value: { toString(): string }) => BigInt(value.toString());
const customerName = (customer: { companyName: string | null; firstName: string; lastName: string }) => customer.companyName?.trim() || `${customer.firstName} ${customer.lastName}`.trim();

export async function resolveCustomerWorkspace(database: Database, id: string) {
  const profile = id.startsWith('customer:') ? null : await database.accountingCustomerProfile.findUnique({ where: { id } });
  if (!id.startsWith('customer:') && !profile) return fail('CUSTOMER_PROFILE_NOT_FOUND', 'پرونده مالی مشتری پیدا نشد.', 404);
  if (profile && profile.partySourceKind !== 'CUSTOMER') return fail('DIRECT_CUSTOMER_REQUIRED', 'این پرونده متعلق به مشتری مستقیم سبلان نیست.', 403);
  const customerId = profile?.partySourceId ?? id.slice('customer:'.length);
  const customer = await database.crmCustomer.findUnique({ where: { id: customerId }, select: {
    id: true, firstName: true, lastName: true, companyName: true, trustCategory: true, creditLimitRials: true,
    partnerOwnerProfileId: true, cardDeletedAt: true, isActive: true, workNumber: true, homeNumber: true,
  } });
  if (customer?.partnerOwnerProfileId) return fail('DIRECT_CUSTOMER_REQUIRED', 'پرونده مشتری همکار تابع دسترسی همان پرونده فروش است.', 403);
  if (!customer && !profile) return fail('CUSTOMER_NOT_FOUND', 'مشتری پیدا نشد.', 404);
  const book = await database.accountingBook.findFirst({ where: { isPrimary: true, ...(profile ? { legalEntityId: profile.legalEntityId } : {}) }, orderBy: { createdAt: 'asc' } });
  const actualProfile = profile ?? (book ? await database.accountingCustomerProfile.findUnique({ where: {
    legalEntityId_partySourceKind_partySourceId: { legalEntityId: book.legalEntityId, partySourceKind: 'CUSTOMER', partySourceId: customerId },
  } }) : null);
  return { customerId, customer, profile: actualProfile, book, displayName: customer ? customerName(customer) : profile!.displayName };
}

// Reading a CRM-only account must not create an accounting identity or an approval relationship.
export async function ensureCustomerWorkspaceProfile(database: Database, id: string, actor: CustomerTreasuryActor, effectiveFrom = new Date()) {
  if (actor.profile === 'VIEWER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات مالی ندارید.', 403);
  const resolved = await resolveCustomerWorkspace(database, id);
  if (!resolved.book) return fail('ACCOUNTING_SETUP_REQUIRED', 'ابتدا دفتر حسابداری را راه‌اندازی کنید.');
  if (resolved.profile) return resolved.profile;
  if (!resolved.customer || resolved.customer.cardDeletedAt) return fail('HISTORICAL_CUSTOMER', 'برای مشتری حذف‌شده پرونده مالی جدید ایجاد نمی‌شود.');
  const identity = { legalEntityId: resolved.book.legalEntityId, sourceKind: 'CUSTOMER', sourceId: resolved.customerId };
  const party = await database.accountingParty.upsert({ where: { legalEntityId_sourceKind_sourceId: identity },
    create: { ...identity, displayName: resolved.displayName, activeFrom: effectiveFrom }, update: {} });
  if (!await database.accountingPartyRoleAssignment.findFirst({ where: { partyId: party.id, role: 'CUSTOMER', effectiveTo: null } })) {
    await database.accountingPartyRoleAssignment.create({ data: { partyId: party.id, role: 'CUSTOMER', effectiveFrom, createdBy: actor.id } });
  }
  const profile = await database.accountingCustomerProfile.upsert({ where: { legalEntityId_partySourceKind_partySourceId: {
    legalEntityId: identity.legalEntityId, partySourceKind: 'CUSTOMER', partySourceId: identity.sourceId,
  } }, create: { legalEntityId: identity.legalEntityId, partySourceKind: 'CUSTOMER', partySourceId: identity.sourceId,
    accountingPartyId: party.id, displayName: resolved.displayName, activeFrom: effectiveFrom, createdBy: actor.id }, update: {} });
  await createAccountingLedgerPrismaRepository(database, true).appendAudit({ action: 'CUSTOMER_ACCOUNT_CREATED', result: 'SUCCEEDED',
    actorId: actor.id, effectiveProfile: actor.profile, entityType: 'CUSTOMER_ACCOUNT', entityId: profile.id,
    correlationId: randomUUID(), reason: 'ایجاد پرونده بدون مانده برای عملیات صریح حسابدار', payloadHash: hashAccountingEvidence(identity) });
  return profile;
}

export async function listCustomerWorkspaceAccounts(database: PrismaClient, input: { search?: string; page?: number; pageSize?: number; asOf: Date }) {
  if ((input.page != null && !Number.isNaN(input.page) && (!Number.isSafeInteger(input.page) || input.page < 1))
    || (input.pageSize != null && !Number.isNaN(input.pageSize) && (!Number.isSafeInteger(input.pageSize) || input.pageSize < 1))) return fail('INVALID_PAGINATION', 'شماره صفحه معتبر نیست.', 400);
  const page = Math.max(1, Math.floor(input.page || 1));
  const pageSize = Math.min(50, Math.max(1, Math.floor(input.pageSize || 25)));
  const search = input.search?.trim();
  const where: Prisma.CrmCustomerWhereInput = { partnerOwnerProfileId: null, ...(search ? { OR: ['firstName', 'lastName', 'companyName', 'nationalCode'].map(key => ({ [key]: { contains: search, mode: 'insensitive' } })) } : {}) };
  return database.$transaction(async tx => {
    const [customers, total, book] = await Promise.all([
      tx.crmCustomer.findMany({ where, select: { id: true, firstName: true, lastName: true, companyName: true, trustCategory: true, cardDeletedAt: true },
        orderBy: [{ lastName: 'asc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      tx.crmCustomer.count({ where }), tx.accountingBook.findFirst({ where: { isPrimary: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const profiles = book ? await tx.accountingCustomerProfile.findMany({ where: { legalEntityId: book.legalEntityId, partySourceKind: 'CUSTOMER', partySourceId: { in: customers.map(row => row.id) } } }) : [];
    const projections = await projectCustomerAccountsPrisma(tx, { profileIds: profiles.map(row => row.id), asOf: input.asOf });
    const items = customers.map(customer => {
      const profile = profiles.find(row => row.partySourceId === customer.id);
      const projection = profile ? projections.find(row => row.profile.id === profile.id) : null;
      const receivable = projection?.receivableRials ?? 0n;
      const unallocated = projection?.unallocatedCreditRials ?? 0n;
      return { id: profile?.id ?? `customer:${customer.id}`, customerId: customer.id, displayName: customerName(customer),
        trustCategory: customer.trustCategory, historical: Boolean(customer.cardDeletedAt), receivableRials: receivable,
        unallocatedCreditRials: unallocated, netBalanceRials: receivable - unallocated, openItemCount: projection?.openItems.length ?? 0,
        hasActivity: Boolean(projection && (projection.activityItems.length || projection.receipts.length)) };
    });
    return { items, total, page, pageSize };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 });
}

export async function readCustomerWorkspace(database: PrismaClient, input: { id: string; asOf: Date; userId: string }) {
  return withAccountingReadScope(database, { userId: input.userId }, async scope => {
    const tx = scope.database;
    const resolved = await resolveCustomerWorkspace(tx, input.id);
    const projection = resolved.profile ? await projectCustomerAccountPrisma(tx, { profileId: resolved.profile.id, asOf: input.asOf }) : null;
    const contracts = await tx.salesContract.findMany({ where: { customerId: resolved.customerId, partnerKind: null, partnerCaseId: null, createdAt: { lte: input.asOf } },
      select: { id: true, contractNumber: true, titlePersian: true, totalAmount: true, currency: true, status: true, isInactive: true,
        createdAt: true, commercialFlowVersion: true, commercialRevision: true, salesApprovalRevision: true, customerAcceptanceRevision: true,
        customerCreditAmountRials: true, customerCreditPromisedDate: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] });
    const contractIds = contracts.map(row => row.id);
    const [financialRecords, receivables, payments, treasuryChecks] = await Promise.all([
      tx.accountingFinancialRecord.findMany({ where: scope.financial({ OR: [{ customerId: resolved.customerId }, { contractId: { in: contractIds } }], createdAt: { lte: input.asOf } }),
        select: { id: true, contractId: true, kind: true, status: true, amount: true, currency: true, systemInvoiceNumber: true, createdAt: true, financiallyApprovedAt: true }, orderBy: { createdAt: 'desc' } }),
      tx.accountingReceivable.findMany({ where: scope.receivable({ OR: [{ customerId: resolved.customerId }, { contractId: { in: contractIds } }], createdAt: { lte: input.asOf } }),
        select: { id: true, contractId: true, originalAmount: true, remainingAmount: true, paidAmount: true, currency: true, dueDate: true, status: true }, orderBy: { dueDate: 'asc' } }),
      tx.accountingPaymentStatus.findMany({ where: scope.payment({ OR: [{ contractId: { in: contractIds } }, { receivable: { customerId: resolved.customerId } }], createdAt: { lte: input.asOf } }),
        select: { id: true, contractId: true, method: true, amount: true, currency: true, status: true, checkStatus: true, checkNumber: true, checkDueDate: true, occurredAt: true }, orderBy: { createdAt: 'desc' } }),
      resolved.profile ? tx.accountingCheckInstrument.findMany({ where: { profileId: resolved.profile.id, createdAt: { lte: input.asOf } }, select: { id: true, serialNumber: true, bankName: true, amountRials: true, dueAt: true, status: true, direction: true }, orderBy: { dueAt: 'asc' } }) : Promise.resolve([]),
    ]);
    const receivableRials = projection?.receivableRials ?? 0n;
    const unallocatedCreditRials = projection?.unallocatedCreditRials ?? 0n;
    const credit = resolved.customer && !resolved.customer.cardDeletedAt ? await customerCreditBalance(tx, resolved.customerId) : null;
    return { ...projection, movements: projection ? customerStatementMovements(projection) : [], credit, profile: projection?.profile ?? null, customerId: resolved.customerId, displayName: resolved.displayName,
      customer: resolved.customer, bookId: resolved.book?.id ?? null, receivableRials, unallocatedCreditRials,
      netBalanceRials: receivableRials - unallocatedCreditRials, contracts, financialRecords, receivables, payments, treasuryChecks,
      openItems: projection?.openItems ?? [], activityItems: projection?.activityItems ?? [], receipts: projection?.receipts ?? [], refunds: projection?.refunds ?? [] };
  });
}

export type CustomerAccountOperation = {
  kind: 'OPENING' | 'DEBIT' | 'CREDIT' | 'SET_BALANCE' | 'REFUND'; amountRials: bigint;
  periodId: string; postingRuleId: string; counterAccountId?: string; financialAccountId?: string; bankLedgerId?: string;
  receiptId?: string; creditItemId?: string; occurredAt: Date; reason: string; reference: string; confirmed: boolean;
  expectedBalanceRials?: bigint; idempotencyKey: string; actor: CustomerTreasuryActor;
};

export async function readCustomerWorkspaceContext(database: PrismaClient, id: string) {
  const { book } = await resolveCustomerWorkspace(database, id);
  if (!book) return { periods: [], rules: [], accounts: [], financialAccounts: [] };
  const [periods, rules, accounts, financialAccounts] = await Promise.all([
    database.accountingPostingPeriod.findMany({ where: { fiscalYear: { bookId: book.id }, status: 'OPEN' }, include: { fiscalYear: { select: { titlePersian: true } } }, orderBy: { startsAt: 'desc' } }),
    database.accountingCustomerPostingRule.findMany({ where: { legalEntityId: book.legalEntityId }, orderBy: { effectiveFrom: 'desc' } }),
    database.accountingLedgerAccount.findMany({ where: { bookId: book.id, level: 'MOIN', retiredAt: null }, select: { id: true, code: true, titlePersian: true, financialAccountRequirement: true, partyRequirement: true }, orderBy: { code: 'asc' } }),
    database.accountingFinancialAccount.findMany({ where: { legalEntityId: book.legalEntityId, activeTo: null }, select: { id: true, titlePersian: true, currency: true }, orderBy: { titlePersian: 'asc' } }),
  ]);
  return { periods, rules, accounts, financialAccounts };
}

export async function recordCustomerWorkspaceTreasury(database: PrismaClient, id: string, input: {
  kind: 'RECEIPT' | 'ALLOCATION' | 'REVERSE_ALLOCATION'; amountRials: bigint; occurredAt: Date;
  periodId: string; postingRuleId: string; financialAccountId?: string; bankLedgerId?: string; receiptId?: string;
  allocationId?: string; allocations: Array<{ openItemId: string; amountRials: bigint }>;
  reason: string; reference: string; confirmed: boolean; idempotencyKey: string; actor: CustomerTreasuryActor;
}) {
  if (!['RECEIPT', 'ALLOCATION', 'REVERSE_ALLOCATION'].includes(input.kind)) return fail('INVALID_OPERATION', 'نوع عملیات خزانه معتبر نیست.', 400);
  if (!input.confirmed || input.reason.trim().length < 8 || !input.reference.trim()) return fail('ACCOUNTING_EVIDENCE_REQUIRED', 'دلیل، مرجع مستندات و تأیید ثبت قطعی الزامی است.', 400);
  if (input.occurredAt > new Date()) return fail('INVALID_OPERATION_DATE', 'تاریخ عملیات نباید در آینده باشد.', 400);
  return database.$transaction(async tx => {
    const resolved = await resolveCustomerWorkspace(tx, id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-account:${resolved.customerId}`}))`;
    const profile = await ensureCustomerWorkspaceProfile(tx, id, input.actor, input.occurredAt);
    const [rule, period] = await Promise.all([
      tx.accountingCustomerPostingRule.findUnique({ where: { id: input.postingRuleId } }),
      tx.accountingPostingPeriod.findUnique({ where: { id: input.periodId }, include: { fiscalYear: true } }),
    ]);
    if (!rule || !period || rule.legalEntityId !== profile.legalEntityId || period.fiscalYear.bookId !== resolved.book?.id
      || rule.effectiveFrom > input.occurredAt || (rule.effectiveTo && rule.effectiveTo < input.occurredAt)) return fail('INVALID_ACCOUNTING_CONTEXT', 'دوره یا قاعده حسابداری مشتری معتبر نیست.');
    const context = { bookId: resolved.book!.id, fiscalYearId: period.fiscalYearId, periodId: period.id,
      idempotencyKey: input.idempotencyKey, correlationId: input.idempotencyKey, actor: input.actor };
    if (input.kind === 'RECEIPT') {
      const financial = input.financialAccountId ? await tx.accountingFinancialAccount.findUnique({ where: { id: input.financialAccountId } }) : null;
      if (!financial || financial.legalEntityId !== profile.legalEntityId || financial.currency !== 'IRR'
        || financial.activeFrom > input.occurredAt || (financial.activeTo && financial.activeTo < input.occurredAt) || !input.bankLedgerId) return fail('FINANCIAL_ACCOUNT_INVALID', 'حساب دریافت وجه معتبر نیست.');
      return recordCustomerReceiptPrisma(tx, { ...context, profileId: profile.id, amountRials: input.amountRials,
        occurredAt: input.occurredAt, financialAccountId: financial.id, bankAccountLedgerId: input.bankLedgerId,
        customerAdvanceLedgerId: rule.customerAdvanceAccountId,
        source: { type: 'CUSTOMER_ACCOUNT_RECEIPT', id: input.idempotencyKey, version: 1,
          payload: { customerId: resolved.customerId, reason: input.reason.trim(), reference: input.reference.trim() } } });
    }
    if (input.kind === 'ALLOCATION') {
      const receipt = await tx.accountingTreasuryTransaction.findUnique({ where: { id: input.receiptId || '' } });
      if (receipt?.profileId !== profile.id) return fail('RECEIPT_NOT_FOUND', 'دریافت متعلق به این مشتری نیست.', 404);
      return allocateCustomerReceiptPrisma(tx, { ...context, treasuryTransactionId: receipt!.id, allocations: input.allocations,
        documentDate: input.occurredAt, reason: input.reason.trim(), reference: input.reference.trim(), customerAdvanceLedgerId: rule.customerAdvanceAccountId, receivableLedgerId: rule.receivableAccountId });
    }
    const allocation = await tx.accountingSettlementAllocation.findUnique({ where: { id: input.allocationId || '' }, include: { transaction: true } });
    if (allocation?.transaction.profileId !== profile.id) return fail('ALLOCATION_NOT_FOUND', 'تخصیص متعلق به این مشتری نیست.', 404);
    return reverseCustomerAllocationPrisma(tx, { ...context, allocationId: allocation!.id, reason: input.reason.trim(), reference: input.reference.trim(), documentDate: input.occurredAt,
      customerAdvanceLedgerId: rule.customerAdvanceAccountId, receivableLedgerId: rule.receivableAccountId });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

export async function recordCustomerAccountOperation(database: PrismaClient, id: string, input: CustomerAccountOperation) {
  if (!['OPENING', 'DEBIT', 'CREDIT', 'SET_BALANCE', 'REFUND'].includes(input.kind)) return fail('INVALID_OPERATION', 'نوع عملیات مالی معتبر نیست.', 400);
  if (input.actor.profile === 'VIEWER') return fail('ACCOUNTING_WRITE_FORBIDDEN', 'مجوز ثبت عملیات مالی ندارید.', 403);
  if (!input.confirmed || input.reason.trim().length < 8 || !input.reference.trim() || input.idempotencyKey.length < 8) return fail('ACCOUNTING_EVIDENCE_REQUIRED', 'دلیل، مرجع مستندات و تأیید ثبت قطعی الزامی است.', 400);
  if (!Number.isFinite(input.occurredAt.getTime()) || input.occurredAt > new Date()) return fail('INVALID_OPERATION_DATE', 'تاریخ عملیات باید معتبر و تا امروز باشد.', 400);
  return database.$transaction(async tx => {
    const resolved = await resolveCustomerWorkspace(tx, id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`customer-account:${resolved.customerId}`}))`;
    const profile = await ensureCustomerWorkspaceProfile(tx, id, input.actor, input.occurredAt);
    const [period, rule] = await Promise.all([
      tx.accountingPostingPeriod.findUnique({ where: { id: input.periodId }, include: { fiscalYear: true } }),
      tx.accountingCustomerPostingRule.findUnique({ where: { id: input.postingRuleId } }),
    ]);
    if (!period || !rule || period.fiscalYear.bookId !== resolved.book?.id || rule.legalEntityId !== profile.legalEntityId
      || rule.effectiveFrom > input.occurredAt || (rule.effectiveTo && rule.effectiveTo < input.occurredAt)) return fail('INVALID_ACCOUNTING_CONTEXT', 'دوره یا قاعده حسابداری این مشتری معتبر نیست.');
    const payload = { customerId: resolved.customerId, kind: input.kind, amountRials: input.amountRials, periodId: input.periodId,
      postingRuleId: input.postingRuleId, counterAccountId: input.counterAccountId ?? null, financialAccountId: input.financialAccountId ?? null,
      bankLedgerId: input.bankLedgerId ?? null, receiptId: input.receiptId ?? null, creditItemId: input.creditItemId ?? null,
      occurredAt: input.occurredAt, reason: input.reason.trim(), reference: input.reference.trim(), expectedBalanceRials: input.expectedBalanceRials ?? null };
    const hash = hashAccountingEvidence(payload);
    const prior = await tx.accountingLedgerVoucher.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (prior) {
      if (prior.sourceType !== 'CUSTOMER_ACCOUNT_OPERATION' || prior.sourceHash !== hash || prior.status !== 'POSTED') return fail('IDEMPOTENCY_KEY_REUSED', 'این درخواست قبلاً با اطلاعات دیگری ثبت شده است.');
      return { profileId: profile.id, voucherId: prior.id };
    }
    const projection = await projectCustomerAccountPrisma(tx, { profileId: profile.id, asOf: new Date() });
    const balance = projection.receivableRials - projection.unallocatedCreditRials;
    if (input.kind === 'SET_BALANCE' && input.expectedBalanceRials !== balance) return fail('CUSTOMER_BALANCE_CHANGED', 'مانده مشتری تغییر کرده است؛ پرونده را به‌روز کنید و دوباره بررسی کنید.');
    if (input.kind === 'OPENING' && await tx.accountingCustomerOpenItem.findFirst({ where: { profileId: profile.id, sourceKind: 'OPENING' } })) return fail('OPENING_ALREADY_RECORDED', 'مانده افتتاحیه قبلاً ثبت شده؛ از تنظیم مانده استفاده کنید.');
    const delta = input.kind === 'SET_BALANCE' ? input.amountRials - balance : input.kind === 'CREDIT' ? -input.amountRials : input.amountRials;
    if (delta === 0n || ((input.kind === 'DEBIT' || input.kind === 'CREDIT' || input.kind === 'REFUND') && input.amountRials <= 0n)) return fail('INVALID_AMOUNT', 'مبلغ عملیات باید غیرصفر و دریافت یا استرداد باید مثبت باشد.', 400);
    const value = delta < 0n ? -delta : delta;
    let customerAccount = rule.receivableAccountId;
    let counterAccount = input.counterAccountId;
    if (input.kind === 'REFUND') {
      if (Boolean(input.receiptId) === Boolean(input.creditItemId)) return fail('REFUND_SOURCE_REQUIRED', 'یک دریافت تخصیص‌نیافته یا بستانکاری را برای استرداد انتخاب کنید.', 400);
      if (input.receiptId) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.receiptId}))`;
        const receipt = projection.receipts.find(row => row.id === input.receiptId);
        if (!receipt || receipt.amountRials - receipt.allocatedRials - receipt.refundedRials < value) return fail('REFUND_EXCEEDS_CREDIT', 'مبلغ استرداد از وجه قابل استرداد بیشتر است.');
        customerAccount = rule.customerAdvanceAccountId;
      } else {
        const credit = projection.openItems.find(row => row.id === input.creditItemId && row.kind === 'CREDIT');
        if (!credit || credit.remainingRials < value) return fail('REFUND_EXCEEDS_CREDIT', 'مبلغ استرداد از بستانکاری قابل استرداد بیشتر است.');
      }
      const financial = input.financialAccountId ? await tx.accountingFinancialAccount.findUnique({ where: { id: input.financialAccountId } }) : null;
      if (!financial || financial.currency !== 'IRR' || financial.legalEntityId !== profile.legalEntityId || financial.activeFrom > input.occurredAt || (financial.activeTo && financial.activeTo < input.occurredAt)) return fail('FINANCIAL_ACCOUNT_INVALID', 'حساب پرداخت وجه معتبر نیست.');
      counterAccount = input.bankLedgerId;
    }
    if (!counterAccount || counterAccount === customerAccount) return fail('COUNTER_ACCOUNT_REQUIRED', 'حساب مقابل معتبر و متفاوت انتخاب کنید.', 400);
    if (input.kind !== 'REFUND' && [rule.receivableAccountId, rule.customerAdvanceAccountId].includes(counterAccount)) return fail('CUSTOMER_COUNTER_ACCOUNT_FORBIDDEN', 'حساب مقابل نباید حساب دریافتنی یا پیش‌دریافت همین مشتری باشد.', 400);
    const counterpart = await tx.accountingLedgerAccount.findUnique({ where: { id: counterAccount } });
    const evidence = { type: 'CUSTOMER_ACCOUNT_OPERATION', id: input.idempotencyKey, version: 1, payload, hash };
    const line = (accountId: string, debit: bigint, credit: bigint, partyId?: string, financialAccountId?: string) => ({
      accountId, partyId, financialAccountId, debitRials: debit, creditRials: credit, dimensions: [], description: input.reason.trim(),
      originalAmount: value.toString(), originalCurrency: 'IRR', rawAmountBeforeRounding: value.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1, evidence,
    });
    const debit = input.kind === 'REFUND' || delta > 0n;
    const app = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `ACC-${randomUUID()}` });
    const draft = await app.createManualDraft({ bookId: resolved.book!.id, fiscalYearId: period.fiscalYearId, periodId: period.id,
      idempotencyKey: input.idempotencyKey, correlationId: input.idempotencyKey, description: input.reason.trim(),
      documentDate: input.occurredAt, occurredAt: input.occurredAt, source: evidence, actor: input.actor,
      lines: [line(customerAccount, debit ? value : 0n, debit ? 0n : value, profile.accountingPartyId),
        line(counterAccount, debit ? 0n : value, debit ? value : 0n, counterpart?.partyRequirement === 'REQUIRED' ? profile.accountingPartyId : undefined,
          input.kind === 'REFUND' ? input.financialAccountId : undefined)] });
    const posted = await app.postVoucher({ voucherId: draft.id, actor: input.actor, reason: input.reason.trim() });
    if (input.kind === 'REFUND') {
      const refund = await tx.accountingTreasuryTransaction.create({ data: { profileId: profile.id, financialAccountId: input.financialAccountId!,
        kind: 'CUSTOMER_REFUND', direction: 'OUTBOUND', amountRials: value.toString(), refundOfId: input.receiptId,
        idempotencyKey: input.idempotencyKey, sourceType: evidence.type, sourceId: evidence.id, sourceVersion: 1, sourceHash: hash,
        occurredAt: input.occurredAt, postedVoucherId: posted.id, createdBy: input.actor.id } });
      if (input.creditItemId) await tx.accountingSettlementAllocation.create({ data: { treasuryTransactionId: refund.id,
        idempotencyKey: `${input.idempotencyKey}:credit`, ledgerVoucherId: posted.id, reason: input.reason.trim(), createdBy: input.actor.id,
        lines: { create: { openItemId: input.creditItemId, amountRials: value.toString() } } } });
    } else {
      await tx.accountingCustomerOpenItem.create({ data: { profileId: profile.id, sourceKind: input.kind, description: input.reason.trim(),
        ledgerVoucherId: posted.id, kind: delta > 0n ? 'RECEIVABLE' : 'CREDIT', originalRials: value.toString(), dueAt: input.occurredAt, postedAt: posted.postedAt! } });
    }
    return { profileId: profile.id, voucherId: posted.id };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}
