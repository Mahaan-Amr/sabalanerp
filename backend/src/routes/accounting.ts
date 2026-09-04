import { prisma } from '../lib/prisma';
import express, { Request, Response } from 'express';
import path from 'path';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess, WorkspaceRequest, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { FeatureRequest, FEATURE_PERMISSIONS, FEATURES, requireAnyNarrowFeatureAccess, requireFeatureAccess, requireNarrowFeatureAccess, type Feature } from '../middleware/feature';
import { generatePdfFromHtml } from '../utils/pdf';
import { renderAccountingContractHtml } from '../utils/accountingPrintTemplate';
import {
  buildSalesContractPdfDownloadName,
  buildSalesContractPdfFingerprint,
  ensureStoredSalesContractPdfExists,
  generateSalesContractPdf,
  isSalesContractPdfCacheFresh,
  resolveStoredSalesContractPdfPath,
  resolveSalesContractPdfUrl,
  salesContractPrintableInclude
} from '../utils/salesContractPdf';
import {
  executeAccountingAction,
  getAccountantPerformanceReport,
  getAccountingSettings,
  getAccountingContractDetail,
  getAccountingFinancialTrend,
  getAccountingWorkspace,
  listAccountingContracts,
  listAuditLogs,
  listCorrectionRequests,
  listFinancialRecords,
  listPaymentStatuses,
  listReceivables,
  listTaxRecords,
  recordFinancialEvidenceReviewCase,
  updateAccountingSettings
} from '../services/accountingService';
import { FinancialEvidenceConflictError } from '../services/approvedPricing';
import type { ContractCustomPrintOptions, ContractPrintVariant } from '../utils/printTemplate';
import { publishNotificationEvent } from '../services/notificationService';
import { listDispatchDocumentRecoveryAudit } from '../services/dispatchDocumentAuditRecovery';
import {
  decideAccountingDispatchCandidate,
  DispatchAllocationConflictError,
  DispatchAllocationValidationError,
  replaceAccountingDispatchWaybill,
  voidAccountingDispatchWaybill,
} from '../services/dispatchAllocation';
import {
  approveManualOutageExit,
  createDispatchCorrection,
  createManualOutageExit,
  DispatchRecoveryConflictError,
  DispatchRecoveryValidationError,
  endErpWideOutage,
  postDispatchCorrection,
  verifyErpWideOutage,
} from '../services/dispatchCorrectionOutage';
import { PilotSafetyPauseError } from '../services/dispatchCutover';
import { configureDispatchDocumentsRuntime, createAccountingDispatchDocumentRouter,
  dispatchDocumentHttpStatus } from '../services/dispatchDocuments';
import { renderDispatchDocumentPdf } from '../documents/dispatch/dispatchDocumentPdf';
import { getStatementAdjustmentArtifactPreparer } from '../services/statementAdjustmentRuntime';
import { resolveNarrowFeatureAccess } from '../services/narrowFeatureAccess';
import { ContractLifecycleRequestKind } from '@prisma/client';
import { mayDirectlyPerformContractLifecycleAction, type ContractLifecycleAction } from '../services/contractLifecyclePolicy';
import {
  ContractLifecycleBlockedError,
  createContractLifecycleRequest,
  decideContractLifecycleRequest,
  executeContractLifecycleAction,
  getContractLifecyclePreview,
  listContractLifecycleRequests,
} from '../services/contractLifecycleService';
import { requestAccountingSalesContractCorrection } from '../services/salesContractCorrectionDuty';
import { getEffectiveUserAccess } from '../services/effectiveAccessService';
import { PartnerAccountingCommandError, PartnerAccountingTechnicalError } from '../services/partnerSales/accounting/errors';
import { readPartnerSnapshot } from '../services/partnerSales/authorization/readSnapshot';
import { createAuditedPartnerAuthorization } from '../services/partnerSales/authorization/audited';
import { randomUUID } from 'node:crypto';

const router = express.Router();
const ACCOUNTING_PDF_DIR = path.join(process.cwd(), 'storage', 'accounting-contracts');

const accountingActionFeature: Record<string, string[]> = {
  CREATE_INVOICE: [FEATURES.ACCOUNTING_INVOICE_CANDIDATES_MANAGE],
  CREATE_REPLACEMENT_INVOICE: [FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID],
  CREATE_RECEIVABLE: [FEATURES.ACCOUNTING_RECEIVABLES_MANAGE],
  APPROVE_FINANCIAL_INVOICE: [FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID],
  REGISTER_RECEIPT: [FEATURES.ACCOUNTING_PAYMENTS_MANAGE],
  REVERSE_RECEIPT: [FEATURES.ACCOUNTING_PAYMENTS_MANAGE],
  UPDATE_CHECK_STATUS: [FEATURES.ACCOUNTING_PAYMENTS_MANAGE],
  MARK_TAX_READY: [FEATURES.ACCOUNTING_TAX_MANAGE],
  TRACK_TAX_SUBMISSION: [FEATURES.ACCOUNTING_TAX_MANAGE],
  APPROVE_CORRECTION_FOR_SALES_EDIT: [FEATURES.ACCOUNTING_CORRECTIONS_APPROVE],
  DECLINE_CORRECTION: [FEATURES.ACCOUNTING_CORRECTIONS_APPROVE],
  RESOLVE_CORRECTION: [FEATURES.ACCOUNTING_CORRECTIONS_VERIFY],
  FLAG_CONTRACT: [FEATURES.ACCOUNTING_ACTIONS_MANAGE],
  RESOLVE_CONTRACT_FLAG: [FEATURES.ACCOUNTING_ACTIONS_MANAGE],
  CANCEL_CONTRACT_FLAG: [FEATURES.ACCOUNTING_ACTIONS_MANAGE],
  VOID_ACCOUNTING_RECORD: [FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID],
  DELETE_DRAFT_ACCOUNTING_RECORD: [FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID],
};

const getAccountingActionCapabilities = async (userId: string, role: string) => {
  const effective = await getEffectiveUserAccess(prisma, { userId, userRole: role });
  const workspaceLevel = effective.workspaces.find(({ workspace }) => workspace === WORKSPACES.ACCOUNTING)?.permission;
  const canEditWorkspace = Boolean(workspaceLevel && ({ view: 1, edit: 2, admin: 3 }[workspaceLevel] >= 2));
  const resolveFeatures = async (features: string[]) => (
    await Promise.all(features.map((feature) => resolveNarrowFeatureAccess(prisma, {
      userId, role, workspace: WORKSPACES.ACCOUNTING, feature,
      requiredPermission: FEATURE_PERMISSIONS.EDIT,
    })))
  ).some(({ allowed }) => allowed) && canEditWorkspace;
  const entries = await Promise.all(Object.entries(accountingActionFeature)
    .map(async ([kind, features]) => [kind, await resolveFeatures(features)] as const));
  return Object.fromEntries([
    ...entries,
    ['CREATE_CORRECTION_REQUEST', await resolveFeatures([FEATURES.ACCOUNTING_CORRECTIONS_CREATE, FEATURES.ACCOUNTING_CORRECTIONS_MANAGE])],
  ]) as Record<string, boolean>;
};

const projectAccountingActions = <T extends { nextBestActions?: Array<Record<string, any>> }>(
  record: T,
  capabilities: Record<string, boolean>,
): T => ({
  ...record,
  nextBestActions: [
    ...(record.nextBestActions || []),
    { kind: 'FLAG_CONTRACT', labelFa: 'ثبت پرچم حسابداری', enabled: true },
  ].map((action) => {
    const visible = Boolean(capabilities[action.kind]);
    return {
      ...action,
      visible,
      enabled: visible && Boolean(action.enabled),
      reason: !visible
        ? 'مجوز انجام این عملیات برای شما فعال نیست.'
        : action.reason ?? action.disabledReason,
    };
  }),
});

export const readAccountingActionIdentities = (req: Pick<Request, 'body' | 'get'>) => ({
  idempotencyKey: String(
    req.get('X-Idempotency-Key')
    || req.get('Idempotency-Key')
    || req.body?.idempotencyKey
    || '',
  ).trim(),
  correlationId: String(
    req.get('X-Correlation-ID')
    || req.body?.correlationId
    || '',
  ).trim(),
});

const accountingView = [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.ACCOUNTING_DASHBOARD_VIEW, FEATURE_PERMISSIONS.VIEW)
];

const accountingEdit = [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.ACCOUNTING_ACTIONS_MANAGE, FEATURE_PERMISSIONS.EDIT)
];

const accountingFeatureView = (feature: Feature) => [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(feature, FEATURE_PERMISSIONS.VIEW),
];
const accountingContractsView = [...accountingFeatureView(FEATURES.ACCOUNTING_CONTRACTS_VIEW),
  async (req: AuthRequest, res: Response, next: express.NextFunction) => {
    if (!req.params.contractId) return next();
    try {
      const contract = await prisma.salesContract.findUnique({ where: { id: req.params.contractId },
        select: { partnerCaseId: true, partnerKind: true } });
      // Partner Accounting has an internal debtor/source. The retail projection
      // cannot enter ordinary detail, lifecycle or PDF handlers by a deep link.
      if (contract?.partnerCaseId || contract?.partnerKind === 'PARTNER_CUSTOMER') {
        res.status(404).json({ success: false, error: 'رکورد حسابداری در دسترس نیست.' }); return;
      }
      next();
    } catch (error) { next(error); }
  }];
const accountingFinancialRecordsView = accountingFeatureView(FEATURES.ACCOUNTING_RECORDS_APPROVE_VOID);
const accountingReceivablesView = accountingFeatureView(FEATURES.ACCOUNTING_RECEIVABLES_MANAGE);
const accountingPaymentsView = accountingFeatureView(FEATURES.ACCOUNTING_PAYMENTS_MANAGE);
const accountingTaxView = accountingFeatureView(FEATURES.ACCOUNTING_TAX_MANAGE);
const accountingCorrectionsView = [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.VIEW),
  requireAnyNarrowFeatureAccess([
    FEATURES.ACCOUNTING_CORRECTIONS_MANAGE,
    FEATURES.ACCOUNTING_CORRECTIONS_APPROVE,
    FEATURES.ACCOUNTING_CORRECTIONS_VERIFY,
  ], FEATURE_PERMISSIONS.VIEW),
];
const accountingAuditView = accountingFeatureView(FEATURES.ACCOUNTING_AUDIT_VIEW);

const accountingDispatchView = [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.VIEW),
  requireNarrowFeatureAccess(FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_VIEW, FEATURE_PERMISSIONS.VIEW),
];

// Recovery evidence contains storage identities and incident details. It is deliberately
// not inherited from the broad Accounting workspace/dashboard permission.
const accountingRecoveryEvidenceView = [
  protect,
  requireNarrowFeatureAccess(FEATURES.ACCOUNTING_AUDIT_VIEW, FEATURE_PERMISSIONS.VIEW),
];

const accountingDispatchEdit = [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.EDIT),
  requireNarrowFeatureAccess(FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE, FEATURE_PERMISSIONS.EDIT),
];

const dispatchDocuments = configureDispatchDocumentsRuntime({
  prisma,
  templateVersion: 'dispatch-documents-v1',
  generatorVersion: 'chromium-pdf-v1',
  publisher: { async publish(input) {
    const rendered = await renderDispatchDocumentPdf(input);
    return { bytes: rendered.bytes, mediaType: rendered.metadata.mimeType };
  } },
});
router.use(createAccountingDispatchDocumentRouter({ service: dispatchDocuments, view: accountingDispatchView }));

const accountingCorrectionsEdit = [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.ACCOUNTING_CORRECTIONS_MANAGE, FEATURE_PERMISSIONS.EDIT),
];

const dispatchAuthority = (req: WorkspaceRequest & FeatureRequest) => ({ actorRole: req.user!.role,
  workspace: req.workspace || WORKSPACES.ACCOUNTING, workspacePermission: req.workspacePermission || WORKSPACE_PERMISSIONS.EDIT,
  feature: FEATURES.ACCOUNTING_CORRECTIONS_MANAGE, featurePermission: req.featurePermission || FEATURE_PERMISSIONS.EDIT });

const managerReviewActions = new Set([
  'APPROVE_CORRECTION_FOR_SALES_EDIT',
  'DECLINE_CORRECTION',
  'VOID_ACCOUNTING_RECORD',
  'CREATE_REPLACEMENT_INVOICE',
  'APPROVE_FINANCIAL_INVOICE',
  'RESOLVE_CORRECTION',
  'RECHECK_FINANCIAL_EVIDENCE_REVIEW'
]);

const dispatchError = (res: Response, error: unknown) => {
  const documentStatus = dispatchDocumentHttpStatus(error);
  if (documentStatus) return res.status(documentStatus).json({ success: false, error: (error as Error).message });
  if (error instanceof PilotSafetyPauseError || error instanceof DispatchAllocationConflictError || error instanceof DispatchRecoveryConflictError) return res.status(409).json({ success: false, error: error.message });
  if (error instanceof DispatchAllocationValidationError || error instanceof DispatchRecoveryValidationError) return res.status(400).json({ success: false, error: error.message });
  console.error('Accounting dispatch error:', error);
  return res.status(500).json({ success: false, error: 'Accounting dispatch command failed.' });
};

router.get('/dispatch-corrections', accountingDispatchView, async (_req: AuthRequest, res: Response) => {
  try { return res.json({ success: true, data: await prisma.dispatchCorrection.findMany({ include: { lines: true, waybill: true }, orderBy: { createdAt: 'desc' } }) }); }
  catch (error) { return dispatchError(res, error); }
});

router.post('/dispatch-corrections', accountingCorrectionsEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try { return res.status(201).json({ success: true, data: await createDispatchCorrection(prisma, { waybillId: req.body.waybillId,
    reason: req.body.reason, effectiveAt: new Date(req.body.effectiveAt), lines: req.body.lines, reversalOfId: req.body.reversalOfId,
    reattributions: req.body.reattributions,
    actorId: req.user!.id, authority: dispatchAuthority(req) }) }); }
  catch (error) { return dispatchError(res, error); }
});

router.post('/dispatch-corrections/:id/post', accountingCorrectionsEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try { return res.json({ success: true, data: await postDispatchCorrection(prisma, { correctionId: req.params.id,
    actorId: req.user!.id, authority: dispatchAuthority(req),
    idempotencyKey: String(req.get('Idempotency-Key') || req.body.idempotencyKey || ''),
    correlationId: String(req.get('X-Correlation-Id') || req.body.correlationId || '') }, {
      artifactPreparer: getStatementAdjustmentArtifactPreparer() || undefined,
    }) }); }
  catch (error) { return dispatchError(res, error); }
});

router.post('/dispatch-outages/verify', accountingCorrectionsEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try { return res.status(201).json({ success: true, data: await verifyErpWideOutage(prisma, { reason: req.body.reason,
    verification: req.body.verification || {}, actualStartedAt: new Date(req.body.actualStartedAt),
    actorId: req.user!.id, authority: dispatchAuthority(req) }) }); }
  catch (error) { return dispatchError(res, error); }
});

router.post('/dispatch-outages/:id/end', accountingCorrectionsEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try { return res.json({ success: true, data: await endErpWideOutage(prisma, { outageId: req.params.id,
    actualEndedAt: new Date(req.body.actualEndedAt), actorId: req.user!.id, authority: dispatchAuthority(req) }) }); }
  catch (error) { return dispatchError(res, error); }
});

router.post('/manual-outage-exits', accountingCorrectionsEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try { return res.status(201).json({ success: true, data: await createManualOutageExit(prisma, { outageId: req.body.outageId,
    waybillId: req.body.waybillId, paperNumber: req.body.paperNumber, actualOccurredAt: new Date(req.body.actualOccurredAt),
    paperEvidence: req.body.paperEvidence || {}, actorId: req.user!.id, authority: dispatchAuthority(req) }) }); }
  catch (error) { return dispatchError(res, error); }
});

router.post('/manual-outage-exits/:id/accounting-approval', accountingCorrectionsEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try { return res.json({ success: true, data: await approveManualOutageExit(prisma, { id: req.params.id, role: 'ACCOUNTING',
    actorId: req.user!.id, authority: dispatchAuthority(req) }) }); }
  catch (error) { return dispatchError(res, error); }
});

router.get('/dispatch-evidence-exceptions', accountingDispatchView, async (_req: AuthRequest, res: Response) => {
  try { return res.json({ success: true, data: await prisma.dispatchEvidenceException.findMany({ orderBy: { createdAt: 'desc' } }) }); }
  catch (error) { return dispatchError(res, error); }
});

router.get('/dispatch-candidates', accountingDispatchView, async (req: AuthRequest, res: Response) => {
  try {
    const { manage, candidates } = await readPartnerSnapshot(prisma, async tx => {
      const manage = await resolveNarrowFeatureAccess(tx, { userId: req.user!.id, role: req.user!.role,
        workspace: WORKSPACES.ACCOUNTING, feature: FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE,
        requiredPermission: FEATURE_PERMISSIONS.EDIT });
      const owners = await tx.accountingDispatchCandidate.findMany({ orderBy: { id: 'asc' }, select: {
        id: true, allocationRevision: { select: { sourceKind: true, partnerCaseId: true } },
      } });
      const authority = createAuditedPartnerAuthorization(tx, { actorId: req.user!.id, purpose: 'ACCOUNTING', channel: 'LIST' }, {
        correlationId: String(req.get('X-Correlation-Id') || randomUUID()), reason: 'بررسی دسترسی فهرست اسناد ارسال پرونده همکار',
      });
      const allowedPartnerCases = new Set<string>();
      for (const caseId of [...new Set(owners.flatMap(owner => owner.allocationRevision.sourceKind === 'PARTNER_CASE'
        && owner.allocationRevision.partnerCaseId ? [owner.allocationRevision.partnerCaseId] : []))].sort()) {
        if ((await authority.authorize('ACCOUNTING_READ', { kind: 'CASE', id: caseId })).ok) allowedPartnerCases.add(caseId);
      }
      const allowedIds = owners.flatMap(owner => owner.allocationRevision.sourceKind === 'SALES_CONTRACT'
        || (owner.allocationRevision.sourceKind === 'PARTNER_CASE' && owner.allocationRevision.partnerCaseId
          && allowedPartnerCases.has(owner.allocationRevision.partnerCaseId)) ? [owner.id] : []);
      const candidates = await tx.accountingDispatchCandidate.findMany({ where: { id: { in: allowedIds } }, select: {
        id: true, status: true, createdAt: true, dispositionAt: true, dispositionReason: true,
        waybills: { orderBy: { issuedAt: 'asc' }, select: { id: true, number: true, status: true,
          issuedAt: true, voidedAt: true, replacesWaybillId: true } },
      }, orderBy: { createdAt: 'asc' } });
      return { manage, candidates };
    });
    res.setHeader('X-Dispatch-Documents-Permission', manage.allowed ? 'MANAGE' : 'VIEW');
    return res.json({ success: true, data: candidates.map((candidate) => ({ ...candidate,
      waybills: candidate.waybills.map((waybill) => ({ ...waybill, number: waybill.number.toString() })) })) });
  } catch (error) { return dispatchError(res, error); }
});

router.post('/dispatch-candidates/:id/decision', accountingDispatchEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try {
    const data = await decideAccountingDispatchCandidate(prisma, {
      candidateId: req.params.id, action: req.body.action, reason: req.body.reason,
      idempotencyKey: String(req.get('Idempotency-Key') || req.body.idempotencyKey || ''), actorId: req.user!.id,
      effectiveAuthority: { actorRole: req.user!.role, workspace: req.workspace, workspacePermission: req.workspacePermission,
        feature: FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE, featurePermission: req.featurePermission },
    });
    return res.json({ success: true, data });
  } catch (error) { return dispatchError(res, error); }
});

router.post('/dispatch-waybills/:id/void', accountingDispatchEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try {
    const data = await voidAccountingDispatchWaybill(prisma, { waybillId: req.params.id, reason: req.body.reason,
      idempotencyKey: String(req.get('Idempotency-Key') || req.body.idempotencyKey || ''), actorId: req.user!.id,
      effectiveAuthority: { actorRole: req.user!.role, workspace: req.workspace, workspacePermission: req.workspacePermission,
        feature: FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE, featurePermission: req.featurePermission } });
    return res.json({ success: true, data });
  } catch (error) { return dispatchError(res, error); }
});

router.post('/dispatch-waybills/:id/replace', accountingDispatchEdit, async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
  try {
    const data = await replaceAccountingDispatchWaybill(prisma, { waybillId: req.params.id, reason: req.body.reason,
      idempotencyKey: String(req.get('Idempotency-Key') || req.body.idempotencyKey || ''), actorId: req.user!.id,
      effectiveAuthority: { actorRole: req.user!.role, workspace: req.workspace, workspacePermission: req.workspacePermission,
        feature: FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE, featurePermission: req.featurePermission } });
    return res.json({ success: true, data });
  } catch (error) { return dispatchError(res, error); }
});

const handleValidation = (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (errors.isEmpty()) return false;
  res.status(400).json({
    success: false,
    error: 'Validation failed',
    details: errors.array()
  });
  return true;
};

const resolveAccountingPdfUrl = (req: AuthRequest, pdfPath: string): string | null => {
  const fileName = path.basename(pdfPath);
  if (!fileName) return null;

  const host = req.get('host');
  const protocol = req.protocol || 'http';
  return `${protocol}://${host}/files/accounting-contracts/${encodeURIComponent(fileName)}`;
};

type SalesContractPdfVariant = ContractPrintVariant;

const salesContractPdfVariantFromQuery = (value: unknown): SalesContractPdfVariant => {
  if (value === 'accounting' || value === 'workshop' || value === 'custom') return value;
  return 'original';
};

const salesContractPdfCacheKey = (variant: SalesContractPdfVariant): string => {
  if (variant === 'accounting') return 'accountingSalesPdfAccounting';
  if (variant === 'workshop') return 'accountingSalesPdfWorkshop';
  if (variant === 'custom') return 'accountingSalesPdfCustom';
  return 'print';
};

const salesContractPdfDownloadName = (contract: any, variant: SalesContractPdfVariant): string => {
  const baseName = buildSalesContractPdfDownloadName(contract);
  if (variant === 'accounting') return baseName.replace(/\.pdf$/i, '_accounting.pdf');
  if (variant === 'workshop') return baseName.replace(/\.pdf$/i, '_workshop.pdf');
  if (variant === 'custom') return baseName.replace(/\.pdf$/i, '_custom.pdf');
  return baseName;
};

const booleanFromQuery = (value: unknown): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = String(value).toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
};

const customPrintOptionsFromQuery = (query: any): ContractCustomPrintOptions => {
  const columns: ContractCustomPrintOptions['columns'] = {};
  (['index', 'code', 'description', 'category', 'length', 'width', 'measurement', 'count', 'rate', 'total'] as const).forEach((key) => {
    const value = booleanFromQuery(query[`column_${key}`]);
    if (value !== undefined) {
      columns[key] = value;
    }
  });

  const preset = ['accounting', 'workshop', 'detailed', 'summarized'].includes(String(query.preset))
    ? String(query.preset) as ContractCustomPrintOptions['preset']
    : undefined;

  return {
    preset,
    productRowsMode: query.productRowsMode === 'summarized' ? 'summarized' : 'detailed',
    showCustomerSection: booleanFromQuery(query.showCustomerSection),
    showProductsSection: booleanFromQuery(query.showProductsSection),
    showPrices: booleanFromQuery(query.showPrices),
    showExplanatoryRows: booleanFromQuery(query.showExplanatoryRows),
    showDeliverySection: booleanFromQuery(query.showDeliverySection),
    showPaymentSection: booleanFromQuery(query.showPaymentSection),
    showTotals: booleanFromQuery(query.showTotals),
    showNotes: booleanFromQuery(query.showNotes),
    columns
  };
};

const markOriginalSalesContractPrinted = async (
  req: AuthRequest,
  contract: any,
  currentSignatures: any,
  pdfPath: string,
  fingerprint: string,
  generatedAt: string | null
) => {
  const printedAt = new Date();
  const timestamp = generatedAt || printedAt.toISOString();
  await prisma.salesContract.update({
    where: { id: contract.id },
    data: {
      status: contract.status === 'SIGNED' ? 'PRINTED' : contract.status,
      printedAt,
      signatures: {
        ...currentSignatures,
        print: {
          by: req.user!.id,
          at: timestamp,
          generatedAt: timestamp,
          pdfPath,
          fingerprint,
          variant: 'original'
        }
      }
    }
  });
};

const accountingReadFailure = (res: Response, error: unknown) => {
  if (error instanceof PartnerAccountingCommandError) return res.status(error.status).json({
    success: false, code: error.code, error: error.message, message: error.message, actionUrl: error.actionUrl,
  });
  const trackingId = `ACC-${Date.now().toString(36).toUpperCase()}`;
  console.error('Accounting read technical failure:', { trackingId, error });
  return res.status(500).json({ success: false, trackingId,
    error: 'دریافت اطلاعات حسابداری موقتاً ممکن نیست؛ دوباره تلاش کنید و در صورت تکرار، کد پیگیری را به پشتیبانی بدهید.' });
};

export const getAccountingWorkspaceResponse = async (req: AuthRequest, res: Response) => {
  try {
    const workspace = await getAccountingWorkspace(req.query, { userId: req.user!.id });
    res.json({ success: true, data: workspace });
  } catch (error) {
    console.error('Accounting workspace error:', error);
    accountingReadFailure(res, error);
  }
};

router.get('/workspace', accountingView, getAccountingWorkspaceResponse);

export const createAccountingFinancialTrendResponse = (
  loadTrend: typeof getAccountingFinancialTrend = getAccountingFinancialTrend,
) => async (req: AuthRequest, res: Response) => {
  try {
    const trend = await loadTrend(req.query.range, new Date(), { userId: req.user!.id });
    res.json({ success: true, data: trend });
  } catch (error) {
    console.error('Accounting financial trend error:', error);
    accountingReadFailure(res, error);
  }
};

router.get('/financial-trend', accountingView, createAccountingFinancialTrendResponse());

router.get('/contracts', accountingContractsView, async (req: AuthRequest, res: Response) => {
  try {
    const [data, capabilities] = await Promise.all([
      listAccountingContracts(req.query as any),
      getAccountingActionCapabilities(req.user!.id, req.user!.role),
    ]);
    res.json({ success: true, data: {
      ...data,
      items: data.items.map((record: any) => projectAccountingActions(record, capabilities)),
    } });
  } catch (error) {
    console.error('Accounting contracts error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/contracts/:contractId', accountingContractsView, async (req: AuthRequest, res: Response) => {
  try {
    const [data, capabilities] = await Promise.all([
      getAccountingContractDetail(req.params.contractId),
      getAccountingActionCapabilities(req.user!.id, req.user!.role),
    ]);
    const contract = projectAccountingActions((data as any).contract, capabilities);
    res.json({ success: true, data: {
      ...(data as any),
      contract,
      availableActions: contract.nextBestActions,
    } });
  } catch (error: any) {
    console.error('Accounting contract detail error:', error);
    res.status(error.message === 'Contract not found' ? 404 : 500).json({
      success: false,
      error: error.message === 'Contract not found' ? 'Contract not found' : 'Server error'
    });
  }
});

router.get('/contracts/:contractId/lifecycle', accountingContractsView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await getContractLifecyclePreview(req.params.contractId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(error.message === 'Contract not found' ? 404 : 400).json({ success: false, error: error.message });
  }
});

router.get('/contract-lifecycle-requests', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listContractLifecycleRequests(req.query as any, { ordinaryOnly: true });
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

router.post(
  '/contracts/:contractId/lifecycle-requests',
  accountingEdit,
  [body('kind').isIn(Object.values(ContractLifecycleRequestKind)), body('reason').isString().isLength({ min: 3 })],
  async (req: AuthRequest, res: Response) => {
    if (handleValidation(req, res)) return;
    try {
      const data = await createContractLifecycleRequest({
        contractId: req.params.contractId,
        kind: req.body.kind,
        reason: req.body.reason,
        actorId: req.user!.id,
      });
      res.status(201).json({ success: true, data });
    } catch (error: any) {
      res.status(400).json({ success: false, error: error.message });
    }
  },
);

router.post(
  '/contracts/:contractId/lifecycle-actions',
  accountingEdit,
  [body('action').isIn(['DELETE', 'DEACTIVATE', 'REACTIVATE']), body('reason').isString().isLength({ min: 3 })],
  async (req: AuthRequest, res: Response) => {
    if (handleValidation(req, res)) return;
    const action = req.body.action as ContractLifecycleAction;
    if (!mayDirectlyPerformContractLifecycleAction(req.user!.role, action)) {
      res.status(403).json({ success: false, error: 'Direct lifecycle action is not permitted for this role' });
      return;
    }
    try {
      const data = await executeContractLifecycleAction({
        contractId: req.params.contractId,
        action,
        reason: req.body.reason,
        actorId: req.user!.id,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(error instanceof ContractLifecycleBlockedError ? 409 : 400).json({
        success: false,
        error: error.message,
        blockers: error instanceof ContractLifecycleBlockedError ? error.blockers : undefined,
      });
    }
  },
);

router.post(
  '/contract-lifecycle-requests/:requestId/decision',
  accountingEdit,
  [body('decision').isIn(['APPROVE', 'REJECT']), body('reason').optional().isString().isLength({ min: 3 })],
  async (req: AuthRequest, res: Response) => {
    if (handleValidation(req, res)) return;
    const request = await prisma.contractLifecycleRequest.findUnique({ where: { id: req.params.requestId } });
    if (!request) {
      res.status(404).json({ success: false, error: 'Lifecycle request not found' });
      return;
    }
    const managerMayDecide = req.user!.role === 'MANAGER' && request.kind === ContractLifecycleRequestKind.DEACTIVATE;
    if (req.user!.role !== 'ADMIN' && !managerMayDecide) {
      res.status(403).json({ success: false, error: 'Admin approval is required for this lifecycle request' });
      return;
    }
    try {
      const data = await decideContractLifecycleRequest({
        requestId: request.id,
        decision: req.body.decision,
        reason: req.body.reason,
        actorId: req.user!.id,
      });
      res.json({ success: true, data });
    } catch (error: any) {
      res.status(error instanceof ContractLifecycleBlockedError ? 409 : 400).json({
        success: false,
        error: error.message,
        blockers: error instanceof ContractLifecycleBlockedError ? error.blockers : undefined,
      });
    }
  },
);

router.get('/contracts/:contractId/pdf', accountingContractsView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await getAccountingContractDetail(req.params.contractId);
    const html = renderAccountingContractHtml(data);
    const contractNumber = data.contract?.contractNumber || req.params.contractId;
    const timestamp = Date.now();
    const pdfPath = await generatePdfFromHtml({
      htmlContent: html,
      outputDir: ACCOUNTING_PDF_DIR,
      fileName: `accounting_contract_${contractNumber}_${timestamp}`,
      landscape: true,
      scale: 0.94,
      widthMm: 297,
      heightMm: 210,
      margin: { top: '6mm', right: '6mm', bottom: '6mm', left: '6mm' }
    });
    const url = resolveAccountingPdfUrl(req, pdfPath);
    const shouldDownload = String(req.query.download || 'false').toLowerCase() === 'true';

    if (shouldDownload) {
      res.download(pdfPath, `accounting_contract_${contractNumber}.pdf`);
      return;
    }

    if (!url) {
      res.status(500).json({ success: false, error: 'Failed to build PDF url' });
      return;
    }

    res.json({
      success: true,
      data: {
        url,
        generatedAt: new Date().toISOString(),
        fromCache: false
      }
    });
  } catch (error: any) {
    console.error('Accounting contract PDF error:', error);
    res.status(error.message === 'Contract not found' ? 404 : 500).json({
      success: false,
      error: error.message === 'Contract not found' ? 'Contract not found' : 'Server error'
    });
  }
});

router.get('/contracts/:contractId/sales-pdf', accountingContractsView, async (req: AuthRequest, res: Response) => {
  try {
    const contract = await prisma.salesContract.findUnique({
      where: { id: req.params.contractId },
      include: salesContractPrintableInclude
    });

    if (!contract) {
      res.status(404).json({ success: false, error: 'Contract not found' });
      return;
    }

    const variant = salesContractPdfVariantFromQuery(req.query.variant);
    const cacheKey = salesContractPdfCacheKey(variant);
    const customPrintOptions = variant === 'custom' ? customPrintOptionsFromQuery(req.query) : undefined;
    const fresh = variant !== 'original' || String(req.query.fresh || 'false').toLowerCase() === 'true';
    const shouldDownload = String(req.query.download || 'false').toLowerCase() === 'true';
    const currentSignatures = (contract.signatures as any) || {};
    const printableContract = variant === 'original' && contract.status === 'SIGNED'
      ? { ...contract, status: 'PRINTED' }
      : contract;
    const pdfFingerprint = buildSalesContractPdfFingerprint(printableContract, variant, customPrintOptions);
    const cachedPdfCandidates = variant === 'original'
      ? [
          {
            pdfPath: currentSignatures?.print?.pdfPath as string | undefined,
            generatedAt: currentSignatures?.print?.generatedAt || currentSignatures?.print?.at || null,
            fingerprint: currentSignatures?.print?.fingerprint
          },
          {
            pdfPath: currentSignatures?.accountingSalesPdf?.pdfPath as string | undefined,
            generatedAt: currentSignatures?.accountingSalesPdf?.generatedAt ||
              currentSignatures?.accountingSalesPdf?.at ||
              null,
            fingerprint: currentSignatures?.accountingSalesPdf?.fingerprint
          }
        ]
      : [
          {
            pdfPath: currentSignatures?.[cacheKey]?.pdfPath as string | undefined,
            generatedAt: currentSignatures?.[cacheKey]?.generatedAt ||
              currentSignatures?.[cacheKey]?.at ||
              null,
            fingerprint: currentSignatures?.[cacheKey]?.fingerprint
          }
        ];
    const cachedPdf = fresh
      ? null
      : cachedPdfCandidates.find((candidate) =>
          candidate.pdfPath &&
          isSalesContractPdfCacheFresh(printableContract, candidate.fingerprint, pdfFingerprint) &&
          ensureStoredSalesContractPdfExists(candidate.pdfPath)
        );

    if (cachedPdf?.pdfPath) {
      if (variant === 'original') {
        await markOriginalSalesContractPrinted(req, contract, currentSignatures, cachedPdf.pdfPath, pdfFingerprint, cachedPdf.generatedAt);
      }

      if (shouldDownload) {
        res.download(
          resolveStoredSalesContractPdfPath(cachedPdf.pdfPath),
          salesContractPdfDownloadName(contract, variant)
        );
        return;
      }

      const cachedUrl = resolveSalesContractPdfUrl(req, cachedPdf.pdfPath);
      if (cachedUrl) {
        res.json({
          success: true,
          data: {
            url: cachedUrl,
            generatedAt: cachedPdf.generatedAt,
            fromCache: true,
            variant
          }
        });
        return;
      }
    }

    const pdfPath = await generateSalesContractPdf(printableContract, variant, customPrintOptions);
    const generatedAt = new Date().toISOString();

    if (variant === 'original') {
      await markOriginalSalesContractPrinted(req, contract, currentSignatures, pdfPath, pdfFingerprint, generatedAt);
    } else if (variant !== 'custom') {
      await prisma.salesContract.update({
        where: { id: contract.id },
        data: {
          signatures: {
            ...currentSignatures,
            [cacheKey]: {
              by: req.user!.id,
              at: generatedAt,
              generatedAt,
              pdfPath,
              fingerprint: pdfFingerprint,
              variant
            }
          }
        }
      });
    }

    if (shouldDownload) {
      res.download(
        resolveStoredSalesContractPdfPath(pdfPath),
        salesContractPdfDownloadName(contract, variant)
      );
      return;
    }

    const url = resolveSalesContractPdfUrl(req, pdfPath);
    if (!url) {
      res.status(500).json({ success: false, error: 'Failed to build PDF url' });
      return;
    }

    res.json({
      success: true,
      data: {
        url,
        generatedAt,
        fromCache: false,
        variant
      }
    });
  } catch (error) {
    console.error('Accounting sales contract PDF error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/financial-records', accountingFinancialRecordsView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listFinancialRecords(req.query, { userId: req.user!.id });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting records error:', error);
    accountingReadFailure(res, error);
  }
});

router.get('/receivables', accountingReceivablesView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listReceivables(req.query, { userId: req.user!.id });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting receivables error:', error);
    accountingReadFailure(res, error);
  }
});

router.get('/payments', accountingPaymentsView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listPaymentStatuses(req.query, { userId: req.user!.id });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting payments error:', error);
    accountingReadFailure(res, error);
  }
});

router.get('/tax', accountingTaxView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listTaxRecords(req.query, { userId: req.user!.id });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting tax error:', error);
    accountingReadFailure(res, error);
  }
});

router.get('/correction-requests', accountingCorrectionsView, async (req: AuthRequest, res: Response) => {
  try {
    const [data, capabilities] = await Promise.all([
      listCorrectionRequests(req.query, { userId: req.user!.id }),
      getAccountingActionCapabilities(req.user!.id, req.user!.role),
    ]);
    res.json({ success: true, data: { ...data, actionAvailability: {
      approve: { visible: capabilities.APPROVE_CORRECTION_FOR_SALES_EDIT, enabled: capabilities.APPROVE_CORRECTION_FOR_SALES_EDIT, reason: capabilities.APPROVE_CORRECTION_FOR_SALES_EDIT ? null : 'مجوز تصمیم‌گیری اصلاح فعال نیست.' },
      verify: { visible: capabilities.RESOLVE_CORRECTION, enabled: capabilities.RESOLVE_CORRECTION, reason: capabilities.RESOLVE_CORRECTION ? null : 'مجوز راستی‌آزمایی اصلاح فعال نیست.' },
    } } });
  } catch (error) {
    console.error('Accounting correction requests error:', error);
    accountingReadFailure(res, error);
  }
});

const correctionRequestFailure = (message: string) => ({
  DUTY_REASON_REQUIRED: { status: 400, message: 'متن درخواست اصلاح باید حداقل سه نویسه داشته باشد.' },
  DUTY_IDEMPOTENCY_KEY_REQUIRED: { status: 400, message: 'ثبت امن درخواست آماده نشد؛ صفحه را تازه‌سازی و دوباره تلاش کنید.' },
  DUTY_IDEMPOTENCY_CONFLICT: { status: 409, message: 'این شناسه ثبت قبلاً برای درخواست دیگری استفاده شده است؛ صفحه را تازه‌سازی کنید.' },
  DUTY_ACTIVE_CHAIN_CONFLICT: { status: 409, message: 'برای این قرارداد یک زنجیره اصلاح فعال وجود دارد؛ ابتدا همان درخواست را تکمیل کنید.' },
  CONTRACT_NOT_FOUND: { status: 404, message: 'قرارداد موردنظر پیدا نشد.' },
  CONTRACT_INACTIVE: { status: 409, message: 'قرارداد غیرفعال است؛ ابتدا آن را از مسیر رسمی فعال‌سازی مجدد بازگردانید.' },
  RESPONSIBLE_SELLER_REQUIRED: { status: 409, message: 'فروشنده مسئول قرارداد مشخص نیست؛ مدیر فروش باید ابتدا مسئول قرارداد را تعیین کند.' },
}[message]);

export const createAccountingCorrectionRequestHandler = (
  requestCorrection: typeof requestAccountingSalesContractCorrection = requestAccountingSalesContractCorrection,
) => async (req: AuthRequest & { params: { contractId: string } }, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ success: false, message: 'اطلاعات درخواست اصلاح کامل یا معتبر نیست.' });
  }
  try {
    const data = await requestCorrection(prisma, {
      contractId: req.params.contractId,
      actorUserId: req.user!.id,
      category: req.body.category || 'OTHER',
      priority: req.body.priority || 'MEDIUM',
      reason: String(req.body.reason || ''),
      idempotencyKey: String(req.get('X-Idempotency-Key') || req.get('Idempotency-Key') || req.body.idempotencyKey || ''),
    });
    return res.status(data.replayed ? 200 : 201).json({ success: true, data });
  } catch (error) {
    const internalMessage = error instanceof Error ? error.message : 'UNKNOWN';
    const known = correctionRequestFailure(internalMessage);
    if (known) return res.status(known.status).json({ success: false, message: known.message });
    const trackingId = `CORR-${Date.now().toString(36).toUpperCase()}`;
    console.error('Accounting-originated correction request failed:', { trackingId, error });
    return res.status(500).json({
      success: false,
      message: `ثبت درخواست اصلاح انجام نشد. کد پیگیری ${trackingId} را به پشتیبانی اعلام کنید.`,
      trackingId,
    });
  }
};

router.post(
  '/contracts/:contractId/correction-requests',
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.EDIT),
  requireAnyNarrowFeatureAccess([
    FEATURES.ACCOUNTING_CORRECTIONS_CREATE,
    FEATURES.ACCOUNTING_CORRECTIONS_MANAGE,
  ], FEATURE_PERMISSIONS.EDIT),
  [
    body('reason').isString().trim().isLength({ min: 3 }),
    body('category').optional().isIn([
      'CUSTOMER_IDENTITY', 'AMOUNT_PRICING', 'PAYMENT_PLAN', 'DELIVERY_SCHEDULE',
      'TAX_INFO', 'DOCUMENT_SIGNATURE', 'OTHER',
    ]),
    body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  ],
  createAccountingCorrectionRequestHandler(),
);

router.get('/audit/dispatch-documents/recovery', accountingRecoveryEvidenceView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listDispatchDocumentRecoveryAudit(prisma, req.query as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Dispatch document recovery audit error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/audit', accountingAuditView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listAuditLogs(req.query, { userId: req.user!.id });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting audit error:', error);
    accountingReadFailure(res, error);
  }
});

router.get('/performance', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await getAccountantPerformanceReport(req.query, { userId: req.user!.id });
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting performance error:', error);
    accountingReadFailure(res, error);
  }
});

router.get('/settings', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await getAccountingSettings();
    const editAccess = await resolveNarrowFeatureAccess(prisma, {
      userId: req.user!.id,
      role: req.user!.role,
      workspace: WORKSPACES.ACCOUNTING,
      feature: FEATURES.ACCOUNTING_ACTIONS_MANAGE,
      requiredPermission: FEATURE_PERMISSIONS.EDIT,
    });
    res.json({ success: true, data: {
      ...data,
      actionAvailability: {
        edit: {
          visible: editAccess.allowed,
          enabled: editAccess.allowed,
          reason: editAccess.allowed ? null : 'ویرایش تنظیمات به مجوز اقدام‌های حسابداری نیاز دارد.',
        },
      },
    } });
  } catch (error) {
    console.error('Accounting settings error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.put(
  '/settings',
  accountingEdit,
  [
    body('defaultVatRate').optional().isNumeric(),
    body('defaultInvoiceDueDays').optional().isInt({ min: 0 }),
    body('nextInvoiceSequence').optional().isInt({ min: 1 })
  ],
  async (req: AuthRequest, res: Response) => {
    if (handleValidation(req, res)) return;

    try {
      const data = await updateAccountingSettings(req.body, {
        userId: req.user!.id,
        role: req.user!.role
      });
      res.json({ success: true, data });
    } catch (error) {
      console.error('Update accounting settings error:', error);
      res.status(500).json({ success: false, error: 'Server error' });
    }
  }
);

export const createAccountingActionHandler = (
  executeAction: typeof executeAccountingAction = executeAccountingAction,
) => async (req: WorkspaceRequest & FeatureRequest, res: Response) => {
    if (handleValidation(req, res)) return;

  try {
      if (req.body.kind === 'REQUEST_CORRECTION') {
        console.warn('Rejected retired Accounting correction command.', {
          code: 'DUTY_LEGACY_ACCOUNTING_CORRECTION_WRITER_RETIRED',
          actorId: req.user!.id,
        });
        return res.status(410).json({
          success: false,
          message: 'درخواست اصلاح را از دکمه «درخواست اصلاح» در پرونده حسابداری قرارداد دوباره ثبت کنید.',
        });
      }
      if (
        managerReviewActions.has(req.body.kind) &&
        req.user!.role !== 'ADMIN' &&
        (req as any).workspacePermission !== WORKSPACE_PERMISSIONS.ADMIN
      ) {
        return res.status(403).json({
          success: false,
          error: 'برای انجام این بررسی، دسترسی مدیر فضای حسابداری لازم است.'
        });
      }

      const result = await executeAction({
        ...req.body,
        ...readAccountingActionIdentities(req),
      }, {
        userId: req.user!.id,
        role: req.user!.role,
        effectiveAuthority: { actorRole: req.user!.role, workspace: req.workspace, workspacePermission: req.workspacePermission,
          feature: accountingActionFeature[String(req.body.kind)]?.[0] || FEATURES.ACCOUNTING_ACTIONS_MANAGE,
          featurePermission: req.featurePermission },
      }, async (tx, notification) => {
        const correctionRequired = notification.kind === 'APPROVE_CORRECTION_FOR_SALES_EDIT';
        await publishNotificationEvent(tx, {
          type: correctionRequired ? 'ACCOUNTING_CORRECTION_REQUIRED' : 'ACCOUNTING_RECORD_SUBMITTED',
          deduplicationKey: correctionRequired
            ? `accounting-correction-required:${notification.contractId}:${notification.recordIdentity}`
            : `accounting-record:${notification.kind}:${notification.contractId}:${notification.recordIdentity}`,
          recipientIds: notification.recipientIds,
          actorId: req.user!.id,
          workspace: WORKSPACES.SALES,
          feature: correctionRequired ? FEATURES.SALES_CONTRACTS_EDIT : FEATURES.SALES_CONTRACTS_VIEW,
          resourceType: 'sales-contract',
          resourceId: notification.contractId,
          referenceId: notification.contractNumber,
          actionUrl: correctionRequired
            ? `/dashboard/sales/contracts/${notification.contractId}/edit`
            : `/dashboard/sales/contracts/${notification.contractId}`,
          payload: correctionRequired
            ? { contractNumber: notification.contractNumber }
            : { contractNumber: notification.contractNumber, actorName: req.user!.username },
        });
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Accounting action error:', error);
      if (error instanceof PartnerAccountingCommandError) return res.status(error.status).json({
        success: false, code: error.code, error: error.message, message: error.message, actionUrl: error.actionUrl,
      });
      if (error instanceof PartnerAccountingTechnicalError) {
        const trackingId = `ACC-${Date.now().toString(36).toUpperCase()}`;
        console.error('Partner Accounting technical failure:', { trackingId, diagnostic: error.diagnostic });
        return res.status(500).json({ success: false, error: error.message, trackingId });
      }
      if (error instanceof FinancialEvidenceConflictError && (req.body.invoiceId || req.body.recordId)) {
        const reviewCase = await recordFinancialEvidenceReviewCase({
          invoiceId: req.body.invoiceId || req.body.recordId,
          actorId: req.user!.id,
          conflict: error,
        });
        return res.status(409).json({
          success: false,
          code: error.code,
          error: reviewCase
            ? `تأیید مالی متوقف شد. ${error.userMessageFa} پرونده بررسی ایجاد شد.`
            : error.message,
          reviewCase,
          actionUrl: reviewCase?.actionUrl,
        });
      }
      const trackingId = `ACC-${Date.now().toString(36).toUpperCase()}`;
      console.error('Accounting action rejected:', { trackingId, error });
      res.status(error.message === 'DUTY_LEGACY_ACCOUNTING_CORRECTION_WRITER_RETIRED' ? 410 : 400).json({
        success: false,
        message: error.message === 'DUTY_LEGACY_ACCOUNTING_CORRECTION_WRITER_RETIRED'
          ? 'این عملیات از مسیر جدید درخواست اصلاح حسابداری انجام می‌شود.'
          : `اقدام حسابداری انجام نشد. کد پیگیری ${trackingId} را به پشتیبانی اعلام کنید.`,
        trackingId,
      });
    }
  };

const authorizeAccountingAction = async (req: WorkspaceRequest & FeatureRequest, res: Response, next: express.NextFunction) => {
  if (req.body.kind === 'REQUEST_CORRECTION') return next();
  const features = accountingActionFeature[String(req.body.kind)] || [];
  if (features.length === 0) return res.status(400).json({
    success: false,
    message: 'اقدام درخواست‌شده در سامانه حسابداری تعریف نشده است. پشتیبان سامانه باید مسیر اقدام را بررسی کند.',
  });
  const decisions = await Promise.all(features.map((feature) => resolveNarrowFeatureAccess(prisma, {
    userId: req.user!.id,
    role: req.user!.role,
    workspace: WORKSPACES.ACCOUNTING,
    feature,
    requiredPermission: FEATURE_PERMISSIONS.EDIT,
  })));
  const grantedIndex = decisions.findIndex(({ allowed }) => allowed);
  if (grantedIndex < 0) return res.status(403).json({
    success: false,
    message: 'این اقدام متوقف شد چون مجوز اقدام حسابداری فعال نیست. مدیر حسابداری باید مجوز مرتبط را بررسی کند.',
  });
  req.featurePermission = decisions[grantedIndex].permissionLevel!;
  return next();
};

router.post(
  '/actions',
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.EDIT),
  authorizeAccountingAction,
  [
    body('kind').isString().notEmpty(),
    body('contractId').optional().isString(),
    body('recordId').optional().isString(),
    body('invoiceId').optional().isString(),
    body('receivableId').optional().isString(),
    body('paymentEventId').optional().isString(),
    body('correctionRequestId').optional().isString(),
    body('flagId').optional().isString(),
    body('reviewCaseId').optional().isString(),
    body('replacesRecordId').optional().isString(),
    body('externalReference').optional().isString(),
    body('downstreamNote').optional().isString(),
    body('note').optional().isString(),
    body('resolutionNote').optional().isString(),
    body('reason').optional().isString(),
    body('systemInvoiceNumber').optional().isString(),
    body('systemInvoiceDate').optional().isString(),
    body('sepidarAmount').optional().isNumeric()
  ],
  createAccountingActionHandler(),
);

export default router;
