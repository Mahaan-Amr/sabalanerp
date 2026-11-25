import express, { type Request, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { Prisma } from '@prisma/client';
import { protect } from '../middleware/auth';
import { FEATURES, FEATURE_PERMISSIONS, requireFeatureAccess, type FeatureRequest } from '../middleware/feature';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS, type WorkspaceRequest } from '../middleware/workspace';
import { GuardQueueConflictError, GuardQueueValidationError } from '../services/guardDriverQueue';
import { submitProjectReturnCorrection } from '../services/projectReturnCorrections';
import { changeProjectReturnOperation, readProjectReturnOperationalDetails } from '../services/projectReturnOperations';
import { SupplyChainAccountingError } from '../services/accountingSupplyChain';
import { searchStoneReturnCustomers } from '../services/stoneReturnReceipts';
import {
  listProjectReturnProjects, listProjectReturnReceipts, projectReturnId, projectReturnProjectIds, ProjectReturnReceiptError,
  projectReturnCustomerScope, readProjectReturnReceipt, searchProjectReturnPartnerContracts, searchProjectReturnProducts, submitProjectReturnReceipt,
} from '../services/projectReturnReceipts';

const router = express.Router();
const view = [
  requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.LOGISTICS_STONE_RETURNS, FEATURE_PERMISSIONS.VIEW),
];
const edit = [
  requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.LOGISTICS_STONE_RETURNS, FEATURE_PERMISSIONS.EDIT),
];

router.use(protect, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

function fail(res: Response, error: unknown) {
  if (error instanceof ProjectReturnReceiptError || error instanceof SupplyChainAccountingError) return res.status(error.status).json({ success: false, error: error.message });
  if (error instanceof GuardQueueValidationError) return res.status(400).json({ success: false, error: error.message });
  if (error instanceof GuardQueueConflictError) return res.status(409).json({ success: false, error: error.message });
  console.error('Logistics project return receipt command failed:', error);
  return res.status(500).json({ success: false, error: 'انجام عملیات رسید مرجوعی ناموفق بود.' });
}

function read(handler: (req: Request) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try {
      return res.json({ success: true, data: await handler(req) });
    } catch (error) {
      return fail(res, error);
    }
  };
}

function searchText(value: unknown) {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > 100) throw new ProjectReturnReceiptError(400, 'عبارت جست‌وجو معتبر نیست.');
  return value.trim();
}

router.get('/', ...view, read(req => listProjectReturnReceipts(prisma,
  req.query.after === undefined ? undefined : projectReturnId(req.query.after, 'صفحه'), 'latest')));
router.get('/customers', ...edit, read(req => searchStoneReturnCustomers(prisma, searchText(req.query.search), projectReturnCustomerScope)));
router.get('/customers/:customerId/projects', ...edit, read(req => listProjectReturnProjects(prisma, req.params.customerId)));
router.get('/partner-contracts', ...edit, read(req => searchProjectReturnPartnerContracts(prisma,
  projectReturnId(req.query.customerId, 'مشتری'),
  projectReturnProjectIds(typeof req.query.projectId === 'string' ? [req.query.projectId] : req.query.projectId),
  searchText(req.query.search))));
router.get('/products', ...edit, read(req => searchProjectReturnProducts(prisma,
  projectReturnId(req.query.customerId, 'مشتری'),
  projectReturnProjectIds(typeof req.query.projectId === 'string' ? [req.query.projectId] : req.query.projectId),
  searchText(req.query.search), req.query.partnerContractId === undefined
    ? undefined : projectReturnId(req.query.partnerContractId, 'قرارداد فروش همکار'))));
router.get('/:id', ...view, read(async (req: Request & FeatureRequest & WorkspaceRequest) => {
  const receipt = await prisma.$transaction(tx => readProjectReturnOperationalDetails(tx, req.params.id), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000,
  });
  const canEdit = [req.featurePermission, req.workspacePermission].every(permission => permission === 'edit' || permission === 'admin');
  return { ...receipt, canManage: canEdit && !!receipt.visit,
    canSubmitCorrection: canEdit && !!receipt.legacyFinalizationId && !!receipt.version.assignedAt };
}));
router.post('/:id/correction/submit', ...edit, read(req =>
  submitProjectReturnCorrection(prisma, req.params.id, (req as WorkspaceRequest).user!.id, req.body ?? {})));
router.get('/:id/versions/:versionId', ...view, read(async req => {
  const receipt = await readProjectReturnReceipt(prisma, req.params.id, { id: req.params.versionId });
  if (!receipt.visit) throw new ProjectReturnReceiptError(404, 'رسید لجستیک پیدا نشد.');
  return receipt;
}));
for (const action of ['edit', 'cancel', 'request-rework'] as const) {
  router.post(`/:id/${action}`, ...edit, read(async (req: WorkspaceRequest) => ({
    ...await changeProjectReturnOperation(prisma, req.params.id, req.user!.id, action, req.body ?? {}),
    canManage: true,
  })));
}
router.post('/', ...edit, async (req: WorkspaceRequest, res) => {
  try {
    const { receipt, replayed } = await submitProjectReturnReceipt(prisma, req.user!.id, req.body ?? {});
    return res.status(replayed ? 200 : 201).json({ success: true, data: receipt, replayed });
  } catch (error) {
    return fail(res, error);
  }
});

export default router;
