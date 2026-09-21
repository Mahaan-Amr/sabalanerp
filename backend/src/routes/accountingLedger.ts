import { createHash, randomUUID } from 'node:crypto';
import express, { Response } from 'express';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccessWithClient, WORKSPACE_PERMISSIONS, WORKSPACES, type WorkspaceRequest } from '../middleware/workspace';
import { createAccountingLedgerAdministration } from '../services/accountingLedgerAdministration';
import { AccountingLedgerError, accountingAccessProfileFromPermission, createAccountingLedgerApplication, type AccountingAccessProfile } from '../services/accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository, listLedgerVouchers, listPostedJournal, listPostedTrialBalance, readLedgerVoucherEvidence, verifyLedgerAuditChain } from '../services/accountingLedgerPrismaRepository';

const router = express.Router();
const administration = createAccountingLedgerAdministration(prisma);
const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(prisma), {
  now: () => new Date(),
  nextReference: () => `عطف-${randomUUID()}`,
});

const auditAccessDenial = async ({ req, requiredPermission, effectivePermission, reason }: {
  req: WorkspaceRequest; requiredPermission: string; effectivePermission: string | null; reason: string;
}) => createAccountingLedgerPrismaRepository(prisma).transaction((tx) => tx.appendAudit({
  action: 'ACCOUNTING_ACCESS_DENIED', result: 'DENIED', actorId: req.user?.id || 'ناشناس',
  effectiveProfile: effectivePermission === 'admin' ? 'ACCOUNTING_MANAGER' : effectivePermission === 'edit' ? 'ACCOUNTANT' : 'VIEWER',
  entityType: 'ACCOUNTING_ROUTE', entityId: req.path,
  correlationId: String(req.get('X-Correlation-ID') || randomUUID()),
  reason: `رد دسترسی: ${reason}`,
  payloadHash: createHash('sha256').update(`${req.method}:${req.path}:${requiredPermission}:${effectivePermission || 'none'}`).digest('hex'),
  sessionContext: { method: req.method, path: req.path, requiredPermission, effectivePermission, reason },
}));

const accountingAccess = (requiredPermission: 'view' | 'edit' | 'admin') => [
  protect,
  requireWorkspaceAccessWithClient(prisma, WORKSPACES.ACCOUNTING, requiredPermission, auditAccessDenial),
];
const viewAccess = accountingAccess(WORKSPACE_PERMISSIONS.VIEW);
const editAccess = accountingAccess(WORKSPACE_PERMISSIONS.EDIT);
const managerAccess = accountingAccess(WORKSPACE_PERMISSIONS.ADMIN);

const profileOf = (req: WorkspaceRequest): AccountingAccessProfile => accountingAccessProfileFromPermission(req.workspacePermission);
const actorOf = (req: WorkspaceRequest) => ({
  id: req.user!.id,
  profile: profileOf(req),
  isGlobalAdmin: req.user?.role === 'ADMIN',
});

const serialize = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => (
  typeof item === 'bigint' ? item.toString() : item
)));

const normalizeDigits = (value: unknown) => String(value ?? '')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));

const wholeRials = (value: unknown) => {
  const normalized = normalizeDigits(value).trim();
  if (!/^\d+$/.test(normalized)) throw new AccountingLedgerError('INVALID_RIAL_AMOUNT', 'مبلغ ریال باید عدد صحیح و بدون اعشار باشد.', 400);
  return BigInt(normalized);
};

const validDate = (value: unknown, label: string) => {
  const date = new Date(String(value ?? ''));
  if (Number.isNaN(date.getTime())) throw new AccountingLedgerError('INVALID_DATE', `${label} معتبر نیست.`, 400);
  return date;
};

const run = (handler: (req: WorkspaceRequest) => Promise<unknown>) => async (req: WorkspaceRequest, res: Response) => {
  try {
    res.json({ success: true, data: serialize(await handler(req)) });
  } catch (error) {
    if (error instanceof AccountingLedgerError) {
      await createAccountingLedgerPrismaRepository(prisma).transaction((tx) => tx.appendAudit({
        action: 'ACCOUNTING_COMMAND_DENIED', result: 'DENIED', actorId: req.user?.id || 'ناشناس',
        effectiveProfile: profileOf(req), entityType: 'ACCOUNTING_COMMAND', entityId: req.params.id || req.path,
        correlationId: String(req.get('X-Correlation-ID') || randomUUID()), reason: error.message,
        payloadHash: createHash('sha256').update(`${req.method}:${req.path}:${error.code}`).digest('hex'),
        sessionContext: { method: req.method, path: req.path, code: error.code },
      }));
      res.status(error.status).json({ success: false, code: error.code, error: error.message });
      return;
    }
    console.error('Accounting ledger request failed:', error);
    res.status(500).json({ success: false, error: 'انجام عملیات دفترکل با خطا روبه‌رو شد.' });
  }
};

router.get('/context', ...viewAccess, run(async (req) => {
  const context = await administration.getContext();
  return context
    ? { ...context, configured: true, accessProfile: profileOf(req), isGlobalAdmin: req.user?.role === 'ADMIN' }
    : { configured: false, accessProfile: profileOf(req), isGlobalAdmin: req.user?.role === 'ADMIN' };
}));

router.post('/setup', ...managerAccess, run((req) => administration.setup({
  legalEntity: {
    code: String(req.body.legalEntity?.code || '').trim(),
    namePersian: String(req.body.legalEntity?.namePersian || '').trim(),
    nationalId: req.body.legalEntity?.nationalId,
    economicCode: req.body.legalEntity?.economicCode,
    activeFrom: validDate(req.body.legalEntity?.activeFrom, 'تاریخ شروع فعالیت'),
  },
  book: { code: String(req.body.book?.code || '').trim(), namePersian: String(req.body.book?.namePersian || '').trim() },
  scheme: req.body.scheme,
  actorId: req.user!.id,
})));

router.post('/fiscal-years', ...managerAccess, run((req) => administration.createFiscalYear({
  ...req.body,
  startsAt: validDate(req.body.startsAt, 'تاریخ شروع سال مالی'),
  endsAt: validDate(req.body.endsAt, 'تاریخ پایان سال مالی'),
  periods: (req.body.periods || []).map((period: any) => ({
    ...period, startsAt: validDate(period.startsAt, 'تاریخ شروع دوره'), endsAt: validDate(period.endsAt, 'تاریخ پایان دوره'),
  })),
  actorId: req.user!.id,
})));

router.patch('/periods/:id/status', ...managerAccess, run((req) => administration.updatePeriodStatus({
  periodId: req.params.id, status: req.body.status, actorId: req.user!.id, reason: req.body.reason,
})));

router.post('/accounts', ...managerAccess, run((req) => administration.createAccount({
  ...req.body,
  effectiveFrom: validDate(req.body.effectiveFrom, 'تاریخ اثر حساب'),
  actorId: req.user!.id,
})));

router.post('/accounts/:id/retire', ...managerAccess, run((req) => administration.retireAccount({
  accountId: req.params.id, actorId: req.user!.id, reason: req.body.reason,
  successorAccountId: req.body.successorAccountId,
})));

router.post('/dimensions', ...managerAccess, run((req) => administration.createDimensionType({
  bookId: req.body.bookId, code: String(req.body.code || '').trim(),
  titlePersian: String(req.body.titlePersian || '').trim(), sourceKind: String(req.body.sourceKind || 'دستی').trim(),
  effectiveFrom: validDate(req.body.effectiveFrom, 'تاریخ اثر بُعد'), actorId: req.user!.id,
})));

router.post('/dimensions/:id/members', ...managerAccess, run((req) => administration.ensureDimensionMember({
  dimensionTypeId: req.params.id, sourceId: String(req.body.sourceId || '').trim(), code: req.body.code,
  titlePersian: String(req.body.titlePersian || '').trim(), effectiveFrom: validDate(req.body.effectiveFrom, 'تاریخ اثر مقدار تفصیلی'), actorId: req.user!.id,
})));

router.post('/financial-accounts', ...managerAccess, run((req) => administration.createFinancialAccount({
  ...req.body, activeFrom: validDate(req.body.activeFrom, 'تاریخ شروع حساب مالی'), actorId: req.user!.id,
})));

router.post('/vouchers', ...editAccess, run((req) => ledger.createManualDraft({
  bookId: req.body.bookId,
  fiscalYearId: req.body.fiscalYearId,
  periodId: req.body.periodId,
  idempotencyKey: String(req.get('Idempotency-Key') || req.body.idempotencyKey || ''),
  correlationId: String(req.get('X-Correlation-ID') || req.body.correlationId || randomUUID()),
  description: req.body.description,
  documentDate: validDate(req.body.documentDate, 'تاریخ سند'),
  occurredAt: validDate(req.body.occurredAt || req.body.documentDate, 'تاریخ وقوع'),
  discoveredAt: req.body.discoveredAt ? validDate(req.body.discoveredAt, 'تاریخ کشف') : undefined,
  source: req.body.source,
  actor: actorOf(req),
  override: req.body.override,
  lines: (req.body.lines || []).map((line: any) => ({
    ...line,
    debitRials: wholeRials(line.debitRials ?? 0),
    creditRials: wholeRials(line.creditRials ?? 0),
    exchangeRateDate: line.exchangeRateDate ? validDate(line.exchangeRateDate, 'تاریخ نرخ ارز') : undefined,
  })),
})));

router.post('/vouchers/:id/post', ...editAccess, run((req) => ledger.postVoucher({
  voucherId: req.params.id,
  actor: actorOf(req),
  reason: req.body.reason,
  override: req.body.override,
})));

router.post('/vouchers/:id/reverse', ...editAccess, run((req) => ledger.reverseVoucher({
  voucherId: req.params.id,
  actor: actorOf(req),
  idempotencyKey: String(req.get('Idempotency-Key') || req.body.idempotencyKey || ''),
  reason: req.body.reason,
  targetFiscalYearId: String(req.body.targetFiscalYearId || ''),
  targetPeriodId: String(req.body.targetPeriodId || ''),
  documentDate: validDate(req.body.documentDate, 'تاریخ سند برگشت'),
  override: req.body.override,
})));

router.get('/journal', ...viewAccess, run((req) => listPostedJournal(prisma, {
  bookId: String(req.query.bookId || ''),
  fiscalYearId: String(req.query.fiscalYearId || ''),
  periodId: req.query.periodId ? String(req.query.periodId) : undefined,
})));

router.get('/vouchers', ...viewAccess, run((req) => listLedgerVouchers(prisma, {
  bookId: String(req.query.bookId || ''),
  fiscalYearId: String(req.query.fiscalYearId || ''),
  periodId: req.query.periodId ? String(req.query.periodId) : undefined,
  status: req.query.status ? String(req.query.status) as 'DRAFT' | 'POSTED' | 'REVERSED' : undefined,
})));

router.get('/vouchers/:id/evidence', ...managerAccess, run((req) => readLedgerVoucherEvidence(prisma, {
  voucherId: req.params.id,
  actorId: req.user!.id,
  effectiveProfile: profileOf(req),
  correlationId: String(req.get('X-Correlation-ID') || randomUUID()),
  reason: String(req.query.reason || 'بازبینی شواهد سند حسابداری'),
})));

router.get('/trial-balance', ...viewAccess, run((req) => listPostedTrialBalance(prisma, {
  bookId: String(req.query.bookId || ''),
  fiscalYearId: String(req.query.fiscalYearId || ''),
  periodId: req.query.periodId ? String(req.query.periodId) : undefined,
})));

router.get('/audit/verify', ...managerAccess, run(() => verifyLedgerAuditChain(prisma)));

export default router;
