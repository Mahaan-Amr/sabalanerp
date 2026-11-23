import express, { type RequestHandler } from 'express';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess, type FeatureRequest } from '../middleware/feature';
import { requireWorkspaceAccess, WORKSPACE_PERMISSIONS, WORKSPACES, type WorkspaceRequest } from '../middleware/workspace';
import { SupplyChainAccountingError } from '../services/accountingSupplyChain';
import {
  listStoneReturnReceipts, readStoneReturnReceipt, recordStoneReturnReceipt, searchStoneReturnCustomers,
  searchStoneReturnProducts, searchStoneReturnGuardMovements, StoneReturnReceiptError,
} from '../services/stoneReturnReceipts';

export function stoneReturnEndpoint(action: (req: AuthRequest & FeatureRequest & WorkspaceRequest) => Promise<unknown>, created = false): RequestHandler {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const data = await action(req);
      res.status(created && !(data as { replayed?: boolean }).replayed ? 201 : 200).json({ success: true, data });
    } catch (error) {
      if (error instanceof StoneReturnReceiptError || error instanceof SupplyChainAccountingError) {
        res.status(error.status).json({ success: false, error: error.message });
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

const list = stoneReturnEndpoint(req => listStoneReturnReceipts(prisma, queryText(req.query.after, 100)));
export const accountingStoneReturnsRouter = express.Router();
accountingStoneReturnsRouter.get('/', ...accountingStoneReturnsView, list);
accountingStoneReturnsRouter.get('/:id', ...accountingStoneReturnsView, stoneReturnEndpoint(req => readStoneReturnReceipt(prisma, req.params.id)));

export const logisticsStoneReturnsRouter = express.Router();
logisticsStoneReturnsRouter.get('/', ...logisticsView, stoneReturnEndpoint(async req => ({
  ...await listStoneReturnReceipts(prisma, queryText(req.query.after, 100)),
  canRecord: [req.workspacePermission, req.featurePermission].every(level => level === 'edit' || level === 'admin'),
})));
logisticsStoneReturnsRouter.get('/customers', ...logisticsEdit, stoneReturnEndpoint(req => searchStoneReturnCustomers(prisma, queryText(req.query.search, 120))));
logisticsStoneReturnsRouter.get('/products', ...logisticsEdit, stoneReturnEndpoint(req => searchStoneReturnProducts(prisma, queryText(req.query.search, 120))));
logisticsStoneReturnsRouter.get('/guard-movements', ...logisticsEdit, stoneReturnEndpoint(req => searchStoneReturnGuardMovements(prisma,
  queryText(req.query.customerId, 100), queryText(req.query.search, 120))));
logisticsStoneReturnsRouter.post('/', ...logisticsEdit, stoneReturnEndpoint(req => recordStoneReturnReceipt(prisma, req.user!.id, req.body ?? {}), true));
