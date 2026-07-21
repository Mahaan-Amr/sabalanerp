import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import { Prisma, PrismaClient } from '@prisma/client';
import { AuthRequest, protect } from '../middleware/auth';
import smsService from '../services/smsService';
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
import { compensationTotalRials, isValidIranianNationalCode, unresolvedActivationRequirements, validateHiringQuestionnaire } from '../services/hrHiringRules';
import {
  applicantOtpHash,
  applicantSubjectHash,
  generateApplicantOtp,
  normalizeApplicantDigits,
  normalizeApplicantMobile,
  normalizeApplicantOtp
} from '../services/hrCandidateAccess';

const router = express.Router();
const prisma = new PrismaClient();
const ACCESS_TTL_DAYS = 7;
const PHONE_FAILURE_LIMIT = 5;
const IP_FAILURE_LIMIT = 30;
const ACCESS_WINDOW_MS = 15 * 60_000;
const ACCESS_BLOCK_MS = 15 * 60_000;
const INVALID_ACCESS_ERROR = 'شماره همراه یا کد ورود معتبر نیست، یا اعتبار دسترسی پایان یافته است. لطفاً اطلاعات را بررسی کنید یا با منابع انسانی تماس بگیرید.';
const THROTTLED_ACCESS_ERROR = 'تعداد تلاش‌ها بیش از حد مجاز است. لطفاً ۱۵ دقیقه دیگر دوباره تلاش کنید.';
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
const parseDate = (value: unknown, name: string) => {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) throw new Error(`${name} نامعتبر است.`);
  return date;
};
const actorId = (req: AuthRequest) => req.user!.id;
const normalizedName = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ');

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

const applicationInclude = {
  candidate: true,
  position: { include: { job: true, organizationalUnit: true, workplace: true, costCenter: true } },
  formRevisions: { orderBy: { revisionNumber: 'desc' as const }, take: 4 },
  documents: { orderBy: [{ category: 'asc' as const }, { version: 'desc' as const }] },
  identityChecks: { orderBy: { fieldKey: 'asc' as const } },
  collateralItems: { orderBy: { createdAt: 'asc' as const } },
  collateralTemplate: { include: { items: { orderBy: { sortOrder: 'asc' as const } } } },
  compensationSnapshots: { orderBy: { version: 'desc' as const }, take: 3 },
  assessments: { orderBy: { recordedAt: 'desc' as const } },
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
    prisma.hrHiringAuthority.findFirst({ where: { userId: req.user!.id, isActive: true } })
  ]);
  if (!hr && !accounting && !authority) return res.status(403).json({ success: false, error: 'دسترسی پرونده استخدام ندارید.' });
  next();
});

const requireAuthority = (...authorities: string[]) => asyncHandler(async (req: AuthRequest, res: Response, next: NextFunction) => {
  const assigned = await prisma.hrHiringAuthority.findFirst({
    where: { userId: req.user!.id, authority: { in: authorities as any }, isActive: true }
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
  if (!explicitAdmin) return res.status(403).json({ success: false, error: 'دسترسی صریح مدیریت HR لازم است؛ نقش Admin به‌تنهایی کافی نیست.' });
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
    return res.status(429).json({ success: false, error: THROTTLED_ACCESS_ERROR });
  }

  const invitation = mobile && otp ? await prisma.hrCandidateInvitation.findFirst({
    where: {
      mobileSnapshot: mobile,
      otpHash: applicantOtpHash(mobile, otp),
      revokedAt: null,
      expiresAt: { gt: new Date() },
      application: { stage: { not: 'CLOSED' } }
    },
    include: { application: { include: { candidate: true } } }
  }) : null;

  if (!invitation) {
    const [phoneThrottle, ipThrottle] = await Promise.all([
      registerAccessFailure('PHONE', mobileHash, PHONE_FAILURE_LIMIT),
      registerAccessFailure('IP', ipHash, IP_FAILURE_LIMIT)
    ]);
    await recordAccessAttempt(req, { mobileHash, ipHash, outcome: 'REJECTED' });
    const blocked = (phoneThrottle.blockedUntil && phoneThrottle.blockedUntil > new Date()) || (ipThrottle.blockedUntil && ipThrottle.blockedUntil > new Date());
    return res.status(blocked ? 429 : 401).json({ success: false, error: blocked ? THROTTLED_ACCESS_ERROR : INVALID_ACCESS_ERROR });
  }

  await prisma.$transaction([
    prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: { lastVerifiedAt: new Date(), verificationCount: { increment: 1 } } }),
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
      compensationSnapshots: { orderBy: { version: 'desc' }, take: 1 }
    }
  });
  const compensation = application.compensationSnapshots[0];
  res.json({ success: true, data: {
    id: application.id,
    stage: application.stage,
    candidate: application.candidate,
    position: application.position,
    revision: application.formRevisions[0] || null,
    correctionSource: application.formRevisions.find((item) => item.status === 'RETURNED') || null,
    compensation: compensation?.hrApprovedAt && compensation.financeApprovedAt ? compensation : null
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
      correctionReason: latest.correctionReason
    }});
  } else if (latest.status === 'DRAFT') {
    revision = await prisma.hrApplicationFormRevision.update({ where: { id: latest.id }, data: { dataJson: req.body as Prisma.InputJsonValue } });
  } else {
    return res.status(409).json({ success: false, error: 'فرم ارسال‌شده قفل است و باید توسط HR برای اصلاح بازگردانده شود.' });
  }
  await prisma.hrJobApplication.update({ where: { id: applicationId }, data: { currentRevisionNumber: revision.revisionNumber } });
  res.json({ success: true, data: revision });
}));

router.post('/public/application/submit', applicantSession, asyncHandler(async (req: ApplicantRequest, res: Response) => {
  const applicationId = req.applicant!.applicationId;
  const latest = await prisma.hrApplicationFormRevision.findFirst({ where: { applicationId }, orderBy: { revisionNumber: 'desc' } });
  if (!latest || latest.status !== 'DRAFT') return res.status(409).json({ success: false, error: 'پیش‌نویس قابل ارسال پیدا نشد.' });
  const data = latest.dataJson as any;
  validateHiringQuestionnaire(data);
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
  const [snapshot, application] = await Promise.all([
    prisma.hrCompensationSnapshot.findFirst({ where: { applicationId }, orderBy: { version: 'desc' } }),
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: applicationId }, include: { candidate: true } })
  ]);
  if (!snapshot?.hrApprovedAt || !snapshot.financeApprovedAt) return res.status(409).json({ success: false, error: 'پیشنهاد جبران خدمات هنوز نهایی نشده است.' });
  if (snapshot.candidateAcceptedAt) return res.status(409).json({ success: false, error: 'این نسخه قبلاً توسط متقاضی پذیرفته شده است.' });
  const acceptedName = normalizedName(req.body.fullName);
  if (!acceptedName || acceptedName !== normalizedName(`${application.candidate.firstName} ${application.candidate.lastName}`)) throw new Error('نام کامل باید با پرونده متقاضی یکسان باشد.');
  await prisma.$transaction([
    prisma.hrCompensationSnapshot.update({ where: { id: snapshot.id }, data: { candidateAcceptedAt: new Date(), candidateAcceptedName: acceptedName } }),
    prisma.hrJobApplication.update({ where: { id: applicationId }, data: { acceptedOfferAt: new Date(), stage: 'OFFER', compensationClearance: 'APPROVED' } })
  ]);
  await audit(applicationId, 'OFFER_COMPENSATION_ACCEPTED', req, { snapshotId: snapshot.id }, 'CANDIDATE');
  res.json({ success: true });
}));

// Authenticated hiring workspace.
router.use(protect, requireHiringRead);

router.get('/me/authorities', asyncHandler(async (req: AuthRequest, res: Response) => {
  const rows = await prisma.hrHiringAuthority.findMany({ where: { userId: actorId(req), isActive: true }, select: { authority: true } });
  res.json({ success: true, data: rows.map((row) => row.authority) });
}));

router.get('/authorities', requireHrAdmin, asyncHandler(async (_req: AuthRequest, res: Response) => {
  const rows = await prisma.hrHiringAuthority.findMany({ orderBy: [{ authority: 'asc' }, { createdAt: 'asc' }] });
  res.json({ success: true, data: rows });
}));

router.post('/authorities', requireHrAdmin, asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrHiringAuthority.upsert({
    where: { userId_authority: { userId: req.body.userId, authority: req.body.authority } },
    create: { userId: req.body.userId, authority: req.body.authority, createdBy: actorId(req) },
    update: { isActive: req.body.isActive !== false }
  });
  res.status(201).json({ success: true, data: row });
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
  const rows = await prisma.hrJobApplication.findMany({
    where: {
      stage: req.query.stage ? req.query.stage as any : undefined,
      OR: search ? [
        { candidate: { firstName: { contains: search, mode: 'insensitive' } } },
        { candidate: { lastName: { contains: search, mode: 'insensitive' } } },
        { candidate: { mobile: { contains: search } } },
        { candidate: { nationalCode: { contains: search } } }
      ] : undefined
    },
    include: { candidate: { select: { id: true, firstName: true, lastName: true, mobile: true, talentBankSearchable: true, linkedPersonnelId: true, createdAt: true, updatedAt: true } }, position: { include: { job: true, organizationalUnit: true } }, employmentRelationship: { include: { personnel: true } } },
    orderBy: { updatedAt: 'desc' }
  });
  res.json({ success: true, data: rows });
}));

router.get('/applications/:id', asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrJobApplication.findUnique({ where: { id: req.params.id }, include: applicationInclude });
  if (!row) return res.status(404).json({ success: false, error: 'پرونده استخدام پیدا نشد.' });
  const authorityRows = await prisma.hrHiringAuthority.findMany({ where: { userId: actorId(req), isActive: true }, select: { authority: true } });
  const authorities = new Set(authorityRows.map((item) => item.authority));
  const canSeeHrSensitive = authorities.has('HR_PROCESSOR') || authorities.has('HR_MANAGER');
  const canSeeFinanceSensitive = authorities.has('FINANCE_RECORDER') || authorities.has('FINANCE_MANAGER');
  const canSeeCompensation = canSeeFinanceSensitive || authorities.has('HIRING_MANAGER') || authorities.has('HR_PAYROLL_PROCESSOR') || authorities.has('HR_PAYROLL_MANAGER') || authorities.has('HR_MANAGER');
  const data: any = row;
  data.documents = canSeeHrSensitive ? data.documents.map(({ storageName: _storageName, sha256: _sha256, ...document }: any) => document) : [];
  data.assessments = canSeeHrSensitive ? data.assessments.map(({ storageName: _storageName, sha256: _sha256, ...assessment }: any) => assessment) : [];
  if (!canSeeHrSensitive) {
    data.candidate.profileJson = null;
    data.candidate.nationalCode = null;
    data.candidate.foreignIdentityType = null;
    data.candidate.foreignIdentityNumber = null;
    data.candidate.postalCode = null;
    data.candidate.hasSocialSecurityHistory = null;
    data.formRevisions = [];
    data.identityChecks = [];
    data.insuranceEnrollment = null;
  }
  if (canSeeFinanceSensitive) data.collateralItems = data.collateralItems.map(({ storageName: _storageName, sha256: _sha256, returnEvidenceStorageName: _returnStorage, returnEvidenceSha256: _returnSha, ...item }: any) => item);
  else data.collateralItems = data.collateralItems.map(({ id, type, required, status, coordinationReason, receivedAt, returnedAt, returnConfirmedAt }: any) => ({ id, type, required, status, coordinationReason, receivedAt, returnedAt, returnConfirmedAt }));
  if (!canSeeCompensation) data.compensationSnapshots = [];
  data.contracts = data.contracts.map(({ storageName: _storageName, sha256: _sha256, ...contract }: any) => contract);
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
  const row = await prisma.hrJobApplication.create({ data: { candidateId: resolvedCandidate.id, positionId: position.id, createdBy: actorId(req) }, include: applicationInclude });
  await audit(row.id, 'APPLICATION_CREATED', req, { candidateId: resolvedCandidate.id, positionId: position.id });
  res.status(201).json({ success: true, data: row });
}));

router.post('/applications/:id/invitations', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { candidate: true } });
  if (application.stage === 'CLOSED') throw new Error('برای پرونده بسته دعوت‌نامه صادر نمی‌شود.');
  const mobile = normalizeApplicantMobile(application.candidate.mobile);
  if (!mobile) throw new Error('شماره همراه متقاضی معتبر نیست.');
  let otp = '';
  let invitation: Awaited<ReturnType<typeof prisma.hrCandidateInvitation.create>> | null = null;
  for (let attempt = 0; attempt < 20 && !invitation; attempt += 1) {
    otp = generateApplicantOtp();
    try {
      invitation = await prisma.hrCandidateInvitation.create({ data: {
        applicationId: application.id,
        mobileSnapshot: mobile,
        otpHash: applicantOtpHash(mobile, otp),
        expiresAt: plusDays(ACCESS_TTL_DAYS),
        createdBy: actorId(req)
      }});
    } catch (error: any) {
      if (error?.code !== 'P2002') throw error;
    }
  }
  if (!invitation) throw new Error('تولید کد ورود یکتا ناموفق بود؛ دوباره تلاش کنید.');
  const base = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL || 'http://localhost:3000';
  const entryUrl = `${base.replace(/\/$/, '')}/apply`;
  const sms = await smsService.sendHiringInvitation({ phoneNumber: mobile, code: otp });
  if (!sms.success) {
    await prisma.hrCandidateInvitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } });
    throw new Error(sms.error || 'ارسال پیامک دعوت ناموفق بود.');
  }
  await prisma.hrCandidateInvitation.updateMany({ where: { applicationId: application.id, id: { not: invitation.id }, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit(application.id, 'CANDIDATE_INVITATION_SENT', req, { invitationId: invitation.id, expiresAt: invitation.expiresAt });
  res.status(201).json({ success: true, data: { entryUrl, expiresAt: invitation.expiresAt, debugOtp: process.env.SMS_IR_ENVIRONMENT === 'sandbox' ? otp : undefined } });
}));

router.post('/applications/:id/form/return', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const latest = await prisma.hrApplicationFormRevision.findFirst({ where: { applicationId: req.params.id, status: 'SUBMITTED' }, orderBy: { revisionNumber: 'desc' } });
  if (!latest) throw new Error('فرم ارسال‌شده پیدا نشد.');
  if (!Array.isArray(req.body.fields) || !req.body.fields.length || !String(req.body.reason || '').trim()) throw new Error('فیلدها و دلیل اصلاح الزامی است.');
  const formKeys = new Set(Object.keys(latest.dataJson as Record<string, unknown>));
  if (req.body.fields.some((field: unknown) => !formKeys.has(String(field)))) throw new Error('یکی از فیلدهای اصلاح در نسخه فرم وجود ندارد.');
  const row = await prisma.hrApplicationFormRevision.update({ where: { id: latest.id }, data: {
    status: 'RETURNED', correctionFieldsJson: req.body.fields, correctionReason: req.body.reason, returnedAt: new Date(), returnedBy: actorId(req)
  }});
  await audit(req.params.id, 'APPLICATION_FORM_RETURNED', req, { revisionNumber: row.revisionNumber, fields: req.body.fields, reason: req.body.reason });
  res.json({ success: true, data: row });
}));

router.post('/applications/:id/documents', requireAuthority('HR_PROCESSOR'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!req.file) throw new Error('فایل الزامی است.');
  try {
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
  if (row.applicationId !== req.params.id || row.proposedBy === actorId(req)) throw new Error('پردازش‌کننده Payroll باید مستقل از پیشنهاددهنده باشد.');
  if (row.hrApprovedAt || row.financeApprovedAt || row.candidateAcceptedAt) throw new Error('نسخه تأییدشده قابل آماده‌سازی مجدد نیست.');
  const components = Array.isArray(req.body.components) ? req.body.components : row.componentsJson as any[];
  const allowedCategories = ['BASE_SALARY', 'FIXED_BENEFIT', 'VARIABLE_BENEFIT', 'ALLOWANCE', 'OTHER'];
  if (components.some((component: any) => !allowedCategories.includes(component.category))) throw new Error('طبقه‌بندی ساختاریافته همه ردیف‌های جبران خدمات الزامی است.');
  const total = compensationTotalRials(components);
  const updated = await prisma.hrCompensationSnapshot.update({ where: { id: row.id }, data: { componentsJson: components, totalRials: total.toString(), preparedBy: actorId(req) } });
  await audit(req.params.id, 'COMPENSATION_PAYROLL_PREPARED', req, { snapshotId: row.id });
  res.json({ success: true, data: updated });
}));

router.post('/applications/:id/compensation/:snapshotId/hr-approve', requireAuthority('HR_PAYROLL_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } });
  const latest = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== row.id) throw new Error('فقط آخرین نسخه پیشنهاد قابل تأیید است.');
  if (row.applicationId !== req.params.id || !row.preparedBy || row.preparedBy === actorId(req) || row.proposedBy === actorId(req)) throw new Error('نسخه باید توسط پیشنهاددهنده، پردازش‌کننده و مدیران مستقل آماده و تأیید شود.');
  await prisma.hrCompensationSnapshot.update({ where: { id: row.id }, data: { hrApprovedBy: actorId(req), hrApprovedAt: new Date() } });
  await audit(req.params.id, 'COMPENSATION_HR_APPROVED', req, { snapshotId: row.id });
  res.json({ success: true });
}));

router.post('/applications/:id/compensation/:snapshotId/finance-approve', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCompensationSnapshot.findUniqueOrThrow({ where: { id: req.params.snapshotId } });
  const latest = await prisma.hrCompensationSnapshot.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== row.id) throw new Error('فقط آخرین نسخه پیشنهاد قابل تأیید است.');
  if (row.applicationId !== req.params.id || !row.hrApprovedAt) throw new Error('تأیید HR/Payroll هنوز انجام نشده است.');
  if ([row.proposedBy, row.preparedBy, row.hrApprovedBy].includes(actorId(req))) throw new Error('مدیر مالی باید مستقل از پیشنهاددهنده و پردازش‌کنندگان قبلی باشد.');
  await prisma.hrCompensationSnapshot.update({ where: { id: row.id }, data: { financeApprovedBy: actorId(req), financeApprovedAt: new Date() } });
  await audit(req.params.id, 'COMPENSATION_FINANCE_APPROVED', req, { snapshotId: row.id });
  res.json({ success: true });
}));

router.post('/applications/:id/assessments', requireAuthority('HR_PROCESSOR'), upload.single('file'), asyncHandler(async (req: AuthRequest, res: Response) => {
  try {
    const resultJson = typeof req.body.resultJson === 'string' ? JSON.parse(req.body.resultJson) : req.body.resultJson;
    if (!resultJson || !['DISC', 'BIG_FIVE', 'EQ', 'OTHER'].includes(req.body.assessmentType)) throw new Error('نوع و نتیجه ارزیابی الزامی است.');
    if (req.file) validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = req.file ? await scanHiringFile(req.file.path) : undefined;
    const digest = req.file ? await sha256File(req.file.path) : undefined;
    const row = await prisma.hrCandidateAssessment.create({ data: {
      applicationId: req.params.id, assessmentType: req.body.assessmentType, resultJson,
      storageName: req.file?.filename, originalName: req.file?.originalname, mimeType: req.file?.mimetype,
      size: req.file?.size, sha256: digest, malwareScanStatus: scanStatus, recordedBy: actorId(req)
    }});
    await audit(req.params.id, 'CANDIDATE_ASSESSMENT_RECORDED', req, { assessmentId: row.id, assessmentType: row.assessmentType });
    res.status(201).json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file?.path); throw error; }
}));

router.get('/applications/:id/assessments/:assessmentId/download', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrCandidateAssessment.findFirst({ where: { id: req.params.assessmentId, applicationId: req.params.id } });
  if (!row?.storageName || !row.originalName) return res.status(404).json({ success: false, error: 'فایل ارزیابی پیدا نشد.' });
  await audit(req.params.id, 'CANDIDATE_ASSESSMENT_DOWNLOADED', req, { assessmentId: row.id });
  res.download(safeHiringStoragePath(row.storageName), row.originalName);
}));

router.post('/applications/:id/collateral/apply-template', requireAuthority('FINANCE_RECORDER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const [application, template, existing] = await Promise.all([
    prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id }, include: { position: true } }),
    prisma.hrCollateralChecklistTemplate.findUniqueOrThrow({ where: { id: req.body.templateId }, include: { items: { orderBy: { sortOrder: 'asc' } } } }),
    prisma.hrCollateralItem.count({ where: { applicationId: req.params.id } })
  ]);
  if (!application.acceptedOfferAt) throw new Error('چک‌لیست وثیقه فقط پس از پذیرش پیشنهاد قابل اعمال است.');
  if (!template.isActive || existing) throw new Error('قالب فعال نیست یا چک‌لیست پرونده قبلاً ساخته شده است.');
  if ((template.scopeType === 'POSITION' && template.scopeId !== application.positionId) || (template.scopeType === 'JOB' && template.scopeId !== application.position.jobId)) throw new Error('قالب برای شغل یا جایگاه این پرونده قابل اعمال نیست.');
  await prisma.$transaction([
    prisma.hrJobApplication.update({ where: { id: application.id }, data: { collateralTemplateId: template.id, collateralClearance: 'IN_PROGRESS' } }),
    prisma.hrCollateralItem.createMany({ data: template.items.map((item) => ({ applicationId: application.id, templateItemId: item.id, type: item.type, required: item.required, amountRials: item.defaultAmountRials, status: 'MISSING', recordedBy: actorId(req) })) })
  ]);
  await audit(req.params.id, 'COLLATERAL_TEMPLATE_APPLIED', req, { templateId: template.id, version: template.version });
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
  if (application.convertedAt) return res.status(409).json({ success: false, error: 'این پرونده قبلاً به Personnel تبدیل شده است.' });
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
    await tx.hrInsuranceEnrollment.upsert({ where: { applicationId: application.id }, create: { applicationId: application.id, status: 'NOT_STARTED', dueDate: req.body.insuranceDueDate ? parseDate(req.body.insuranceDueDate, 'مهلت بیمه') : null, updatedBy: actorId(req) }, update: { dueDate: req.body.insuranceDueDate ? parseDate(req.body.insuranceDueDate, 'مهلت بیمه') : undefined, updatedBy: actorId(req) } });
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
    if (!String(req.body.contractNumber || '').trim()) throw new Error('شماره قرارداد الزامی است.');
    const effectiveFrom = parseDate(req.body.effectiveFrom, 'تاریخ شروع قرارداد');
    const effectiveTo = req.body.effectiveTo ? parseDate(req.body.effectiveTo, 'تاریخ پایان قرارداد') : null;
    if (effectiveTo && effectiveTo < effectiveFrom) throw new Error('تاریخ پایان قرارداد نمی‌تواند پیش از شروع باشد.');
    validateHiringFileSignature(req.file.path, req.file.mimetype);
    const scanStatus = await scanHiringFile(req.file.path); const digest = await sha256File(req.file.path);
    const aggregate = await prisma.hrEmploymentContractDocument.aggregate({ where: { applicationId: req.params.id }, _max: { version: true } });
    const row = await prisma.hrEmploymentContractDocument.create({ data: {
      applicationId: req.params.id, version: (aggregate._max.version || 0) + 1, contractNumber: req.body.contractNumber,
      effectiveFrom, effectiveTo,
      storageName: req.file.filename, originalName: req.file.originalname, mimeType: req.file.mimetype, size: req.file.size,
      sha256: digest, malwareScanStatus: scanStatus, uploadedBy: actorId(req), note: req.body.note || null
    }});
    await prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { contractClearance: 'IN_PROGRESS' } });
    res.status(201).json({ success: true, data: row });
  } catch (error) { removeHiringFile(req.file.path); throw error; }
}));

router.post('/applications/:id/contracts/:contractId/approve', requireAuthority('FINANCE_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const contract = await prisma.hrEmploymentContractDocument.findUniqueOrThrow({ where: { id: req.params.contractId } });
  const latest = await prisma.hrEmploymentContractDocument.findFirst({ where: { applicationId: req.params.id }, orderBy: { version: 'desc' }, select: { id: true } });
  if (latest?.id !== contract.id) throw new Error('فقط آخرین نسخه قرارداد قابل تأیید است.');
  if (contract.applicationId !== req.params.id || contract.uploadedBy === actorId(req)) throw new Error('مدیر مالی بارگذار نمی‌تواند همان قرارداد را تأیید کند.');
  await prisma.$transaction([
    prisma.hrEmploymentContractDocument.update({ where: { id: contract.id }, data: { approvedBy: actorId(req), approvedAt: new Date() } }),
    prisma.hrJobApplication.update({ where: { id: req.params.id }, data: { contractClearance: 'APPROVED' } }),
    prisma.hrOnboardingTask.updateMany({ where: { applicationId: req.params.id, title: 'تأیید قرارداد امضاشده' }, data: { status: 'COMPLETE', completedBy: actorId(req), completedAt: new Date() } })
  ]);
  await audit(req.params.id, 'SIGNED_CONTRACT_APPROVED', req, { contractId: contract.id });
  res.json({ success: true });
}));

router.get('/applications/:id/contracts/:contractId/download', requireAuthority('FINANCE_RECORDER', 'FINANCE_MANAGER', 'HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrEmploymentContractDocument.findFirst({ where: { id: req.params.contractId, applicationId: req.params.id } });
  if (!row) return res.status(404).json({ success: false, error: 'قرارداد پیدا نشد.' });
  await audit(req.params.id, 'SIGNED_CONTRACT_DOWNLOADED', req, { contractId: row.id });
  res.download(safeHiringStoragePath(row.storageName), row.originalName);
}));

router.post('/applications/:id/payroll-participation', requireAuthority('HR_PAYROLL_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  const application = await prisma.hrJobApplication.findUniqueOrThrow({ where: { id: req.params.id } });
  if (!application.convertedAt) throw new Error('مشارکت حقوق پس از تبدیل به پرسنل برنامه‌ریزی‌شده تنظیم می‌شود.');
  const row = await prisma.hrPayrollParticipation.upsert({
    where: { applicationId: req.params.id },
    create: { applicationId: req.params.id, effectiveFrom: parseDate(req.body.effectiveFrom, 'تاریخ شروع حقوق'), configuredBy: actorId(req) },
    update: { effectiveFrom: parseDate(req.body.effectiveFrom, 'تاریخ شروع حقوق'), configuredBy: actorId(req), configuredAt: new Date() }
  });
  await prisma.hrOnboardingTask.updateMany({ where: { applicationId: req.params.id, title: 'تنظیم مشارکت حقوق و دستمزد' }, data: { status: 'COMPLETE', completedBy: actorId(req), completedAt: new Date() } });
  res.json({ success: true, data: row });
}));

router.put('/applications/:id/insurance', requireAuthority('HR_PROCESSOR', 'HR_MANAGER'), asyncHandler(async (req: AuthRequest, res: Response) => {
  if (!['NOT_STARTED', 'IN_PROGRESS', 'ACTIVE', 'EXEMPT'].includes(req.body.status)) throw new Error('وضعیت بیمه نامعتبر است.');
  if (req.body.status === 'ACTIVE' && !req.body.effectiveDate) throw new Error('تاریخ شروع بیمه فعال الزامی است.');
  const row = await prisma.hrInsuranceEnrollment.upsert({
    where: { applicationId: req.params.id },
    create: { applicationId: req.params.id, status: req.body.status, effectiveDate: req.body.effectiveDate ? parseDate(req.body.effectiveDate, 'تاریخ بیمه') : null, dueDate: req.body.dueDate ? parseDate(req.body.dueDate, 'مهلت بیمه') : null, note: req.body.note || null, updatedBy: actorId(req) },
    update: { status: req.body.status, effectiveDate: req.body.effectiveDate ? parseDate(req.body.effectiveDate, 'تاریخ بیمه') : null, dueDate: req.body.dueDate ? parseDate(req.body.dueDate, 'مهلت بیمه') : null, note: req.body.note || null, updatedBy: actorId(req) }
  });
  if (['ACTIVE', 'EXEMPT'].includes(row.status)) await prisma.hrOnboardingTask.updateMany({ where: { applicationId: req.params.id, title: 'پیگیری ثبت بیمه' }, data: { status: 'COMPLETE', completedBy: actorId(req), completedAt: new Date() } });
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
  const assigned = await prisma.hrHiringAuthority.findFirst({ where: { userId: actorId(req), authority: task.ownerAuthority, isActive: true } });
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
    await tx.hrJobApplication.update({ where: { id: application.id }, data: { stage: 'CLOSED', outcome: req.body.outcome, outcomeReason: req.body.reason } });
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
