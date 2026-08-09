import express from 'express';
import { GuardDriverSource, PrismaClient } from '@prisma/client';
import { AuthRequest, protect } from '../middleware/auth';
import { requireWorkspaceAccess, WorkspaceRequest, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { admitGuardDriverQueueTurn, closeGuardQueueTurnWithoutLoading, GuardQueueConflictError, GuardQueueValidationError, listGuardQueueAdmissionOptions, makeGuardQueueTurnAvailable, returnGuardQueueTurnToWaiting, voidGuardQueueTurn } from '../services/guardDriverQueue';
import { PhysicalGateExitConflictError, PhysicalGateExitService, PhysicalGateExitValidationError } from '../services/physicalGateExit';
import { approveManualOutageExit, DispatchRecoveryConflictError, DispatchRecoveryValidationError,
  registerManualOutageExit, reportMissingManualOutagePaper, spoilManualOutageExit, verifyGuardPhysicalReturn } from '../services/dispatchCorrectionOutage';
import { PilotSafetyPauseError } from '../services/dispatchCutover';

const router = express.Router();
const prisma = new PrismaClient();
const physicalExitService = new PhysicalGateExitService(prisma);
const guardView = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW);
const guardEdit = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT);
const responseTurn = (turn: any, redacted = false) => {
  if (!redacted) return { ...turn, driverId: turn.internalDriverId || turn.externalDriverId, vehicleId: turn.companyVehicleId || turn.externalVehicleId };
  const snapshot = turn.admissionSnapshot || {};
  const plate = String(snapshot.plate?.plate || '');
  return {
    id: turn.id, driverSource: turn.driverSource, status: turn.status, admittedAt: turn.admittedAt,
    availableAt: turn.availableAt, reservedAt: turn.reservedAt, finalizedAt: turn.finalizedAt, exitedAt: turn.exitedAt,
    closedAt: turn.closedAt, voidedAt: turn.voidedAt,
    admissionSnapshot: {
      driver: { firstName: '', lastName: 'راننده' },
      vehicle: { vehicleType: snapshot.vehicle?.vehicleType || '' },
      plate: { plate: plate ? `${'*'.repeat(Math.max(0, plate.length - 2))}${plate.slice(-2)}` : '' },
      readiness: { status: snapshot.readiness?.status || 'UNKNOWN' },
    },
    events: Array.isArray(turn.events) ? turn.events.map((event: any) => ({
      id: event.id, eventType: event.eventType, fromStatus: event.fromStatus, toStatus: event.toStatus, recordedAt: event.recordedAt,
    })) : [],
    redacted: true,
  };
};
const fail = (res: any, error: unknown, context: string) => {
  if (error instanceof PilotSafetyPauseError || error instanceof GuardQueueConflictError || error instanceof PhysicalGateExitConflictError || error instanceof DispatchRecoveryConflictError) return res.status(409).json({ success: false, error: error.message });
  if (error instanceof GuardQueueValidationError || error instanceof PhysicalGateExitValidationError || error instanceof DispatchRecoveryValidationError) return res.status(400).json({ success: false, error: error.message });
  console.error(context, error);
  return res.status(500).json({ success: false, error: 'Canonical Guard queue command failed.' });
};
const guardAuthority = (req: WorkspaceRequest) => ({ actorRole: req.user!.role, workspace: req.workspace || WORKSPACES.SECURITY,
  workspacePermission: req.workspacePermission || WORKSPACE_PERMISSIONS.EDIT });

router.get('/exit-desk/authorizations', protect, guardView, async (_req: WorkspaceRequest, res) => {
  try { return res.json({ success: true, data: await physicalExitService.listCurrentlyAuthorized() }); }
  catch (error) { return fail(res, error, 'List Guard exit authorizations'); }
});

router.post('/exit-desk/authorizations/:authorizationId/exit', protect, guardEdit, async (req: WorkspaceRequest, res) => {
  try { return res.status(201).json({ success: true, data: await physicalExitService.recordExit({ authorizationId: req.params.authorizationId,
    actorId: req.user!.id, effectiveAuthority: { actorRole: req.user!.role, workspace: req.workspace,
      workspacePermission: req.workspacePermission }, idempotencyKey: String(req.get('Idempotency-Key') || req.body.idempotencyKey || ''),
    reason: String(req.body.reason || ''), effectiveAt: req.body.effectiveAt ? new Date(req.body.effectiveAt) : undefined }) }); }
  catch (error) { return fail(res, error, 'Record Guard physical exit'); }
});

router.post('/dispatch-returns/:movementId/verify', protect, guardEdit, async (req: WorkspaceRequest, res) => {
  try { return res.status(201).json({ success: true, data: await verifyGuardPhysicalReturn(prisma, { movementId: req.params.movementId,
    dispatchEvidenceId: req.body.dispatchEvidenceId, quantity: req.body.quantity, actorId: req.user!.id, authority: guardAuthority(req) }) }); }
  catch (error) { return fail(res, error, 'Verify Guard physical return'); }
});

router.post('/manual-outage-exits/:id/guard-approval', protect, guardEdit, async (req: WorkspaceRequest, res) => {
  try { return res.json({ success: true, data: await approveManualOutageExit(prisma, { id: req.params.id, role: 'GUARD',
    actorId: req.user!.id, authority: guardAuthority(req) }) }); }
  catch (error) { return fail(res, error, 'Approve manual outage exit'); }
});

router.post('/manual-outage-exits/:id/register', protect, guardEdit, async (req: WorkspaceRequest, res) => {
  try { return res.json({ success: true, data: await registerManualOutageExit(prisma, { id: req.params.id,
    actorId: req.user!.id, authority: guardAuthority(req) }) }); }
  catch (error) { return fail(res, error, 'Register manual outage exit'); }
});

router.post('/manual-outage-exits/:id/spoil', protect, guardEdit, async (req: WorkspaceRequest, res) => {
  try { return res.json({ success: true, data: await spoilManualOutageExit(prisma, { id: req.params.id, reason: req.body.reason,
    actorId: req.user!.id, authority: guardAuthority(req) }) }); }
  catch (error) { return fail(res, error, 'Spoil manual outage exit'); }
});

router.post('/manual-outage-papers/missing', protect, guardEdit, async (req: WorkspaceRequest, res) => {
  try { return res.status(201).json({ success: true, data: await reportMissingManualOutagePaper(prisma, {
    paperNumber: req.body.paperNumber, reason: req.body.reason, actorId: req.user!.id, authority: guardAuthority(req) }) }); }
  catch (error) { return fail(res, error, 'Report missing manual outage paper'); }
});

router.get('/dispatch-evidence-exceptions', protect, guardView, async (_req: WorkspaceRequest, res) => {
  try { return res.json({ success: true, data: await prisma.dispatchEvidenceException.findMany({ orderBy: { createdAt: 'desc' } }) }); }
  catch (error) { return fail(res, error, 'List dispatch evidence exceptions'); }
});

router.get('/canonical-driver-queue', protect, guardView, async (req: WorkspaceRequest, res) => {
  try {
    const history = req.query.history === 'true';
    const turns = await prisma.guardDriverQueueTurn.findMany({
      where: history ? undefined : { status: { in: ['WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED'] } },
      include: { events: { orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] } },
      orderBy: history ? [{ admittedAt: 'desc' }, { id: 'desc' }] : [{ admittedAt: 'asc' }, { id: 'asc' }],
      take: history ? 250 : undefined,
    });
    const redacted = req.workspacePermission === WORKSPACE_PERMISSIONS.VIEW;
    return res.json({ success: true, data: turns.map((turn) => responseTurn(turn, redacted)), capabilities: { canEdit: !redacted } });
  } catch (error) {
    console.error('Canonical Guard queue list error:', error);
    return res.status(500).json({ success: false, error: 'Canonical Guard queue could not be loaded.' });
  }
});

router.get('/canonical-driver-queue/admission-options', protect, guardEdit, async (_req: AuthRequest, res) => {
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
