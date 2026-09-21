import { createHash, randomUUID } from 'node:crypto';
import express, { Response } from 'express';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import { FEATURES, FEATURE_PERMISSIONS, requireFeatureAccess, requireNarrowFeatureAccess } from '../middleware/feature';
import { requireWorkspaceAccessWithClient, WORKSPACE_PERMISSIONS, WORKSPACES, type WorkspaceRequest } from '../middleware/workspace';
import { createAccountingLedgerAdministration } from '../services/accountingLedgerAdministration';
import { AccountingLedgerError, accountingAccessProfileFromPermission, createAccountingLedgerApplication, type AccountingAccessProfile } from '../services/accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository, listLedgerVouchers, listPostedJournal, listPostedTrialBalance, readLedgerVoucherEvidence, verifyLedgerAuditChain } from '../services/accountingLedgerPrismaRepository';
import { AccountingCustomerTreasuryError } from '../services/accountingCustomerTreasury';
import { resolveNarrowFeatureAccess } from '../services/narrowFeatureAccess';
import {
  allocateCustomerReceiptPrisma,
  backfillApprovedSalesContractCustomers,
  bindTaxOutboxChannelPrisma,
  cancelCustomerAccountingRelationship,
  confirmBankMatchPrisma,
  configureTaxSubmissionChannelPrisma,
  createAccountingTaxRulePrisma,
  createBankImportMappingPrisma,
  createControlTransferPolicyPrisma,
  createCustomerPostingRulePrisma,
  createReceivableCheckPrisma,
  exportCustomerStatementPrisma,
  importBankStatementLinePrisma,
  issuePettyCashAdvancePrisma,
  listCustomerAccountsPrisma,
  listTaxOverviewPrisma,
  listTreasuryOverviewPrisma,
  projectCustomerAccountPrisma,
  publishDestinationAcceptanceEvidencePrisma,
  publishVatInputEvidencePrisma,
  proposeBankMatchesPrisma,
  recognizeCustomerSalePrisma,
  recognizeCustomerReturnPrisma,
  recordCashCountPrisma,
  recordCustomerReceiptPrisma,
  recordInternalTreasuryTransferPrisma,
  reconcileVatPeriodPrisma,
  reverseBankMatchPrisma,
  settlePettyCashAdvancePrisma,
  reverseCustomerAllocationPrisma,
  transitionReceivableCheckPrisma,
} from '../services/accountingCustomerTreasuryPrisma';

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
const customerPostingAccess = [...editAccess, requireFeatureAccess(FEATURES.ACCOUNTING_CUSTOMER_POSTING_MANAGE, FEATURE_PERMISSIONS.EDIT)];
const treasuryCommandAccess = [...editAccess, requireFeatureAccess(FEATURES.ACCOUNTING_TREASURY_MANAGE, FEATURE_PERMISSIONS.EDIT)];
const taxCommandAccess = [...viewAccess, requireNarrowFeatureAccess(FEATURES.ACCOUNTING_TAX_SUBMISSIONS_MANAGE, FEATURE_PERMISSIONS.EDIT)];
const taxManagerAccess = [...managerAccess, requireNarrowFeatureAccess(FEATURES.ACCOUNTING_TAX_SUBMISSIONS_MANAGE, FEATURE_PERMISSIONS.EDIT)];
const exportAccess = [...viewAccess, requireNarrowFeatureAccess(FEATURES.ACCOUNTING_CUSTOMER_STATEMENTS_EXPORT, FEATURE_PERMISSIONS.VIEW)];
const evidenceCommandAccess = [...viewAccess, requireNarrowFeatureAccess(FEATURES.ACCOUNTING_EVIDENCE_MANAGE, FEATURE_PERMISSIONS.EDIT)];

const profileOf = (req: WorkspaceRequest): AccountingAccessProfile => accountingAccessProfileFromPermission(req.workspacePermission);
const actorOf = (req: WorkspaceRequest) => {
  const featurePermission = (req as WorkspaceRequest & { featurePermission?: string }).featurePermission;
  const workspaceProfile = profileOf(req);
  const profile: AccountingAccessProfile = featurePermission === FEATURE_PERMISSIONS.ADMIN
    ? 'ACCOUNTING_MANAGER'
    : featurePermission === FEATURE_PERMISSIONS.EDIT && workspaceProfile === 'VIEWER'
      ? 'ACCOUNTANT'
      : workspaceProfile;
  return ({
  id: req.user!.id,
  profile,
  isGlobalAdmin: req.user?.role === 'ADMIN',
  });
};

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
const signedRials = (value: unknown) => {
  const normalized = normalizeDigits(value).trim();
  if (!/^-?\d+$/.test(normalized)) throw new AccountingLedgerError('INVALID_RIAL_AMOUNT', 'مبلغ اصلاح ریال باید عدد صحیح باشد.', 400);
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
    if (error instanceof AccountingLedgerError || error instanceof AccountingCustomerTreasuryError) {
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

router.patch('/customer-relationships/:id/cancel', ...managerAccess, run((req) => cancelCustomerAccountingRelationship(prisma, {
  relationshipId: req.params.id, relationshipVersion: Number(req.body.relationshipVersion),
  cancelledAt: validDate(req.body.cancelledAt, 'تاریخ لغو رابطه فروش'), actor: actorOf(req),
})));

router.post('/customer-sales/recognize', ...customerPostingAccess, run((req) => {
  const evidence = { ...req.body.evidence, occurredAt: validDate(req.body.evidence?.occurredAt, 'زمان شاهد انتقال کنترل') };
  return recognizeCustomerSalePrisma(prisma, {
    ...req.body,
    transferredAt: validDate(req.body.transferredAt, 'زمان انتقال کنترل'),
    dueAt: validDate(req.body.dueAt, 'سررسید صورتحساب'),
    evidence,
    lines: (req.body.lines || []).map((line: any) => ({ ...line, netRials: wholeRials(line.netRials),
      taxRials: wholeRials(line.taxRials), costRials: wholeRials(line.costRials) })),
    actor: actorOf(req),
  });
}));
router.post('/customer-sales/returns/recognize', ...customerPostingAccess, run((req) => recognizeCustomerReturnPrisma(prisma, {
  ...req.body, returnedAt: validDate(req.body.returnedAt, 'زمان برگشت تأییدشده'),
  evidenceIds: (req.body.evidenceIds || []).map(String),
  lines: (req.body.lines || []).map((line: any) => ({ ...line, netRials: wholeRials(line.netRials),
    taxRials: wholeRials(line.taxRials), costRials: wholeRials(line.costRials) })),
  correlationId: String(req.body.correlationId || req.get('X-Correlation-ID') || randomUUID()), actor: actorOf(req),
})));

router.post('/customer-sales/control-transfer-policies', ...managerAccess, run((req) => createControlTransferPolicyPrisma(prisma, {
  ...req.body, version: Number(req.body.version), effectiveFrom: validDate(req.body.effectiveFrom, 'تاریخ اثر سیاست انتقال کنترل'),
  effectiveTo: req.body.effectiveTo ? validDate(req.body.effectiveTo, 'پایان اثر سیاست انتقال کنترل') : undefined,
  exceptionOccurredAt: req.body.exceptionOccurredAt ? validDate(req.body.exceptionOccurredAt, 'زمان وقوع استثنای قراردادی') : undefined,
  actor: actorOf(req),
})));
router.post('/customer-sales/posting-rules', ...managerAccess, run((req) => createCustomerPostingRulePrisma(prisma, {
  ...req.body, version: Number(req.body.version), effectiveFrom: validDate(req.body.effectiveFrom, 'تاریخ اثر قاعده ثبت مشتری'),
  effectiveTo: req.body.effectiveTo ? validDate(req.body.effectiveTo, 'پایان اثر قاعده ثبت مشتری') : undefined,
  actor: actorOf(req),
})));
router.post('/evidence/destination-acceptances', ...evidenceCommandAccess, run((req) => publishDestinationAcceptanceEvidencePrisma(prisma, {
  sourceId: String(req.body.sourceId || ''), sourceVersion: Number(req.body.sourceVersion),
  contractId: String(req.body.contractId || ''), contractVersion: Number(req.body.contractVersion),
  pricingVersionId: String(req.body.pricingVersionId || ''), occurredAt: validDate(req.body.occurredAt, 'زمان پذیرش مقصد'),
  productRows: (req.body.productRows || []).map((row: any) => ({ id: String(row.id || ''), quantity: String(row.quantity || '') })),
  actorId: req.user?.id || 'ناشناس',
})));
router.post('/evidence/vat-inputs', ...evidenceCommandAccess, run((req) => publishVatInputEvidencePrisma(prisma, {
  legalEntityId: String(req.body.legalEntityId || ''), fiscalYearId: String(req.body.fiscalYearId || ''),
  periodId: String(req.body.periodId || ''), kind: req.body.kind, amountRials: signedRials(req.body.amountRials),
  sourceType: String(req.body.sourceType || ''), sourceId: String(req.body.sourceId || ''),
  sourceVersion: Number(req.body.sourceVersion), payload: req.body.payload,
  occurredAt: validDate(req.body.occurredAt, 'زمان شاهد ارزش افزوده'),
})));

router.get('/customer-profiles/:id/projection', ...viewAccess, run(async (req) => {
  const exportCapability = await resolveNarrowFeatureAccess(prisma, { userId: req.user!.id, role: req.user!.role,
    workspace: WORKSPACES.ACCOUNTING, feature: FEATURES.ACCOUNTING_CUSTOMER_STATEMENTS_EXPORT,
    requiredPermission: FEATURE_PERMISSIONS.VIEW });
  return {
    ...await projectCustomerAccountPrisma(prisma, {
    profileId: req.params.id, asOf: validDate(req.query.asOf || new Date().toISOString(), 'زمان گزارش'),
    }),
    capabilities: { canExport: exportCapability.allowed },
  };
}));
router.get('/customer-profiles/:id/export.:format', ...exportAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const format = req.params.format;
    if (format !== 'xlsx' && format !== 'pdf') throw new AccountingCustomerTreasuryError('INVALID_EXPORT_FORMAT', 'قالب خروجی باید PDF یا Excel باشد.', 400);
    const artifact = await exportCustomerStatementPrisma(prisma, { profileId: req.params.id,
      asOf: validDate(req.query.asOf || new Date().toISOString(), 'زمان گزارش'), format, actorId: req.user?.id || 'ناشناس' });
    res.setHeader('Content-Type', artifact.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="customer-statement-${req.params.id}.${artifact.extension}"`);
    res.send(artifact.bytes);
  } catch (error) {
    if (error instanceof AccountingCustomerTreasuryError || error instanceof AccountingLedgerError) {
      res.status(error.status).json({ success: false, code: error.code, error: error.message }); return;
    }
    console.error('Customer statement export failed:', error);
    res.status(500).json({ success: false, error: 'ساخت خروجی صورتحساب مشتری انجام نشد.' });
  }
});
router.get('/customer-profiles', ...viewAccess, run((req) => listCustomerAccountsPrisma(prisma, {
  asOf: validDate(req.query.asOf || new Date().toISOString(), 'زمان گزارش'), search: String(req.query.search || ''),
})));
router.get('/treasury/overview', ...viewAccess, run(async (req) => {
  const feature = await resolveNarrowFeatureAccess(prisma, { userId: req.user!.id, role: req.user!.role,
    workspace: WORKSPACES.ACCOUNTING, feature: FEATURES.ACCOUNTING_TREASURY_MANAGE,
    requiredPermission: FEATURE_PERMISSIONS.EDIT });
  return { ...await listTreasuryOverviewPrisma(prisma),
    capabilities: { canManage: feature.allowed && ['edit', 'admin'].includes(req.workspacePermission || ''),
      canConfigure: feature.allowed && req.workspacePermission === WORKSPACE_PERMISSIONS.ADMIN } };
}));
router.get('/tax/overview', ...viewAccess, run(async (req) => {
  const feature = await resolveNarrowFeatureAccess(prisma, { userId: req.user!.id, role: req.user!.role,
    workspace: WORKSPACES.ACCOUNTING, feature: FEATURES.ACCOUNTING_TAX_SUBMISSIONS_MANAGE,
    requiredPermission: FEATURE_PERMISSIONS.EDIT });
  return { ...await listTaxOverviewPrisma(prisma), capabilities: {
    canManage: feature.allowed,
    canConfigure: feature.allowed && req.workspacePermission === WORKSPACE_PERMISSIONS.ADMIN,
  } };
}));

router.post('/treasury/receipts', ...treasuryCommandAccess, run((req) => recordCustomerReceiptPrisma(prisma, {
  ...req.body, amountRials: wholeRials(req.body.amountRials), occurredAt: validDate(req.body.occurredAt, 'زمان دریافت'),
  correlationId: String(req.body.correlationId || req.get('X-Correlation-ID') || randomUUID()), actor: actorOf(req),
})));
router.post('/treasury/internal-transfers', ...treasuryCommandAccess, run((req) => recordInternalTreasuryTransferPrisma(prisma, {
  ...req.body, amountRials: wholeRials(req.body.amountRials), occurredAt: validDate(req.body.occurredAt, 'زمان انتقال داخلی'),
  correlationId: String(req.body.correlationId || req.get('X-Correlation-ID') || randomUUID()), actor: actorOf(req),
})));

router.post('/treasury/allocations', ...treasuryCommandAccess, run((req) => allocateCustomerReceiptPrisma(prisma, {
  ...req.body, documentDate: validDate(req.body.documentDate, 'تاریخ تخصیص'),
  allocations: (req.body.allocations || []).map((item: any) => ({ openItemId: String(item.openItemId), amountRials: wholeRials(item.amountRials) })),
  correlationId: String(req.body.correlationId || req.get('X-Correlation-ID') || randomUUID()), actor: actorOf(req),
})));

router.post('/treasury/allocations/:id/reverse', ...treasuryCommandAccess, run((req) => reverseCustomerAllocationPrisma(prisma, {
  ...req.body, allocationId: req.params.id, documentDate: validDate(req.body.documentDate, 'تاریخ برگشت تخصیص'),
  correlationId: String(req.body.correlationId || req.get('X-Correlation-ID') || randomUUID()), actor: actorOf(req),
})));

router.post('/treasury/bank-lines/import', ...treasuryCommandAccess, run((req) => importBankStatementLinePrisma(prisma, {
  ...req.body, mappingVersion: Number(req.body.mappingVersion),
  bookedAt: req.body.adapterType === 'MANUAL' ? validDate(req.body.bookedAt, 'تاریخ ردیف بانکی') : new Date(0),
  amountRials: req.body.adapterType === 'MANUAL' ? wholeRials(req.body.amountRials) : 0n,
})));
router.post('/treasury/bank-mappings', ...managerAccess, run((req) => createBankImportMappingPrisma(prisma, {
  financialAccountId: String(req.body.financialAccountId || ''), adapterType: req.body.adapterType,
  version: Number(req.body.version), columnMapping: req.body.columnMapping,
  effectiveFrom: validDate(req.body.effectiveFrom, 'تاریخ اثر نگاشت بانکی'),
  effectiveTo: req.body.effectiveTo ? validDate(req.body.effectiveTo, 'پایان اثر نگاشت بانکی') : undefined,
  actor: actorOf(req),
})));

router.post('/treasury/bank-lines/:id/propose-matches', ...treasuryCommandAccess, run((req) => proposeBankMatchesPrisma(prisma, req.params.id)));
router.post('/treasury/bank-matches/:id/confirm', ...treasuryCommandAccess, run((req) => confirmBankMatchPrisma(prisma, {
  matchId: req.params.id, actor: actorOf(req), reason: String(req.body.reason || ''),
})));
router.post('/treasury/bank-matches/:id/reverse', ...treasuryCommandAccess, run((req) => reverseBankMatchPrisma(prisma, {
  matchId: req.params.id, actor: actorOf(req), reason: String(req.body.reason || ''),
})));

router.post('/treasury/checks', ...treasuryCommandAccess, run((req) => createReceivableCheckPrisma(prisma, {
  ...req.body, amountRials: wholeRials(req.body.amountRials), dueAt: validDate(req.body.dueAt, 'سررسید چک'),
  actor: actorOf(req),
})));
router.post('/treasury/checks/:id/events', ...treasuryCommandAccess, run((req) => transitionReceivableCheckPrisma(prisma, {
  ...req.body, checkId: req.params.id, occurredAt: validDate(req.body.occurredAt, 'زمان رویداد چک'), actor: actorOf(req),
})));

router.post('/treasury/cash-counts', ...treasuryCommandAccess, run((req) => recordCashCountPrisma(prisma, {
  ...req.body, countedAt: validDate(req.body.countedAt, 'زمان شمارش صندوق'), expectedRials: wholeRials(req.body.expectedRials),
  countedRials: wholeRials(req.body.countedRials), actor: actorOf(req),
})));
router.post('/treasury/petty-cash-advances', ...treasuryCommandAccess, run((req) => issuePettyCashAdvancePrisma(prisma, {
  ...req.body, amountRials: wholeRials(req.body.amountRials), limitRials: wholeRials(req.body.limitRials),
  issuedAt: validDate(req.body.issuedAt, 'تاریخ پرداخت تنخواه'), settlementDueAt: validDate(req.body.settlementDueAt, 'سررسید تسویه تنخواه'),
  actor: actorOf(req),
})));
router.post('/treasury/petty-cash-advances/:id/settle', ...treasuryCommandAccess, run((req) => settlePettyCashAdvancePrisma(prisma, {
  ...req.body, advanceId: req.params.id, settledRials: wholeRials(req.body.settledRials),
  settledAt: validDate(req.body.settledAt, 'تاریخ تسویه تنخواه'), actor: actorOf(req),
})));

router.post('/tax-channels', ...taxManagerAccess, run((req) => configureTaxSubmissionChannelPrisma(prisma, {
  ...req.body, effectiveFrom: validDate(req.body.effectiveFrom, 'تاریخ اثر کانال مالیاتی'),
  effectiveTo: req.body.effectiveTo ? validDate(req.body.effectiveTo, 'پایان اثر کانال مالیاتی') : undefined,
  actor: actorOf(req),
})));
router.post('/tax-rules', ...taxManagerAccess, run((req) => createAccountingTaxRulePrisma(prisma, {
  legalEntityId: String(req.body.legalEntityId || ''), code: String(req.body.code || ''), version: Number(req.body.version),
  effectiveFrom: validDate(req.body.effectiveFrom, 'تاریخ اثر قاعده مالیاتی'),
  effectiveTo: req.body.effectiveTo ? validDate(req.body.effectiveTo, 'پایان اثر قاعده مالیاتی') : undefined,
  citation: String(req.body.citation || ''), invoiceType: String(req.body.invoiceType || ''),
  invoicePattern: String(req.body.invoicePattern || ''), exempt: Boolean(req.body.exempt),
  exemptionReason: req.body.exemptionReason ? String(req.body.exemptionReason) : undefined,
  rateBasisPoints: Number(req.body.rateBasisPoints), allocationRule: String(req.body.allocationRule || ''),
  roundingRule: String(req.body.roundingRule || ''), actor: actorOf(req),
})));
router.post('/tax-outbox/:id/channel', ...taxCommandAccess, run((req) => bindTaxOutboxChannelPrisma(prisma, {
  outboxMessageId: req.params.id, channelId: String(req.body.channelId || ''),
})));
router.post('/tax/vat-reconciliations', ...taxCommandAccess, run((req) => reconcileVatPeriodPrisma(prisma, {
  legalEntityId: String(req.body.legalEntityId || ''), fiscalYearId: String(req.body.fiscalYearId || ''),
  periodId: String(req.body.periodId || ''), actor: actorOf(req),
})));

router.get('/context', ...viewAccess, run(async (req) => {
  const context = await administration.getContext();
  return context
    ? { ...context, configured: true, accessProfile: profileOf(req), isGlobalAdmin: req.user?.role === 'ADMIN' }
    : { configured: false, accessProfile: profileOf(req), isGlobalAdmin: req.user?.role === 'ADMIN' };
}));

router.post('/setup', ...managerAccess, run(async (req) => {
  const setup = await administration.setup({ legalEntity: {
    code: String(req.body.legalEntity?.code || '').trim(),
    namePersian: String(req.body.legalEntity?.namePersian || '').trim(),
    nationalId: req.body.legalEntity?.nationalId,
    economicCode: req.body.legalEntity?.economicCode,
    activeFrom: validDate(req.body.legalEntity?.activeFrom, 'تاریخ شروع فعالیت'),
  },
  book: { code: String(req.body.book?.code || '').trim(), namePersian: String(req.body.book?.namePersian || '').trim() },
  scheme: req.body.scheme,
    actorId: req.user!.id,
  });
  await backfillApprovedSalesContractCustomers(prisma, { actorId: req.user!.id });
  return setup;
}));

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
