import express, { RequestHandler, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, type AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireAnyFeatureAccessWithClient } from '../middleware/feature';
import { readShipmentQuantityProjection, rebuildShipmentQuantityProjection } from '../services/shipmentQuantityProjectionStore';

const VIEW_FEATURES = [
  FEATURES.SALES_CONTRACTS_VIEW,
  FEATURES.CRM_CUSTOMERS_VIEW,
  FEATURES.LOGISTICS_LOADINGS_VIEW,
  FEATURES.ACCOUNTING_CONTRACTS_VIEW,
];

type ProjectionReader = typeof readShipmentQuantityProjection;
type ProjectionRebuilder = typeof rebuildShipmentQuantityProjection;

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
  authorizeView = requireAnyFeatureAccessWithClient(prisma, VIEW_FEATURES, FEATURE_PERMISSIONS.VIEW, ['ADMIN', 'MANAGER']),
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
