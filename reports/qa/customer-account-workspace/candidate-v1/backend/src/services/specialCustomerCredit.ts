import { Prisma, type PrismaClient, type SalesContract } from '@prisma/client';
import { activeHrAuthoritiesForUser } from './hrAuthorizationService';
import { getEffectiveUserAccess } from './effectiveAccessService';
import { rials, promisedDate, auditDispatchCredit } from './contractDispatchCredit';
import { actualContractReceiptsRials } from './ordinaryContractDispatchEligibility';
import { unpaidCustomerCredit, CustomerCreditError } from './specialCustomerCreditPolicy';
export { CustomerCreditError } from './specialCustomerCreditPolicy';

type Db = PrismaClient | Prisma.TransactionClient;
export const canManageCustomerCredit = async (db: Db, actorId: string) => {
  const actor = await db.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true } });
  if (!actor?.isActive || await db.partnerProfile.findUnique({ where: { userId: actorId }, select: { id: true } })) return false;
  if (actor.role === 'ADMIN') return true;
  const access = await getEffectiveUserAccess(db, { userId: actorId, userRole: actor.role });
  return access.workspaces.some(row => row.workspace === 'crm' && row.permission === 'admin')
    || (await activeHrAuthoritiesForUser(db, actorId)).includes('COMPANY_MANAGER');
};

export const lockCustomerCredit = async (db: Db, customerId: string) => {
  await db.$queryRaw(Prisma.sql`SELECT id FROM crm_customers WHERE id = ${customerId} FOR UPDATE`);
};

export const consumedCustomerCredit = async (db: Db, contract: SalesContract) => {
  if (contract.customerCreditAmountRials.lte(0)) return new Prisma.Decimal(0);
  const authoritative = await db.accountingReplacementCutoverRun.findMany({ where: { authorityTransferredAt: { not: null }, sabalanAuthoritative: true }, select: { bookId: true } });
  const ledgerItems = authoritative.length ? await db.accountingCustomerOpenItem.findMany({ where: { contractId: contract.id,
    OR: [{ kind: 'RECEIVABLE', invoice: { status: 'POSTED' } }, { kind: 'CREDIT', invoice: { status: 'CREDIT_NOTE' } }] },
    select: { kind: true, originalRials: true, invoice: { select: { contractVersion: true, ledgerVoucherId: true } } } }) : [];
  const posted = new Set(authoritative.length ? (await db.accountingLedgerVoucher.findMany({ where: {
    id: { in: ledgerItems.flatMap(item => item.invoice ? [item.invoice.ledgerVoucherId] : []) }, status: 'POSTED', bookId: { in: authoritative.map(run => run.bookId) } },
    select: { id: true } })).map(voucher => voucher.id) : []);
  const obligations = authoritative.length
    ? ledgerItems.filter(row => row.invoice && posted.has(row.invoice.ledgerVoucherId))
      .map(row => ({ amount: row.kind === 'CREDIT' ? row.originalRials.negated() : row.originalRials, revision: row.invoice!.contractVersion }))
    : (await db.accountingReceivable.findMany({ where: { contractId: contract.id, status: { not: 'VOIDED' } }, select: { originalAmount: true, invoiceRecord: { select: { sourceSnapshot: true } } } }))
      .map(row => ({ amount: row.originalAmount, revision: (row.invoiceRecord?.sourceSnapshot as { commercialRevision?: number } | null)?.commercialRevision }));
  const approvedInvoices = !authoritative.length && !obligations.length ? await db.accountingFinancialRecord.findMany({ where: { contractId: contract.id,
    kind: 'INVOICE_CANDIDATE', status: { not: 'VOIDED' }, financiallyApprovedAt: { not: null } }, select: { amount: true, sourceSnapshot: true } }) : [];
  const evidence = obligations.length ? obligations : approvedInvoices.map(invoice => ({ amount: invoice.amount,
    revision: (invoice.sourceSnapshot as { commercialRevision?: number } | null)?.commercialRevision }));
  const evidencedAmount = Prisma.Decimal.max(0, evidence.reduce((sum, item) => sum.plus(item.amount), new Prisma.Decimal(0)));
  const closed = ['CANCELLED', 'EXPIRED'].includes(contract.status);
  // Old invoices cannot free headroom for an increased commercial promise while its replacement is pending.
  const currentEvidence = evidence.length > 0 && evidence.every(item => item.revision === contract.customerCreditRevision);
  // Ledger invoices can represent partial deliveries. Only posted credit notes reduce the live promise,
  // rather than treating the uninvoiced portion as a cancelled obligation.
  const ledgerOriginal = evidence.reduce((sum, item) => sum.plus(Prisma.Decimal.max(0, item.amount)), new Prisma.Decimal(0));
  const ledgerReduction = ledgerOriginal.minus(evidencedAmount);
  const remainingSource = closed ? evidencedAmount : authoritative.length && currentEvidence
    ? Prisma.Decimal.max(contract.customerCreditTotalRials, ledgerOriginal).minus(ledgerReduction)
    : Prisma.Decimal.max(contract.customerCreditTotalRials, evidencedAmount);
  return unpaidCustomerCredit(contract.customerCreditAmountRials, remainingSource, await actualContractReceiptsRials(db, contract));
};

export const customerCreditBalance = async (db: Db, customerId: string) => {
  const customer = await db.crmCustomer.findUnique({ where: { id: customerId } });
  if (!customer || customer.cardDeletedAt || customer.partnerOwnerProfileId) throw new CustomerCreditError(404, 'مشتری مستقیم سبلان یافت نشد.');
  const contracts = await db.salesContract.findMany({ where: { customerCreditCustomerId: customerId, customerCreditAmountRials: { gt: 0 } } });
  let used = new Prisma.Decimal(0);
  for (const contract of contracts) used = used.plus(await consumedCustomerCredit(db, contract));
  return { customerId, trustCategory: customer.trustCategory, policyVersion: customer.creditPolicyVersion,
    limitRials: customer.creditLimitRials?.toString() ?? null, usedRials: used.toString(),
    availableRials: customer.creditLimitRials === null ? null : Prisma.Decimal.max(0, customer.creditLimitRials.minus(used)).toString(),
    deficitRials: customer.creditLimitRials === null ? '0' : Prisma.Decimal.max(0, used.minus(customer.creditLimitRials)).toString() };
};

export const updateCustomerCreditPolicy = async (db: Db, actorId: string, customerId: string, input: {
  trustCategory: unknown; limitRials: unknown; policyVersion: unknown; reason: unknown;
}) => {
  if (!await canManageCustomerCredit(db, actorId)) throw new CustomerCreditError(403, 'تنظیم اعتبار فقط برای مدیر یا ادمین مجاز است.');
  if (!['NORMAL', 'SPECIAL'].includes(String(input.trustCategory)) || !Number.isInteger(input.policyVersion)
    || typeof input.reason !== 'string' || input.reason.trim().length < 3 || input.reason.length > 1000) throw new CustomerCreditError(400, 'دسته مشتری، دلیل و نسخه تنظیمات معتبر لازم است.');
  let limit: Prisma.Decimal | null = null;
  if (input.limitRials !== null) {
    if (typeof input.limitRials !== 'string' || !/^\d{1,18}$/.test(input.limitRials)) throw new CustomerCreditError(400, 'سقف اعتبار باید مبلغ صحیح ریالی باشد.');
    limit = new Prisma.Decimal(input.limitRials);
  }
  await lockCustomerCredit(db, customerId);
  const before = await customerCreditBalance(db, customerId);
  if (before.policyVersion !== input.policyVersion) throw new CustomerCreditError(409, 'تنظیمات مشتری تغییر کرده است؛ صفحه را تازه‌سازی کنید.');
  await db.crmCustomer.update({ where: { id: customerId }, data: { trustCategory: String(input.trustCategory), creditLimitRials: limit,
    creditPolicyVersion: { increment: 1 }, updatedBy: actorId } });
  const after = await customerCreditBalance(db, customerId);
  await auditDispatchCredit(db, null, actorId, 'CUSTOMER_CREDIT_POLICY_CHANGED', customerId, before, after, input.reason.trim());
  return after;
};

/** Validate the authoritative payment rows on every full save, without consuming credit in یادداشت. */
export const validateSpecialCustomerCreditPlan = async (db: Db, contract: SalesContract) => {
  const payments = await db.payment.findMany({ where: { contractId: contract.id, paymentMethod: 'SPECIAL_CUSTOMER_CREDIT' } });
  if (payments.length > 1) throw new CustomerCreditError(400, 'اعتباری مشتری خاص را در یک ردیف پرداخت وارد کنید.');
  const payment = payments[0];
  if (!payment) return null;
  const customer = await db.crmCustomer.findUnique({ where: { id: contract.customerId } });
  const amount = rials(payment.totalAmount, payment.currency);
  const sameGrant = contract.customerCreditCustomerId === contract.customerId && contract.customerCreditAmountRials.gt(0);
  if (contract.partnerKind || contract.partnerCaseId || !customer || customer.partnerOwnerProfileId || customer.cardDeletedAt
    || customer.isBlacklisted || customer.isLocked || !customer.isActive) throw new CustomerCreditError(409, 'اعتباری مشتری خاص فقط برای مشتری مستقیم و فعال سبلان مجاز است.');
  if ((!sameGrant || amount.gt(contract.customerCreditAmountRials)) && customer.trustCategory !== 'SPECIAL') throw new CustomerCreditError(409, 'مشتری برای استفاده از اعتبار جدید باید خاص باشد.');
  if (!payment.paymentDate || !amount.isInteger() || amount.lte(0) || amount.gt(rials(contract.totalAmount ?? 0, contract.currency))) throw new CustomerCreditError(400, 'مبلغ و وعده پرداخت اعتباری معتبر نیست.');
  if (sameGrant && contract.customerCreditPromisedDate?.getTime() !== payment.paymentDate.getTime()) throw new CustomerCreditError(409, 'تغییر وعده پرداخت به درخواست و تأیید مدیریتی نیاز دارد.');
  if (!sameGrant) {
    try { promisedDate(payment.paymentDate.toISOString().slice(0, 10)); }
    catch (error) { throw new CustomerCreditError(400, error instanceof Error ? error.message : 'تاریخ وعده پرداخت معتبر نیست.'); }
  }
  return { amount, date: payment.paymentDate };
};

export const authorizeSpecialCustomerCredit = async (db: Db, contract: SalesContract, actorId: string) => {
  const hasPlan = await db.payment.count({ where: { contractId: contract.id, paymentMethod: 'SPECIAL_CUSTOMER_CREDIT' } });
  if (!hasPlan && !contract.customerCreditCustomerId) return contract;
  // The Contract lock is acquired by the Sales approval owner before this customer lock.
  for (const customerId of [...new Set([contract.customerCreditCustomerId, contract.customerId].filter((id): id is string => !!id))].sort()) await lockCustomerCredit(db, customerId);
  const plan = await validateSpecialCustomerCreditPlan(db, contract);
  if (!plan) {
    if (contract.customerCreditCustomerId && contract.firstFinancialRecordAt && (await consumedCustomerCredit(db, contract)).gt(0)) throw new CustomerCreditError(409, 'برای حذف روش اعتباری ابتدا تعهد آن را در حسابداری تعیین تکلیف کنید.');
    const updated = await db.salesContract.update({ where: { id: contract.id }, data: { customerCreditRevision: null, customerCreditAmountRials: 0,
      customerCreditTotalRials: 0, customerCreditCustomerId: null, customerCreditPromisedDate: null } });
    await auditDispatchCredit(db, contract.id, actorId, 'SPECIAL_CUSTOMER_CREDIT_RELEASED', contract.id, contract, updated);
    return updated;
  }
  if (contract.customerCreditCustomerId && contract.customerCreditCustomerId !== contract.customerId
    && (await consumedCustomerCredit(db, contract)).gt(0)) throw new CustomerCreditError(409, 'تغییر طرف قرارداد اعتباری نیازمند تعیین تکلیف اعتبار قبلی است.');
  const balance = await customerCreditBalance(db, contract.customerId);
  const oldConsumed = contract.customerCreditCustomerId === contract.customerId ? await consumedCustomerCredit(db, contract) : new Prisma.Decimal(0);
  const total = rials(contract.totalAmount ?? 0, contract.currency);
  const next = unpaidCustomerCredit(plan.amount, total, await actualContractReceiptsRials(db, contract));
  if (balance.limitRials !== null && next.gt(oldConsumed) && next.minus(oldConsumed).gt(balance.availableRials!)) {
    const shortage = next.minus(oldConsumed).minus(balance.availableRials!);
    throw new CustomerCreditError(409, `اعتبار آزاد کافی نیست؛ کسری ${shortage.toFixed(0)} ریال است. قرارداد در یادداشت باقی می‌ماند.`);
  }
  const updated = await db.salesContract.update({ where: { id: contract.id }, data: { customerCreditCustomerId: contract.customerId,
    customerCreditAmountRials: plan.amount, customerCreditTotalRials: total, customerCreditRevision: contract.commercialRevision,
    customerCreditPromisedDate: plan.date } });
  await auditDispatchCredit(db, contract.id, actorId, 'SPECIAL_CUSTOMER_CREDIT_AUTHORIZED', contract.id, contract, updated);
  return updated;
};
