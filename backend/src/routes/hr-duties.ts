import express, { type NextFunction, type Response } from 'express';
import { prisma } from '../lib/prisma';
import { protect, type AuthRequest } from '../middleware/auth';
import { enforceMutationIdempotency } from '../middleware/idempotency';
import { requireHrFeature } from '../middleware/hrAuthorization';
import {
  formatCrossWorkspaceDutyDeadlineTehran,
  claimCrossWorkspaceDuty,
  listEligibleCrossWorkspaceDutyAssignees,
  reassignCrossWorkspaceDuty,
  respondToCrossWorkspaceDuty,
} from '../services/crossWorkspaceDutyModule';
import {
  crossWorkspaceDutyDestinationCode,
  getCrossWorkspaceDutyDetail,
  getCrossWorkspaceDutySummary,
  listCrossWorkspaceDuties,
} from '../services/crossWorkspaceDutyInbox';

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
    'DUTY_ALREADY_CLAIMED', 'DUTY_CLAIM_CONFLICT',
    'DUTY_REASSIGN_CONFLICT',
  ]);
  const forbiddenCodes = new Set([
    'ASSIGNEE_CHANGED', 'ASSIGNEE_INELIGIBLE', 'SEPARATION_OF_DUTIES_CONFLICT',
    'HR_DUTY_UNASSIGNED_REQUIRES_MANAGER_TRIAGE',
    'DUTY_ASSIGNEE_CHANGED', 'DUTY_MANAGER_TRIAGE_FORBIDDEN',
    'DUTY_ASSIGNEE_INELIGIBLE',
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
  dueAtDisplay: formatCrossWorkspaceDutyDeadlineTehran(duty.dueAt),
});
const requireDestinationWorkspace = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.locals.destinationWorkspaceCode = crossWorkspaceDutyDestinationCode(req.params.workspaceCode);
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
    const data = await getCrossWorkspaceDutySummary(prisma, {
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
    if (!['assigned', 'available', 'triage', 'history'].includes(view)) throw new Error('DUTY_VIEW_INVALID');
    const data = await listCrossWorkspaceDuties(prisma, {
      actorUserId: req.user!.id,
      workspaceCode: res.locals.destinationWorkspaceCode,
      view: view as 'assigned' | 'available' | 'triage' | 'history',
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/workspaces/:workspaceCode/duties/:id/eligible-assignees',
  requireDestinationWorkspace,
  asyncHandler(async (req, res) => {
    const data = await listEligibleCrossWorkspaceDutyAssignees(prisma, {
      dutyId: req.params.id,
      actorUserId: req.user!.id,
      workspaceCode: res.locals.destinationWorkspaceCode,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  '/workspaces/:workspaceCode/duties/:id',
  requireDestinationWorkspace,
  asyncHandler(async (req, res) => {
    const data = await getCrossWorkspaceDutyDetail(prisma, {
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
  (_req, res) => res.status(410).json({ success: false, error: 'HR_LEGACY_DUTY_ROUTING_RETIRED' }),
);

router.post(
  '/:id/claim',
  enforceMutationIdempotency,
  asyncHandler(async (req, res) => {
    const data = await claimCrossWorkspaceDuty(prisma, {
      dutyId: req.params.id,
      actorUserId: req.user!.id,
      policyVersion: 1,
    });
    res.json({ success: true, data: serializeDuty(data) });
  }),
);

router.post(
  '/:id/reassign',
  enforceMutationIdempotency,
  asyncHandler(async (req, res) => {
    const data = await reassignCrossWorkspaceDuty(prisma, {
      dutyId: req.params.id,
      actorUserId: req.user!.id,
      targetUserId: requiredText(req.body.targetUserId, 'DUTY_TARGET_REQUIRED'),
      expectedAssigneeUserId: String(req.body.expectedAssigneeUserId ?? '').trim() || null,
      reason: requiredText(req.body.reason, 'REASON_REQUIRED'),
      policyVersion: 1,
    });
    res.json({ success: true, data: serializeDuty(data) });
  }),
);

router.post(
  '/:id/respond',
  dutyResponseRequest,
  asyncHandler(async (req, res) => {
    const result = await respondToCrossWorkspaceDuty(prisma, {
      dutyId: req.params.id,
      actorUserId: req.user!.id,
      actionCode: requiredText(req.body.actionCode, 'HR_DUTY_ACTION_REQUIRED'),
      expectedSourceVersion: positiveVersion(req.body.expectedSourceVersion, 'HR_DUTY_SOURCE_VERSION_REQUIRED'),
      expectedEnvelopeVersion: positiveVersion(req.body.expectedEnvelopeVersion, 'HR_DUTY_ENVELOPE_VERSION_REQUIRED'),
      reason: String(req.body.reason ?? '').trim() || null,
      targetUserId: String(req.body.targetUserId ?? '').trim() || undefined,
      policyVersion: 1,
    });
    res.json({ success: true, data: serializeDuty(result.duty), meta: { replayed: result.replayed } });
  }),
);

router.post(
  '/:id/reconcile',
  enforceMutationIdempotency,
  manageHrWork,
  (_req, res) => res.status(410).json({ success: false, error: 'HR_NAMED_RESPONSIBILITY_ROUTING_RETIRED' }),
);

export default router;
