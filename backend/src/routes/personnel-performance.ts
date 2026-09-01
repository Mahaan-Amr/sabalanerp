import express from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from '../middleware/auth';
import { requireHrAuthorization } from '../middleware/hrAuthorization';
import { requirePersonnelPerformanceWriteGate } from '../middleware/personnelPerformanceRollout';
import { PERFORMANCE_ACTION_PERMISSION_CODES } from '../services/hrActionPermissionCatalog';
import { activeHrActionPermissionsForUser } from '../services/hrAuthorizationService';
import {
  activateDuePerformanceArtifacts,
  activateDuePerformancePolicies,
  cancelScheduledPerformanceVersion,
  createPerformanceCriterionDraft,
  createPerformancePolicyDraft,
  createPerformanceTemplateDraft,
  listPerformanceCriteria,
  listPerformancePolicies,
  listPerformanceTemplates,
  previewPerformancePolicy,
  retirePerformanceArtifactVersion,
  schedulePerformanceCriterion,
  schedulePerformancePolicy,
  schedulePerformanceTemplate,
  updatePerformanceCriterionDraft,
  updatePerformancePolicyDraft,
  updatePerformanceTemplateDraft,
} from '../services/personnelPerformancePolicyStore';
import { reproduceAcceptedPerformanceResult, suspendAcceptedPerformanceResult } from '../services/personnelPerformanceResultStore';
import { PerformancePolicyKind, PerformanceReviewDecision, PerformanceTemplateKind } from '@prisma/client';
import {
  reconstructPerformanceReadiness,
  retryFailedPerformanceReadinessRecords,
} from '../services/personnelPerformanceReadinessStore';
import {
  cancelPerformanceEvaluation,
  claimPerformanceReview,
  decidePerformanceReview,
  extendPerformanceSectionDeadline,
  getPerformanceReviewSubmission,
  getSupervisorPerformanceSection,
  invalidatePerformanceEvaluation,
  listPerformanceReviewQueue,
  listPerformanceLifecycleSections,
  listSupervisorPerformanceSections,
  markPerformanceSectionNotEvaluable,
  runPerformanceReminders,
  saveSupervisorPerformanceDraft,
  submitSupervisorPerformanceSection,
} from '../services/personnelPerformanceWorkflowStore';
import {
  claimPerformanceExportDownload,
  completePerformanceExportDownload,
  createPerformanceConsequenceHandoff,
  createPerformanceCorrection,
  getEvaluatorCalibration,
  getPerformanceAnalytics,
  getPerformanceConsequenceHandoff,
  getPerformanceExport,
  getPerformanceHistory,
  listPerformanceEvaluators,
  listEligibleConsequenceResults,
  getPersonalPerformanceBadge,
  getPersonnelPerformanceBadges,
  requestPerformanceExport,
} from '../services/personnelPerformanceDisclosureStore';

const router = express.Router();
const performancePermissionCodes = new Set<string>(PERFORMANCE_ACTION_PERMISSION_CODES);

export const projectPersonnelPerformanceCapabilities = (featureCodes: readonly string[]) => Object.fromEntries(
  featureCodes
    .filter((code) => performancePermissionCodes.has(code))
    .map((code) => [code, true]),
);

router.get('/capabilities', async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'نشست شما معتبر نیست.' });
    const permissions = await activeHrActionPermissionsForUser(prisma, req.user.id);
    return res.json({ success: true, capabilities: projectPersonnelPerformanceCapabilities(permissions) });
  } catch (error) {
    next(error);
  }
});

router.get('/rollout', requireHrAuthorization({ actionPermissionCodes: ['MANAGE_PERFORMANCE_ROLLOUT'] }), async (_req, res, next) => {
  try {
    const now = new Date();
    const phase = await prisma.performanceFeaturePhaseVersion.findFirst({
      where: { effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      select: {
        id: true,
        version: true,
        phase: true,
        releaseEnabled: true,
        cohortVersionId: true,
        effectiveFrom: true,
      },
    });
    const pause = phase ? await prisma.performanceSafetyPause.findFirst({
      where: {
        phaseVersionId: phase.id,
        status: 'ACTIVE',
      },
      select: { scope: true, startedAt: true, reasonCode: true },
      orderBy: { startedAt: 'desc' },
    }) : null;
    if (!phase) return res.json({ success: true, rollout: null });
    const { id: _phaseId, ...publicPhase } = phase;
    return res.json({ success: true, rollout: { ...publicPhase, paused: Boolean(pause), pause } });
  } catch (error) {
    next(error);
  }
});

const subjectIdForSection = async (req: AuthRequest) => {
  const section = await prisma.performanceEvaluationSection.findUnique({ where: { id: req.params.sectionId }, select: { evaluationId: true } });
  if (!section) return undefined;
  return (await prisma.performanceEvaluation.findUnique({ where: { id: section.evaluationId }, select: { subjectId: true } }))?.subjectId;
};

const subjectIdForSubmission = async (req: AuthRequest) => {
  const submission = await prisma.performanceSubmission.findUnique({ where: { id: req.params.submissionId }, select: { sectionId: true } });
  if (!submission) return undefined;
  const section = await prisma.performanceEvaluationSection.findUnique({ where: { id: submission.sectionId }, select: { evaluationId: true } });
  return section ? (await prisma.performanceEvaluation.findUnique({ where: { id: section.evaluationId }, select: { subjectId: true } }))?.subjectId : undefined;
};

const subjectIdForEvaluation = async (req: AuthRequest) => (
  await prisma.performanceEvaluation.findUnique({ where: { id: req.params.evaluationId }, select: { subjectId: true } })
)?.subjectId;

const manageReadiness = requireHrAuthorization({ actionPermissionCodes: ['MANAGE_PERFORMANCE_CYCLE'] });
const manageLifecycle = requireHrAuthorization({ actionPermissionCodes: ['MANAGE_PERFORMANCE_CYCLE'] });
const submitPerformance = requireHrAuthorization({ actionPermissionCodes: ['SUBMIT_PERFORMANCE_EVALUATION'] });
const reviewPerformance = requireHrAuthorization({ actionPermissionCodes: ['REVIEW_PERFORMANCE_EVALUATION'] });
const pausePerformance = requireHrAuthorization({ actionPermissionCodes: ['PAUSE_PERFORMANCE_EVALUATION'] });
const lifecycleAccess = requireHrAuthorization({ actionPermissionCodes: ['MANAGE_PERFORMANCE_CYCLE', 'REVIEW_PERFORMANCE_EVALUATION', 'PAUSE_PERFORMANCE_EVALUATION'] });

router.post('/readiness/reconstruct', manageReadiness, requirePersonnelPerformanceWriteGate('RECONSTRUCT_READINESS'), async (req: AuthRequest, res, next) => {
  try {
    const result = await reconstructPerformanceReadiness(prisma, {
      idempotencyKey: String(req.header('x-idempotency-key') ?? ''),
      measurementFrom: new Date(req.body.measurementFrom), measurementTo: new Date(req.body.measurementTo),
      actorUserId: req.user!.id, batchSize: Number(req.body.batchSize || 100),
    });
    return res.status(result.run.status === 'COMPLETED' ? 200 : 202).json({ success: true, ...result });
  } catch (error) { return next(error); }
});

router.get('/readiness/:runId', manageReadiness, async (req, res, next) => {
  try {
    const run = await prisma.performanceReadinessRun.findUnique({ where: { id: req.params.runId } });
    if (!run) return res.status(404).json({ success: false, message: 'اجرای بازسازی آمادگی پیدا نشد.' });
    const records = await prisma.performanceReadinessRecord.findMany({
      where: { runId: run.id }, orderBy: { employmentAssignmentId: 'asc' },
      select: { employmentAssignmentId: true, status: true, blockerCode: true, attemptCount: true, lastErrorCode: true, processedAt: true },
    });
    return res.json({ success: true, run, records });
  } catch (error) { return next(error); }
});

router.post('/readiness/:runId/retry', manageReadiness, requirePersonnelPerformanceWriteGate('RECONSTRUCT_READINESS'), async (req: AuthRequest, res, next) => {
  try {
    return res.json({ success: true, ...(await retryFailedPerformanceReadinessRecords(prisma, {
      runId: req.params.runId, actorUserId: req.user!.id, batchSize: Number(req.body.batchSize || 100),
    })) });
  } catch (error) { return next(error); }
});

router.get('/supervisor/sections', submitPerformance, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, sections: await listSupervisorPerformanceSections(prisma, req.user!.id) }); }
  catch (error) { return next(error); }
});

router.get('/supervisor/sections/:sectionId', submitPerformance, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, ...(await getSupervisorPerformanceSection(prisma, { sectionId: req.params.sectionId, userId: req.user!.id })) }); }
  catch (error) { return next(error); }
});

router.put('/supervisor/sections/:sectionId/draft', submitPerformance, requirePersonnelPerformanceWriteGate('SAVE_SUPERVISOR_DRAFT', subjectIdForSection), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, draft: await saveSupervisorPerformanceDraft(prisma, { sectionId: req.params.sectionId, userId: req.user!.id, payload: req.body }) }); }
  catch (error) { return next(error); }
});

router.post('/supervisor/sections/:sectionId/submit', submitPerformance, requirePersonnelPerformanceWriteGate('SUBMIT_SUPERVISOR_EVALUATION', subjectIdForSection), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, ...(await submitSupervisorPerformanceSection(prisma, {
    sectionId: req.params.sectionId, userId: req.user!.id, idempotencyKey: String(req.header('x-idempotency-key') ?? ''),
  })) }); }
  catch (error) { return next(error); }
});

router.get('/reviews', reviewPerformance, async (_req, res, next) => {
  try { return res.json({ success: true, reviews: await listPerformanceReviewQueue(prisma) }); }
  catch (error) { return next(error); }
});

router.get('/lifecycle/sections', lifecycleAccess, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, sections: await listPerformanceLifecycleSections(prisma, { actorUserId: req.user!.id }) }); }
  catch (error) { return next(error); }
});

router.get('/reviews/:submissionId', reviewPerformance, async (req, res, next) => {
  try { return res.json({ success: true, ...(await getPerformanceReviewSubmission(prisma, { submissionId: req.params.submissionId })) }); }
  catch (error) { return next(error); }
});

router.post('/reviews/:submissionId/claim', reviewPerformance, requirePersonnelPerformanceWriteGate('DECIDE_HR_REVIEW', subjectIdForSubmission), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, claim: await claimPerformanceReview(prisma, { submissionId: req.params.submissionId, reviewerUserId: req.user!.id }) }); }
  catch (error) { return next(error); }
});

router.post('/reviews/:submissionId/decision', reviewPerformance, requirePersonnelPerformanceWriteGate('DECIDE_HR_REVIEW', subjectIdForSubmission), async (req: AuthRequest, res, next) => {
  try {
    if (!Object.values(PerformanceReviewDecision).includes(req.body.decision)) return res.status(422).json({ success: false, message: 'تصمیم بررسی معتبر نیست.' });
    return res.json({ success: true, ...(await decidePerformanceReview(prisma, {
      submissionId: req.params.submissionId, reviewerUserId: req.user!.id, decision: req.body.decision,
      reason: String(req.body.reason ?? ''), idempotencyKey: String(req.header('x-idempotency-key') ?? ''),
      reasonCategory: req.body.reasonCategory ? String(req.body.reasonCategory) : undefined,
      criterionVersionId: req.body.criterionVersionId ? String(req.body.criterionVersionId) : undefined,
      evidenceReferenceId: req.body.evidenceReferenceId ? String(req.body.evidenceReferenceId) : undefined,
    })) });
  } catch (error) { return next(error); }
});

router.post('/sections/:sectionId/not-evaluable', reviewPerformance, requirePersonnelPerformanceWriteGate('DECIDE_HR_REVIEW', subjectIdForSection), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, ...(await markPerformanceSectionNotEvaluable(prisma, {
    sectionId: req.params.sectionId, reviewerUserId: req.user!.id,
    reasonCategory: String(req.body.reasonCategory ?? ''), reason: String(req.body.reason ?? ''),
    idempotencyKey: String(req.header('x-idempotency-key') ?? ''),
  })) }); }
  catch (error) { return next(error); }
});

router.post('/sections/:sectionId/extend', manageLifecycle, requirePersonnelPerformanceWriteGate('MANAGE_PERFORMANCE_CYCLE', subjectIdForSection), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, section: await extendPerformanceSectionDeadline(prisma, {
    sectionId: req.params.sectionId, actorUserId: req.user!.id, dueAt: new Date(req.body.dueAt), reason: String(req.body.reason ?? ''),
  }) }); }
  catch (error) { return next(error); }
});

router.post('/evaluations/:evaluationId/cancel', manageLifecycle, requirePersonnelPerformanceWriteGate('MANAGE_PERFORMANCE_CYCLE', subjectIdForEvaluation), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, evaluation: await cancelPerformanceEvaluation(prisma, { evaluationId: req.params.evaluationId, actorUserId: req.user!.id, reason: String(req.body.reason ?? '') }) }); }
  catch (error) { return next(error); }
});

router.post('/evaluations/:evaluationId/invalidate', pausePerformance, requirePersonnelPerformanceWriteGate('MANAGE_PERFORMANCE_CYCLE', subjectIdForEvaluation), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, evaluation: await invalidatePerformanceEvaluation(prisma, { evaluationId: req.params.evaluationId, actorUserId: req.user!.id, reason: String(req.body.reason ?? '') }) }); }
  catch (error) { return next(error); }
});

router.post('/reminders/run', manageLifecycle, requirePersonnelPerformanceWriteGate('SEND_WORKFLOW_REMINDERS'), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, ...(await runPerformanceReminders(prisma, { actorUserId: req.user!.id })) }); }
  catch (error) { return next(error); }
});

const viewBadgeList = requireHrAuthorization({ actionPermissionCodes: ['VIEW_PERFORMANCE_BADGE_LIST'] });
const viewHistory = requireHrAuthorization({ actionPermissionCodes: ['VIEW_PERFORMANCE_HISTORY'] });
const viewAnalytics = requireHrAuthorization({ actionPermissionCodes: ['VIEW_PERFORMANCE_ANALYTICS'] });
const viewNamedRanking = requireHrAuthorization({ actionPermissionCodes: ['VIEW_NAMED_PERFORMANCE_RANKING'] });
const viewCalibration = requireHrAuthorization({ actionPermissionCodes: ['VIEW_EVALUATOR_CALIBRATION'] });
const requestExport = requireHrAuthorization({ actionPermissionCodes: ['REQUEST_PERFORMANCE_EXPORT'] });
const createConsequence = requireHrAuthorization({ actionPermissionCodes: ['CREATE_PERFORMANCE_CONSEQUENCE_HANDOFF'] });

const subjectIdForResult = async (req: AuthRequest) => {
  const result = await prisma.performanceAcceptedResult.findUnique({ where: { id: req.params.resultId }, select: { evaluationId: true } });
  return result ? (await prisma.performanceEvaluation.findUnique({ where: { id: result.evaluationId }, select: { subjectId: true } }))?.subjectId : undefined;
};

const subjectIdForHandoff = async (req: AuthRequest) => (
  await prisma.performanceSubject.findFirst({
    where: { personnelId: String(req.body.personnelId ?? ''), employmentRelationshipId: String(req.body.employmentRelationshipId ?? ''), identityDetachedAt: null },
    select: { id: true },
  })
)?.id;

router.get('/badge/me', async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'نشست شما معتبر نیست.' });
    return res.json({ success: true, badge: await getPersonalPerformanceBadge(prisma, req.user.id) });
  } catch (error) { return next(error); }
});

router.post('/badges', viewBadgeList, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, badges: await getPersonnelPerformanceBadges(prisma, { actorUserId: req.user!.id, personnelIds: Array.isArray(req.body.personnelIds) ? req.body.personnelIds : [] }) }); }
  catch (error) { return next(error); }
});

router.get('/history/:personnelId', viewHistory, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, history: await getPerformanceHistory(prisma, { actorUserId: req.user!.id, personnelId: req.params.personnelId }) }); }
  catch (error) { return next(error); }
});

router.post('/analytics', viewAnalytics, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, analytics: await getPerformanceAnalytics(prisma, {
    actorUserId: req.user!.id,
    personnelIds: Array.isArray(req.body.personnelIds) ? req.body.personnelIds : undefined,
    reportingFrom: req.body.reportingFrom ? new Date(String(req.body.reportingFrom)) : undefined,
    reportingTo: req.body.reportingTo ? new Date(String(req.body.reportingTo)) : undefined,
  }) }); }
  catch (error) { return next(error); }
});

router.post('/ranking', viewNamedRanking, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, ranking: await getPerformanceAnalytics(prisma, { actorUserId: req.user!.id, personnelIds: Array.isArray(req.body.personnelIds) ? req.body.personnelIds : undefined, mode: 'NAMED_RANKING' }) }); }
  catch (error) { return next(error); }
});

router.get('/calibration/evaluators', viewCalibration, async (_req, res, next) => {
  try { return res.json({ success: true, evaluators: await listPerformanceEvaluators(prisma) }); }
  catch (error) { return next(error); }
});

router.post('/calibration', viewCalibration, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, calibration: await getEvaluatorCalibration(prisma, { actorUserId: req.user!.id, evaluatorPersonnelId: String(req.body.evaluatorPersonnelId ?? '') }) }); }
  catch (error) { return next(error); }
});

router.post('/exports', requestExport, requirePersonnelPerformanceWriteGate('REQUEST_EXPORT'), async (req: AuthRequest, res, next) => {
  try {
    const result = await requestPerformanceExport(prisma, {
      actorUserId: req.user!.id,
      exportKind: req.body.exportKind,
      reportKind: req.body.reportKind,
      personnelIds: Array.isArray(req.body.personnelIds) ? req.body.personnelIds : undefined,
      purpose: String(req.body.purpose ?? ''),
    });
    return res.status(202).json({ success: true, export: {
      id: result.receipt.id,
      exportKind: result.receipt.exportKind,
      status: result.receipt.status,
      requestedAt: result.receipt.requestedAt,
      expiresAt: result.receipt.expiresAt,
    }, downloadToken: result.downloadToken });
  } catch (error) { return next(error); }
});

router.get('/exports/:exportId', requestExport, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, export: await getPerformanceExport(prisma, { exportId: req.params.exportId, actorUserId: req.user!.id }) }); }
  catch (error) { return next(error); }
});

router.get('/exports/:exportId/download', requestExport, async (req: AuthRequest, res, next) => {
  try {
    const artifact = await claimPerformanceExportDownload(prisma, { exportId: req.params.exportId, actorUserId: req.user!.id, token: String(req.query.token ?? '') });
    res.type(artifact.mimeType);
    res.attachment(artifact.filename);
    let finished = false;
    res.once('finish', () => {
      finished = true;
      void completePerformanceExportDownload(prisma, { exportId: req.params.exportId, actorUserId: req.user!.id, delivered: true }).catch(next);
    });
    res.once('close', () => {
      if (!finished) void completePerformanceExportDownload(prisma, { exportId: req.params.exportId, actorUserId: req.user!.id, delivered: false }).catch(next);
    });
    return res.end(artifact.bytes);
  } catch (error) { return next(error); }
});

router.post('/consequence-handoffs', createConsequence, requirePersonnelPerformanceWriteGate('CREATE_CONSEQUENCE_HANDOFF', subjectIdForHandoff), async (req: AuthRequest, res, next) => {
  try { return res.status(201).json({ success: true, handoff: await createPerformanceConsequenceHandoff(prisma, {
    actorUserId: req.user!.id,
    personnelId: String(req.body.personnelId ?? ''),
    employmentRelationshipId: String(req.body.employmentRelationshipId ?? ''),
    consequenceType: String(req.body.consequenceType ?? ''),
    policyCycleKey: String(req.body.policyCycleKey ?? ''),
    resultIds: Array.isArray(req.body.resultIds) ? req.body.resultIds : [],
    reasonCategory: String(req.body.reasonCategory ?? ''),
    reason: String(req.body.reason ?? ''),
    independentEvidenceReferences: Array.isArray(req.body.independentEvidenceReferences) ? req.body.independentEvidenceReferences : [],
  }) }); }
  catch (error) { return next(error); }
});

router.get('/consequence-handoffs/eligible-results/:personnelId', createConsequence, async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, results: await listEligibleConsequenceResults(prisma, {
    personnelId: req.params.personnelId,
    actorUserId: req.user!.id,
    consequenceType: String(req.query.consequenceType ?? ''),
  }) }); }
  catch (error) { return next(error); }
});

router.get('/consequence-handoffs/:handoffId', async (req: AuthRequest, res, next) => {
  if (!req.user) return res.status(401).json({ success: false, message: 'نشست شما معتبر نیست.' });
  try { return res.json({ success: true, ...(await getPerformanceConsequenceHandoff(prisma, { handoffId: req.params.handoffId, actorUserId: req.user!.id })) }); }
  catch (error) { return next(error); }
});

router.post('/results/:resultId/suspend', pausePerformance, requirePersonnelPerformanceWriteGate('PROJECT_CURRENT_LEVEL', subjectIdForResult), async (req: AuthRequest, res, next) => {
  try { return res.json({ success: true, ...(await suspendAcceptedPerformanceResult(prisma, { resultId: req.params.resultId, actorUserId: req.user!.id, reason: String(req.body.reason ?? '') })) }); }
  catch (error) { return next(error); }
});

router.post('/evaluations/:evaluationId/corrections', reviewPerformance, requirePersonnelPerformanceWriteGate('DECIDE_HR_REVIEW', subjectIdForEvaluation), async (req: AuthRequest, res, next) => {
  try { return res.status(201).json({ success: true, correction: await createPerformanceCorrection(prisma, { evaluationId: req.params.evaluationId, actorUserId: req.user!.id, correctionKind: String(req.body.correctionKind ?? ''), reason: String(req.body.reason ?? '') }) }); }
  catch (error) { return next(error); }
});

const managePolicy = requireHrAuthorization({ actionPermissionCodes: ['MANAGE_PERFORMANCE_POLICY'] });
const policyWriteGate = requirePersonnelPerformanceWriteGate('MANAGE_POLICY');

router.get('/criteria', managePolicy, async (_req, res, next) => {
  try {
    return res.json({ success: true, criteria: await listPerformanceCriteria(prisma) });
  } catch (error) { return next(error); }
});

router.post('/criteria', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    const version = await createPerformanceCriterionDraft(prisma, {
      content: req.body,
      createdByUserId: req.user!.id,
    });
    return res.status(201).json({ success: true, version });
  } catch (error) { return next(error); }
});

router.put('/criteria/:versionId', managePolicy, policyWriteGate, async (req, res, next) => {
  try {
    const version = await updatePerformanceCriterionDraft(prisma, { versionId: req.params.versionId, content: req.body });
    return res.json({ success: true, version });
  } catch (error) { return next(error); }
});

router.post('/criteria/:versionId/schedule', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    const version = await schedulePerformanceCriterion(prisma, {
      versionId: req.params.versionId,
      effectiveFrom: new Date(req.body.effectiveFrom),
      reason: String(req.body.reason ?? ''),
      publishedByUserId: req.user!.id,
    });
    return res.json({ success: true, version });
  } catch (error) { return next(error); }
});

router.get('/templates', managePolicy, async (_req, res, next) => {
  try {
    return res.json({ success: true, templates: await listPerformanceTemplates(prisma) });
  } catch (error) { return next(error); }
});

router.post('/templates', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    if (!Object.values(PerformanceTemplateKind).includes(req.body.templateKind)) {
      return res.status(422).json({ success: false, message: 'نوع الگوی ارزیابی معتبر نیست.' });
    }
    const version = await createPerformanceTemplateDraft(prisma, {
      templateKind: req.body.templateKind,
      ownerType: String(req.body.ownerType ?? ''),
      ownerId: String(req.body.ownerId ?? ''),
      content: req.body.content,
      createdByUserId: req.user!.id,
    });
    return res.status(201).json({ success: true, version });
  } catch (error) { return next(error); }
});

router.put('/templates/:versionId', managePolicy, policyWriteGate, async (req, res, next) => {
  try {
    const version = await updatePerformanceTemplateDraft(prisma, { versionId: req.params.versionId, content: req.body });
    return res.json({ success: true, version });
  } catch (error) { return next(error); }
});

router.post('/templates/:versionId/schedule', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    const version = await schedulePerformanceTemplate(prisma, {
      versionId: req.params.versionId,
      effectiveFrom: new Date(req.body.effectiveFrom),
      reason: String(req.body.reason ?? ''),
      publishedByUserId: req.user!.id,
    });
    return res.json({ success: true, version });
  } catch (error) { return next(error); }
});

router.get('/policies', managePolicy, async (_req, res, next) => {
  try {
    return res.json({ success: true, policies: await listPerformancePolicies(prisma) });
  } catch (error) { return next(error); }
});

router.post('/policies', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    if (!Object.values(PerformancePolicyKind).includes(req.body.policyKind)) {
      return res.status(422).json({ success: false, message: 'نوع سیاست عملکرد معتبر نیست.' });
    }
    const version = await createPerformancePolicyDraft(prisma, {
      policyKind: req.body.policyKind,
      content: req.body.content,
      createdByUserId: req.user!.id,
    });
    return res.status(201).json({ success: true, version });
  } catch (error) { return next(error); }
});

router.put('/policies/:versionId', managePolicy, policyWriteGate, async (req, res, next) => {
  try {
    const version = await updatePerformancePolicyDraft(prisma, { versionId: req.params.versionId, content: req.body });
    return res.json({ success: true, version });
  } catch (error) { return next(error); }
});

router.post('/policies/:versionId/preview', managePolicy, policyWriteGate, async (req, res, next) => {
  try {
    const asOf = req.body.effectiveFrom ? new Date(req.body.effectiveFrom) : undefined;
    return res.json({ success: true, preview: await previewPerformancePolicy(prisma, { versionId: req.params.versionId, asOf }) });
  } catch (error) { return next(error); }
});

router.post('/policies/:versionId/schedule', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    const scheduled = await schedulePerformancePolicy(prisma, {
      versionId: req.params.versionId,
      effectiveFrom: new Date(req.body.effectiveFrom),
      reason: String(req.body.reason ?? ''),
      confirmedByUserId: req.user!.id,
      confirmedPreviewHash: String(req.body.confirmedPreviewHash ?? ''),
      confirmedPopulationHash: String(req.body.confirmedPopulationHash ?? ''),
    });
    return res.json({ success: true, ...scheduled });
  } catch (error) { return next(error); }
});

router.post('/:artifactType/:versionId/cancel', managePolicy, policyWriteGate, async (req, res, next) => {
  try {
    const artifactType = ({ policies: 'policy', criteria: 'criterion', templates: 'template' } as const)[req.params.artifactType as 'policies' | 'criteria' | 'templates'];
    if (!['policy', 'criterion', 'template'].includes(artifactType)) {
      return res.status(404).json({ success: false, message: 'نوع نسخه عملکرد پیدا نشد.' });
    }
    const version = await cancelScheduledPerformanceVersion(prisma, {
      artifactType: artifactType as 'policy' | 'criterion' | 'template',
      versionId: req.params.versionId,
      reason: String(req.body.reason ?? ''),
      actorUserId: (req as AuthRequest).user!.id,
    });
    return res.json({ success: true, version });
  } catch (error) { return next(error); }
});

router.post('/:artifactType/:versionId/retire', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    const artifactType = ({ criteria: 'criterion', templates: 'template' } as const)[req.params.artifactType as 'criteria' | 'templates'];
    if (!artifactType) return res.status(404).json({ success: false, message: 'نوع نسخه عملکرد پیدا نشد.' });
    const version = await retirePerformanceArtifactVersion(prisma, {
      artifactType,
      versionId: req.params.versionId,
      reason: String(req.body.reason ?? ''),
      actorUserId: req.user!.id,
    });
    return res.json({ success: true, version });
  } catch (error) { return next(error); }
});

router.post('/activation/run-due-policies', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    const idempotencyKey = String(req.header('x-idempotency-key') ?? '').trim();
    if (!idempotencyKey) return res.status(422).json({ success: false, message: 'کلید تکرارپذیری عملیات الزامی است.' });
    const activation = await activateDuePerformancePolicies(prisma, { actorUserId: req.user!.id, idempotencyKey });
    return res.json({ success: true, activationScope: 'POLICIES', activation });
  } catch (error) { return next(error); }
});

router.post('/activation/run-due-artifacts', managePolicy, policyWriteGate, async (req: AuthRequest, res, next) => {
  try {
    const idempotencyKey = String(req.header('x-idempotency-key') ?? '').trim();
    if (!idempotencyKey) return res.status(422).json({ success: false, message: 'کلید تکرارپذیری عملیات الزامی است.' });
    const activation = await activateDuePerformanceArtifacts(prisma, { actorUserId: req.user!.id, idempotencyKey });
    return res.json({ success: true, activationScope: 'CRITERIA_AND_TEMPLATES', activation });
  } catch (error) { return next(error); }
});

router.get('/traces/:traceId', requireHrAuthorization({ actionPermissionCodes: ['VIEW_PERFORMANCE_HISTORY'] }), async (req, res, next) => {
  try {
    return res.json({ success: true, explanation: await reproduceAcceptedPerformanceResult(prisma, { traceId: req.params.traceId }) });
  } catch (error) { return next(error); }
});

export default router;
