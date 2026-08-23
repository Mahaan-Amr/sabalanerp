import { prisma } from '../lib/prisma';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthRequest, protect } from '../middleware/auth';
import hrHiringSmsGateway from '../services/hrHiringSmsGateway';
import { mapSmsIrDeliveryState } from '../services/hrHiringDeliveryPollingService';
import { publishNotificationEvent } from '../services/notificationService';
import {
  ensureHrHiringStorage,
  HR_HIRING_ALLOWED_MIME,
  HR_HIRING_STORAGE_DIR,
  removeHiringFile,
  safeHiringStoragePath,
  scanHiringFile,
  sha256File,
  validateHiringFileSignature
} from '../services/hrHiringFileStorage';
import { normalizeCandidateAssessmentResult } from '../services/hrCandidateAssessment';
import { collateralCandidateExplanation, compensationTotalRials, isValidIranianNationalCode, normalizeCompensationComponents, validateHiringCorrection, validateHiringQuestionnaire } from '../services/hrHiringRules';
import {
  applicantOtpHash,
  applicantSubjectHash,
  decryptApplicantOtp,
  encryptApplicantOtp,
  generateApplicantOtp,
  normalizeApplicantDigits,
  normalizeApplicantMobile,
  normalizeApplicantOtp
} from '../services/hrCandidateAccess';
import {
  actionPermissionForHiringLifecycleAction,
  buildHiringQueueItem,
  projectHiringLifecycle,
  projectHiringTaskCapabilities,
  summarizeHiringLifecycle,
} from '../services/hrHiringLifecycle';
import {
  buildCandidateCorrectionMessage,
  normalizeCandidateCorrectionRequest
} from '../services/hrCandidateCorrection';
import {
  normalizePersianFullName,
  validateOfflineOfferDecision
} from '../services/hrOfferDecision';
import { candidateIdentityMatches } from '../services/hrCandidateIdentityPolicy';
import {
  assertPaperContractDraft,
  assertPaperContractReviewable,
  paperContractReviewState
} from '../services/hrEmploymentContract';
import { normalizeInsuranceEnrollmentCommand } from '../services/hrInsuranceEnrollment';
import { normalizePayrollParticipationCommand } from '../services/hrPayrollParticipation';
import { buildEmploymentActivationReadiness } from '../services/hrEmploymentActivation';
import {
  assertArchiveReason,
  assertArchivedRecordMutable,
  assertJobApplicationArchivable,
  assertPermanentDeletionConfirmation,
  stableDeletionFingerprint,
  projectRecordRetentionCapabilities
} from '../services/hrRecordRetentionPolicy';
import { commitStagedHiringFiles, restoreStagedHiringFiles, stageHiringFilesForDeletion } from '../services/hrDeletionFileTransaction';
import { latestDecisionsByKind } from '../services/hrApplicationDecisionVersions';
import { normalizeHiringDocumentTitle } from '../services/hrHiringDocumentEvidence';
import { assertHiringAuthorityMutationAllowed } from '../services/hrHiringAuthorityPolicy';
import {
  buildHrHiringDashboardMetrics,
  HR_HIRING_METRIC_VIEWS,
  HR_HIRING_DASHBOARD_METRICS_CACHE_HEADERS,
  resolveActionableCollateralOrContractApplications
} from '../services/hrHiringDashboardMetrics';
import {
  automaticHiringWorkItemBaseKey,
  automaticHiringWorkItemSourceKey,
  personalHrWorkProgress,
  staleAutomaticHiringWorkItemStatus
} from '../services/hrWorkItems';
import { requireHrAuthorization, requireHrFeature } from '../middleware/hrAuthorization';
import { activeHrActionPermissionsForUser, activeHrAuthoritiesForUser, authorizeHrUser } from '../services/hrAuthorizationService';
import { normalizeCoveredHiringAmounts, normalizeHiringRial } from '../services/hrApplicantExperience';
import { assertHiringDecisionGate } from '../services/hrHiringDecisionPolicy';
import {
  assertFinalRejectionAuthority,
  assertGuidedHrInterviewEvidence,
  authorizeFormalAssessmentResultCommand,
  FORMAL_ASSESSMENT_KINDS,
  FormalAssessmentKind,
  normalizeFormalAssessmentPlanCommand,
  projectFormalAssessmentEvidenceGate,
} from '../services/hrFormalAssessmentPolicy';
import { DEFAULT_INTERVIEW_CRITERIA, normalizeInterviewCriteriaPublication } from '../services/hrInterviewCriteriaPolicy';
import { ensureInitialInterviewCriteriaSet } from '../services/hrInitialInterviewCriteriaSet';
import { initialInterviewDraftSaveError } from '../services/hrInitialInterviewDraftPersistence';
import { nextEvaluationOccurrenceNumber, normalizeCompanyEvaluationPlanItem, validateCompanyEvaluationResult } from '../services/hrCompanyEvaluationPolicy';
import { buildHiringCandidateSearchConditions } from '../services/hrHiringSearch';
import {
  compensationVerificationDueAt,
  isCompensationPayrollVerified,
  normalizeCompensationReturnReason,
} from '../services/hrCompensationWorkflow';
import { tehranCivilDateKey } from '../services/tehranBusinessCalendar';
import { createHrHiringCollateralReturnDuty } from '../services/crossWorkspaceDutyAdapters/hrHiringFinanceDutyAdapter';
import { reconcileAcceptedOfferFollowUp } from '../services/hrAcceptedOfferFollowUp';
import { resolveWorkspaceDutyAuthority } from '../services/crossWorkspaceDutyAuthority';

const router = express.Router();
const ACCESS_TTL_DAYS = 7;
const PHONE_FAILURE_LIMIT = 5;
const IP_FAILURE_LIMIT = 30;
const ACCESS_WINDOW_MS = 15 * 60_000;
const ACCESS_BLOCK_MS = 15 * 60_000;
const INVALID_ACCESS_ERROR = 'شماره همراه یا کد ورود معتبر نیست، یا اعتبار دسترسی پایان یافته است. لطفاً اطلاعات را بررسی کنید یا با منابع انسانی تماس بگیرید.';
const THROTTLED_ACCESS_ERROR = 'تعداد تلاش‌ها بیش از حد مجاز است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کنید.';
const CONTACT_HR_ACCESS_ERROR = 'تعداد تلاش‌های ناموفق به حد مجاز رسیده است. لطفاً برای دریافت کد ورود جدید با منابع انسانی تماس بگیرید.';
const DOCUMENT_CATEGORIES = new Set(['BIRTH_CERTIFICATE_ALL_PAGES', 'BIRTH_CERTIFICATE_EXPLANATIONS', 'NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK', 'MILITARY', 'EDUCATION', 'PHOTO', 'OTHER']);
const COLLATERAL_TYPES = new Set(['PROMISSORY_NOTE', 'CHEQUE', 'GUARANTEE', 'UNDERTAKING', 'OTHER']);
const HIRING_AUTHORITY_TYPES = new Set(['HR_PROCESSOR', 'HR_MANAGER', 'COMPANY_MANAGER', 'HR_PAYROLL_PROCESSOR', 'HR_PAYROLL_MANAGER', 'FINANCE_RECORDER', 'FINANCE_MANAGER']);
ensureHrHiringStorage();

const formalAssessmentPlanInclude = {
  selections: { orderBy: { assessmentKind: 'asc' as const } },
  results: { orderBy: [{ assessmentKind: 'asc' as const }, { resultVersion: 'desc' as const }], include: { attempts: { orderBy: { attemptNumber: 'desc' as const } } } },
};

const formalAssessmentEvidenceFor = async (applicationId: string, client: PrismaClient | Prisma.TransactionClient = prisma) => {
  const plans = await client.hrFormalAssessmentPlan.findMany({
    where: { applicationId },
    include: formalAssessmentPlanInclude,
    orderBy: { version: 'desc' },
  });
  return { plans, evidence: projectFormalAssessmentEvidenceGate(plans as any) };
};

const assertFormalAssessmentEvidenceComplete = async (applicationId: string, client: PrismaClient | Prisma.TransactionClient = prisma) => {
  const state = await formalAssessmentEvidenceFor(applicationId, client);
  if (!state.evidence.complete) throw new Error('تصمیم صریح و همه نتایج انتخاب‌شده ارزیابی‌های رسمی باید تکمیل شده باشند.');
  return state;
};

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, HR_HIRING_STORAGE_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, HR_HIRING_ALLOWED_MIME.has(file.mimetype))
});

const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000);
const initiatePendingCollateralReturns = async (application: any, outcome: string, reason: string, requestedBy: string) => {
  const held = application.collateralItems.filter((item: any) => item.receivedAt && !item.returnConfirmedAt);
  if (!held.length) return 0;
  await prisma.$transaction(async (tx) => {
    await tx.hrJobApplication.update({ where: { id: application.id }, data: {
      pendingClosureOutcome: outcome, pendingClosureReason: reason,
      pendingClosureRequestedBy: requestedBy, pendingClosureRequestedAt: new Date(),
    } });
    for (const item of held) {
      const latest = await tx.hrCollateralOriginalReturn.findFirst({ where: { collateralItemId: item.id }, orderBy: { version: 'desc' } });
      if (latest && ['DRAFT', 'SUBMITTED'].includes(latest.status)) continue;
      const source = await tx.hrCollateralOriginalReturn.create({ data: {
        collateralItemId: item.id, version: (latest?.version || 0) + 1, status: 'DRAFT',
      } });
      await createHrHiringCollateralReturnDuty(tx, {
        returnId: source.id, actionCode: 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN', actorUserId: requestedBy,
      });
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return held.length;
};
const invitationIsUsableWhere = (now = new Date()) => ({
  revokedAt: null,
  expiresAt: { gt: now },
  OR: [{ overlapExpiresAt: null }, { overlapExpiresAt: { gt: now } }]
});
const parseDate = (value: unknown, name: string) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) throw new Error(`${name} نامعتبر است.`);
  return date;
};
const actorId = (req: AuthRequest) => req.user!.id;
const normalizedName = normalizePersianFullName;
const latestSubmittedFullName = async (applicationId: string) => {
  const revision = await prisma.hrApplicationFormRevision.findFirst({
    where: { applicationId, status: 'SUBMITTED' },
    orderBy: { revisionNumber: 'desc' },
    select: { dataJson: true }
  });
  const data = revision?.dataJson as Record<string, unknown> | undefined;
  return normalizedName(`${data?.firstName || ''} ${data?.lastName || ''}`);
};

const createApplicantInvitation = async (
  applicationId: string,
  mobile: string,
  createdBy: string,
  db: Prisma.TransactionClient | PrismaClient = prisma,
) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const otp = generateApplicantOtp();
    try {
      const invitation = await db.hrCandidateInvitation.create({ data: {
        applicationId,
        mobileSnapshot: mobile,
        otpHash: applicantOtpHash(mobile, otp),
        otpCiphertext: encryptApplicantOtp(mobile, otp),
        expiresAt: plusDays(ACCESS_TTL_DAYS),
        createdBy
      }});
      return { invitation, otp };
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
    }
  }
  throw new Error('تولید کد ورود یکتا ناموفق بود؛ دوباره تلاش کنید.');
};

const automaticallySendApplicantInvitation = async (
  applicationId: string,
  mobile: string,
  createdBy: string,
) => {
  const { invitation, otp } = await createApplicantInvitation(applicationId, mobile, createdBy);
  try {
    const sms = await hrHiringSmsGateway.sendInvitation({ phoneNumber: mobile, code: otp });
    if (!sms.success) {
      await prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
      return { status: 'FAILED' as const, invitationId: invitation.id, error: sms.error || 'ارسال پیامک دعوت ناموفق بود.' };
    }
    const overlapExpiresAt = new Date(Date.now() + 30 * 60_000);
    await prisma.$transaction([
      prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: {
        providerMessageId: sms.messageId ? String(sms.messageId) : null,
        providerDeliveryState: sms.messageId ? 'ACCEPTED' : 'UNKNOWN',
        providerLastCheckedAt: new Date(),
      } }),
      prisma.hrCandidateInvitation.updateMany({
        where: { applicationId, id: { not: invitation.id }, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { overlapExpiresAt },
      }),
      prisma.hrCandidateAccessThrottle.deleteMany({
        where: { subjectKind: 'PHONE', subjectHash: applicantSubjectHash('PHONE', mobile) },
      }),
    ]);
    return {
      status: sms.messageId ? 'SENT' as const : 'UNKNOWN' as const,
      invitationId: invitation.id,
      expiresAt: invitation.expiresAt,
      providerMessageId: sms.messageId ? String(sms.messageId) : null,
      overlapExpiresAt,
      debugOtp: process.env.SMS_IR_ENVIRONMENT === 'sandbox' ? otp : undefined,
    };
  } catch (error) {
    return { status: 'UNKNOWN' as const, invitationId: invitation.id, error: error instanceof Error ? error.message : 'نتیجه ارسال پیامک مشخص نیست.' };
  }
};

const resolveOfferAccessCode = async (
  applicationId: string,
  phoneNumber: string,
  createdBy: string,
) => {
  const mobile = normalizeApplicantMobile(phoneNumber);
  if (!mobile) throw new Error('شماره همراه متقاضی معتبر نیست.');
  const invitations = await prisma.hrCandidateInvitation.findMany({
    where: { applicationId, mobileSnapshot: mobile, ...invitationIsUsableWhere() },
    orderBy: { createdAt: 'desc' }
  });
  for (const invitation of invitations) {
    const otp = decryptApplicantOtp(mobile, invitation.otpCiphertext);
    if (otp) return { otp, invitationId: invitation.id, replacementIssued: false };
  }
  const replacement = await createApplicantInvitation(applicationId, mobile, createdBy);
  return {
    otp: replacement.otp,
    invitationId: replacement.invitation.id,
    replacementIssued: true
  };
};

const auditWithDatabase = (
  database: PrismaClient | Prisma.TransactionClient,
  applicationId: string,
  eventType: string,
  req: AuthRequest | express.Request,
  payload?: unknown,
  actorKind = 'USER',
) => database.hrHiringAudit.create({ data: {
    applicationId,
    actorUserId: (req as AuthRequest).user?.id,
    actorKind,
    eventType,
    payloadJson: actorKind === 'USER' ? {
      ...(payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : { detail: payload ?? null }),
      actorInternalRole: (req as AuthRequest).user?.role ?? null,
      broadManagerOverride: Boolean((req as any).hrBroadManagerOverride),
      selfApproval: Boolean((payload as any)?.selfApproval),
      auditedAt: new Date().toISOString(),
    } as Prisma.InputJsonValue : payload == null ? Prisma.JsonNull : payload as Prisma.InputJsonValue,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')
  }});

const audit = (applicationId: string, eventType: string, req: AuthRequest | express.Request, payload?: unknown, actorKind = 'USER') =>
  auditWithDatabase(prisma, applicationId, eventType, req, payload, actorKind);

const notifyOfferDecline = async (
  tx: Prisma.TransactionClient,
  applicationId: string,
) => {
  const application = await tx.hrJobApplication.findUniqueOrThrow({
    where: { id: applicationId },
    include: {
      candidate: true,
      position: true,
      compensationSnapshots: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { proposedBy: true }
      },
      identityChecks: { select: { reviewedBy: true } }
    }
  });
  const proposerIds = [
    application.compensationSnapshots[0]?.proposedBy,
    application.createdBy
  ].filter(Boolean) as string[];
  const processorIds = application.identityChecks.map((item) => item.reviewedBy);
  const responsibleIds = [...new Set([...proposerIds, ...processorIds])];
  const permissionEntries = await Promise.all(responsibleIds.map(async (userId) => ({
    userId,
    permissions: new Set(await activeHrActionPermissionsForUser(tx, userId)),
  })));
  const userIds = permissionEntries.filter(({ userId, permissions }) => (
    (proposerIds.includes(userId) && permissions.has('MANAGE_COMPENSATION'))
    || (processorIds.includes(userId) && permissions.has('MANAGE_RECRUITMENT_CASE'))
  )).map(({ userId }) => userId);
  if (!userIds.length) return;
  await publishNotificationEvent(tx, {
    type: 'HIRING_OFFER_DECLINED',
    deduplicationKey: `hiring-offer-declined:${applicationId}`,
    recipientIds: userIds,
    workspace: 'hr',
    feature: 'hr_hiring',
    resourceType: 'HrJobApplication',
    resourceId: applicationId,
    referenceId: applicationId,
    actionUrl: `/dashboard/hr/hiring/${applicationId}`,
    payload: {
      candidateName: `${application.candidate.firstName} ${application.candidate.lastName}`,
      positionTitle: application.position.title,
    },
  });
};

const deliverClaimedOfferNotification = async (
  applicationId: string,
  snapshotId: string,
  phoneNumber: string,
  claimToken: string,
  createdBy: string,
) => {
  const access = await resolveOfferAccessCode(applicationId, phoneNumber, createdBy);
  const sms = await hrHiringSmsGateway.sendOfferReady({ phoneNumber, code: access.otp });
  if (sms.success && access.replacementIssued) {
    await prisma.hrCandidateInvitation.updateMany({
      where: { applicationId, id: { not: access.invitationId }, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { overlapExpiresAt: new Date(Date.now() + 30 * 60_000) }
    });
  }
  const finalized = await prisma.hrCompensationSnapshot.updateMany({
    where: { id: snapshotId, candidateNotificationClaimToken: claimToken },
    data: {
      candidateNotificationStatus: sms.success ? 'SENT' : 'FAILED',
      candidateNotificationError: sms.success
        ? null
        : sms.error || 'ارسال پیامک پیشنهاد همکاری ناموفق بود.',
      candidateNotificationClaimedAt: null,
      candidateNotificationClaimToken: null,
      candidateNotifiedAt: sms.success ? new Date() : null,
      candidateNotificationAttempts: { increment: 1 }
    }
  });
  if (finalized.count !== 1) {
    return prisma.hrCompensationSnapshot.findUniqueOrThrow({
      where: { id: snapshotId }
    });
  }
  return prisma.hrCompensationSnapshot.findUniqueOrThrow({
    where: { id: snapshotId }
  });
};

const applicationInclude = {
  candidate: true,
  position: { include: { job: true, organizationalUnit: true, workplace: true, costCenter: true } },
  formRevisions: { orderBy: { revisionNumber: 'desc' as const }, take: 4 },
  invitations: { orderBy: { createdAt: 'desc' as const }, take: 5 },
  documents: { orderBy: [{ category: 'asc' as const }, { version: 'desc' as const }] },
  identityChecks: { orderBy: { fieldKey: 'asc' as const } },
  collateralItems: { orderBy: { createdAt: 'asc' as const } },
  collateralTemplate: { include: { items: { orderBy: { sortOrder: 'asc' as const } } } },
  compensationSnapshots: { orderBy: { version: 'desc' as const }, take: 3 },
  assessments: { orderBy: { recordedAt: 'desc' as const } },
  formalAssessmentPlans: { include: formalAssessmentPlanInclude, orderBy: { version: 'desc' as const } },
  preIdentityChecklistItems: { include: { events: { orderBy: { createdAt: 'desc' as const } } }, orderBy: { createdAt: 'asc' as const } },
  hiringDecisions: { orderBy: [{ kind: 'asc' as const }, { version: 'desc' as const }] },
  initialInterviewDraft: true,
  reopenings: { orderBy: { createdAt: 'desc' as const } },
  collateralRequirements: { orderBy: { version: 'desc' as const } },
  contracts: { orderBy: { version: 'desc' as const }, take: 3 },
  insuranceEnrollment: true,
  payrollParticipation: true,
  onboardingTasks: { orderBy: { createdAt: 'asc' as const } },
  employmentRelationship: { include: { personnel: true, assignments: { include: { position: true } } } },
  audits: { orderBy: { createdAt: 'desc' as const }, take: 60 }
};

const asyncHandler = (fn: (req: any, res: Response, next: NextFunction) => Promise<any>) =>
  (req: any, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

const markBroadManagerOverride = async (req: AuthRequest) => {
  if (req.user!.role === 'ADMIN') {
    (req as any).hrBroadManagerOverride = true;
    return;
  }
  if (req.user!.role === 'MANAGER') {
    const override = await authorizeHrUser(prisma, actorId(req), { workspaceLevel: 'ADMIN' });
    (req as any).hrBroadManagerOverride = override.allowed;
  }
};

const requireActionPermission = (...actionPermissionCodes: string[]) => asyncHandler(async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const assigned = await authorizeHrUser(prisma, req.user!.id, { actionPermissionCodes });
  if (!assigned.allowed) {
    return res.status(403).json({ success: false, error: 'HR_ACTION_PERMISSION_REQUIRED', missingLayers: assigned.missingLayers });
  }
  await markBroadManagerOverride(req);
  next();
});

const requireAnyActionPermission = (...actionPermissionCodes: string[]) => asyncHandler(async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  const active = await activeHrActionPermissionsForUser(prisma, req.user!.id);
  if (!actionPermissionCodes.some((code) => active.includes(code))) {
    return res.status(403).json({ success: false, error: 'HR_ACTION_PERMISSION_REQUIRED', requiredAnyOf: actionPermissionCodes });
  }
  await markBroadManagerOverride(req);
  next();
});

const activeHiringAuthoritiesForUser = (userId: string, at = new Date()) => activeHrAuthoritiesForUser(prisma, userId, at);

const requireArchiveManager = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!(await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: ['ARCHIVE_RECRUITMENT_CASE'] })).allowed) return res.status(403).json({ success: false, error: 'مجوز بایگانی پرونده استخدام لازم است.' });
  await markBroadManagerOverride(req);
  next();
});

const requireSystemAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user!.role !== 'ADMIN') return res.status(403).json({ success: false, error: 'فقط مدیر سامانه می‌تواند حذف دائمی انجام دهد.' });
  next();
};

const applicationDeletionImpact = async (applicationId: string, client: PrismaClient | Prisma.TransactionClient = prisma) => {
  const application = await (client as any).hrJobApplication.findUnique({
    where: { id: applicationId },
    include: {
      candidate: { select: { firstName: true, lastName: true } },
      employmentRelationship: true,
      invitations: true,
      formRevisions: true,
      documents: true,
      identityChecks: true,
      collateralItems: true,
      compensationSnapshots: true,
      contracts: true,
      insuranceEnrollment: true,
      payrollParticipation: true,
      onboardingTasks: true,
      audits: true,
      assessments: true,
      preIdentityChecklistItems: { include: { events: true } },
      hiringDecisions: true,
      reopenings: true,
      collateralRequirements: true,
      _count: true
    }
  });
  if (!application) return null;
  const files = [
    ...application.documents.map((item) => item.storageName),
    ...application.assessments.map((item) => item.storageName),
    ...application.preIdentityChecklistItems.map((item) => item.storageName),
    ...application.collateralItems.flatMap((item) => [item.storageName, item.returnEvidenceStorageName]),
    ...application.contracts.map((item) => item.storageName)
  ].filter(Boolean).sort() as string[];
  const counts = Object.fromEntries(Object.entries(application._count).sort(([left], [right]) => left.localeCompare(right)));
  const { _count, ...affectedSnapshot } = application;
  const fingerprintSource = { targetId: application.id, affectedSnapshot, counts, files };
  const fingerprint = stableDeletionFingerprint(fingerprintSource, process.env.JWT_SECRET || 'development-secret');
  return {
    application,
    data: {
      targetId: application.id,
      displayName: `${application.candidate.firstName} ${application.candidate.lastName}`.trim(),
      counts,
      fileCounts: { liveReferences: files.length },
      files,
      detachesEmploymentRelationship: Boolean(application.employmentRelationship),
      preserves: ['CANDIDATE', 'OTHER_APPLICATIONS', 'PERSONNEL', 'USER', 'PAYROLL', 'ATTENDANCE', 'NON_HR_HISTORY'],
      fingerprint
    }
  };
};

const requireAuthorityAdministrator = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!(await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: ['MANAGE_HR_WORK'] })).allowed) return res.status(403).json({ success: false, error: 'HR_ACTION_PERMISSION_REQUIRED' });
  await markBroadManagerOverride(req);
  next();
});

const canManageHrWork = async (req: AuthRequest) => {
  return (await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: ['MANAGE_HR_WORK'] })).allowed;
};

const requireHrWorkManager = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!(await canManageHrWork(req))) return res.status(403).json({ success: false, error: 'فقط مدیر منابع انسانی می‌تواند وظایف را تخصیص دهد.' });
  await markBroadManagerOverride(req);
  next();
});

const workItemUserSelect = { id: true, firstName: true, lastName: true, username: true } as const;
const workItemInclude = {
  assignedTo: { select: workItemUserSelect },
  completedBy: { select: workItemUserSelect },
  waivedBy: { select: workItemUserSelect }
} as const;

const endOfToday = () => {
  const dueDate = new Date();
  dueDate.setHours(23, 59, 59, 999);
  return dueDate;
};

const auditWorkItem = (workItemId: string, eventType: string, actorUserId: string | null, before: unknown, after: unknown) =>
  prisma.hrWorkItemAudit.create({ data: {
    workItemId,
    eventType,
    actorUserId,
    beforeJson: before ? JSON.parse(JSON.stringify(before)) : Prisma.JsonNull,
    afterJson: after ? JSON.parse(JSON.stringify(after)) : Prisma.JsonNull
  } });

const actionPermissionForHiringWorkAction = actionPermissionForHiringLifecycleAction;

const syncAutomaticHiringWorkItems = async () => {
  const now = new Date();
  const [activeUsers, applications] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.hrJobApplication.findMany({
      where: { archivedAt: null, stage: { not: 'CLOSED' } },
      include: applicationInclude
    })
  ]);
  const permissionsByUser = new Map<string, Set<string>>();
  const effectivePermissions = await Promise.all(activeUsers.map((user) => activeHrActionPermissionsForUser(prisma, user.id, now)));
  activeUsers.forEach((user, index) => permissionsByUser.set(user.id, new Set(effectivePermissions[index])));
  const allAuthorities = new Set(HIRING_AUTHORITY_TYPES);
  const activeSourceKeys = new Set<string>();
  const activeActionBaseKeys = new Set<string>();

  for (const application of applications) {
    const lifecycle = projectHiringLifecycle(application as any, allAuthorities, '__SYSTEM__');
    const phase = lifecycle.phases.find((item) => item.id === lifecycle.currentPhaseId);
    if (!phase || phase.status !== 'ACTION_REQUIRED') continue;
    const candidateName = `${application.candidate.firstName} ${application.candidate.lastName}`.trim();
    const actions = [phase.primaryAction, ...phase.secondaryActions].filter(Boolean) as Array<{ id: string; label: string; authorities: string[] }>;
    for (const action of actions) {
      const baseKey = automaticHiringWorkItemBaseKey(application.id, action.id);
      activeActionBaseKeys.add(baseKey);
      const requiredPermission = actionPermissionForHiringWorkAction(action.id);
      const eligibleUserIds = requiredPermission
        ? activeUsers.filter((user) => permissionsByUser.get(user.id)?.has(requiredPermission)).map((user) => user.id)
        : [];
      if (!eligibleUserIds.length) continue;
      // One source action owns one shared item. Eligibility is evaluated at read/action time.
      const assignees: Array<string | null> = [null];
      const latestCompensation = application.compensationSnapshots.find((snapshot) => !snapshot.obsoleteAt);
      const dueDate = action.id === 'VERIFY_OFFER_PAYROLL' && latestCompensation?.verificationDueAt
        ? latestCompensation.verificationDueAt
        : endOfToday();

      for (const assignedToUserId of assignees) {
        const sourceKey = automaticHiringWorkItemSourceKey(application.id, action.id, assignedToUserId);
        activeSourceKeys.add(sourceKey);
        const existing = await prisma.hrWorkItem.findUnique({ where: { sourceKey } });
        const values = {
          title: `${action.label}${candidateName ? ` — ${candidateName}` : ''}`,
          description: `پرونده متقاضی · ${application.position.title}`,
          sourceType: 'HIRING_ACTION' as const,
          destinationHref: `/dashboard/hr/hiring/${application.id}`,
          assignedToUserId,
          dueDate,
        };
        if (!existing) {
          const created = await prisma.hrWorkItem.create({ data: { ...values, sourceKey, createdByUserId: null } });
          await auditWorkItem(created.id, 'AUTOMATIC_TASK_CREATED', null, null, created);
        } else if (existing.assignedToUserId !== assignedToUserId || existing.title !== values.title || existing.dueDate.getTime() !== dueDate.getTime() || !['PENDING', 'IN_PROGRESS'].includes(existing.status)) {
          const reopened = !['PENDING', 'IN_PROGRESS'].includes(existing.status);
          const updated = await prisma.hrWorkItem.update({ where: { id: existing.id }, data: {
            ...values,
            ...(reopened ? { status: 'PENDING', completedAt: null, completedByUserId: null, waivedAt: null, waivedByUserId: null, waiverReason: null } : {})
          } });
          await auditWorkItem(existing.id, reopened ? 'SOURCE_ACTION_REOPENED' : 'AUTOMATIC_TASK_UPDATED', null, existing, updated);
        }
        for (const eligibleUserId of eligibleUserIds) {
          await publishNotificationEvent(prisma, {
            type: 'HIRING_SHARED_WORK_AVAILABLE',
            deduplicationKey: `hiring-shared-work:${sourceKey}:${eligibleUserId}`,
            recipientIds: [eligibleUserId],
            workspace: 'hr', feature: requiredPermission, resourceType: 'HrJobApplication', resourceId: application.id,
            actionUrl: values.destinationHref,
            payload: { actionLabel: action.label, candidateName },
          });
        }
      }
    }
  }

  const stale = await prisma.hrWorkItem.findMany({
    where: {
      sourceType: 'HIRING_ACTION',
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      ...(activeSourceKeys.size ? { sourceKey: { notIn: [...activeSourceKeys] } } : {})
    }
  });
  for (const item of stale) {
    const status = staleAutomaticHiringWorkItemStatus(item.sourceKey || '', activeActionBaseKeys);
    const updated = await prisma.hrWorkItem.update({ where: { id: item.id }, data: status === 'COMPLETE'
      ? { status, completedAt: now, completedByUserId: null }
      : { status, waivedAt: now, waivedByUserId: null, waiverReason: 'SYSTEM_ELIGIBILITY_ENDED' }
    });
    await auditWorkItem(item.id, status === 'COMPLETE' ? 'SOURCE_ACTION_COMPLETED' : 'SOURCE_ELIGIBILITY_ENDED', null, item, updated);
  }
};

const filterHrWorkItemsForUser = async <T extends { sourceType: string; sourceKey: string | null; assignedToUserId: string | null }>(rows: T[], userId: string) => {
  const permissions = new Set(await activeHrActionPermissionsForUser(prisma, userId));
  return rows.filter((row) => {
    if (row.sourceType !== 'HIRING_ACTION') return row.assignedToUserId === userId;
    const match = row.sourceKey?.match(/^HIRING:([^:]+):([^:]+):UNASSIGNED$/);
    const requiredPermission = match ? actionPermissionForHiringWorkAction(match[2]) : null;
    return Boolean(requiredPermission && permissions.has(requiredPermission));
  });
};

interface ApplicantRequest extends express.Request { applicant?: { applicationId: string; invitationId: string } }
const applicantSession = async (req: ApplicantRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'development-secret') as any;
    if (payload.kind !== 'HR_APPLICANT') throw new Error('Wrong token kind');
    const invitation = await prisma.hrCandidateInvitation.findUnique({ where: { id: payload.invitationId }, include: { application: { select: { stage: true, archivedAt: true } } } });
    if (!invitation || invitation.applicationId !== payload.applicationId || invitation.revokedAt || invitation.expiresAt <= new Date() || invitation.application.stage === 'CLOSED' || invitation.application.archivedAt) throw new Error('Expired invitation');
    req.applicant = { applicationId: payload.applicationId, invitationId: payload.invitationId };
    next();
  } catch {
    res.status(401).json({ success: false, error: 'نشست متقاضی معتبر نیست.' });
  }
};

type AccessSubjectKind = 'PHONE' | 'IP';

const activeThrottle = async (subjectKind: AccessSubjectKind, subjectHash: string) => {
  const throttle = await prisma.hrCandidateAccessThrottle.findUnique({ where: { subjectKind_subjectHash: { subjectKind, subjectHash } } });
  return throttle?.blockedUntil && throttle.blockedUntil > new Date() ? throttle : null;
};

const registerAccessFailure = async (subjectKind: AccessSubjectKind, subjectHash: string, limit: number) => {
  const now = new Date();
  const windowThreshold = new Date(now.getTime() - ACCESS_WINDOW_MS);
  const blockedUntil = new Date(now.getTime() + ACCESS_BLOCK_MS);
  const rows = await prisma.$queryRaw<Array<{ failedAttempts: number; blockedUntil: Date | null }>>(Prisma.sql`
    INSERT INTO "hr_candidate_access_throttles"
      ("id", "subjectKind", "subjectHash", "failedAttempts", "windowStartedAt", "blockedUntil", "lastAttemptAt", "createdAt", "updatedAt")
    VALUES
      (${crypto.randomUUID()}, ${subjectKind}, ${subjectHash}, 1, ${now}, NULL, ${now}, ${now}, ${now})
    ON CONFLICT ("subjectKind", "subjectHash") DO UPDATE SET
      "failedAttempts" = CASE
        WHEN "hr_candidate_access_throttles"."windowStartedAt" <= ${windowThreshold} THEN 1
        ELSE "hr_candidate_access_throttles"."failedAttempts" + 1
      END,
      "windowStartedAt" = CASE
        WHEN "hr_candidate_access_throttles"."windowStartedAt" <= ${windowThreshold} THEN ${now}
        ELSE "hr_candidate_access_throttles"."windowStartedAt"
      END,
      "blockedUntil" = CASE
        WHEN (CASE
          WHEN "hr_candidate_access_throttles"."windowStartedAt" <= ${windowThreshold} THEN 1
          ELSE "hr_candidate_access_throttles"."failedAttempts" + 1
        END) >= ${limit} THEN ${blockedUntil}
        ELSE NULL
      END,
      "lastAttemptAt" = ${now},
      "updatedAt" = ${now}
    RETURNING "failedAttempts", "blockedUntil"
  `);
  return rows[0];
};

const recordAccessAttempt = (req: express.Request, data: { mobileHash: string; ipHash: string; outcome: string; invitationId?: string; applicationId?: string }) =>
  prisma.hrCandidateAccessAttempt.create({ data: { ...data, userAgent: req.get('user-agent') } });

// Fixed public applicant entry: mobile identifies the recipient and OTP identifies one Application.
router.post('/public/invitations/verify', asyncHandler(async (req: express.Request, res: Response) => {
  const mobile = normalizeApplicantMobile(req.body.mobile);
  const otp = normalizeApplicantOtp(req.body.otp);
  const mobileThrottleValue = mobile || `INVALID:${normalizeApplicantDigits(req.body.mobile).slice(0, 32)}`;
  const mobileHash = applicantSubjectHash('PHONE', mobileThrottleValue);
  const ipHash = applicantSubjectHash('IP', req.ip || 'unknown');
  const [phoneBlocked, ipBlocked] = await Promise.all([activeThrottle('PHONE', mobileHash), activeThrottle('IP', ipHash)]);
  if (phoneBlocked || ipBlocked) {
    await recordAccessAttempt(req, { mobileHash, ipHash, outcome: 'THROTTLED' });
    return res.status(429).json({ success: false, error: phoneBlocked ? CONTACT_HR_ACCESS_ERROR : THROTTLED_ACCESS_ERROR });
  }

  const invitation = mobile && otp ? await prisma.hrCandidateInvitation.findFirst({
    where: {
      mobileSnapshot: mobile,
      otpHash: applicantOtpHash(mobile, otp),
      ...invitationIsUsableWhere(),
      application: { stage: { not: 'CLOSED' }, archivedAt: null }
    },
    include: { application: { include: { candidate: true } } }
  }) : null;

  if (!invitation) {
    const [phoneThrottle, ipThrottle] = await Promise.all([
      registerAccessFailure('PHONE', mobileHash, PHONE_FAILURE_LIMIT),
      registerAccessFailure('IP', ipHash, IP_FAILURE_LIMIT)
    ]);
    if (phoneThrottle.failedAttempts >= PHONE_FAILURE_LIMIT && mobile) {
      const activeApplications = await prisma.hrCandidateInvitation.findMany({
        where: { mobileSnapshot: mobile, ...invitationIsUsableWhere(), application: { stage: { not: 'CLOSED' }, archivedAt: null } },
        select: { applicationId: true }, distinct: ['applicationId']
      });
      // A wrong code cannot identify the intended Application. Revoke credentials
      // only when the active Application is unambiguous; HR reissues the selected one.
      await prisma.$transaction([
        ...(activeApplications.length === 1 ? [prisma.hrCandidateInvitation.updateMany({ where: { applicationId: activeApplications[0].applicationId, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
        prisma.hrCandidateAccessThrottle.update({ where: { subjectKind_subjectHash: { subjectKind: 'PHONE', subjectHash: mobileHash } }, data: { blockedUntil: plusDays(3650) } })
      ]);
    }
    await recordAccessAttempt(req, { mobileHash, ipHash, outcome: 'REJECTED' });
    const phoneRevoked = phoneThrottle.failedAttempts >= PHONE_FAILURE_LIMIT;
    const ipBlockedNow = ipThrottle.blockedUntil && ipThrottle.blockedUntil > new Date();
    return res.status(phoneRevoked || ipBlockedNow ? 429 : 401).json({ success: false, error: phoneRevoked ? CONTACT_HR_ACCESS_ERROR : ipBlockedNow ? THROTTLED_ACCESS_ERROR : INVALID_ACCESS_ERROR });
  }

  const newestInvitation = await prisma.hrCandidateInvitation.findFirst({ where: { applicationId: invitation.applicationId, revokedAt: null }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  await prisma.$transaction([
    prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: { lastVerifiedAt: new Date(), accessConfirmedAt: new Date(), verificationCount: { increment: 1 } } }),
    ...(newestInvitation?.id === invitation.id ? [prisma.hrCandidateInvitation.updateMany({ where: { applicationId: invitation.applicationId, id: { not: invitation.id }, revokedAt: null }, data: { revokedAt: new Date() } })] : []),
    prisma.hrCandidateAccessThrottle.deleteMany({ where: { subjectKind: 'PHONE', subjectHash: mobileHash } }),
    prisma.hrCandidateAccessAttempt.create({ data: { mobileHash, ipHash, invitationId: invitation.id, applicationId: invitation.applicationId, outcome: 'VERIFIED', userAgent: req.get('user-agent') } })
  ]);
  await audit(invitation.applicationId, 'APPLICANT_OTP_VERIFIED', req, { invitationId: invitation.id }, 'CANDIDATE');
  const remainingSeconds = Math.max(1, Math.floor((invitation.expiresAt.getTime() - Date.now()) / 1000));
  const session = jwt.sign({ kind: 'HR_APPLICANT', applicationId: invitation.applicationId, invitationId: invitation.id }, process.env.JWT_SECRET || 'development-secret', { expiresIn: remainingSeconds });
  res.json({ success: true, data: { session, candidateName: `${invitation.application.candidate.firstName} ${invitation.application.candidate.lastName}` } });
}));

router.get('/public/application', applicantSession, asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({
    where: { id: req.applicant!.applicationId },
    include: {
      candidate: { select: { firstName: true, lastName: true, mobile: true } },
      position: { select: { title: true, job: { select: { title: true } } } },
      formRevisions: { orderBy: { revisionNumber: 'desc' }, take: 2 },
      compensationSnapshots: { orderBy: { version: 'desc' }, take: 1 },
      collateralRequirements: { where: { status: 'ACTIVE' }, orderBy: { version: 'desc' }, take: 1 },
      formalAssessmentPlans: { include: formalAssessmentPlanInclude, orderBy: { version: 'desc' } }
    }
  });
  const compensation = application.compensationSnapshots.find((snapshot) => !snapshot.obsoleteAt);
  const activeFormalAssessmentPlan = application.formalAssessmentPlans.find((plan) => plan.status === 'ACTIVE');
  const formalAssessmentEvidence = projectFormalAssessmentEvidenceGate(application.formalAssessmentPlans as any);
  res.json({ success: true, data: {
    id: application.id,
    stage: application.stage,
    candidate: application.candidate,
    position: application.position,
    revision: application.formRevisions[0] || null,
    correctionSource: application.formRevisions.find((item) => item.status === 'RETURNED') || null,
    compensation: isCompensationPayrollVerified(compensation) ? { ...compensation, collateralRequirement: application.collateralRequirements[0] || null } : null,
    formalAssessments: activeFormalAssessmentPlan
      ? {
          planVersion: activeFormalAssessmentPlan.version,
          selections: activeFormalAssessmentPlan.selections
            .filter((selection) => selection.selected && selection.executionMethod === 'APPLICANT')
            .map((selection) => ({
              assessmentKind: selection.assessmentKind,
              completed: formalAssessmentEvidence.completedKinds.includes(selection.assessmentKind as FormalAssessmentKind),
            })),
        }
      : null,
  }});
}));

router.post('/public/application/formal-assessments/:kind/result', applicantSession, asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const applicationId = req.applicant!.applicationId;
  const kind = String(req.params.kind || '') as FormalAssessmentKind;
  if (!FORMAL_ASSESSMENT_KINDS.includes(kind)) throw new Error('نوع ارزیابی رسمی نامعتبر است.');
  const responseJson = normalizeCandidateAssessmentResult(kind, req.body?.result);
  const row = await prisma.$transaction(async (tx) => {
    const plan = await tx.hrFormalAssessmentPlan.findFirstOrThrow({
      where: { applicationId, status: 'ACTIVE' },
      include: formalAssessmentPlanInclude,
      orderBy: { version: 'desc' },
    });
    const selection = plan.selections.find((item) => item.selected && item.assessmentKind === kind);
    if (!selection || selection.executionMethod !== 'APPLICANT') throw new Error('این ارزیابی برای تکمیل توسط متقاضی فعال نیست.');
    const latest = await tx.hrFormalAssessmentResult.findFirst({ where: { applicationId, assessmentKind: kind }, orderBy: { resultVersion: 'desc' } });
    authorizeFormalAssessmentResultCommand({ executionMethod: 'APPLICANT', actorKind: 'APPLICANT', actorAuthorities: [], hasCompletedResult: latest?.status === 'COMPLETED', correctionReason: '' });
    const resultVersion = latest?.resultVersion ?? 1;
    if (!latest || latest.status !== 'PENDING' || latest.planId !== plan.id) throw new Error('نسخه در انتظار نتیجه برای این ارزیابی پیدا نشد.');
    return tx.hrFormalAssessmentResult.update({ where: { id: latest.id }, data: {
      status: 'COMPLETED',
      resultJson: responseJson as Prisma.InputJsonValue,
      recordedAt: new Date(),
      attempts: { create: {
        stableKey: `formal-assessment-attempt:${applicationId}:${kind}:${resultVersion}:1`,
        attemptNumber: 1,
        executionMethod: 'APPLICANT',
        status: 'COMPLETED',
        completedAt: new Date(),
        responseJson: responseJson as Prisma.InputJsonValue,
      } },
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(applicationId, 'FORMAL_ASSESSMENT_RESULT_COMPLETED', req, { assessmentKind: kind, resultVersion: row.resultVersion, executionMethod: 'APPLICANT' }, 'CANDIDATE');
  res.status(201).json({ success: true, data: { assessmentKind: row.assessmentKind, resultVersion: row.resultVersion, status: row.status } });
}));

router.post('/public/application/formal-assessments/:kind/evidence', applicantSession, upload.array('files', 5), asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const applicationId = req.applicant!.applicationId;
  const kind = String(req.params.kind || '') as FormalAssessmentKind;
  if (!FORMAL_ASSESSMENT_KINDS.includes(kind)) throw new Error('نوع ارزیابی رسمی نامعتبر است.');
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  if (!files.length) throw new Error('حداقل یک فایل برای بارگذاری انتخاب کنید.');
  if (files.some((file) => file.size > 10 * 1024 * 1024)) {
    files.forEach((file) => removeHiringFile(file.path));
    throw new Error('حجم هر پیوست ارزیابی رسمی باید حداکثر ۱۰ مگابایت باشد.');
  }
  try {
    const result = await prisma.hrFormalAssessmentResult.findFirst({
      where: { applicationId, assessmentKind: kind, status: 'COMPLETED' },
      include: { attempts: { where: { executionMethod: 'APPLICANT', status: 'COMPLETED' }, orderBy: { attemptNumber: 'desc' }, take: 1 } },
      orderBy: { resultVersion: 'desc' },
    });
    const attempt = result?.attempts[0];
    if (!attempt) throw new Error('ابتدا نتیجه ارزیابی را ثبت کنید.');
    const stored: Array<{ id: string; originalName: string | null; mimeType: string | null; size: number | null }> = [];
    for (const file of files) {
      validateHiringFileSignature(file.path, file.mimetype);
      const [scanStatus, digest, aggregate] = await Promise.all([
        scanHiringFile(file.path),
        sha256File(file.path),
        prisma.hrHiringDocument.aggregate({
          where: { applicationId, category: 'FORMAL_ASSESSMENT', side: kind, customTitle: file.originalname },
          _max: { version: true },
        }),
      ]);
      const document = await prisma.hrHiringDocument.create({ data: {
        applicationId,
        category: 'FORMAL_ASSESSMENT',
        side: kind,
        customTitle: file.originalname,
        version: (aggregate._max.version || 0) + 1,
        inspectionSource: 'COPY_RECEIVED',
        storageName: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        sha256: digest,
        malwareScanStatus: scanStatus,
        uploadedBy: `APPLICANT:${applicationId}`,
        formalAssessmentEvidenceLinks: { create: {
          stableKey: `formal-assessment-evidence:${attempt.id}:${crypto.randomUUID()}`,
          attemptId: attempt.id,
          evidenceType: 'APPLICANT_ATTACHMENT',
          evidenceHash: digest,
        } },
      } });
      stored.push({ id: document.id, originalName: document.originalName, mimeType: document.mimeType, size: document.size });
    }
    await audit(applicationId, 'FORMAL_ASSESSMENT_EVIDENCE_UPLOADED', req, { assessmentKind: kind, count: stored.length }, 'CANDIDATE');
    res.status(201).json({ success: true, data: stored });
  } catch (error) {
    files.forEach((file) => removeHiringFile(file.path));
    throw error;
  }
}));

router.put('/public/application/draft', applicantSession, asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const applicationId = req.applicant!.applicationId;
  const normalizedBody = normalizeCoveredHiringAmounts(req.body || {});
  const latest = await prisma.hrApplicationFormRevision.findFirst({ where: { applicationId }, orderBy: { revisionNumber: 'desc' } });
  const allowedCorrectionFields = Array.isArray(latest?.correctionFieldsJson) ? latest.correctionFieldsJson.map(String) : [];
  if (latest && allowedCorrectionFields.length) {
    const previous = latest.dataJson as Record<string, unknown>;
    const attempted = Object.keys(normalizedBody).filter((key) => !allowedCorrectionFields.includes(key) && JSON.stringify(normalizedBody[key]) !== JSON.stringify(previous[key]));
    if (attempted.length) return res.status(422).json({ success: false, error: `فقط فیلدهای مشخص‌شده قابل اصلاح‌اند: ${allowedCorrectionFields.join(', ')}` });
  }
  let revision;
  if (!latest) {
    revision = await prisma.hrApplicationFormRevision.create({ data: { applicationId, revisionNumber: 1, dataJson: normalizedBody as Prisma.InputJsonValue } });
  } else if (latest.status === 'RETURNED') {
    revision = await prisma.hrApplicationFormRevision.create({ data: {
      applicationId, revisionNumber: latest.revisionNumber + 1,
      dataJson: { ...(latest.dataJson as any), ...normalizedBody } as Prisma.InputJsonValue,
      correctionFieldsJson: latest.correctionFieldsJson as Prisma.InputJsonValue,
      correctionDetailsJson: latest.correctionDetailsJson as Prisma.InputJsonValue,
      correctionReason: latest.correctionReason
    }});
  } else if (latest.status === 'DRAFT') {
    const dataJson = allowedCorrectionFields.length
      ? { ...(latest.dataJson as any), ...normalizedBody }
      : normalizedBody;
    revision = await prisma.hrApplicationFormRevision.update({
      where: { id: latest.id },
      data: { dataJson: dataJson as Prisma.InputJsonValue }
    });
  } else {
    return res.status(409).json({ success: false, error: 'فرم ارسال‌شده قفل است و باید توسط منابع انسانی برای اصلاح بازگردانده شود.' });
  }
  await prisma.hrJobApplication.update({ where: { id: applicationId }, data: { currentRevisionNumber: revision.revisionNumber } });
  res.json({ success: true, data: revision });
}));

router.post('/public/application/submit', applicantSession, asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const applicationId = req.applicant!.applicationId;
  const latest = await prisma.hrApplicationFormRevision.findFirst({ where: { applicationId }, orderBy: { revisionNumber: 'desc' } });
  if (!latest || latest.status !== 'DRAFT') return res.status(409).json({ success: false, error: 'پیش‌نویس قابل ارسال پیدا نشد.' });
  const data = latest.dataJson as any;
  const correctionFields = Array.isArray(latest.correctionFieldsJson)
    ? latest.correctionFieldsJson.map(String)
    : [];
  if (correctionFields.length) validateHiringCorrection(data, correctionFields);
  else validateHiringQuestionnaire(data);
  const applicantAssessmentState = await formalAssessmentEvidenceFor(applicationId);
  const activeAssessmentPlan = applicantAssessmentState.plans.find((plan) => plan.status === 'ACTIVE');
  const packageExecutionMethod = activeAssessmentPlan?.executionMethod
    || activeAssessmentPlan?.selections.find((selection) => selection.selected)?.executionMethod
    || null;
  if (packageExecutionMethod === 'APPLICANT' && !applicantAssessmentState.evidence.complete) {
    throw new Error('پیش از ارسال نهایی فرم، امتیازهای همه ارزیابی‌های انتخاب‌شده را تکمیل کنید.');
  }
  const declarationFullName = normalizedName(req.body.declarationFullName);
  if (!req.body.declarationAccepted || !declarationFullName) throw new Error('پذیرش اظهارنامه و نام کامل الزامی است.');
  if (declarationFullName !== normalizedName(`${data.firstName} ${data.lastName}`)) throw new Error('نام اظهارنامه باید با نام و نام خانوادگی فرم یکسان باشد.');
  await prisma.$transaction(async (tx) => {
    const application = await tx.hrJobApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { candidateId: true } });
    const existingCandidate = data.identityKind === 'FOREIGN'
      ? await tx.hrCandidate.findUnique({ where: { foreignIdentityType_foreignIdentityNumber: { foreignIdentityType: data.foreignIdentityType, foreignIdentityNumber: data.foreignIdentityNumber } } })
      : await tx.hrCandidate.findUnique({ where: { nationalCode: data.nationalCode } });
    const targetCandidateId = existingCandidate?.id || application.candidateId;
    await tx.hrApplicationFormRevision.update({ where: { id: latest.id }, data: {
      status: 'SUBMITTED', declarationAccepted: true, declarationFullName,
      submittedAt: new Date(), submittedIp: req.ip, submittedUserAgent: req.get('user-agent')
    }});
    await tx.hrCandidate.update({ where: { id: targetCandidateId }, data: {
      firstName: data.firstName, lastName: data.lastName, mobile: data.mobile,
      nationalCode: data.identityKind === 'FOREIGN' ? null : data.nationalCode,
      foreignIdentityType: data.identityKind === 'FOREIGN' ? data.foreignIdentityType : null,
      foreignIdentityNumber: data.identityKind === 'FOREIGN' ? data.foreignIdentityNumber : null,
      postalCode: data.postalCode,
      hasSocialSecurityHistory: data.hasSocialSecurityHistory,
      profileJson: data as Prisma.InputJsonValue,
      privacyNoticeAcceptedAt: new Date()
    }});
    await tx.hrJobApplication.update({ where: { id: applicationId }, data: { candidateId: targetCandidateId, stage: 'SCREENING', currentRevisionNumber: latest.revisionNumber } });
    if (targetCandidateId !== application.candidateId && await tx.hrJobApplication.count({ where: { candidateId: application.candidateId } }) === 0) await tx.hrCandidate.delete({ where: { id: application.candidateId } });
  });
  await audit(applicationId, 'APPLICATION_FORM_SUBMITTED', req, { revisionNumber: latest.revisionNumber }, 'CANDIDATE');
  res.json({ success: true });
}));

router.post('/public/application/compensation/accept', applicantSession, asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const applicationId = req.applicant!.applicationId;
  const [snapshot, application, submittedFullName] = await Promise.all([
    prisma.hrCompensationSnapshot.findFirst({ where: { applicationId }, orderBy: { version: 'desc' } }),
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: applicationId } }),
    latestSubmittedFullName(applicationId)
  ]);
  const formalAssessmentGate = await formalAssessmentEvidenceFor(applicationId);
  if (!formalAssessmentGate.evidence.complete) return res.status(409).json({ success: false, error: 'ارزیابی‌های رسمی انتخاب‌شده هنوز تکمیل نشده‌اند.' });
  if (!snapshot || !isCompensationPayrollVerified(snapshot) || snapshot.obsoleteAt) return res.status(409).json({ success: false, error: 'پیشنهاد جبران خدمات هنوز بررسی نشده یا منسوخ شده است.' });
  if (snapshot.candidateDecision) return res.status(409).json({ success: false, error: 'برای این نسخه قبلاً تصمیم ثبت شده است.' });
  if (req.body.accepted !== true) throw new Error('تأیید صریح پذیرش پیشنهاد الزامی است.');
  const acceptedName = normalizedName(req.body.fullName);
  if (!acceptedName || acceptedName !== submittedFullName) throw new Error('نام کامل باید با آخرین فرم ثبت‌شده متقاضی یکسان باشد.');
  await prisma.$transaction(async (tx) => {
    const latest = await tx.hrCompensationSnapshot.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
      select: { id: true }
    });
    if (latest?.id !== snapshot.id) throw new Error('نسخه جدیدتری از پیشنهاد ثبت شده است. صفحه را دوباره بارگذاری کنید.');
    const now = new Date();
    const decision = await tx.hrCompensationSnapshot.updateMany({
      where: { id: snapshot.id, candidateDecision: null },
      data: {
        candidateAcceptedAt: now,
        candidateAcceptedName: acceptedName,
        candidateDecision: 'ACCEPTED',
        candidateDecisionAt: now,
        candidateDecisionSource: 'CANDIDATE_PORTAL'
      }
    });
    if (decision.count !== 1) throw new Error('برای این نسخه قبلاً تصمیم ثبت شده است.');
    await tx.hrJobApplication.update({
      where: { id: applicationId },
      data: { acceptedOfferAt: now, stage: 'OFFER', compensationClearance: 'APPROVED' }
    });
    await reconcileAcceptedOfferFollowUp(tx, {
      applicationId, actorUserId: snapshot.proposedBy, now,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(applicationId, 'OFFER_COMPENSATION_ACCEPTED', req, { snapshotId: snapshot.id }, 'CANDIDATE');
  res.json({ success: true });
}));

router.post('/public/application/compensation/decline', applicantSession, asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const applicationId = req.applicant!.applicationId;
  const [snapshot, application] = await Promise.all([
    prisma.hrCompensationSnapshot.findFirst({ where: { applicationId }, orderBy: { version: 'desc' } }),
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: applicationId } })
  ]);
  if (!snapshot || !isCompensationPayrollVerified(snapshot) || snapshot.obsoleteAt) return res.status(409).json({ success: false, error: 'پیشنهاد همکاری هنوز بررسی نشده یا منسوخ شده است.' });
  const formalAssessmentGate = await formalAssessmentEvidenceFor(applicationId);
  if (!formalAssessmentGate.evidence.complete) return res.status(409).json({ success: false, error: 'ارزیابی‌های رسمی انتخاب‌شده هنوز تکمیل نشده‌اند.' });
  if (snapshot.candidateDecision) return res.status(409).json({ success: false, error: 'برای این نسخه قبلاً تصمیم ثبت شده است.' });
  const category = String(req.body.category || '');
  if (!['COMPENSATION', 'ROLE', 'START_DATE', 'PERSONAL', 'OTHER'].includes(category)) throw new Error('انتخاب دلیل رد پیشنهاد الزامی است.');
  const note = String(req.body.note || '').trim() || null;
  await prisma.$transaction(async (tx) => {
    const latest = await tx.hrCompensationSnapshot.findFirst({
      where: { applicationId },
      orderBy: { version: 'desc' },
      select: { id: true }
    });
    if (latest?.id !== snapshot.id) throw new Error('نسخه جدیدتری از پیشنهاد ثبت شده است. صفحه را دوباره بارگذاری کنید.');
    const decision = await tx.hrCompensationSnapshot.updateMany({
      where: { id: snapshot.id, candidateDecision: null },
      data: {
        candidateDecision: 'DECLINED',
        candidateDecisionAt: new Date(),
        candidateDecisionSource: 'CANDIDATE_PORTAL',
        candidateDeclineCategory: category,
        candidateDecisionNote: note
      }
    });
    if (decision.count !== 1) throw new Error('برای این نسخه قبلاً تصمیم ثبت شده است.');
    await tx.hrJobApplication.update({
      where: { id: applicationId },
      data: {
        acceptedOfferAt: null,
        stage: 'OFFER',
        compensationClearance: 'REJECTED'
      }
    });
    await notifyOfferDecline(tx, applicationId);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(applicationId, 'OFFER_DECLINED', req, { snapshotId: snapshot.id, category, note }, 'CANDIDATE');
  res.json({ success: true });
}));

// The aggregate endpoint is authenticated but intentionally sits outside the broader
// HR workspace boundary so accounting-only users receive a non-leaking unavailable state.
router.use(protect);

router.get('/dashboard-metrics', asyncHandler(async (req: AuthRequest, res: Response) => {
  const generatedAt = new Date();
  const [authorities, actionPermissions] = await Promise.all([
    activeHiringAuthoritiesForUser(actorId(req), generatedAt),
    activeHrActionPermissionsForUser(prisma, actorId(req), generatedAt),
  ]);
  const hasFinanceAuthority = actionPermissions.includes('MANAGE_FINANCE_EVIDENCE');

  Object.entries(HR_HIRING_DASHBOARD_METRICS_CACHE_HEADERS).forEach(([name, value]) => {
    res.set(name, value);
  });

  if (!hasFinanceAuthority) {
    return res.json({ success: true, data: buildHrHiringDashboardMetrics({
      viewerUserId: actorId(req),
      viewerAuthorities: authorities,
      applications: [],
      activeCollateralTemplates: 0,
      generatedAt
    }) });
  }

  const [applications, activeCollateralTemplates] = await Promise.all([
    prisma.hrJobApplication.findMany({
      where: { archivedAt: null },
      include: applicationInclude
    }),
    prisma.hrCollateralChecklistTemplate.count({ where: { isActive: true } })
  ]);
  const data = buildHrHiringDashboardMetrics({
    viewerUserId: actorId(req),
    viewerAuthorities: authorities,
    applications,
    activeCollateralTemplates,
    generatedAt
  });
  res.json({ success: true, data });
}));

// Authenticated HR workspace. Workspace, feature, and business-authority
// decisions are intentionally evaluated as separate layers.
const actionProtectedHiringMutationPaths = [
  /^\/interview-criteria\/publish$/,
  /^\/work-items(?:\/[^/]+)?$/,
  /^\/pre-identity\/templates$/,
  /^\/collateral-templates(?:\/[^/]+\/active)?$/,
  /^\/deletion-receipts\/[^/]+\/retry-files$/,
  /^\/applications$/,
  /^\/applications\/[^/]+\/(?:archive|restore|permanent-delete|form\/return|identity\/approve|final-rejection|convert|activate|close)$/,
  /^\/applications\/[^/]+\/company-evaluations(?:\/[^/]+\/(?:cancel|result))?$/,
  /^\/applications\/[^/]+\/invitations(?:\/[^/]+\/delivery\/refresh)?$/,
  /^\/applications\/[^/]+\/form\/correction\/retry$/,
  /^\/applications\/[^/]+\/documents$/,
  /^\/applications\/[^/]+\/identity-checks\/[^/]+$/,
  /^\/applications\/[^/]+\/compensation(?:\/[^/]+\/(?:payroll-review|prepare|hr-approve|finance-approve|notification\/retry|offline-decision))?$/,
  /^\/applications\/[^/]+\/formal-assessment-plans$/,
  /^\/applications\/[^/]+\/formal-assessments\/[^/]+\/(?:result|evidence)$/,
  /^\/applications\/[^/]+\/assessments(?:\/complete|\/review-acknowledge|\/decision|\/[^/]+\/(?:revise|void))?$/,
  /^\/applications\/[^/]+\/initial-interview\/draft$/,
  /^\/applications\/[^/]+\/decisions\/[^/]+$/,
  /^\/applications\/[^/]+\/pre-identity\/(?:apply-template|finalize|release|items|items\/[^/]+\/(?:correct|result|resolve))$/,
  /^\/applications\/[^/]+\/disposition\/reactivate$/,
  /^\/applications\/[^/]+\/reopen\/(?:authorize|execute)$/,
  /^\/applications\/[^/]+\/collateral-requirements(?:\/not-required)?$/,
  /^\/applications\/[^/]+\/collateral(?:\/apply-template|\/approve|\/[^/]+\/(?:review|return|return-confirm))?$/,
  /^\/applications\/[^/]+\/contracts(?:\/[^/]+\/(?:submit|approve|return))?$/,
  /^\/applications\/[^/]+\/(?:payroll-participation|insurance|onboarding-tasks)$/,
  /^\/applications\/[^/]+\/onboarding-tasks\/[^/]+$/,
] as const;

export const hrHiringBaseFeatureLevelForRequest = (method: string, path: string) => {
  if (path.startsWith('/authorities')) return 'ADMIN' as const;
  if (method === 'GET') return 'VIEW' as const;
  return actionProtectedHiringMutationPaths.some((pattern) => pattern.test(path))
    ? 'VIEW' as const
    : 'EDIT' as const;
};

export const hrHiringBaseFeatureForRequest = (path: string) => {
  if (path === '/work-items/summary') return null;
  if (path.startsWith('/work-items')) return 'HR_WORK_MANAGEMENT';
  if (path.startsWith('/authorities')) return 'AUTHORITY_RESPONSIBILITY_ADMINISTRATION';
  return 'RECRUITMENT_CASES';
};

router.use(asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (/^\/applications\/[^/]+(?:\/collateral(?:\/.*)?|\/collateral-returns\/[^/]+\/download)?$/.test(req.path)) {
    const permissions = await activeHrActionPermissionsForUser(prisma, actorId(req));
    if (permissions.includes('RECORD_COLLATERAL_CUSTODY') || permissions.includes('VERIFY_COLLATERAL_CUSTODY')) return next();
  }
  const featureCode = hrHiringBaseFeatureForRequest(req.path);
  const level = hrHiringBaseFeatureLevelForRequest(req.method, req.path);
  if (!featureCode) {
    return requireHrAuthorization({ workspaceLevel: level })(req, res, next);
  }
  return requireHrFeature(featureCode, level)(req, res, next);
}));

router.use('/authorities', (_req, res) => res.status(410).json({ success: false, error: 'HR_LEGACY_AUTHORIZATION_READ_ONLY' }));

// A disposition pauses the case without destroying evidence. Ordinary mutations must
// resume through the explicit reactivation command before work can continue.
router.use('/applications/:id', asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.method === 'GET') return next();
  const application = await prisma.hrJobApplication.findUnique({ where: { id: req.params.id }, select: { disposition: true, archivedAt: true } });
  const retentionAction = /\/(archive|restore|deletion-preview|permanent-delete)$/.test(req.path);
  if (!retentionAction) {
    try { assertArchivedRecordMutable(application?.archivedAt); } catch (error) {
      return res.status(409).json({ success: false, error: error instanceof Error ? error.message : 'پرونده بایگانی‌شده قابل تغییر نیست.' });
    }
  }
  if (retentionAction || /\/(disposition\/reactivate|reopen\/authorize|reopen\/execute|close)$/.test(req.path)) return next();
  if (application?.disposition) return res.status(409).json({ success: false, error: 'پرونده متوقف است؛ پیش از ادامه باید صریحاً دوباره فعال شود.' });
  next();
}));

router.get('/me/authorities', asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await activeHiringAuthoritiesForUser(actorId(req)) });
}));

router.get('/me/action-permissions', asyncHandler(async (req: AuthRequest, res: Response) => {
  res.json({ success: true, data: await activeHrActionPermissionsForUser(prisma, actorId(req)) });
}));

router.get('/interview-criteria', requireActionPermission('VIEW_INITIAL_INTERVIEW_CRITERIA'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const latest = await prisma.hrInterviewCriteriaVersion.findFirst({ orderBy: { version: 'desc' } });
  const canManage = (await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: ['MANAGE_INITIAL_INTERVIEW_CRITERIA'] })).allowed;
  res.json({
    success: true,
    data: {
      ...(latest ?? {
        version: 1,
        criteriaJson: normalizeInterviewCriteriaPublication(DEFAULT_INTERVIEW_CRITERIA),
      }),
      canManage,
    },
  });
}));

router.post('/interview-criteria/publish', requireActionPermission('MANAGE_INITIAL_INTERVIEW_CRITERIA'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const criteria = normalizeInterviewCriteriaPublication(req.body.criteria);
  let row;
  for (let attempt = 0; attempt < 3 && !row; attempt += 1) {
    try {
      row = await prisma.$transaction(async (tx) => {
        const latest = await tx.hrInterviewCriteriaVersion.aggregate({ _max: { version: true } });
        return tx.hrInterviewCriteriaVersion.create({ data: {
          version: (latest._max.version ?? 0) + 1,
          criteriaJson: criteria as Prisma.InputJsonValue,
          publishedByUserId: actorId(req),
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code) || attempt === 2) throw error;
    }
  }
  if (!row) throw Object.assign(new Error('انتشار هم‌زمان بود؛ دوباره تلاش کنید.'), { statusCode: 409 });
  res.status(201).json({ success: true, data: row });
}));

router.get('/applications/:id/company-evaluations', requireActionPermission('VIEW_COMPANY_EVALUATION_RESULTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const rows = await prisma.hrCompanyEvaluationOccurrence.findMany({ where: { applicationId: req.params.id }, orderBy: [{ createdAt: 'asc' }] });
  res.json({ success: true, data: rows });
}));

router.post('/applications/:id/company-evaluations', requireActionPermission('MANAGE_COMPANY_EVALUATION_PLAN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const command = normalizeCompanyEvaluationPlanItem(req.body);
  let row;
  for (let attempt = 0; attempt < 3 && !row; attempt += 1) {
    try {
      row = await prisma.$transaction(async (tx) => {
        const existing = await tx.hrCompanyEvaluationOccurrence.findMany({ where: { applicationId: req.params.id, type: command.type }, select: { occurrenceNumber: true } });
        return tx.hrCompanyEvaluationOccurrence.create({ data: {
          applicationId: req.params.id,
          ...command,
          occurrenceNumber: nextEvaluationOccurrenceNumber(existing.map(({ occurrenceNumber }) => occurrenceNumber)),
          createdByUserId: actorId(req),
        } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code) || attempt === 2) throw error;
    }
  }
  if (!row) throw Object.assign(new Error('ثبت هم‌زمان ارزیابی ناموفق بود؛ دوباره تلاش کنید.'), { statusCode: 409 });
  await audit(req.params.id, 'COMPANY_EVALUATION_ADDED', req, { occurrenceId: row.id, type: row.type, occurrenceNumber: row.occurrenceNumber });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/company-evaluations/:occurrenceId/cancel', requireActionPermission('MANAGE_COMPANY_EVALUATION_PLAN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.$transaction(async (tx) => {
    const changed = await tx.hrCompanyEvaluationOccurrence.updateMany({
      where: { id: req.params.occurrenceId, applicationId: req.params.id, status: 'PLANNED' },
      data: { status: 'CANCELLED', cancelledByUserId: actorId(req), cancelledAt: new Date() },
    });
    if (changed.count !== 1) throw Object.assign(new Error('این ارزیابی دیگر قابل لغو نیست.'), { statusCode: 409 });
    return tx.hrCompanyEvaluationOccurrence.findUniqueOrThrow({ where: { id: req.params.occurrenceId } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req.params.id, 'COMPANY_EVALUATION_CANCELLED', req, { occurrenceId: row.id });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/company-evaluations/:occurrenceId/result', requireActionPermission('RECORD_COMPANY_EVALUATION_RESULT'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  let persisted = false;
  try {
    const current = await prisma.hrCompanyEvaluationOccurrence.findFirstOrThrow({ where: { id: req.params.occurrenceId, applicationId: req.params.id } });
    validateCompanyEvaluationResult({ evidencePolicy: current.evidencePolicy, effect: String(req.body.effect || ''), explanation: req.body.explanation, hasFile: Boolean(req.file) });
    let scanStatus: string | null = null;
    let digest: string | null = null;
    if (req.file) {
      validateHiringFileSignature(req.file.path, req.file.mimetype);
      [scanStatus, digest] = await Promise.all([scanHiringFile(req.file.path), sha256File(req.file.path)]);
    }
    const row = await prisma.$transaction(async (tx) => {
      const changed = await tx.hrCompanyEvaluationOccurrence.updateMany({
        where: { id: current.id, applicationId: req.params.id, status: 'PLANNED' },
        data: {
          status: 'COMPLETED', resultEffect: String(req.body.effect), resultExplanation: String(req.body.explanation || '').trim() || null,
          resultStorageName: req.file?.filename || null, resultOriginalName: req.file?.originalname || null,
          resultMimeType: req.file?.mimetype || null, resultSize: req.file?.size || null,
          resultSha256: digest, resultMalwareScanStatus: scanStatus,
          completedByUserId: actorId(req), completedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw Object.assign(new Error('این ارزیابی قبلاً تعیین تکلیف شده است.'), { statusCode: 409 });
      return tx.hrCompanyEvaluationOccurrence.findUniqueOrThrow({ where: { id: current.id } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    persisted = true;
    await audit(req.params.id, 'COMPANY_EVALUATION_RESULT_RECORDED', req, { occurrenceId: row.id, effect: row.resultEffect });
    res.json({ success: true, data: row });
  } catch (error) {
    if (!persisted) removeHiringFile(req.file?.path);
    throw error;
  }
}));

router.get('/applications/:id/company-evaluations/:occurrenceId/evidence/download', requireActionPermission('VIEW_COMPANY_EVALUATION_RESULTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCompanyEvaluationOccurrence.findFirst({
    where: { id: req.params.occurrenceId, applicationId: req.params.id, status: 'COMPLETED' },
  });
  if (!row?.resultStorageName || !row.resultOriginalName) return res.status(404).json({ success: false, error: 'فایل نتیجه ارزیابی پیدا نشد.' });
  await audit(req.params.id, 'COMPANY_EVALUATION_EVIDENCE_DOWNLOADED', req, { occurrenceId: row.id });
  await audit(req.params.id, 'SENSITIVE_RECRUITMENT_EVIDENCE_ACCESSED', req, { evidenceType: 'COMPANY_EVALUATION', evidenceId: row.id, action: 'DOWNLOAD' });
  res.download(safeHiringStoragePath(row.resultStorageName), row.resultOriginalName);
}));

router.get('/work-items/summary', asyncHandler(async (req: AuthRequest, res: Response) => {
  await syncAutomaticHiringWorkItems();
  const candidates = await prisma.hrWorkItem.findMany({
    where: { OR: [{ assignedToUserId: actorId(req) }, { sourceType: 'HIRING_ACTION', assignedToUserId: null }], status: { in: ['PENDING', 'IN_PROGRESS', 'COMPLETE'] } },
    include: workItemInclude,
    orderBy: [{ status: 'asc' }, { dueDate: 'asc' }]
  });
  const rows = await filterHrWorkItemsForUser(candidates, actorId(req));
  const open = rows.filter((item) => item.status === 'PENDING' || item.status === 'IN_PROGRESS');
  res.json({ success: true, data: {
    progress: personalHrWorkProgress(rows),
    items: open.slice(0, 5),
    canManage: await canManageHrWork(req),
    unassignedCount: rows.filter((item) => item.assignedToUserId === null && ['PENDING', 'IN_PROGRESS'].includes(item.status)).length,
  } });
}));

router.get('/work-items', asyncHandler(async (req: AuthRequest, res: Response) => {
  await syncAutomaticHiringWorkItems();
  const scope = String(req.query.scope || 'mine');
  const manager = await canManageHrWork(req);
  if (scope !== 'mine' && !manager) return res.status(403).json({ success: false, error: 'مشاهده صف تیمی به مدیر منابع انسانی محدود است.' });
  const status = String(req.query.status || 'OPEN');
  const where: any = {
    ...(scope === 'mine' ? { OR: [{ assignedToUserId: actorId(req) }, { sourceType: 'HIRING_ACTION', assignedToUserId: null }] } : scope === 'unassigned' ? { assignedToUserId: null } : {}),
    ...(status === 'OPEN' ? { status: { in: ['PENDING', 'IN_PROGRESS'] } } : status ? { status } : {})
  };
  const candidates = await prisma.hrWorkItem.findMany({ where, include: workItemInclude, orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }], take: 250 });
  const rows = scope === 'mine' ? await filterHrWorkItemsForUser(candidates, actorId(req)) : candidates;
  res.json({ success: true, data: rows, meta: { scope, status, canManage: manager, currentUserId: actorId(req) } });
}));

router.get('/work-items/users', requireHrWorkManager, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.user.findMany({ where: { isActive: true }, select: workItemUserSelect, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }] });
  const authorities = await Promise.all(rows.map((user) => activeHiringAuthoritiesForUser(user.id)));
  res.json({ success: true, data: rows.map((user, index) => ({ ...user, authorities: authorities[index] })) });
}));

router.post('/work-items', requireHrWorkManager, asyncHandler(async (req: AuthRequest, res: Response) => {
  const title = String(req.body.title || '').trim();
  const destinationHref = String(req.body.destinationHref || '').trim();
  const assignedToUserId = String(req.body.assignedToUserId || '').trim() || null;
  if (title.length < 3) throw new Error('عنوان وظیفه الزامی است.');
  if (!destinationHref.startsWith('/dashboard/hr')) throw new Error('مقصد وظیفه باید داخل فضای کاری منابع انسانی باشد.');
  const dueDate = parseDate(req.body.dueDate, 'مهلت وظیفه');
  if (assignedToUserId && !(await prisma.user.findFirst({ where: { id: assignedToUserId, isActive: true }, select: { id: true } }))) throw new Error('مسئول فعال پیدا نشد.');
  const row = await prisma.hrWorkItem.create({ data: {
    title,
    description: String(req.body.description || '').trim() || null,
    sourceType: 'MANUAL',
    destinationHref,
    dueDate,
    assignedToUserId,
    assignmentReason: String(req.body.assignmentReason || '').trim() || null,
    createdByUserId: actorId(req)
  }, include: workItemInclude });
  await auditWorkItem(row.id, 'MANUAL_TASK_CREATED', actorId(req), null, row);
  res.status(201).json({ success: true, data: row });
}));

router.patch('/work-items/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const current = await prisma.hrWorkItem.findUniqueOrThrow({ where: { id: req.params.id } });
  if (current.dutyRoutingBlockedAt) {
    return res.status(409).json({
      success: false,
      error: 'DUTY_ROUTING_BLOCKED',
      reason: current.dutyRoutingBlockReason,
    });
  }
  const manager = await canManageHrWork(req);
  const isAssignee = current.assignedToUserId === actorId(req);
  if (!manager && !isAssignee) return res.status(403).json({ success: false, error: 'این وظیفه به شما محول نشده است.' });
  const requestedStatus = req.body.status ? String(req.body.status) : current.status;
  if (!['PENDING', 'IN_PROGRESS', 'COMPLETE', 'WAIVED'].includes(requestedStatus)) throw new Error('وضعیت وظیفه معتبر نیست.');
  if (current.sourceType === 'HIRING_ACTION' && ['COMPLETE', 'WAIVED'].includes(requestedStatus)) {
    throw new Error('وظیفه خودکار فقط با تکمیل اقدام متناظر در پرونده جذب بسته می‌شود.');
  }
  if (requestedStatus !== current.status && ['IN_PROGRESS', 'COMPLETE'].includes(requestedStatus) && !isAssignee) {
    return res.status(403).json({ success: false, error: 'شروع و تکمیل وظیفه فقط توسط مسئول فعلی آن ممکن است.' });
  }
  if (!manager && requestedStatus === 'WAIVED') return res.status(403).json({ success: false, error: 'صرف‌نظر از وظیفه فقط با تأیید مدیر منابع انسانی ممکن است.' });
  const requestedAssignee = req.body.assignedToUserId === undefined ? current.assignedToUserId : String(req.body.assignedToUserId || '').trim() || null;
  const reassigned = requestedAssignee !== current.assignedToUserId;
  const reason = String(req.body.reason || '').trim();
  if (current.sourceType === 'HIRING_ACTION' && reassigned) {
    throw new Error('مسئول وظیفه خودکار از کاربران دارای «اقدام شما» تعیین می‌شود و قابل تغییر دستی نیست.');
  }
  if (reassigned && !manager) return res.status(403).json({ success: false, error: 'تغییر مسئول وظیفه به مدیر منابع انسانی محدود است.' });
  if (reassigned && reason.length < 3) throw new Error('دلیل تغییر مسئول الزامی است.');
  if (requestedStatus === 'WAIVED' && reason.length < 3) throw new Error('دلیل صرف‌نظر از وظیفه الزامی است.');
  if (requestedAssignee && !(await prisma.user.findFirst({ where: { id: requestedAssignee, isActive: true }, select: { id: true } }))) throw new Error('مسئول فعال پیدا نشد.');
  const completed = requestedStatus === 'COMPLETE';
  const waived = requestedStatus === 'WAIVED';
  const row = await prisma.hrWorkItem.update({ where: { id: current.id }, data: {
    status: requestedStatus as any,
    assignedToUserId: requestedAssignee,
    assignmentReason: reassigned ? reason : current.assignmentReason,
    completedAt: completed ? current.completedAt || new Date() : null,
    completedByUserId: completed ? current.completedByUserId || actorId(req) : null,
    waivedAt: waived ? current.waivedAt || new Date() : null,
    waivedByUserId: waived ? current.waivedByUserId || actorId(req) : null,
    waiverReason: waived ? reason : null
  }, include: workItemInclude });
  await auditWorkItem(row.id, reassigned ? 'TASK_REASSIGNED' : `TASK_${requestedStatus}`, actorId(req), current, row);
  res.json({ success: true, data: row });
}));

router.get('/authorities', requireAuthorityAdministrator, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.hrHiringAuthority.findMany({
    where: { isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    orderBy: [{ authority: 'asc' }, { createdAt: 'asc' }]
  });
  res.json({ success: true, data: rows });
}));

router.get('/authorities/users', requireAuthorityAdministrator, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, username: true, role: true },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }]
  });
  res.json({ success: true, data: rows });
}));

router.get('/authorities/audit', requireSystemAdmin, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.hrHiringAuthorityAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ success: true, data: rows });
}));

router.post(['/authorities', '/authorities/:id/revoke'], requireAuthorityAdministrator, (_req, res) => {
  res.status(410).json({ success: false, error: 'HR_LEGACY_AUTHORIZATION_MUTATION_RETIRED' });
});

router.post('/authorities', requireAuthorityAdministrator, asyncHandler(async (req: AuthRequest, res: Response) => {
  const targetUserId = String(req.body.userId || '');
  const authority = String(req.body.authority || '');
  if (!targetUserId || !HIRING_AUTHORITY_TYPES.has(authority)) throw new Error('کاربر یا اختیار استخدام نامعتبر است.');
  const [actorAuthorities, activeCompanyManagerCount, targetUser] = await Promise.all([
    prisma.hrHiringAuthority.findMany({ where: { userId: actorId(req), isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { authority: true } }),
    prisma.hrHiringAuthority.count({ where: { authority: 'COMPANY_MANAGER', isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
    prisma.user.findFirst({ where: { id: targetUserId, isActive: true }, select: { id: true, role: true } })
  ]);
  if (!targetUser) throw new Error('کاربر فعال پیدا نشد.');
  assertHiringAuthorityMutationAllowed({ actorRole: req.user!.role, actorUserId: actorId(req), actorAuthorities: actorAuthorities.map((item) => item.authority), action: 'GRANT', targetUserId, targetRole: targetUser.role, authority, activeCompanyManagerCount });
  const previous = await prisma.hrHiringAuthority.findUnique({ where: { userId_authority: { userId: req.body.userId, authority: req.body.authority } } });
  const row = await prisma.hrHiringAuthority.upsert({
    where: { userId_authority: { userId: targetUserId, authority: authority as any } },
    create: { userId: targetUserId, authority: authority as any, createdBy: actorId(req), isActive: true, expiresAt: req.body.expiresAt ? parseDate(req.body.expiresAt, 'انقضای اختیار') : null },
    update: { isActive: true, expiresAt: req.body.expiresAt ? parseDate(req.body.expiresAt, 'انقضای اختیار') : null, revokedAt: null, revokedBy: null, revocationReason: null }
  });
  await prisma.hrHiringAuthorityAudit.create({ data: {
    authorityId: row.id, actorUserId: actorId(req), eventType: previous?.isActive ? 'AUTHORITY_UPDATED' : previous ? 'AUTHORITY_REACTIVATED' : 'AUTHORITY_ASSIGNED',
    beforeJson: previous ? JSON.parse(JSON.stringify(previous)) : Prisma.JsonNull,
    afterJson: JSON.parse(JSON.stringify(row))
  }});
  res.status(201).json({ success: true, data: row });
}));

router.post('/authorities/:id/revoke', requireAuthorityAdministrator, asyncHandler(async (req: AuthRequest, res: Response) => {
  const reason = String(req.body.reason || '').trim();
  if (reason.length < 3) throw new Error('دلیل سلب اختیار الزامی است.');
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.hrHiringAuthority.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!current.isActive || (current.expiresAt && current.expiresAt <= new Date())) throw new Error('این اختیار فعال نیست.');
    const [actorAuthorities, activeCompanyManagerCount, targetUser] = await Promise.all([
      tx.hrHiringAuthority.findMany({ where: { userId: actorId(req), isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { authority: true } }),
      tx.hrHiringAuthority.count({ where: { authority: 'COMPANY_MANAGER', isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } }),
      tx.user.findUniqueOrThrow({ where: { id: current.userId }, select: { role: true } })
    ]);
    assertHiringAuthorityMutationAllowed({ actorRole: req.user!.role, actorUserId: actorId(req), actorAuthorities: actorAuthorities.map((item) => item.authority), action: 'REVOKE', targetUserId: current.userId, targetRole: targetUser.role, authority: current.authority, activeCompanyManagerCount });
    const updated = await tx.hrHiringAuthority.update({ where: { id: current.id }, data: { isActive: false, revokedAt: new Date(), revokedBy: actorId(req), revocationReason: reason } });
    await tx.hrHiringAuthorityAudit.create({ data: { authorityId: updated.id, actorUserId: actorId(req), eventType: 'AUTHORITY_REVOKED', beforeJson: JSON.parse(JSON.stringify(current)), afterJson: JSON.parse(JSON.stringify(updated)) } });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.json({ success: true, data: row });
}));

router.get('/pre-identity/templates', requireActionPermission('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.hrRecruitmentChecklistTemplate.findMany({
    where: { isActive: true },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ name: 'asc' }, { version: 'desc' }]
  });
  res.json({ success: true, data: rows });
}));

router.post('/pre-identity/templates', requireActionPermission('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const name = String(req.body.name || '').trim();
  const scopeType = String(req.body.scopeType || 'JOB');
  const scopeId = String(req.body.scopeId || '').trim() || null;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!name || !['JOB', 'POSITION'].includes(scopeType) || !scopeId || !items.length) throw new Error('نام، دامنه شغل یا جایگاه و حداقل یک الزام برای قالب الزامی است.');
  if (items.some((item: any) => !String(item.title || '').trim() || !['NOTE_REQUIRED', 'FILE_REQUIRED', 'FILE_OPTIONAL', 'NO_FILE'].includes(String(item.evidencePolicy || 'NOTE_REQUIRED')))) throw new Error('یکی از الزامات قالب نامعتبر است.');
  const latest = await prisma.hrRecruitmentChecklistTemplate.aggregate({ where: { name }, _max: { version: true } });
  const row = await prisma.hrRecruitmentChecklistTemplate.create({
    data: {
      name,
      version: (latest._max.version || 0) + 1,
      scopeType,
      scopeId,
      createdBy: actorId(req),
      items: { create: items.map((item: any, index: number) => ({ title: String(item.title).trim(), instructions: String(item.instructions || '').trim() || null, evidencePolicy: String(item.evidencePolicy || 'NOTE_REQUIRED') as any, sortOrder: index })) }
    },
    include: { items: { orderBy: { sortOrder: 'asc' } } }
  });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/pre-identity/apply-template', requireActionPermission('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [application, template] = await Promise.all([
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { position: true } }),
    prisma.hrRecruitmentChecklistTemplate.findUniqueOrThrow({ where: { id: String(req.body.templateId) }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
  ]);
  if (!template.isActive || (template.scopeType === 'POSITION' && template.scopeId !== application.positionId) || (template.scopeType === 'JOB' && template.scopeId !== application.position.jobId)) throw new Error('این قالب برای شغل یا جایگاه پرونده قابل استفاده نیست.');
  const existingTemplateItems = new Set((await prisma.hrPreIdentityChecklistItem.findMany({ where: { applicationId: application.id, templateItemId: { not: null } }, select: { templateItemId: true } })).map((item) => item.templateItemId));
  const items = template.items.filter((item) => !existingTemplateItems.has(item.id));
  await prisma.$transaction(async (tx) => {
    for (const item of items) {
      await tx.hrPreIdentityChecklistItem.create({ data: { applicationId: application.id, templateItemId: item.id, requirementKey: crypto.randomUUID(), title: item.title, instructions: item.instructions, evidencePolicy: item.evidencePolicy, createdBy: actorId(req) } });
    }
    await tx.hrJobApplication.update({ where: { id: application.id }, data: { preIdentityRequirementsFinalizedBy: null, preIdentityRequirementsFinalizedAt: null, preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null, preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null } });
  });
  await audit(application.id, 'PRE_IDENTITY_TEMPLATE_APPLIED', req, { templateId: template.id, version: template.version, itemCount: items.length });
  res.status(201).json({ success: true, data: { itemCount: items.length } });
}));

router.get('/collateral-templates', requireActionPermission('MANAGE_COLLATERAL_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const rows = await prisma.hrCollateralChecklistTemplate.findMany({
    where: String(req.query.view || '') === HR_HIRING_METRIC_VIEWS.activeCollateralTemplates ? { isActive: true } : undefined,
    include: { items: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ name: 'asc' }, { version: 'desc' }]
  });
  res.json({ success: true, data: rows });
}));

router.post('/collateral-templates', requireActionPermission('MANAGE_COLLATERAL_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const name = String(req.body.name || '').trim();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!name || !items.length || items.some((item: any) => !COLLATERAL_TYPES.has(item.type) || !String(item.label || '').trim())) throw new Error('نام قالب و حداقل یک قلم معتبر الزامی است.');
  const latest = await prisma.hrCollateralChecklistTemplate.aggregate({ where: { name }, _max: { version: true } });
  const row = await prisma.hrCollateralChecklistTemplate.create({ data: {
    name, version: (latest._max.version || 0) + 1, scopeType: req.body.scopeType || 'GLOBAL', scopeId: req.body.scopeId || null, createdBy: actorId(req),
    items: { create: items.map((item: any, index: number) => ({ type: item.type, label: item.label, required: item.required !== false, defaultAmountRials: item.defaultAmountRials === '' || item.defaultAmountRials == null ? null : normalizeHiringRial(item.defaultAmountRials), sortOrder: index })) }
  }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  res.status(201).json({ success: true, data: row });
}));

router.patch('/collateral-templates/:id/active', requireActionPermission('MANAGE_COLLATERAL_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCollateralChecklistTemplate.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive === true } });
  res.json({ success: true, data: row });
}));

router.get('/applications', asyncHandler(async (req: AuthRequest, res: Response) => {
  const search = String(req.query.search || '').trim();
  const archived = String(req.query.archived || '') === 'true';
  const requestedView = String(req.query.view || '').trim();
  const [authorities, effectiveActionPermissions] = await Promise.all([
    activeHiringAuthoritiesForUser(actorId(req)),
    activeHrActionPermissionsForUser(prisma, actorId(req)),
  ]);
  const actionPermissions = new Set(effectiveActionPermissions);
  const canSeeFullMobile = actionPermissions.has('VIEW_FULL_APPLICANT_INFORMATION');
  const canSeeDecisionDetails = canSeeFullMobile
    || actionPermissions.has('VIEW_INITIAL_INTERVIEW_REPORT')
    || actionPermissions.has('VIEW_COMPANY_EVALUATION_RESULTS');
  const rows = await prisma.hrJobApplication.findMany({
    where: {
      archivedAt: archived ? { not: null } : null,
      stage: req.query.stage ? req.query.stage as any : undefined,
      ...(req.query.outcome
        ? { outcome: req.query.outcome as any }
        : String(req.query.includeHired || '') === 'true' || requestedView === HR_HIRING_METRIC_VIEWS.actionableCollateralOrContracts
          ? {}
          : { OR: [{ outcome: null }, { outcome: { not: 'HIRED' as any } }] }),
      disposition: req.query.disposition ? req.query.disposition as any : undefined,
      positionId: req.query.positionId ? String(req.query.positionId) : undefined,
      position: req.query.jobId ? { jobId: String(req.query.jobId) } : undefined,
      AND: search ? buildHiringCandidateSearchConditions(search, canSeeFullMobile) : undefined
    },
    include: {
      candidate: { select: { id: true, firstName: true, lastName: true, mobile: true, talentBankSearchable: true, linkedPersonnelId: true, createdAt: true, updatedAt: true } },
      position: { include: { job: true, organizationalUnit: true } },
      formRevisions: { select: { status: true }, orderBy: { revisionNumber: 'desc' }, take: 4 },
      assessments: { select: { id: true } },
      formalAssessmentPlans: { include: formalAssessmentPlanInclude, orderBy: { version: 'desc' } },
      preIdentityChecklistItems: { select: { status: true, managementResolution: true, dueAt: true } },
      hiringDecisions: { select: { kind: true, outcome: true, explanation: true, changeReason: true, version: true, decidedBy: true, decidedAt: true }, orderBy: [{ kind: 'asc' }, { version: 'desc' }] },
      compensationSnapshots: { select: { proposedBy: true, payrollReviewStatus: true, payrollVerifiedAt: true, hrApprovedAt: true, financeApprovedAt: true, candidateAcceptedAt: true, obsoleteAt: true }, orderBy: { version: 'desc' }, take: 3 },
      collateralItems: { select: { required: true, status: true } },
      contracts: { select: { uploadedBy: true, submittedAt: true, returnedAt: true, approvedAt: true }, orderBy: { version: 'desc' }, take: 1 },
      payrollParticipation: { select: { id: true } },
      onboardingTasks: { select: { id: true, activationBlocker: true, status: true, ownerAuthority: true, title: true } },
      employmentRelationship: { include: { personnel: true } }
    },
    orderBy: { updatedAt: 'desc' }
  });
  const companyEvaluationOccurrences = rows.length
    ? await prisma.hrCompanyEvaluationOccurrence.findMany({
        where: { applicationId: { in: rows.map(({ id }) => id) } },
        select: { applicationId: true, status: true },
      })
    : [];
  const companyEvaluationsByApplication = new Map<string, Array<{ status: string }>>();
  for (const occurrence of companyEvaluationOccurrences) {
    const current = companyEvaluationsByApplication.get(occurrence.applicationId) || [];
    current.push({ status: occurrence.status });
    companyEvaluationsByApplication.set(occurrence.applicationId, current);
  }
  const archivedActorIds = [...new Set(rows.map((application) => application.archivedBy).filter(Boolean) as string[])];
  const archivedActors = archivedActorIds.length
    ? await prisma.user.findMany({ where: { id: { in: archivedActorIds } }, select: { id: true, firstName: true, lastName: true, username: true } })
    : [];
  const archivedActorNames = new Map(archivedActors.map((actor) => [actor.id, `${actor.firstName} ${actor.lastName}`.trim() || actor.username]));
  const requestedPhase = String(req.query.phase || '').trim();
  const requestedStatus = String(req.query.lifecycleStatus || '').trim();
  const myActions = String(req.query.myActions || '') === 'true';
  const representedRows = requestedView === HR_HIRING_METRIC_VIEWS.actionableCollateralOrContracts
    ? resolveActionableCollateralOrContractApplications(rows as any[], authorities, actorId(req))
    : rows;
  const projected = representedRows.map((source) => {
    const row = {
      ...source,
      companyEvaluationOccurrences: companyEvaluationsByApplication.get(source.id) || [],
      archivedByDisplayName: source.archivedBy ? archivedActorNames.get(source.archivedBy) || source.archivedBy : null,
      retentionCapabilities: projectRecordRetentionCapabilities({
        role: req.user!.role,
        authorities,
        canManageArchive: actionPermissions.has('ARCHIVE_RECRUITMENT_CASE'),
        archived: Boolean(source.archivedAt),
        archiveEligible: source.stage === 'CLOSED' && Boolean(source.outcome),
      }),
      decisionDetailsVisible: canSeeDecisionDetails,
      candidate: { ...source.candidate, mobile: canSeeFullMobile ? source.candidate.mobile : `${source.candidate.mobile.slice(0, 4)}***${source.candidate.mobile.slice(-2)}` },
      hiringDecisions: source.hiringDecisions.map((decision) => canSeeDecisionDetails ? decision : ({ kind: decision.kind, outcome: decision.outcome, version: decision.version }))
    };
    return buildHiringQueueItem(
    row as any,
    summarizeHiringLifecycle(projectHiringLifecycle(
      row,
      authorities,
      actorId(req),
      effectiveActionPermissions,
    ))
  );}).filter((row) => {
    if (requestedPhase && row.lifecycleSummary.phaseId !== requestedPhase) return false;
    if (requestedStatus && row.lifecycleSummary.status !== requestedStatus) return false;
    if (myActions && row.lifecycleSummary.status !== 'ACTION_REQUIRED') return false;
    return true;
  });
  const direction = String(req.query.sortDirection || 'desc') === 'asc' ? 1 : -1;
  const sortBy = String(req.query.sortBy || 'priority');
  const priority = (status: string) => ({ ACTION_REQUIRED: 0, BLOCKED: 1, PAUSED: 2, WAITING: 3, UPCOMING: 4, COMPLETED: 5, ENDED: 6 }[status] ?? 7);
  projected.sort((left, right) => {
    if (sortBy === 'candidateName') return direction * `${left.candidate.lastName} ${left.candidate.firstName}`.localeCompare(`${right.candidate.lastName} ${right.candidate.firstName}`, 'fa');
    if (sortBy === 'position') return direction * left.position.title.localeCompare(right.position.title, 'fa');
    if (sortBy === 'status') return direction * (priority(left.lifecycleSummary.status) - priority(right.lifecycleSummary.status));
    if (sortBy === 'updatedAt') return direction * (new Date(left.updatedAt).getTime() - new Date(right.updatedAt).getTime());
    const priorityDifference = priority(left.lifecycleSummary.status) - priority(right.lifecycleSummary.status);
    return priorityDifference || new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize || 50)));
  const page = Math.max(1, Number(req.query.page || 1));
  const start = (page - 1) * pageSize;
  res.json({
    success: true,
    data: projected.slice(start, start + pageSize),
    meta: {
      page,
      pageSize,
      total: projected.length,
      recordCount: projected.length,
      aggregateQuantity: projected.length,
      totalPages: Math.max(1, Math.ceil(projected.length / pageSize)),
    },
  });
}));

router.get('/applications/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrJobApplication.findUnique({ where: { id: req.params.id }, include: applicationInclude });
  if (!row) return res.status(404).json({ success: false, error: 'پرونده استخدام پیدا نشد.' });
  const [authorityCodes, actionPermissionCodes, companyEvaluationOccurrences] = await Promise.all([
    activeHiringAuthoritiesForUser(actorId(req)),
    activeHrActionPermissionsForUser(prisma, actorId(req)),
    prisma.hrCompanyEvaluationOccurrence.findMany({
      where: { applicationId: row.id },
      select: { status: true },
    }),
  ]);
  const authorities = new Set(authorityCodes);
  const actionPermissions = new Set(actionPermissionCodes);
  const canSeeHrSensitive = actionPermissions.has('VIEW_FULL_APPLICANT_INFORMATION');
  const canSeeFullMobile = canSeeHrSensitive;
  const canSeeDecisionDetails = canSeeHrSensitive || actionPermissions.has('VIEW_INITIAL_INTERVIEW_REPORT');
  const canSeeAssessmentEvidence = canSeeDecisionDetails
    || actionPermissions.has('VIEW_COMPANY_EVALUATION_RESULTS');
  const canSeeFinanceSensitive = actionPermissions.has('MANAGE_FINANCE_EVIDENCE');
  const canSeeCollateralSensitive = canSeeFinanceSensitive
    || actionPermissions.has('RECORD_COLLATERAL_CUSTODY')
    || actionPermissions.has('VERIFY_COLLATERAL_CUSTODY');
  const canSeeCompensation = canSeeFinanceSensitive
    || actionPermissions.has('MANAGE_COMPENSATION')
    || actionPermissions.has('MANAGE_PAYROLL');
  const data: any = row;
  data.retentionCapabilities = projectRecordRetentionCapabilities({
    role: req.user!.role,
    authorities: [...authorities],
    canManageArchive: actionPermissions.has('ARCHIVE_RECRUITMENT_CASE'),
    archived: Boolean(row.archivedAt),
    archiveEligible: row.stage === 'CLOSED' && Boolean(row.outcome),
  });
  data.readOnlyArchived = Boolean(row.archivedAt);
  data.informationGroups = [
    { key: 'PROFILE_IDENTITY', status: canSeeHrSensitive ? 'AVAILABLE' : 'RESTRICTED' },
    { key: 'EXPERIENCE_QUALIFICATIONS', status: canSeeAssessmentEvidence ? 'AVAILABLE' : 'RESTRICTED' },
    { key: 'APPLICATION_ANSWERS', status: canSeeAssessmentEvidence ? 'AVAILABLE' : 'RESTRICTED' },
    { key: 'DOCUMENT_EVIDENCE', status: canSeeHrSensitive ? 'AVAILABLE' : 'RESTRICTED' }
  ];
  data.lifecycle = projectHiringLifecycle(
    { ...row, companyEvaluationOccurrences },
    authorities,
    actorId(req),
    actionPermissionCodes,
  );
  data.taskCapabilities = projectHiringTaskCapabilities(row, authorities, actorId(req));
  data.activationReadiness = actionPermissions.has('MANAGE_RECRUITMENT_CASE')
    ? buildEmploymentActivationReadiness(row)
    : null;
  if (!canSeeDecisionDetails) {
    data.hiringDecisions = data.hiringDecisions.map(({ kind, outcome, version, decidedAt }: any) => ({ kind, outcome, version, decidedAt }));
    data.preIdentityChecklistItems = data.preIdentityChecklistItems.map(({ id, title, status, dueAt, managementResolution }: any) => ({ id, title, status, dueAt, managementResolution }));
  } else if (!canSeeHrSensitive) {
    data.preIdentityChecklistItems = data.preIdentityChecklistItems.map(({ storageName: _storageName, sha256: _sha256, malwareScanStatus: _scan, ...item }: any) => item);
  }
  if (!actionPermissions.has('RECORD_INITIAL_INTERVIEW')) data.initialInterviewDraft = null;
  data.documents = canSeeHrSensitive ? data.documents.map(({ storageName: _storageName, sha256: _sha256, ...document }: any) => document) : [];
  data.assessments = canSeeAssessmentEvidence ? data.assessments.map(({ storageName: _storageName, sha256: _sha256, ...assessment }: any) => assessment) : [];
  data.formalAssessmentPlans = canSeeAssessmentEvidence
    ? data.formalAssessmentPlans
    : data.formalAssessmentPlans.map((plan: any) => ({
        id: plan.id,
        version: plan.version,
        status: plan.status,
        explicitlyNoAssessment: plan.explicitlyNoAssessment,
        finalizedAt: plan.finalizedAt,
        selections: plan.selections.map(({ assessmentKind, selected, executionMethod }: any) => ({ assessmentKind, selected, executionMethod })),
        results: plan.results.map(({ assessmentKind, resultVersion, status }: any) => ({ assessmentKind, resultVersion, status })),
      }));
  if (!canSeeHrSensitive) {
    if (!canSeeFullMobile) data.candidate.mobile = `${data.candidate.mobile.slice(0, 4)}***${data.candidate.mobile.slice(-2)}`;
    data.candidate.profileJson = null;
    data.candidate.nationalCode = null;
    data.candidate.foreignIdentityType = null;
    data.candidate.foreignIdentityNumber = null;
    data.candidate.postalCode = null;
    data.candidate.hasSocialSecurityHistory = null;
    data.formRevisions = [];
    data.identityChecks = [];
  }
  if (!authorities.has('HR_PROCESSOR')) data.insuranceEnrollment = null;
  if (canSeeCollateralSensitive) data.collateralItems = data.collateralItems.map(({ storageName: _storageName, sha256: _sha256, returnEvidenceStorageName: _returnStorage, returnEvidenceSha256: _returnSha, ...item }: any) => item);
  else data.collateralItems = data.collateralItems.map(({ id, type, required, status, coordinationReason, receivedAt, returnedAt, returnConfirmedAt }: any) => ({ id, type, required, status, coordinationReason, receivedAt, returnedAt, returnConfirmedAt }));
  if (!canSeeCompensation) data.compensationSnapshots = [];
  if (canSeeCompensation) {
    const participantIds = Array.from(new Set(
      data.compensationSnapshots.flatMap((snapshot: any) => [
        snapshot.proposedBy,
        snapshot.preparedBy,
        snapshot.hrApprovedBy,
        snapshot.financeApprovedBy,
        snapshot.candidateDecisionBy
      ]).filter(Boolean)
    )) as string[];
    const participants = participantIds.length
      ? await prisma.user.findMany({
          where: { id: { in: participantIds } },
          select: { id: true, firstName: true, lastName: true }
        })
      : [];
    data.compensationParticipants = Object.fromEntries(
      participants.map((participant) => [
        participant.id,
        `${participant.firstName} ${participant.lastName}`.trim()
      ])
    );
  }
  data.contracts = canSeeFinanceSensitive
    ? data.contracts.map(({ storageName: _storageName, sha256: _sha256, ...contract }: any, index: number) => {
        const reviewState = paperContractReviewState(contract);
        return {
          ...contract,
          reviewState,
          canSubmit:
            index === 0 &&
            authorities.has('FINANCE_RECORDER') &&
            contract.uploadedBy === actorId(req) &&
            reviewState === 'DRAFT',
          canReview:
            index === 0 &&
            authorities.has('FINANCE_MANAGER') &&
            contract.uploadedBy !== actorId(req) &&
            reviewState === 'SUBMITTED'
        };
      })
    : [];
  if (!authorities.has('HR_PAYROLL_MANAGER')) data.payrollParticipation = null;
  data.onboardingTasks = data.onboardingTasks.map((task: any) => {
    if (task.ownerAuthority && authorities.has(task.ownerAuthority)) return task;
    return {
      id: task.id,
      title: task.title,
      status: task.status,
      activationBlocker: task.activationBlocker,
      ownerAuthority: task.ownerAuthority,
      dueDate: task.dueDate,
      completedAt: task.completedAt
    };
  });
  if (!authorities.has('HR_MANAGER')) data.audits = [];
  await audit(row.id, 'HIRING_CASE_VIEWED', req, undefined);
  res.json({ success: true, data });
}));

router.post('/applications/:id/archive', requireArchiveManager, asyncHandler(async (req: AuthRequest, res: Response) => {
  const reason = assertArchiveReason(req.body.reason);
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, select: { archivedAt: true, stage: true, outcome: true } });
  if (application.archivedAt) return res.status(409).json({ success: false, error: 'پرونده قبلاً بایگانی شده است.' });
  assertJobApplicationArchivable(application.stage, application.outcome);
  const archivedAt = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { archivedAt, archivedBy: actorId(req), archiveReason: reason } });
    await tx.hrHiringAudit.create({ data: { applicationId: req.params.id, actorUserId: actorId(req), actorKind: 'USER', eventType: 'APPLICATION_ARCHIVED', payloadJson: { reason, archivedAt: archivedAt.toISOString() } } });
    return updated;
  });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/restore', requireArchiveManager, asyncHandler(async (req: AuthRequest, res: Response) => {
  const reason = assertArchiveReason(req.body.reason);
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, select: { archivedAt: true } });
  if (!application.archivedAt) return res.status(409).json({ success: false, error: 'پرونده در بایگانی نیست.' });
  const row = await prisma.$transaction(async (tx) => {
    await tx.hrHiringAudit.create({ data: { applicationId: req.params.id, actorUserId: actorId(req), actorKind: 'USER', eventType: 'APPLICATION_RESTORED', payloadJson: { reason, restoredAt: new Date().toISOString() } } });
    return tx.hrJobApplication.update({ where: { id: req.params.id }, data: { archivedAt: null, archivedBy: null, archiveReason: null } });
  });
  res.json({ success: true, data: row });
}));

router.get('/applications/:id/deletion-preview', requireSystemAdmin, asyncHandler(async (req: AuthRequest, res: Response) => {
  const impact = await applicationDeletionImpact(req.params.id);
  if (!impact) return res.status(404).json({ success: false, error: 'پرونده استخدام پیدا نشد.' });
  res.json({ success: true, data: impact.data });
}));

router.post('/applications/:id/permanent-delete', requireSystemAdmin, asyncHandler(async (req: AuthRequest, res: Response) => {
  const [impact, actor] = await Promise.all([
    applicationDeletionImpact(req.params.id),
    prisma.user.findUnique({ where: { id: actorId(req) }, select: { password: true } })
  ]);
  if (!impact) return res.status(404).json({ success: false, error: 'پرونده استخدام پیدا نشد.' });
  if (!actor || !(await bcrypt.compare(String(req.body.adminPassword || ''), actor.password))) {
    return res.status(403).json({ success: false, error: 'رمز عبور مدیر سامانه صحیح نیست.' });
  }
  assertPermanentDeletionConfirmation({
    expectedFingerprint: impact.data.fingerprint,
    suppliedFingerprint: req.body.fingerprint,
    expectedFullName: impact.data.displayName,
    suppliedFullName: req.body.fullName,
    reason: req.body.reason,
    confirmed: req.body.confirmed
  });
  const receiptId = crypto.randomUUID();
  const staged = stageHiringFilesForDeletion(impact.data.files, receiptId);
  try {
    await prisma.$transaction(async (tx) => {
      const currentImpact = await applicationDeletionImpact(req.params.id, tx);
      if (!currentImpact || currentImpact.data.fingerprint !== impact.data.fingerprint) throw new Error('پیش‌نمایش حذف منقضی شده است؛ دوباره بررسی کنید.');
      if (currentImpact.application.employmentRelationship) {
        await tx.hrEmploymentRelationship.update({
          where: { id: currentImpact.application.employmentRelationship.id },
          data: { hiringApplicationId: null }
        });
      }
      await tx.hrJobApplication.delete({ where: { id: req.params.id } });
      await tx.hrDeletionReceipt.create({ data: {
        id: receiptId,
        targetType: 'JOB_APPLICATION', targetId: req.params.id, actorUserId: actorId(req), reason: assertArchiveReason(req.body.reason),
        previewFingerprint: impact.data.fingerprint, status: 'FILE_CLEANUP_PENDING', recordCounts: impact.data.counts as Prisma.InputJsonValue,
        fileCounts: impact.data.fileCounts, deletedAt: new Date()
      } });
      if (staged.length) await tx.hrDeletionFileCleanup.createMany({ data: staged.map((item) => ({ receiptId, storageName: item.storageName, originalPath: item.originalPath, stagedPath: item.stagedPath })) });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    restoreStagedHiringFiles(staged);
    throw error;
  }
  const failures: string[] = [];
  for (const item of staged) {
    const failed = commitStagedHiringFiles([item]);
    if (failed.length) {
      failures.push(item.storageName);
      await prisma.hrDeletionFileCleanup.updateMany({ where: { receiptId, stagedPath: item.stagedPath }, data: { status: 'FAILED', lastError: 'FILE_UNLINK_FAILED' } });
    } else {
      await prisma.hrDeletionFileCleanup.deleteMany({ where: { receiptId, stagedPath: item.stagedPath } });
    }
  }
  const receipt = await prisma.hrDeletionReceipt.update({
    where: { id: receiptId },
    data: { status: failures.length ? 'FILE_CLEANUP_PENDING' : 'COMPLETED', fileCounts: { ...impact.data.fileCounts, staged: staged.length, failed: failures.length } }
  });
  res.status(failures.length ? 202 : 200).json({ success: !failures.length, data: { receiptId: receipt.id, status: receipt.status }, error: failures.length ? 'حذف پایگاه داده انجام شد اما پاک‌سازی برخی فایل‌ها نیازمند تلاش مجدد است.' : undefined });
}));

router.post('/deletion-receipts/:id/retry-files', requireSystemAdmin, asyncHandler(async (req: AuthRequest, res: Response) => {
  const cleanupRows = await prisma.hrDeletionFileCleanup.findMany({ where: { receiptId: req.params.id }, orderBy: { createdAt: 'asc' } });
  const failures: string[] = [];
  for (const row of cleanupRows) {
    const failed = commitStagedHiringFiles([{ storageName: row.storageName, originalPath: row.originalPath, stagedPath: row.stagedPath }]);
    if (failed.length) {
      failures.push(row.storageName);
      await prisma.hrDeletionFileCleanup.update({ where: { id: row.id }, data: { status: 'FAILED', lastError: 'FILE_UNLINK_FAILED' } });
    } else await prisma.hrDeletionFileCleanup.delete({ where: { id: row.id } });
  }
  const remaining = await prisma.hrDeletionFileCleanup.count({ where: { receiptId: req.params.id } });
  const receipt = await prisma.hrDeletionReceipt.update({ where: { id: req.params.id }, data: { status: remaining ? 'FILE_CLEANUP_PENDING' : 'COMPLETED' } });
  res.status(remaining ? 202 : 200).json({ success: !remaining, data: { receiptId: receipt.id, status: receipt.status, remaining }, error: failures.length ? 'پاک‌سازی برخی فایل‌ها دوباره ناموفق بود.' : undefined });
}));

router.post('/applications', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const position = await prisma.hrPosition.findUnique({ where: { id: req.body.positionId } });
  if (!position?.isActive) throw new Error('جایگاه فعال پیدا نشد.');
  const mobile = String(req.body.mobile || '').trim();
  if (!/^09\d{9}$/.test(mobile)) throw new Error('شماره همراه معتبر الزامی است.');
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  if (!firstName || !lastName) throw new Error('نام و نام خانوادگی متقاضی الزامی است.');
  const nationalCode = String(req.body.nationalCode || '').trim() || null;
  if (nationalCode && !isValidIranianNationalCode(nationalCode)) throw new Error('کد ملی معتبر نیست.');
  const canManageFormalAssessmentPlan = (await authorizeHrUser(prisma, actorId(req), {
    actionPermissionCodes: ['MANAGE_COMPANY_EVALUATION_PLAN'],
  })).allowed;
  const submittedFormalAssessmentPlan = req.body?.formalAssessmentPlan;
  if (canManageFormalAssessmentPlan && !submittedFormalAssessmentPlan) {
    throw new Error('تصمیم صریح برنامه ارزیابی رسمی هنگام ساخت پرونده الزامی است.');
  }
  if (!canManageFormalAssessmentPlan && submittedFormalAssessmentPlan) {
    throw Object.assign(new Error('مجوز مدیریت برنامه ارزیابی رسمی برای ثبت این تصمیم لازم است.'), { statusCode: 403 });
  }
  const formalAssessmentCommand = submittedFormalAssessmentPlan
    ? normalizeFormalAssessmentPlanCommand(submittedFormalAssessmentPlan, false)
    : null;

  const transactionResult = await prisma.$transaction(async (tx) => {
    const candidate = nationalCode ? await tx.hrCandidate.findUnique({ where: { nationalCode } }) : null;
    if (candidate && !candidateIdentityMatches(candidate, { firstName, lastName, mobile })) {
      throw Object.assign(new Error('کد ملی واردشده قبلاً با نام یا شماره همراه دیگری ثبت شده است. پرونده متقاضی موجود را باز کنید یا کد ملی را اصلاح کنید.'), { statusCode: 409 });
    }
    const resolvedCandidate = candidate || await tx.hrCandidate.create({ data: {
      firstName, lastName, mobile,
      nationalCode
    }});
    const duplicateApplication = await tx.hrJobApplication.findFirst({
      where: { candidateId: resolvedCandidate.id, positionId: position.id, stage: { not: 'CLOSED' } },
      select: { id: true },
    });
    if (duplicateApplication) return { duplicateApplication, application: null, candidateId: resolvedCandidate.id, planId: null };
    const application = await tx.hrJobApplication.create({ data: { candidateId: resolvedCandidate.id, positionId: position.id, createdBy: actorId(req) } });
    const template = await tx.hrRecruitmentChecklistTemplate.findFirst({
      where: { isActive: true, scopeType: 'POSITION', scopeId: position.id }, include: { items: { orderBy: { sortOrder: 'asc' } } }, orderBy: { version: 'desc' }
    }) || await tx.hrRecruitmentChecklistTemplate.findFirst({
      where: { isActive: true, scopeType: 'JOB', scopeId: position.jobId }, include: { items: { orderBy: { sortOrder: 'asc' } } }, orderBy: { version: 'desc' }
    });
    if (template) {
      await tx.hrPreIdentityChecklistItem.createMany({ data: template.items.map((item) => ({
        applicationId: application.id, templateItemId: item.id, requirementKey: crypto.randomUUID(), title: item.title,
        instructions: item.instructions, evidencePolicy: item.evidencePolicy, createdBy: actorId(req)
      })) });
    }
    let planId: string | null = null;
    if (formalAssessmentCommand) {
      const plan = await tx.hrFormalAssessmentPlan.create({
        data: {
          stableKey: `formal-assessment-plan:${application.id}:1`,
          applicationId: application.id,
          version: 1,
          explicitlyNoAssessment: formalAssessmentCommand.explicitlyNoAssessment,
          executionMethod: formalAssessmentCommand.executionMethod,
          finalizedByUserId: actorId(req),
          reason: formalAssessmentCommand.reason || null,
          selections: { create: FORMAL_ASSESSMENT_KINDS.map((assessmentKind) => {
            const selected = formalAssessmentCommand.selections.find((item) => item.assessmentKind === assessmentKind);
            return { assessmentKind, selected: Boolean(selected), executionMethod: selected?.executionMethod ?? null };
          }) },
        },
        include: { selections: true },
      });
      planId = plan.id;
      for (const selection of plan.selections.filter((item) => item.selected)) {
        await tx.hrFormalAssessmentResult.create({ data: {
          stableKey: `formal-assessment-result:${application.id}:${selection.assessmentKind}:1`,
          applicationId: application.id,
          planId: plan.id,
          planSelectionId: selection.id,
          assessmentKind: selection.assessmentKind,
          resultVersion: 1,
          status: 'PENDING',
        } });
      }
    }
    return {
      duplicateApplication: null,
      application: await tx.hrJobApplication.findUniqueOrThrow({ where: { id: application.id }, include: applicationInclude }),
      candidateId: resolvedCandidate.id,
      planId,
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (transactionResult.duplicateApplication) {
    return res.status(409).json({ success: false, error: 'برای این متقاضی و جایگاه پرونده باز وجود دارد.', data: { applicationId: transactionResult.duplicateApplication.id } });
  }
  const row = transactionResult.application!;
  await audit(row.id, 'APPLICATION_CREATED', req, { candidateId: transactionResult.candidateId, positionId: position.id });
  if (transactionResult.planId) {
    await audit(row.id, 'FORMAL_ASSESSMENT_PLAN_FINALIZED', req, {
      planId: transactionResult.planId,
      version: 1,
      explicitlyNoAssessment: formalAssessmentCommand!.explicitlyNoAssessment,
    });
  }
  const invitationDelivery = transactionResult.planId
    ? await automaticallySendApplicantInvitation(row.id, mobile, actorId(req))
    : { status: 'NOT_REQUESTED' as const };
  if (transactionResult.planId) {
    await audit(row.id, `CANDIDATE_INVITATION_${invitationDelivery.status}`, req, invitationDelivery);
  }
  res.status(201).json({ success: true, data: { ...row, invitationDelivery } });
}));

router.post('/applications/:id/invitations', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true, formalAssessmentPlans: { where: { status: 'ACTIVE' }, take: 1 } } });
  if (application.stage === 'CLOSED') throw new Error('برای پرونده بسته دعوت‌نامه صادر نمی‌شود.');
  if (!application.formalAssessmentPlans.length) throw new Error('پیش از ارسال دعوت، تصمیم صریح برنامه ارزیابی الزامی است.');
  const mobile = normalizeApplicantMobile(application.candidate.mobile);
  if (!mobile) throw new Error('شماره همراه متقاضی معتبر نیست.');
  const { invitation, otp } = await createApplicantInvitation(application.id, mobile, actorId(req));
  const base = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const entryUrl = `${base.replace(/\/$/, '')}/apply`;
  const sms = await hrHiringSmsGateway.sendInvitation({ phoneNumber: mobile, code: otp });
  if (!sms.success) {
    await prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
    throw new Error(sms.error || 'ارسال پیامک دعوت ناموفق بود.');
  }
  const overlapExpiresAt = new Date(Date.now() + 30 * 60_000);
  await prisma.$transaction([
    prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: { providerMessageId: sms.messageId ? String(sms.messageId) : null, providerDeliveryState: sms.messageId ? 'ACCEPTED' : 'UNKNOWN', providerLastCheckedAt: new Date() } }),
    prisma.hrCandidateInvitation.updateMany({ where: { applicationId: application.id, id: { not: invitation.id }, revokedAt: null, expiresAt: { gt: new Date() } }, data: { overlapExpiresAt } }),
    prisma.hrCandidateAccessThrottle.deleteMany({ where: { subjectKind: 'PHONE', subjectHash: applicantSubjectHash('PHONE', mobile) } })
  ]);
  await audit(application.id, 'CANDIDATE_INVITATION_SENT', req, { invitationId: invitation.id, expiresAt: invitation.expiresAt, providerMessageId: sms.messageId || null, overlapExpiresAt });
  res.status(201).json({ success: true, data: { entryUrl, expiresAt: invitation.expiresAt, providerDeliveryState: sms.messageId ? 'ACCEPTED' : 'UNKNOWN', debugOtp: process.env.SMS_IR_ENVIRONMENT === 'sandbox' ? otp : undefined } });
}));

router.post('/applications/:id/invitations/:invitationId/delivery/refresh', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const invitation = await prisma.hrCandidateInvitation.findFirstOrThrow({ where: { id: req.params.invitationId, applicationId: req.params.id } });
  if (!invitation.providerMessageId) throw new Error('شناسه پیام SMS.ir برای این دعوت ثبت نشده است.');
  if (invitation.createdAt < new Date(Date.now() - 24 * 60 * 60_000)) {
    const row = await prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: { providerDeliveryState: invitation.providerDeliveryState || 'UNKNOWN', providerLastCheckedAt: new Date() } });
    return res.json({ success: true, data: row });
  }
  const report = await hrHiringSmsGateway.getDeliveryReport(Number(invitation.providerMessageId));
  const state = report.success ? mapSmsIrDeliveryState(report.deliveryState) : 'UNKNOWN';
  const deliveryAt = report.deliveryDateTime ? new Date(report.deliveryDateTime * 1000) : null;
  const row = await prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: { providerDeliveryState: state, providerDeliveryAt: deliveryAt, providerLastCheckedAt: new Date() } });
  await audit(req.params.id, 'CANDIDATE_INVITATION_DELIVERY_REFRESHED', req, { invitationId: invitation.id, providerMessageId: invitation.providerMessageId, state, rawDeliveryState: report.deliveryState ?? null });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/form/return', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const latest = await prisma.hrApplicationFormRevision.findFirst({ where: { applicationId: req.params.id, status: 'SUBMITTED' }, orderBy: { revisionNumber: 'desc' } });
  if (!latest) throw new Error('فرم ارسال‌شده پیدا نشد.');
  const requestedFields = normalizeCandidateCorrectionRequest({
    fields: Array.isArray(req.body.fields)
      ? req.body.fields.map((field: unknown) =>
          typeof field === 'string'
            ? { fieldKey: field, explanation: req.body.reason }
            : field)
      : []
  });
  const formKeys = new Set(Object.keys(latest.dataJson as Record<string, unknown>));
  if (requestedFields.some((field) => !formKeys.has(field.fieldKey))) throw new Error('یکی از فیلدهای اصلاح در نسخه فرم وجود ندارد.');
  const mismatches = await prisma.hrIdentityCheck.findMany({
    where: {
      applicationId: req.params.id,
      fieldKey: { in: requestedFields.map((field) => field.fieldKey) },
      status: { in: ['MISMATCH', 'UNREADABLE'] }
    },
    select: { fieldKey: true }
  });
  if (mismatches.length !== requestedFields.length) {
    throw new Error('درخواست اصلاح فقط برای موارد دارای مغایرت یا مدرک ناخوانا قابل ارسال است.');
  }
  const row = await prisma.hrApplicationFormRevision.update({ where: { id: latest.id }, data: {
    status: 'RETURNED',
    correctionFieldsJson: requestedFields.map((field) => field.fieldKey),
    correctionDetailsJson: requestedFields as Prisma.InputJsonValue,
    correctionReason: requestedFields.map((field) => `${field.label}: ${field.explanation}`).join('؛ '),
    correctionNotificationStatus: 'PENDING',
    correctionNotificationError: null,
    returnedAt: new Date(),
    returnedBy: actorId(req)
  }});
  const application = await prisma.hrJobApplication.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { candidate: true }
  });
  const now = new Date();
  const validInvitation = await prisma.hrCandidateInvitation.findFirst({
    where: {
      applicationId: application.id,
      revokedAt: null,
      expiresAt: { gt: now }
    },
    orderBy: { createdAt: 'desc' }
  });
  let replacementOtp: string | undefined;
  let correctionInvitationId: string | null = null;
  if (!validInvitation) {
    replacementOtp = generateApplicantOtp();
    const replacement = await prisma.hrCandidateInvitation.create({
      data: {
        applicationId: application.id,
        mobileSnapshot: application.candidate.mobile,
        otpHash: applicantOtpHash(application.candidate.mobile, replacementOtp),
        otpCiphertext: encryptApplicantOtp(application.candidate.mobile, replacementOtp),
        expiresAt: plusDays(ACCESS_TTL_DAYS),
        createdBy: actorId(req)
      }
    });
    correctionInvitationId = replacement.id;
  }
  const sms = await hrHiringSmsGateway.sendCorrection({
    phoneNumber: application.candidate.mobile,
    details: buildCandidateCorrectionMessage(requestedFields, Boolean(replacementOtp)),
    replacementCode: replacementOtp
  });
  if (!sms.success && correctionInvitationId) {
    await prisma.hrCandidateInvitation.update({
      where: { id: correctionInvitationId },
      data: { revokedAt: new Date() }
    });
  }
  const notification = await prisma.hrApplicationFormRevision.update({
    where: { id: row.id },
    data: sms.success
      ? {
          correctionNotificationStatus: 'SENT',
          correctionNotificationError: null,
          correctionNotifiedAt: new Date(),
          correctionInvitationId
        }
      : {
          correctionNotificationStatus: 'FAILED',
          correctionNotificationError: sms.error || 'ارسال پیامک درخواست اصلاح ناموفق بود.',
          correctionInvitationId
        }
  });
  await audit(req.params.id, 'APPLICATION_FORM_RETURNED', req, {
    revisionNumber: row.revisionNumber,
    fields: requestedFields.map(({ fieldKey, label }) => ({ fieldKey, label })),
    notificationStatus: notification.correctionNotificationStatus,
    reusedExistingAccess: Boolean(validInvitation)
  });
  if (!sms.success) throw new Error(notification.correctionNotificationError || 'ارسال پیامک درخواست اصلاح ناموفق بود.');
  res.json({ success: true, data: notification });
}));

router.post('/applications/:id/form/correction/retry', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const revision = await prisma.hrApplicationFormRevision.findFirst({
    where: {
      applicationId: req.params.id,
      status: 'RETURNED',
      correctionNotificationStatus: 'FAILED'
    },
    orderBy: { revisionNumber: 'desc' }
  });
  if (!revision) throw new Error('درخواست اصلاح ناموفق برای ارسال مجدد پیدا نشد.');
  const requestedFields = normalizeCandidateCorrectionRequest({
    fields: revision.correctionDetailsJson
  });
  const application = await prisma.hrJobApplication.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { candidate: true }
  });
  const validPriorAccess = !revision.correctionInvitationId
    ? await prisma.hrCandidateInvitation.findFirst({
        where: {
          applicationId: application.id,
          revokedAt: null,
          expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' }
      })
    : null;
  let replacementOtp: string | undefined;
  let correctionInvitationId: string | null = revision.correctionInvitationId;
  if (!validPriorAccess) {
    if (correctionInvitationId) {
      await prisma.hrCandidateInvitation.updateMany({
        where: { id: correctionInvitationId, revokedAt: null },
        data: { revokedAt: new Date() }
      });
    }
    replacementOtp = generateApplicantOtp();
    const replacement = await prisma.hrCandidateInvitation.create({
      data: {
        applicationId: application.id,
        mobileSnapshot: application.candidate.mobile,
        otpHash: applicantOtpHash(application.candidate.mobile, replacementOtp),
        otpCiphertext: encryptApplicantOtp(application.candidate.mobile, replacementOtp),
        expiresAt: plusDays(ACCESS_TTL_DAYS),
        createdBy: actorId(req)
      }
    });
    correctionInvitationId = replacement.id;
  }
  const sms = await hrHiringSmsGateway.sendCorrection({
    phoneNumber: application.candidate.mobile,
    details: buildCandidateCorrectionMessage(requestedFields, Boolean(replacementOtp)),
    replacementCode: replacementOtp
  });
  if (!sms.success && correctionInvitationId) {
    await prisma.hrCandidateInvitation.update({
      where: { id: correctionInvitationId },
      data: { revokedAt: new Date() }
    });
  }
  const updated = await prisma.hrApplicationFormRevision.update({
    where: { id: revision.id },
    data: sms.success
      ? {
          correctionNotificationStatus: 'SENT',
          correctionNotificationError: null,
          correctionNotifiedAt: new Date(),
          correctionInvitationId
        }
      : {
          correctionNotificationError: sms.error || 'ارسال پیامک درخواست اصلاح ناموفق بود.',
          correctionInvitationId
        }
  });
  await audit(req.params.id, 'APPLICATION_CORRECTION_NOTIFICATION_RETRIED', req, {
    revisionNumber: revision.revisionNumber,
    success: sms.success,
    replacementAccessCreated: Boolean(replacementOtp)
  });
  if (!sms.success) throw new Error(updated.correctionNotificationError || 'ارسال پیامک درخواست اصلاح ناموفق بود.');
  res.json({ success: true, data: updated });
}));

router.post('/applications/:id/documents', requireActionPermission('REVIEW_IDENTITY_DOCUMENTS'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const gate = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, select: { preIdentityReleasedAt: true, preIdentityGrandfatheredAt: true } });
    if (!gate.preIdentityReleasedAt && !gate.preIdentityGrandfatheredAt) throw new Error('چک‌لیست پیش از احراز هویت هنوز آزاد نشده است.');
    if (!DOCUMENT_CATEGORIES.has(req.body.category) || !['ORIGINAL_SEEN', 'COPY_RECEIVED'].includes(req.body.inspectionSource)) throw new Error('دسته یا منبع مشاهده سند نامعتبر است.');
    const customTitle = normalizeHiringDocumentTitle(req.body.category, req.body.customTitle);
    const copyReceived = req.body.inspectionSource === 'COPY_RECEIVED';
    if (copyReceived && !req.file) throw new Error('فایل کپی دریافت‌شده الزامی است.');
    if (!copyReceived && req.file) throw new Error('برای ثبت مشاهده اصل نباید فایل بارگذاری شود.');
    if (req.file) validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = req.file ? await scanHiringFile(req.file.path) : null;
    const digest = req.file ? await sha256File(req.file.path) : null;
    const aggregate = await prisma.hrHiringDocument.aggregate({ where: { applicationId: req.params.id, category: req.body.category, side: req.body.side || null, customTitle }, _max: { version: true } });
    const row = await prisma.hrHiringDocument.create({ data: {
      applicationId: req.params.id, category: req.body.category, side: req.body.side || null, customTitle,
      version: (aggregate._max.version || 0) + 1, inspectionSource: req.body.inspectionSource,
      storageName: req.file?.filename || null, originalName: req.file?.originalname || null, mimeType: req.file?.mimetype || null, size: req.file?.size || null,
      sha256: digest, malwareScanStatus: scanStatus, note: req.body.note || null, uploadedBy: actorId(req)
    }});
    await audit(req.params.id, copyReceived ? 'IDENTITY_DOCUMENT_UPLOADED' : 'IDENTITY_DOCUMENT_ORIGINAL_INSPECTED', req, { documentId: row.id, category: row.category, customTitle: row.customTitle, version: row.version });
    await syncAutomaticHiringWorkItems();
    res.status(201).json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file?.path); throw error; }
}));

router.get('/applications/:id/documents/:documentId/download', requireActionPermission('VIEW_FULL_APPLICANT_INFORMATION'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const document = await prisma.hrHiringDocument.findFirst({ where: { id: req.params.documentId, applicationId: req.params.id } });
  if (!document?.storageName || !document.originalName) return res.status(404).json({ success: false, error: 'فایل سند پیدا نشد.' });
  await audit(req.params.id, 'IDENTITY_DOCUMENT_DOWNLOADED', req, { documentId: document.id });
  await audit(req.params.id, 'SENSITIVE_RECRUITMENT_EVIDENCE_ACCESSED', req, { evidenceType: 'IDENTITY', evidenceId: document.id, action: 'DOWNLOAD' });
  res.download(safeHiringStoragePath(document.storageName), document.originalName);
}));

router.put('/applications/:id/identity-checks/:fieldKey', requireActionPermission('REVIEW_IDENTITY_DOCUMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const gate = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, select: { preIdentityReleasedAt: true, preIdentityGrandfatheredAt: true } });
  if (!gate.preIdentityReleasedAt && !gate.preIdentityGrandfatheredAt) throw new Error('چک‌لیست پیش از احراز هویت هنوز آزاد نشده است.');
  if (!['VERIFIED', 'MISMATCH', 'UNREADABLE', 'NOT_APPLICABLE'].includes(req.body.status)) throw new Error('وضعیت کنترل هویت نامعتبر است.');
  const row = await prisma.hrIdentityCheck.upsert({
    where: { applicationId_fieldKey: { applicationId: req.params.id, fieldKey: req.params.fieldKey } },
    create: { applicationId: req.params.id, fieldKey: req.params.fieldKey, status: req.body.status, note: req.body.note || null, reviewedBy: actorId(req) },
    update: { status: req.body.status, note: req.body.note || null, reviewedBy: actorId(req), reviewedAt: new Date() }
  });
  await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { identityClearance: 'IN_PROGRESS' } });
  await syncAutomaticHiringWorkItems();
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/identity/approve', requireActionPermission('APPROVE_IDENTITY_CLEARANCE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [application, checks, docs] = await Promise.all([
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true } }),
    prisma.hrIdentityCheck.findMany({ where: { applicationId: req.params.id } }),
    prisma.hrHiringDocument.findMany({ where: { applicationId: req.params.id } })
  ]);
  if (!application.preIdentityReleasedAt && !application.preIdentityGrandfatheredAt) throw new Error('چک‌لیست پیش از احراز هویت هنوز آزاد نشده است.');
  const actorReviewedEvidence = checks.some((item) => item.reviewedBy === actorId(req)) || docs.some((item) => item.uploadedBy === actorId(req));
  const actorPermissions = actorReviewedEvidence ? await activeHrActionPermissionsForUser(prisma, actorId(req)) : [];
  const managerialSelfApproval = actorReviewedEvidence && Boolean((req as any).hrBroadManagerOverride)
    && actorPermissions.includes('REVIEW_IDENTITY_DOCUMENTS')
    && actorPermissions.includes('APPROVE_IDENTITY_CLEARANCE');
  if (actorReviewedEvidence && !managerialSelfApproval) throw new Error('مدیر تأییدکننده نباید پردازش‌کننده اسناد یا تطبیق‌های همین پرونده باشد.');
  const requiredVerifiedChecks = ['firstName', 'lastName', 'birthDate', 'birthPlace', 'fatherName', application.candidate.nationalCode ? 'nationalCode' : 'foreignIdentity', 'address', 'postalCode', 'mobile', 'educationLevel', 'maritalStatus'];
  if (requiredVerifiedChecks.some((fieldKey) => !checks.some((item) => item.fieldKey === fieldKey && item.status === 'VERIFIED'))) throw new Error('همه کنترل‌های الزامی هویتی باید مطابق باشند.');
  if (['militaryStatus', 'birthCertificateExplanations'].some((fieldKey) => !checks.some((item) => item.fieldKey === fieldKey && ['VERIFIED', 'NOT_APPLICABLE'].includes(item.status)))) throw new Error('وضعیت نظام وظیفه و توضیحات شناسنامه باید تعیین تکلیف شوند.');
  const latestDocuments = Array.from(docs.reduce((byCategory, document) => {
    const key = `${document.category}:${document.side || ''}:${document.customTitle || ''}`;
    const current = byCategory.get(key);
    if (!current || document.version > current.version) byCategory.set(key, document);
    return byCategory;
  }, new Map<string, typeof docs[number]>()).values());
  if (!latestDocuments.length || latestDocuments.some((item) => ['UNREADABLE', 'MISMATCH'].includes(item.status))) throw new Error('آخرین نسخه اسناد هویتی دارای نقص حل‌نشده است.');
  if (application.candidate.nationalCode) {
    const categories = new Set(latestDocuments.map((item) => item.category));
    const missingDocuments = ['BIRTH_CERTIFICATE_ALL_PAGES', 'NATIONAL_ID_FRONT', 'NATIONAL_ID_BACK'].filter((category) => !categories.has(category));
    if (missingDocuments.length) throw new Error(`اسناد هویتی الزامی ناقص‌اند: ${missingDocuments.join(', ')}`);
  }
  await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { identityClearance: 'APPROVED', stage: 'ASSESSMENT' } });
  await audit(req.params.id, 'IDENTITY_CLEARANCE_APPROVED', req, managerialSelfApproval
    ? { managerialSelfApproval: true, overrideLabel: 'استفاده از اختیار مدیریتی' } : undefined);
  await syncAutomaticHiringWorkItems();
  res.json({ success: true });
}));

router.post('/applications/:id/compensation', requireActionPermission('MANAGE_COMPENSATION'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const components = normalizeCompensationComponents(Array.isArray(req.body.components) ? req.body.components : []);
  const total = compensationTotalRials(components);
  await assertFormalAssessmentEvidenceComplete(req.params.id);
  const holidayRows = await prisma.sabalanCalendarEntry.findMany({ where: { isActive: true, isHoliday: true }, select: { date: true } });
  const holidays = new Set(holidayRows.map((entry) => tehranCivilDateKey(entry.date)));
  const row = await prisma.$transaction(async (tx) => {
    const application = await tx.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
    if (application.identityClearance !== 'APPROVED') throw new Error('پیشنهاد جبران خدمات پس از تأیید هویت ثبت می‌شود.');
    if (application.acceptedOfferAt) throw new Error('پس از پذیرش متقاضی، تغییر پیشنهاد نیازمند فرایند اصلاح قرارداد است.');
    const latest = await tx.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' } });
    if (latest && !latest.obsoleteAt && latest.payrollReviewStatus !== 'RETURNED' && latest.candidateDecision !== 'DECLINED') {
      throw new Error('آخرین پیشنهاد هنوز فعال است و ابتدا باید بررسی یا تعیین تکلیف شود.');
    }
    const now = new Date();
    const created = await tx.hrCompensationSnapshot.create({ data: {
      applicationId: req.params.id,
      version: (latest?.version || 0) + 1,
      componentsJson: components,
      totalRials: total.toString(),
      proposedBy: actorId(req),
      payrollReviewStatus: 'PENDING',
      verificationDueAt: compensationVerificationDueAt(now, holidays),
      supersedesSnapshotId: latest?.payrollReviewStatus === 'RETURNED' ? latest.id : null,
      createdAt: now,
    }});
    await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { compensationClearance: 'IN_PROGRESS', stage: 'OFFER' } });
    await auditWithDatabase(tx, req.params.id, 'COMPENSATION_PROPOSED', req, {
      snapshotId: created.id,
      version: created.version,
      supersedesSnapshotId: created.supersedesSnapshotId,
      verificationDueAt: created.verificationDueAt?.toISOString() || null,
    });
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/compensation/:snapshotId/payroll-review', requireActionPermission('MANAGE_PAYROLL'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await assertFormalAssessmentEvidenceComplete(req.params.id);
  const decision = String(req.body.decision || '');
  if (!['APPROVE', 'RETURN'].includes(decision)) throw new Error('نتیجه بررسی پیشنهاد حقوق معتبر نیست.');
  const returnReason = decision === 'RETURN' ? normalizeCompensationReturnReason({
    code: req.body.reasonCode,
    detail: req.body.reasonDetail,
  }) : null;
  const claimToken = decision === 'APPROVE' ? crypto.randomUUID() : null;
  const result = await prisma.$transaction(async (tx) => {
    const [row, latest, application] = await Promise.all([
      tx.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } }),
      tx.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } }),
      tx.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true } }),
    ]);
    if (latest?.id !== row.id || row.applicationId !== req.params.id) throw new Error('فقط آخرین نسخه پیشنهاد قابل بررسی است.');
    const selfVerification = row.proposedBy === actorId(req);
    if (selfVerification && !(req as any).hrBroadManagerOverride) throw new Error('بررسی‌کننده حقوق و دستمزد باید مستقل از پیشنهاددهنده باشد.');
    if (row.payrollReviewStatus !== 'PENDING') throw new Error('این نسخه قبلاً بررسی شده است.');
    const now = new Date();
    const updated = await tx.hrCompensationSnapshot.update({
      where: { id: row.id },
      data: decision === 'APPROVE' ? {
        payrollReviewStatus: 'VERIFIED',
        payrollVerifiedBy: actorId(req),
        payrollVerifiedAt: now,
        candidateNotificationStatus: 'PENDING',
        candidateNotificationClaimedAt: now,
        candidateNotificationClaimToken: claimToken,
      } : {
        payrollReviewStatus: 'RETURNED',
        payrollReturnedBy: actorId(req),
        payrollReturnedAt: now,
        payrollReturnReasonCode: returnReason!.code,
        payrollReturnReasonDetail: returnReason!.detail,
      },
    });
    await auditWithDatabase(tx, req.params.id, decision === 'APPROVE' ? 'COMPENSATION_PAYROLL_VERIFIED' : 'COMPENSATION_PAYROLL_RETURNED', req, {
      snapshotId: row.id,
      selfApproval: selfVerification,
      reasonCode: returnReason?.code || null,
      reasonDetail: returnReason?.detail || null,
    });
    return { updated, mobile: application.candidate.mobile };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  const updated = decision === 'APPROVE' && claimToken
    ? await deliverClaimedOfferNotification(req.params.id, result.updated.id, result.mobile, claimToken, actorId(req))
    : result.updated;
  await audit(req.params.id, decision === 'APPROVE' ? 'OFFER_NOTIFICATION_ATTEMPTED' : 'COMPENSATION_RETURN_COMPLETED', req, {
    snapshotId: result.updated.id,
    notificationStatus: decision === 'APPROVE' ? updated.candidateNotificationStatus : null,
  });
  res.json({ success: true, data: updated });
}));

router.all('/applications/:id/compensation/:snapshotId/prepare', (_req, res) => res.status(410).json({ success: false, error: 'مرحله آماده‌سازی جداگانه بازنشسته شده است.' }));
router.all('/applications/:id/compensation/:snapshotId/hr-approve', (_req, res) => res.status(410).json({ success: false, error: 'از بررسی یک‌مرحله‌ای حقوق و دستمزد استفاده کنید.' }));
router.all('/applications/:id/compensation/:snapshotId/finance-approve', (_req, res) => res.status(410).json({ success: false, error: 'پیشنهاد حقوق دیگر تأیید مالی جداگانه ندارد.' }));

router.post('/applications/:id/compensation/:snapshotId/notification/retry', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [snapshot, application] = await Promise.all([
    prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } }),
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true } })
  ]);
  const latest = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== snapshot.id || !isCompensationPayrollVerified(snapshot)) throw new Error('فقط اعلان آخرین پیشنهاد بررسی‌شده قابل ارسال است.');
  if (snapshot.candidateNotificationStatus === 'SENT') return res.json({ success: true, data: snapshot });
  const claimToken = crypto.randomUUID();
  const claim = await prisma.hrCompensationSnapshot.updateMany({
    where: {
      id: snapshot.id,
      candidateNotificationStatus: { not: 'SENT' },
      OR: [
        { candidateNotificationStatus: 'FAILED' },
        { candidateNotificationStatus: null },
        { candidateNotificationStatus: 'PENDING', candidateNotificationClaimedAt: { lt: new Date(Date.now() - 10 * 60_000) } }
      ]
    },
    data: {
      candidateNotificationStatus: 'PENDING',
      candidateNotificationClaimedAt: new Date(),
      candidateNotificationClaimToken: claimToken
    }
  });
  if (claim.count === 0) {
    const current = await prisma.hrCompensationSnapshot.findUniqueOrThrow({
      where: { id: snapshot.id }
    });
    return res.json({ success: true, data: current });
  }
  const updated = await deliverClaimedOfferNotification(
    req.params.id,
    snapshot.id,
    application.candidate.mobile,
    claimToken,
    actorId(req),
  );
  await audit(req.params.id, 'OFFER_NOTIFICATION_RETRIED', req, {
    snapshotId: snapshot.id,
    success: updated.candidateNotificationStatus === 'SENT'
  });
  if (updated.candidateNotificationStatus !== 'SENT') throw new Error(updated.candidateNotificationError || 'ارسال پیامک پیشنهاد همکاری ناموفق بود.');
  res.json({ success: true, data: updated });
}));

router.post('/applications/:id/compensation/:snapshotId/offline-decision', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const evidence = validateOfflineOfferDecision(req.body);
  const [snapshot, latest, application, submittedFullName] = await Promise.all([
    prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } }),
    prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } }),
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } }),
    latestSubmittedFullName(req.params.id)
  ]);
  if (latest?.id !== snapshot.id || !isCompensationPayrollVerified(snapshot) || snapshot.obsoleteAt) throw new Error('تصمیم آفلاین فقط برای آخرین پیشنهاد بررسی‌شده و غیرمنسوخ قابل ثبت است.');
  await assertFormalAssessmentEvidenceComplete(req.params.id);
  if (snapshot.candidateDecision) throw new Error('برای این نسخه قبلاً تصمیم ثبت شده است.');
  if (normalizedName(evidence.confirmedCandidateInformation) !== submittedFullName) {
    throw new Error('نام کامل تأییدشده باید با آخرین فرم ثبت‌شده متقاضی یکسان باشد.');
  }
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const latestInTransaction = await tx.hrCompensationSnapshot.findFirst({
      where: { applicationId: req.params.id },
      orderBy: { version: 'desc' },
      select: { id: true }
    });
    if (latestInTransaction?.id !== snapshot.id) throw new Error('نسخه جدیدتری از پیشنهاد ثبت شده است. صفحه را دوباره بارگذاری کنید.');
    const decision = await tx.hrCompensationSnapshot.updateMany({
      where: { id: snapshot.id, candidateDecision: null },
      data: {
        candidateDecision: evidence.decision,
        candidateDecisionAt: now,
        candidateDecisionSource: 'HR_PROCESSOR_OFFLINE',
        candidateDecisionBy: actorId(req),
        candidateAcceptedAt: evidence.decision === 'ACCEPTED' ? now : null,
        candidateAcceptedName:
          evidence.decision === 'ACCEPTED' ? submittedFullName : null,
        candidateDeclineCategory:
          evidence.decision === 'DECLINED' ? 'OFFLINE_CONFIRMED' : null,
        candidateDecisionNote: evidence.note,
        offlineCommunicationMethod: evidence.communicationMethod,
        offlineCommunicatedAt: evidence.communicatedAt,
        offlineReason: evidence.offlineReason,
        offlineConfirmedInformation: submittedFullName
      }
    });
    if (decision.count !== 1) throw new Error('برای این نسخه قبلاً تصمیم ثبت شده است.');
    await tx.hrJobApplication.update({
      where: { id: req.params.id },
      data: evidence.decision === 'ACCEPTED'
        ? { acceptedOfferAt: now, stage: 'OFFER', compensationClearance: 'APPROVED' }
        : { acceptedOfferAt: null, stage: 'OFFER', compensationClearance: 'REJECTED' }
    });
    if (evidence.decision === 'ACCEPTED') {
      await reconcileAcceptedOfferFollowUp(tx, {
        applicationId: req.params.id, actorUserId: actorId(req), now,
      });
    }
    if (evidence.decision === 'DECLINED') await notifyOfferDecline(tx, req.params.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req.params.id, 'OFFER_OFFLINE_DECISION_RECORDED', req, { snapshotId: snapshot.id, ...evidence, communicatedAt: evidence.communicatedAt.toISOString() });
  res.json({ success: true });
}));

router.post('/applications/:id/formal-assessment-plans', requireActionPermission('MANAGE_COMPANY_EVALUATION_PLAN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const applicationId = req.params.id;
  const row = await prisma.$transaction(async (tx) => {
    const application = await tx.hrJobApplication.findUniqueOrThrow({ where: { id: applicationId }, select: { convertedAt: true, stage: true, outcome: true } });
    if (application.convertedAt || application.outcome === 'HIRED') throw new Error('برنامه ارزیابی پس از تبدیل استخدامی قابل تغییر نیست.');
    if (application.stage === 'CLOSED') throw new Error('پرونده بسته باید پیش از بازنگری رسمی بازگشایی شود.');
    const plans = await tx.hrFormalAssessmentPlan.findMany({ where: { applicationId }, include: formalAssessmentPlanInclude, orderBy: { version: 'desc' } });
    const current = plans.find((plan) => plan.status === 'ACTIVE') || null;
    const command = normalizeFormalAssessmentPlanCommand(req.body || {}, Boolean(current));
    const version = (plans[0]?.version ?? 0) + 1;
    if (current) await tx.hrFormalAssessmentPlan.update({ where: { id: current.id }, data: { status: 'SUPERSEDED' } });
    const plan = await tx.hrFormalAssessmentPlan.create({
      data: {
        stableKey: `formal-assessment-plan:${applicationId}:${version}`,
        applicationId,
        version,
        explicitlyNoAssessment: command.explicitlyNoAssessment,
        executionMethod: command.executionMethod,
        finalizedByUserId: actorId(req),
        reason: command.reason || null,
        predecessorPlanId: current?.id || null,
        selections: { create: FORMAL_ASSESSMENT_KINDS.map((assessmentKind) => {
          const selected = command.selections.find((item) => item.assessmentKind === assessmentKind);
          return { assessmentKind, selected: Boolean(selected), executionMethod: selected?.executionMethod ?? null };
        }) },
      },
      include: formalAssessmentPlanInclude,
    });
    for (const selection of plan.selections.filter((item) => item.selected)) {
      const previousSelection = current?.selections.find((item) => item.assessmentKind === selection.assessmentKind && item.selected);
      const results = plans.flatMap((item) => item.results).filter((item) => item.assessmentKind === selection.assessmentKind);
      const latest = results.sort((left, right) => right.resultVersion - left.resultVersion)[0];
      const requiresResult = !latest || latest.status !== 'COMPLETED' || command.repeatKinds.includes(selection.assessmentKind) || previousSelection?.executionMethod !== selection.executionMethod;
      if (!requiresResult) continue;
      const resultVersion = (latest?.resultVersion ?? 0) + 1;
      await tx.hrFormalAssessmentResult.create({ data: {
        stableKey: `formal-assessment-result:${applicationId}:${selection.assessmentKind}:${resultVersion}`,
        applicationId,
        planId: plan.id,
        planSelectionId: selection.id,
        assessmentKind: selection.assessmentKind,
        resultVersion,
        status: 'PENDING',
        supersedesResultId: latest?.id || null,
      } });
    }
    return tx.hrFormalAssessmentPlan.findUniqueOrThrow({ where: { id: plan.id }, include: formalAssessmentPlanInclude });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(applicationId, row.version === 1 ? 'FORMAL_ASSESSMENT_PLAN_FINALIZED' : 'FORMAL_ASSESSMENT_PLAN_REVISED', req, { planId: row.id, version: row.version, explicitlyNoAssessment: row.explicitlyNoAssessment, reason: row.reason });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/formal-assessments/:kind/result', requireActionPermission('RECORD_COMPANY_EVALUATION_RESULT'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const applicationId = req.params.id;
  const kind = String(req.params.kind || '') as FormalAssessmentKind;
  if (!FORMAL_ASSESSMENT_KINDS.includes(kind)) throw new Error('نوع ارزیابی رسمی نامعتبر است.');
  const responseJson = normalizeCandidateAssessmentResult(kind, req.body?.result);
  const correctionReason = String(req.body?.correctionReason || '').trim();
  const row = await prisma.$transaction(async (tx) => {
    const plan = await tx.hrFormalAssessmentPlan.findFirstOrThrow({ where: { applicationId, status: 'ACTIVE' }, include: formalAssessmentPlanInclude, orderBy: { version: 'desc' } });
    const selection = plan.selections.find((item) => item.selected && item.assessmentKind === kind);
    if (!selection || selection.executionMethod !== 'COMPANY') throw new Error('این ارزیابی برای اجرا توسط شرکت فعال نیست.');
    const latest = await tx.hrFormalAssessmentResult.findFirst({ where: { applicationId, assessmentKind: kind }, orderBy: { resultVersion: 'desc' } });
    authorizeFormalAssessmentResultCommand({
      executionMethod: 'COMPANY',
      actorKind: 'USER',
      actorAuthorities: [latest?.status === 'COMPLETED' ? 'HR_MANAGER' : 'HR_PROCESSOR'],
      hasCompletedResult: latest?.status === 'COMPLETED',
      correctionReason,
    });
    const now = new Date();
    if (latest?.status === 'PENDING') return tx.hrFormalAssessmentResult.update({ where: { id: latest.id }, data: {
      status: 'COMPLETED', resultJson: responseJson as Prisma.InputJsonValue, recordedByUserId: actorId(req), recordedAt: now,
      attempts: { create: { stableKey: `formal-assessment-attempt:${applicationId}:${kind}:${latest.resultVersion}:1`, attemptNumber: 1, executionMethod: 'COMPANY', status: 'COMPLETED', startedAt: now, completedAt: now, actorUserId: actorId(req), responseJson: responseJson as Prisma.InputJsonValue } },
    } });
    const resultVersion = (latest?.resultVersion ?? 0) + 1;
    return tx.hrFormalAssessmentResult.create({ data: {
      stableKey: `formal-assessment-result:${applicationId}:${kind}:${resultVersion}`, applicationId, planId: plan.id, planSelectionId: selection.id,
      assessmentKind: kind, resultVersion, status: 'COMPLETED', resultJson: responseJson as Prisma.InputJsonValue, recordedByUserId: actorId(req), recordedAt: now,
      supersedesResultId: latest?.id || null,
      attempts: { create: { stableKey: `formal-assessment-attempt:${applicationId}:${kind}:${resultVersion}:1`, attemptNumber: 1, executionMethod: 'COMPANY', status: 'COMPLETED', startedAt: now, completedAt: now, actorUserId: actorId(req), responseJson: responseJson as Prisma.InputJsonValue } },
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(applicationId, row.resultVersion === 1 ? 'FORMAL_ASSESSMENT_RESULT_COMPLETED' : 'FORMAL_ASSESSMENT_RESULT_CORRECTED', req, { assessmentKind: kind, resultVersion: row.resultVersion, correctionReason: correctionReason || null });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/formal-assessments/:kind/evidence', requireActionPermission('MANAGE_RECRUITMENT_CASE'), upload.array('files', 5), asyncHandler(async (req: AuthRequest, res: Response) => {
  const applicationId = req.params.id;
  const kind = String(req.params.kind || '') as FormalAssessmentKind;
  if (!FORMAL_ASSESSMENT_KINDS.includes(kind)) throw new Error('نوع ارزیابی رسمی نامعتبر است.');
  const files = (req.files as Express.Multer.File[] | undefined) || [];
  if (!files.length) throw new Error('حداقل یک فایل برای بارگذاری انتخاب کنید.');
  if (files.some((file) => file.size > 10 * 1024 * 1024)) {
    files.forEach((file) => removeHiringFile(file.path));
    throw new Error('حجم هر پیوست ارزیابی رسمی باید حداکثر ۱۰ مگابایت باشد.');
  }
  try {
    const result = await prisma.hrFormalAssessmentResult.findFirst({
      where: { applicationId, assessmentKind: kind, status: 'COMPLETED' },
      include: { attempts: { where: { executionMethod: 'COMPANY', status: 'COMPLETED' }, orderBy: { attemptNumber: 'desc' }, take: 1 } },
      orderBy: { resultVersion: 'desc' },
    });
    const attempt = result?.attempts[0];
    if (!attempt) throw new Error('ابتدا نتیجه ارزیابی را ثبت کنید.');
    const stored: Array<{ id: string; originalName: string | null; mimeType: string | null; size: number | null }> = [];
    for (const file of files) {
      validateHiringFileSignature(file.path, file.mimetype);
      const [scanStatus, digest, aggregate] = await Promise.all([
        scanHiringFile(file.path),
        sha256File(file.path),
        prisma.hrHiringDocument.aggregate({
          where: { applicationId, category: 'FORMAL_ASSESSMENT', side: kind, customTitle: file.originalname },
          _max: { version: true },
        }),
      ]);
      const document = await prisma.hrHiringDocument.create({ data: {
        applicationId,
        category: 'FORMAL_ASSESSMENT',
        side: kind,
        customTitle: file.originalname,
        version: (aggregate._max.version || 0) + 1,
        inspectionSource: 'COPY_RECEIVED',
        storageName: file.filename,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
        sha256: digest,
        malwareScanStatus: scanStatus,
        uploadedBy: actorId(req),
        formalAssessmentEvidenceLinks: { create: {
          stableKey: `formal-assessment-evidence:${attempt.id}:${crypto.randomUUID()}`,
          attemptId: attempt.id,
          evidenceType: 'COMPANY_ATTACHMENT',
          evidenceHash: digest,
          linkedByUserId: actorId(req),
        } },
      } });
      stored.push({ id: document.id, originalName: document.originalName, mimeType: document.mimeType, size: document.size });
    }
    await audit(applicationId, 'FORMAL_ASSESSMENT_EVIDENCE_UPLOADED', req, { assessmentKind: kind, count: stored.length });
    res.status(201).json({ success: true, data: stored });
  } catch (error) {
    files.forEach((file) => removeHiringFile(file.path));
    throw error;
  }
}));

type CompletedFinalRejectionResult = { id: string; assessmentKind: string; resultVersion: number };

export const latestCompletedFinalRejectionResultReferences = (results: CompletedFinalRejectionResult[]) => {
  const latest = new Map<string, CompletedFinalRejectionResult>();
  for (const result of results) {
    const current = latest.get(result.assessmentKind);
    if (!current || result.resultVersion > current.resultVersion) latest.set(result.assessmentKind, result);
  }
  return Array.from(latest.values());
};

router.post('/applications/:id/final-rejection', requireActionPermission('RECORD_PRELIMINARY_DECISION', 'RECORD_FINAL_MANAGEMENT_DECISION'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const applicationId = req.params.id;
  const reason = String(req.body?.reason || '').trim();
  if (!reason) throw new Error('دلیل رد نهایی الزامی است.');
  const [application, completedResults] = await Promise.all([
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: applicationId }, include: { collateralItems: true } }),
    prisma.hrFormalAssessmentResult.findMany({
      where: { applicationId, status: 'COMPLETED' },
      select: { id: true, assessmentKind: true, resultVersion: true },
    }),
  ]);
  const referencedResults = latestCompletedFinalRejectionResultReferences(completedResults);
  if (application.convertedAt || application.outcome === 'HIRED') throw new Error('پرونده تبدیل‌شده قابل رد نهایی نیست.');
  if (application.collateralItems.some((item) => item.receivedAt && (!item.returnedAt || !item.returnConfirmedAt))) {
    const count = await initiatePendingCollateralReturns(application, 'REJECTED', reason, actorId(req));
    return res.status(202).json({ success: true, data: { pendingCollateralReturns: count }, message: 'درخواست بازگرداندن اصل وثیقه در وظایف امور مالی ایجاد شد.' });
  }
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.hrJobApplication.update({ where: { id: applicationId }, data: { stage: 'CLOSED', preClosureStage: application.stage, outcome: 'REJECTED', outcomeReason: reason } });
    await tx.hrCandidateInvitation.updateMany({ where: { applicationId, revokedAt: null }, data: { revokedAt: now } });
    return updated;
  });
  await audit(applicationId, 'APPLICATION_FINAL_REJECTED', req, { reason, actionPermissions: ['RECORD_PRELIMINARY_DECISION', 'RECORD_FINAL_MANAGEMENT_DECISION'], resultVersions: referencedResults });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/assessments', requireActionPermission('MANAGE_RECRUITMENT_CASE'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    let submittedResult: unknown;
    try {
      submittedResult = typeof req.body.resultJson === 'string' ? JSON.parse(req.body.resultJson) : req.body.resultJson;
    } catch {
      throw new Error('ساختار نتیجه ارزیابی معتبر نیست.');
    }
    const resultJson = normalizeCandidateAssessmentResult(req.body.assessmentType, submittedResult);
    if (req.file) validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = req.file ? await scanHiringFile(req.file.path) : undefined;
    const digest = req.file ? await sha256File(req.file.path) : undefined;
    const [version, hasOffer] = await Promise.all([
      prisma.hrCandidateAssessment.aggregate({
        where: { applicationId: req.params.id, assessmentType: req.body.assessmentType },
        _max: { version: true }
      }),
      prisma.hrCompensationSnapshot.count({ where: { applicationId: req.params.id } })
    ]);
    const row = await prisma.hrCandidateAssessment.create({ data: {
      applicationId: req.params.id, assessmentType: req.body.assessmentType, resultJson,
      storageName: req.file?.filename, originalName: req.file?.originalname, mimeType: req.file?.mimetype,
      size: req.file?.size, sha256: digest, malwareScanStatus: scanStatus, recordedBy: actorId(req),
      version: (version._max.version || 0) + 1
    }});
    await prisma.hrJobApplication.update({
      where: { id: req.params.id },
      data: {
        assessmentCompletedBy: null,
        assessmentCompletedAt: null,
        assessmentDecision: null,
        assessmentDecisionBy: null,
        assessmentDecisionAt: null,
        assessmentDecisionReason: null,
        assessmentReviewRequired: hasOffer > 0,
        assessmentReviewAcknowledgedBy: null,
        assessmentReviewAcknowledgedAt: null
      }
    });
    await audit(req.params.id, 'CANDIDATE_ASSESSMENT_RECORDED', req, { assessmentId: row.id, assessmentType: row.assessmentType });
    res.status(201).json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file?.path); throw error; }
}));

router.post('/applications/:id/assessments/complete', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const activeCount = await prisma.hrCandidateAssessment.count({
    where: { applicationId: req.params.id, status: 'ACTIVE' }
  });
  if (!activeCount) throw new Error('برای تکمیل مرحله، حداقل یک ارزیابی فعال لازم است.');
  const row = await prisma.hrJobApplication.update({
    where: { id: req.params.id },
    data: {
      assessmentCompletedBy: actorId(req),
      assessmentCompletedAt: new Date()
    }
  });
  await audit(req.params.id, 'CANDIDATE_ASSESSMENT_COMPLETED', req, { activeAssessmentCount: activeCount });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/assessments/:assessmentId/revise', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const previous = await prisma.hrCandidateAssessment.findFirstOrThrow({
    where: { id: req.params.assessmentId, applicationId: req.params.id, status: 'ACTIVE' }
  });
  const resultJson = normalizeCandidateAssessmentResult(previous.assessmentType, req.body.resultJson);
  const hasOffer = await prisma.hrCompensationSnapshot.count({ where: { applicationId: req.params.id } });
  const next = await prisma.$transaction(async (tx) => {
    await tx.hrCandidateAssessment.update({ where: { id: previous.id }, data: { status: 'SUPERSEDED' } });
    const created = await tx.hrCandidateAssessment.create({
      data: {
        applicationId: previous.applicationId,
        assessmentType: previous.assessmentType,
        resultJson,
        storageName: previous.storageName,
        originalName: previous.originalName,
        mimeType: previous.mimeType,
        size: previous.size,
        sha256: previous.sha256,
        malwareScanStatus: previous.malwareScanStatus,
        recordedBy: actorId(req),
        version: previous.version + 1,
        supersedesAssessmentId: previous.id
      }
    });
    await tx.hrJobApplication.update({
      where: { id: req.params.id },
      data: {
        assessmentCompletedBy: null,
        assessmentCompletedAt: null,
        assessmentDecision: null,
        assessmentDecisionBy: null,
        assessmentDecisionAt: null,
        assessmentDecisionReason: null,
        assessmentReviewRequired: hasOffer > 0,
        assessmentReviewAcknowledgedBy: null,
        assessmentReviewAcknowledgedAt: null
      }
    });
    return created;
  });
  await audit(req.params.id, 'CANDIDATE_ASSESSMENT_REVISED', req, { assessmentId: next.id, supersedesAssessmentId: previous.id, version: next.version });
  res.status(201).json({ success: true, data: next });
}));

router.post('/applications/:id/assessments/:assessmentId/void', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new Error('دلیل حذف ارزیابی الزامی است.');
  const [assessmentToVoid, hasOffer] = await Promise.all([
    prisma.hrCandidateAssessment.findFirstOrThrow({
      where: {
        id: req.params.assessmentId,
        applicationId: req.params.id,
        status: 'ACTIVE'
      },
      select: { id: true }
    }),
    prisma.hrCompensationSnapshot.count({ where: { applicationId: req.params.id } })
  ]);
  const row = await prisma.$transaction(async (tx) => {
    const assessment = await tx.hrCandidateAssessment.update({
      where: { id: assessmentToVoid.id },
      data: { status: 'VOIDED', voidedBy: actorId(req), voidedAt: new Date(), voidReason: reason }
    });
    await tx.hrJobApplication.update({
      where: { id: req.params.id },
      data: {
        assessmentCompletedBy: null,
        assessmentCompletedAt: null,
        assessmentDecision: null,
        assessmentDecisionBy: null,
        assessmentDecisionAt: null,
        assessmentDecisionReason: null,
        assessmentReviewRequired: hasOffer > 0,
        assessmentReviewAcknowledgedBy: null,
        assessmentReviewAcknowledgedAt: null
      }
    });
    return assessment;
  });
  await audit(req.params.id, 'CANDIDATE_ASSESSMENT_VOIDED', req, { assessmentId: row.id, reason });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/assessments/review-acknowledge', requireActionPermission('MANAGE_COMPANY_EVALUATION_PLAN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!application.assessmentReviewRequired || !application.assessmentCompletedAt) {
    throw new Error('بازبینی تکمیلی آماده تأیید مدیریت شرکت نیست.');
  }
  const row = await prisma.hrJobApplication.update({
    where: { id: req.params.id },
    data: {
      assessmentReviewRequired: false,
      assessmentReviewAcknowledgedBy: actorId(req),
      assessmentReviewAcknowledgedAt: new Date()
      ,assessmentDecision: 'APPROVED',
      assessmentDecisionBy: actorId(req),
      assessmentDecisionAt: new Date()
    }
  });
  await audit(req.params.id, 'CANDIDATE_ASSESSMENT_REVIEW_ACKNOWLEDGED', req);
  res.json({ success: true, data: row });
}));

const DECISION_ACTION_PERMISSION: Record<string, string> = {
  HR_INTERVIEW: 'RECORD_INITIAL_INTERVIEW',
  HR_PRELIMINARY_APPROVAL: 'RECORD_PRELIMINARY_DECISION',
  COMPANY_APPROVAL: 'RECORD_FINAL_MANAGEMENT_DECISION'
};

const DECISION_WORK_ITEM_ACTION: Record<string, string> = {
  HR_INTERVIEW: 'RECORD_HR_INTERVIEW',
  HR_PRELIMINARY_APPROVAL: 'RECORD_HR_PRELIMINARY_APPROVAL',
  COMPANY_APPROVAL: 'APPROVE_PRE_IDENTITY',
};

export const initialInterviewCompletionErrorResponse = (error: any, trackingId: string) => {
  if (error?.code !== 'HR_INTERVIEW_EVIDENCE_INVALID' || error?.isOperational !== true) return null;
  const target = ['criterion', 'custom-criterion', 'summary', 'snapshot'].includes(error.target)
    ? error.target
    : 'snapshot';
  const snapshotFailure = target === 'snapshot';
  return {
    success: false,
    code: 'HR_INTERVIEW_EVIDENCE_INVALID',
    error: snapshotFailure ? `${error.message} کد پیگیری: ${trackingId}` : error.message,
    target,
    ...(typeof error.criterionId === 'string' && error.criterionId ? { criterionId: error.criterionId } : {}),
    ...(snapshotFailure ? { trackingId } : {}),
  };
};

export const initialInterviewTrackingId = (candidate: unknown, fallback: string = crypto.randomUUID()) => {
  const value = String(candidate || '');
  return /^[A-Za-z0-9._:-]{8,80}$/.test(value) ? value : fallback;
};

export const initialInterviewCompletionTransactionError = (error: any) => (
  error?.code === 'P2034'
    ? Object.assign(new Error('پیش‌نویس هنگام تکمیل تغییر کرده است. اطلاعات حفظ شده است؛ دوباره تلاش کنید.'), {
      code: 'HR_INTERVIEW_COMPLETION_CONFLICT',
      statusCode: 409,
      isOperational: true,
    })
    : error
);

router.get('/applications/:id/initial-interview', requireActionPermission('RECORD_INITIAL_INTERVIEW', 'VIEW_INITIAL_INTERVIEW_REPORT'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [draft, history] = await Promise.all([
    prisma.hrInitialInterviewDraft.findUnique({ where: { applicationId: req.params.id } }),
    prisma.hrApplicationDecision.findMany({
      where: { applicationId: req.params.id, kind: 'HR_INTERVIEW' },
      orderBy: { version: 'desc' },
      select: { version: true, outcome: true, explanation: true, evidenceJson: true, criteriaTemplateVersion: true, decidedBy: true, decidedAt: true },
    }),
  ]);
  res.json({ success: true, data: { draft, history } });
}));

router.put('/applications/:id/initial-interview/draft', requireActionPermission('RECORD_INITIAL_INTERVIEW'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const payload = req.body?.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('داده پیش‌نویس مصاحبه معتبر نیست.');
  const expectedVersion = Number(req.body.expectedVersion || 0);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw new Error('نسخه مورد انتظار پیش‌نویس معتبر نیست.');
  const row = await prisma.$transaction(async (tx) => {
    const current = await tx.hrInitialInterviewDraft.findUnique({ where: { applicationId: req.params.id } });
    if ((current?.version || 0) !== expectedVersion) {
      throw Object.assign(new Error('پیش‌نویس توسط کاربر دیگری تغییر کرده است. صفحه را تازه‌سازی کنید.'), { statusCode: 409 });
    }
    if (!current) {
      const latestCriteria = await ensureInitialInterviewCriteriaSet(tx, actorId(req));
      const criteriaTemplateVersion = latestCriteria.version;
      const snapshottedPayload = {
        ...(payload as Record<string, unknown>),
        criteriaTemplateVersion,
        criteriaSnapshot: latestCriteria.criteriaJson,
      };
      return tx.hrInitialInterviewDraft.create({ data: {
      applicationId: req.params.id,
      version: 1,
      criteriaTemplateVersion,
      dataJson: snapshottedPayload as Prisma.InputJsonValue,
      updatedByUserId: actorId(req),
    } });
    }
    const { criteriaTemplateVersion: _ignoredVersion, criteriaSnapshot: _ignoredSnapshot, ...mutablePayload } = payload as Record<string, unknown>;
    return tx.hrInitialInterviewDraft.update({ where: { id: current.id }, data: {
      version: { increment: 1 },
      dataJson: { ...(current.dataJson as Record<string, unknown>), ...mutablePayload } as Prisma.InputJsonValue,
      updatedByUserId: actorId(req),
    } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    throw initialInterviewDraftSaveError(error);
  });
  res.json({ success: true, data: { version: row.version, updatedAt: row.updatedAt } });
}));

router.post('/applications/:id/decisions/:kind', asyncHandler(async (req: AuthRequest, res: Response) => {
  const kind = String(req.params.kind || '');
  const requiredActionPermission = DECISION_ACTION_PERMISSION[kind];
  if (!requiredActionPermission) throw new Error('نوع تصمیم استخدام نامعتبر است.');
  const assigned = await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: [requiredActionPermission] });
  if (!assigned.allowed) return res.status(403).json({ success: false, error: `مجوز عملیاتی لازم است: ${requiredActionPermission}` });
  await markBroadManagerOverride(req);
  let outcome = String(req.body.outcome || '');
  if (!['POSITIVE', 'NEGATIVE'].includes(outcome)) throw new Error('نتیجه تصمیم باید مثبت یا منفی باشد.');
  let explanation = String(req.body.explanation || '').trim();
  let guidedInterview = req.body.guidedInterview;
  const previous = await prisma.hrApplicationDecision.findFirst({ where: { applicationId: req.params.id, kind: kind as any }, orderBy: { version: 'desc' } });
  if ((kind !== 'COMPANY_APPROVAL' || outcome === 'NEGATIVE') && !explanation) throw new Error('توضیح تصمیم الزامی است.');
  if (previous && !String(req.body.changeReason || '').trim()) throw new Error('دلیل تغییر تصمیم قبلی الزامی است.');
  const sourceDecision = kind === 'HR_PRELIMINARY_APPROVAL'
    ? await prisma.hrApplicationDecision.findFirst({ where: { applicationId: req.params.id, kind: 'HR_INTERVIEW' }, orderBy: { version: 'desc' }, select: { decidedBy: true, outcome: true } })
    : kind === 'COMPANY_APPROVAL'
      ? await prisma.hrApplicationDecision.findFirst({ where: { applicationId: req.params.id, kind: 'HR_PRELIMINARY_APPROVAL' }, orderBy: { version: 'desc' }, select: { decidedBy: true, outcome: true } })
      : null;
  const unresolvedCompanyEvaluations = kind === 'COMPANY_APPROVAL'
    ? await prisma.hrCompanyEvaluationOccurrence.count({ where: { applicationId: req.params.id, status: 'PLANNED' } })
    : 0;
  assertHiringDecisionGate({
    kind, actorUserId: actorId(req), sourceDecision,
    broadManagerOverride: Boolean((req as any).hrBroadManagerOverride),
    pendingCompanyEvaluations: unresolvedCompanyEvaluations,
  });
  if (kind === 'COMPANY_APPROVAL' && outcome === 'POSITIVE') {
    await assertFormalAssessmentEvidenceComplete(req.params.id);
    const prior = await prisma.hrApplicationDecision.findMany({ where: { applicationId: req.params.id, kind: { in: ['HR_INTERVIEW', 'HR_PRELIMINARY_APPROVAL'] } }, orderBy: { version: 'desc' } });
    const latestPrior = latestDecisionsByKind(prior);
    if (latestPrior.get('HR_INTERVIEW')?.outcome !== 'POSITIVE' || latestPrior.get('HR_PRELIMINARY_APPROVAL')?.outcome !== 'POSITIVE') throw new Error('مصاحبه اولیه و تأیید اولیه HR باید مثبت باشند.');
  }
  const row = await prisma.$transaction(async (tx) => {
    const transactionPrevious = await tx.hrApplicationDecision.findFirst({
      where: { applicationId: req.params.id, kind: kind as any },
      orderBy: { version: 'desc' },
    });
    let transactionOutcome = outcome;
    let transactionExplanation = explanation;
    let transactionGuidedInterview = guidedInterview;
    let transactionInterviewDraft: Awaited<ReturnType<typeof tx.hrInitialInterviewDraft.findUnique>> = null;
    if (kind === 'HR_INTERVIEW') {
      transactionInterviewDraft = await tx.hrInitialInterviewDraft.findUnique({ where: { applicationId: req.params.id } });
      if (!transactionInterviewDraft) throw new Error('پیش‌نویس مصاحبه برای تکمیل پیدا نشد.');
      transactionGuidedInterview = transactionInterviewDraft.dataJson;
      assertGuidedHrInterviewEvidence(transactionGuidedInterview, transactionInterviewDraft.criteriaTemplateVersion);
      if ((transactionGuidedInterview as any)?.schemaVersion === 2) {
        transactionOutcome = String((transactionGuidedInterview as any)?.state?.decision || '');
        transactionExplanation = String((transactionGuidedInterview as any)?.state?.decisionReason || '').trim();
      }
    }
    if ((kind !== 'COMPANY_APPROVAL' || transactionOutcome === 'NEGATIVE') && !transactionExplanation) throw new Error('توضیح تصمیم الزامی است.');
    if (transactionPrevious && !String(req.body.changeReason || '').trim()) throw new Error('دلیل تغییر تصمیم قبلی الزامی است.');
    const transactionSource = kind === 'HR_PRELIMINARY_APPROVAL'
      ? await tx.hrApplicationDecision.findFirst({ where: { applicationId: req.params.id, kind: 'HR_INTERVIEW' }, orderBy: { version: 'desc' }, select: { decidedBy: true } })
      : kind === 'COMPANY_APPROVAL'
        ? await tx.hrApplicationDecision.findFirst({ where: { applicationId: req.params.id, kind: 'HR_PRELIMINARY_APPROVAL' }, orderBy: { version: 'desc' }, select: { decidedBy: true } })
        : null;
    const unresolved = kind === 'COMPANY_APPROVAL'
      ? await tx.hrCompanyEvaluationOccurrence.count({ where: { applicationId: req.params.id, status: 'PLANNED' } })
      : 0;
    assertHiringDecisionGate({
      kind, actorUserId: actorId(req), sourceDecision: transactionSource,
      broadManagerOverride: Boolean((req as any).hrBroadManagerOverride),
      pendingCompanyEvaluations: unresolved,
    });
    const created = await tx.hrApplicationDecision.create({ data: {
      applicationId: req.params.id,
      kind: kind as any,
      outcome: transactionOutcome as any,
      explanation: transactionExplanation || null,
      evidenceJson: kind === 'HR_INTERVIEW' ? transactionGuidedInterview as Prisma.InputJsonValue : Prisma.JsonNull,
      criteriaTemplateVersion: kind === 'HR_INTERVIEW' ? transactionInterviewDraft!.criteriaTemplateVersion : null,
      changeReason: transactionPrevious ? String(req.body.changeReason).trim() : null,
      version: (transactionPrevious?.version || 0) + 1,
      decidedBy: actorId(req)
    }});
    if (kind === 'HR_PRELIMINARY_APPROVAL' && transactionOutcome === 'NEGATIVE') {
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { disposition: 'INITIAL_REJECTED', dispositionReason: transactionExplanation, dispositionBy: actorId(req), dispositionAt: new Date(), preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null, preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null } });
    } else if (kind === 'HR_INTERVIEW' || kind === 'HR_PRELIMINARY_APPROVAL') {
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null, preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null } });
    }
    if (kind === 'COMPANY_APPROVAL' && transactionOutcome === 'NEGATIVE') {
      const application = await tx.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, select: { stage: true } });
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: {
        stage: 'CLOSED', preClosureStage: application.stage, outcome: 'REJECTED', outcomeReason: transactionExplanation,
        preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null,
        preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null,
      } });
      await tx.hrCandidateInvitation.updateMany({ where: { applicationId: req.params.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    if (kind === 'COMPANY_APPROVAL' && transactionOutcome === 'POSITIVE') {
      const approvedAt = new Date();
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: {
        preIdentityManagementApprovedBy: actorId(req), preIdentityManagementApprovedAt: approvedAt,
        preIdentityManagementApprovalNote: transactionExplanation || null,
        preIdentityReleasedBy: actorId(req), preIdentityReleasedAt: approvedAt,
      } });
    }
    if (kind === 'HR_INTERVIEW') {
      const deleted = await tx.hrInitialInterviewDraft.deleteMany({
        where: { id: transactionInterviewDraft!.id, version: transactionInterviewDraft!.version },
      });
      if (deleted.count !== 1) throw Object.assign(new Error('پیش‌نویس هنگام تکمیل تغییر کرده است. اطلاعات حفظ شده است؛ دوباره تلاش کنید.'), { statusCode: 409 });
    }
    const workItemAction = DECISION_WORK_ITEM_ACTION[kind];
    if (workItemAction) {
      await tx.hrWorkItem.updateMany({
        where: {
          sourceKey: automaticHiringWorkItemSourceKey(req.params.id, workItemAction, null),
          status: { in: ['PENDING', 'IN_PROGRESS'] },
        },
        data: { status: 'COMPLETE', completedAt: new Date(), completedByUserId: actorId(req) },
      });
    }
    outcome = transactionOutcome;
    explanation = transactionExplanation;
    guidedInterview = transactionGuidedInterview;
    return created;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }).catch((error) => {
    throw kind === 'HR_INTERVIEW' ? initialInterviewCompletionTransactionError(error) : error;
  });
  await audit(req.params.id, 'HIRING_DECISION_RECORDED', req, { decisionId: row.id, kind, outcome, version: row.version, guidedInterview: kind === 'HR_INTERVIEW' ? guidedInterview : null, selfApproval: sourceDecision?.decidedBy === actorId(req) });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/pre-identity/items', requireActionPermission('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const title = String(req.body.title || '').trim();
  if (!title) throw new Error('عنوان الزام الزامی است.');
  const evidencePolicy = String(req.body.evidencePolicy || 'NOTE_REQUIRED');
  if (!['NOTE_REQUIRED', 'FILE_REQUIRED', 'FILE_OPTIONAL', 'NO_FILE'].includes(evidencePolicy)) throw new Error('سیاست مدرک نامعتبر است.');
  const requirementKey = crypto.randomUUID();
  const row = await prisma.hrPreIdentityChecklistItem.create({ data: {
    applicationId: req.params.id,
    requirementKey,
    title,
    instructions: String(req.body.instructions || '').trim() || null,
    evidencePolicy: evidencePolicy as any,
    dueAt: req.body.dueAt ? parseDate(req.body.dueAt, 'مهلت') : null,
    createdBy: actorId(req)
  }});
  await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null, preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null } });
  await prisma.hrPreIdentityChecklistEvent.create({ data: { itemId: row.id, eventType: 'CREATED', snapshotJson: row as any, actorUserId: actorId(req) } });
  await audit(req.params.id, 'PRE_IDENTITY_REQUIREMENT_ADDED', req, { itemId: row.id, requirementKey });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/pre-identity/finalize', requireActionPermission('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const decisions = await prisma.hrApplicationDecision.findMany({
    where: { applicationId: req.params.id, kind: { in: ['HR_INTERVIEW', 'HR_PRELIMINARY_APPROVAL'] } }, orderBy: { version: 'desc' }
  });
  const latest = latestDecisionsByKind(decisions);
  if (latest.get('HR_INTERVIEW')?.outcome !== 'POSITIVE' || latest.get('HR_PRELIMINARY_APPROVAL')?.outcome !== 'POSITIVE') throw new Error('مصاحبه اولیه و تأیید اولیه HR باید پیش از نهایی‌سازی مثبت باشند.');
  const row = await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityRequirementsFinalizedBy: actorId(req), preIdentityRequirementsFinalizedAt: new Date() } });
  await audit(req.params.id, 'PRE_IDENTITY_REQUIREMENTS_FINALIZED', req);
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/pre-identity/items/:itemId/correct', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const previous = await prisma.hrPreIdentityChecklistItem.findFirstOrThrow({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!['POSITIVE', 'NEGATIVE'].includes(previous.status)) throw new Error('فقط نتیجه نهایی‌شده با نسخه جدید اصلاح می‌شود.');
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new Error('دلیل اصلاح نسخه الزامی است.');
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.hrPreIdentityChecklistItem.create({ data: {
      applicationId: previous.applicationId, templateItemId: previous.templateItemId, requirementKey: previous.requirementKey,
      attempt: previous.attempt + 1, title: previous.title, instructions: previous.instructions, evidencePolicy: previous.evidencePolicy,
      dueAt: req.body.dueAt ? parseDate(req.body.dueAt, 'مهلت اصلاح') : previous.dueAt, createdBy: actorId(req)
    }});
    await tx.hrPreIdentityChecklistEvent.create({ data: { itemId: created.id, eventType: 'CORRECTION_VERSION_CREATED', snapshotJson: created as any, actorUserId: actorId(req), reason } });
    await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null, preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null } });
    return created;
  });
  await audit(req.params.id, 'PRE_IDENTITY_CORRECTION_VERSION_CREATED', req, { previousItemId: previous.id, itemId: row.id, reason });
  res.status(201).json({ success: true, data: row });
}));

router.put('/applications/:id/pre-identity/items/:itemId/result', requireActionPermission('MANAGE_RECRUITMENT_CASE'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const item = await prisma.hrPreIdentityChecklistItem.findFirstOrThrow({ where: { id: req.params.itemId, applicationId: req.params.id } });
    if (['POSITIVE', 'NEGATIVE'].includes(item.status)) throw new Error('نتیجه نهایی درجا ویرایش نمی‌شود؛ مدیر HR باید نسخه اصلاحی بسازد.');
    const status = String(req.body.status || '');
    if (!['PENDING', 'IN_PROGRESS', 'POSITIVE', 'NEGATIVE'].includes(status)) throw new Error('وضعیت نتیجه چک‌لیست نامعتبر است.');
    const explanation = String(req.body.resultExplanation || '').trim();
    if (['POSITIVE', 'NEGATIVE'].includes(status) && !explanation) throw new Error('توضیح HR برای نتیجه الزامی است.');
    if (item.evidencePolicy === 'FILE_REQUIRED' && ['POSITIVE', 'NEGATIVE'].includes(status) && !req.file && !item.storageName) throw new Error('فایل گزارش برای این الزام اجباری است.');
    if (item.evidencePolicy === 'NO_FILE' && req.file) throw new Error('برای این الزام فایل مجاز نیست.');
    let fileData: any = {};
    if (req.file) {
      await validateHiringFileSignature(req.file.path, req.file.mimetype);
      const scanStatus = await scanHiringFile(req.file.path);
      fileData = { storageName: path.basename(req.file.path), originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size, sha256: await sha256File(req.file.path), malwareScanStatus: scanStatus };
    }
    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.hrPreIdentityChecklistItem.update({ where: { id: item.id }, data: {
        status: status as any,
        resultExplanation: explanation || null,
        resultSource: String(req.body.resultSource || '').trim() || null,
        resultDate: req.body.resultDate ? parseDate(req.body.resultDate, 'تاریخ نتیجه') : ['POSITIVE', 'NEGATIVE'].includes(status) ? new Date() : null,
        recordedBy: actorId(req),
        recordedAt: new Date(),
        managementResolution: status === 'NEGATIVE' ? null : item.managementResolution,
        managementResolutionReason: status === 'NEGATIVE' ? null : item.managementResolutionReason,
        ...fileData
      }});
      await tx.hrPreIdentityChecklistEvent.create({ data: { itemId: item.id, eventType: 'RESULT_RECORDED', snapshotJson: updated as any, actorUserId: actorId(req) } });
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null, preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null } });
      return updated;
    });
    await audit(req.params.id, 'PRE_IDENTITY_RESULT_RECORDED', req, { itemId: item.id, status });
    res.json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file?.path); throw error; }
}));

router.post('/applications/:id/pre-identity/items/:itemId/resolve', requireActionPermission('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.hrPreIdentityChecklistItem.findFirstOrThrow({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (item.status !== 'NEGATIVE') throw new Error('فقط نتیجه منفی نیازمند تعیین تکلیف مدیریت است.');
  const resolution = String(req.body.resolution || '');
  const reason = String(req.body.reason || '').trim();
  if (!['CONTINUE', 'REPEAT', 'RESERVE'].includes(resolution) || !reason) throw new Error('تصمیم و دلیل مدیریت الزامی است.');
  const row = await prisma.$transaction(async (tx) => {
    const updated = await tx.hrPreIdentityChecklistItem.update({ where: { id: item.id }, data: { managementResolution: resolution, managementResolutionReason: reason } });
    await tx.hrPreIdentityChecklistEvent.create({ data: { itemId: item.id, eventType: 'NEGATIVE_RESOLVED', snapshotJson: updated as any, actorUserId: actorId(req), reason } });
    if (resolution === 'REPEAT') {
      await tx.hrPreIdentityChecklistItem.create({ data: { applicationId: item.applicationId, templateItemId: item.templateItemId, requirementKey: item.requirementKey, attempt: item.attempt + 1, title: item.title, instructions: item.instructions, evidencePolicy: item.evidencePolicy, dueAt: req.body.dueAt ? parseDate(req.body.dueAt, 'مهلت تکرار') : null, createdBy: actorId(req) } });
    }
    if (resolution === 'RESERVE') await tx.hrJobApplication.update({ where: { id: item.applicationId }, data: { disposition: 'RESERVE', dispositionReason: reason, dispositionBy: actorId(req), dispositionAt: new Date() } });
    return updated;
  });
  await audit(req.params.id, 'PRE_IDENTITY_NEGATIVE_RESOLVED', req, { itemId: item.id, resolution, reason });
  res.json({ success: true, data: row });
}));

router.get('/applications/:id/pre-identity/items/:itemId/evidence/download', requireActionPermission('VIEW_FULL_APPLICANT_INFORMATION'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.hrPreIdentityChecklistItem.findFirst({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!item?.storageName || !item.originalName) return res.status(404).json({ success: false, error: 'فایل گزارش این الزام پیدا نشد.' });
  await audit(req.params.id, 'PRE_IDENTITY_EVIDENCE_DOWNLOADED', req, { itemId: item.id });
  await audit(req.params.id, 'SENSITIVE_RECRUITMENT_EVIDENCE_ACCESSED', req, { evidenceType: 'PRE_IDENTITY', evidenceId: item.id, action: 'DOWNLOAD' });
  res.download(safeHiringStoragePath(item.storageName), item.originalName);
}));

router.post('/applications/:id/pre-identity/release', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  await assertFormalAssessmentEvidenceComplete(req.params.id);
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { preIdentityChecklistItems: true } });
  const decisions = await prisma.hrApplicationDecision.findMany({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' } });
  const latestDecision = latestDecisionsByKind(decisions);
  if (['HR_INTERVIEW', 'HR_PRELIMINARY_APPROVAL', 'COMPANY_APPROVAL'].some((kind) => latestDecision.get(kind as any)?.outcome !== 'POSITIVE')) throw new Error('سه تصمیم مرحله پیش از احراز هویت باید در آخرین نسخه مثبت باشند.');
  if (!application.preIdentityRequirementsFinalizedAt || !application.preIdentityManagementApprovedAt) throw new Error('نهایی‌سازی الزامات و تأیید مدیریت برای ادامه الزامی است.');
  if (application.preIdentityChecklistItems.some((item) => ['PENDING', 'IN_PROGRESS'].includes(item.status) || (item.status === 'NEGATIVE' && !item.managementResolution))) throw new Error('چک‌لیست هنوز مورد تعیین‌تکلیف‌نشده دارد.');
  const row = await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityReleasedBy: actorId(req), preIdentityReleasedAt: new Date(), stage: 'SCREENING' } });
  await audit(req.params.id, 'PRE_IDENTITY_RELEASED', req);
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/assessments/decision', requireActionPermission('MANAGE_COMPANY_EVALUATION_PLAN'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const decision = String(req.body.decision || '');
  if (!['APPROVED', 'REPEAT_REQUIRED', 'RESERVE', 'REJECTED'].includes(decision)) throw new Error('تصمیم ارزیابی نامعتبر است.');
  const reason = String(req.body.reason || '').trim();
  if (decision !== 'APPROVED' && !reason) throw new Error('دلیل این تصمیم الزامی است.');
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!application.assessmentCompletedAt) throw new Error('ثبت ارزیابی‌ها هنوز توسط HR تکمیل نشده است.');
  const now = new Date();
  const row = await prisma.hrJobApplication.update({ where: { id: application.id }, data: {
    assessmentDecision: decision as any,
    assessmentDecisionBy: actorId(req),
    assessmentDecisionAt: now,
    assessmentDecisionReason: reason || null,
    assessmentRepeatDueAt: decision === 'REPEAT_REQUIRED' && req.body.dueAt ? parseDate(req.body.dueAt, 'مهلت تکرار') : null,
    assessmentCompletedAt: decision === 'REPEAT_REQUIRED' ? null : application.assessmentCompletedAt,
    assessmentCompletedBy: decision === 'REPEAT_REQUIRED' ? null : application.assessmentCompletedBy,
    disposition: decision === 'RESERVE' ? 'RESERVE' : application.disposition,
    dispositionReason: decision === 'RESERVE' ? reason : application.dispositionReason,
    dispositionBy: decision === 'RESERVE' ? actorId(req) : application.dispositionBy,
    dispositionAt: decision === 'RESERVE' ? now : application.dispositionAt,
    stage: decision === 'APPROVED' ? 'OFFER' : decision === 'REJECTED' ? 'CLOSED' : application.stage,
    preClosureStage: decision === 'REJECTED' ? application.stage : application.preClosureStage,
    outcome: decision === 'REJECTED' ? 'REJECTED' : application.outcome,
    outcomeReason: decision === 'REJECTED' ? reason : application.outcomeReason
  }});
  if (decision === 'REJECTED') await prisma.hrCandidateInvitation.updateMany({ where: { applicationId: application.id, revokedAt: null }, data: { revokedAt: now } });
  await audit(req.params.id, 'ASSESSMENT_DECISION_RECORDED', req, { decision, reason, dueAt: req.body.dueAt || null });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/disposition/reactivate', asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  const required = application.disposition === 'INITIAL_REJECTED' ? 'RECORD_PRELIMINARY_DECISION' : application.disposition === 'RESERVE' ? 'RECORD_FINAL_MANAGEMENT_DECISION' : null;
  if (!required) throw new Error('پرونده برچسب توقف قابل فعال‌سازی ندارد.');
  const assigned = await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: [required] });
  if (!assigned.allowed) return res.status(403).json({ success: false, error: `اختیار سازمانی لازم است: ${required}` });
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new Error('دلیل فعال‌سازی مجدد الزامی است.');
  const previousDisposition = application.disposition;
  const row = await prisma.hrJobApplication.update({ where: { id: application.id }, data: { disposition: null, dispositionReason: null, dispositionBy: null, dispositionAt: null } });
  await audit(req.params.id, 'APPLICATION_DISPOSITION_REACTIVATED', req, { previousDisposition, reason });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/reopen/authorize', requireActionPermission('MANAGE_PRE_EMPLOYMENT_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (application.stage !== 'CLOSED' || !application.outcome || application.outcome === 'HIRED') throw new Error('فقط پرونده بسته غیر از استخدام‌شده قابل بازگشایی است.');
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new Error('دلیل مجوز بازگشایی الزامی است.');
  const row = await prisma.hrApplicationReopening.create({ data: { applicationId: application.id, status: 'AUTHORIZED', companyAuthorizedBy: actorId(req), companyAuthorizedAt: new Date(), companyReason: reason } });
  await audit(application.id, 'APPLICATION_REOPENING_AUTHORIZED', req, { reopeningId: row.id, reason });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/reopen/execute', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { position: true, candidate: true } });
  if (application.stage !== 'CLOSED' || !application.outcome || application.outcome === 'HIRED') throw new Error('این پرونده قابل بازگشایی نیست.');
  const reopening = await prisma.hrApplicationReopening.findFirstOrThrow({ where: { applicationId: application.id, status: 'AUTHORIZED' }, orderBy: { createdAt: 'desc' } });
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new Error('دلیل اجرای بازگشایی الزامی است.');
  if (!application.position.isActive) throw new Error('جایگاه اصلی پرونده غیرفعال است.');
  const occupiedCapacity = await prisma.hrEmploymentAssignment.count({ where: {
    positionId: application.positionId,
    effectiveTo: null,
    employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } }
  }});
  if (occupiedCapacity >= application.position.capacity) throw new Error('ظرفیت جایگاه تکمیل است؛ بازگشایی تا ایجاد ظرفیت مجاز نیست.');
  if (application.outcome === 'WITHDRAWN' && (!req.body.candidateConsentMethod || !req.body.candidateConsentedAt || !String(req.body.candidateConsentNote || '').trim())) throw new Error('رضایت جدید متقاضی برای بازگشایی پرونده انصرافی الزامی است.');
  const mobile = normalizeApplicantMobile(application.candidate.mobile);
  if (!mobile) throw new Error('شماره همراه متقاضی برای صدور دعوت‌نامه جدید معتبر نیست.');
  const now = new Date();
  const { row, invitation, otp } = await prisma.$transaction(async (tx) => {
    await tx.hrApplicationReopening.update({ where: { id: reopening.id }, data: { status: 'REOPENED', hrExecutedBy: actorId(req), hrExecutedAt: now, hrReason: reason, candidateConsentMethod: req.body.candidateConsentMethod || null, candidateConsentedAt: req.body.candidateConsentedAt ? parseDate(req.body.candidateConsentedAt, 'زمان رضایت') : null, candidateConsentNote: String(req.body.candidateConsentNote || '').trim() || null } });
    const latestOffer = await tx.hrCompensationSnapshot.findFirst({ where: { applicationId: application.id, obsoleteAt: null }, orderBy: { version: 'desc' } });
    if (latestOffer) await tx.hrCompensationSnapshot.update({ where: { id: latestOffer.id }, data: { obsoleteAt: now, obsoleteBy: actorId(req), obsoleteReason: 'بازگشایی پرونده بسته؛ صدور نسخه جدید پیشنهاد الزامی است.' } });
    const row = await tx.hrJobApplication.update({ where: { id: application.id }, data: { stage: application.preClosureStage || 'RECEIVED', outcome: null, outcomeReason: null, acceptedOfferAt: null, compensationClearance: latestOffer ? 'NOT_STARTED' : application.compensationClearance, disposition: null, dispositionReason: null, dispositionBy: null, dispositionAt: null } });
    const issued = await createApplicantInvitation(application.id, mobile, actorId(req), tx);
    return { row, ...issued };
  });
  const sms = await hrHiringSmsGateway.sendInvitation({ phoneNumber: mobile, code: otp });
  await prisma.hrCandidateInvitation.update({
    where: { id: invitation.id },
    data: {
      providerMessageId: sms.messageId ? String(sms.messageId) : null,
      providerDeliveryState: sms.success ? (sms.messageId ? 'ACCEPTED' : 'UNKNOWN') : 'FAILED',
      providerLastCheckedAt: new Date(),
    },
  });
  await audit(application.id, 'APPLICATION_REOPENED', req, { reopeningId: reopening.id, reason, restoredStage: row.stage });
  await audit(application.id, 'APPLICATION_REOPENING_INVITATION_ISSUED', req, {
    reopeningId: reopening.id,
    invitationId: invitation.id,
    deliveryState: sms.success ? 'ACCEPTED' : 'FAILED',
  });
  res.json({
    success: true,
    data: {
      application: row,
      invitation: { id: invitation.id, expiresAt: invitation.expiresAt, deliveryState: sms.success ? 'ACCEPTED' : 'FAILED' },
      ...(process.env.NODE_ENV === 'production' ? {} : { debugOtp: otp }),
    },
  });
}));

router.post('/applications/:id/collateral-requirements', requireActionPermission('MANAGE_COLLATERAL_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const type = String(req.body.type || '');
  if (!COLLATERAL_TYPES.has(type)) throw new Error('نوع وثیقه الزامی است.');
  const amountRials = req.body.amountRials === '' || req.body.amountRials == null ? null : normalizeHiringRial(req.body.amountRials);
  const explanation = collateralCandidateExplanation(type, amountRials);
  const latest = await prisma.hrCollateralRequirement.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' } });
  const latestOffer = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id, obsoleteAt: null }, orderBy: { version: 'desc' } });
  const row = await prisma.$transaction(async (tx) => {
    if (latest) await tx.hrCollateralRequirement.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
    const created = await tx.hrCollateralRequirement.create({ data: { applicationId: req.params.id, version: (latest?.version || 0) + 1, type, amountRials, obligation: null, dueTiming: null, candidateExplanation: explanation, proposedBy: actorId(req), supersedesId: latest?.id || null } });
    if (latestOffer?.candidateAcceptedAt) {
      await tx.hrCompensationSnapshot.update({ where: { id: latestOffer.id }, data: { obsoleteAt: new Date(), obsoleteBy: actorId(req), obsoleteReason: 'تغییر الزام وثیقه پس از پذیرش؛ نسخه جدید پیشنهاد الزامی است.' } });
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { acceptedOfferAt: null, compensationClearance: 'NOT_STARTED' } });
    }
    return created;
  });
  await audit(req.params.id, 'COLLATERAL_REQUIREMENT_PROPOSED', req, { requirementId: row.id, version: row.version, supersedesId: latest?.id || null });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/collateral-requirements/not-required', requireActionPermission('MANAGE_COLLATERAL_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const now = new Date();
  const result = await prisma.$transaction(async (tx) => {
    const latest = await tx.hrCollateralRequirement.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' } });
    const replayed = latest?.status === 'ACTIVE' && latest.type === 'NO_PRE_HIRE_COLLATERAL';
    const received = await tx.hrCollateralItem.count({ where: { applicationId: req.params.id, receivedAt: { not: null } } });
    if (!replayed && latest?.status === 'ACTIVE') await tx.hrCollateralRequirement.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
    const requirement = replayed ? latest : await tx.hrCollateralRequirement.create({ data: {
      applicationId: req.params.id, version: (latest?.version || 0) + 1, type: 'NO_PRE_HIRE_COLLATERAL',
      candidateExplanation: 'برای این همکاری وثیقه پیش از استخدام لازم نیست.', proposedBy: actorId(req), supersedesId: latest?.id || null,
    } });
    {
      const itemIds = (await tx.hrCollateralItem.findMany({ where: { applicationId: req.params.id }, select: { id: true } })).map(({ id }) => id);
      const duties = itemIds.length ? await tx.crossWorkspaceDuty.findMany({
        where: { sourceType: 'HR_HIRING_FINANCE', sourceId: { in: itemIds }, status: 'OPEN',
          sourceActionCode: { in: ['HIRING_COLLATERAL_RECORD_RECEIPT', 'HIRING_COLLATERAL_VERIFY_RECEIPT'] } },
      }) : [];
      for (const duty of duties) {
        await tx.crossWorkspaceDuty.update({ where: { id: duty.id }, data: {
          status: 'CANCELLED', respondedAt: now, respondedByUserId: actorId(req),
          structuredResultJson: { reason: 'COLLATERAL_REQUIREMENT_REVOKED' },
        } });
        await tx.crossWorkspaceDutyAssignmentHistory.updateMany({
          where: { dutyId: duty.id, endedAt: null }, data: { endedAt: now, endReason: 'SOURCE_CHANGED', changedByUserId: actorId(req) },
        });
        const latestAudit = await tx.crossWorkspaceDutyAuditVersion.aggregate({ where: { dutyId: duty.id }, _max: { version: true } });
        await tx.crossWorkspaceDutyAuditVersion.create({ data: {
          dutyId: duty.id, version: (latestAudit._max.version || 0) + 1, eventCode: 'CANCELLED', actorUserId: actorId(req),
          sourceVersion: duty.sourceVersion, envelopeVersion: duty.envelopeVersion, policyVersion: 1,
          reason: 'COLLATERAL_REQUIREMENT_REVOKED', afterJson: { status: 'CANCELLED' },
        } });
      }
    }
    if (received) {
      const heldItems = await tx.hrCollateralItem.findMany({
        where: { applicationId: req.params.id, receivedAt: { not: null }, returnConfirmedAt: null }, select: { id: true },
      });
      for (const item of heldItems) {
        const latestReturn = await tx.hrCollateralOriginalReturn.findFirst({ where: { collateralItemId: item.id }, orderBy: { version: 'desc' } });
        if (latestReturn && ['DRAFT', 'SUBMITTED'].includes(latestReturn.status)) continue;
        const source = await tx.hrCollateralOriginalReturn.create({ data: {
          collateralItemId: item.id, version: (latestReturn?.version || 0) + 1, status: 'DRAFT',
        } });
        await createHrHiringCollateralReturnDuty(tx, {
          returnId: source.id, actionCode: 'HIRING_COLLATERAL_RECORD_ORIGINAL_RETURN', actorUserId: actorId(req), now,
        });
      }
    }
    await reconcileAcceptedOfferFollowUp(tx, { applicationId: req.params.id, actorUserId: actorId(req), now });
    return { requirement, replayed };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req.params.id, 'COLLATERAL_EXPLICITLY_NOT_REQUIRED', req, {
    requirementId: result.requirement.id, version: result.requirement.version, replayed: result.replayed,
  });
  res.status(result.replayed ? 200 : 201).json({ success: true, data: result.requirement });
}));

router.get('/applications/:id/assessments/:assessmentId/download', requireActionPermission('VIEW_FULL_APPLICANT_INFORMATION', 'VIEW_COMPANY_EVALUATION_RESULTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCandidateAssessment.findFirst({ where: { id: req.params.assessmentId, applicationId: req.params.id } });
  if (!row?.storageName || !row.originalName) return res.status(404).json({ success: false, error: 'فایل ارزیابی پیدا نشد.' });
  if (row.assessmentType === 'OTHER') {
    const hrAuthority = await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: ['MANAGE_RECRUITMENT_CASE'] });
    if (!hrAuthority.allowed) return res.status(403).json({ success: false, error: 'این مدرک ارزیابی برای نقش شما قابل دسترسی نیست.' });
  }
  await audit(req.params.id, 'CANDIDATE_ASSESSMENT_DOWNLOADED', req, { assessmentId: row.id });
  await audit(req.params.id, 'SENSITIVE_RECRUITMENT_EVIDENCE_ACCESSED', req, { evidenceType: 'ASSESSMENT', evidenceId: row.id, action: 'DOWNLOAD' });
  res.download(safeHiringStoragePath(row.storageName), row.originalName);
}));

router.post('/applications/:id/collateral/apply-template', requireActionPermission('MANAGE_COLLATERAL_REQUIREMENTS'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [application, requirement, existing] = await Promise.all([
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { position: true } }),
    prisma.hrCollateralRequirement.findFirst({ where: { applicationId: req.params.id, status: 'ACTIVE' }, orderBy: { version: 'desc' } }),
    prisma.hrCollateralItem.count({ where: { applicationId: req.params.id } })
  ]);
  if (!application.acceptedOfferAt) throw new Error('چک‌لیست وثیقه فقط پس از پذیرش پیشنهاد قابل اعمال است.');
  if (!requirement) throw new Error('مدیریت شرکت هنوز الزام وثیقه فعالی برای این پرونده ثبت نکرده است.');
  if (existing) throw new Error('پرونده وثیقه قبلاً برای دریافت توسط امور مالی ساخته شده است.');
  await prisma.$transaction([
    prisma.hrJobApplication.update({ where: { id: application.id }, data: { collateralTemplateId: null, collateralClearance: 'IN_PROGRESS' } }),
    prisma.hrCollateralItem.create({ data: { applicationId: application.id, collateralRequirementId: requirement.id, type: requirement.type, required: true, amountRials: requirement.amountRials, status: 'MISSING', note: requirement.candidateExplanation, recordedBy: actorId(req) } })
  ]);
  await audit(req.params.id, 'COLLATERAL_RECEIPT_OPENED', req, { requirementId: requirement.id, requirementVersion: requirement.version });
  res.status(201).json({ success: true });
}));

router.post('/applications/:id/collateral', requireActionPermission('RECORD_COLLATERAL_CUSTODY'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  let scanStatus: string | undefined;
  let digest: string | undefined;
  try {
    const [application, activeRequirement] = await Promise.all([
      prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } }),
      prisma.hrCollateralRequirement.findFirst({ where: { applicationId: req.params.id, status: 'ACTIVE' }, orderBy: { version: 'desc' } }),
    ]);
    if (!application.acceptedOfferAt) throw new Error('دریافت وثیقه فقط پس از پذیرش پیشنهاد مجاز است.');
    if (!COLLATERAL_TYPES.has(req.body.type)) throw new Error('نوع وثیقه نامعتبر است.');
    if (!req.file || !req.body.receivedAt || !String(req.body.custodyLocation || '').trim()) throw new Error('اسکن، تاریخ دریافت و محل نگهداری اصل وثیقه الزامی است.');
    if (req.file) {
      validateHiringFileSignature(req.file.path, req.file.mimetype);
      scanStatus = await scanHiringFile(req.file.path);
      digest = await sha256File(req.file.path);
    }
    const itemData = {
      type: req.body.type, required: req.body.required !== 'false',
      amountRials: req.body.amountRials === '' || req.body.amountRials == null ? null : normalizeHiringRial(req.body.amountRials), identifier: req.body.identifier || null,
      issuerOrGuarantor: req.body.issuerOrGuarantor || null, receivedAt: req.body.receivedAt ? parseDate(req.body.receivedAt, 'تاریخ دریافت') : null,
      custodyLocation: req.body.custodyLocation || null, status: 'RECEIVED' as const,
      storageName: req.file?.filename, originalName: req.file?.originalname, mimeType: req.file?.mimetype, size: req.file?.size,
      sha256: digest, malwareScanStatus: scanStatus, note: req.body.note || null, recordedBy: actorId(req)
    };
    const previous = req.body.itemId ? await prisma.hrCollateralItem.findFirst({ where: { id: req.body.itemId, applicationId: req.params.id, status: { in: ['MISSING', 'MISMATCH', 'UNREADABLE'] } } }) : null;
    if (req.body.itemId && !previous) throw new Error('قلم چک‌لیست قابل ثبت یا جایگزینی پیدا نشد.');
    const collateralRequirementId = previous?.collateralRequirementId ?? activeRequirement?.id;
    const row = previous?.status === 'MISSING'
      ? await prisma.hrCollateralItem.update({ where: { id: previous.id }, data: { ...itemData, collateralRequirementId } })
      : await prisma.hrCollateralItem.create({ data: {
        applicationId: req.params.id, collateralRequirementId, templateItemId: previous?.templateItemId, supersedesItemId: previous?.id,
        version: previous ? previous.version + 1 : 1, ...itemData,
        type: previous?.type || itemData.type, required: previous?.required ?? itemData.required
      }});
    await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { collateralClearance: 'IN_PROGRESS' } });
    await audit(req.params.id, 'COLLATERAL_RECORDED', req, { collateralItemId: row.id, type: row.type });
    res.status(201).json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file?.path); throw error; }
}));

router.get('/applications/:id/collateral/:itemId/download', requireAnyActionPermission('RECORD_COLLATERAL_CUSTODY', 'VERIFY_COLLATERAL_CUSTODY'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCollateralItem.findFirst({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!row?.storageName || !row.originalName) return res.status(404).json({ success: false, error: 'فایل وثیقه پیدا نشد.' });
  await audit(req.params.id, 'COLLATERAL_DOCUMENT_DOWNLOADED', req, { itemId: row.id });
  await audit(req.params.id, 'SENSITIVE_RECRUITMENT_EVIDENCE_ACCESSED', req, { evidenceType: 'COLLATERAL', evidenceId: row.id, action: 'DOWNLOAD' });
  res.download(safeHiringStoragePath(row.storageName), row.originalName);
}));

router.put('/applications/:id/collateral/:itemId/review', requireActionPermission('VERIFY_COLLATERAL_CUSTODY'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!['VERIFIED', 'MISMATCH', 'UNREADABLE'].includes(req.body.status)) throw new Error('وضعیت بررسی وثیقه نامعتبر است.');
  const coordinationReason = String(req.body.coordinationReason || '').trim();
  if (req.body.status !== 'VERIFIED' && !coordinationReason) throw new Error('علت نیاز به اصلاح یا پیگیری الزامی است.');
  const item = await prisma.hrCollateralItem.findUniqueOrThrow({ where: { id: req.params.itemId } });
  if (await prisma.hrCollateralItem.findUnique({ where: { supersedesItemId: item.id }, select: { id: true } })) throw new Error('این قلم با نسخه جدید جایگزین شده است.');
  const managerialSelfVerification = item.recordedBy === actorId(req) && (await resolveWorkspaceDutyAuthority(prisma, {
    userId: actorId(req), workspace: 'accounting', feature: 'VERIFY_COLLATERAL_CUSTODY',
  })).canSelfDecide && (await activeHrActionPermissionsForUser(prisma, actorId(req))).includes('RECORD_COLLATERAL_CUSTODY');
  if (item.applicationId !== req.params.id || (item.recordedBy === actorId(req) && !managerialSelfVerification)) throw new Error('مدیر مالی ثبت‌کننده نمی‌تواند همان قلم را تأیید کند.');
  const row = await prisma.hrCollateralItem.update({ where: { id: item.id }, data: {
    status: req.body.status, note: req.body.note ?? item.note, coordinationReason: req.body.status === 'VERIFIED' ? null : coordinationReason,
    approvedBy: req.body.status === 'VERIFIED' ? actorId(req) : null, approvedAt: req.body.status === 'VERIFIED' ? new Date() : null
  }});
  await audit(req.params.id, 'COLLATERAL_REVIEWED', req, { itemId: row.id, status: row.status,
    ...(managerialSelfVerification ? { managerialSelfVerification: true, overrideLabel: 'استفاده از اختیار مدیریتی' } : {}) });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/collateral/approve', requireActionPermission('VERIFY_COLLATERAL_CUSTODY'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await prisma.hrCollateralItem.findMany({ where: { applicationId: req.params.id } });
  const explicitNoRequirement = await prisma.hrCollateralRequirement.findFirst({
    where: { applicationId: req.params.id, status: 'ACTIVE', type: 'NO_PRE_HIRE_COLLATERAL' }, select: { id: true },
  });
  if (explicitNoRequirement && items.some((item) => item.receivedAt && !item.returnConfirmedAt)) {
    throw new Error('تصمیم «وثیقه لازم نیست» پس از ثبت و تأیید بازگرداندن همه اصل‌ها مؤثر می‌شود.');
  }
  const supersededIds = new Set(items.map((item) => item.supersedesItemId).filter(Boolean));
  const currentItems = items.filter((item) => !supersededIds.has(item.id));
  const permissions = await activeHrActionPermissionsForUser(prisma, actorId(req));
  const managerialFinalOverride = permissions.includes('RECORD_COLLATERAL_CUSTODY')
    && (await resolveWorkspaceDutyAuthority(prisma, { userId: actorId(req), workspace: 'accounting', feature: 'VERIFY_COLLATERAL_CUSTODY' })).canSelfDecide;
  const usedManagerialFinalOverride = managerialFinalOverride
    && currentItems.some((item) => item.recordedBy === actorId(req) && item.approvedBy === actorId(req));
  if (!currentItems.length || currentItems.some((item) => item.required && (item.status !== 'VERIFIED' || !item.approvedBy
    || (item.recordedBy === item.approvedBy && !(managerialFinalOverride && item.approvedBy === actorId(req)))))) throw new Error('همه اقلام جاری و الزامی وثیقه باید توسط مدیر مستقل یا اختیار مدیریتی ممیزی‌شده تأیید شوند.');
  await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { collateralClearance: 'APPROVED' } });
  await audit(req.params.id, 'COLLATERAL_CLEARANCE_APPROVED', req, usedManagerialFinalOverride
    ? { managerialSelfVerification: true, overrideLabel: 'استفاده از اختیار مدیریتی' } : undefined);
  res.json({ success: true });
}));

router.put('/applications/:id/collateral/:itemId/return', requireActionPermission('RECORD_COLLATERAL_CUSTODY'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file || !String(req.body.returnedTo || '').trim() || !String(req.body.returnEvidenceNote || '').trim()) throw new Error('تحویل‌گیرنده، شرح و فایل مدرک تحویل الزامی است.');
    const item = await prisma.hrCollateralItem.findFirstOrThrow({ where: { id: req.params.itemId, applicationId: req.params.id } });
    validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = await scanHiringFile(req.file.path);
    const digest = await sha256File(req.file.path);
    const row = await prisma.hrCollateralItem.update({ where: { id: item.id }, data: {
      returnedAt: parseDate(req.body.returnedAt || new Date(), 'تاریخ بازگشت'), returnedTo: req.body.returnedTo, returnedBy: actorId(req), returnEvidenceNote: req.body.returnEvidenceNote,
      returnEvidenceStorageName: req.file.filename, returnEvidenceOriginalName: req.file.originalname, returnEvidenceMimeType: req.file.mimetype,
      returnEvidenceSize: req.file.size, returnEvidenceSha256: digest, returnEvidenceMalwareScanStatus: scanStatus,
      returnConfirmedBy: null, returnConfirmedAt: null
    }});
    await audit(req.params.id, 'COLLATERAL_RETURNED', req, { itemId: row.id, returnedTo: row.returnedTo });
    res.json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file?.path); throw error; }
}));

router.get('/applications/:id/collateral/:itemId/return-evidence/download', requireAnyActionPermission('RECORD_COLLATERAL_CUSTODY', 'VERIFY_COLLATERAL_CUSTODY'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCollateralItem.findFirst({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!row?.returnEvidenceStorageName || !row.returnEvidenceOriginalName) return res.status(404).json({ success: false, error: 'مدرک تحویل پیدا نشد.' });
  await audit(req.params.id, 'COLLATERAL_RETURN_EVIDENCE_DOWNLOADED', req, { itemId: row.id });
  await audit(req.params.id, 'SENSITIVE_RECRUITMENT_EVIDENCE_ACCESSED', req, { evidenceType: 'COLLATERAL_RETURN', evidenceId: row.id, action: 'DOWNLOAD' });
  res.download(safeHiringStoragePath(row.returnEvidenceStorageName), row.returnEvidenceOriginalName);
}));

router.get('/applications/:id/collateral-returns/:returnId/download', requireAnyActionPermission('RECORD_COLLATERAL_CUSTODY', 'VERIFY_COLLATERAL_CUSTODY'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCollateralOriginalReturn.findFirst({
    where: { id: req.params.returnId, collateralItem: { applicationId: req.params.id } },
  });
  if (!row?.evidenceStorageName || !row.evidenceOriginalName) return res.status(404).json({ success: false, error: 'مدرک تحویل پیدا نشد.' });
  await audit(req.params.id, 'COLLATERAL_RETURN_EVIDENCE_DOWNLOADED', req, { collateralReturnId: row.id, version: row.version });
  await audit(req.params.id, 'SENSITIVE_RECRUITMENT_EVIDENCE_ACCESSED', req, { evidenceType: 'COLLATERAL_RETURN', evidenceId: row.id, action: 'DOWNLOAD' });
  res.download(safeHiringStoragePath(row.evidenceStorageName), row.evidenceOriginalName);
}));

router.post('/applications/:id/collateral/:itemId/return-confirm', requireActionPermission('VERIFY_COLLATERAL_CUSTODY'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.hrCollateralItem.findFirstOrThrow({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!item.returnedAt || !item.returnedTo || !item.returnEvidenceNote || !item.returnEvidenceStorageName) throw new Error('جزئیات و مدرک تحویل باید کامل باشد.');
  const managerialSelfVerification = item.returnedBy === actorId(req) && (await resolveWorkspaceDutyAuthority(prisma, {
    userId: actorId(req), workspace: 'accounting', feature: 'VERIFY_COLLATERAL_CUSTODY',
  })).canSelfDecide && (await activeHrActionPermissionsForUser(prisma, actorId(req))).includes('RECORD_COLLATERAL_CUSTODY');
  if (item.returnedBy === actorId(req) && !managerialSelfVerification) throw new Error('ثبت‌کننده تحویل نمی‌تواند همان بازگشت را تأیید کند.');
  const row = await prisma.hrCollateralItem.update({ where: { id: item.id }, data: { returnConfirmedBy: actorId(req), returnConfirmedAt: new Date() } });
  await prisma.$transaction((tx) => reconcileAcceptedOfferFollowUp(tx, {
    applicationId: req.params.id, actorUserId: actorId(req),
  }));
  await audit(req.params.id, 'COLLATERAL_RETURN_CONFIRMED', req, { itemId: row.id,
    ...(managerialSelfVerification ? { managerialSelfVerification: true, overrideLabel: 'استفاده از اختیار مدیریتی' } : {}) });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/convert', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true, position: true, compensationSnapshots: { orderBy: { version: 'desc' }, take: 1 } } });
  if (application.convertedAt) return res.status(409).json({ success: false, error: 'این پرونده قبلاً به پرسنل تبدیل شده است.' });
  await assertFormalAssessmentEvidenceComplete(req.params.id);
  const compensation = application.compensationSnapshots[0];
  if (application.identityClearance !== 'APPROVED' || application.collateralClearance !== 'APPROVED' || !application.acceptedOfferAt || !compensation?.candidateAcceptedAt || !isCompensationPayrollVerified(compensation)) {
    throw new Error('هویت، وثیقه و پیشنهاد جبران خدمات باید پیش از تبدیل کامل باشند.');
  }
  const startDate = parseDate(req.body.scheduledStartDate, 'تاریخ شروع برنامه‌ریزی‌شده');
  const result = await prisma.$transaction(async (tx) => {
    const occupied = await tx.hrEmploymentAssignment.count({ where: {
      positionId: application.positionId, type: { in: ['PRIMARY', 'SECONDARY'] },
      employmentRelationship: { status: { in: ['PLANNED', 'ACTIVE', 'SUSPENDED'] } },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: startDate } }]
    }});
    if (!application.position.isActive || occupied >= application.position.capacity) throw new Error('ظرفیت جایگاه در تاریخ شروع تکمیل یا جایگاه غیرفعال است.');
    let personnel = application.candidate.linkedPersonnelId ? await tx.personnel.findUnique({ where: { id: application.candidate.linkedPersonnelId } }) : null;
    if (!personnel && application.candidate.nationalCode) personnel = await tx.personnel.findUnique({ where: { nationalCode: application.candidate.nationalCode } });
    if (!personnel) personnel = await tx.personnel.create({ data: { firstName: application.candidate.firstName, lastName: application.candidate.lastName, nationalCode: application.candidate.nationalCode, isActive: false } });
    await tx.hrCandidate.update({ where: { id: application.candidateId }, data: { linkedPersonnelId: personnel.id } });
    const relationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: personnel.id, status: 'PLANNED', effectiveFrom: startDate, originalStartDate: startDate,
      startDateVerified: true, createdBy: actorId(req), hiringApplicationId: application.id
    }});
    await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: relationship.id, positionId: application.positionId, type: 'PRIMARY', effectiveFrom: startDate,
      organizationalUnitId: application.position.organizationalUnitId, workplaceId: application.position.workplaceId,
      costCenterId: application.position.costCenterId, responsibleSupervisorAssignmentId: req.body.responsibleSupervisorAssignmentId || null, createdBy: actorId(req)
    }});
    await tx.hrInsuranceEnrollment.upsert({ where: { applicationId: application.id }, create: { applicationId: application.id, status: 'NOT_STARTED', updatedBy: actorId(req) }, update: { updatedBy: actorId(req) } });
    await tx.hrOnboardingTask.createMany({ data: [
      { applicationId: application.id, title: 'تأیید قرارداد امضاشده', ownerAuthority: 'FINANCE_MANAGER', activationBlocker: true, createdBy: actorId(req) },
      { applicationId: application.id, title: 'تنظیم مشارکت حقوق و دستمزد', ownerAuthority: 'HR_PAYROLL_MANAGER', activationBlocker: true, createdBy: actorId(req) },
      { applicationId: application.id, title: 'پیگیری ثبت بیمه', ownerAuthority: 'HR_PROCESSOR', activationBlocker: false, createdBy: actorId(req) }
    ] });
    await tx.hrCandidateInvitation.updateMany({ where: { applicationId: application.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.hrJobApplication.update({ where: { id: application.id }, data: { convertedAt: new Date(), scheduledStartDate: startDate, stage: 'CLOSED', outcome: 'HIRED' } });
    return { personnel, relationship };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(application.id, 'HIRE_CONVERTED', req, { personnelId: result.personnel!.id, relationshipId: result.relationship.id });
  res.json({ success: true, data: result });
}));

router.post('/applications/:id/contracts', requireActionPermission('MANAGE_FINANCE_EVIDENCE'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new Error('اسکن قرارداد الزامی است.');
  try {
    const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
    if (!application.convertedAt) throw new Error('قرارداد پس از تبدیل به پرسنل برنامه‌ریزی‌شده ثبت می‌شود.');
    const effectiveFrom = parseDate(req.body.effectiveFrom, 'تاریخ شروع قرارداد');
    const effectiveTo = parseDate(req.body.effectiveTo, 'تاریخ پایان قرارداد');
    assertPaperContractDraft({
      contractNumber: String(req.body.contractNumber || ''),
      effectiveFrom,
      effectiveTo,
      hasFile: Boolean(req.file)
    });
    validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = await scanHiringFile(req.file.path); const digest = await sha256File(req.file.path);
    const row = await prisma.$transaction(async (tx) => {
      const aggregate = await tx.hrEmploymentContractDocument.aggregate({ where: { applicationId: req.params.id }, _max: { version: true } });
      const created = await tx.hrEmploymentContractDocument.create({ data: {
        applicationId: req.params.id, version: (aggregate._max.version || 0) + 1, contractNumber: String(req.body.contractNumber).trim(),
        effectiveFrom, effectiveTo,
        storageName: req.file!.filename, originalName: req.file!.originalname, mimeType: req.file!.mimetype, size: req.file!.size,
        sha256: digest, malwareScanStatus: scanStatus, uploadedBy: actorId(req), note: req.body.note || null
      }});
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { contractClearance: 'IN_PROGRESS' } });
      await tx.hrOnboardingTask.updateMany({
        where: { applicationId: req.params.id, title: 'تأیید قرارداد امضاشده' },
        data: { status: 'PENDING', completedBy: null, completedAt: null }
      });
      return created;
    });
    await audit(req.params.id, 'SIGNED_CONTRACT_VERSION_RECORDED', req, { contractId: row.id, version: row.version });
    res.status(201).json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file.path); throw error; }
}));

router.post('/applications/:id/contracts/:contractId/submit', requireActionPermission('MANAGE_FINANCE_EVIDENCE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const contract = await prisma.hrEmploymentContractDocument.findFirstOrThrow({ where: { id: req.params.contractId, applicationId: req.params.id } });
  const latest = await prisma.hrEmploymentContractDocument.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== contract.id) throw new Error('فقط آخرین نسخه قرارداد قابل ارسال است.');
  if (contract.uploadedBy !== actorId(req)) throw new Error('فقط ثبت‌کننده این نسخه می‌تواند آن را برای بررسی ارسال کند.');
  if (contract.returnedAt) throw new Error('برای قرارداد بازگردانده‌شده نسخه اصلاح‌شده ثبت کنید.');
  if (contract.approvedAt) throw new Error('این قرارداد قبلاً تأیید شده است.');
  if (contract.submittedAt) throw new Error('این قرارداد قبلاً برای بررسی ارسال شده است.');
  const row = await prisma.hrEmploymentContractDocument.update({
    where: { id: contract.id },
    data: { submittedBy: actorId(req), submittedAt: new Date() }
  });
  await audit(req.params.id, 'SIGNED_CONTRACT_SUBMITTED', req, { contractId: row.id, version: row.version });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/contracts/:contractId/approve', requireActionPermission('MANAGE_FINANCE_EVIDENCE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const contract = await prisma.hrEmploymentContractDocument.findUniqueOrThrow({ where: { id: req.params.contractId } });
  const latest = await prisma.hrEmploymentContractDocument.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (contract.applicationId !== req.params.id) throw new Error('قرارداد متعلق به این پرونده نیست.');
  assertPaperContractReviewable(contract, { actorId: actorId(req), isLatest: latest?.id === contract.id });
  await prisma.$transaction([
    prisma.hrEmploymentContractDocument.update({ where: { id: contract.id }, data: { approvedBy: actorId(req), approvedAt: new Date() } }),
    prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { contractClearance: 'APPROVED' } }),
    prisma.hrOnboardingTask.updateMany({ where: { applicationId: req.params.id, title: 'تأیید قرارداد امضاشده' }, data: { status: 'COMPLETE', completedBy: actorId(req), completedAt: new Date() } })
  ]);
  await audit(req.params.id, 'SIGNED_CONTRACT_APPROVED', req, { contractId: contract.id });
  res.json({ success: true });
}));

router.post('/applications/:id/contracts/:contractId/return', requireActionPermission('MANAGE_FINANCE_EVIDENCE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new Error('دلیل بازگرداندن قرارداد الزامی است.');
  const contract = await prisma.hrEmploymentContractDocument.findUniqueOrThrow({ where: { id: req.params.contractId } });
  const latest = await prisma.hrEmploymentContractDocument.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (contract.applicationId !== req.params.id) throw new Error('قرارداد متعلق به این پرونده نیست.');
  assertPaperContractReviewable(contract, { actorId: actorId(req), isLatest: latest?.id === contract.id });
  const row = await prisma.$transaction(async (tx) => {
    const returned = await tx.hrEmploymentContractDocument.update({
      where: { id: contract.id },
      data: { returnedBy: actorId(req), returnedAt: new Date(), returnReason: reason }
    });
    await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { contractClearance: 'REJECTED' } });
    return returned;
  });
  await audit(req.params.id, 'SIGNED_CONTRACT_RETURNED', req, { contractId: row.id, version: row.version, reason });
  res.json({ success: true, data: row });
}));

router.get('/applications/:id/contracts/:contractId/download', requireActionPermission('MANAGE_FINANCE_EVIDENCE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrEmploymentContractDocument.findFirst({ where: { id: req.params.contractId, applicationId: req.params.id } });
  if (!row) return res.status(404).json({ success: false, error: 'قرارداد پیدا نشد.' });
  await audit(req.params.id, 'SIGNED_CONTRACT_DOWNLOADED', req, { contractId: row.id });
  await audit(req.params.id, 'SENSITIVE_RECRUITMENT_EVIDENCE_ACCESSED', req, { evidenceType: 'CONTRACT', evidenceId: row.id, action: 'DOWNLOAD' });
  res.download(safeHiringStoragePath(row.storageName), row.originalName);
}));

router.post('/applications/:id/payroll-participation', requireActionPermission('MANAGE_PAYROLL'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!application.convertedAt) throw new Error('مشارکت حقوق پس از تبدیل به پرسنل برنامه‌ریزی‌شده تنظیم می‌شود.');
  if (!application.scheduledStartDate) throw new Error('تاریخ شروع برنامه‌ریزی‌شده پرونده مشخص نیست.');
  const command = normalizePayrollParticipationCommand(req.body, application.scheduledStartDate);
  const row = await prisma.hrPayrollParticipation.upsert({
    where: { applicationId: req.params.id },
    create: { applicationId: req.params.id, effectiveFrom: command.effectiveFrom, startMismatchReason: command.startMismatchReason, configuredBy: actorId(req) },
    update: { effectiveFrom: command.effectiveFrom, startMismatchReason: command.startMismatchReason, configuredBy: actorId(req), configuredAt: new Date() }
  });
  await prisma.hrOnboardingTask.updateMany({ where: { applicationId: req.params.id, title: 'تنظیم مشارکت حقوق و دستمزد' }, data: { status: 'COMPLETE', completedBy: actorId(req), completedAt: new Date() } });
  await audit(req.params.id, 'PAYROLL_PARTICIPATION_CONFIRMED', req, { effectiveFrom: command.effectiveFrom, differsFromPlannedStart: Boolean(command.startMismatchReason) });
  res.json({ success: true, data: row });
}));

router.put('/applications/:id/insurance', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const command = normalizeInsuranceEnrollmentCommand(req.body);
  const effectiveDate = command.effectiveDate ? parseDate(command.effectiveDate, 'تاریخ شروع پوشش بیمه') : null;
  const dueDate = command.dueDate ? parseDate(command.dueDate, 'مهلت پیگیری بیمه') : null;
  const communicatedAt = command.communicatedAt ? parseDate(command.communicatedAt, 'زمان اعلام درخواست ثبت مستقل') : null;
  const row = await prisma.hrInsuranceEnrollment.upsert({
    where: { applicationId: req.params.id },
    create: {
      applicationId: req.params.id,
      registrationPath: command.registrationPath as any,
      status: command.status as any,
      effectiveDate,
      dueDate,
      communicationMethod: command.communicationMethod,
      communicatedAt,
      note: command.note,
      updatedBy: actorId(req)
    },
    update: {
      registrationPath: command.registrationPath as any,
      status: command.status as any,
      effectiveDate,
      dueDate,
      communicationMethod: command.communicationMethod,
      communicatedAt,
      note: command.note,
      updatedBy: actorId(req)
    }
  });
  const resolved = ['ACTIVE', 'EXEMPT'].includes(row.status);
  await prisma.hrOnboardingTask.updateMany({
    where: { applicationId: req.params.id, title: 'پیگیری ثبت بیمه' },
    data: resolved
      ? { status: 'COMPLETE', completedBy: actorId(req), completedAt: new Date() }
      : { status: 'PENDING', completedBy: null, completedAt: null }
  });
  await audit(req.params.id, 'INSURANCE_ENROLLMENT_UPDATED', req, {
    registrationPath: row.registrationPath,
    status: row.status,
    communicatedAt: row.communicatedAt
  });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/onboarding-tasks', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { employmentRelationship: true } });
  if (!application.employmentRelationship || application.employmentRelationship.status !== 'PLANNED') throw new Error('وظیفه موقت فقط برای پرسنل برنامه‌ریزی‌شده قابل ثبت است.');
  if (!String(req.body.title || '').trim() || !['HR_PROCESSOR', 'HR_MANAGER', 'COMPANY_MANAGER', 'HR_PAYROLL_PROCESSOR', 'HR_PAYROLL_MANAGER', 'FINANCE_RECORDER', 'FINANCE_MANAGER'].includes(req.body.ownerAuthority)) throw new Error('عنوان و مالک سازمانی معتبر وظیفه الزامی است.');
  const row = await prisma.hrOnboardingTask.create({ data: {
    applicationId: req.params.id, title: req.body.title, ownerAuthority: req.body.ownerAuthority,
    activationBlocker: !!req.body.activationBlocker, dueDate: req.body.dueDate ? parseDate(req.body.dueDate, 'مهلت') : null, createdBy: actorId(req),
    assigneePersonnelId: req.body.assignToHire === false ? null : application.employmentRelationship.personnelId
  }});
  res.status(201).json({ success: true, data: row });
}));

router.put('/applications/:id/onboarding-tasks/:taskId', asyncHandler(async (req: AuthRequest, res: Response) => {
  const task = await prisma.hrOnboardingTask.findUniqueOrThrow({ where: { id: req.params.taskId } });
  if (task.applicationId !== req.params.id) return res.status(404).json({ success: false, error: 'وظیفه در این پرونده پیدا نشد.' });
  const actionPermission = ({
    HR_PROCESSOR: 'MANAGE_RECRUITMENT_CASE',
    HR_MANAGER: 'MANAGE_RECRUITMENT_CASE',
    COMPANY_MANAGER: 'MANAGE_PRE_EMPLOYMENT_REQUIREMENTS',
    HR_PAYROLL_PROCESSOR: 'MANAGE_PAYROLL',
    HR_PAYROLL_MANAGER: 'MANAGE_PAYROLL',
    FINANCE_RECORDER: 'MANAGE_FINANCE_EVIDENCE',
    FINANCE_MANAGER: 'MANAGE_FINANCE_EVIDENCE',
  } as Record<string, string>)[task.ownerAuthority];
  const assigned = actionPermission
    ? await authorizeHrUser(prisma, actorId(req), { actionPermissionCodes: [actionPermission] })
    : { allowed: false };
  if (!assigned.allowed) return res.status(403).json({ success: false, error: 'فقط مالک سازمانی وظیفه مجاز به تکمیل است.' });
  const row = await prisma.hrOnboardingTask.update({ where: { id: task.id }, data: {
    status: req.body.status, evidenceNote: req.body.evidenceNote || null,
    completedBy: req.body.status === 'COMPLETE' ? actorId(req) : null, completedAt: req.body.status === 'COMPLETE' ? new Date() : null
  }});
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/activate', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { employmentRelationship: true, onboardingTasks: true, payrollParticipation: true } });
  if (!application.employmentRelationship || application.employmentRelationship.status !== 'PLANNED') throw new Error('رابطه استخدامی برنامه‌ریزی‌شده پیدا نشد.');
  const readiness = buildEmploymentActivationReadiness({
    scheduledStartDate: application.scheduledStartDate,
    identityClearance: application.identityClearance,
    collateralClearance: application.collateralClearance,
    contractClearance: application.contractClearance,
    compensationClearance: application.compensationClearance,
    payrollParticipation: application.payrollParticipation,
    onboardingTasks: application.onboardingTasks
  });
  if (!readiness.ready) throw new Error(`پیش‌نیازهای فعال‌سازی کامل نیستند: ${readiness.blockers.map((item) => item.message).join('، ')}`);
  await prisma.$transaction([
    prisma.hrEmploymentRelationship.update({ where: { id: application.employmentRelationship.id }, data: { status: 'ACTIVE' } }),
    prisma.personnel.update({ where: { id: application.employmentRelationship.personnelId }, data: { isActive: true } }),
    prisma.hrJobApplication.update({ where: { id: application.id }, data: { activatedAt: new Date(), activatedBy: actorId(req) } })
  ]);
  await audit(application.id, 'EMPLOYMENT_ACTIVATED', req);
  res.json({ success: true });
}));

router.post('/applications/:id/close', requireActionPermission('MANAGE_RECRUITMENT_CASE'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { employmentRelationship: true, collateralItems: true } });
  if (!['REJECTED', 'WITHDRAWN', 'REQUEST_CANCELLED'].includes(req.body.outcome)) throw new Error('نتیجه بستن پرونده نامعتبر است.');
  if (!String(req.body.reason || '').trim()) throw new Error('دلیل بستن پرونده الزامی است.');
  if (application.employmentRelationship?.status === 'ACTIVE') throw new Error('پرونده استخدام فعال از مسیر خاتمه رابطه استخدامی مدیریت می‌شود.');
  if (application.collateralItems.some((item) => item.receivedAt && (!item.returnedAt || !item.returnConfirmedAt))) {
    const count = await initiatePendingCollateralReturns(application, req.body.outcome, String(req.body.reason).trim(), actorId(req));
    return res.status(202).json({ success: true, data: { pendingCollateralReturns: count }, message: 'درخواست بازگرداندن اصل وثیقه در وظایف امور مالی ایجاد شد.' });
  }
  await prisma.$transaction(async (tx) => {
    if (application.employmentRelationship?.status === 'PLANNED') {
      await tx.hrEmploymentAssignment.updateMany({ where: { employmentRelationshipId: application.employmentRelationship.id, effectiveTo: null }, data: { effectiveTo: new Date() } });
      await tx.hrEmploymentRelationship.update({ where: { id: application.employmentRelationship.id }, data: { status: 'ENDED', effectiveTo: new Date(), endReason: req.body.reason } });
    }
    await tx.hrCandidateInvitation.updateMany({ where: { applicationId: application.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await tx.hrJobApplication.update({ where: { id: application.id }, data: { preClosureStage: application.stage, stage: 'CLOSED', outcome: req.body.outcome, outcomeReason: req.body.reason } });
  });
  await audit(application.id, 'APPLICATION_CLOSED', req, { outcome: req.body.outcome, reason: req.body.reason });
  res.json({ success: true });
}));

router.use((error: any, req: express.Request, res: Response, _next: NextFunction) => {
  const trackingId = initialInterviewTrackingId(req.get('X-Correlation-Id'));
  const interviewCompletionResponse = initialInterviewCompletionErrorResponse(error, trackingId);
  if (interviewCompletionResponse) {
    console.error('HR interview completion validation error:', { trackingId, target: error.target, criterionId: error.criterionId, error });
    return res.status(400).json(interviewCompletionResponse);
  }
  console.error('HR hiring route error:', error);
  if (error?.code === 'P2002') return res.status(409).json({ success: false, error: 'رکورد تکراری است.', details: error.meta });
  if (error instanceof multer.MulterError) return res.status(400).json({ success: false, error: error.message });
  if (Number.isInteger(error?.statusCode) && error.statusCode >= 400 && error.statusCode <= 599) {
    return res.status(error.statusCode).json({ success: false, error: error.message });
  }
  res.status(400).json({ success: false, error: error?.message || 'عملیات استخدام ناموفق بود.' });
});

export default router;
