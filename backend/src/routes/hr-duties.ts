import express, { type NextFunction, type Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, type AuthRequest } from '../middleware/auth';
import { enforceMutationIdempotency } from '../middleware/idempotency';
import { requireHrFeature } from '../middleware/hrAuthorization';
import {
  createHrDutyFromLegacyWorkItem,
  reconcileHrDutyAssignment,
  respondToHrDuty,
} from '../services/hrDutyEngine';

const router = express.Router();
const prisma = new PrismaClient();
const manageHrWork = requireHrFeature('HR_WORK_MANAGEMENT', 'EDIT');
const asyncHandler = (
  handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>,
) => (req: AuthRequest, res: Response, next: NextFunction) => void handler(req, res, next).catch((error) => {
  if (!(error instanceof Error) || !/^(?:(?:HR_)?DUTY_|SOURCE_|ENVELOPE_|ASSIGNEE_|RESPONSIBILITY_|SEPARATION_OF_DUTIES_|ACTION_NOT_ALLOWED|REASON_REQUIRED)/.test(error.message)) return next(error);
  const conflictCodes = new Set([
    'DUTY_NOT_OPEN', 'DUTY_RESPONSE_CONFLICT', 'SOURCE_VERSION_CHANGED',
    'ENVELOPE_VERSION_CHANGED', 'SOURCE_STATE_CHANGED', 'RESPONSIBILITY_CHANGED',
  ]);
  const forbiddenCodes = new Set([
    'ASSIGNEE_CHANGED', 'ASSIGNEE_INELIGIBLE', 'SEPARATION_OF_DUTIES_CONFLICT',
    'HR_DUTY_UNASSIGNED_REQUIRES_MANAGER_TRIAGE',
  ]);
  const status = conflictCodes.has(error.message) ? 409 : forbiddenCodes.has(error.message) ? 403 : 400;
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

router.use(protect);

router.post(
  '/legacy-work-items/:id/duties',
  enforceMutationIdempotency,
  manageHrWork,
  asyncHandler(async (req, res) => {
    const duty = await createHrDutyFromLegacyWorkItem(prisma, {
      sourceWorkItemId: req.params.id,
      sourceActionCode: requiredText(req.body.sourceActionCode, 'HR_DUTY_ACTION_REQUIRED'),
      responsibilityTypeCode: requiredText(req.body.responsibilityTypeCode, 'HR_DUTY_RESPONSIBILITY_REQUIRED'),
      scopeType: requiredText(req.body.scopeType, 'HR_DUTY_SCOPE_REQUIRED'),
      scopeId: String(req.body.scopeId ?? '').trim() || null,
      sourceActorUserId: req.user!.id,
      policyVersion: 1,
    });
    res.status(201).json({ success: true, data: duty });
  }),
);

router.post(
  '/:id/respond',
  enforceMutationIdempotency,
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
    res.json({ success: true, data: result.duty, meta: { replayed: result.replayed } });
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
    res.json({ success: true, data: result });
  }),
);

export default router;
