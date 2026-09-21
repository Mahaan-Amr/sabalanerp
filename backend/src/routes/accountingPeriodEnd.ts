import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express, { Response } from 'express';
import { Prisma } from '@prisma/client';
import * as XLSX from 'xlsx';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import { requireWorkspaceAccessWithClient, WORKSPACE_PERMISSIONS, WORKSPACES, type WorkspaceRequest } from '../middleware/workspace';
import { applyPayrollSettlementAttempt, buildTAccountProjection, calculateAssetDepreciation, createAccountingPeriodEndApplication, type AssetDepreciationMethod, type PeriodEndEvidence } from '../services/accountingPeriodEnd';
import { advanceCloseRun, buildYearEndTransition, finalizeCloseRun, type CloseCheckInput, type CloseStep } from '../services/accountingPeriodClose';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from '../services/accountingLedgerFoundation';
import {
  createAccountingPeriodEndPrismaRepository,
  createOfficialAccountingSnapshot,
  listAccountingPeriodEndOverview,
} from '../services/accountingPeriodEndPrismaRepository';
import { createAccountingLedgerPrismaRepository } from '../services/accountingLedgerPrismaRepository';
import { generatePdfBufferFromHtml } from '../utils/pdf';
import { scanHiringFile, sha256File } from '../services/hrHiringFileStorage';

const router = express.Router();
const viewAccess = [protect, requireWorkspaceAccessWithClient(prisma, WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.VIEW)];
const editAccess = [protect, requireWorkspaceAccessWithClient(prisma, WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.EDIT)];
const managerAccess = [protect, requireWorkspaceAccessWithClient(prisma, WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.ADMIN)];

const serialize = (value: unknown) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item));
const date = (value: unknown, label: string) => {
  const parsed = new Date(String(value ?? ''));
  if (Number.isNaN(parsed.getTime())) throw new Error(`${label} معتبر نیست.`);
  return parsed;
};
const rials = (value: unknown, label: string) => {
  const normalized = String(value ?? '').replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
  if (!/^-?\d+$/.test(normalized)) throw new Error(`${label} باید مبلغ صحیح ریالی باشد.`);
  return BigInt(normalized);
};
const positiveText = (value: unknown, label: string) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${label} الزامی است.`);
  return normalized;
};
const depreciationMethod = (value: unknown, label: string): AssetDepreciationMethod => {
  const method = positiveText(value, label);
  if (!['STRAIGHT_LINE', 'DECLINING_BALANCE', 'UNITS_OF_PRODUCTION'].includes(method)) throw new Error(`${label} معتبر نیست.`);
  return method as AssetDepreciationMethod;
};
const jsonHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]!));
const accountingArchivePath = (storageKey: string) => {
  const root = path.resolve(process.cwd(), 'storage', 'accounting-archive');
  const normalized = storageKey.replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.split('/').includes('..')) throw new Error('نشانی فایل بایگانی معتبر نیست.');
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error('نشانی فایل بایگانی معتبر نیست.');
  return resolved;
};

const reportTypeFa: Record<string, string> = {
  TRIAL_BALANCE: 'تراز آزمایشی', FINANCIAL_STATEMENT: 'صورت‌های مالی', CASH_FLOW: 'صورت جریان وجوه نقد',
  LEGAL_BOOK: 'دفتر قانونی', T_ACCOUNT: 'حساب تی',
};

const amountColumnFa: Record<string, string> = {
  openingDebit: 'مانده بدهکار اول دوره', openingCredit: 'مانده بستانکار اول دوره',
  turnoverDebit: 'گردش بدهکار', turnoverCredit: 'گردش بستانکار',
  endingDebit: 'مانده بدهکار پایان دوره', endingCredit: 'مانده بستانکار پایان دوره',
  periodNetDebit: 'خالص بدهکار دوره', periodNetCredit: 'خالص بستانکار دوره',
};
const snapshotRows = (dataset: any) => {
  const columnKeys = Array.isArray(dataset?.columnKeys) ? dataset.columnKeys : Object.keys(amountColumnFa);
  return (Array.isArray(dataset?.rows) ? dataset.rows : []).map((row: any) => Object.fromEntries([
    ['عنوان', row.titlePersian],
    ...columnKeys.map((key: string) => [amountColumnFa[key] || key, row.amounts?.[key] ?? '0']),
  ]));
};

const auditSnapshotExport = async (req: WorkspaceRequest, snapshot: { id: string; datasetHash: string }, kind: 'PDF' | 'EXCEL') => {
  await createAccountingLedgerPrismaRepository(prisma).transaction((tx) => tx.appendAudit({
    action: `OFFICIAL_REPORT_${kind}_EXPORTED`,
    result: 'SUCCEEDED',
    actorId: req.user!.id,
    effectiveProfile: req.workspacePermission === 'admin' ? 'ACCOUNTING_MANAGER' : req.workspacePermission === 'edit' ? 'ACCOUNTANT' : 'VIEWER',
    entityType: 'OFFICIAL_REPORT_SNAPSHOT',
    entityId: snapshot.id,
    correlationId: String(req.get('X-Correlation-ID') || randomUUID()),
    reason: 'دریافت خروجی رسمی گزارش',
    payloadHash: snapshot.datasetHash,
    sessionContext: { exportKind: kind },
  }));
};

const run = (handler: (req: WorkspaceRequest) => Promise<unknown>, created = false) => async (req: WorkspaceRequest, res: Response) => {
  try {
    res.status(created ? 201 : 200).json({ success: true, data: serialize(await handler(req)) });
  } catch (error) {
    const trackingId = `ACC-END-${Date.now().toString(36).toUpperCase()}`;
    console.error('Accounting period-end request failed:', { trackingId, error });
    res.status(400).json({
      success: false,
      error: error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
        ? error.message
        : 'عملیات پایان دوره انجام نشد. شناسه پیگیری را به پشتیبانی اعلام کنید.',
      trackingId,
    });
  }
};

const evidenceFromBody = (body: any): PeriodEndEvidence => {
  const common = {
    kind: String(body.kind),
    sourceId: positiveText(body.sourceId, 'شناسه منبع'),
    sourceVersion: Number(body.sourceVersion),
    sourceHash: positiveText(body.sourceHash, 'اثر انگشت منبع'),
    occurredAt: date(body.occurredAt, 'تاریخ وقوع'),
  };
  if (!Number.isInteger(common.sourceVersion) || common.sourceVersion < 1) throw new Error('نسخه منبع معتبر نیست.');
  if (common.kind === 'ASSET_PAYMENT') return {
    ...common, kind: 'ASSET_PAYMENT', assetId: positiveText(body.assetId, 'شناسه دارایی'), amountRials: rials(body.amountRials, 'مبلغ پرداخت'),
  };
  if (common.kind === 'ASSET_COST') return {
    ...common, kind: 'ASSET_COST', assetId: positiveText(body.assetId, 'شناسه دارایی'), costKind: body.costKind,
    amountRials: rials(body.amountRials, 'بهای دارایی'), constructionInProgressAccountId: positiveText(body.constructionInProgressAccountId, 'حساب دارایی در جریان تکمیل'),
    creditAccountId: positiveText(body.creditAccountId, 'حساب بستانکار'), documentIds: (body.documentIds || []).map((item: unknown) => positiveText(item, 'شناسه مدرک')),
  };
  if (common.kind === 'ASSET_READY_FOR_USE') return {
    ...common,
    kind: 'ASSET_READY_FOR_USE',
    asset: {
      ...body.asset,
      readyForUseAt: date(body.asset?.readyForUseAt, 'تاریخ آماده‌به‌کار'),
      costRials: rials(body.asset?.costRials, 'بهای دارایی'),
      components: (body.asset?.components || []).map((component: any) => ({
        ...component,
        costRials: rials(component.costRials, 'بهای جزء دارایی'),
        residualValueRials: rials(component.residualValueRials, 'ارزش اسقاط جزء دارایی'),
        usefulLifeMonths: Number(component.usefulLifeMonths),
      })),
      taxBasis: { ...body.asset?.taxBasis, costRials: rials(body.asset?.taxBasis?.costRials, 'مبنای مالیاتی دارایی') },
    },
  };
  if (common.kind === 'ASSET_LIFECYCLE') return {
    ...common,
    kind: 'ASSET_LIFECYCLE',
    assetId: positiveText(body.assetId, 'شناسه دارایی'),
    eventType: body.eventType,
    treatment: body.treatment,
    lines: (body.lines || []).map((line: any) => ({
      accountId: positiveText(line.accountId, 'حساب رویداد دارایی'),
      debitRials: rials(line.debitRials, 'بدهکار رویداد دارایی'),
      creditRials: rials(line.creditRials, 'بستانکار رویداد دارایی'),
      description: positiveText(line.description, 'شرح رویداد دارایی'),
    })),
    lifecyclePayload: body.lifecyclePayload || { documentIds: [] },
  };
  if (common.kind === 'APPROVED_PAYROLL') return {
    ...common,
    kind: 'APPROVED_PAYROLL',
    populationHash: positiveText(body.populationHash, 'هش جمعیت حقوق'),
    policyHash: positiveText(body.policyHash, 'هش سیاست حقوق'),
    summaryLines: (body.summaryLines || []).map((line: any) => ({
      ...line, debitRials: rials(line.debitRials, 'بدهکار خلاصه حقوق'), creditRials: rials(line.creditRials, 'بستانکار خلاصه حقوق'),
    })),
    obligations: (body.obligations || []).map((obligation: any) => ({ ...obligation, amountRials: rials(obligation.amountRials, 'مبلغ تعهد حقوق') })),
  };
  if (common.kind === 'RECOGNITION_DUE') return {
    ...common,
    kind: 'RECOGNITION_DUE',
    dueIdentity: positiveText(body.dueIdentity, 'شناسه سررسید'),
    scheduleKind: body.scheduleKind,
    amountRials: rials(body.amountRials, 'مبلغ شناسایی'),
    debitAccountId: positiveText(body.debitAccountId, 'حساب بدهکار'),
    creditAccountId: positiveText(body.creditAccountId, 'حساب بستانکار'),
    estimateBasis: positiveText(body.estimateBasis, 'مبنای برآورد'),
    appliesFrom: date(body.appliesFrom, 'تاریخ اثر برنامه'),
    reviewDueAt: date(body.reviewDueAt, 'تاریخ بازبینی'),
  };
  throw new Error('نوع شاهد پایان دوره پشتیبانی نمی‌شود.');
};

router.get('/overview', ...viewAccess, run((req) => listAccountingPeriodEndOverview(prisma, positiveText(req.query.bookId, 'دفتر حسابداری'))));

router.post('/evidence', ...editAccess, run(async (req) => {
  const application = createAccountingPeriodEndApplication(createAccountingPeriodEndPrismaRepository(prisma), { now: () => new Date() });
  return application.acceptEvidence({
    bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
    fiscalYearId: positiveText(req.body.fiscalYearId, 'سال مالی'),
    periodId: positiveText(req.body.periodId, 'دوره مالی'),
    actorId: req.user!.id,
    evidence: evidenceFromBody(req.body.evidence),
  });
}, true));

router.post('/payroll-obligations/:id/settlement-voucher', ...editAccess, run(async (req) => prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM accounting_payroll_obligations WHERE id = ${req.params.id} FOR UPDATE`;
  const obligation = await tx.accountingPayrollObligation.findUniqueOrThrow({ where: { id: req.params.id }, include: { handoff: true, settlementAttempts: true } });
  const amountRials = rials(req.body.amountRials, 'مبلغ تسویه حقوق');
  const remaining = BigInt(obligation.amountRials.toFixed(0)) - BigInt(obligation.settledRials.toFixed(0));
  if (amountRials <= 0n || amountRials > remaining) throw new Error('مبلغ تسویه حقوق از مانده تعهد بیشتر است.');
  const bankResultHash = positiveText(req.body.bankResultHash, 'اثر انگشت نتیجه بانک').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(bankResultHash)) throw new Error('اثر انگشت نتیجه بانک باید SHA-256 معتبر باشد.');
  const summaryLines = ((obligation.handoff.summaryPayload as any)?.summaryLines || []) as Array<{ componentCode: string; accountId: string; creditRials: string | number }>;
  const liabilityLine = summaryLines.find((line) => line.componentCode === obligation.obligationType && BigInt(line.creditRials || 0) > 0n);
  if (!liabilityLine) throw new Error('حساب کنترل تعهد حقوق در تحویل تأییدشده پیدا نشد.');
  const period = await tx.accountingPostingPeriod.findUniqueOrThrow({ where: { id: positiveText(req.body.periodId, 'دوره مالی') } });
  const sourcePayload = { obligationIdentity: obligation.obligationIdentity, amountRials: amountRials.toString(), bankResultHash };
  const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `عطف-${randomUUID()}` });
  const draft = await ledger.createManualDraft({
    bookId: obligation.handoff.bookId, fiscalYearId: period.fiscalYearId, periodId: period.id,
    idempotencyKey: positiveText(req.body.attemptIdentity, 'شناسه تلاش پرداخت'), correlationId: obligation.obligationIdentity,
    description: `تسویه تعهد حقوق ${obligation.obligationIdentity}`, documentDate: date(req.body.documentDate, 'تاریخ تسویه'), occurredAt: date(req.body.documentDate, 'تاریخ تسویه'),
    source: { type: 'PAYROLL_SETTLEMENT', id: obligation.id, version: obligation.settlementAttempts.length + 1, hash: hashAccountingEvidence(sourcePayload), payload: sourcePayload },
    actor: { id: req.user!.id, profile: 'ACCOUNTANT' },
    lines: [
      { accountId: liabilityLine.accountId, debitRials: amountRials, creditRials: 0n, description: 'تسویه بدهی حقوق', dimensions: [], rawAmountBeforeRounding: amountRials.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1,
        evidence: { type: 'نتیجه قطعی بانک', id: obligation.obligationIdentity, version: obligation.settlementAttempts.length + 1, hash: hashAccountingEvidence(sourcePayload), payload: sourcePayload } },
      { accountId: positiveText(req.body.bankLedgerAccountId, 'حساب دفترکل بانک'), financialAccountId: positiveText(req.body.financialAccountId, 'حساب مالی بانک'), debitRials: 0n, creditRials: amountRials, description: 'برداشت بانکی حقوق', dimensions: [], rawAmountBeforeRounding: amountRials.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1,
        evidence: { type: 'نتیجه قطعی بانک', id: obligation.obligationIdentity, version: obligation.settlementAttempts.length + 1, hash: hashAccountingEvidence(sourcePayload), payload: sourcePayload } },
    ],
  });
  return ledger.postVoucher({ voucherId: draft.id, actor: { id: req.user!.id, profile: 'ACCOUNTANT' }, reason: 'ثبت تسویه بانکی تعهد حقوق' });
}), true));

router.post('/payroll-obligations/:id/settlement-attempts', ...editAccess, run(async (req) => prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM accounting_payroll_obligations WHERE id = ${req.params.id} FOR UPDATE`;
  const obligation = await tx.accountingPayrollObligation.findUniqueOrThrow({
    where: { id: req.params.id }, include: { handoff: true, settlementAttempts: { orderBy: { attemptedAt: 'asc' } } },
  });
  const attempt = {
    identity: positiveText(req.body.attemptIdentity, 'شناسه تلاش پرداخت'),
    status: req.body.status === 'SUCCEEDED' ? 'SUCCEEDED' as const : 'FAILED' as const,
    amountRials: rials(req.body.amountRials, 'مبلغ تلاش پرداخت'),
  };
  let settlementVoucherId: string | null = null;
  if (attempt.status === 'SUCCEEDED') {
    const bankResultHash = positiveText(req.body.bankResultHash, 'اثر انگشت نتیجه بانک');
    if (!/^[a-f0-9]{64}$/i.test(bankResultHash)) throw new Error('اثر انگشت نتیجه بانک باید SHA-256 معتبر باشد.');
    settlementVoucherId = positiveText(req.body.settlementVoucherId, 'سند تسویه حقوق');
    const voucher = await tx.accountingLedgerVoucher.findUnique({ where: { id: settlementVoucherId } });
    const correctSource = voucher?.sourceType === 'PAYROLL_SETTLEMENT'
      && [obligation.id, obligation.obligationIdentity].includes(voucher.sourceId);
    const correctAmount = voucher && BigInt(voucher.debitTotalRials.toFixed(0)) === attempt.amountRials
      && BigInt(voucher.creditTotalRials.toFixed(0)) === attempt.amountRials;
    const voucherPayload = voucher?.sourcePayload as Record<string, unknown> | undefined;
    const correctBankResult = voucherPayload?.bankResultHash === bankResultHash;
    if (!voucher || voucher.bookId !== obligation.handoff.bookId || voucher.status !== 'POSTED' || !correctSource || !correctAmount || !correctBankResult) {
      throw new Error('تسویه موفق حقوق باید به سند قطعی تسویه همان تعهد، با مبلغ دقیق و در همان دفتر متصل باشد.');
    }
  }
  const next = applyPayrollSettlementAttempt({
    identity: obligation.obligationIdentity,
    amountRials: BigInt(obligation.amountRials.toFixed(0)),
    settledRials: BigInt(obligation.settledRials.toFixed(0)),
    status: obligation.status as 'OPEN' | 'PARTIALLY_SETTLED' | 'SETTLED',
    attempts: obligation.settlementAttempts.map((item) => ({
      identity: item.attemptIdentity, status: item.status as 'FAILED' | 'SUCCEEDED', amountRials: BigInt(item.amountRials.toFixed(0)),
    })),
  }, attempt);
  if (obligation.settlementAttempts.some((item) => item.attemptIdentity === attempt.identity)) return next;
  await tx.accountingPayrollSettlementAttempt.create({ data: {
    obligationId: obligation.id,
    attemptIdentity: attempt.identity,
    status: attempt.status,
    amountRials: attempt.amountRials.toString(),
    bankResultHash: req.body.bankResultHash,
    settlementVoucherId,
    failureReason: attempt.status === 'FAILED' ? positiveText(req.body.failureReason, 'دلیل شکست پرداخت') : null,
    attemptedBy: req.user!.id,
  } });
  await tx.accountingPayrollObligation.update({ where: { id: obligation.id }, data: {
    settledRials: next.settledRials.toString(), status: next.status,
    lastAttemptIdentity: attempt.identity, lastAttemptAt: new Date(),
  } });
  return next;
}), true));

router.post('/asset-policies', ...managerAccess, run((req) => prisma.accountingAssetClassPolicy.create({
  data: {
    bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
    classCode: positiveText(req.body.classCode, 'کد طبقه دارایی'),
    version: Number(req.body.version),
    titlePersian: positiveText(req.body.titlePersian, 'عنوان طبقه دارایی'),
    effectiveFrom: date(req.body.effectiveFrom, 'تاریخ اثر سیاست'),
    effectiveTo: req.body.effectiveTo ? date(req.body.effectiveTo, 'تاریخ پایان سیاست') : null,
    capitalizationThresholdRials: rials(req.body.capitalizationThresholdRials, 'حد نصاب سرمایه‌ای').toString(),
    bookMethod: positiveText(req.body.bookMethod, 'روش استهلاک دفتری'),
    taxMethod: positiveText(req.body.taxMethod, 'روش استهلاک مالیاتی'),
    usefulLifeMonths: Number(req.body.usefulLifeMonths),
    residualValueBasisPoints: Number(req.body.residualValueBasisPoints || 0),
    decliningRateBasisPoints: req.body.decliningRateBasisPoints == null ? null : Number(req.body.decliningRateBasisPoints),
    assetAccountId: positiveText(req.body.assetAccountId, 'حساب دارایی'),
    cipAccountId: positiveText(req.body.cipAccountId, 'حساب جریان تکمیل'),
    depreciationExpenseAccountId: positiveText(req.body.depreciationExpenseAccountId, 'حساب هزینه استهلاک'),
    accumulatedDepreciationAccountId: positiveText(req.body.accumulatedDepreciationAccountId, 'حساب استهلاک انباشته'),
    impairmentExpenseAccountId: positiveText(req.body.impairmentExpenseAccountId, 'حساب هزینه کاهش ارزش'),
    impairmentAllowanceAccountId: positiveText(req.body.impairmentAllowanceAccountId, 'حساب ذخیره کاهش ارزش'),
    disposalGainAccountId: positiveText(req.body.disposalGainAccountId, 'حساب سود واگذاری'),
    disposalLossAccountId: positiveText(req.body.disposalLossAccountId, 'حساب زیان واگذاری'),
    changeReason: req.body.changeReason ? String(req.body.changeReason) : null,
    createdBy: req.user!.id,
  },
}), true));

router.post('/assets', ...editAccess, run(async (req) => prisma.$transaction(async (tx) => {
  const policy = await tx.accountingAssetClassPolicy.findUnique({ where: { id: positiveText(req.body.classPolicyId, 'سیاست طبقه دارایی') } });
  if (!policy || policy.bookId !== req.body.bookId) throw new Error('سیاست طبقه دارایی در این دفتر معتبر نیست.');
  const components = (req.body.components || []).map((component: any) => ({
    ...component,
    bookCostRials: rials(component.bookCostRials, 'بهای دفتری جزء'),
    taxCostRials: rials(component.taxCostRials, 'بهای مالیاتی جزء'),
    residualValueRials: rials(component.residualValueRials, 'ارزش اسقاط جزء'),
  }));
  const bookCost = rials(req.body.bookCostRials, 'بهای دفتری دارایی');
  if (components.length === 0 || components.reduce((total: bigint, component: any) => total + component.bookCostRials, 0n) !== bookCost) {
    throw new Error('جمع بهای اجزای دارایی باید دقیقاً با بهای دفتری دارایی برابر باشد.');
  }
  return tx.accountingFixedAsset.create({
    data: {
      bookId: req.body.bookId,
      registerNumber: positiveText(req.body.registerNumber, 'شماره ثبت دارایی'),
      classPolicyId: policy.id,
      titlePersian: positiveText(req.body.titlePersian, 'عنوان دارایی'),
      serialNumber: req.body.serialNumber,
      branchId: req.body.branchId,
      costCenterId: req.body.costCenterId,
      location: req.body.location,
      custodianPartyId: req.body.custodianPartyId,
      acquisitionAt: date(req.body.acquisitionAt, 'تاریخ تحصیل'),
      status: 'UNDER_CONSTRUCTION',
      bookCostRials: bookCost.toString(),
      taxCostRials: rials(req.body.taxCostRials, 'بهای مالیاتی دارایی').toString(),
      createdBy: req.user!.id,
      components: { create: components.map((component: any) => ({
        componentIdentity: positiveText(component.componentIdentity, 'شناسه جزء'),
        titlePersian: positiveText(component.titlePersian, 'عنوان جزء'),
        serialNumber: component.serialNumber,
        bookCostRials: component.bookCostRials.toString(),
        taxCostRials: component.taxCostRials.toString(),
        residualValueRials: component.residualValueRials.toString(),
        usefulLifeMonths: Number(component.usefulLifeMonths || policy.usefulLifeMonths),
        bookMethod: component.bookMethod || policy.bookMethod,
        taxMethod: component.taxMethod || policy.taxMethod,
      })) },
    },
    include: { components: true },
  });
}), true));

router.post('/assets/:id/depreciation', ...editAccess, run(async (req) => prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM accounting_fixed_assets WHERE id = ${req.params.id} FOR UPDATE`;
  const asset = await tx.accountingFixedAsset.findUniqueOrThrow({ where: { id: req.params.id }, include: { components: true } });
  if (!asset.readyForUseAt || asset.status !== 'ACTIVE') throw new Error('استهلاک فقط برای دارایی فعال و آماده‌به‌کار قابل ثبت است.');
  const period = await tx.accountingPostingPeriod.findUniqueOrThrow({ where: { id: positiveText(req.body.periodId, 'دوره مالی') }, include: { fiscalYear: true } });
  const eventIdentity = `DEPRECIATION:${asset.id}:${period.id}`;
  const existing = await tx.accountingAssetEvent.findUnique({ where: { eventIdentity } });
  if (existing) return existing;
  const policy = await tx.accountingAssetClassPolicy.findUniqueOrThrow({ where: { id: asset.classPolicyId } });
  const bookAccumulated = asset.components.reduce((total, component) => total + BigInt(component.accumulatedBookRials.toFixed(0)), 0n);
  const taxAccumulated = asset.components.reduce((total, component) => total + BigInt(component.accumulatedTaxRials.toFixed(0)), 0n);
  const result = calculateAssetDepreciation({
    assetId: asset.id, periodIdentity: period.id, readyForUseAt: asset.readyForUseAt, periodStart: period.startsAt, periodEnd: period.endsAt,
    accumulatedBookDepreciationRials: bookAccumulated, accumulatedTaxDepreciationRials: taxAccumulated,
    depreciationExpenseAccountId: policy.depreciationExpenseAccountId, accumulatedDepreciationAccountId: policy.accumulatedDepreciationAccountId,
    components: asset.components.filter((component) => !component.retiredAt).map((component) => ({
      id: component.id, costRials: BigInt(component.bookCostRials.toFixed(0)), residualValueRials: BigInt(component.residualValueRials.toFixed(0)),
      usefulLifeMonths: component.usefulLifeMonths, method: depreciationMethod(component.bookMethod, 'روش استهلاک دفتری'), annualRateBasisPoints: policy.decliningRateBasisPoints || undefined,
      accumulatedDepreciationRials: BigInt(component.accumulatedBookRials.toFixed(0)),
      periodUnits: req.body.periodUnits == null ? undefined : rials(req.body.periodUnits, 'مقدار تولید دوره'), totalExpectedUnits: req.body.totalExpectedUnits == null ? undefined : rials(req.body.totalExpectedUnits, 'کل تولید برآوردی'),
    })),
    taxBasis: {
      costRials: BigInt(asset.taxCostRials.toFixed(0)), residualValueRials: 0n, method: depreciationMethod(policy.taxMethod, 'روش استهلاک مالیاتی'), usefulLifeMonths: policy.usefulLifeMonths,
      annualRateBasisPoints: policy.decliningRateBasisPoints || undefined,
      periodUnits: req.body.periodUnits == null ? undefined : rials(req.body.periodUnits, 'مقدار تولید دوره'), totalExpectedUnits: req.body.totalExpectedUnits == null ? undefined : rials(req.body.totalExpectedUnits, 'کل تولید برآوردی'),
    },
  });
  if (result.bookChargeRials <= 0n) throw new Error('برای این دارایی و دوره هزینه استهلاک قابل ثبت وجود ندارد.');
  const sourcePayload = serialize({ kind: 'ASSET_DEPRECIATION', assetId: asset.id, periodId: period.id, result });
  const sourceHash = hashAccountingEvidence(sourcePayload);
  const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `عطف-${randomUUID()}` });
  const draft = await ledger.createManualDraft({
    bookId: asset.bookId, fiscalYearId: period.fiscalYearId, periodId: period.id, idempotencyKey: eventIdentity, correlationId: eventIdentity,
    description: `استهلاک دوره‌ای ${asset.registerNumber}`, documentDate: period.endsAt, occurredAt: period.endsAt,
    source: { type: 'ASSET_DEPRECIATION', id: asset.id, version: period.sequence, hash: sourceHash, payload: sourcePayload },
    actor: { id: req.user!.id, profile: 'ACCOUNTANT' },
    lines: result.postingLines.map((line, index) => ({ ...line, rawAmountBeforeRounding: (line.debitRials || line.creditRials).toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1,
      evidence: { type: 'محاسبه استهلاک', id: `${eventIdentity}:${index + 1}`, version: 1, hash: hashAccountingEvidence({ sourceHash, index }), payload: { sourceHash, index, assetId: asset.id, periodId: period.id } },
    })),
  });
  const posted = await ledger.postVoucher({ voucherId: draft.id, actor: { id: req.user!.id, profile: 'ACCOUNTANT' }, reason: 'ثبت استهلاک دفتری محاسبه‌شده' });
  const activeComponents = asset.components.filter((component) => !component.retiredAt);
  const totalTaxCostRials = BigInt(asset.taxCostRials.toFixed(0));
  if (totalTaxCostRials <= 0n) throw new Error('مبنای مالیاتی دارایی باید بزرگ‌تر از صفر باشد.');
  let allocatedTax = 0n;
  for (const [index, component] of activeComponents.entries()) {
    const bookCharge = result.componentCharges.find((item) => item.componentId === component.id)?.bookChargeRials ?? 0n;
    const taxCharge = index === activeComponents.length - 1 ? result.taxChargeRials - allocatedTax
      : result.taxChargeRials * BigInt(component.taxCostRials.toFixed(0)) / totalTaxCostRials;
    allocatedTax += taxCharge;
    await tx.accountingAssetComponent.update({ where: { id: component.id }, data: { accumulatedBookRials: { increment: bookCharge.toString() }, accumulatedTaxRials: { increment: taxCharge.toString() } } });
  }
  return tx.accountingAssetEvent.create({ data: {
    assetId: asset.id, eventIdentity, eventType: 'DEPRECIATION', occurredAt: period.endsAt, sourceType: 'ASSET_DEPRECIATION', sourceId: asset.id,
    sourceVersion: period.sequence, sourceHash, payload: sourcePayload, voucherId: posted.id, createdBy: req.user!.id,
  } });
}), true));

router.post('/schedules', ...editAccess, run((req) => prisma.accountingRecognitionSchedule.create({
  data: {
    bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
    scheduleIdentity: positiveText(req.body.scheduleIdentity, 'شناسه برنامه'),
    version: Number(req.body.version),
    scheduleType: positiveText(req.body.scheduleType, 'نوع برنامه'),
    status: 'ACTIVE',
    sourceType: positiveText(req.body.sourceType, 'نوع منبع'),
    sourceId: positiveText(req.body.sourceId, 'شناسه منبع'),
    sourceHash: positiveText(req.body.sourceHash, 'اثر انگشت منبع'),
    effectiveFrom: date(req.body.effectiveFrom, 'تاریخ اثر'),
    effectiveTo: req.body.effectiveTo ? date(req.body.effectiveTo, 'تاریخ پایان اثر') : null,
    recognitionStart: date(req.body.recognitionStart, 'شروع شناسایی'),
    recognitionEnd: date(req.body.recognitionEnd, 'پایان شناسایی'),
    totalRials: rials(req.body.totalRials, 'مبلغ کل برنامه').toString(),
    estimateBasis: positiveText(req.body.estimateBasis, 'مبنای برآورد'),
    debitAccountId: positiveText(req.body.debitAccountId, 'حساب بدهکار'),
    creditAccountId: positiveText(req.body.creditAccountId, 'حساب بستانکار'),
    dimensionRules: req.body.dimensionRules || {},
    roundingRuleVersion: positiveText(req.body.roundingRuleVersion, 'نسخه گردکردن'),
    postingPolicy: positiveText(req.body.postingPolicy, 'سیاست ثبت'),
    nextReviewAt: req.body.nextReviewAt ? date(req.body.nextReviewAt, 'تاریخ بازبینی') : null,
    successorScheduleId: req.body.successorScheduleId,
    createdBy: req.user!.id,
  },
}), true));

router.post('/estimate-cases', ...editAccess, run((req) => prisma.accountingEstimateCase.create({
  data: {
    bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
    caseIdentity: positiveText(req.body.caseIdentity, 'شناسه پرونده برآورد'),
    classification: positiveText(req.body.classification, 'طبقه‌بندی پرونده'),
    titlePersian: positiveText(req.body.titlePersian, 'عنوان پرونده'),
    probability: positiveText(req.body.probability, 'احتمال وقوع'),
    reliablyMeasurable: Boolean(req.body.reliablyMeasurable),
    estimatedAmountRials: req.body.estimatedAmountRials == null ? null : rials(req.body.estimatedAmountRials, 'مبلغ برآورد').toString(),
    assumptions: req.body.assumptions || {},
    evidenceHash: positiveText(req.body.evidenceHash, 'اثر انگشت شواهد'),
    nextReviewAt: date(req.body.nextReviewAt, 'تاریخ بازبینی'),
    createdBy: req.user!.id,
  },
}), true));

router.post('/mappings', ...managerAccess, run((req) => {
  const rows = Array.isArray(req.body.rows) ? req.body.rows : [];
  if (rows.length === 0) throw new Error('نگاشت صورت‌های مالی باید حداقل یک ردیف داشته باشد.');
  return prisma.accountingFinancialStatementMapping.create({
    data: {
      bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
      version: Number(req.body.version),
      titlePersian: positiveText(req.body.titlePersian, 'عنوان نگاشت'),
      effectiveFrom: date(req.body.effectiveFrom, 'تاریخ اثر نگاشت'),
      effectiveTo: req.body.effectiveTo ? date(req.body.effectiveTo, 'تاریخ پایان نگاشت') : null,
      contentHash: jsonHash(rows),
      createdBy: req.user!.id,
      rows: { create: rows.map((row: any) => ({
        accountId: positiveText(row.accountId, 'حساب نگاشت'),
        statementType: positiveText(row.statementType, 'نوع صورت مالی'),
        sectionCode: positiveText(row.sectionCode, 'بخش صورت مالی'),
        signMultiplier: Number(row.signMultiplier || 1),
        cashFlowClass: row.cashFlowClass,
        noteCode: row.noteCode,
      })) },
    },
    include: { rows: true },
  });
}, true));

router.post('/statutory-formats', ...managerAccess, run((req) => {
  const schemaPayload = req.body.schemaPayload || {};
  const validationRules = req.body.validationRules || {};
  return prisma.accountingStatutoryFormat.create({ data: {
    bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
    formatCode: positiveText(req.body.formatCode, 'کد قالب قانونی'),
    version: Number(req.body.version),
    titlePersian: positiveText(req.body.titlePersian, 'عنوان قالب قانونی'),
    effectiveFrom: date(req.body.effectiveFrom, 'تاریخ اثر قالب'),
    effectiveTo: req.body.effectiveTo ? date(req.body.effectiveTo, 'تاریخ پایان قالب') : null,
    schemaPayload,
    validationRules,
    officialSource: positiveText(req.body.officialSource, 'مرجع رسمی قالب'),
    contentHash: jsonHash({ schemaPayload, validationRules }),
    createdBy: req.user!.id,
  } });
}, true));

router.post('/report-snapshots', ...editAccess, run((req) => createOfficialAccountingSnapshot(prisma, {
  actorId: req.user!.id,
  request: {
    ...req.body.request,
    from: date(req.body.request?.from, 'ابتدای گزارش'),
    to: date(req.body.request?.to, 'انتهای گزارش'),
    cutoffAt: date(req.body.request?.cutoffAt, 'زمان برش گزارش'),
    comparativeFrom: req.body.request?.comparativeFrom ? date(req.body.request.comparativeFrom, 'ابتدای دوره مقایسه‌ای') : undefined,
    comparativeTo: req.body.request?.comparativeTo ? date(req.body.request.comparativeTo, 'انتهای دوره مقایسه‌ای') : undefined,
  },
  policyVersions: req.body.policyVersions,
}), true));

router.get('/t-accounts', ...viewAccess, run(async (req) => {
  const accountId = positiveText(req.query.accountId, 'حساب');
  const from = date(req.query.from, 'ابتدای گزارش');
  const to = date(req.query.to, 'انتهای گزارش');
  const cutoffAt = date(req.query.cutoffAt, 'زمان برش گزارش');
  if (from > to) throw new Error('ابتدای گزارش حساب تی باید پیش از انتهای آن باشد.');
  const lines = await prisma.accountingLedgerLine.findMany({
    where: {
      accountId,
      voucher: { status: { in: ['POSTED', 'REVERSED'] }, documentDate: { lte: to }, postedAt: { lte: cutoffAt } },
    },
    include: {
      voucher: { select: { id: true, statutoryNumber: true, status: true, documentDate: true, postedAt: true } },
      account: true,
      dimensions: { include: { dimensionType: true, member: true } },
    },
  });
  const converted = lines.map((line) => ({
    id: line.id,
    voucherId: line.voucher.id,
    voucherNumber: line.voucher.statutoryNumber,
    status: line.voucher.status,
    accountId: line.accountId,
    accountCode: line.account.code,
    accountTitlePersian: line.account.titlePersian,
    accountPath: { group: '', general: '', subsidiary: line.account.titlePersian },
    debitRials: BigInt(line.debitRials.toFixed(0)),
    creditRials: BigInt(line.creditRials.toFixed(0)),
    documentDate: line.voucher.documentDate,
    postedAt: line.voucher.postedAt,
    dimensions: Object.fromEntries(line.dimensions.map((dimension) => [dimension.dimensionType.code, dimension.member.titlePersian])),
  }));
  const opening = converted.filter((line) => line.documentDate < from);
  return buildTAccountProjection({
    accountId,
    from,
    to,
    openingDebitRials: opening.reduce((total, line) => total + line.debitRials, 0n),
    openingCreditRials: opening.reduce((total, line) => total + line.creditRials, 0n),
    lines: converted.filter((line) => line.documentDate >= from),
  });
}));

router.get('/report-snapshots/:id/export.xlsx', ...editAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const snapshot = await prisma.accountingOfficialReportSnapshot.findUniqueOrThrow({ where: { id: req.params.id } });
    const rows = snapshotRows(snapshot.dataset);
    const worksheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'وضعیت': 'داده‌ای برای نمایش وجود ندارد.' }]);
    worksheet['!cols'] = Object.keys(rows[0] || { 'وضعیت': '' }).map((key) => ({ wch: Math.max(18, key.length + 4) }));
    const workbook = XLSX.utils.book_new();
    workbook.Workbook = { Views: [{ RTL: true }] };
    XLSX.utils.book_append_sheet(workbook, worksheet, 'گزارش رسمی');
    const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const excelHash = createHash('sha256').update(bytes).digest('hex');
    await prisma.accountingOfficialReportSnapshot.update({ where: { id: snapshot.id }, data: { excelHash } });
    await auditSnapshotExport(req, snapshot, 'EXCEL');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="accounting-report-${snapshot.id}.xlsx"`);
    res.send(bytes);
  } catch (error) {
    console.error('Official Accounting Excel export failed:', error);
    res.status(400).json({ success: false, error: 'ساخت فایل Excel گزارش رسمی ناموفق بود.' });
  }
});

router.get('/report-snapshots/:id/export.pdf', ...editAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const snapshot = await prisma.accountingOfficialReportSnapshot.findUniqueOrThrow({ where: { id: req.params.id } });
    const rows = snapshotRows(snapshot.dataset);
    const headers = Object.keys(rows[0] || { 'وضعیت': '' });
    const html = `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><style>
      body{font-family:Tahoma,Arial,sans-serif;direction:rtl;color:#172033;padding:24px}h1{font-size:20px;margin:0 0 8px}
      .meta{font-size:12px;color:#536174;margin-bottom:18px}.hash{direction:ltr;text-align:left;word-break:break-all}
      table{width:100%;border-collapse:collapse;font-size:11px}th,td{border:1px solid #cbd5e1;padding:7px;text-align:right}th{background:#eef2f7}
      @page{size:A4 landscape;margin:12mm}
    </style></head><body><h1>${escapeHtml(reportTypeFa[snapshot.reportType] || 'گزارش رسمی حسابداری')}</h1>
      <div class="meta">زمان برش: ${escapeHtml(snapshot.cutoffAt.toLocaleString('fa-IR'))} · زمان تولید: ${escapeHtml(snapshot.generatedAt.toLocaleString('fa-IR'))}</div>
      <table><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr></thead><tbody>
      ${(rows.length ? rows : [{ 'وضعیت': 'داده‌ای برای نمایش وجود ندارد.' }]).map((row: any) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header])}</td>`).join('')}</tr>`).join('')}
      </tbody></table><p class="meta hash">اثر انگشت dataset: ${escapeHtml(snapshot.datasetHash)}</p></body></html>`;
    const bytes = await generatePdfBufferFromHtml({ htmlContent: html, landscape: true });
    const pdfHash = createHash('sha256').update(bytes).digest('hex');
    await prisma.accountingOfficialReportSnapshot.update({ where: { id: snapshot.id }, data: { pdfHash } });
    await auditSnapshotExport(req, snapshot, 'PDF');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="accounting-report-${snapshot.id}.pdf"`);
    res.send(bytes);
  } catch (error) {
    console.error('Official Accounting PDF export failed:', error);
    res.status(400).json({ success: false, error: 'ساخت فایل PDF گزارش رسمی ناموفق بود.' });
  }
});

router.post('/tax-obligations', ...editAccess, run(async (req) => {
  const bookId = positiveText(req.body.bookId, 'دفتر حسابداری');
  const taxType = positiveText(req.body.taxType, 'نوع مالیات');
  let payableRials = rials(req.body.payableRials || 0, 'مالیات پرداختنی');
  let refundableRials = rials(req.body.refundableRials || 0, 'مالیات استردادی');
  let basisEvidence: Record<string, string> | null = null;
  if (taxType === 'VAT') {
    const reconciliation = await prisma.accountingOperationalReconciliation.findUniqueOrThrow({ where: { id: positiveText(req.body.reconciliationId, 'تطبیق عملیاتی ارزش افزوده') } });
    if (reconciliation.bookId !== bookId || reconciliation.reconciliationCode !== 'VAT'
      || !Array.isArray(reconciliation.unresolvedDifferences) || reconciliation.unresolvedDifferences.length > 0) throw new Error('تطبیق عملیاتی ارزش افزوده معتبر و بدون اختلاف نیست.');
    const basis = reconciliation.controlPayload as Record<string, unknown>;
    const salesTaxRials = rials(basis.salesTaxRials, 'مالیات فروش');
    const eligiblePurchaseCreditRials = rials(basis.eligiblePurchaseCreditRials || 0, 'اعتبار خرید واجد شرایط');
    const correctionsRials = rials(basis.correctionsRials || 0, 'اصلاحات مالیاتی');
    const returnsRials = rials(basis.returnsRials || 0, 'برگشت از فروش');
    const carryforwardRials = rials(basis.carryforwardRials || 0, 'مانده اعتبار انتقالی');
    const nonCreditableRials = rials(basis.nonCreditableRials || 0, 'اعتبار غیرقابل‌پذیرش');
    const exemptionsRials = rials(basis.exemptionsRials || 0, 'فروش معاف');
    const net = salesTaxRials - eligiblePurchaseCreditRials - correctionsRials - returnsRials - carryforwardRials;
    const calculatedPayable = net > 0n ? net : 0n;
    const calculatedRefundable = net < 0n ? -net : 0n;
    payableRials = calculatedPayable;
    refundableRials = calculatedRefundable;
    basisEvidence = Object.fromEntries(Object.entries({ reconciliationId: reconciliation.id, sourceSnapshotHash: reconciliation.sourceSnapshotHash, salesTaxRials, eligiblePurchaseCreditRials, correctionsRials, returnsRials, carryforwardRials, nonCreditableRials, exemptionsRials }).map(([key, value]) => [key, value.toString()]));
  }
  return prisma.accountingTaxObligation.create({ data: {
    bookId,
    obligationIdentity: positiveText(req.body.obligationIdentity, 'شناسه تکلیف مالیاتی'),
    taxType,
    periodIdentity: positiveText(req.body.periodIdentity, 'دوره تکلیف'),
    status: 'OPEN',
    dueAt: date(req.body.dueAt, 'مهلت تکلیف'),
    ownerId: positiveText(req.body.ownerId, 'مسئول تکلیف'),
    payableRials: payableRials.toString(),
    refundableRials: refundableRials.toString(),
    penaltyRials: rials(req.body.penaltyRials || 0, 'جرایم').toString(),
    adjustmentRials: rials(req.body.adjustmentRials || 0, 'تعدیلات').toString(),
    policyVersion: positiveText(req.body.policyVersion, 'نسخه سیاست مالیاتی'),
    reconciliationHash: basisEvidence ? jsonHash(basisEvidence) : req.body.reconciliationHash,
    receiptEvidence: basisEvidence ? { basis: basisEvidence } : undefined,
  } });
}, true));

router.post('/tax-obligations/:id/attempts', ...editAccess, run((req) => prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM accounting_tax_obligations WHERE id = ${req.params.id} FOR UPDATE`;
  const status = positiveText(req.body.status, 'وضعیت تلاش');
  const attempt = await tx.accountingTaxComplianceAttempt.create({ data: {
    obligationId: req.params.id,
    attemptIdentity: positiveText(req.body.attemptIdentity, 'شناسه تلاش ارسال'),
    status,
    requestHash: positiveText(req.body.requestHash, 'اثر انگشت درخواست'),
    responseCode: req.body.responseCode,
    responsePayload: req.body.responsePayload,
    receiptNumber: req.body.receiptNumber,
    attemptedBy: req.user!.id,
  } });
  if (status === 'ACCEPTED' && attempt.receiptNumber) {
    const obligation = await tx.accountingTaxObligation.findUniqueOrThrow({ where: { id: req.params.id } });
    const priorEvidence = obligation.receiptEvidence && typeof obligation.receiptEvidence === 'object' && !Array.isArray(obligation.receiptEvidence) ? obligation.receiptEvidence as Record<string, unknown> : {};
    await tx.accountingTaxObligation.update({ where: { id: req.params.id }, data: {
      status: 'FILED', receiptEvidence: { ...priorEvidence, receiptNumber: attempt.receiptNumber, attemptIdentity: attempt.attemptIdentity, requestHash: attempt.requestHash },
    } });
  }
  return attempt;
}), true));

router.post('/tax-obligations/:id/payment-voucher', ...editAccess, run((req) => prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM accounting_tax_obligations WHERE id = ${req.params.id} FOR UPDATE`;
  const obligation = await tx.accountingTaxObligation.findUniqueOrThrow({ where: { id: req.params.id } });
  const amountRials = rials(req.body.amountRials, 'مبلغ پرداخت مالیات');
  if (amountRials <= 0n) throw new Error('مبلغ پرداخت مالیات باید بزرگ‌تر از صفر باشد.');
  const period = await tx.accountingPostingPeriod.findUniqueOrThrow({ where: { id: positiveText(req.body.periodId, 'دوره مالی') } });
  const sourcePayload = { obligationIdentity: obligation.obligationIdentity, taxType: obligation.taxType, amountRials: amountRials.toString(), paymentReceipt: positiveText(req.body.paymentReceipt, 'رسید پرداخت') };
  const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `عطف-${randomUUID()}` });
  const documentDate = date(req.body.documentDate, 'تاریخ پرداخت مالیات');
  const draft = await ledger.createManualDraft({
    bookId: obligation.bookId, fiscalYearId: period.fiscalYearId, periodId: period.id,
    idempotencyKey: positiveText(req.body.paymentIdentity, 'شناسه پرداخت مالیات'), correlationId: obligation.obligationIdentity,
    description: `پرداخت تکلیف مالیاتی ${obligation.obligationIdentity}`, documentDate, occurredAt: documentDate,
    source: { type: 'TAX_PAYMENT', id: obligation.id, version: Number(req.body.version || 1), hash: hashAccountingEvidence(sourcePayload), payload: sourcePayload },
    actor: { id: req.user!.id, profile: 'ACCOUNTANT' },
    lines: [
      { accountId: positiveText(req.body.taxPayableAccountId, 'حساب مالیات پرداختنی'), debitRials: amountRials, creditRials: 0n, description: 'تسویه مالیات پرداختنی', dimensions: [], rawAmountBeforeRounding: amountRials.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1,
        evidence: { type: 'رسید پرداخت مالیات', id: obligation.obligationIdentity, version: Number(req.body.version || 1), hash: hashAccountingEvidence(sourcePayload), payload: sourcePayload } },
      { accountId: positiveText(req.body.bankLedgerAccountId, 'حساب دفترکل بانک'), financialAccountId: positiveText(req.body.financialAccountId, 'حساب مالی بانک'), debitRials: 0n, creditRials: amountRials, description: 'برداشت بانکی مالیات', dimensions: [], rawAmountBeforeRounding: amountRials.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1,
        evidence: { type: 'رسید پرداخت مالیات', id: obligation.obligationIdentity, version: Number(req.body.version || 1), hash: hashAccountingEvidence(sourcePayload), payload: sourcePayload } },
    ],
  });
  return ledger.postVoucher({ voucherId: draft.id, actor: { id: req.user!.id, profile: 'ACCOUNTANT' }, reason: 'ثبت پرداخت تکلیف مالیاتی' });
}), true));

router.post('/tax-obligations/:id/reconcile', ...editAccess, run((req) => prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT id FROM accounting_tax_obligations WHERE id = ${req.params.id} FOR UPDATE`;
  const obligation = await tx.accountingTaxObligation.findUniqueOrThrow({ where: { id: req.params.id } });
  const settlementVouchers = await tx.accountingLedgerVoucher.findMany({
    where: { bookId: obligation.bookId, status: 'POSTED', sourceType: 'TAX_PAYMENT', sourceId: { in: [obligation.id, obligation.obligationIdentity] } },
    include: { lines: { select: { id: true } } },
  });
  if (settlementVouchers.length === 0) throw new Error('سند قطعی پرداخت برای این تکلیف مالیاتی وجود ندارد.');
  const paidRials = settlementVouchers.reduce((total, voucher) => {
    const payload = voucher.sourcePayload as Record<string, unknown>;
    return total + rials(payload.amountRials, 'مبلغ منبع سند پرداخت مالیات');
  }, 0n);
  if (req.body.paidRials != null && rials(req.body.paidRials, 'مالیات پرداخت‌شده') !== paidRials) throw new Error('مبلغ پرداختی ارسالی با سندهای قطعی مالیات سازگار نیست.');
  if (paidRials < BigInt(obligation.paidRials.toFixed(0))) throw new Error('تطبیق مالیاتی نمی‌تواند مبلغ تسویه‌شده قبلی را کاهش دهد.');
  const ledgerLineIds = settlementVouchers.flatMap((voucher) => voucher.lines.map((line) => line.id)).sort();
  const expected = BigInt(obligation.payableRials.toFixed(0)) + BigInt(obligation.penaltyRials.toFixed(0))
    + BigInt(obligation.adjustmentRials.toFixed(0)) - BigInt(obligation.refundableRials.toFixed(0));
  const evidence = {
    obligationIdentity: obligation.obligationIdentity, paidRials: paidRials.toString(), expectedRials: expected.toString(),
    ledgerLineIds,
    taxpayerReceipt: positiveText(req.body.taxpayerReceipt, 'رسید سامانه مالیاتی'),
    paymentReceipt: positiveText(req.body.paymentReceipt, 'رسید پرداخت'),
  };
  const reconciliationHash = jsonHash(evidence);
  if (req.body.reconciliationHash && req.body.reconciliationHash !== reconciliationHash) throw new Error('اثر انگشت تطبیق مالیاتی با شواهد ارسالی سازگار نیست.');
  const priorEvidence = obligation.receiptEvidence && typeof obligation.receiptEvidence === 'object' && !Array.isArray(obligation.receiptEvidence) ? obligation.receiptEvidence as Record<string, unknown> : {};
  const priorReconciliations = Array.isArray(priorEvidence.paymentReconciliations) ? priorEvidence.paymentReconciliations : [];
  return tx.accountingTaxObligation.update({ where: { id: obligation.id }, data: {
    paidRials: paidRials.toString(), reconciliationHash,
    receiptEvidence: { ...priorEvidence, paymentReconciliations: [...priorReconciliations, evidence] },
    status: paidRials >= expected ? 'RECONCILED' : paidRials > 0n ? 'PARTIALLY_PAID' : obligation.status,
  } });
}), true));

router.post('/close-runs', ...managerAccess, run(async (req) => prisma.$transaction(async (tx) => {
  const runIdentity = positiveText(req.body.runIdentity, 'شناسه اجرای بستن دوره');
  const stored = await tx.accountingCloseRun.upsert({
    where: { runIdentity },
    update: {},
    create: {
      bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
      fiscalYearId: positiveText(req.body.fiscalYearId, 'سال مالی'),
      periodId: req.body.periodId || null,
      runIdentity,
      closeType: positiveText(req.body.closeType, 'نوع بستن'),
      status: 'IN_PROGRESS',
      createdBy: req.user!.id,
    },
    include: { steps: true },
  });
  if (stored.status === 'HARD_CLOSED' || stored.status === 'COMPLETED') throw new Error('اجرای بستن تکمیل‌شده تغییرناپذیر است و باید اجرای جانشین ایجاد شود.');
  const previousSteps = stored.steps.map((step) => ({
    code: step.stepCode,
    status: step.status,
    evidenceHash: step.evidenceHash || '',
    checkedAt: step.checkedAt || new Date(0),
    blocker: step.blocker || undefined,
    invalidatedBy: Array.isArray(step.invalidatedBy) ? step.invalidatedBy : undefined,
  })) as CloseStep[];
  const checksByCode = new Map<CloseCheckInput['code'], CloseCheckInput>();
  const checkedAt = new Date();
  const authoritative = (code: CloseCheckInput['code'], blocker: string, blocked: boolean, evidence: unknown) => checksByCode.set(code, {
    code, status: blocked ? 'BLOCKED' : 'ACCEPTED', blocker: blocked ? blocker : undefined, evidenceHash: jsonHash(evidence), checkedAt,
  });
  const voucherScope: Prisma.AccountingLedgerVoucherWhereInput = { bookId: stored.bookId, fiscalYearId: stored.fiscalYearId, ...(stored.periodId ? { periodId: stored.periodId } : {}), status: { in: ['POSTED', 'REVERSED'] } };
  const [draftCount, overdueTaxCount, overdueScheduleCount, snapshots, reportArchiveEvidence, ledgerTotals, operationalReconciliations, assets, payrollHandoffs, suspenseAccounts, period] = await Promise.all([
    tx.accountingLedgerVoucher.count({ where: { bookId: stored.bookId, fiscalYearId: stored.fiscalYearId, ...(stored.periodId ? { periodId: stored.periodId } : {}), status: 'DRAFT' } }),
    tx.accountingTaxObligation.count({ where: { bookId: stored.bookId, dueAt: { lt: checkedAt }, status: { notIn: ['SETTLED', 'RECONCILED'] } } }),
    tx.accountingRecognitionSchedule.count({ where: { bookId: stored.bookId, status: 'ACTIVE', nextReviewAt: { lt: checkedAt } } }),
    tx.accountingOfficialReportSnapshot.findMany({ where: { bookId: stored.bookId, generatedAt: { gte: new Date(checkedAt.getTime() - 86_400_000) } }, select: { id: true, reportType: true, datasetHash: true, parameters: true, cutoffAt: true } }),
    tx.accountingArchiveEvidence.findMany({ where: { bookId: stored.bookId, sourceEntityType: 'OFFICIAL_REPORT_SNAPSHOT', malwareScanStatus: 'CLEAN' }, select: { sourceEntityId: true, evidenceType: true, contentHash: true } }),
    tx.accountingLedgerLine.aggregate({ where: { voucher: voucherScope }, _sum: { debitRials: true, creditRials: true } }),
    tx.accountingOperationalReconciliation.findMany({ where: { bookId: stored.bookId, fiscalYearId: stored.fiscalYearId, periodId: stored.periodId, reconciledAt: { gte: new Date(checkedAt.getTime() - 86_400_000) } } }),
    tx.accountingFixedAsset.findMany({ where: { bookId: stored.bookId, status: 'ACTIVE' }, select: { id: true, readyForUseAt: true, events: { select: { eventIdentity: true, sourceHash: true } } } }),
    tx.accountingPayrollHandoff.findMany({ where: { bookId: stored.bookId }, select: { id: true, status: true, sourceHash: true, voucherId: true, obligations: { select: { obligationIdentity: true, amountRials: true, settledRials: true, status: true } } } }),
    tx.accountingLedgerAccount.findMany({ where: { bookId: stored.bookId, OR: [{ titlePersian: { contains: 'معلق' } }, { titlePersian: { contains: 'واسط' } }] }, select: { id: true, lines: { where: { voucher: voucherScope }, select: { debitRials: true, creditRials: true, evidenceHash: true } } } }),
    stored.periodId ? tx.accountingPostingPeriod.findUnique({ where: { id: stored.periodId } }) : Promise.resolve(null),
  ]);
  authoritative('DOCUMENTS', `${draftCount.toLocaleString('fa-IR')} پیش‌نویس تعیین‌تکلیف‌نشده وجود دارد.`, draftCount > 0, { draftCount });
  authoritative('TAX', `${overdueTaxCount.toLocaleString('fa-IR')} تکلیف مالیاتی سررسیدگذشته حل‌نشده است.`, overdueTaxCount > 0, { overdueTaxCount });
  authoritative('SCHEDULES', `${overdueScheduleCount.toLocaleString('fa-IR')} برنامه شناسایی نیازمند بازبینی است.`, overdueScheduleCount > 0, { overdueScheduleCount });
  const applicableSnapshots = snapshots.filter((snapshot) => (snapshot.parameters as any)?.fiscalYearId === stored.fiscalYearId
    && (!period || (snapshot.parameters as any)?.to && new Date((snapshot.parameters as any).to) >= period.endsAt));
  const requiredReportTypes = ['TRIAL_BALANCE', 'FINANCIAL_STATEMENT', 'CASH_FLOW'];
  const missingReportTypes = requiredReportTypes.filter((reportType) => !applicableSnapshots.some((snapshot) => snapshot.reportType === reportType));
  const legalSnapshots = applicableSnapshots.filter((snapshot) => snapshot.reportType === 'LEGAL_BOOK');
  const missingLegalBookKinds = ['JOURNAL', 'GENERAL_LEDGER', 'SUBSIDIARY_LEDGER'].filter((kind) => !legalSnapshots.some((snapshot) => (snapshot.parameters as any)?.legalBookKind === kind));
  const legalEvidenceComplete = missingLegalBookKinds.length === 0 && legalSnapshots.every((snapshot) => ['VALIDATION', 'RECEIPT'].every((evidenceType) => reportArchiveEvidence.some((evidence) => evidence.sourceEntityId === snapshot.id && evidence.evidenceType === evidenceType)));
  authoritative('REPORT_SNAPSHOT', 'بسته کامل گزارش‌های رسمی یا سه دفتر قانونی با شواهد اعتبارسنجی و رسید موجود نیست.', missingReportTypes.length > 0 || missingLegalBookKinds.length > 0 || !legalEvidenceComplete,
    { snapshots: applicableSnapshots.map((snapshot) => ({ id: snapshot.id, reportType: snapshot.reportType, datasetHash: snapshot.datasetHash, cutoffAt: snapshot.cutoffAt })), missingReportTypes, missingLegalBookKinds, legalEvidenceComplete });
  const debitTotal = BigInt(ledgerTotals._sum.debitRials?.toFixed(0) ?? '0');
  const creditTotal = BigInt(ledgerTotals._sum.creditRials?.toFixed(0) ?? '0');
  authoritative('TRIAL_BALANCE', 'تراز آزمایشی دفترکل متوازن نیست.', debitTotal !== creditTotal, { debitTotal: debitTotal.toString(), creditTotal: creditTotal.toString() });
  const reconciliationEvidence = (code: 'SUBLEDGERS' | 'TREASURY' | 'INVENTORY') => operationalReconciliations.filter((item) => item.reconciliationCode === code).map((item) => {
    const differences = Array.isArray(item.unresolvedDifferences) ? item.unresolvedDifferences : ['شاهد اختلاف‌ها ثبت نشده است'];
    const valid = BigInt(item.sourceDebitRials.toFixed(0)) === BigInt(item.ledgerDebitRials.toFixed(0))
      && BigInt(item.sourceCreditRials.toFixed(0)) === BigInt(item.ledgerCreditRials.toFixed(0)) && differences.length === 0;
    return { id: item.id, sourceSystem: item.sourceSystem, sourceSnapshotHash: item.sourceSnapshotHash, evidenceHash: item.evidenceHash, differences, valid };
  });
  for (const code of ['SUBLEDGERS', 'TREASURY', 'INVENTORY'] as const) {
    const evidence = reconciliationEvidence(code);
    authoritative(code, `تطبیق قطعی ${code} با منبع عملیاتی و اختلاف صفر ثبت نشده است.`, evidence.length === 0 || evidence.some((item) => !item.valid), evidence);
  }
  const assetsMissingDepreciation = period ? assets.filter((asset) => asset.readyForUseAt && asset.readyForUseAt <= period.endsAt
    && !asset.events.some((event) => event.eventIdentity === `DEPRECIATION:${asset.id}:${period.id}`)) : [];
  authoritative('FIXED_ASSETS', `${assetsMissingDepreciation.length.toLocaleString('fa-IR')} دارایی فعال فاقد ثبت استهلاک این دوره است.`, assetsMissingDepreciation.length > 0, assets.map((asset) => ({ id: asset.id, events: asset.events })));
  const invalidPayroll = payrollHandoffs.filter((handoff) => handoff.status !== 'POSTED' || !handoff.voucherId
    || handoff.obligations.some((obligation) => BigInt(obligation.amountRials.toFixed(0)) !== BigInt(obligation.settledRials.toFixed(0)) || obligation.status !== 'SETTLED'));
  authoritative('PAYROLL', `${invalidPayroll.length.toLocaleString('fa-IR')} تحویل حقوق ثبت‌قطعی و قابل تطبیق نیست.`, invalidPayroll.length > 0, payrollHandoffs);
  const suspenseBalances = suspenseAccounts.map((account) => ({ id: account.id, net: account.lines.reduce((total, line) => total + BigInt(line.debitRials.toFixed(0)) - BigInt(line.creditRials.toFixed(0)), 0n), hashes: account.lines.map((line) => line.evidenceHash) }));
  authoritative('SUSPENSE', 'مانده حساب معلق یا واسط باید پیش از بستن تعیین‌تکلیف شود.', suspenseBalances.some((item) => item.net !== 0n), suspenseBalances.map((item) => ({ ...item, net: item.net.toString() })));
  const checks = [...checksByCode.values()];
  const advanced = advanceCloseRun({ runId: stored.id, previousSteps, checks });
  for (const step of advanced.steps) {
    await tx.accountingCloseRunStep.upsert({
      where: { closeRunId_stepCode: { closeRunId: stored.id, stepCode: step.code } },
      update: { status: step.status, evidenceHash: step.evidenceHash, blocker: step.blocker, invalidatedBy: step.invalidatedBy || [], checkedAt: step.checkedAt },
      create: { closeRunId: stored.id, stepCode: step.code, status: step.status, evidenceHash: step.evidenceHash, blocker: step.blocker, invalidatedBy: step.invalidatedBy || [], checkedAt: step.checkedAt },
    });
  }
  await tx.accountingCloseRun.update({ where: { id: stored.id }, data: { status: advanced.status } });
  return advanced;
}), true));

router.post('/close-runs/:id/year-end-transition', ...managerAccess, run(async (req) => prisma.$transaction(async (tx) => {
  const stored = await tx.accountingCloseRun.findUniqueOrThrow({ where: { id: req.params.id } });
  if (stored.closeType !== 'YEAR' || stored.status !== 'READY') throw new Error('ثبت اختتامیه و افتتاحیه فقط برای اجرای سالانه آماده مجاز است.');
  if (stored.closingVoucherId || stored.openingVoucherId) return stored;
  const retainedResultAccountId = positiveText(req.body.retainedResultAccountId, 'حساب نتیجه انباشته');
  const openingFiscalYearId = positiveText(req.body.openingFiscalYearId, 'سال مالی افتتاحیه');
  const openingPeriodId = positiveText(req.body.openingPeriodId, 'دوره افتتاحیه');
  const [fiscalYear, openingYear, openingPeriod, retainedAccount, postedLines] = await Promise.all([
    tx.accountingFiscalYear.findUniqueOrThrow({ where: { id: stored.fiscalYearId } }),
    tx.accountingFiscalYear.findUniqueOrThrow({ where: { id: openingFiscalYearId } }),
    tx.accountingPostingPeriod.findUniqueOrThrow({ where: { id: openingPeriodId } }),
    tx.accountingLedgerAccount.findUniqueOrThrow({ where: { id: retainedResultAccountId } }),
    tx.accountingLedgerLine.findMany({
      where: { voucher: { bookId: stored.bookId, fiscalYearId: stored.fiscalYearId, status: { in: ['POSTED', 'REVERSED'] } } },
      include: { account: true },
    }),
  ]);
  if (openingYear.bookId !== stored.bookId || openingPeriod.fiscalYearId !== openingYear.id || retainedAccount.bookId !== stored.bookId) throw new Error('سال، دوره و حساب افتتاحیه باید متعلق به همان دفتر باشند.');
  if (openingYear.startsAt <= fiscalYear.endsAt || openingPeriod.status !== 'OPEN') throw new Error('افتتاحیه باید در سال مالی بعد و در یک دوره باز ثبت شود.');
  const byAccount = new Map<string, { accountId: string; role: 'TEMPORARY' | 'PERMANENT'; debitRials: bigint; creditRials: bigint }>();
  for (const line of postedLines) {
    const row = byAccount.get(line.accountId) ?? {
      accountId: line.accountId,
      role: ['REVENUE', 'EXPENSE', 'OTHER_COMPREHENSIVE_INCOME'].includes(line.account.statementRole) ? 'TEMPORARY' as const : 'PERMANENT' as const,
      debitRials: 0n,
      creditRials: 0n,
    };
    row.debitRials += BigInt(line.debitRials.toFixed(0));
    row.creditRials += BigInt(line.creditRials.toFixed(0));
    byAccount.set(line.accountId, row);
  }
  const balances = [...byAccount.values()].map((balance) => {
    const net = balance.debitRials - balance.creditRials;
    return { ...balance, debitRials: net > 0n ? net : 0n, creditRials: net < 0n ? -net : 0n };
  }).filter((balance) => balance.debitRials > 0n || balance.creditRials > 0n);
  const openItemMap = new Map<string, { identity: string; accountId: string; partyId?: string; debitRials: bigint; creditRials: bigint }>();
  for (const line of postedLines) {
    const payload = line.evidencePayload as Record<string, unknown>;
    const sourceOpenItemId = payload.openItemIdentity || payload.obligationIdentity || payload.invoiceId;
    if (line.financialAccountId && !line.partyId) continue;
    if (!line.partyId && !sourceOpenItemId) continue;
    if (!sourceOpenItemId) throw new Error('سند اختتامیه فقط با شناسه صریح قلم باز در شاهد منبع قابل تولید است.');
    const identity = `${line.accountId}:${line.partyId || 'بدون-طرف'}:${line.financialAccountId || 'بدون-حساب-مالی'}:${String(sourceOpenItemId)}`;
    const item = openItemMap.get(identity) ?? { identity, accountId: line.accountId, partyId: line.partyId || line.financialAccountId || undefined, debitRials: 0n, creditRials: 0n };
    item.debitRials += BigInt(line.debitRials.toFixed(0));
    item.creditRials += BigInt(line.creditRials.toFixed(0));
    openItemMap.set(identity, item);
  }
  const openItems = [...openItemMap.values()];
  const transition = buildYearEndTransition({ retainedResultAccountId, balances, openItems });
  const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(tx, true), { now: () => new Date(), nextReference: () => `عطف-${randomUUID()}` });
  const postTransition = async (kind: 'اختتامیه' | 'افتتاحیه', fiscalYearId: string, periodId: string, documentDate: Date, lines: typeof transition.closingLines) => {
    const sourcePayload = { kind, closeRunId: stored.id, openItems: kind === 'افتتاحیه' ? transition.openingOpenItems.map((item) => ({ ...item, debitRials: item.debitRials.toString(), creditRials: item.creditRials.toString() })) : [] };
    const sourceHash = hashAccountingEvidence(sourcePayload);
    const draft = await ledger.createManualDraft({
      bookId: stored.bookId, fiscalYearId, periodId, idempotencyKey: `${stored.runIdentity}:${kind}`, correlationId: stored.runIdentity,
      description: `سند ${kind} ${stored.runIdentity}`, documentDate, occurredAt: documentDate,
      source: { type: 'YEAR_END_CLOSE_RUN', id: `${stored.id}:${kind}`, version: 1, hash: sourceHash, payload: sourcePayload },
      actor: { id: req.user!.id, profile: 'ACCOUNTING_MANAGER' }, override: { confirmed: true, reason: `ثبت کنترل‌شده ${kind} سال مالی` },
      lines: lines.map((line, index) => ({
        accountId: line.accountId, debitRials: line.debitRials, creditRials: line.creditRials, description: line.sourceIdentity,
        rawAmountBeforeRounding: (line.debitRials || line.creditRials).toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1, dimensions: [],
        evidence: { type: `شاهد ${kind}`, id: line.sourceIdentity, version: 1, hash: hashAccountingEvidence({ closeRunId: stored.id, kind, index, sourceIdentity: line.sourceIdentity }), payload: { closeRunId: stored.id, kind, sourceIdentity: line.sourceIdentity } },
      })),
    });
    return ledger.postVoucher({ voucherId: draft.id, actor: { id: req.user!.id, profile: 'ACCOUNTING_MANAGER' }, reason: `ثبت قطعی ${kind} سال مالی`, override: { confirmed: true, reason: `ثبت کنترل‌شده ${kind} سال مالی` } });
  };
  const closing = await postTransition('اختتامیه', stored.fiscalYearId, stored.periodId || positiveText(req.body.closingPeriodId, 'دوره اختتامیه'), fiscalYear.endsAt, transition.closingLines);
  const opening = await postTransition('افتتاحیه', openingYear.id, openingPeriod.id, openingYear.startsAt, transition.openingLines);
  await tx.accountingCloseRunStep.updateMany({ where: { closeRunId: stored.id }, data: { status: 'PENDING', checkedAt: null, evidenceHash: null, blocker: null, invalidatedBy: ['YEAR_END_TRANSITION'] } });
  return tx.accountingCloseRun.update({ where: { id: stored.id }, data: {
    status: 'IN_PROGRESS',
    closingVoucherId: closing.id, openingVoucherId: opening.id, openingFiscalYearId: openingYear.id, openingPeriodId: openingPeriod.id,
    yearEndEvidence: serialize({ retainedResultAccountId, openingOpenItems: transition.openingOpenItems, closingVoucherId: closing.id, openingVoucherId: opening.id }),
  } });
}), true));

router.post('/close-runs/:id/finalize', ...managerAccess, run(async (req) => prisma.$transaction(async (tx) => {
  const stored = await tx.accountingCloseRun.findUniqueOrThrow({ where: { id: req.params.id }, include: { steps: true } });
  if (stored.closeType === 'YEAR' && (!stored.closingVoucherId || !stored.openingVoucherId || !stored.yearEndEvidence)) throw new Error('پیش از بستن سال باید سندهای اختتامیه و افتتاحیه مرتبط ثبت شوند.');
  const lastCheckedAt = stored.steps.reduce<Date | null>((earliest, step) => !step.checkedAt ? earliest : !earliest || step.checkedAt < earliest ? step.checkedAt : earliest, null);
  if (!lastCheckedAt) throw new Error('کنترل‌های بستن دوره باید بلافاصله پیش از نهایی‌سازی دوباره اجرا شوند.');
  const changedVoucher = await tx.accountingLedgerVoucher.findFirst({ where: {
    bookId: stored.bookId, fiscalYearId: stored.fiscalYearId, updatedAt: { gt: lastCheckedAt },
  }, select: { id: true } });
  if (changedVoucher) throw new Error('پس از آخرین کنترل، دفترکل تغییر کرده است؛ کنترل‌های بستن دوره را دوباره اجرا کنید.');
  const finalizeNow = new Date();
  const [changedTax, changedSchedule, changedAsset, changedAssetEvent, changedPayroll, changedSnapshot, changedEstimate, changedRestatement, changedReconciliation, overdueTaxNow, overdueScheduleNow] = await Promise.all([
    tx.accountingTaxObligation.findFirst({ where: { bookId: stored.bookId, updatedAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingRecognitionSchedule.findFirst({ where: { bookId: stored.bookId, createdAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingFixedAsset.findFirst({ where: { bookId: stored.bookId, updatedAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingAssetEvent.findFirst({ where: { asset: { bookId: stored.bookId }, createdAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingPayrollObligation.findFirst({ where: { handoff: { bookId: stored.bookId }, updatedAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingOfficialReportSnapshot.findFirst({ where: { bookId: stored.bookId, generatedAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingEstimateCase.findFirst({ where: { bookId: stored.bookId, updatedAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingRestatementCase.findFirst({ where: { bookId: stored.bookId, createdAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingOperationalReconciliation.findFirst({ where: { bookId: stored.bookId, fiscalYearId: stored.fiscalYearId, periodId: stored.periodId, createdAt: { gt: lastCheckedAt } }, select: { id: true } }),
    tx.accountingTaxObligation.count({ where: { bookId: stored.bookId, dueAt: { lt: finalizeNow }, status: { notIn: ['SETTLED', 'RECONCILED'] } } }),
    tx.accountingRecognitionSchedule.count({ where: { bookId: stored.bookId, status: 'ACTIVE', nextReviewAt: { lt: finalizeNow } } }),
  ]);
  if ([changedTax, changedSchedule, changedAsset, changedAssetEvent, changedPayroll, changedSnapshot, changedEstimate, changedRestatement, changedReconciliation].some(Boolean)
    || overdueTaxNow > 0 || overdueScheduleNow > 0) {
    throw new Error('پس از آخرین کنترل، یکی از منابع بالادستی پایان دوره تغییر کرده است؛ کنترل‌ها را دوباره اجرا کنید.');
  }
  const run = {
    runId: stored.id,
    status: stored.status,
    blockers: stored.steps.filter((step) => step.status === 'BLOCKED').map((step) => step.blocker || 'کنترل حل‌نشده'),
    steps: stored.steps.map((step) => ({
      code: step.stepCode,
      status: step.status,
      evidenceHash: step.evidenceHash || '',
      checkedAt: step.checkedAt || new Date(0),
      blocker: step.blocker || undefined,
      invalidatedBy: Array.isArray(step.invalidatedBy) ? step.invalidatedBy : undefined,
    })),
  } as Parameters<typeof finalizeCloseRun>[0];
  const finalized = finalizeCloseRun(run, {
    actorId: req.user!.id,
    profile: 'ACCOUNTING_MANAGER',
    confirmed: req.body.confirmed === true,
    reason: String(req.body.reason || ''),
  });
  await tx.accountingCloseRun.update({ where: { id: stored.id }, data: {
    status: finalized.status,
    confirmationReason: finalized.reason,
    completedBy: req.user!.id,
    completedAt: new Date(),
    evidenceHash: finalized.evidenceHash,
  } });
  if (stored.periodId) await tx.accountingPostingPeriod.update({ where: { id: stored.periodId }, data: {
    status: 'HARD_CLOSED', closedAt: new Date(), closedBy: req.user!.id, closeReason: finalized.reason,
  } });
  if (stored.closeType === 'YEAR') await tx.accountingFiscalYear.update({ where: { id: stored.fiscalYearId }, data: { status: 'HARD_CLOSED' } });
  return finalized;
}), true));

router.post('/close-runs/:id/reopen', ...managerAccess, run(async (req) => prisma.$transaction(async (tx) => {
  const reason = positiveText(req.body.reason, 'دلیل بازگشایی');
  if (reason.length < 8) throw new Error('دلیل بازگشایی باید دست‌کم هشت نویسه باشد.');
  if (req.body.confirmed !== true) throw new Error('بازگشایی باید به‌صورت صریح دوباره تأیید شود.');
  const closed = await tx.accountingCloseRun.findUniqueOrThrow({ where: { id: req.params.id } });
  if (closed.status !== 'HARD_CLOSED' || !closed.evidenceHash) throw new Error('فقط یک اجرای بسته‌شده و دارای شواهد معتبر قابل بازگشایی است.');
  const reopenedAt = new Date();
  const evidenceHash = jsonHash({ predecessorRunId: closed.id, predecessorEvidenceHash: closed.evidenceHash, actorId: req.user!.id, reason, reopenedAt });
  const reopenRun = await tx.accountingCloseRun.create({ data: {
    bookId: closed.bookId,
    fiscalYearId: closed.fiscalYearId,
    periodId: closed.periodId,
    runIdentity: `${closed.runIdentity}:بازگشایی:${randomUUID()}`,
    closeType: 'REOPEN',
    status: 'COMPLETED',
    confirmationReason: reason,
    completedBy: req.user!.id,
    completedAt: reopenedAt,
    evidenceHash,
    predecessorRunId: closed.id,
    createdBy: req.user!.id,
  } });
  if (closed.periodId) await tx.accountingPostingPeriod.update({ where: { id: closed.periodId }, data: {
    status: 'OPEN', closedAt: null, closedBy: null, closeReason: null,
  } });
  if (closed.closeType === 'YEAR') await tx.accountingFiscalYear.update({ where: { id: closed.fiscalYearId }, data: { status: 'ACTIVE' } });
  return reopenRun;
}), true));

router.post('/restatement-cases', ...managerAccess, run((req) => prisma.accountingRestatementCase.create({ data: {
  bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
  caseIdentity: positiveText(req.body.caseIdentity, 'شناسه پرونده تجدید ارائه'),
  originalPeriodId: positiveText(req.body.originalPeriodId, 'دوره اصلی'),
  classification: positiveText(req.body.classification, 'طبقه‌بندی خطا'),
  discoveredAt: date(req.body.discoveredAt, 'تاریخ کشف'),
  amountRials: rials(req.body.amountRials, 'مبلغ خطا').toString(),
  materialityPolicyId: positiveText(req.body.materialityPolicyId, 'سیاست اهمیت'),
  decisionReason: positiveText(req.body.decisionReason, 'دلیل تصمیم'),
  originalSnapshotIds: req.body.originalSnapshotIds || [],
  restatedSnapshotIds: req.body.restatedSnapshotIds || [],
  correctingVoucherIds: req.body.correctingVoucherIds || [],
  comparativeEffects: req.body.comparativeEffects || {},
  taxEffects: req.body.taxEffects || {},
  status: positiveText(req.body.status || 'OPEN', 'وضعیت پرونده'),
  decidedBy: req.user!.id,
} }), true));

router.post('/archive-evidence', ...managerAccess, run(async (req) => {
  const storageKey = positiveText(req.body.storageKey, 'نشانی امن مدرک');
  const filePath = accountingArchivePath(storageKey);
  const stat = await fs.promises.stat(filePath).catch(() => null);
  if (!stat?.isFile()) throw new Error('فایل بایگانی در مخزن امن پیدا نشد.');
  const [contentHash, malwareScanStatus] = await Promise.all([sha256File(filePath), scanHiringFile(filePath)]);
  if (malwareScanStatus !== 'CLEAN') throw new Error('فایل بدون تأیید قطعی بررسی بدافزار قابل بایگانی نیست.');
  if (req.body.contentHash && String(req.body.contentHash).toLowerCase() !== contentHash) throw new Error('اثر انگشت فایل بایگانی با شواهد ارسالی سازگار نیست.');
  if (req.body.sizeBytes != null && BigInt(req.body.sizeBytes) !== BigInt(stat.size)) throw new Error('اندازه فایل بایگانی با شواهد ارسالی سازگار نیست.');
  return prisma.accountingArchiveEvidence.create({ data: {
    bookId: positiveText(req.body.bookId, 'دفتر حسابداری'),
    evidenceIdentity: positiveText(req.body.evidenceIdentity, 'شناسه مدرک'),
    evidenceType: positiveText(req.body.evidenceType, 'نوع مدرک'),
    sourceEntityType: positiveText(req.body.sourceEntityType, 'نوع منبع مدرک'),
    sourceEntityId: positiveText(req.body.sourceEntityId, 'شناسه منبع مدرک'),
    contentHash,
    storageKey,
    mimeType: positiveText(req.body.mimeType, 'نوع فایل'),
    sizeBytes: BigInt(stat.size),
    malwareScanStatus,
    malwareScanAt: new Date(),
    retentionPolicyId: positiveText(req.body.retentionPolicyId, 'سیاست نگهداری'),
    retainUntil: req.body.retainUntil ? date(req.body.retainUntil, 'پایان نگهداری') : null,
    legalHold: Boolean(req.body.legalHold),
    supersedesId: req.body.supersedesId,
    uploadedBy: req.user!.id,
  } });
}, true));

const accessArchiveEvidence = (action: 'VIEW' | 'DOWNLOAD') => run(async (req) => {
  const evidence = await prisma.accountingArchiveEvidence.findUniqueOrThrow({ where: { id: req.params.id } });
  if (evidence.malwareScanStatus !== 'CLEAN' || !evidence.malwareScanAt) throw new Error('مدرک تا پیش از تأیید بررسی بدافزار قابل مشاهده یا دریافت نیست.');
  await createAccountingLedgerPrismaRepository(prisma).transaction((tx) => tx.appendAudit({
    action: `LEGAL_ARCHIVE_${action}`,
    result: 'SUCCEEDED',
    actorId: req.user!.id,
    effectiveProfile: req.workspacePermission === 'admin' ? 'ACCOUNTING_MANAGER' : req.workspacePermission === 'edit' ? 'ACCOUNTANT' : 'VIEWER',
    entityType: 'LEGAL_ARCHIVE_EVIDENCE',
    entityId: evidence.id,
    correlationId: String(req.get('X-Correlation-ID') || randomUUID()),
    reason: action === 'DOWNLOAD' ? 'دریافت مدرک بایگانی قانونی' : 'مشاهده مدرک بایگانی قانونی',
    payloadHash: evidence.contentHash,
    sessionContext: { action, storageKey: evidence.storageKey },
  }));
  return {
    evidenceIdentity: evidence.evidenceIdentity,
    contentHash: evidence.contentHash,
    mimeType: evidence.mimeType,
    sizeBytes: evidence.sizeBytes,
    action,
  };
});

router.post('/archive-evidence/:id/view', ...viewAccess, accessArchiveEvidence('VIEW'));
router.post('/archive-evidence/:id/download', ...managerAccess, accessArchiveEvidence('DOWNLOAD'));
router.get('/archive-evidence/:id/download', ...managerAccess, async (req: WorkspaceRequest, res: Response) => {
  try {
    const evidence = await prisma.accountingArchiveEvidence.findUniqueOrThrow({ where: { id: req.params.id } });
    if (evidence.malwareScanStatus !== 'CLEAN' || !evidence.malwareScanAt) throw new Error('مدرک تا پیش از تأیید بررسی بدافزار قابل دریافت نیست.');
    const filePath = accountingArchivePath(evidence.storageKey);
    const contentHash = await sha256File(filePath);
    if (contentHash !== evidence.contentHash) throw new Error('تمامیت فایل بایگانی تأیید نشد.');
    await createAccountingLedgerPrismaRepository(prisma).transaction((tx) => tx.appendAudit({
      action: 'ARCHIVE_EVIDENCE_DOWNLOAD', result: 'SUCCEEDED', actorId: req.user!.id, effectiveProfile: 'ACCOUNTING_MANAGER',
      entityType: 'ACCOUNTING_ARCHIVE_EVIDENCE', entityId: evidence.id, correlationId: String(req.get('X-Correlation-ID') || randomUUID()),
      reason: positiveText(req.query.reason, 'دلیل دسترسی'), payloadHash: evidence.contentHash,
      sessionContext: { evidenceType: evidence.evidenceType },
    }));
    res.type(evidence.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${evidence.evidenceIdentity.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    return res.sendFile(filePath);
  } catch (error) {
    const trackingId = `ACC-END-${Date.now().toString(36).toUpperCase()}`;
    console.error('Accounting archive download failed:', { trackingId, error });
    return res.status(400).json({ success: false, error: error instanceof Error && /[\u0600-\u06ff]/.test(error.message) ? error.message : 'دریافت مدرک بایگانی انجام نشد.', trackingId });
  }
});

export default router;
