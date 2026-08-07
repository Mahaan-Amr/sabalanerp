import express, { NextFunction, RequestHandler, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, type AuthRequest } from '../middleware/auth';
import { FEATURES } from '../middleware/feature';
import { readShipmentQuantityProjection, rebuildShipmentQuantityProjection } from '../services/shipmentQuantityProjectionStore';

const VIEW_FEATURES = [
  { workspace: 'sales', feature: FEATURES.SALES_CONTRACTS_VIEW },
  { workspace: 'crm', feature: FEATURES.CRM_CUSTOMERS_VIEW },
  { workspace: 'logistics', feature: FEATURES.LOGISTICS_LOADINGS_VIEW },
  { workspace: 'accounting', feature: FEATURES.ACCOUNTING_CONTRACTS_VIEW },
];

type ProjectionReader = typeof readShipmentQuantityProjection;
type ProjectionRebuilder = typeof rebuildShipmentQuantityProjection;

export const shipmentViewAuthorization = (prisma: PrismaClient): RequestHandler => async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (req.user.role === 'ADMIN') return next();
  const now = new Date();
  const workspaces = VIEW_FEATURES.map((scope) => scope.workspace);
  const features = VIEW_FEATURES.map((scope) => scope.feature);
  const [userWorkspaces, roleWorkspaces, userFeatures, roleFeatures] = await Promise.all([
    prisma.workspacePermission.findMany({ where: { userId: req.user.id, workspace: { in: workspaces }, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    prisma.roleWorkspacePermission.findMany({ where: { role: req.user.role, workspace: { in: workspaces }, isActive: true } }),
    prisma.featurePermission.findMany({ where: { userId: req.user.id, feature: { in: features }, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } }),
    prisma.roleFeaturePermission.findMany({ where: { role: req.user.role, feature: { in: features }, isActive: true } }),
  ]);
  const rank = (value?: string | null) => ['view', 'edit', 'admin'].indexOf(value || '');
  const allowed = VIEW_FEATURES.some((scope) => {
    const workspace = userWorkspaces.find((item) => item.workspace === scope.workspace)
      || roleWorkspaces.find((item) => item.workspace === scope.workspace);
    const feature = userFeatures.find((item) => item.workspace === scope.workspace && item.feature === scope.feature)
      || roleFeatures.find((item) => item.workspace === scope.workspace && item.feature === scope.feature);
    return rank(workspace?.permissionLevel) >= 0 && rank(feature?.permissionLevel) >= 0;
  });
  if (allowed) return next();
  return res.status(403).json({ success: false, error: 'Shipment quantity view is not available' });
};

const historicalOptions = (req: express.Request) => {
  const mode = req.query.mode === 'audit-known-at' ? 'AUDIT_KNOWN_AT' as const : 'OPERATIONAL_AS_OF' as const;
  if (!req.query.cutoff) return { mode };
  const cutoff = new Date(String(req.query.cutoff));
  if (Number.isNaN(cutoff.getTime())) throw new Error('INVALID_CUTOFF');
  return { mode, cutoff: cutoff.toISOString() };
};

export const createShipmentQuantityRouter = ({
  prisma,
  authenticate = protect,
  authorizeView = shipmentViewAuthorization(prisma),
  readProjection = readShipmentQuantityProjection,
  rebuildProjection = rebuildShipmentQuantityProjection,
}: {
  prisma: PrismaClient;
  authenticate?: RequestHandler;
  authorizeView?: RequestHandler;
  readProjection?: ProjectionReader;
  rebuildProjection?: ProjectionRebuilder;
}) => {
  const router = express.Router();
  router.use(authenticate, authorizeView);

  const read = (scope: (req: express.Request) => { contractId?: string; customerId?: string }) => async (req: express.Request, res: Response) => {
    try {
      const data = await readProjection(prisma, scope(req), historicalOptions(req));
      return res.json({ success: true, data });
    } catch (error) {
      if (error instanceof Error && error.message === 'INVALID_CUTOFF') return res.status(400).json({ success: false, error: 'Invalid historical cutoff' });
      console.error('Shipment quantity projection read failed:', error);
      return res.status(500).json({ success: false, error: 'Shipment quantity projection is unavailable' });
    }
  };

  router.get('/contracts/:contractId', read((req) => ({ contractId: req.params.contractId })));
  router.get('/customers/:customerId', read((req) => ({ customerId: req.params.customerId })));
  router.post('/rebuild', async (req: AuthRequest, res: Response) => {
    if (req.user?.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'Administrator access required' });
    const contractId = typeof req.body?.contractId === 'string' ? req.body.contractId : undefined;
    const customerId = typeof req.body?.customerId === 'string' ? req.body.customerId : undefined;
    if (!contractId && !customerId) return res.status(400).json({ success: false, error: 'A contract or customer scope is required' });
    try {
      const data = await rebuildProjection(prisma, { contractId, customerId });
      return res.json({ success: true, data });
    } catch (error) {
      console.error('Shipment quantity projection rebuild failed:', error);
      return res.status(500).json({ success: false, error: 'Shipment quantity projection rebuild failed' });
    }
  });
  return router;
};

export default createShipmentQuantityRouter({ prisma: new PrismaClient() });
