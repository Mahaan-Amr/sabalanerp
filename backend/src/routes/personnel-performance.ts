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
import { reproduceAcceptedPerformanceResult } from '../services/personnelPerformanceResultStore';
import { PerformancePolicyKind, PerformanceTemplateKind } from '@prisma/client';

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
