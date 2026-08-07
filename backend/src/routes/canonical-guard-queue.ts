import express from 'express';
import { GuardDriverSource, PrismaClient } from '@prisma/client';
import { AuthRequest, protect } from '../middleware/auth';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { admitGuardDriverQueueTurn, closeGuardQueueTurnWithoutLoading, GuardQueueConflictError, GuardQueueValidationError, listGuardQueueAdmissionOptions, makeGuardQueueTurnAvailable, returnGuardQueueTurnToWaiting, voidGuardQueueTurn } from '../services/guardDriverQueue';

const router = express.Router();
const prisma = new PrismaClient();
const guardView = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW);
const guardEdit = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT);
const responseTurn = (turn: any) => ({
  ...turn,
  driverId: turn.internalDriverId || turn.externalDriverId,
  vehicleId: turn.companyVehicleId || turn.externalVehicleId,
});
const fail = (res: any, error: unknown, context: string) => {
  if (error instanceof GuardQueueConflictError) return res.status(409).json({ success: false, error: error.message });
  if (error instanceof GuardQueueValidationError) return res.status(400).json({ success: false, error: error.message });
  console.error(context, error);
  return res.status(500).json({ success: false, error: 'Canonical Guard queue command failed.' });
};

router.get('/canonical-driver-queue', protect, guardView, async (req: AuthRequest, res) => {
  try {
    const history = req.query.history === 'true';
    const turns = await prisma.guardDriverQueueTurn.findMany({
      where: history ? undefined : { status: { in: ['WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED'] } },
      include: { events: { orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] } },
      orderBy: history ? [{ admittedAt: 'desc' }, { id: 'desc' }] : [{ admittedAt: 'asc' }, { id: 'asc' }],
      take: history ? 250 : undefined,
    });
    return res.json({ success: true, data: turns.map(responseTurn) });
  } catch (error) {
    console.error('Canonical Guard queue list error:', error);
    return res.status(500).json({ success: false, error: 'Canonical Guard queue could not be loaded.' });
  }
});

router.get('/canonical-driver-queue/admission-options', protect, guardView, async (_req: AuthRequest, res) => {
  try {
    return res.json({ success: true, data: await listGuardQueueAdmissionOptions(prisma) });
  } catch (error) {
    console.error('Canonical Guard queue admission options error:', error);
    return res.status(500).json({ success: false, error: 'Admission options could not be loaded.' });
  }
});

router.post('/canonical-driver-queue', protect, guardEdit, async (req: AuthRequest, res) => {
  try {
    const source = String(req.body.source || '') as GuardDriverSource;
    if (!Object.values(GuardDriverSource).includes(source)) return res.status(400).json({ success: false, error: 'A valid driver source is required.' });
    const driverId = String(req.body.driverId || '').trim();
    if (!driverId) return res.status(400).json({ success: false, error: 'driverId is required.' });
    const turn = await admitGuardDriverQueueTurn(prisma, { source, driverId, vehicleId: req.body.vehicleId, actorId: req.user!.id });
    return res.status(201).json({ success: true, data: responseTurn(turn) });
  } catch (error) {
    return fail(res, error, 'Canonical Guard queue admission error:');
  }
});

router.post('/canonical-driver-queue/:id/available', protect, guardEdit, async (req: AuthRequest, res) => {
  try {
    const turn = await makeGuardQueueTurnAvailable(prisma, req.params.id, req.user!.id);
    return res.json({ success: true, data: responseTurn(turn) });
  } catch (error) { return fail(res, error, 'Canonical Guard queue availability error:'); }
});

router.post('/canonical-driver-queue/:id/return-to-waiting', protect, guardEdit, async (req: AuthRequest, res) => {
  try {
    const turn = await returnGuardQueueTurnToWaiting(prisma, { turnId: req.params.id, actorId: req.user!.id, reason: String(req.body.reason || '') });
    return res.json({ success: true, data: responseTurn(turn) });
  } catch (error) { return fail(res, error, 'Canonical Guard queue return-to-waiting error:'); }
});

router.post('/canonical-driver-queue/:id/close-without-loading', protect, guardEdit, async (req: AuthRequest, res) => {
  try {
    const turn = await closeGuardQueueTurnWithoutLoading(prisma, { turnId: req.params.id, actorId: req.user!.id, reason: String(req.body.reason || '') });
    return res.json({ success: true, data: responseTurn(turn) });
  } catch (error) { return fail(res, error, 'Canonical Guard queue close-without-loading error:'); }
});

router.post('/canonical-driver-queue/:id/void', protect, guardEdit, async (req: AuthRequest, res) => {
  try {
    const turn = await voidGuardQueueTurn(prisma, {
      turnId: req.params.id, actorId: req.user!.id, reason: String(req.body.reason || ''),
      replacementTurnId: req.body.replacementTurnId ? String(req.body.replacementTurnId) : undefined,
    });
    return res.json({ success: true, data: responseTurn(turn) });
  } catch (error) { return fail(res, error, 'Canonical Guard queue void error:'); }
});

export default router;
