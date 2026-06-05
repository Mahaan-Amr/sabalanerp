import express, { Response } from 'express';
import { body, validationResult } from 'express-validator';
import { protect, AuthRequest } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES } from '../middleware/workspace';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
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
    body('note').optional().isString(),
    body('systemInvoiceNumber').optional().isString(),
    body('systemInvoiceDate').optional().isString()
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
