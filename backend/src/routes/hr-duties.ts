import express, { type NextFunction, type Response } from 'express';
import crypto from 'crypto';
import path from 'path';
import multer from 'multer';
import { Prisma } from '@prisma/client';
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
  markCrossWorkspaceDutyHistorySeen,
} from '../services/crossWorkspaceDutyInbox';
import {
  HR_HIRING_ALLOWED_MIME, HR_HIRING_STORAGE_DIR, removeHiringFile, scanHiringFile,
  safeHiringStoragePath, sha256File, validateHiringFileSignature,
} from '../services/hrHiringFileStorage';
import {
  recordHrHiringCollateralOriginalReturn,
  recordHrHiringCollateralReceipt,
} from '../services/crossWorkspaceDutyAdapters/hrHiringFinanceDutyAdapter';
import { normalizeHiringRial } from '../services/hrApplicantExperience';

const router = express.Router();
const hiringFinanceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, HR_HIRING_STORAGE_DIR),
    filename: (_req, file, callback) => callback(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`),
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => callback(null, HR_HIRING_ALLOWED_MIME.has(file.mimetype)),
});
const manageHrWork = requireHrFeature('HR_WORK_MANAGEMENT', 'EDIT');
const dutyOperationalMessage = (code: string) => ({
  SEPARATION_OF_DUTIES_CONFLICT: 'این درخواست را شما ثبت کرده‌اید؛ برای حفظ تفکیک وظایف، مدیر حسابداری دیگری باید آن را دریافت کند. مدیر سیستم می‌تواند با ثبت دلیل اقدام کند.',
  REASON_REQUIRED: 'دریافت وظیفه متوقف شد؛ مدیر سیستم برای اقدام روی درخواست خودش باید دلیل کنترلی ثبت کند.',
  DUTY_ALREADY_CLAIMED: 'این وظیفه قبلاً توسط کاربر دیگری دریافت شده است. فهرست را به‌روزرسانی کنید.',
  DUTY_CLAIM_CONFLICT: 'دریافت وظیفه متوقف شد؛ وضعیت آن هم‌زمان تغییر کرده است. فهرست را به‌روزرسانی کنید.',
  SOURCE_STATE_CHANGED: 'وضعیت درخواست اصلاح تغییر کرده است. فهرست را به‌روزرسانی و از مرحله جاری ادامه دهید.',
  CONTRACT_INACTIVE: 'تصمیم‌گیری متوقف شد؛ قرارداد غیرفعال است. مدیر مجاز باید ابتدا آن را از مسیر رسمی فعال‌سازی مجدد بازگرداند.',
  RESPONSIBLE_SELLER_REQUIRED: 'تأیید اصلاح متوقف شد؛ فروشنده مسئول قرارداد مشخص نیست. مدیر فروش باید ابتدا مسئول قرارداد را تعیین کند.',
  DUTY_HISTORY_SEEN_THROUGH_REQUIRED: 'ثبت مشاهده تاریخچه انجام نشد؛ صفحه را دوباره باز کنید.',
}[code] || 'عملیات وظیفه متوقف شد. صفحه را به‌روزرسانی کنید و در صورت تکرار با مدیر همان فضای کاری تماس بگیرید.');
const asyncHandler = (
  handler: (req: AuthRequest, res: Response, next: NextFunction) => Promise<unknown>,
) => (req: AuthRequest, res: Response, next: NextFunction) => void handler(req, res, next).catch((error) => {
  if (!(error instanceof Error) || !/^(?:(?:HR_)?DUTY_|SOURCE_|ENVELOPE_|ASSIGNEE_|RESPONSIBILITY_|SEPARATION_OF_DUTIES_|CONTRACT_|RESPONSIBLE_SELLER_|ACTION_NOT_ALLOWED|REASON_REQUIRED)/.test(error.message)) return next(error);
  const conflictCodes = new Set([
    'DUTY_NOT_OPEN', 'DUTY_RESPONSE_CONFLICT', 'SOURCE_VERSION_CHANGED',
    'ENVELOPE_VERSION_CHANGED', 'SOURCE_STATE_CHANGED', 'RESPONSIBILITY_CHANGED',
    'DUTY_DESTINATION_CHANGED', 'DUTY_ENVELOPE_CHANGED', 'DUTY_SOURCE_CHANGED',
    'DUTY_ASSIGNMENT_CHANGED',
    'DUTY_ALREADY_CLAIMED', 'DUTY_CLAIM_CONFLICT',
    'DUTY_REASSIGN_CONFLICT',
    'CONTRACT_INACTIVE', 'RESPONSIBLE_SELLER_REQUIRED',
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
  console.warn('Cross-workspace duty operation rejected:', error.message);
  return res.status(status).json({ success: false, error: dutyOperationalMessage(error.message) });
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
    if (error instanceof Error) return res.status(400).json({ success: false, error: dutyOperationalMessage(error.message) });
    return next(error);
  }
};
const serializeDuty = <Duty extends { dueAt: Date }>(duty: Duty) => ({
  ...duty,
  dueAtDisplay: formatCrossWorkspaceDutyDeadlineTehran(duty.dueAt),
});
type CrossWorkspaceDutyResponseResult<Duty> =
  | { duty: Duty; predecessor?: never; replayed?: boolean }
  | { duty?: never; predecessor: Duty; successor?: unknown; correction?: unknown; replayed?: boolean };

export const serializeCrossWorkspaceDutyResponse = <Duty extends { dueAt: Date }>(
  result: CrossWorkspaceDutyResponseResult<Duty>,
) => {
  const completedDuty = result.duty ?? result.predecessor;
  if (!completedDuty) throw new Error('DUTY_RESPONSE_INVALID');
  return {
    data: serializeDuty(completedDuty),
    meta: { replayed: Boolean(result.replayed) },
  };
};
const requireDestinationWorkspace = (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.locals.destinationWorkspaceCode = crossWorkspaceDutyDestinationCode(req.params.workspaceCode);
    next();
  } catch (error) {
    if (error instanceof Error) return res.status(404).json({ success: false, error: 'این صف وظیفه برای فضای کاری انتخاب‌شده در دسترس نیست.' });
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

router.get('/:id/hiring-finance/context', asyncHandler(async (req, res) => {
  await getCrossWorkspaceDutyDetail(prisma, { dutyId: req.params.id, actorUserId: req.user!.id, workspaceCode: 'ACCOUNTING' });
  const duty = await prisma.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: req.params.id } });
  if (duty.sourceType !== 'HR_HIRING_FINANCE') throw new Error('DUTY_NOT_AVAILABLE');
  const assigned = duty.currentAssigneeUserId === req.user!.id;
  if (duty.sourceActionCode.includes('ORIGINAL_RETURN')) {
    const source = await prisma.hrCollateralOriginalReturn.findUniqueOrThrow({ where: { id: duty.sourceId }, include: { collateralItem: true } });
    return res.json({ success: true, data: {
      actionCode: duty.sourceActionCode, type: source.collateralItem.type,
      amountRials: source.collateralItem.amountRials?.toFixed(0) || null, status: source.status,
      ...(assigned && duty.sourceActionCode === 'HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN' ? {
        returnedAt: source.returnedAt, returnedTo: source.returnedTo,
        evidenceNote: source.evidenceNote, evidenceOriginalName: source.evidenceOriginalName,
      } : {}),
    } });
  }
  const item = await prisma.hrCollateralItem.findUniqueOrThrow({ where: { id: duty.sourceId } });
  res.json({ success: true, data: {
    actionCode: duty.sourceActionCode, type: item.type,
    amountRials: item.amountRials?.toFixed(0) || null,
    status: item.status,
    ...(assigned && duty.sourceActionCode === 'HIRING_COLLATERAL_VERIFY_RECEIPT' ? {
      identifier: item.identifier, issuerOrGuarantor: item.issuerOrGuarantor,
      custodyLocation: item.custodyLocation, receivedAt: item.receivedAt,
      originalName: item.originalName,
    } : {}),
  } });
}));

router.get('/:id/hiring-finance/evidence', asyncHandler(async (req, res) => {
  await getCrossWorkspaceDutyDetail(prisma, {
    dutyId: req.params.id, actorUserId: req.user!.id, workspaceCode: 'ACCOUNTING',
  });
  const duty = await prisma.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: req.params.id } });
  if (duty.sourceType !== 'HR_HIRING_FINANCE' || duty.currentAssigneeUserId !== req.user!.id) {
    throw new Error('DUTY_NOT_ASSIGNED');
  }
  if (duty.sourceActionCode === 'HIRING_COLLATERAL_VERIFY_RECEIPT') {
    const item = await prisma.hrCollateralItem.findUniqueOrThrow({ where: { id: duty.sourceId } });
    if (!item.storageName || !item.originalName) throw new Error('DUTY_EVIDENCE_NOT_AVAILABLE');
    await prisma.hrHiringAudit.create({ data: {
      applicationId: item.applicationId, actorUserId: req.user!.id, actorKind: 'USER',
      eventType: 'COLLATERAL_DOCUMENT_DOWNLOADED_FROM_ACCOUNTING_DUTY',
      payloadJson: { dutyId: duty.id, collateralItemId: item.id },
    } });
    return res.download(safeHiringStoragePath(item.storageName), item.originalName);
  }
  if (duty.sourceActionCode === 'HIRING_COLLATERAL_VERIFY_ORIGINAL_RETURN') {
    const source = await prisma.hrCollateralOriginalReturn.findUniqueOrThrow({
      where: { id: duty.sourceId }, include: { collateralItem: true },
    });
    if (!source.evidenceStorageName || !source.evidenceOriginalName) throw new Error('DUTY_EVIDENCE_NOT_AVAILABLE');
    await prisma.hrHiringAudit.create({ data: {
      applicationId: source.collateralItem.applicationId, actorUserId: req.user!.id, actorKind: 'USER',
      eventType: 'COLLATERAL_RETURN_EVIDENCE_DOWNLOADED_FROM_ACCOUNTING_DUTY',
      payloadJson: { dutyId: duty.id, collateralReturnId: source.id },
    } });
    return res.download(safeHiringStoragePath(source.evidenceStorageName), source.evidenceOriginalName);
  }
  throw new Error('DUTY_EVIDENCE_NOT_AVAILABLE');
}));

router.post('/:id/hiring-finance/original-return', enforceMutationIdempotency, hiringFinanceUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    if (!req.file) throw new Error('COLLATERAL_RETURN_PROOF_REQUIRED');
    validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = await scanHiringFile(req.file.path);
    const digest = await sha256File(req.file.path);
    const returnedTo = String(req.body.returnedTo || '').trim();
    const evidenceNote = String(req.body.evidenceNote || '').trim();
    if (!returnedTo || !evidenceNote) throw new Error('COLLATERAL_RETURN_FIELDS_REQUIRED');
    const result = await prisma.$transaction((tx) => recordHrHiringCollateralOriginalReturn(tx, {
      dutyId: req.params.id, actorUserId: req.user!.id, returnedTo, evidenceNote,
      evidence: {
        storageName: req.file!.filename, originalName: req.file!.originalname,
        mimeType: req.file!.mimetype, size: req.file!.size, sha256: digest, malwareScanStatus: scanStatus,
      },
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ success: true, data: result });
  } catch (error) { removeHiringFile(req.file?.path); throw error; }
}));

router.post('/:id/hiring-finance/receipt', enforceMutationIdempotency, hiringFinanceUpload.single('file'), asyncHandler(async (req, res) => {
  try {
    if (!req.file) throw new Error('COLLATERAL_SCAN_REQUIRED');
    validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = await scanHiringFile(req.file.path);
    const digest = await sha256File(req.file.path);
    const receivedAt = new Date(String(req.body.receivedAt || ''));
    const custodyLocation = String(req.body.custodyLocation || '').trim();
    if (Number.isNaN(receivedAt.getTime()) || !custodyLocation) throw new Error('COLLATERAL_RECEIPT_FIELDS_REQUIRED');
    const result = await prisma.$transaction((tx) => recordHrHiringCollateralReceipt(tx, {
      dutyId: req.params.id, actorUserId: req.user!.id,
      amountRials: req.body.amountRials ? normalizeHiringRial(req.body.amountRials) : null,
      identifier: String(req.body.identifier || '').trim() || null,
      issuerOrGuarantor: String(req.body.issuerOrGuarantor || '').trim() || null,
      receivedAt, custodyLocation,
      evidence: {
        storageName: req.file!.filename, originalName: req.file!.originalname,
        mimeType: req.file!.mimetype, size: req.file!.size, sha256: digest, malwareScanStatus: scanStatus,
      },
    }), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    removeHiringFile(req.file?.path);
    throw error;
  }
}));

router.post(
  '/workspaces/:workspaceCode/history-seen',
  enforceMutationIdempotency,
  requireDestinationWorkspace,
  asyncHandler(async (req, res) => {
    const seenThrough = new Date(String(req.body.seenThrough ?? ''));
    if (Number.isNaN(seenThrough.getTime())) throw new Error('DUTY_HISTORY_SEEN_THROUGH_REQUIRED');
    const data = await markCrossWorkspaceDutyHistorySeen(prisma, {
      actorUserId: req.user!.id,
      workspaceCode: res.locals.destinationWorkspaceCode,
      seenThrough,
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
  (_req, res) => res.status(410).json({ success: false, error: 'این مسیر قدیمی متوقف شده است. وظیفه را از صف بین‌واحدی فضای مقصد ادامه دهید.' }),
);

router.post(
  '/:id/claim',
  enforceMutationIdempotency,
  asyncHandler(async (req, res) => {
    const data = await claimCrossWorkspaceDuty(prisma, {
      dutyId: req.params.id,
      actorUserId: req.user!.id,
      policyVersion: 1,
      reason: String(req.body.reason ?? '').trim() || null,
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
    res.json({ success: true, ...serializeCrossWorkspaceDutyResponse(result) });
  }),
);

router.post(
  '/:id/reconcile',
  enforceMutationIdempotency,
  manageHrWork,
  (_req, res) => res.status(410).json({
    success: false,
    error: 'این مسیر قدیمی متوقف شده است. تعیین مسئول را از صف بین‌واحدی فضای مقصد انجام دهید.',
  }),
);

export default router;
