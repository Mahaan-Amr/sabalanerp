import express, { Response } from 'express';
import bcrypt from 'bcryptjs';
import { ShipmentStatementOperationsAction } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AuthRequest, authorize, protect } from '../middleware/auth';
import {
  getShipmentStatementOperations,
  ShipmentStatementOperationsError,
  transitionShipmentStatementOperations,
} from '../services/shipmentStatementOperations';

const router = express.Router();
router.use(protect, authorize('ADMIN'));

const respondError = (res: Response, error: unknown) => {
  if (error instanceof ShipmentStatementOperationsError) {
    return res.status(error.status).json({ success: false, error: error.code, message: error.message });
  }
  console.error('Shipment statement operations failure:', error);
  return res.status(500).json({ success: false, error: 'SHIPMENT_STATEMENT_OPERATIONS_FAILED' });
};

const verifyAdminPassword = async (req: AuthRequest) => {
  const password = String(req.body?.adminPassword || '');
  const user = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { password: true } });
  if (!user || !password || !await bcrypt.compare(password, user.password)) {
    throw new ShipmentStatementOperationsError('ADMIN_PASSWORD_INCORRECT', 'Current administrator password is incorrect.', 403);
  }
};

router.get('/', async (_req, res) => {
  try {
    res.json({ success: true, data: await getShipmentStatementOperations(prisma) });
  } catch (error) {
    respondError(res, error);
  }
});

router.post('/transitions', async (req: AuthRequest, res) => {
  try {
    await verifyAdminPassword(req);
    const action = String(req.body?.action || '') as ShipmentStatementOperationsAction;
    if (!Object.values(ShipmentStatementOperationsAction).includes(action)) {
      throw new ShipmentStatementOperationsError('INVALID_ACTION', 'Unsupported shipment statement operation.', 400);
    }
    const expectedRevision = Number(req.body?.expectedRevision);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
      throw new ShipmentStatementOperationsError('INVALID_REVISION', 'A valid control revision is required.', 400);
    }
    const result = await transitionShipmentStatementOperations(prisma, {
      action,
      actorId: req.user!.id,
      reason: String(req.body?.reason || ''),
      expectedRevision,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    respondError(res, error);
  }
});

export default router;
