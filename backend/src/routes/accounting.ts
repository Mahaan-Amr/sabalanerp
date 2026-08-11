import express, { Request, Response } from 'express';
import path from 'path';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess, WorkspaceRequest, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { FeatureRequest, FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess, requireNarrowFeatureAccess } from '../middleware/feature';
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
import { PrismaClient } from '@prisma/client';
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
  updateAccountingSettings
} from '../services/accountingService';
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

const router = express.Router();
const prisma = new PrismaClient();
const ACCOUNTING_PDF_DIR = path.join(process.cwd(), 'storage', 'accounting-contracts');

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
  'RESOLVE_CORRECTION'
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
    const manage = await resolveNarrowFeatureAccess(prisma, { userId: req.user!.id, role: req.user!.role,
      workspace: WORKSPACES.ACCOUNTING, feature: FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_MANAGE,
      requiredPermission: FEATURE_PERMISSIONS.EDIT });
    const candidates = await prisma.accountingDispatchCandidate.findMany({
      include: { workItem: true, allocationRevision: { include: { lines: true, queueTurn: true } }, waybills: { orderBy: { issuedAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
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

export const getAccountingWorkspaceResponse = async (req: AuthRequest, res: Response) => {
  try {
    const workspace = await getAccountingWorkspace(req.query);
    res.json({ success: true, data: workspace });
  } catch (error) {
    console.error('Accounting workspace error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

router.get('/workspace', accountingView, getAccountingWorkspaceResponse);

export const createAccountingFinancialTrendResponse = (
  loadTrend: typeof getAccountingFinancialTrend = getAccountingFinancialTrend,
) => async (req: AuthRequest, res: Response) => {
  try {
    const trend = await loadTrend(req.query.range);
    res.json({ success: true, data: trend });
  } catch (error) {
    console.error('Accounting financial trend error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
};

router.get('/financial-trend', accountingView, createAccountingFinancialTrendResponse());

router.get('/contracts', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listAccountingContracts(req.query as any);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting contracts error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/contracts/:contractId', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await getAccountingContractDetail(req.params.contractId);
    res.json({ success: true, data });
  } catch (error: any) {
    console.error('Accounting contract detail error:', error);
    res.status(error.message === 'Contract not found' ? 404 : 500).json({
      success: false,
      error: error.message === 'Contract not found' ? 'Contract not found' : 'Server error'
    });
  }
});

router.get('/contracts/:contractId/pdf', accountingView, async (req: AuthRequest, res: Response) => {
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

router.get('/contracts/:contractId/sales-pdf', accountingView, async (req: AuthRequest, res: Response) => {
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

router.get('/financial-records', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listFinancialRecords(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting records error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/receivables', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listReceivables(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting receivables error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/payments', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listPaymentStatuses(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting payments error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/tax', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listTaxRecords(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting tax error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/correction-requests', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listCorrectionRequests(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting correction requests error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/audit/dispatch-documents/recovery', accountingRecoveryEvidenceView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listDispatchDocumentRecoveryAudit(prisma, req.query as Record<string, string>);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Dispatch document recovery audit error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/audit', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listAuditLogs(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting audit error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/performance', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await getAccountantPerformanceReport(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting performance error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

router.get('/settings', accountingView, async (_req: AuthRequest, res: Response) => {
  try {
    const data = await getAccountingSettings();
    res.json({ success: true, data });
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
      if (
        managerReviewActions.has(req.body.kind) &&
        req.user!.role !== 'ADMIN' &&
        (req as any).workspacePermission !== WORKSPACE_PERMISSIONS.ADMIN
      ) {
        return res.status(403).json({
          success: false,
          error: 'Accounting admin permission is required for correction review'
        });
      }

      const result = await executeAction({
        ...req.body,
        ...readAccountingActionIdentities(req),
      }, {
        userId: req.user!.id,
        role: req.user!.role,
        effectiveAuthority: { actorRole: req.user!.role, workspace: req.workspace, workspacePermission: req.workspacePermission,
          feature: FEATURES.ACCOUNTING_ACTIONS_MANAGE, featurePermission: req.featurePermission },
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
      res.status(400).json({
        success: false,
        error: error.message || 'Accounting action failed'
      });
    }
  };

router.post(
  '/actions',
  accountingEdit,
  [
    body('kind').isString().notEmpty(),
    body('contractId').optional().isString(),
    body('recordId').optional().isString(),
    body('invoiceId').optional().isString(),
    body('receivableId').optional().isString(),
    body('paymentEventId').optional().isString(),
    body('correctionRequestId').optional().isString(),
    body('flagId').optional().isString(),
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
