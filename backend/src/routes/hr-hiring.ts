import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthRequest, protect } from '../middleware/auth';
import hrHiringSmsGateway from '../services/hrHiringSmsGateway';
import { mapSmsIrDeliveryState } from '../services/hrHiringDeliveryPollingService';
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
import { compensationTotalRials, isValidIranianNationalCode, unresolvedActivationRequirements, validateHiringCorrection, validateHiringQuestionnaire } from '../services/hrHiringRules';
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
import { buildHiringQueueItem, projectHiringLifecycle, projectHiringTaskCapabilities, summarizeHiringLifecycle } from '../services/hrHiringLifecycle';
import {
  buildCandidateCorrectionMessage,
  normalizeCandidateCorrectionRequest
} from '../services/hrCandidateCorrection';
import {
  normalizePersianFullName,
  validateOfflineOfferDecision
} from '../services/hrOfferDecision';
import {
  assertPaperContractDraft,
  assertPaperContractReviewable,
  paperContractReviewState
} from '../services/hrEmploymentContract';
import { normalizeInsuranceEnrollmentCommand } from '../services/hrInsuranceEnrollment';
import { normalizePayrollParticipationCommand } from '../services/hrPayrollParticipation';

const router = express.Router();
const prisma = new PrismaClient();
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
const permissionRank: Record<string, number> = { view: 1, edit: 2, admin: 3 };

ensureHrHiringStorage();

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, HR_HIRING_STORAGE_DIR),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, HR_HIRING_ALLOWED_MIME.has(file.mimetype))
});

const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000);
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
) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const otp = generateApplicantOtp();
    try {
      const invitation = await prisma.hrCandidateInvitation.create({ data: {
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

const audit = (applicationId: string, eventType: string, req: AuthRequest | express.Request, payload?: unknown, actorKind = 'USER') =>
  prisma.hrHiringAudit.create({ data: {
    applicationId,
    actorUserId: (req as AuthRequest).user?.id,
    actorKind,
    eventType,
    payloadJson: payload == null ? Prisma.JsonNull : payload as Prisma.InputJsonValue,
    ipAddress: req.ip,
    userAgent: req.get('user-agent')
  }});

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
  const hiringManagerIds = [
    application.compensationSnapshots[0]?.proposedBy,
    application.createdBy
  ].filter(Boolean) as string[];
  const processorIds = application.identityChecks.map((item) => item.reviewedBy);
  const responsibleIds = [...new Set([...hiringManagerIds, ...processorIds])];
  const recipients = responsibleIds.length
    ? await tx.hrHiringAuthority.findMany({
        where: {
          isActive: true,
          OR: [
            {
              userId: { in: hiringManagerIds },
              authority: 'HIRING_MANAGER'
            },
            {
              userId: { in: processorIds },
              authority: 'HR_PROCESSOR'
            }
          ]
        },
        select: { userId: true }
      })
    : [];
  const userIds = [...new Set(recipients.map((item) => item.userId))];
  if (!userIds.length) return;
  await tx.securityNotification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: 'HIRING_OFFER_DECLINED',
      title: 'رد پیشنهاد همکاری',
      message: `${application.candidate.firstName} ${application.candidate.lastName} پیشنهاد جایگاه ${application.position.title} را رد کرد.`,
      referenceId: applicationId
    }))
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
  preIdentityChecklistItems: { include: { events: { orderBy: { createdAt: 'desc' as const } } }, orderBy: { createdAt: 'asc' as const } },
  hiringDecisions: { orderBy: [{ kind: 'asc' as const }, { version: 'desc' as const }] },
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

const hasWorkspace = async (req: AuthRequest, workspace: string, minimum = 'view') => {
  if (!req.user) return false;
  if (req.user.role === 'ADMIN') return true;
  const [direct, role] = await Promise.all([
    prisma.workspacePermission.findUnique({ where: { userId_workspace: { userId: req.user.id, workspace } } }),
    prisma.roleWorkspacePermission.findUnique({ where: { role_workspace: { role: req.user.role as any, workspace } } })
  ]);
  const now = Date.now();
  const active = (p: any) => p?.isActive && (!p.expiresAt || p.expiresAt.getTime() > now);
  const effective = active(direct) ? direct!.permissionLevel : active(role) ? role!.permissionLevel : null;
  return effective != null && permissionRank[effective] >= permissionRank[minimum];
};

const requireHiringRead = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const [hr, accounting, authority] = await Promise.all([
    hasWorkspace(req, 'hr'),
    hasWorkspace(req, 'accounting'),
    prisma.hrHiringAuthority.findFirst({ where: { userId: req.user!.id, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })
  ]);
  if (!hr && !accounting && !authority) return res.status(403).json({ success: false, error: 'دسترسی پرونده استخدام ندارید.' });
  next();
});

const requireAuthority = (...authorities: string[]) => asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const assigned = await prisma.hrHiringAuthority.findFirst({
    where: { userId: req.user!.id, authority: { in: authorities as any }, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }
  });
  if (!assigned) return res.status(403).json({ success: false, error: `اختیار سازمانی لازم است: ${authorities.join(', ')}` });
  (req as any).hiringAuthority = assigned.authority;
  next();
});

const requireHrAdmin = asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const [direct, role] = await Promise.all([
    prisma.workspacePermission.findUnique({ where: { userId_workspace: { userId: req.user!.id, workspace: 'hr' } } }),
    prisma.roleWorkspacePermission.findUnique({ where: { role_workspace: { role: req.user!.role as any, workspace: 'hr' } } })
  ]);
  const now = Date.now();
  const explicitAdmin = [direct, role].some((permission) => {
    const expiry = (permission as any)?.expiresAt as Date | null | undefined;
    return permission?.isActive && permission.permissionLevel === 'admin' && (!expiry || expiry.getTime() > now);
  });
  if (!explicitAdmin) return res.status(403).json({ success: false, error: 'دسترسی صریح مدیریت منابع انسانی لازم است؛ نقش مدیریت سامانه به‌تنهایی کافی نیست.' });
  next();
});

interface ApplicantRequest extends express.Request { applicant?: { applicationId: string; invitationId: string } }
const applicantSession = async (req: ApplicantRequest, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'development-secret') as any;
    if (payload.kind !== 'HR_APPLICANT') throw new Error('Wrong token kind');
    const invitation = await prisma.hrCandidateInvitation.findUnique({ where: { id: payload.invitationId }, include: { application: { select: { stage: true } } } });
    if (!invitation || invitation.applicationId !== payload.applicationId || invitation.revokedAt || invitation.expiresAt <= new Date() || invitation.application.stage === 'CLOSED') throw new Error('Expired invitation');
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
      application: { stage: { not: 'CLOSED' } }
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
        where: { mobileSnapshot: mobile, ...invitationIsUsableWhere(), application: { stage: { not: 'CLOSED' } } },
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
      collateralRequirements: { where: { status: 'ACTIVE' }, orderBy: { version: 'desc' }, take: 1 }
    }
  });
  const compensation = application.compensationSnapshots.find((snapshot) => !snapshot.obsoleteAt);
  res.json({ success: true, data: {
    id: application.id,
    stage: application.stage,
    candidate: application.candidate,
    position: application.position,
    revision: application.formRevisions[0] || null,
    correctionSource: application.formRevisions.find((item) => item.status === 'RETURNED') || null,
    compensation: compensation?.hrApprovedAt && compensation.financeApprovedAt ? { ...compensation, collateralRequirement: application.collateralRequirements[0] || null } : null
  }});
}));

router.put('/public/application/draft', applicantSession, asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const applicationId = req.applicant!.applicationId;
  const latest = await prisma.hrApplicationFormRevision.findFirst({ where: { applicationId }, orderBy: { revisionNumber: 'desc' } });
  const allowedCorrectionFields = Array.isArray(latest?.correctionFieldsJson) ? latest.correctionFieldsJson.map(String) : [];
  if (latest && allowedCorrectionFields.length) {
    const previous = latest.dataJson as Record<string, unknown>;
    const attempted = Object.keys(req.body || {}).filter((key) => !allowedCorrectionFields.includes(key) && JSON.stringify(req.body[key]) !== JSON.stringify(previous[key]));
    if (attempted.length) return res.status(422).json({ success: false, error: `فقط فیلدهای مشخص‌شده قابل اصلاح‌اند: ${allowedCorrectionFields.join(', ')}` });
  }
  let revision;
  if (!latest) {
    revision = await prisma.hrApplicationFormRevision.create({ data: { applicationId, revisionNumber: 1, dataJson: req.body as Prisma.InputJsonValue } });
  } else if (latest.status === 'RETURNED') {
    revision = await prisma.hrApplicationFormRevision.create({ data: {
      applicationId, revisionNumber: latest.revisionNumber + 1,
      dataJson: { ...(latest.dataJson as any), ...req.body } as Prisma.InputJsonValue,
      correctionFieldsJson: latest.correctionFieldsJson as Prisma.InputJsonValue,
      correctionDetailsJson: latest.correctionDetailsJson as Prisma.InputJsonValue,
      correctionReason: latest.correctionReason
    }});
  } else if (latest.status === 'DRAFT') {
    const dataJson = allowedCorrectionFields.length
      ? { ...(latest.dataJson as any), ...req.body }
      : req.body;
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
  if (!application.assessmentCompletedAt || application.assessmentDecision !== 'APPROVED' || application.assessmentReviewRequired) {
    return res.status(409).json({ success: false, error: 'ارزیابی متقاضی نیازمند تکمیل یا بازبینی است.' });
  }
  if (!snapshot?.hrApprovedAt || !snapshot.financeApprovedAt || snapshot.obsoleteAt) return res.status(409).json({ success: false, error: 'پیشنهاد جبران خدمات هنوز نهایی نشده یا منسوخ شده است.' });
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
  if (!snapshot?.hrApprovedAt || !snapshot.financeApprovedAt || snapshot.obsoleteAt) return res.status(409).json({ success: false, error: 'پیشنهاد همکاری هنوز نهایی نشده یا منسوخ شده است.' });
  if (!application.assessmentCompletedAt || application.assessmentDecision !== 'APPROVED' || application.assessmentReviewRequired) return res.status(409).json({ success: false, error: 'ارزیابی متقاضی نیازمند تکمیل یا تصمیم مدیریت است.' });
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

// Authenticated hiring workspace.
router.use(protect, requireHiringRead);

// A disposition pauses the case without destroying evidence. Ordinary mutations must
// resume through the explicit reactivation command before work can continue.
router.use('/applications/:id', asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.method === 'GET' || /\/(disposition\/reactivate|reopen\/authorize|reopen\/execute|close)$/.test(req.path)) return next();
  const application = await prisma.hrJobApplication.findUnique({ where: { id: req.params.id }, select: { disposition: true } });
  if (application?.disposition) return res.status(409).json({ success: false, error: 'پرونده متوقف است؛ پیش از ادامه باید صریحاً دوباره فعال شود.' });
  next();
}));

router.get('/me/authorities', asyncHandler(async (req: AuthRequest, res: Response) => {
  const rows = await prisma.hrHiringAuthority.findMany({ where: { userId: actorId(req), isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { authority: true } });
  res.json({ success: true, data: rows.map((row) => row.authority) });
}));

router.get('/authorities', requireHrAdmin, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.hrHiringAuthority.findMany({ orderBy: [{ authority: 'asc' }, { createdAt: 'asc' }] });
  res.json({ success: true, data: rows });
}));

router.get('/authorities/audit', requireHrAdmin, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.hrHiringAuthorityAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  res.json({ success: true, data: rows });
}));

router.post('/authorities', requireHrAdmin, asyncHandler(async (req: AuthRequest, res: Response) => {
  const previous = await prisma.hrHiringAuthority.findUnique({ where: { userId_authority: { userId: req.body.userId, authority: req.body.authority } } });
  const row = await prisma.hrHiringAuthority.upsert({
    where: { userId_authority: { userId: req.body.userId, authority: req.body.authority } },
    create: { userId: req.body.userId, authority: req.body.authority, createdBy: actorId(req), isActive: req.body.isActive !== false, expiresAt: req.body.expiresAt ? parseDate(req.body.expiresAt, 'انقضای اختیار') : null },
    update: { isActive: req.body.isActive !== false, expiresAt: req.body.expiresAt ? parseDate(req.body.expiresAt, 'انقضای اختیار') : null }
  });
  await prisma.hrHiringAuthorityAudit.create({ data: {
    authorityId: row.id, actorUserId: actorId(req), eventType: previous ? 'AUTHORITY_UPDATED' : 'AUTHORITY_ASSIGNED',
    beforeJson: previous ? JSON.parse(JSON.stringify(previous)) : Prisma.JsonNull,
    afterJson: JSON.parse(JSON.stringify(row))
  }});
  res.status(201).json({ success: true, data: row });
}));

router.get('/pre-identity/templates', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.hrRecruitmentChecklistTemplate.findMany({
    where: { isActive: true },
    include: { items: { orderBy: { sortOrder: 'asc' } } },
    orderBy: [{ name: 'asc' }, { version: 'desc' }]
  });
  res.json({ success: true, data: rows });
}));

router.post('/pre-identity/templates', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/pre-identity/apply-template', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.get('/collateral-templates', requireAuthority('FINANCE_RECORDER', 'FINANCE_MANAGER'), asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.hrCollateralChecklistTemplate.findMany({ include: { items: { orderBy: { sortOrder: 'asc' } } }, orderBy: [{ name: 'asc' }, { version: 'desc' }] });
  res.json({ success: true, data: rows });
}));

router.post('/collateral-templates', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const name = String(req.body.name || '').trim();
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!name || !items.length || items.some((item: any) => !COLLATERAL_TYPES.has(item.type) || !String(item.label || '').trim())) throw new Error('نام قالب و حداقل یک قلم معتبر الزامی است.');
  const latest = await prisma.hrCollateralChecklistTemplate.aggregate({ where: { name }, _max: { version: true } });
  const row = await prisma.hrCollateralChecklistTemplate.create({ data: {
    name, version: (latest._max.version || 0) + 1, scopeType: req.body.scopeType || 'GLOBAL', scopeId: req.body.scopeId || null, createdBy: actorId(req),
    items: { create: items.map((item: any, index: number) => ({ type: item.type, label: item.label, required: item.required !== false, defaultAmountRials: item.defaultAmountRials || null, sortOrder: index })) }
  }, include: { items: { orderBy: { sortOrder: 'asc' } } } });
  res.status(201).json({ success: true, data: row });
}));

router.patch('/collateral-templates/:id/active', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCollateralChecklistTemplate.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive === true } });
  res.json({ success: true, data: row });
}));

router.get('/applications', asyncHandler(async (req: AuthRequest, res: Response) => {
  const search = String(req.query.search || '').trim();
  const authorityRows = await prisma.hrHiringAuthority.findMany({ where: { userId: actorId(req), isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { authority: true } });
  const authorities = authorityRows.map((item) => item.authority);
  // The hiring workspace intentionally shows the complete contact number for operational follow-up.
  const canSeeFullMobile = true;
  const canSeeDecisionDetails = authorities.some((authority) => ['HR_PROCESSOR', 'HR_MANAGER', 'COMPANY_MANAGER'].includes(authority));
  const rows = await prisma.hrJobApplication.findMany({
    where: {
      stage: req.query.stage ? req.query.stage as any : undefined,
      ...(req.query.outcome
        ? { outcome: req.query.outcome as any }
        : String(req.query.includeHired || '') === 'true'
          ? {}
          : { OR: [{ outcome: null }, { outcome: { not: 'HIRED' as any } }] }),
      disposition: req.query.disposition ? req.query.disposition as any : undefined,
      positionId: req.query.positionId ? String(req.query.positionId) : undefined,
      position: req.query.jobId ? { jobId: String(req.query.jobId) } : undefined,
      AND: search ? [{ OR: [
        { candidate: { firstName: { contains: search, mode: 'insensitive' } } },
        { candidate: { lastName: { contains: search, mode: 'insensitive' } } },
        ...(canSeeFullMobile ? [{ candidate: { mobile: { contains: search } } }] : []),
        { candidate: { nationalCode: { contains: search } } }
      ] }] : undefined
    },
    include: {
      candidate: { select: { id: true, firstName: true, lastName: true, mobile: true, talentBankSearchable: true, linkedPersonnelId: true, createdAt: true, updatedAt: true } },
      position: { include: { job: true, organizationalUnit: true } },
      formRevisions: { select: { status: true }, orderBy: { revisionNumber: 'desc' }, take: 4 },
      assessments: { select: { id: true } },
      preIdentityChecklistItems: { select: { status: true, managementResolution: true, dueAt: true } },
      hiringDecisions: { select: { kind: true, outcome: true, explanation: true, changeReason: true, version: true, decidedBy: true, decidedAt: true }, orderBy: [{ kind: 'asc' }, { version: 'desc' }] },
      compensationSnapshots: { select: { hrApprovedAt: true, financeApprovedAt: true, candidateAcceptedAt: true, obsoleteAt: true }, orderBy: { version: 'desc' }, take: 3 },
      collateralItems: { select: { required: true, status: true } },
      contracts: { select: { approvedAt: true }, orderBy: { version: 'desc' }, take: 1 },
      payrollParticipation: { select: { id: true } },
      onboardingTasks: { select: { activationBlocker: true, status: true, ownerAuthority: true, title: true } },
      employmentRelationship: { include: { personnel: true } }
    },
    orderBy: { updatedAt: 'desc' }
  });
  const requestedPhase = String(req.query.phase || '').trim();
  const requestedStatus = String(req.query.lifecycleStatus || '').trim();
  const myActions = String(req.query.myActions || '') === 'true';
  const projected = rows.map((source) => {
    const row = {
      ...source,
      decisionDetailsVisible: canSeeDecisionDetails,
      candidate: { ...source.candidate, mobile: canSeeFullMobile ? source.candidate.mobile : `${source.candidate.mobile.slice(0, 4)}***${source.candidate.mobile.slice(-2)}` },
      hiringDecisions: source.hiringDecisions.map((decision) => canSeeDecisionDetails ? decision : ({ kind: decision.kind, outcome: decision.outcome, version: decision.version }))
    };
    return buildHiringQueueItem(
    row as any,
    summarizeHiringLifecycle(projectHiringLifecycle(row, authorities))
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
  res.json({ success: true, data: projected.slice(start, start + pageSize), meta: { page, pageSize, total: projected.length, totalPages: Math.max(1, Math.ceil(projected.length / pageSize)) } });
}));

router.get('/applications/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrJobApplication.findUnique({ where: { id: req.params.id }, include: applicationInclude });
  if (!row) return res.status(404).json({ success: false, error: 'پرونده استخدام پیدا نشد.' });
  const authorityRows = await prisma.hrHiringAuthority.findMany({ where: { userId: actorId(req), isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { authority: true } });
  const authorities = new Set(authorityRows.map((item) => item.authority));
  const canSeeHrSensitive = authorities.has('HR_PROCESSOR') || authorities.has('HR_MANAGER');
  const canSeeDecisionDetails = canSeeHrSensitive || authorities.has('COMPANY_MANAGER');
  const canSeeFinanceSensitive = authorities.has('FINANCE_RECORDER') || authorities.has('FINANCE_MANAGER');
  const canSeeCompensation = canSeeFinanceSensitive || authorities.has('HIRING_MANAGER') || authorities.has('HR_PROCESSOR') || authorities.has('HR_PAYROLL_PROCESSOR') || authorities.has('HR_PAYROLL_MANAGER') || authorities.has('HR_MANAGER');
  const data: any = row;
  data.lifecycle = projectHiringLifecycle(row, authorities);
  data.taskCapabilities = projectHiringTaskCapabilities(row, authorities);
  if (!canSeeDecisionDetails) {
    data.hiringDecisions = data.hiringDecisions.map(({ kind, outcome, version, decidedAt }: any) => ({ kind, outcome, version, decidedAt }));
    data.preIdentityChecklistItems = data.preIdentityChecklistItems.map(({ id, title, status, dueAt, managementResolution }: any) => ({ id, title, status, dueAt, managementResolution }));
  } else if (!canSeeHrSensitive) {
    data.preIdentityChecklistItems = data.preIdentityChecklistItems.map(({ storageName: _storageName, sha256: _sha256, malwareScanStatus: _scan, ...item }: any) => item);
  }
  data.documents = canSeeHrSensitive ? data.documents.map(({ storageName: _storageName, sha256: _sha256, ...document }: any) => document) : [];
  data.assessments = canSeeDecisionDetails ? data.assessments.map(({ storageName: _storageName, sha256: _sha256, ...assessment }: any) => assessment) : [];
  if (!canSeeHrSensitive) {
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
  if (canSeeFinanceSensitive) data.collateralItems = data.collateralItems.map(({ storageName: _storageName, sha256: _sha256, returnEvidenceStorageName: _returnStorage, returnEvidenceSha256: _returnSha, ...item }: any) => item);
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

router.post('/applications', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const position = await prisma.hrPosition.findUnique({ where: { id: req.body.positionId } });
  if (!position?.isActive) throw new Error('جایگاه فعال پیدا نشد.');
  const mobile = String(req.body.mobile || '').trim();
  if (!/^09\d{9}$/.test(mobile)) throw new Error('شماره همراه معتبر الزامی است.');
  const firstName = String(req.body.firstName || '').trim();
  const lastName = String(req.body.lastName || '').trim();
  if (!firstName || !lastName) throw new Error('نام و نام خانوادگی متقاضی الزامی است.');
  const nationalCode = String(req.body.nationalCode || '').trim() || null;
  if (nationalCode && !isValidIranianNationalCode(nationalCode)) throw new Error('کد ملی معتبر نیست.');
  const candidate = nationalCode ? await prisma.hrCandidate.findUnique({ where: { nationalCode } }) : null;
  const resolvedCandidate = candidate || await prisma.hrCandidate.create({ data: {
    firstName, lastName, mobile,
    nationalCode
  }});
  const duplicateApplication = await prisma.hrJobApplication.findFirst({ where: { candidateId: resolvedCandidate.id, positionId: position.id, stage: { not: 'CLOSED' } } });
  if (duplicateApplication) return res.status(409).json({ success: false, error: 'برای این متقاضی و جایگاه پرونده باز وجود دارد.', data: { applicationId: duplicateApplication.id } });
  const row = await prisma.$transaction(async (tx) => {
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
    return tx.hrJobApplication.findUniqueOrThrow({ where: { id: application.id }, include: applicationInclude });
  });
  await audit(row.id, 'APPLICATION_CREATED', req, { candidateId: resolvedCandidate.id, positionId: position.id });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/invitations', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true } });
  if (application.stage === 'CLOSED') throw new Error('برای پرونده بسته دعوت‌نامه صادر نمی‌شود.');
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

router.post('/applications/:id/invitations/:invitationId/delivery/refresh', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/form/return', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/form/correction/retry', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/documents', requireAuthority('HR_PROCESSOR'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new Error('فایل الزامی است.');
  try {
    const gate = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, select: { preIdentityReleasedAt: true, preIdentityGrandfatheredAt: true } });
    if (!gate.preIdentityReleasedAt && !gate.preIdentityGrandfatheredAt) throw new Error('چک‌لیست پیش از احراز هویت هنوز آزاد نشده است.');
    if (!DOCUMENT_CATEGORIES.has(req.body.category) || !['ORIGINAL_SEEN', 'COPY_RECEIVED'].includes(req.body.inspectionSource)) throw new Error('دسته یا منبع مشاهده سند نامعتبر است.');
    validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = await scanHiringFile(req.file.path);
    const digest = await sha256File(req.file.path);
    const aggregate = await prisma.hrHiringDocument.aggregate({ where: { applicationId: req.params.id, category: req.body.category, side: req.body.side || null }, _max: { version: true } });
    const row = await prisma.hrHiringDocument.create({ data: {
      applicationId: req.params.id, category: req.body.category, side: req.body.side || null,
      version: (aggregate._max.version || 0) + 1, inspectionSource: req.body.inspectionSource,
      storageName: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size,
      sha256: digest, malwareScanStatus: scanStatus, note: req.body.note || null, uploadedBy: actorId(req)
    }});
    await audit(req.params.id, 'IDENTITY_DOCUMENT_UPLOADED', req, { documentId: row.id, category: row.category, version: row.version });
    res.status(201).json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file.path); throw error; }
}));

router.get('/applications/:id/documents/:documentId/download', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const document = await prisma.hrHiringDocument.findFirst({ where: { id: req.params.documentId, applicationId: req.params.id } });
  if (!document) return res.status(404).json({ success: false, error: 'سند پیدا نشد.' });
  await audit(req.params.id, 'IDENTITY_DOCUMENT_DOWNLOADED', req, { documentId: document.id });
  res.download(safeHiringStoragePath(document.storageName), document.originalName);
}));

router.put('/applications/:id/identity-checks/:fieldKey', requireAuthority('HR_PROCESSOR'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const gate = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, select: { preIdentityReleasedAt: true, preIdentityGrandfatheredAt: true } });
  if (!gate.preIdentityReleasedAt && !gate.preIdentityGrandfatheredAt) throw new Error('چک‌لیست پیش از احراز هویت هنوز آزاد نشده است.');
  if (!['VERIFIED', 'MISMATCH', 'UNREADABLE', 'NOT_APPLICABLE'].includes(req.body.status)) throw new Error('وضعیت کنترل هویت نامعتبر است.');
  const row = await prisma.hrIdentityCheck.upsert({
    where: { applicationId_fieldKey: { applicationId: req.params.id, fieldKey: req.params.fieldKey } },
    create: { applicationId: req.params.id, fieldKey: req.params.fieldKey, status: req.body.status, note: req.body.note || null, reviewedBy: actorId(req) },
    update: { status: req.body.status, note: req.body.note || null, reviewedBy: actorId(req), reviewedAt: new Date() }
  });
  await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { identityClearance: 'IN_PROGRESS' } });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/identity/approve', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [application, checks, docs] = await Promise.all([
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true } }),
    prisma.hrIdentityCheck.findMany({ where: { applicationId: req.params.id } }),
    prisma.hrHiringDocument.findMany({ where: { applicationId: req.params.id } })
  ]);
  if (!application.preIdentityReleasedAt && !application.preIdentityGrandfatheredAt) throw new Error('چک‌لیست پیش از احراز هویت هنوز آزاد نشده است.');
  if (checks.some((item) => item.reviewedBy === actorId(req)) || docs.some((item) => item.uploadedBy === actorId(req))) throw new Error('مدیر تأییدکننده نباید پردازش‌کننده اسناد یا تطبیق‌های همین پرونده باشد.');
  const requiredVerifiedChecks = ['firstName', 'lastName', 'birthDate', 'birthPlace', 'fatherName', application.candidate.nationalCode ? 'nationalCode' : 'foreignIdentity', 'address', 'postalCode', 'mobile', 'educationLevel', 'maritalStatus'];
  if (requiredVerifiedChecks.some((fieldKey) => !checks.some((item) => item.fieldKey === fieldKey && item.status === 'VERIFIED'))) throw new Error('همه کنترل‌های الزامی هویتی باید مطابق باشند.');
  if (['militaryStatus', 'birthCertificateExplanations'].some((fieldKey) => !checks.some((item) => item.fieldKey === fieldKey && ['VERIFIED', 'NOT_APPLICABLE'].includes(item.status)))) throw new Error('وضعیت نظام وظیفه و توضیحات شناسنامه باید تعیین تکلیف شوند.');
  const latestDocuments = Array.from(docs.reduce((byCategory, document) => {
    const key = `${document.category}:${document.side || ''}`;
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
  await audit(req.params.id, 'IDENTITY_CLEARANCE_APPROVED', req);
  res.json({ success: true });
}));

router.post('/applications/:id/compensation', requireAuthority('HIRING_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (application.identityClearance !== 'APPROVED') throw new Error('پیشنهاد جبران خدمات پس از تأیید هویت ثبت می‌شود.');
  if (!application.assessmentCompletedAt || application.assessmentDecision !== 'APPROVED' || application.assessmentReviewRequired) throw new Error('مرحله ارزیابی باید تکمیل و توسط مدیریت شرکت تأیید شده باشد.');
  if (application.acceptedOfferAt) throw new Error('پس از پذیرش متقاضی، تغییر پیشنهاد نیازمند فرایند اصلاح قرارداد است.');
  const components = Array.isArray(req.body.components) ? req.body.components : [];
  const total = compensationTotalRials(components);
  const aggregate = await prisma.hrCompensationSnapshot.aggregate({ where: { applicationId: req.params.id }, _max: { version: true } });
  const row = await prisma.hrCompensationSnapshot.create({ data: {
    applicationId: req.params.id, version: (aggregate._max.version || 0) + 1,
    componentsJson: components, totalRials: total.toString(), proposedBy: actorId(req)
  }});
  await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { compensationClearance: 'IN_PROGRESS', stage: 'OFFER' } });
  res.status(201).json({ success: true, data: row });
}));

router.put('/applications/:id/compensation/:snapshotId/prepare', requireAuthority('HR_PAYROLL_PROCESSOR'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } });
  const latest = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== row.id) throw new Error('فقط آخرین نسخه پیشنهاد قابل پردازش است.');
  if (row.applicationId !== req.params.id || row.proposedBy === actorId(req)) throw new Error('کارشناس حقوق و دستمزد باید مستقل از پیشنهاددهنده باشد.');
  if (row.hrApprovedAt || row.financeApprovedAt || row.candidateAcceptedAt) throw new Error('نسخه تأییدشده قابل آماده‌سازی مجدد نیست.');
  const components = Array.isArray(req.body.components) ? req.body.components : row.componentsJson as any[];
  const allowedCategories = ['BASE_SALARY', 'FIXED_BENEFIT', 'VARIABLE_BENEFIT', 'ALLOWANCE', 'OTHER'];
  if (components.some((component: any) => !allowedCategories.includes(component.category))) throw new Error('طبقه‌بندی ساختاریافته همه ردیف‌های جبران خدمات الزامی است.');
  const total = compensationTotalRials(components);
  const updated = await prisma.hrCompensationSnapshot.update({ where: { id: row.id }, data: { componentsJson: components, totalRials: total.toString(), preparedBy: actorId(req), preparedAt: new Date() } });
  await audit(req.params.id, 'COMPENSATION_PAYROLL_PREPARED', req, { snapshotId: row.id });
  res.json({ success: true, data: updated });
}));

router.post('/applications/:id/compensation/:snapshotId/hr-approve', requireAuthority('HR_PAYROLL_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!application.assessmentCompletedAt || application.assessmentDecision !== 'APPROVED' || application.assessmentReviewRequired) throw new Error('ارزیابی متقاضی نیازمند تکمیل یا تصمیم مدیریت است.');
  const row = await prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } });
  const latest = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== row.id) throw new Error('فقط آخرین نسخه پیشنهاد قابل تأیید است.');
  if (row.applicationId !== req.params.id || !row.preparedBy || row.preparedBy === actorId(req) || row.proposedBy === actorId(req)) throw new Error('نسخه باید توسط پیشنهاددهنده، پردازش‌کننده و مدیران مستقل آماده و تأیید شود.');
  const approval = await prisma.hrCompensationSnapshot.updateMany({
    where: { id: row.id, hrApprovedAt: null },
    data: { hrApprovedBy: actorId(req), hrApprovedAt: new Date() }
  });
  if (approval.count === 0) return res.json({ success: true });
  await audit(req.params.id, 'COMPENSATION_HR_APPROVED', req, { snapshotId: row.id });
  res.json({ success: true });
}));

router.post('/applications/:id/compensation/:snapshotId/finance-approve', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!application.assessmentCompletedAt || application.assessmentDecision !== 'APPROVED' || application.assessmentReviewRequired) throw new Error('ارزیابی متقاضی نیازمند تکمیل یا تصمیم مدیریت است.');
  const row = await prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } });
  const latest = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== row.id) throw new Error('فقط آخرین نسخه پیشنهاد قابل تأیید است.');
  if (row.applicationId !== req.params.id || !row.hrApprovedAt) throw new Error('تأیید مدیر حقوق و دستمزد هنوز انجام نشده است.');
  if ([row.proposedBy, row.preparedBy, row.hrApprovedBy].includes(actorId(req))) throw new Error('مدیر مالی باید مستقل از پیشنهاددهنده و پردازش‌کنندگان قبلی باشد.');
  const claimToken = crypto.randomUUID();
  const approval = await prisma.hrCompensationSnapshot.updateMany({
    where: { id: row.id, financeApprovedAt: null },
    data: {
      financeApprovedBy: actorId(req),
      financeApprovedAt: new Date(),
      candidateNotificationStatus: 'PENDING',
      candidateNotificationClaimedAt: new Date(),
      candidateNotificationClaimToken: claimToken
    }
  });
  if (approval.count === 0) return res.json({ success: true });
  await audit(req.params.id, 'COMPENSATION_FINANCE_APPROVED', req, { snapshotId: row.id });
  const applicationWithCandidate = await prisma.hrJobApplication.findUniqueOrThrow({
    where: { id: req.params.id },
    include: { candidate: true }
  });
  await deliverClaimedOfferNotification(
    req.params.id,
    row.id,
    applicationWithCandidate.candidate.mobile,
    claimToken,
    actorId(req),
  );
  res.json({ success: true });
}));

router.post('/applications/:id/compensation/:snapshotId/notification/retry', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [snapshot, application] = await Promise.all([
    prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } }),
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true } })
  ]);
  const latest = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== snapshot.id || !snapshot.hrApprovedAt || !snapshot.financeApprovedAt) throw new Error('فقط اعلان آخرین پیشنهاد نهایی قابل ارسال است.');
  if (snapshot.candidateNotificationStatus === 'SENT') return res.json({ success: true, data: snapshot });
  const claimToken = crypto.randomUUID();
  const claim = await prisma.hrCompensationSnapshot.updateMany({
    where: {
      id: snapshot.id,
      candidateNotificationStatus: { not: 'SENT' },
      OR: [
        { candidateNotificationStatus: 'FAILED' },
        { candidateNotificationStatus: null }
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

router.post('/applications/:id/compensation/:snapshotId/offline-decision', requireAuthority('HR_PROCESSOR'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const evidence = validateOfflineOfferDecision(req.body);
  const [snapshot, latest, application, submittedFullName] = await Promise.all([
    prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } }),
    prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } }),
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } }),
    latestSubmittedFullName(req.params.id)
  ]);
  if (latest?.id !== snapshot.id || !snapshot.hrApprovedAt || !snapshot.financeApprovedAt || snapshot.obsoleteAt) throw new Error('تصمیم آفلاین فقط برای آخرین پیشنهاد نهایی و غیرمنسوخ قابل ثبت است.');
  if (!application.assessmentCompletedAt || application.assessmentDecision !== 'APPROVED' || application.assessmentReviewRequired) throw new Error('ارزیابی متقاضی نیازمند تکمیل یا تصمیم مدیریت است.');
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
    if (evidence.decision === 'DECLINED') await notifyOfferDecline(tx, req.params.id);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  await audit(req.params.id, 'OFFER_OFFLINE_DECISION_RECORDED', req, { snapshotId: snapshot.id, ...evidence, communicatedAt: evidence.communicatedAt.toISOString() });
  res.json({ success: true });
}));

router.post('/applications/:id/assessments', requireAuthority('HR_PROCESSOR'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/assessments/complete', requireAuthority('HR_PROCESSOR'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/assessments/:assessmentId/revise', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/assessments/:assessmentId/void', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/assessments/review-acknowledge', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

const DECISION_AUTHORITY: Record<string, string> = {
  HR_INTERVIEW: 'HR_PROCESSOR',
  HR_PRELIMINARY_APPROVAL: 'HR_MANAGER',
  COMPANY_APPROVAL: 'COMPANY_MANAGER'
};

router.post('/applications/:id/decisions/:kind', asyncHandler(async (req: AuthRequest, res: Response) => {
  const kind = String(req.params.kind || '');
  const requiredAuthority = DECISION_AUTHORITY[kind];
  if (!requiredAuthority) throw new Error('نوع تصمیم استخدام نامعتبر است.');
  const assigned = await prisma.hrHiringAuthority.findFirst({ where: { userId: actorId(req), authority: requiredAuthority as any, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (!assigned) return res.status(403).json({ success: false, error: `اختیار سازمانی لازم است: ${requiredAuthority}` });
  const outcome = String(req.body.outcome || '');
  if (!['POSITIVE', 'NEGATIVE'].includes(outcome)) throw new Error('نتیجه تصمیم باید مثبت یا منفی باشد.');
  const explanation = String(req.body.explanation || '').trim();
  const previous = await prisma.hrApplicationDecision.findFirst({ where: { applicationId: req.params.id, kind: kind as any }, orderBy: { version: 'desc' } });
  if ((kind !== 'COMPANY_APPROVAL' || outcome === 'NEGATIVE') && !explanation) throw new Error('توضیح تصمیم الزامی است.');
  if (previous && !String(req.body.changeReason || '').trim()) throw new Error('دلیل تغییر تصمیم قبلی الزامی است.');
  if (kind === 'COMPANY_APPROVAL' && outcome === 'POSITIVE') {
    const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { preIdentityChecklistItems: true } });
    const prior = await prisma.hrApplicationDecision.findMany({ where: { applicationId: req.params.id, kind: { in: ['HR_INTERVIEW', 'HR_PRELIMINARY_APPROVAL'] } }, orderBy: { version: 'desc' } });
    const latestPrior = new Map(prior.map((decision) => [decision.kind, decision]));
    if (latestPrior.get('HR_INTERVIEW')?.outcome !== 'POSITIVE' || latestPrior.get('HR_PRELIMINARY_APPROVAL')?.outcome !== 'POSITIVE') throw new Error('مصاحبه اولیه و تأیید اولیه HR باید مثبت باشند.');
    if (!application.preIdentityRequirementsFinalizedAt) throw new Error('الزامات پرونده هنوز توسط مدیریت نهایی نشده است.');
    if (application.preIdentityChecklistItems.some((item) => ['PENDING', 'IN_PROGRESS'].includes(item.status) || (item.status === 'NEGATIVE' && !item.managementResolution))) throw new Error('همه الزامات باید نتیجه نهایی یا تعیین تکلیف مدیریتی داشته باشند.');
  }
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.hrApplicationDecision.create({ data: {
      applicationId: req.params.id,
      kind: kind as any,
      outcome: outcome as any,
      explanation: explanation || null,
      changeReason: previous ? String(req.body.changeReason).trim() : null,
      version: (previous?.version || 0) + 1,
      decidedBy: actorId(req)
    }});
    if (kind === 'HR_PRELIMINARY_APPROVAL' && outcome === 'NEGATIVE') {
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { disposition: 'INITIAL_REJECTED', dispositionReason: explanation, dispositionBy: actorId(req), dispositionAt: new Date(), preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null, preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null } });
    } else if (kind === 'HR_INTERVIEW' || kind === 'HR_PRELIMINARY_APPROVAL' || (kind === 'COMPANY_APPROVAL' && outcome === 'NEGATIVE')) {
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityManagementApprovedBy: null, preIdentityManagementApprovedAt: null, preIdentityManagementApprovalNote: null, preIdentityReleasedBy: null, preIdentityReleasedAt: null } });
    }
    if (kind === 'COMPANY_APPROVAL' && outcome === 'POSITIVE') {
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityManagementApprovedBy: actorId(req), preIdentityManagementApprovedAt: new Date(), preIdentityManagementApprovalNote: explanation || null } });
    }
    return created;
  });
  await audit(req.params.id, 'HIRING_DECISION_RECORDED', req, { decisionId: row.id, kind, outcome, version: row.version });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/pre-identity/items', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/pre-identity/finalize', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const decisions = await prisma.hrApplicationDecision.findMany({
    where: { applicationId: req.params.id, kind: { in: ['HR_INTERVIEW', 'HR_PRELIMINARY_APPROVAL'] } }, orderBy: { version: 'desc' }
  });
  const latest = new Map(decisions.map((decision) => [decision.kind, decision]));
  if (latest.get('HR_INTERVIEW')?.outcome !== 'POSITIVE' || latest.get('HR_PRELIMINARY_APPROVAL')?.outcome !== 'POSITIVE') throw new Error('مصاحبه اولیه و تأیید اولیه HR باید پیش از نهایی‌سازی مثبت باشند.');
  const row = await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityRequirementsFinalizedBy: actorId(req), preIdentityRequirementsFinalizedAt: new Date() } });
  await audit(req.params.id, 'PRE_IDENTITY_REQUIREMENTS_FINALIZED', req);
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/pre-identity/items/:itemId/correct', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.put('/applications/:id/pre-identity/items/:itemId/result', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/pre-identity/items/:itemId/resolve', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.get('/applications/:id/pre-identity/items/:itemId/evidence/download', requireAuthority('HR_PROCESSOR', 'HR_MANAGER', 'COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.hrPreIdentityChecklistItem.findFirst({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!item?.storageName || !item.originalName) return res.status(404).json({ success: false, error: 'فایل گزارش این الزام پیدا نشد.' });
  await audit(req.params.id, 'PRE_IDENTITY_EVIDENCE_DOWNLOADED', req, { itemId: item.id });
  res.download(safeHiringStoragePath(item.storageName), item.originalName);
}));

router.post('/applications/:id/pre-identity/release', requireAuthority('HR_PROCESSOR'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { preIdentityChecklistItems: true } });
  const decisions = await prisma.hrApplicationDecision.findMany({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' } });
  const latestDecision = new Map(decisions.map((decision) => [decision.kind, decision]));
  if (['HR_INTERVIEW', 'HR_PRELIMINARY_APPROVAL', 'COMPANY_APPROVAL'].some((kind) => latestDecision.get(kind as any)?.outcome !== 'POSITIVE')) throw new Error('سه تصمیم مرحله پیش از احراز هویت باید در آخرین نسخه مثبت باشند.');
  if (!application.preIdentityRequirementsFinalizedAt || !application.preIdentityManagementApprovedAt) throw new Error('نهایی‌سازی الزامات و تأیید مدیریت برای ادامه الزامی است.');
  if (application.preIdentityChecklistItems.some((item) => ['PENDING', 'IN_PROGRESS'].includes(item.status) || (item.status === 'NEGATIVE' && !item.managementResolution))) throw new Error('چک‌لیست هنوز مورد تعیین‌تکلیف‌نشده دارد.');
  const row = await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { preIdentityReleasedBy: actorId(req), preIdentityReleasedAt: new Date(), stage: 'SCREENING' } });
  await audit(req.params.id, 'PRE_IDENTITY_RELEASED', req);
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/assessments/decision', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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
  const required = application.disposition === 'INITIAL_REJECTED' ? 'HR_MANAGER' : application.disposition === 'RESERVE' ? 'COMPANY_MANAGER' : null;
  if (!required) throw new Error('پرونده برچسب توقف قابل فعال‌سازی ندارد.');
  const assigned = await prisma.hrHiringAuthority.findFirst({ where: { userId: actorId(req), authority: required as any, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (!assigned) return res.status(403).json({ success: false, error: `اختیار سازمانی لازم است: ${required}` });
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new Error('دلیل فعال‌سازی مجدد الزامی است.');
  const previousDisposition = application.disposition;
  const row = await prisma.hrJobApplication.update({ where: { id: application.id }, data: { disposition: null, dispositionReason: null, dispositionBy: null, dispositionAt: null } });
  await audit(req.params.id, 'APPLICATION_DISPOSITION_REACTIVATED', req, { previousDisposition, reason });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/reopen/authorize', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (application.stage !== 'CLOSED' || !application.outcome || application.outcome === 'HIRED') throw new Error('فقط پرونده بسته غیر از استخدام‌شده قابل بازگشایی است.');
  const reason = String(req.body.reason || '').trim();
  if (!reason) throw new Error('دلیل مجوز بازگشایی الزامی است.');
  const row = await prisma.hrApplicationReopening.create({ data: { applicationId: application.id, status: 'AUTHORIZED', companyAuthorizedBy: actorId(req), companyAuthorizedAt: new Date(), companyReason: reason } });
  await audit(application.id, 'APPLICATION_REOPENING_AUTHORIZED', req, { reopeningId: row.id, reason });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/reopen/execute', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { position: true } });
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
  const now = new Date();
  const row = await prisma.$transaction(async (tx) => {
    await tx.hrApplicationReopening.update({ where: { id: reopening.id }, data: { status: 'REOPENED', hrExecutedBy: actorId(req), hrExecutedAt: now, hrReason: reason, candidateConsentMethod: req.body.candidateConsentMethod || null, candidateConsentedAt: req.body.candidateConsentedAt ? parseDate(req.body.candidateConsentedAt, 'زمان رضایت') : null, candidateConsentNote: String(req.body.candidateConsentNote || '').trim() || null } });
    const latestOffer = await tx.hrCompensationSnapshot.findFirst({ where: { applicationId: application.id, obsoleteAt: null }, orderBy: { version: 'desc' } });
    if (latestOffer) await tx.hrCompensationSnapshot.update({ where: { id: latestOffer.id }, data: { obsoleteAt: now, obsoleteBy: actorId(req), obsoleteReason: 'بازگشایی پرونده بسته؛ صدور نسخه جدید پیشنهاد الزامی است.' } });
    return tx.hrJobApplication.update({ where: { id: application.id }, data: { stage: application.preClosureStage || 'RECEIVED', outcome: null, outcomeReason: null, acceptedOfferAt: null, compensationClearance: latestOffer ? 'NOT_STARTED' : application.compensationClearance, disposition: null, dispositionReason: null, dispositionBy: null, dispositionAt: null } });
  });
  await audit(application.id, 'APPLICATION_REOPENED', req, { reopeningId: reopening.id, reason, restoredStage: row.stage });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/collateral-requirements', requireAuthority('COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const type = String(req.body.type || '');
  const explanation = String(req.body.candidateExplanation || '').trim();
  if (!COLLATERAL_TYPES.has(type) || !explanation) throw new Error('نوع وثیقه و توضیح قابل نمایش به متقاضی الزامی است.');
  const latest = await prisma.hrCollateralRequirement.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' } });
  const latestOffer = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id, obsoleteAt: null }, orderBy: { version: 'desc' } });
  const row = await prisma.$transaction(async (tx) => {
    if (latest) await tx.hrCollateralRequirement.update({ where: { id: latest.id }, data: { status: 'SUPERSEDED' } });
    const created = await tx.hrCollateralRequirement.create({ data: { applicationId: req.params.id, version: (latest?.version || 0) + 1, type, amountRials: req.body.amountRials || null, obligation: String(req.body.obligation || '').trim() || null, dueTiming: String(req.body.dueTiming || '').trim() || null, candidateExplanation: explanation, proposedBy: actorId(req), supersedesId: latest?.id || null } });
    if (latestOffer?.candidateAcceptedAt) {
      await tx.hrCompensationSnapshot.update({ where: { id: latestOffer.id }, data: { obsoleteAt: new Date(), obsoleteBy: actorId(req), obsoleteReason: 'تغییر الزام وثیقه پس از پذیرش؛ نسخه جدید پیشنهاد الزامی است.' } });
      await tx.hrJobApplication.update({ where: { id: req.params.id }, data: { acceptedOfferAt: null, compensationClearance: 'NOT_STARTED' } });
    }
    return created;
  });
  await audit(req.params.id, 'COLLATERAL_REQUIREMENT_PROPOSED', req, { requirementId: row.id, version: row.version, supersedesId: latest?.id || null });
  res.status(201).json({ success: true, data: row });
}));

router.get('/applications/:id/assessments/:assessmentId/download', requireAuthority('HR_PROCESSOR', 'HR_MANAGER', 'COMPANY_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCandidateAssessment.findFirst({ where: { id: req.params.assessmentId, applicationId: req.params.id } });
  if (!row?.storageName || !row.originalName) return res.status(404).json({ success: false, error: 'فایل ارزیابی پیدا نشد.' });
  await audit(req.params.id, 'CANDIDATE_ASSESSMENT_DOWNLOADED', req, { assessmentId: row.id });
  res.download(safeHiringStoragePath(row.storageName), row.originalName);
}));

router.post('/applications/:id/collateral/apply-template', requireAuthority('FINANCE_RECORDER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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
    prisma.hrCollateralItem.create({ data: { applicationId: application.id, type: requirement.type, required: true, amountRials: requirement.amountRials, status: 'MISSING', note: requirement.obligation || requirement.candidateExplanation, recordedBy: actorId(req) } })
  ]);
  await audit(req.params.id, 'COLLATERAL_RECEIPT_OPENED', req, { requirementId: requirement.id, requirementVersion: requirement.version });
  res.status(201).json({ success: true });
}));

router.post('/applications/:id/collateral', requireAuthority('FINANCE_RECORDER'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  let scanStatus: string | undefined;
  let digest: string | undefined;
  try {
    const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
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
      amountRials: req.body.amountRials || null, identifier: req.body.identifier || null,
      issuerOrGuarantor: req.body.issuerOrGuarantor || null, receivedAt: req.body.receivedAt ? parseDate(req.body.receivedAt, 'تاریخ دریافت') : null,
      custodyLocation: req.body.custodyLocation || null, status: 'RECEIVED' as const,
      storageName: req.file?.filename, originalName: req.file?.originalname, mimeType: req.file?.mimetype, size: req.file?.size,
      sha256: digest, malwareScanStatus: scanStatus, note: req.body.note || null, recordedBy: actorId(req)
    };
    const previous = req.body.itemId ? await prisma.hrCollateralItem.findFirst({ where: { id: req.body.itemId, applicationId: req.params.id, status: { in: ['MISSING', 'MISMATCH', 'UNREADABLE'] } } }) : null;
    if (req.body.itemId && !previous) throw new Error('قلم چک‌لیست قابل ثبت یا جایگزینی پیدا نشد.');
    const row = previous?.status === 'MISSING'
      ? await prisma.hrCollateralItem.update({ where: { id: previous.id }, data: itemData })
      : await prisma.hrCollateralItem.create({ data: {
        applicationId: req.params.id, templateItemId: previous?.templateItemId, supersedesItemId: previous?.id,
        version: previous ? previous.version + 1 : 1, ...itemData,
        type: previous?.type || itemData.type, required: previous?.required ?? itemData.required
      }});
    await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { collateralClearance: 'IN_PROGRESS' } });
    await audit(req.params.id, 'COLLATERAL_RECORDED', req, { collateralItemId: row.id, type: row.type });
    res.status(201).json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file?.path); throw error; }
}));

router.get('/applications/:id/collateral/:itemId/download', requireAuthority('FINANCE_RECORDER', 'FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCollateralItem.findFirst({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!row?.storageName || !row.originalName) return res.status(404).json({ success: false, error: 'فایل وثیقه پیدا نشد.' });
  await audit(req.params.id, 'COLLATERAL_DOCUMENT_DOWNLOADED', req, { itemId: row.id });
  res.download(safeHiringStoragePath(row.storageName), row.originalName);
}));

router.put('/applications/:id/collateral/:itemId/review', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!['VERIFIED', 'MISMATCH', 'UNREADABLE'].includes(req.body.status)) throw new Error('وضعیت بررسی وثیقه نامعتبر است.');
  const item = await prisma.hrCollateralItem.findUniqueOrThrow({ where: { id: req.params.itemId } });
  if (await prisma.hrCollateralItem.findUnique({ where: { supersedesItemId: item.id }, select: { id: true } })) throw new Error('این قلم با نسخه جدید جایگزین شده است.');
  if (item.applicationId !== req.params.id || item.recordedBy === actorId(req)) throw new Error('مدیر مالی ثبت‌کننده نمی‌تواند همان قلم را تأیید کند.');
  const row = await prisma.hrCollateralItem.update({ where: { id: item.id }, data: {
    status: req.body.status, note: req.body.note ?? item.note, coordinationReason: req.body.coordinationReason ?? item.coordinationReason,
    approvedBy: req.body.status === 'VERIFIED' ? actorId(req) : null, approvedAt: req.body.status === 'VERIFIED' ? new Date() : null
  }});
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/collateral/approve', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const items = await prisma.hrCollateralItem.findMany({ where: { applicationId: req.params.id } });
  const supersededIds = new Set(items.map((item) => item.supersedesItemId).filter(Boolean));
  const currentItems = items.filter((item) => !supersededIds.has(item.id));
  if (!currentItems.length || currentItems.some((item) => item.required && (item.status !== 'VERIFIED' || !item.approvedBy || item.recordedBy === item.approvedBy))) throw new Error('همه اقلام جاری و الزامی وثیقه باید توسط مدیر مستقل تأیید شوند.');
  await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { collateralClearance: 'APPROVED' } });
  await audit(req.params.id, 'COLLATERAL_CLEARANCE_APPROVED', req);
  res.json({ success: true });
}));

router.put('/applications/:id/collateral/:itemId/return', requireAuthority('FINANCE_RECORDER', 'FINANCE_MANAGER'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.get('/applications/:id/collateral/:itemId/return-evidence/download', requireAuthority('FINANCE_RECORDER', 'FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCollateralItem.findFirst({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!row?.returnEvidenceStorageName || !row.returnEvidenceOriginalName) return res.status(404).json({ success: false, error: 'مدرک تحویل پیدا نشد.' });
  await audit(req.params.id, 'COLLATERAL_RETURN_EVIDENCE_DOWNLOADED', req, { itemId: row.id });
  res.download(safeHiringStoragePath(row.returnEvidenceStorageName), row.returnEvidenceOriginalName);
}));

router.post('/applications/:id/collateral/:itemId/return-confirm', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const item = await prisma.hrCollateralItem.findFirstOrThrow({ where: { id: req.params.itemId, applicationId: req.params.id } });
  if (!item.returnedAt || !item.returnedTo || !item.returnEvidenceNote || !item.returnEvidenceStorageName) throw new Error('جزئیات و مدرک تحویل باید کامل باشد.');
  if (item.returnedBy === actorId(req)) throw new Error('ثبت‌کننده تحویل نمی‌تواند همان بازگشت را تأیید کند.');
  const row = await prisma.hrCollateralItem.update({ where: { id: item.id }, data: { returnConfirmedBy: actorId(req), returnConfirmedAt: new Date() } });
  await audit(req.params.id, 'COLLATERAL_RETURN_CONFIRMED', req, { itemId: row.id });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/convert', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true, position: true, compensationSnapshots: { orderBy: { version: 'desc' }, take: 1 } } });
  if (application.convertedAt) return res.status(409).json({ success: false, error: 'این پرونده قبلاً به پرسنل تبدیل شده است.' });
  if (!application.assessmentCompletedAt || application.assessmentDecision !== 'APPROVED' || application.assessmentReviewRequired) {
    throw new Error('ارزیابی متقاضی باید تکمیل و بازبینی لازم تأیید شده باشد.');
  }
  const compensation = application.compensationSnapshots[0];
  if (application.identityClearance !== 'APPROVED' || application.collateralClearance !== 'APPROVED' || !application.acceptedOfferAt || !compensation?.candidateAcceptedAt || !compensation.hrApprovedAt || !compensation.financeApprovedAt) {
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

router.post('/applications/:id/contracts', requireAuthority('FINANCE_RECORDER'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/contracts/:contractId/submit', requireAuthority('FINANCE_RECORDER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/contracts/:contractId/approve', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/contracts/:contractId/return', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.get('/applications/:id/contracts/:contractId/download', requireAuthority('FINANCE_RECORDER', 'FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrEmploymentContractDocument.findFirst({ where: { id: req.params.contractId, applicationId: req.params.id } });
  if (!row) return res.status(404).json({ success: false, error: 'قرارداد پیدا نشد.' });
  await audit(req.params.id, 'SIGNED_CONTRACT_DOWNLOADED', req, { contractId: row.id });
  res.download(safeHiringStoragePath(row.storageName), row.originalName);
}));

router.post('/applications/:id/payroll-participation', requireAuthority('HR_PAYROLL_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.put('/applications/:id/insurance', requireAuthority('HR_PROCESSOR'), asyncHandler(async (req: AuthRequest, res: Response) => {
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

router.post('/applications/:id/onboarding-tasks', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { employmentRelationship: true } });
  if (!application.employmentRelationship || application.employmentRelationship.status !== 'PLANNED') throw new Error('وظیفه موقت فقط برای پرسنل برنامه‌ریزی‌شده قابل ثبت است.');
  if (!String(req.body.title || '').trim() || !['HR_PROCESSOR', 'HR_MANAGER', 'HR_PAYROLL_PROCESSOR', 'HR_PAYROLL_MANAGER', 'FINANCE_RECORDER', 'FINANCE_MANAGER', 'HIRING_MANAGER'].includes(req.body.ownerAuthority)) throw new Error('عنوان و مالک سازمانی معتبر وظیفه الزامی است.');
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
  const assigned = await prisma.hrHiringAuthority.findFirst({ where: { userId: actorId(req), authority: task.ownerAuthority, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (!assigned) return res.status(403).json({ success: false, error: 'فقط مالک سازمانی وظیفه مجاز به تکمیل است.' });
  const row = await prisma.hrOnboardingTask.update({ where: { id: task.id }, data: {
    status: req.body.status, evidenceNote: req.body.evidenceNote || null,
    completedBy: req.body.status === 'COMPLETE' ? actorId(req) : null, completedAt: req.body.status === 'COMPLETE' ? new Date() : null
  }});
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/activate', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { employmentRelationship: true, onboardingTasks: true, payrollParticipation: true } });
  if (!application.employmentRelationship || application.employmentRelationship.status !== 'PLANNED') throw new Error('رابطه استخدامی برنامه‌ریزی‌شده پیدا نشد.');
  const unresolved = unresolvedActivationRequirements({
    scheduledStartDate: application.scheduledStartDate,
    identityClearance: application.identityClearance,
    collateralClearance: application.collateralClearance,
    contractClearance: application.contractClearance,
    compensationClearance: application.compensationClearance,
    hasPayrollParticipation: !!application.payrollParticipation,
    tasks: application.onboardingTasks
  });
  if (unresolved.length) throw new Error(`پیش‌نیازهای فعال‌سازی کامل نیستند: ${unresolved.join('، ')}`);
  await prisma.$transaction([
    prisma.hrEmploymentRelationship.update({ where: { id: application.employmentRelationship.id }, data: { status: 'ACTIVE' } }),
    prisma.personnel.update({ where: { id: application.employmentRelationship.personnelId }, data: { isActive: true } }),
    prisma.hrJobApplication.update({ where: { id: application.id }, data: { activatedAt: new Date() } })
  ]);
  await audit(application.id, 'EMPLOYMENT_ACTIVATED', req);
  res.json({ success: true });
}));

router.post('/applications/:id/close', requireAuthority('HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { employmentRelationship: true, collateralItems: true } });
  if (!['REJECTED', 'WITHDRAWN', 'REQUEST_CANCELLED'].includes(req.body.outcome)) throw new Error('نتیجه بستن پرونده نامعتبر است.');
  if (!String(req.body.reason || '').trim()) throw new Error('دلیل بستن پرونده الزامی است.');
  if (application.employmentRelationship?.status === 'ACTIVE') throw new Error('پرونده استخدام فعال از مسیر خاتمه رابطه استخدامی مدیریت می‌شود.');
  if (application.collateralItems.some((item) => item.receivedAt && (!item.returnedAt || !item.returnConfirmedAt))) throw new Error('بازگشت همه وثیقه‌های دریافت‌شده باید ثبت و توسط مدیر مالی تأیید شود.');
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

router.use((error: any, _req: express.Request, res: Response, _next: NextFunction) => {
  console.error('HR hiring route error:', error);
  if (error?.code === 'P2002') return res.status(409).json({ success: false, error: 'رکورد تکراری است.', details: error.meta });
  if (error instanceof multer.MulterError) return res.status(400).json({ success: false, error: error.message });
  res.status(400).json({ success: false, error: error?.message || 'عملیات استخدام ناموفق بود.' });
});

export default router;
