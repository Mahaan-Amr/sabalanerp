import express, { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma';
import { AuthRequest, protect } from '../middleware/auth';
import { requireHrFeature } from '../middleware/hrAuthorization';
import { activeHrActionPermissionsForUser, authorizeHrUser } from '../services/hrAuthorizationService';
import {
  ApplicantInformationGroup,
  buildCandidateClosedState,
  projectApplicantClosureSummary,
  projectApplicantFullInformation,
  validateApplicantReturnContext,
} from '../services/hrApplicantExperience';
import { buildHiringDocumentIndex } from '../services/hrHiringDocumentIndex';

const router = express.Router();
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

const informationGroupsForActionPermissions = (permissions: ReadonlySet<string>) => {
  const groups = new Set<ApplicantInformationGroup>(['CASE_SUMMARY']);
  if (permissions.has('VIEW_FULL_APPLICANT_INFORMATION')) {
    groups.add('IDENTITY_CONTACT');
    groups.add('DOCUMENTS_FILES');
    groups.add('EDUCATION_SKILLS_LANGUAGES');
    groups.add('WORK_HISTORY');
    groups.add('APPLICATION_ANSWERS');
  }
  if (permissions.has('VIEW_INITIAL_INTERVIEW_REPORT') || permissions.has('VIEW_COMPANY_EVALUATION_RESULTS')) {
    groups.add('EDUCATION_SKILLS_LANGUAGES');
    groups.add('WORK_HISTORY');
    groups.add('APPLICATION_ANSWERS');
  }
  if (permissions.has('VIEW_COMPANY_EVALUATION_RESULTS')) {
    groups.add('DOCUMENTS_FILES');
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
  const actionPermissions = new Set(await activeHrActionPermissionsForUser(prisma, req.user!.id));
  const canViewContact = actionPermissions.has('VIEW_FULL_APPLICANT_INFORMATION');
  const permittedGroups = informationGroupsForActionPermissions(actionPermissions);
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
      informationGroups: (['CASE_SUMMARY', 'IDENTITY_CONTACT', 'EDUCATION_SKILLS_LANGUAGES', 'WORK_HISTORY', 'APPLICATION_ANSWERS', 'DOCUMENTS_FILES'] as ApplicantInformationGroup[])
        .map((key) => ({ key, status: permittedGroups.has(key) ? 'AVAILABLE' : 'RESTRICTED' })),
      counts: row._count,
      returnHref: validateApplicantReturnContext(req.query.returnTo, row.id),
    },
  });
}));

router.get('/applications/:id/full-information', ...requireRecruitmentView, asyncHandler(async (req: AuthRequest, res: Response) => {
  const actionPermissions = new Set(await activeHrActionPermissionsForUser(prisma, req.user!.id));
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
      contracts: { orderBy: { version: 'desc' } },
      collateralItems: {
        orderBy: { createdAt: 'desc' },
        include: { returns: { orderBy: { version: 'desc' } } },
      },
    },
  });
  if (!row) return res.status(404).json({ success: false, error: 'پرونده متقاضی پیدا نشد.' });
  const permittedGroups = informationGroupsForActionPermissions(actionPermissions);
  return res.json({ success: true, data: {
    ...projectApplicantFullInformation(row, permittedGroups),
    documentIndex: permittedGroups.has('DOCUMENTS_FILES') ? buildHiringDocumentIndex(row, actionPermissions) : [],
  } });
}));

router.get('/applications/:id/closure-summary', ...requireRecruitmentView, asyncHandler(async (req: AuthRequest, res: Response) => {
  const row = await prisma.hrJobApplication.findUnique({
    where: { id: req.params.id },
    select: {
      stage: true,
      outcome: true,
      outcomeReason: true,
      preClosureStage: true,
      scheduledStartDate: true,
      activatedAt: true,
      activatedBy: true,
      employmentRelationship: {
        select: {
          status: true,
          effectiveFrom: true,
          personnel: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      audits: {
        where: { eventType: { in: ['APPLICATION_CLOSED', 'ASSESSMENT_DECISION_RECORDED', 'HIRE_CONVERTED'] } },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { eventType: true, actorUserId: true, createdAt: true, payloadJson: true },
      },
    },
  });
  if (!row) return res.status(404).json({ success: false, error: 'پرونده متقاضی پیدا نشد.' });
  const closureAudit = row.audits.find((event) => {
    if (event.eventType === 'APPLICATION_CLOSED') return true;
    if (event.eventType === 'HIRE_CONVERTED' && row.outcome === 'HIRED') return true;
    const payload = event.payloadJson as Record<string, unknown> | null;
    return payload?.decision === 'REJECTED';
  }) || null;
  const [actionPermissions, actor, activationActor, personnelAccess] = await Promise.all([
    activeHrActionPermissionsForUser(prisma, req.user!.id),
    closureAudit?.actorUserId
      ? prisma.user.findUnique({ where: { id: closureAudit.actorUserId }, select: { firstName: true, lastName: true, username: true } })
      : null,
    row.activatedBy
      ? prisma.user.findUnique({ where: { id: row.activatedBy }, select: { firstName: true, lastName: true, username: true } })
      : null,
    authorizeHrUser(prisma, req.user!.id, {
      workspaceLevel: 'VIEW', feature: { code: 'PERSONNEL', level: 'VIEW' },
    }),
  ]);
  const permissionSet = new Set(actionPermissions);
  const actorDisplayName = actor ? `${actor.firstName} ${actor.lastName}`.trim() || actor.username : null;
  const activationActorDisplayName = activationActor
    ? `${activationActor.firstName} ${activationActor.lastName}`.trim() || activationActor.username
    : null;
  return res.json({
    success: true,
    data: projectApplicantClosureSummary(row, closureAudit, {
      canViewExplanation: permissionSet.has('VIEW_INITIAL_INTERVIEW_REPORT') || permissionSet.has('VIEW_COMPANY_EVALUATION_RESULTS'),
      actorDisplayName,
      activationActorDisplayName,
      canViewPersonnel: personnelAccess.allowed,
    }),
  });
}));

router.use((error: any, _req: express.Request, res: Response, _next: NextFunction) => {
  console.error('HR Applicant experience route error:', error);
  res.status(400).json({ success: false, error: error?.message || 'نمایش پرونده متقاضی ناموفق بود.' });
});

export default router;
