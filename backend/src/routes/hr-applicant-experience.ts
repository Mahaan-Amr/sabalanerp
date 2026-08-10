import express, { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { AuthRequest, protect } from '../middleware/auth';
import { requireHrFeature } from '../middleware/hrAuthorization';
import { activeHrAuthoritiesForUser } from '../services/hrAuthorizationService';
import {
  ApplicantInformationGroup,
  buildCandidateClosedState,
  projectApplicantClosureSummary,
  projectApplicantFullInformation,
  validateApplicantReturnContext,
} from '../services/hrApplicantExperience';

const router = express.Router();
const prisma = new PrismaClient();

const asyncHandler = (handler: (req: any, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: any, res: Response, next: NextFunction) => handler(req, res, next).catch(next);

router.get('/public/application/closed-state', asyncHandler(async (req: express.Request, res: Response) => {
  const token = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : '';
  let payload: any;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET || 'development-secret');
  } catch {
    return res.status(401).json({ success: false, error: 'نشست متقاضی معتبر نیست.' });
  }
  if (payload.kind !== 'HR_APPLICANT') return res.status(401).json({ success: false, error: 'نشست متقاضی معتبر نیست.' });
  const invitation = await prisma.hrCandidateInvitation.findUnique({
    where: { id: payload.invitationId },
    select: {
      applicationId: true,
      application: {
        select: {
          stage: true,
          outcome: true,
          position: { select: { title: true } },
        },
      },
    },
  });
  if (!invitation || invitation.applicationId !== payload.applicationId || invitation.application.stage !== 'CLOSED') {
    return res.status(401).json({ success: false, error: 'نشست متقاضی معتبر نیست.' });
  }
  return res.json({ success: true, data: buildCandidateClosedState(invitation.application) });
}));

const requireRecruitmentView = [protect, requireHrFeature('RECRUITMENT_CASES', 'VIEW')] as const;

const informationGroupsFor = (authorities: ReadonlySet<string>) => {
  const groups = new Set<ApplicantInformationGroup>();
  if (authorities.has('HR_PROCESSOR') || authorities.has('HR_MANAGER')) {
    groups.add('PROFILE_IDENTITY');
    groups.add('EXPERIENCE_QUALIFICATIONS');
    groups.add('APPLICATION_ANSWERS');
    groups.add('DOCUMENT_EVIDENCE');
  } else if (authorities.has('COMPANY_MANAGER')) {
    groups.add('EXPERIENCE_QUALIFICATIONS');
    groups.add('APPLICATION_ANSWERS');
  }
  return groups;
};

router.get('/applications/:id/overview', ...requireRecruitmentView, asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrJobApplication.findUnique({
    where: { id: req.params.id },
    select: {
      id: true,
      stage: true,
      outcome: true,
      disposition: true,
      archivedAt: true,
      updatedAt: true,
      candidate: { select: { firstName: true, lastName: true, mobile: true } },
      position: { select: { title: true, job: { select: { title: true } } } },
      _count: { select: { formRevisions: true, documents: true, assessments: true } },
    },
  });
  if (!row) return res.status(404).json({ success: false, error: 'پرونده متقاضی پیدا نشد.' });
  const authorities = new Set(await activeHrAuthoritiesForUser(prisma, req.user!.id));
  const canViewContact = authorities.has('HR_PROCESSOR') || authorities.has('HR_MANAGER');
  const permittedGroups = informationGroupsFor(authorities);
  return res.json({
    success: true,
    data: {
      id: row.id,
      candidateName: `${row.candidate.firstName} ${row.candidate.lastName}`.trim(),
      contact: canViewContact ? { mobile: row.candidate.mobile } : { restricted: true },
      position: row.position,
      stage: row.stage,
      outcome: row.outcome,
      disposition: row.disposition,
      archivedAt: row.archivedAt,
      updatedAt: row.updatedAt,
      informationGroups: (['PROFILE_IDENTITY', 'EXPERIENCE_QUALIFICATIONS', 'APPLICATION_ANSWERS', 'DOCUMENT_EVIDENCE'] as ApplicantInformationGroup[])
        .map((key) => ({ key, status: permittedGroups.has(key) ? 'AVAILABLE' : 'RESTRICTED' })),
      counts: row._count,
      returnHref: validateApplicantReturnContext(req.query.returnTo, row.id),
    },
  });
}));

router.get('/applications/:id/full-information', ...requireRecruitmentView, asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrJobApplication.findUnique({
    where: { id: req.params.id },
    include: {
      candidate: true,
      position: { select: { title: true, job: { select: { title: true } } } },
      formRevisions: { orderBy: { revisionNumber: 'desc' } },
      documents: { orderBy: [{ category: 'asc' }, { customTitle: 'asc' }, { version: 'desc' }] },
      identityChecks: { orderBy: { fieldKey: 'asc' } },
      assessments: { orderBy: { recordedAt: 'desc' } },
      preIdentityChecklistItems: { orderBy: { createdAt: 'asc' } },
    },
  });
  if (!row) return res.status(404).json({ success: false, error: 'پرونده متقاضی پیدا نشد.' });
  const authorities = new Set(await activeHrAuthoritiesForUser(prisma, req.user!.id));
  return res.json({ success: true, data: projectApplicantFullInformation(row, informationGroupsFor(authorities)) });
}));

router.get('/applications/:id/closure-summary', ...requireRecruitmentView, asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrJobApplication.findUnique({
    where: { id: req.params.id },
    select: {
      stage: true,
      outcome: true,
      outcomeReason: true,
      preClosureStage: true,
      audits: {
        where: { eventType: { in: ['APPLICATION_CLOSED', 'ASSESSMENT_DECISION_RECORDED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { eventType: true, actorUserId: true, createdAt: true, payloadJson: true },
      },
    },
  });
  if (!row) return res.status(404).json({ success: false, error: 'پرونده متقاضی پیدا نشد.' });
  const closureAudit = row.audits.find((event) => {
    if (event.eventType === 'APPLICATION_CLOSED') return true;
    const payload = event.payloadJson as Record<string, unknown> | null;
    return payload?.decision === 'REJECTED';
  }) || null;
  const [authorities, actor] = await Promise.all([
    activeHrAuthoritiesForUser(prisma, req.user!.id),
    closureAudit?.actorUserId
      ? prisma.user.findUnique({ where: { id: closureAudit.actorUserId }, select: { firstName: true, lastName: true, username: true } })
      : null,
  ]);
  const authoritySet = new Set(authorities);
  const actorDisplayName = actor ? `${actor.firstName} ${actor.lastName}`.trim() || actor.username : null;
  return res.json({
    success: true,
    data: projectApplicantClosureSummary(row, closureAudit, {
      canViewExplanation: authoritySet.has('HR_MANAGER') || authoritySet.has('COMPANY_MANAGER'),
      actorDisplayName,
    }),
  });
}));

router.use((error: any, _req: express.Request, res: Response, _next: NextFunction) => {
  console.error('HR Applicant experience route error:', error);
  res.status(400).json({ success: false, error: error?.message || 'نمایش پرونده متقاضی ناموفق بود.' });
});

export default router;
