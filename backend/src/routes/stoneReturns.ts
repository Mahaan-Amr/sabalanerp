import { Prisma } from '@prisma/client';
import express, { type RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, getUserFeatures, requireFeatureAccess, type FeatureRequest } from '../middleware/feature';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES, type WorkspaceRequest } from '../middleware/workspace';
import { AccountingCustomerTreasuryError } from '../services/accountingCustomerTreasury';
import { AccountingLedgerError, accountingAccessProfileFromPermission } from '../services/accountingLedgerFoundation';
import { ShipmentReturnConflictError } from '../services/shipmentExcessReturns';
import { finalizeStoneReturn, readStoneReturnPostingContext } from '../services/stoneReturnFinalization';
import { SupplyChainAccountingError } from '../services/accountingSupplyChain';
import {
  listStoneReturnReceipts, recordStoneReturnReceipt, searchStoneReturnCustomers,
  searchStoneReturnProducts, searchStoneReturnGuardMovements, StoneReturnIntakeRejected, StoneReturnReceiptError,
} from '../services/stoneReturnReceipts';

import { listStoneReturnAllocationReviews, readStoneReturnAllocationReview, saveStoneReturnAllocationDraft } from '../services/stoneReturnAllocationDraft';
import { ProjectReturnReceiptError } from '../services/projectReturnReceipts';
import { StoneReturnAllocationError } from '../services/stoneReturnAllocationRules';

export function stoneReturnEndpoint(action: (req: AuthRequest & FeatureRequest & WorkspaceRequest) => Promise<unknown>, created = false): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const data = await action(req);
      res.status(created && !(data as { replayed?: boolean }).replayed ? 201 : 200).json({ success: true, data });
    } catch (error) {
      if (error instanceof ShipmentReturnConflictError) {
        res.status(409).json({ success: false, error: error.message });
        return;
      }
      if (error instanceof ProjectReturnReceiptError || error instanceof StoneReturnReceiptError || error instanceof StoneReturnAllocationError || error instanceof SupplyChainAccountingError
        || error instanceof AccountingCustomerTreasuryError || error instanceof AccountingLedgerError) {
        res.status(error.status).json({ success: false, error: error.message, ...(error instanceof StoneReturnIntakeRejected
          ? { code: 'STONE_RETURN_INTAKE_REJECTED', requestId: error.requestId } : {}) });
        return;
      }
      console.error('Stone return request failed:', error);
      res.status(500).json({ success: false, error: 'انجام عملیات مرجوعی ناموفق بود. دوباره تلاش کنید.' });
    }
  };
}

const queryText = (value: unknown, max: number) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max) {
    throw new StoneReturnReceiptError(400, 'عبارت جست‌وجو معتبر نیست.');
  }
  return value.trim();
};

export const accountingStoneReturnsView = [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.ACCOUNTING_STONE_RETURNS, FEATURE_PERMISSIONS.VIEW),
];

export const accountingStoneReturnsEdit = [
  protect,
  requireWorkspaceAccess(WORKSPACES.ACCOUNTING, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.ACCOUNTING_STONE_RETURNS, FEATURE_PERMISSIONS.EDIT),
];

const stoneReturnPostingAccess = [
  ...accountingStoneReturnsEdit,
  requireFeatureAccess(FEATURES.ACCOUNTING_CUSTOMER_POSTING_MANAGE, FEATURE_PERMISSIONS.EDIT),
];

export const hasStoneReturnEditAccess = (req: FeatureRequest & WorkspaceRequest) =>
  [req.workspacePermission, req.featurePermission].every(level => level === 'edit' || level === 'admin');

async function canFinalizeStoneReturn(req: AuthRequest & FeatureRequest & WorkspaceRequest) {
  if (!req.user || !hasStoneReturnEditAccess(req)) return false;
  const features = await getUserFeatures(req.user.id, req.user.role);
  return features.some(({ feature, permission }) => feature === FEATURES.ACCOUNTING_CUSTOMER_POSTING_MANAGE
    && (permission === FEATURE_PERMISSIONS.EDIT || permission === FEATURE_PERMISSIONS.ADMIN));
}

const logisticsView = [
  protect,
  requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.LOGISTICS_STONE_RETURNS, FEATURE_PERMISSIONS.VIEW),
];
const logisticsEdit = [
  protect,
  requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.LOGISTICS_STONE_RETURNS, FEATURE_PERMISSIONS.EDIT),
];

export const accountingStoneReturnsRouter = express.Router();
accountingStoneReturnsRouter.get('/', ...accountingStoneReturnsView, stoneReturnEndpoint(req =>
  listStoneReturnAllocationReviews(prisma, queryText(req.query.after, 100))));
accountingStoneReturnsRouter.get('/:id', ...accountingStoneReturnsView, stoneReturnEndpoint(async req => ({
  ...await prisma.$transaction(tx => readStoneReturnAllocationReview(tx, req.params.id), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  }),
  canAllocate: hasStoneReturnEditAccess(req),
  canFinalize: await canFinalizeStoneReturn(req),
})));
accountingStoneReturnsRouter.put('/:id/allocations', ...accountingStoneReturnsEdit, stoneReturnEndpoint(async req => ({
  ...await saveStoneReturnAllocationDraft(prisma, req.params.id, req.user!.id, req.body),
  canAllocate: true,
  canFinalize: await canFinalizeStoneReturn(req),
})));

accountingStoneReturnsRouter.get('/:id/posting-context', ...stoneReturnPostingAccess, stoneReturnEndpoint(req =>
  readStoneReturnPostingContext(prisma, req.params.id, req.query.date)));
accountingStoneReturnsRouter.post('/:id/finalize', ...stoneReturnPostingAccess, stoneReturnEndpoint(req =>
  finalizeStoneReturn(prisma, req.params.id, {
    id: req.user!.id,
    profile: req.featurePermission === FEATURE_PERMISSIONS.ADMIN ? 'ACCOUNTING_MANAGER' : accountingAccessProfileFromPermission(req.workspacePermission),
    isGlobalAdmin: req.user?.role === 'ADMIN',
  }, req.body), true));

export const logisticsStoneReturnsRouter = express.Router();
logisticsStoneReturnsRouter.get('/', ...logisticsView, stoneReturnEndpoint(async req => ({
  ...await listStoneReturnReceipts(prisma, queryText(req.query.after, 100)),
  canRecord: hasStoneReturnEditAccess(req),
})));
logisticsStoneReturnsRouter.get('/customers', ...logisticsEdit, stoneReturnEndpoint(req => searchStoneReturnCustomers(prisma, queryText(req.query.search, 120))));
logisticsStoneReturnsRouter.get('/products', ...logisticsEdit, stoneReturnEndpoint(req => searchStoneReturnProducts(prisma, queryText(req.query.search, 120))));
logisticsStoneReturnsRouter.get('/guard-movements', ...logisticsEdit, stoneReturnEndpoint(req => searchStoneReturnGuardMovements(prisma,
  queryText(req.query.customerId, 100), queryText(req.query.search, 120))));
logisticsStoneReturnsRouter.post('/', ...logisticsEdit, stoneReturnEndpoint(req => recordStoneReturnReceipt(prisma, req.user!.id, req.body ?? {}), true));
