import express, { Response } from 'express';
import path from 'path';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
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
  getAccountingSettings,
  getAccountingContractDetail,
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

const router = express.Router();
const prisma = new PrismaClient();
const ACCOUNTING_PDF_DIR = path.join(process.cwd(), 'storage', 'accounting-contracts');

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

type SalesContractPdfVariant = 'original' | 'accounting' | 'workshop';

const salesContractPdfVariantFromQuery = (value: unknown): SalesContractPdfVariant => {
  if (value === 'accounting' || value === 'workshop') return value;
  return 'original';
};

const salesContractPdfCacheKey = (variant: SalesContractPdfVariant): string => {
  if (variant === 'accounting') return 'accountingSalesPdfAccounting';
  if (variant === 'workshop') return 'accountingSalesPdfWorkshop';
  return 'print';
};

const salesContractPdfDownloadName = (contract: any, variant: SalesContractPdfVariant): string => {
  const baseName = buildSalesContractPdfDownloadName(contract);
  if (variant === 'accounting') return baseName.replace(/\.pdf$/i, '_accounting.pdf');
  if (variant === 'workshop') return baseName.replace(/\.pdf$/i, '_workshop.pdf');
  return baseName;
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

router.get('/workspace', accountingView, async (_req: AuthRequest, res: Response) => {
  try {
    const workspace = await getAccountingWorkspace();
    res.json({ success: true, data: workspace });
  } catch (error) {
    console.error('Accounting workspace error:', error);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

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
    const fresh = String(req.query.fresh || 'false').toLowerCase() === 'true';
    const shouldDownload = String(req.query.download || 'false').toLowerCase() === 'true';
    const currentSignatures = (contract.signatures as any) || {};
    const printableContract = variant === 'original' && contract.status === 'SIGNED'
      ? { ...contract, status: 'PRINTED' }
      : contract;
    const pdfFingerprint = buildSalesContractPdfFingerprint(printableContract, variant);
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

    const pdfPath = await generateSalesContractPdf(printableContract, variant);
    const generatedAt = new Date().toISOString();

    if (variant === 'original') {
      await markOriginalSalesContractPrinted(req, contract, currentSignatures, pdfPath, pdfFingerprint, generatedAt);
    } else {
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

router.get('/audit', accountingView, async (req: AuthRequest, res: Response) => {
  try {
    const data = await listAuditLogs(req.query);
    res.json({ success: true, data });
  } catch (error) {
    console.error('Accounting audit error:', error);
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
    body('note').optional().isString(),
    body('resolutionNote').optional().isString(),
    body('systemInvoiceNumber').optional().isString(),
    body('systemInvoiceDate').optional().isString(),
    body('sepidarAmount').optional().isNumeric()
  ],
  async (req: AuthRequest, res: Response) => {
    if (handleValidation(req, res)) return;

    try {
      const result = await executeAccountingAction(req.body, {
        userId: req.user!.id,
        role: req.user!.role
      });
      res.json({ success: true, data: result });
    } catch (error: any) {
      console.error('Accounting action error:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Accounting action failed'
      });
    }
  }
);

export default router;
