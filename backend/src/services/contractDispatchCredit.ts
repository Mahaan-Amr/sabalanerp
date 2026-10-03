import { Prisma, type PrismaClient, type SalesContract } from '@prisma/client';
import { getEffectiveUserAccess } from './effectiveAccessService';
import { resolveWorkspaceDutyAuthority } from './crossWorkspaceDutyAuthority';
import { assertCommercialActionAvailable, isCommerciallyFinal, refreshDispatchExpiryExemption } from './ordinaryContractLifecycle';

export type CreditDb = PrismaClient | Prisma.TransactionClient;
export const ordinaryContract = (contract: Pick<SalesContract, 'partnerKind' | 'partnerCaseId'>) =>
  !contract.partnerKind && !contract.partnerCaseId;
export const rials = (amount: Prisma.Decimal.Value, currency: string) =>
  new Prisma.Decimal(amount).mul(['IRT', 'تومان'].includes(currency) ? 10 : 1);
export const tehranDay = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
export const promisedDate = (value: unknown, initial = true) => {
  const text = String(value ?? '');
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== text
    || (initial && text < tehranDay())) throw new Error('تاریخ وعده پرداخت باید امروز یا آینده باشد.');
  return date;
};
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
export const auditDispatchCredit = (db: CreditDb, contractId: string | null, actorId: string, action: string,
  entityId: string, before: unknown, after: unknown, note?: string) => db.accountingAuditLog.create({ data: {
  contractId, actorId, action, entityType: 'ContractDispatchCredit', entityId,
  beforeState: json(before), afterState: json(after), note: note || null,
} });
export const canManageDispatch = async (db: CreditDb, actorId: string) => {
  const authority = await resolveWorkspaceDutyAuthority(db, { userId: actorId, workspace: 'accounting', feature: 'accounting_actions_manage' });
  return authority.canSelfDecide;
};
export const canEditCredit = async (db: CreditDb, actorId: string) => {
  const actor = await db.user.findUnique({ where: { id: actorId } });
  if (!actor?.isActive) return false;
  if (actor.role === 'ADMIN') return true;
  const access = await getEffectiveUserAccess(db, { userId: actor.id, userRole: actor.role });
  return access.workspaces.some(item => item.workspace === 'sales' && item.permission === 'admin');
};
export const dispatchCreditAccess = async (db: CreditDb, contract: SalesContract, actorId: string) => {
  const user = await db.user.findUnique({ where: { id: actorId } });
  if (!user?.isActive) return { read: false, request: false, manage: false, seller: false };
  const access = await getEffectiveUserAccess(db, { userId: user.id, userRole: user.role });
  const feature = (workspace: string, name: string, edit = false) => user.role === 'ADMIN' ||
    (access.workspaces.some(item => item.workspace === workspace && (!edit || item.permission !== 'view'))
      && access.features.some(item => item.workspace === workspace && item.feature === name && (!edit || item.permission !== 'view')));
  const accounting = feature('accounting', 'accounting_contracts_view');
  const sales = feature('sales', 'sales_contracts_view') && (!user.departmentId || user.departmentId === contract.departmentId);
  const manage = await canManageDispatch(db, user.id);
  return { read: accounting || sales || manage, request: accounting && feature('accounting', 'accounting_actions_manage', true),
    manage, seller: sales && contract.responsibleSellerId === user.id };
};
export const hasFinancialDispatchApproval = async (db: CreditDb, contractId: string) => {
  const records = await db.accountingFinancialRecord.findMany({ where: {
    contractId, kind: 'INVOICE_CANDIDATE', financiallyApprovedAt: { not: null }, status: { not: 'VOIDED' },
  }, select: { amount: true, sepidarAmount: true, systemInvoiceNumber: true, systemInvoiceDate: true } });
  return records.some(record => record.amount.gt(0) && !!record.systemInvoiceNumber && !!record.systemInvoiceDate
    && record.sepidarAmount?.equals(record.amount));
};
export const activeCreditForContract = async (db: CreditDb, contract: SalesContract) => {
  if (['CANCELLED', 'EXPIRED'].includes(contract.status) || await hasFinancialDispatchApproval(db, contract.id)) return new Prisma.Decimal(0);
  const grant = await db.contractDispatchAuthority.findFirst({ where: { contractId: contract.id, kind: 'CREDIT', status: 'APPROVED' } });
  return grant?.amountRials ?? new Prisma.Decimal(0);
};
export const creditBalance = async (db: CreditDb, sellerId: string) => {
  const account = await db.sellerCreditAccount.findUnique({ where: { sellerId } });
  const grants = await db.contractDispatchAuthority.findMany({ where: {
    sellerId, kind: 'CREDIT', status: 'APPROVED', contract: { status: { notIn: ['CANCELLED', 'EXPIRED'] } },
  }, include: { contract: true } });
  let used = new Prisma.Decimal(0);
  for (const grant of grants) used = used.plus(await activeCreditForContract(db, grant.contract));
  const limit = account?.limitRials ?? new Prisma.Decimal(0);
  const balance = limit.minus(used);
  return { sellerId, limitRials: limit.toString(), usedRials: used.toString(), balanceRials: balance.toString(),
    availableRials: Prisma.Decimal.max(0, balance).toString() };
};
export const lockCreditAccounts = async (db: CreditDb, sellerIds: string[], actorId: string) => {
  for (const sellerId of [...new Set(sellerIds)].sort()) {
    await db.sellerCreditAccount.upsert({ where: { sellerId }, update: {}, create: { sellerId, updatedBy: actorId } });
    await db.$queryRaw(Prisma.sql`SELECT "sellerId" FROM "seller_credit_accounts" WHERE "sellerId" = ${sellerId} FOR UPDATE`);
  }
};
export const setSellerCreditLimit = async (db: CreditDb, actorId: string, sellerId: string, value: unknown) => {
  if (!await canEditCredit(db, actorId)) throw new Error('تنظیم اعتبار فقط برای مدیر یا ادمین فروش مجاز است.');
  const amount = new Prisma.Decimal(String(value));
  if (!amount.isFinite() || !amount.isInteger() || amount.lt(0) || amount.gte('1000000000000000000')) throw new Error('سقف اعتبار ریالی معتبر نیست.');
  const seller = await db.user.findUnique({ where: { id: sellerId } });
  if (!seller?.isActive) throw new Error('فروشنده فعال یافت نشد.');
  const access = await getEffectiveUserAccess(db, { userId: seller.id, userRole: seller.role });
  if (seller.role !== 'ADMIN' && !access.workspaces.some(item => item.workspace === 'sales' && item.permission !== 'view')) throw new Error('کاربر دسترسی فروش ندارد.');
  await lockCreditAccounts(db, [sellerId], actorId);
  const before = await creditBalance(db, sellerId);
  await db.sellerCreditAccount.update({ where: { sellerId }, data: { limitRials: amount, updatedBy: actorId } });
  const after = await creditBalance(db, sellerId);
  await auditDispatchCredit(db, null, actorId, 'SELLER_CREDIT_LIMIT_CHANGED', sellerId, before, after);
  return after;
};

/** Invoked inside the complete Contract writer after relational payment persistence. */
export const synchronizeSellerCredit = async (db: CreditDb, contract: SalesContract, actorId: string) => {
  const payments = await db.payment.findMany({ where: { contractId: contract.id, paymentMethod: 'SELLER_CREDIT' } });
  if (!ordinaryContract(contract)) {
    if (payments.length) throw new Error('اعتبار فروشنده فقط برای قرارداد فروش عادی مجاز است.');
    return;
  }
  const current = await db.contractDispatchAuthority.findFirst({ where: { contractId: contract.id, kind: 'CREDIT', status: 'APPROVED' } });
  if (!payments.length && !current) return;
  if (payments.length > 1) throw new Error('اعتبار فروشنده را در یک ردیف پرداخت وارد کنید.');
  const payment = payments[0];
  const amount = payment ? rials(payment.totalAmount, payment.currency) : new Prisma.Decimal(0);
  if (payment && (!payment.paymentDate || amount.lte(0) || !amount.isInteger()
    || amount.gt(rials(contract.totalAmount ?? 0, contract.currency)))) throw new Error('مبلغ و تاریخ اعتبار فروشنده معتبر نیست.');
  const date = payment?.paymentDate;
  const sellerId = current?.sellerId ?? contract.responsibleSellerId;
  if (!sellerId) throw new Error('فروشنده ضامن مشخص نیست.');
  if (payment && amount.gt(current?.amountRials ?? 0)) {
    const seller = await db.user.findUnique({ where: { id: sellerId } });
    if (!seller?.isActive) throw new Error('فروشنده ضامن باید فعال باشد.');
  }
  await lockCreditAccounts(db, [sellerId], actorId);
  if (current && current.sellerId !== contract.responsibleSellerId && !amount.equals(current.amountRials)) {
    throw new Error('تغییر مبلغ ضمانت پس از تغییر فروشنده، به انتقال ضمانت با پذیرش فروشنده جدید نیاز دارد.');
  }
  if (current && payment && current.promisedDate.toISOString().slice(0, 10) !== date!.toISOString().slice(0, 10)) {
    throw new Error('تغییر موعد اعتبار ثبت‌شده باید از درخواست تغییر تاریخ انجام شود.');
  }
  if (!current && payment) promisedDate(date!.toISOString().slice(0, 10));
  if (payment && amount.gt(current?.amountRials ?? 0) && actorId !== contract.responsibleSellerId && !await canEditCredit(db, actorId)) {
    throw new Error('مصرف اعتبار فقط برای فروشنده مسئول یا مدیر فروش مجاز است.');
  }
  const before = await creditBalance(db, sellerId);
  const alreadyConsumed = current ? await activeCreditForContract(db, contract) : new Prisma.Decimal(0);
  const nextConsumed = await hasFinancialDispatchApproval(db, contract.id) ? new Prisma.Decimal(0) : amount;
  if (nextConsumed.gt(alreadyConsumed) && nextConsumed.minus(alreadyConsumed).gt(before.availableRials)) throw new Error('مانده اعتبار فروشنده برای این مبلغ کافی نیست.');
  if (current && amount.equals(current.amountRials)) {
    await db.contractDispatchAuthority.update({ where: { id: current.id }, data: { revision: contract.commercialRevision } });
    return;
  }
  if (current) await db.contractDispatchAuthority.update({ where: { id: current.id }, data: { status: 'SUPERSEDED' } });
  const next = payment ? await db.contractDispatchAuthority.create({ data: { contractId: contract.id, kind: 'CREDIT', status: 'APPROVED',
    revision: contract.commercialRevision, sellerId, amountRials: amount, promisedDate: date!, requestedBy: actorId, decidedBy: actorId } }) : null;
  await auditDispatchCredit(db, contract.id, actorId, 'SELLER_CREDIT_RECONCILED', next?.id ?? current!.id, current, next);
};

export const activeManagerApproval = (db: CreditDb, contract: SalesContract) => db.contractDispatchAuthority.findFirst({
  where: { contractId: contract.id, kind: 'MANAGER', status: 'APPROVED', revision: contract.commercialRevision },
});
export const recordFinancialCreditTransition = async (db: CreditDb, contractId: string | null, actorId: string, action: string) => {
  if (!contractId) return;
  const credit = await db.contractDispatchAuthority.findFirst({ where: { contractId, kind: 'CREDIT', status: 'APPROVED' } });
  if (!credit?.sellerId) return;
  await lockCreditAccounts(db, [credit.sellerId], actorId);
  await auditDispatchCredit(db, contractId, actorId, action, credit.id, { guaranteeRials: credit.amountRials.toString() }, await creditBalance(db, credit.sellerId));
};
export const assertAuthorityContract = (contract: SalesContract) => {
  if (!ordinaryContract(contract) || contract.isInactive || ['CANCELLED', 'EXPIRED'].includes(contract.status)) throw new Error('قرارداد برای این درخواست قابل استفاده نیست.');
};
export const createDispatchRequest = async (db: CreditDb, contract: SalesContract, actorId: string, input: {
  kind: 'MANAGER' | 'DATE' | 'TRANSFER'; promisedDate: string; reason?: string; targetAuthorityId?: string; targetSellerId?: string;
}) => {
  assertAuthorityContract(contract);
  await refreshDispatchExpiryExemption(db, contract);
  assertCommercialActionAvailable(contract);
  let date = promisedDate(input.promisedDate, input.kind !== 'TRANSFER');
  if (input.kind === 'MANAGER' && !isCommerciallyFinal(contract)) throw new Error('درخواست تأیید مدیریتی به قرارداد قطعی نیاز دارد.');
  if (input.kind === 'MANAGER' && await activeManagerApproval(db, contract)) throw new Error('تأیید مدیریتی این نسخه برقرار است؛ تغییر موعد را جداگانه درخواست کنید.');
  if (input.kind !== 'MANAGER' && !input.reason?.trim()) throw new Error('دلیل درخواست الزامی است.');
  if (input.kind !== 'MANAGER') {
    const original = await db.contractDispatchAuthority.findUnique({ where: { id: input.targetAuthorityId || '' } });
    if (!original || original.contractId !== contract.id || original.status !== 'APPROVED'
      || !['CREDIT','MANAGER'].includes(original.kind)) throw new Error('مجوز فعلی یافت نشد.');
    if (input.kind === 'TRANSFER' && (original.kind !== 'CREDIT' || !input.targetSellerId)) throw new Error('انتقال ضمانت معتبر نیست.');
    if (input.kind === 'TRANSFER') {
      if (original.sellerId === input.targetSellerId || contract.responsibleSellerId !== input.targetSellerId) throw new Error('فروشنده جدید باید فروشنده مسئول و متفاوت از ضامن فعلی باشد.');
      date = original.promisedDate;
    }
  }
  const pending = await db.contractDispatchAuthority.findFirst({ where: { contractId: contract.id, kind: input.kind, status: 'PENDING' } });
  if (pending) throw new Error('درخواست قبلی هنوز در انتظار تصمیم است.');
  const request = await db.contractDispatchAuthority.create({ data: { contractId: contract.id, kind: input.kind,
    revision: contract.commercialRevision, promisedDate: date, requestedBy: actorId, reason: input.reason?.trim(),
    targetAuthorityId: input.targetAuthorityId, targetSellerId: input.targetSellerId } });
  await auditDispatchCredit(db, contract.id, actorId, 'DISPATCH_AUTHORITY_REQUESTED', request.id, null, request);
  return request;
};

export const decideDispatchRequest = async (db: CreditDb, id: string, actorId: string, action: 'APPROVE' | 'DECLINE', reason?: string) => {
  const candidate = await db.contractDispatchAuthority.findUniqueOrThrow({ where: { id } });
  await db.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id"=${candidate.contractId} FOR UPDATE`);
  const request = await db.contractDispatchAuthority.findUniqueOrThrow({ where: { id }, include: { contract: true } });
  if (request.status !== 'PENDING' || request.revision !== request.contract.commercialRevision) throw new Error('درخواست قبلاً تعیین تکلیف شده یا قرارداد تغییر کرده است.');
  assertAuthorityContract(request.contract);
  const authorized = request.kind === 'TRANSFER' ? request.targetSellerId === actorId : await canManageDispatch(db, actorId);
  if (!authorized) throw new Error('مجوز تصمیم برای این درخواست ندارید.');
  if (action === 'DECLINE' && !reason?.trim()) throw new Error('دلیل رد درخواست الزامی است.');
  if (action === 'APPROVE' && request.kind === 'MANAGER' && !isCommerciallyFinal(request.contract)) throw new Error('قرارداد باید قطعی باشد.');
  if (action === 'APPROVE' && request.kind !== 'MANAGER') {
    const original = await db.contractDispatchAuthority.findUniqueOrThrow({ where: { id: request.targetAuthorityId! } });
    if (original.status !== 'APPROVED' || original.contractId !== request.contractId) throw new Error('مجوز مبدأ تغییر کرده است.');
    if (request.kind === 'DATE') {
      await db.contractDispatchAuthority.update({ where: { id: original.id }, data: { promisedDate: request.promisedDate, notifiedFor: null } });
      if (original.kind === 'CREDIT') await db.payment.updateMany({ where: { contractId: request.contractId, paymentMethod: 'SELLER_CREDIT' }, data: { paymentDate: request.promisedDate } });
    } else {
      const seller = await db.user.findUnique({ where: { id: actorId } });
      if (!seller?.isActive || request.contract.responsibleSellerId !== actorId) throw new Error('فروشنده جدید باید فروشنده مسئول و فعال قرارداد باشد.');
      await lockCreditAccounts(db, [original.sellerId!, actorId], actorId);
      const balance = await creditBalance(db, actorId);
      if (!await hasFinancialDispatchApproval(db, request.contractId) && original.amountRials.gt(balance.availableRials)) throw new Error('اعتبار فروشنده جدید کافی نیست.');
      await db.contractDispatchAuthority.update({ where: { id: original.id }, data: { status: 'SUPERSEDED' } });
      await db.contractDispatchAuthority.create({ data: { contractId: request.contractId, kind: 'CREDIT', status: 'APPROVED',
        sellerId: actorId, revision: request.revision, amountRials: original.amountRials, promisedDate: original.promisedDate,
        requestedBy: request.requestedBy, decidedBy: actorId } });
    }
  }
  const updated = await db.contractDispatchAuthority.update({ where: { id }, data: { status: action === 'APPROVE' ? 'APPROVED' : 'REJECTED',
    decidedBy: actorId, reason: reason?.trim() || request.reason } });
  await auditDispatchCredit(db, request.contractId, actorId, `DISPATCH_${request.kind}_${action}`, id, request, updated, reason);
  return updated;
};
