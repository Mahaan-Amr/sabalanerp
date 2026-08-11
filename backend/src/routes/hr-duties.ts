import express, { type NextFunction, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { enforceMutationIdempotency } from '../middleware/idempotency';
import { requireHrFeature } from '../middleware/hrAuthorization';
import {
  createHrDutyFromLegacyWorkItem,
  formatHrDutyDeadlineTehran,
  reconcileHrDutyAssignment,
  respondToHrDuty,
} from '../services/hrDutyEngine';
import {
  destinationWorkspaceCode,
  getDestinationDutyDetail,
  getDestinationDutySummary,
  listDestinationDuties,
} from '../services/hrDutySurface';

const router = express.Router();
const manageHrWork = requireHrFeature('HR_WORK_MANAGEMENT', 'EDIT');
const asyncHandler = (
  handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>,
) => (req: AuthRequest, res: Response, next: NextFunction) => void handler(req, res, next).catch((error) => {
  if (!(error instanceof Error) || !/^(?:(?:HR_)?DUTY_|SOURCE_|ENVELOPE_|ASSIGNEE_|RESPONSIBILITY_|SEPARATION_OF_DUTIES_|ACTION_NOT_ALLOWED|REASON_REQUIRED)/.test(error.message)) return next(error);
  const conflictCodes = new Set([
    'DUTY_NOT_OPEN', 'DUTY_RESPONSE_CONFLICT', 'SOURCE_VERSION_CHANGED',
    'ENVELOPE_VERSION_CHANGED', 'SOURCE_STATE_CHANGED', 'RESPONSIBILITY_CHANGED',
    'DUTY_DESTINATION_CHANGED', 'DUTY_ENVELOPE_CHANGED', 'DUTY_SOURCE_CHANGED',
    'DUTY_ASSIGNMENT_CHANGED',
  ]);
  const forbiddenCodes = new Set([
    'ASSIGNEE_CHANGED', 'ASSIGNEE_INELIGIBLE', 'SEPARATION_OF_DUTIES_CONFLICT',
    'HR_DUTY_UNASSIGNED_REQUIRES_MANAGER_TRIAGE',
    'DUTY_ASSIGNEE_CHANGED', 'DUTY_MANAGER_TRIAGE_FORBIDDEN',
  ]);
  const status = error.message === 'DUTY_NOT_AVAILABLE'
    ? 404
    : conflictCodes.has(error.message)
      ? 409
      : forbiddenCodes.has(error.message)
        ? 403
        : 400;
  return res.status(status).json({ success: false, error: error.message });
});
const requiredText = (value: unknown, code: string) => {
  const result = String(value ?? '').trim();
  if (!result) throw new Error(code);
  return result;
};
const positiveVersion = (value: unknown, code: string) => {
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new Error(code);
  return version;
};
const dutyResponseRequest = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    requiredText(req.body.actionCode, 'HR_DUTY_ACTION_REQUIRED');
    positiveVersion(req.body.expectedSourceVersion, 'HR_DUTY_SOURCE_VERSION_REQUIRED');
    positiveVersion(req.body.expectedEnvelopeVersion, 'HR_DUTY_ENVELOPE_VERSION_REQUIRED');
    next();
  } catch (error) {
    if (error instanceof Error) return res.status(400).json({ success: false, error: error.message });
    return next(error);
  }
};
const serializeDuty = <Duty extends { dueAt: Date }>(duty: Duty) => ({
  ...duty,
  dueAtDisplay: formatHrDutyDeadlineTehran(duty.dueAt),
});
const requireDestinationWorkspace = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.locals.destinationWorkspaceCode = destinationWorkspaceCode(req.params.workspaceCode);
    next();
  } catch (error) {
    if (error instanceof Error) return res.status(404).json({ success: false, error: error.message });
    return next(error);
  }
};

router.use(protect);

router.get(
  '/workspaces/:workspaceCode/summary',
  requireDestinationWorkspace,
  asyncHandler(async (req, res) => {
    const data = await getDestinationDutySummary(prisma, {
      actorUserId: req.user!.id,
      workspaceCode: res.locals.destinationWorkspaceCode,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/workspaces/:workspaceCode/duties',
  requireDestinationWorkspace,
  asyncHandler(async (req, res) => {
    const view = String(req.query.view || 'assigned');
    if (!['assigned', 'triage', 'history'].includes(view)) throw new Error('DUTY_VIEW_INVALID');
    const data = await listDestinationDuties(prisma, {
      actorUserId: req.user!.id,
      workspaceCode: res.locals.destinationWorkspaceCode,
      view: view as 'assigned' | 'triage' | 'history',
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/workspaces/:workspaceCode/duties/:id',
  requireDestinationWorkspace,
  asyncHandler(async (req, res) => {
    const data = await getDestinationDutyDetail(prisma, {
      dutyId: req.params.id,
      actorUserId: req.user!.id,
      workspaceCode: res.locals.destinationWorkspaceCode,
    });
    res.json({ success: true, data });
  }),
);

router.post(
  '/legacy-work-items/:id/duties',
  enforceMutationIdempotency,
  manageHrWork,
  asyncHandler(async (req, res) => {
    const duty = await createHrDutyFromLegacyWorkItem(prisma, {
      sourceWorkItemId: req.params.id,
      sourceActionCode: requiredText(req.body.sourceActionCode, 'HR_DUTY_ACTION_REQUIRED'),
      actorUserId: req.user!.id,
      policyVersion: 1,
    });
    res.status(201).json({ success: true, data: serializeDuty(duty) });
  }),
);

router.post(
  '/:id/respond',
  dutyResponseRequest,
  asyncHandler(async (req, res) => {
    const result = await respondToHrDuty(prisma, {
      dutyId: req.params.id,
      actorUserId: req.user!.id,
      actionCode: requiredText(req.body.actionCode, 'HR_DUTY_ACTION_REQUIRED'),
      expectedSourceVersion: positiveVersion(req.body.expectedSourceVersion, 'HR_DUTY_SOURCE_VERSION_REQUIRED'),
      expectedEnvelopeVersion: positiveVersion(req.body.expectedEnvelopeVersion, 'HR_DUTY_ENVELOPE_VERSION_REQUIRED'),
      reason: String(req.body.reason ?? '').trim() || null,
      policyVersion: 1,
    });
    res.json({ success: true, data: serializeDuty(result.duty), meta: { replayed: result.replayed } });
  }),
);

router.post(
  '/:id/reconcile',
  enforceMutationIdempotency,
  manageHrWork,
  asyncHandler(async (req, res) => {
    const result = await reconcileHrDutyAssignment(prisma, {
      dutyId: req.params.id,
      actorUserId: req.user!.id,
      policyVersion: 1,
    });
    res.json({ success: true, data: result ? {
      ...result,
      predecessor: serializeDuty(result.predecessor),
      successor: result.successor ? serializeDuty(result.successor) : null,
    } : null });
  }),
);

export default router;
