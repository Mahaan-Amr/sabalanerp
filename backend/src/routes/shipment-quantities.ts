import express, { NextFunction, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, type AuthRequest } from '../middleware/auth';
import { readShipmentQuantityProjection, rebuildShipmentQuantityProjection } from '../services/shipmentQuantityProjectionStore';

const router = express.Router();
const prisma = new PrismaClient();
const VIEW_WORKSPACES = ['sales', 'crm', 'logistics', 'accounting'];

router.use(protect);

const canViewShipmentTruth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
  if (req.user.role === 'ADMIN' || req.user.role === 'MANAGER') return next();
  const now = new Date();
  const [userPermission, rolePermission] = await Promise.all([
    prisma.workspacePermission.findFirst({
      where: { userId: req.user.id, workspace: { in: VIEW_WORKSPACES }, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    }),
    prisma.roleWorkspacePermission.findFirst({
      where: { role: req.user.role, workspace: { in: VIEW_WORKSPACES }, isActive: true },
    }),
  ]);
  const rank = (value?: string | null) => ['view', 'edit', 'admin'].indexOf(value || '');
  if (rank(userPermission?.permissionLevel) >= 0 || rank(rolePermission?.permissionLevel) >= 0) return next();
  return res.status(403).json({ success: false, error: 'Shipment quantity view is not available' });
};

router.use(canViewShipmentTruth);

const historicalOptions = (req: express.Request) => {
  const mode = req.query.mode === 'audit-known-at' ? 'AUDIT_KNOWN_AT' as const : 'OPERATIONAL_AS_OF' as const;
  if (!req.query.cutoff) return { mode };
  const cutoff = new Date(String(req.query.cutoff));
  if (Number.isNaN(cutoff.getTime())) throw new Error('INVALID_CUTOFF');
  return { mode, cutoff: cutoff.toISOString() };
};

const read = (scope: (req: express.Request) => { contractId?: string; customerId?: string }) => async (req: express.Request, res: Response) => {
  try {
    const data = await readShipmentQuantityProjection(prisma, scope(req), historicalOptions(req));
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
    const data = await rebuildShipmentQuantityProjection(prisma, { contractId, customerId });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Shipment quantity projection rebuild failed:', error);
    return res.status(500).json({ success: false, error: 'Shipment quantity projection rebuild failed' });
  }
});

export default router;
