import { prisma } from '../lib/prisma';
import express from 'express';
import { HrVehicleError } from '../services/hrVehicleOperations';
import { recordProjectReturnExit, releaseProjectReturnVisit } from '../services/projectReturnGuardVisits';
import { GuardDriverSource, Prisma } from '@prisma/client';
import { AuthRequest, protect } from '../middleware/auth';
import { requireWorkspaceAccess, WorkspaceRequest, WORKSPACES, WORKSPACE_PERMISSIONS } from '../middleware/workspace';
import { admitGuardDriverQueueTurn, closeGuardQueueTurnWithoutLoading, GuardQueueConflictError, GuardQueueValidationError, listGuardQueueAdmissionOptions, makeGuardQueueTurnAvailable, queueTurnDriverIdentity, returnGuardQueueTurnToWaiting, voidGuardQueueTurn } from '../services/guardDriverQueue';
import { PhysicalGateExitConflictError, PhysicalGateExitService, PhysicalGateExitValidationError } from '../services/physicalGateExit';
import { approveManualOutageExit, DispatchRecoveryConflictError, DispatchRecoveryValidationError,
  registerManualOutageExit, reportMissingManualOutagePaper, spoilManualOutageExit, verifyGuardPhysicalReturn } from '../services/dispatchCorrectionOutage';
import { PilotSafetyPauseError } from '../services/dispatchCutover';
import { readGuardQueueTurnEvidence } from '../services/partnerSales/fulfillment/guardReadScope';
import { randomUUID } from 'node:crypto';
import { PartnerLoadingCommandError } from '../services/partnerSales/fulfillment/loadingAuthority';

const router = express.Router();
const physicalExitService = new PhysicalGateExitService(prisma);
const guardView = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.VIEW);
const guardEdit = requireWorkspaceAccess(WORKSPACES.SECURITY, WORKSPACE_PERMISSIONS.EDIT);
const responseTurn = (turn: any, redacted = false) => {
  if (!redacted) return { ...turn, driverId: queueTurnDriverIdentity(turn), vehicleId: turn.driverSource === 'CUSTOMER_PICKUP' ? turn.id : turn.companyVehicleId || turn.externalVehicleId };
  const snapshot = turn.admissionSnapshot || {};
  const plate = String(snapshot.plate?.plate || '');
  return {
    id: turn.id, driverSource: turn.driverSource, status: turn.status, projectReturnStatus: turn.projectReturnStatus, admittedAt: turn.admittedAt,
    projectReturnReleasedAt: turn.projectReturnReleasedAt,
    availableAt: turn.availableAt, reservedAt: turn.reservedAt, finalizedAt: turn.finalizedAt, exitedAt: turn.exitedAt,
    closedAt: turn.closedAt, voidedAt: turn.voidedAt,
    admissionSnapshot: {
      driver: { firstName: '', lastName: 'راننده' },
      vehicle: { vehicleType: snapshot.vehicle?.vehicleType || '' },
      plate: { plate: plate ? `${'*'.repeat(Math.max(0, plate.length - 2))}${plate.slice(-2)}` : '' },
      readiness: { status: snapshot.readiness?.status || 'UNKNOWN' },
    },
    redacted: true,
  };
};
const fail = (res: any, error: unknown, context: string) => {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
    return res.status(409).json({ success: false, error: 'وضعیت صف تغییر کرده است. دوباره تلاش کنید.' });
  if (error instanceof HrVehicleError) return res.status(error.statusCode).json({ success: false, error: error.message });
  if (error instanceof PartnerLoadingCommandError) return res.status(error.error.status).json({ success: false,
    code: error.error.code, error: error.error.message });
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
    correlationId: String(req.get('X-Correlation-ID') || ''), reasonDetail: String(req.body.reasonDetail || ''),
    effectiveAt: req.body.effectiveAt ? new Date(req.body.effectiveAt) : undefined }) }); }
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

const visibleQueueTurns = { OR: [{ driverSource: { not: GuardDriverSource.PERSONAL_PICKUP } }, { projectReturnStatus: { not: null } }] } satisfies Prisma.GuardDriverQueueTurnWhereInput;
const currentQueueStatuses = ['WAITING_AT_GATE', 'AVAILABLE_FOR_LOADING', 'RESERVED_FOR_LOADING', 'LOADING_FINALIZED'] as const;
const historicalQueueStatuses = ['CLOSED_WITHOUT_LOADING', 'VOIDED', 'EXIT_RECORDED'] as const;

// Loading associations, free-text reasons and audit events require the scoped detail read.
const queueTurnSummary = {
  id: true, driverSource: true, status: true, admittedAt: true, admissionSnapshot: true,
  internalDriverId: true, externalDriverId: true, companyVehicleId: true, externalVehicleId: true,
  projectReturnStatus: true, projectReturnReleasedAt: true,
  availableAt: true, reservedAt: true, finalizedAt: true, exitedAt: true, closedAt: true, voidedAt: true,
} satisfies Prisma.GuardDriverQueueTurnSelect;

function readPageNumber(value: unknown, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

router.get('/canonical-driver-queue', protect, guardView, async (req: WorkspaceRequest, res) => {
  const redacted = req.workspacePermission === WORKSPACE_PERMISSIONS.VIEW;
  const capabilities = { canEdit: !redacted };
  res.set('Cache-Control', 'private, no-store');
  try {
    if (req.query.history !== 'true') {
      const turns = await prisma.guardDriverQueueTurn.findMany({
        where: { ...visibleQueueTurns, status: { in: [...currentQueueStatuses] } },
        select: queueTurnSummary,
        orderBy: [{ admittedAt: 'asc' }, { id: 'asc' }],
      });
      return res.json({ success: true, data: turns.map(turn => responseTurn(turn, redacted)), capabilities });
    }

    const page = readPageNumber(req.query.page, 1);
    const pageSize = readPageNumber(req.query.pageSize, 10);
    if (page === null || pageSize === null || pageSize > 100) {
      return res.status(400).json({ success: false, error: 'صفحه یا اندازهٔ صفحه نامعتبر است.' });
    }

    const where = { ...visibleQueueTurns, status: { in: [...historicalQueueStatuses] } };
    const skip = (page - 1) * pageSize;
    const { rows, total } = await prisma.$transaction(async tx => {
      const total = await tx.guardDriverQueueTurn.count({ where });
      const rows = skip < total ? await tx.guardDriverQueueTurn.findMany({
        where, skip, take: pageSize, select: queueTurnSummary,
        orderBy: [{ admittedAt: 'desc' }, { id: 'desc' }],
      }) : [];
      return { rows, total };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return res.json({ success: true, data: rows.map(turn => responseTurn(turn, redacted)),
      capabilities, pagination: { page, pageSize, total } });
  } catch (error) {
    console.error('Canonical Guard queue list error:', error);
    return res.status(500).json({ success: false, error: 'Canonical Guard queue could not be loaded.' });
  }
});

router.get('/canonical-driver-queue/:id/events', protect, guardView, async (req: WorkspaceRequest, res) => {
  res.set('Cache-Control', 'private, no-store');
  try {
    const redacted = req.workspacePermission === WORKSPACE_PERMISSIONS.VIEW;
    const events = await readGuardQueueTurnEvidence(prisma, { actorId: req.user!.id, correlationId: randomUUID() }, {
      id: req.params.id, ...visibleQueueTurns,
    }, redacted);
    if (!events) return res.status(404).json({ success: false, error: 'نوبت یافت نشد.' });
    return res.json({ success: true, data: events });
  } catch (error) {
    return fail(res, error, 'Read canonical Guard queue events');
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
    const { source, purpose, plate, phone, vehicleType } = req.body || {};
    if (purpose !== undefined && purpose !== 'PROJECT_RETURN') {
      throw new GuardQueueValidationError('هدف ورود معتبر نیست.');
    }
    const actorId = req.user!.id;
    if (source === 'PERSONAL_PICKUP') {
      if (purpose !== 'PROJECT_RETURN') throw new GuardQueueValidationError('خودروی شخصی فقط برای مرجوعی از گارد پذیرش می‌شود.');
      const turn = await admitGuardDriverQueueTurn(prisma, { source, purpose, actorId, plate });
      return res.status(201).json({ success: true, data: responseTurn(turn) });
    }
    if (source !== 'INTERNAL' && source !== 'EXTERNAL' && source !== 'CUSTOMER_PICKUP') {
      throw new GuardQueueValidationError('نوع راننده معتبر نیست.');
    }
    const driverId = String(req.body.driverId || '').trim();
    if (source !== 'CUSTOMER_PICKUP' && !driverId) throw new GuardQueueValidationError('راننده را انتخاب کنید.');
    const turn = await admitGuardDriverQueueTurn(prisma, source === 'CUSTOMER_PICKUP'
      ? { source, purpose, actorId, vehicleType, plate, phone }
      : { source, purpose, actorId, driverId, vehicleId: req.body.vehicleId });
    return res.status(201).json({ success: true, data: responseTurn(turn) });
  } catch (error) {
    return fail(res, error, 'Canonical Guard queue admission error:');
  }
});

router.post('/canonical-driver-queue/:id/project-return-exit', protect, guardEdit, async (req: AuthRequest, res) => {
  try {
    const turn = await recordProjectReturnExit(prisma, { turnId: req.params.id, actorId: req.user!.id });
    return res.json({ success: true, data: responseTurn(turn) });
  } catch (error) { return fail(res, error, 'Record Guard project return exit'); }
});

router.post('/canonical-driver-queue/:id/project-return-transfer', protect, guardEdit, async (req: AuthRequest, res) => {
  try {
    const turn = await releaseProjectReturnVisit(prisma, { turnId: req.params.id, actorId: req.user!.id, action: 'transfer' });
    return res.json({ success: true, data: responseTurn(turn) });
  } catch (error) { return fail(res, error, 'Transfer project return visit to loading'); }
});

router.post('/canonical-driver-queue/:id/project-return-complete', protect, guardEdit, async (req: AuthRequest, res) => {
  try {
    const turn = await releaseProjectReturnVisit(prisma, { turnId: req.params.id, actorId: req.user!.id, action: 'complete-personal' });
    return res.json({ success: true, data: responseTurn(turn) });
  } catch (error) { return fail(res, error, 'Complete personal-car project return visit'); }
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
