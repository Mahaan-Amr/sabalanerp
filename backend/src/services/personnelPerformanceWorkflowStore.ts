import { randomUUID } from 'node:crypto';
import {
  PerformanceResultStatus,
  PerformanceReviewDecision,
  Prisma,
  type PrismaClient,
} from '@prisma/client';
import type {
  PerformanceCriterionResponse,
  PerformanceEvaluationInput,
  PerformanceTemplateSnapshot,
} from './personnelPerformanceCalculation';
import { calculatePerformanceEvaluation } from './personnelPerformanceCalculation';
import { canonicalPerformanceHash, type PerformanceCriterionPolicyContent } from './personnelPerformancePolicy';
import {
  performanceVaultKeyFromEnvironment,
  persistPerformancePayload,
  readPerformancePayload,
  type PerformanceVaultKey,
} from './personnelPerformancePayloadStore';
import { persistAcceptedPerformanceResult } from './personnelPerformanceResultStore';
import {
  recomputePerformanceProjectionsInTransaction,
  runPerformanceSerializableTransaction,
  type ScoringPolicyContent,
  type PerformanceTemplatePolicyContent,
} from './personnelPerformancePolicyStore';
import { publishNotificationEvent } from './notificationService';
import { assertPersonnelPerformanceWriteAdmission, type PersonnelPerformanceWriteAction } from './personnelPerformanceRolloutPolicy';

const admitSectionWrite = async (tx: Prisma.TransactionClient, evaluationId: string, action: PersonnelPerformanceWriteAction) => {
  const evaluation = await tx.performanceEvaluation.findUniqueOrThrow({ where: { id: evaluationId }, select: { subjectId: true } });
  return assertPersonnelPerformanceWriteAdmission(tx, action, evaluation.subjectId);
};
import { requirePerformanceReason, validatePerformanceSubmissionResponses } from './personnelPerformanceWorkflow';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';

const workflowError = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });
const DAY_MS = 86_400_000;
const REVIEW_REASON_CATEGORIES = {
  REJECTED: new Set(['EVIDENCE_INSUFFICIENT', 'JUDGMENT_UNCLEAR', 'APPLICABILITY_DISPUTE', 'CONTEXT_CORRECTION', 'OTHER']),
  NOT_EVALUABLE: new Set(['NO_VALID_SUPERVISOR', 'SUBMISSION_IMPOSSIBLE', 'INSUFFICIENT_COVERAGE', 'CONTEXT_UNAVAILABLE', 'OTHER']),
} as const;

const controlledReviewCategory = (decision: 'REJECTED' | 'NOT_EVALUABLE', value: string | undefined) => {
  const category = value?.trim() ?? '';
  if (!REVIEW_REASON_CATEGORIES[decision].has(category)) {
    throw workflowError('دسته دلیل کنترل‌شده برای این تصمیم الزامی است.', 'PERFORMANCE_REVIEW_CATEGORY_REQUIRED', 422);
  }
  return category;
};

const assertSupervisorAuthority = async (tx: Prisma.TransactionClient, sectionId: string, userId: string, now: Date) => {
  const [section, user] = await Promise.all([
    tx.performanceEvaluationSection.findUnique({ where: { id: sectionId } }),
    tx.user.findUnique({ where: { id: userId }, select: { id: true, personnelId: true, isActive: true } }),
  ]);
  if (!section || !user?.isActive || !user.personnelId || user.personnelId !== section.responsibleSupervisorPersonnelId) {
    throw workflowError('این پرونده برای شما قابل دسترسی نیست.', 'PERFORMANCE_RECORD_UNAVAILABLE', 404);
  }
  const activeRelationship = await tx.hrEmploymentRelationship.findFirst({ where: {
    personnelId: user.personnelId,
    status: 'ACTIVE',
    effectiveFrom: { lte: now },
    OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
  } });
  if (!activeRelationship) throw workflowError(
    'به‌دلیل پایان یا تعلیق رابطه استخدامی، ارسال ارزیابی ممکن نیست. با منابع انسانی تماس بگیرید.',
    'PERFORMANCE_SUPERVISOR_INACTIVE', 409,
  );
  if (!(await activeHrActionPermissionsForUser(tx, userId, now)).includes('SUBMIT_PERFORMANCE_EVALUATION')) {
    throw workflowError('مجوز فعال ارسال ارزیابی عملکرد را ندارید.', 'PERFORMANCE_SUBMISSION_PERMISSION_REVOKED', 403);
  }
  return { section, user: { ...user, personnelId: user.personnelId } };
};

const validateDraftPayload = (payload: unknown): { responses: PerformanceCriterionResponse[]; narrative?: string } => {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { responses?: unknown }).responses)) {
    throw workflowError('پاسخ معیارهای ارزیابی کامل نیست.', 'PERFORMANCE_DRAFT_INVALID', 422);
  }
  const record = payload as { responses: PerformanceCriterionResponse[]; narrative?: unknown };
  if (record.responses.some((response) => !response || typeof response.criterionVersionId !== 'string' || !Array.isArray(response.evidence))) {
    throw workflowError('پاسخ یکی از معیارهای ارزیابی معتبر نیست.', 'PERFORMANCE_DRAFT_INVALID', 422);
  }
  return { responses: record.responses, ...(typeof record.narrative === 'string' ? { narrative: record.narrative.trim() } : {}) };
};

const performanceFormDefinition = async (
  client: Prisma.TransactionClient | PrismaClient,
  snapshotId: string | null,
  keyring: PerformanceVaultKey,
) => {
  if (!snapshotId) return { categories: [] };
  const snapshot = await client.performanceSnapshot.findUnique({ where: { id: snapshotId } });
  if (!snapshot) return { categories: [] };
  const frozen = await readPerformancePayload<FrozenTemplatePayload>(client, snapshot.encryptedPayloadId, keyring);
  const versions = await client.performanceTemplateVersion.findMany({ where: { id: { in: (frozen.templateVersions ?? []).map(({ id }) => id) } } });
  const contents = await Promise.all(versions.map(async (version) => ({
    version,
    content: await readPerformancePayload<PerformanceTemplatePolicyContent>(client, version.encryptedPayloadId!, keyring),
  })));
  const criterionIds = [...new Set(contents.flatMap(({ content }) => content.categories.flatMap((category) => category.criteria.map(({ criterionVersionId }) => criterionVersionId))))];
  const criterionVersions = await client.performanceCriterionVersion.findMany({ where: { id: { in: criterionIds } } });
  const criteria = new Map(await Promise.all(criterionVersions.map(async (version) => [
    version.id, await readPerformancePayload<PerformanceCriterionPolicyContent>(client, version.encryptedPayloadId!, keyring),
  ] as const)));
  return {
    categories: contents.flatMap(({ version, content }) => content.categories.map((category) => ({
      id: `${version.id}:${category.id}`, titleFa: category.titleFa, templateTitleFa: content.titleFa,
      criteria: category.criteria.flatMap(({ criterionVersionId, weightPercent }) => {
        const criterion = criteria.get(criterionVersionId);
        return criterion ? [{ criterionVersionId, weightPercent, ...criterion }] : [];
      }),
    }))),
  };
};

const addWorkingDays = (from: Date, days: number) => {
  const date = new Date(from);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tehran', weekday: 'short' }).format(date);
    if (weekday !== 'Fri') remaining -= 1;
  }
  return date;
};

const notify = async (tx: Prisma.TransactionClient, input: {
  type: 'PERFORMANCE_SUPERVISOR_TASK' | 'PERFORMANCE_REVIEW_READY' | 'PERFORMANCE_SUBMISSION_DECIDED' | 'PERFORMANCE_REMINDER';
  deduplicationKey: string;
  recipientIds: string[];
  actorId?: string;
  resourceType: string;
  resourceId: string;
  actionUrl: string;
}) => publishNotificationEvent(tx, {
  ...input,
  recipientGroups: { DIRECT_USER: input.recipientIds },
  workspace: 'HUMAN_RESOURCES', feature: 'PERSONNEL_PERFORMANCE', payload: {},
});

const usersWithPerformancePermission = async (tx: Prisma.TransactionClient, permission: string, now: Date) => {
  const users = await tx.user.findMany({ where: { isActive: true }, select: { id: true } });
  const permissionSets = await Promise.all(users.map(async ({ id }) => ({
    id,
    permissions: await activeHrActionPermissionsForUser(tx, id, now),
  })));
  return permissionSets.filter(({ permissions }) => permissions.includes(permission)).map(({ id }) => id);
};

const assertFrozenSupervisorContext = async (tx: Prisma.TransactionClient, section: {
  employmentAssignmentId: string;
  responsibleSupervisorPersonnelId: string;
  templateSnapshotId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date;
}, keyring: PerformanceVaultKey) => {
  if (!section.templateSnapshotId) throw workflowError('تصویر ثابت مسئولیت این بخش کامل نیست.', 'PERFORMANCE_SNAPSHOT_MISSING', 409);
  const snapshot = await tx.performanceSnapshot.findUniqueOrThrow({ where: { id: section.templateSnapshotId } });
  const payload = await readPerformancePayload<FrozenTemplatePayload>(tx, snapshot.encryptedPayloadId, keyring);
  const responsibilityId = typeof payload.assignment?.responsibilityId === 'string' ? payload.assignment.responsibilityId : null;
  if (!responsibilityId) throw workflowError('شناسه سابقه مسئولیت منجمد ثبت نشده است.', 'PERFORMANCE_SUPERVISOR_SNAPSHOT_MISSING', 409);
  const responsibility = await tx.hrAssignmentPerformanceResponsibility.findUnique({
    where: { id: responsibilityId },
    select: {
      employmentAssignmentId: true, effectiveFrom: true, effectiveTo: true, status: true,
      supervisorAssignment: { select: { employmentRelationship: { select: { personnelId: true } } } },
    },
  });
  if (!responsibility
    || responsibility.status !== 'ACTIVE'
    || responsibility.employmentAssignmentId !== section.employmentAssignmentId
    || responsibility.supervisorAssignment.employmentRelationship.personnelId !== section.responsibleSupervisorPersonnelId
    || responsibility.effectiveFrom > section.effectiveFrom
    || (responsibility.effectiveTo && responsibility.effectiveTo < section.effectiveTo)) {
    throw workflowError('زمینه مسئولیت این بخش تغییر کرده است و باید منابع انسانی آن را بررسی کند.', 'PERFORMANCE_SUPERVISOR_CONTEXT_CHANGED', 409);
  }
};

const assertSubmissionComplete = async (
  tx: Prisma.TransactionClient,
  section: { templateSnapshotId: string | null; effectiveFrom: Date; effectiveTo: Date },
  payload: { responses: PerformanceCriterionResponse[] },
  keyring: PerformanceVaultKey,
) => {
  if (!section.templateSnapshotId) throw workflowError('تصویر ثابت الگوی این بخش کامل نیست.', 'PERFORMANCE_SNAPSHOT_MISSING', 409);
  const form = await performanceFormDefinition(tx, section.templateSnapshotId, keyring);
  const criteria = form.categories.flatMap(({ criteria }) => criteria) as PerformanceTemplateSnapshot['categories'][number]['criteria'];
  const errors = validatePerformanceSubmissionResponses({
    criteria, responses: payload.responses, effectiveFrom: section.effectiveFrom, effectiveTo: section.effectiveTo,
  });
  if (errors.length) throw workflowError(errors[0], 'PERFORMANCE_SUBMISSION_INCOMPLETE', 422);
};

export const listSupervisorPerformanceSections = async (client: PrismaClient, userId: string) => {
  const user = await client.user.findUnique({ where: { id: userId }, select: { personnelId: true, isActive: true } });
  if (!user?.isActive || !user.personnelId) return [];
  const sections = await client.performanceEvaluationSection.findMany({
    where: { responsibleSupervisorPersonnelId: user.personnelId, status: { in: ['DRAFT', 'REJECTED', 'SUBMITTED', 'ACCEPTED', 'NOT_EVALUABLE'] } },
    orderBy: [{ submissionDueAt: 'asc' }, { createdAt: 'asc' }],
  });
  const evaluations = await client.performanceEvaluation.findMany({
    where: { id: { in: [...new Set(sections.map(({ evaluationId }) => evaluationId))] } },
  });
  const evaluationMap = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const subjects = await client.performanceSubject.findMany({
    where: { id: { in: [...new Set(evaluations.map(({ subjectId }) => subjectId))] } },
  });
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  const personnel = await client.personnel.findMany({
    where: { id: { in: subjects.flatMap(({ personnelId }) => personnelId ? [personnelId] : []) } },
    select: { id: true, firstName: true, lastName: true },
  });
  const personnelMap = new Map(personnel.map((person) => [person.id, person]));
  return sections.map((section) => {
    const evaluation = evaluationMap.get(section.evaluationId)!;
    const subject = subjectMap.get(evaluation.subjectId);
    const person = subject?.personnelId ? personnelMap.get(subject.personnelId) : null;
    return {
      id: section.id, status: section.status, effectiveFrom: section.effectiveFrom, effectiveTo: section.effectiveTo,
      submissionDueAt: section.submissionDueAt, reviewDueAt: section.reviewDueAt,
      personnel: person ? { displayName: `${person.firstName} ${person.lastName}`.trim() } : { displayName: 'پرسنل ارزیابی' },
    };
  });
};

export const getSupervisorPerformanceSection = async (client: PrismaClient, input: {
  sectionId: string;
  userId: string;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    const { section } = await assertSupervisorAuthority(tx, input.sectionId, input.userId, new Date());
    const snapshot = section.templateSnapshotId ? await tx.performanceSnapshot.findUnique({ where: { id: section.templateSnapshotId } }) : null;
    const latestDraft = await tx.performanceDraft.findFirst({
      where: { sectionId: section.id, supervisorUserId: input.userId }, orderBy: { revision: 'desc' },
    });
    const review = await tx.performanceReview.findFirst({
      where: { submissionId: { in: (await tx.performanceSubmission.findMany({ where: { sectionId: section.id }, select: { id: true } })).map(({ id }) => id) } },
      orderBy: { decidedAt: 'desc' },
    });
    return {
      section,
      template: snapshot ? await readPerformancePayload<Record<string, unknown>>(tx, snapshot.encryptedPayloadId, keyring) : null,
      form: await performanceFormDefinition(tx, section.templateSnapshotId, keyring),
      draft: latestDraft ? {
        revision: latestDraft.revision, status: latestDraft.status,
        content: await readPerformancePayload<Record<string, unknown>>(tx, latestDraft.encryptedPayloadId, keyring),
      } : null,
      review: review ? { decision: review.decision, decidedAt: review.decidedAt } : null,
    };
  });
};

export const saveSupervisorPerformanceDraft = async (client: PrismaClient, input: {
  sectionId: string;
  userId: string;
  payload: unknown;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  const now = input.now ?? new Date();
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const payload = validateDraftPayload(input.payload);
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-section:' + input.sectionId}, 0))`;
    const { section, user } = await assertSupervisorAuthority(tx, input.sectionId, input.userId, now);
    await admitSectionWrite(tx, section.evaluationId, 'SAVE_SUPERVISOR_DRAFT');
    if (section.windowClosedAt) throw workflowError('پنجره ارسال این ارزیابی بسته شده است.', 'PERFORMANCE_WINDOW_CLOSED', 409);
    if (!['DRAFT', 'REJECTED'].includes(section.status)) throw workflowError('این بخش در وضعیت قابل ویرایش نیست.', 'PERFORMANCE_SECTION_NOT_EDITABLE', 409);
    if (section.status === 'REJECTED') await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'DRAFT' } });
    const predecessor = await tx.performanceDraft.findFirst({ where: { sectionId: section.id, supervisorUserId: input.userId }, orderBy: { revision: 'desc' } });
    if (predecessor?.status === 'OPEN') await tx.$executeRaw`
      UPDATE "performance_drafts" SET "status" = 'DISCARDED' WHERE "id" = ${predecessor.id}
    `;
    const id = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_DRAFT', aggregateId: id, payloadKind: 'SUPERVISOR_JUDGMENT', schemaVersion: 1,
      payload, keyring,
    });
    return tx.performanceDraft.create({ data: {
      id, sectionId: section.id, supervisorUserId: user.id, supervisorPersonnelId: user.personnelId,
      revision: (predecessor?.revision ?? 0) + 1, encryptedPayloadId: encrypted.id, contentHash: encrypted.contentHash,
      createdAt: now, updatedAt: now,
    } });
  });
};

export const submitSupervisorPerformanceSection = async (client: PrismaClient, input: {
  sectionId: string;
  userId: string;
  idempotencyKey: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  if (!input.idempotencyKey.trim()) throw workflowError('کلید تکرارپذیری ارسال الزامی است.', 'PERFORMANCE_IDEMPOTENCY_KEY_REQUIRED', 422);
  const now = input.now ?? new Date();
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-section:' + input.sectionId}, 0))`;
    const { section, user } = await assertSupervisorAuthority(tx, input.sectionId, input.userId, now);
    await assertFrozenSupervisorContext(tx, section, keyring);
    const existing = await tx.performanceOperationReceipt.findUnique({ where: {
      idempotencyKeyHash: canonicalPerformanceHash({ scope: 'SUBMIT_SECTION', key: input.idempotencyKey.trim() }),
    } });
    const submitIntentHash = canonicalPerformanceHash({ sectionId: section.id, userId: input.userId });
    if (existing) {
      if (existing.intentHash !== submitIntentHash) throw workflowError('کلید تکرارپذیری برای درخواست دیگری استفاده شده است.', 'PERFORMANCE_IDEMPOTENCY_CONFLICT', 409);
      return { submission: await readPerformancePayload<Record<string, unknown>>(tx, existing.encryptedPayloadId, keyring), idempotent: true };
    }
    if (section.windowClosedAt) throw workflowError('پنجره ارسال این ارزیابی بسته شده است.', 'PERFORMANCE_WINDOW_CLOSED', 409);
    if (section.status !== 'DRAFT') throw workflowError('این بخش دیگر آماده ارسال نیست.', 'PERFORMANCE_SUBMISSION_ALREADY_DECIDED', 409);
    await admitSectionWrite(tx, section.evaluationId, 'SUBMIT_SUPERVISOR_EVALUATION');
    if (now < section.effectiveTo) throw workflowError('ارسال این بخش پس از پایان بازه مسئولیت ممکن است.', 'PERFORMANCE_SECTION_NOT_ENDED', 409);
    const draft = await tx.performanceDraft.findFirst({
      where: { sectionId: section.id, supervisorUserId: input.userId, status: 'OPEN' }, orderBy: { revision: 'desc' },
    });
    if (!draft) throw workflowError('ابتدا پیش‌نویس ارزیابی را ذخیره کنید.', 'PERFORMANCE_DRAFT_REQUIRED', 409);
    const draftPayload = await readPerformancePayload<{ responses: PerformanceCriterionResponse[]; narrative?: string }>(tx, draft.encryptedPayloadId, keyring);
    await assertSubmissionComplete(tx, section, draftPayload, keyring);
    const version = (await tx.performanceSubmission.count({ where: { sectionId: section.id } })) + 1;
    const submissionId = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_SUBMISSION', aggregateId: submissionId, payloadKind: 'SUPERVISOR_JUDGMENT', schemaVersion: 1,
      payload: { ...draftPayload, draftRevision: draft.revision, submittedAt: now.toISOString() }, keyring,
    });
    const submission = await tx.performanceSubmission.create({ data: {
      id: submissionId, sectionId: section.id, draftId: draft.id, supervisorUserId: user.id,
      supervisorPersonnelId: user.personnelId, version, encryptedPayloadId: encrypted.id, contentHash: encrypted.contentHash, submittedAt: now,
    } });
    await tx.$executeRaw`
      UPDATE "performance_drafts" SET "status" = 'SUBMITTED' WHERE "id" = ${draft.id}
    `;
    await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'SUBMITTED', reviewDueAt: addWorkingDays(now, 3) } });
    await tx.performanceEvaluation.updateMany({ where: { id: section.evaluationId, status: 'READY_FOR_SUBMISSION' }, data: { status: 'UNDER_REVIEW' } });
    const reviewerIds = await usersWithPerformancePermission(tx, 'REVIEW_PERFORMANCE_EVALUATION', now);
    await notify(tx, {
      type: 'PERFORMANCE_REVIEW_READY', deduplicationKey: `performance-review-ready:${submission.id}`,
      recipientIds: reviewerIds, actorId: input.userId,
      resourceType: 'PERFORMANCE_SUBMISSION', resourceId: submission.id,
      actionUrl: `/dashboard/hr/personnel/performance/reviews/${submission.id}`,
    });
    const receiptId = randomUUID();
    const receiptPayload = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_OPERATION_RECEIPT', aggregateId: receiptId, payloadKind: 'SUBMIT_SECTION', schemaVersion: 1,
      payload: submission, keyring,
    });
    await tx.performanceOperationReceipt.create({ data: {
      id: receiptId,
      idempotencyKeyHash: canonicalPerformanceHash({ scope: 'SUBMIT_SECTION', key: input.idempotencyKey.trim() }),
      operationKind: 'SUBMIT_PERFORMANCE_SECTION', intentHash: submitIntentHash,
      encryptedPayloadId: receiptPayload.id, completedAt: now,
    } });
    return { submission, idempotent: false };
  });
};

export const listPerformanceReviewQueue = async (client: PrismaClient) => {
  const sections = await client.performanceEvaluationSection.findMany({ where: { status: 'SUBMITTED' }, orderBy: [{ reviewDueAt: 'asc' }, { updatedAt: 'asc' }] });
  const decided = await client.performanceReview.findMany({ select: { submissionId: true } });
  const decidedIds = new Set(decided.map(({ submissionId }) => submissionId));
  const submissions = await client.performanceSubmission.findMany({
    where: { sectionId: { in: sections.map(({ id }) => id) } },
    orderBy: { submittedAt: 'asc' },
    select: { id: true, sectionId: true, version: true, submittedAt: true, supervisorUserId: true },
  });
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  return submissions.filter(({ id }) => !decidedIds.has(id)).map((submission) => ({ ...submission, reviewDueAt: sectionMap.get(submission.sectionId)?.reviewDueAt ?? null }));
};

export const getPerformanceReviewSubmission = async (client: PrismaClient, input: {
  submissionId: string;
  keyring?: PerformanceVaultKey;
}) => {
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const submission = await client.performanceSubmission.findUnique({ where: { id: input.submissionId } });
  if (!submission) throw workflowError('پرونده آماده بررسی پیدا نشد.', 'PERFORMANCE_REVIEW_RECORD_UNAVAILABLE', 404);
  const [section, content] = await Promise.all([
    client.performanceEvaluationSection.findUniqueOrThrow({ where: { id: submission.sectionId } }),
    readPerformancePayload<Record<string, unknown>>(client, submission.encryptedPayloadId, keyring),
  ]);
  return {
    submission: { id: submission.id, version: submission.version, submittedAt: submission.submittedAt },
    section, content, form: await performanceFormDefinition(client, section.templateSnapshotId, keyring),
  };
};

export const claimPerformanceReview = async (client: PrismaClient, input: {
  submissionId: string;
  reviewerUserId: string;
  now?: Date;
}) => {
  const now = input.now ?? new Date();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-review:' + input.submissionId}, 0))`;
    if (!(await activeHrActionPermissionsForUser(tx, input.reviewerUserId, now)).includes('REVIEW_PERFORMANCE_EVALUATION')) {
      throw workflowError('مجوز فعال بررسی ارزیابی عملکرد را ندارید.', 'PERFORMANCE_REVIEW_PERMISSION_REVOKED', 403);
    }
    const submission = await tx.performanceSubmission.findUnique({ where: { id: input.submissionId } });
    const existingReview = await tx.performanceReview.findUnique({ where: { submissionId: input.submissionId } });
    if (!submission || existingReview) throw workflowError('این بررسی قبلاً تکمیل شده است.', 'PERFORMANCE_REVIEW_ALREADY_DECIDED', 409);
    const section = await tx.performanceEvaluationSection.findUniqueOrThrow({ where: { id: submission.sectionId } });
    await admitSectionWrite(tx, section.evaluationId, 'DECIDE_HR_REVIEW');
    await tx.performanceReviewClaim.updateMany({
      where: { submissionId: submission.id, releasedAt: null, expiresAt: { lte: now } },
      data: { releasedAt: now, releaseReason: 'پایان خودکار مهلت تصاحب بررسی' },
    });
    const active = await tx.performanceReviewClaim.findFirst({ where: { submissionId: submission.id, releasedAt: null, expiresAt: { gt: now } } });
    if (active?.reviewerUserId === input.reviewerUserId) return active;
    if (active) throw workflowError('این پرونده برای مدت کوتاهی در حال بررسی همکار دیگری است.', 'PERFORMANCE_REVIEW_CLAIMED', 409);
    return tx.performanceReviewClaim.create({ data: {
      submissionId: submission.id, reviewerUserId: input.reviewerUserId, claimedAt: now, expiresAt: new Date(now.getTime() + (15 * 60_000)),
    } });
  });
};

type FrozenTemplatePayload = {
  assignment?: Record<string, unknown>;
  templateVersions?: Array<{ id: string; kind: string }>;
  scoringPolicyVersion?: { id: string; version: number; contentHash: string };
};

const buildCalculationInput = async (tx: Prisma.TransactionClient, evaluationId: string, keyring: PerformanceVaultKey): Promise<PerformanceEvaluationInput> => {
  const sections = await tx.performanceEvaluationSection.findMany({
    where: { evaluationId, status: { in: ['ACCEPTED', 'NOT_EVALUABLE'] } }, orderBy: { effectiveFrom: 'asc' },
  });
  const frozenSections = await Promise.all(sections.map(async (section) => {
    if (!section.templateSnapshotId) throw workflowError('تصویر ثابت الگوی بخش کامل نیست.', 'PERFORMANCE_SNAPSHOT_MISSING', 409);
    const snapshot = await tx.performanceSnapshot.findUniqueOrThrow({ where: { id: section.templateSnapshotId } });
    const payload = await readPerformancePayload<FrozenTemplatePayload>(tx, snapshot.encryptedPayloadId, keyring);
    const templateIds = payload.templateVersions?.map(({ id }) => id) ?? [];
    const scoringPolicyId = payload.scoringPolicyVersion?.id;
    if (!scoringPolicyId) throw workflowError('نسخه منجمد سیاست امتیازدهی بخش ثبت نشده است.', 'PERFORMANCE_SCORING_POLICY_SNAPSHOT_MISSING', 409);
    const scoring = await tx.performancePolicyVersion.findUnique({ where: { id: scoringPolicyId } });
    if (!scoring?.encryptedPayloadId) throw workflowError('نسخه منجمد سیاست امتیازدهی پیدا نشد.', 'PERFORMANCE_SCORING_POLICY_MISSING', 409);
    const scoringContent = await readPerformancePayload<ScoringPolicyContent>(tx, scoring.encryptedPayloadId, keyring);
    const versions = await tx.performanceTemplateVersion.findMany({ where: { id: { in: templateIds } } });
    if (versions.length !== templateIds.length) throw workflowError('نسخه منجمد الگوی بخش کامل نیست.', 'PERFORMANCE_TEMPLATE_SNAPSHOT_MISSING', 409);
    const templateContents = await Promise.all(versions.map(async (version) => ({
      version,
      content: await readPerformancePayload<PerformanceTemplatePolicyContent>(tx, version.encryptedPayloadId!, keyring),
    })));
    const criterionIds = [...new Set(templateContents.flatMap(({ content }) => content.categories.flatMap((category) => category.criteria.map(({ criterionVersionId }) => criterionVersionId))))];
    const criterionVersions = await tx.performanceCriterionVersion.findMany({ where: { id: { in: criterionIds } } });
    const criterionContents = new Map(await Promise.all(criterionVersions.map(async (version) => [
      version.id, await readPerformancePayload<PerformanceCriterionPolicyContent>(tx, version.encryptedPayloadId!, keyring),
    ] as const)));
    const hasAddendum = templateContents.some(({ version }) => version.templateKind === 'POSITION_ADDENDUM');
    const jobShare = hasAddendum ? scoringContent.defaultJobSharePercent : '100';
    const addendumShare = hasAddendum ? scoringContent.defaultAddendumSharePercent : '0';
    const categories = templateContents.flatMap(({ version, content }) => {
      const share = version.templateKind === 'JOB_TEMPLATE' ? jobShare : addendumShare;
      return content.categories.map((category) => ({
        id: `${version.id}:${category.id}`, titleFa: category.titleFa,
        weightPercent: new Prisma.Decimal(category.weightPercent).mul(share).div(100).toFixed(6), required: category.required,
        criteria: category.criteria.map((criterion) => {
          const contentRow = criterionContents.get(criterion.criterionVersionId);
          if (!contentRow) throw workflowError('تصویر معیار ارزیابی کامل نیست.', 'PERFORMANCE_CRITERION_SNAPSHOT_MISSING', 409);
          return {
            criterionVersionId: criterion.criterionVersionId, titleFa: contentRow.titleFa,
            weightPercent: new Prisma.Decimal(criterion.weightPercent).toFixed(2), kind: contentRow.kind,
            anchorsFa: contentRow.anchorsFa, applicability: contentRow.applicability, evidence: contentRow.evidence,
          };
        }),
      }));
    });
    const template: PerformanceTemplateSnapshot = {
      schemaVersion: 1, templateVersionId: canonicalPerformanceHash([...templateIds].sort()), scoringPolicyVersionId: scoring.id,
      jobSharePercent: new Prisma.Decimal(jobShare).toFixed(6), addendumSharePercent: new Prisma.Decimal(addendumShare).toFixed(6), categories,
    };
    return { section, template, facts: payload.assignment ?? {} };
  }));
  if (!frozenSections[0]) throw workflowError('بخش حل‌شده‌ای برای محاسبه وجود ندارد.', 'PERFORMANCE_SECTION_MISSING', 409);
  const submissions = await tx.performanceSubmission.findMany({ where: { sectionId: { in: sections.map(({ id }) => id) } }, orderBy: { version: 'desc' } });
  const latest = new Map<string, typeof submissions[number]>();
  submissions.forEach((submission) => { if (!latest.has(submission.sectionId)) latest.set(submission.sectionId, submission); });
  return {
    template: frozenSections[0].template,
    sections: await Promise.all(frozenSections.map(async ({ section, template, facts }) => {
      const submission = latest.get(section.id);
      if (!submission && section.status === 'ACCEPTED') throw workflowError('ارسال معتبر بخش پیدا نشد.', 'PERFORMANCE_SUBMISSION_MISSING', 409);
      const payload = submission
        ? await readPerformancePayload<{ responses: PerformanceCriterionResponse[] }>(tx, submission.encryptedPayloadId, keyring)
        : { responses: [] };
      return {
        sectionId: section.id,
        effectiveDays: Math.max(1, Math.ceil((section.effectiveTo.getTime() - section.effectiveFrom.getTime()) / DAY_MS)),
        allocationPercent: section.allocationPercent.toFixed(2),
        effectiveFrom: section.effectiveFrom.toISOString(), effectiveTo: section.effectiveTo.toISOString(),
        snapshotFacts: facts, responses: payload.responses, template, notEvaluable: section.status === 'NOT_EVALUABLE',
      };
    })),
  };
};

const finalizeResolvedEvaluation = async (tx: Prisma.TransactionClient, input: {
  evaluationId: string;
  actorUserId: string;
  idempotencyKey: string;
  now: Date;
  keyring: PerformanceVaultKey;
}) => {
  const unresolved = await tx.performanceEvaluationSection.count({ where: {
    evaluationId: input.evaluationId, status: { notIn: ['ACCEPTED', 'NOT_EVALUABLE'] },
  } });
  if (unresolved) return null;
  const acceptedCount = await tx.performanceEvaluationSection.count({
    where: { evaluationId: input.evaluationId, status: 'ACCEPTED' },
  });
  const closeNotEvaluable = async (reasonCode: 'NO_EVALUABLE_SECTIONS' | 'INSUFFICIENT_EVALUABLE_COVERAGE', calculationHash: string | null = null) => {
    await tx.performanceEvaluation.update({
      where: { id: input.evaluationId }, data: { status: 'NOT_EVALUABLE', writerVersion: { increment: 1 } },
    });
    const id = randomUUID();
    const sections = await tx.performanceEvaluationSection.findMany({ where: { evaluationId: input.evaluationId },
      select: { id: true, status: true, templateSnapshotId: true }, orderBy: { id: 'asc' } });
    const decisions = await tx.performanceAuditEvent.findMany({ where: { aggregateType: 'EVALUATION_SECTION', aggregateId: { in: sections.map(({ id }) => id) } },
      select: { id: true, eventHash: true }, orderBy: { id: 'asc' } });
    const submissions = await tx.performanceSubmission.findMany({ where: { sectionId: { in: sections.map(({ id }) => id) } }, select: { id: true, contentHash: true }, orderBy: { id: 'asc' } });
    const reviews = await tx.performanceReview.findMany({ where: { submissionId: { in: submissions.map(({ id }) => id) } }, select: { id: true, submissionId: true, decision: true, encryptedPayloadId: true }, orderBy: { id: 'asc' } });
    const authorityHash = canonicalPerformanceHash({ actorUserId: input.actorUserId,
      effectivePermissions: (await activeHrActionPermissionsForUser(tx, input.actorUserId)).sort() });
    const basis = await persistPerformancePayload(tx, { aggregateType: 'EVALUATION', aggregateId: input.evaluationId,
      payloadKind: `NOT_EVALUABLE_CLOSURE_${id}`, schemaVersion: 1, keyring: input.keyring,
      payload: { evaluationId: input.evaluationId, reasonCode, sections, decisions, submissions, reviews, calculationHash, authorityHash } });
    await tx.performanceAuditEvent.create({ data: { id, aggregateType: 'EVALUATION', aggregateId: input.evaluationId,
      eventType: 'EVALUATION_NOT_EVALUABLE', actorUserId: input.actorUserId, occurredAt: input.now,
      authorityHash, reason: reasonCode, encryptedPayloadId: basis.id,
      eventHash: canonicalPerformanceHash({ id, evaluationId: input.evaluationId, status: 'NOT_EVALUABLE', closedAt: input.now.toISOString(), basisHash: basis.contentHash, authorityHash }) } });
  };
  if (!acceptedCount) {
    await closeNotEvaluable('NO_EVALUABLE_SECTIONS');
    return { status: 'NOT_EVALUABLE' as const };
  }
  const calculationInput = await buildCalculationInput(tx, input.evaluationId, input.keyring);
  const calculation = calculatePerformanceEvaluation(calculationInput);
  if (calculation.status === 'NOT_EVALUABLE') {
    await closeNotEvaluable('INSUFFICIENT_EVALUABLE_COVERAGE', canonicalPerformanceHash(calculation));
    return { status: 'NOT_EVALUABLE' as const, calculation };
  }
  if (calculation.status === 'BLOCKED') {
    throw workflowError('محاسبه نتیجه به‌علت ناسازگاری تصویر ثابت متوقف شد.', 'PERFORMANCE_CALCULATION_BLOCKED', 409);
  }
  return persistAcceptedPerformanceResult(tx, {
    evaluationId: input.evaluationId,
    calculationInput,
    acceptedByUserId: input.actorUserId,
    idempotencyKey: `review-result:${input.idempotencyKey}`,
    acceptedAt: input.now,
    keyring: input.keyring,
  });
};

export const decidePerformanceReview = async (client: PrismaClient, input: {
  submissionId: string;
  reviewerUserId: string;
  decision: PerformanceReviewDecision;
  reason?: string;
  reasonCategory?: string;
  criterionVersionId?: string;
  evidenceReferenceId?: string;
  idempotencyKey: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  if (!input.idempotencyKey.trim()) throw workflowError('کلید تکرارپذیری تصمیم الزامی است.', 'PERFORMANCE_IDEMPOTENCY_KEY_REQUIRED', 422);
  const now = input.now ?? new Date();
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const reason = input.decision === PerformanceReviewDecision.ACCEPTED
    ? (input.reason?.trim() || 'مطابق سیاست')
    : requirePerformanceReason(input.reason ?? '', input.decision === PerformanceReviewDecision.REJECTED ? 'بازگرداندن ارزیابی' : 'ثبت غیرقابل‌ارزیابی');
  const reasonCategory = input.decision === PerformanceReviewDecision.ACCEPTED
    ? 'POLICY_COMPLIANT'
    : controlledReviewCategory(input.decision, input.reasonCategory);
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-review:' + input.submissionId}, 0))`;
    const submission = await tx.performanceSubmission.findUnique({ where: { id: input.submissionId } });
    if (!submission) throw workflowError('پرونده آماده بررسی پیدا نشد.', 'PERFORMANCE_REVIEW_RECORD_UNAVAILABLE', 404);
    const decisionReceiptHash = canonicalPerformanceHash({ scope: 'DECIDE_REVIEW', key: input.idempotencyKey.trim() });
    const decisionIntentHash = canonicalPerformanceHash({
      submissionId: input.submissionId, reviewerUserId: input.reviewerUserId, decision: input.decision, reason,
      reasonCategory, criterionVersionId: input.criterionVersionId?.trim() || null,
      evidenceReferenceId: input.evidenceReferenceId?.trim() || null,
    });
    const receipt = await tx.performanceOperationReceipt.findUnique({ where: { idempotencyKeyHash: decisionReceiptHash } });
    if (receipt) {
      if (receipt.intentHash !== decisionIntentHash) throw workflowError('کلید تکرارپذیری برای تصمیم دیگری استفاده شده است.', 'PERFORMANCE_IDEMPOTENCY_CONFLICT', 409);
      return { review: await tx.performanceReview.findUnique({ where: { submissionId: input.submissionId } }), result: null, idempotent: true };
    }
    if (await tx.performanceReview.findUnique({ where: { submissionId: input.submissionId } })) {
      throw workflowError('نخستین تصمیم معتبر قبلاً ثبت شده است.', 'PERFORMANCE_REVIEW_ALREADY_DECIDED', 409);
    }
    if (!(await activeHrActionPermissionsForUser(tx, input.reviewerUserId, now)).includes('REVIEW_PERFORMANCE_EVALUATION')) {
      throw workflowError('مجوز فعال بررسی ارزیابی عملکرد را ندارید.', 'PERFORMANCE_REVIEW_PERMISSION_REVOKED', 403);
    }
    const section = await tx.performanceEvaluationSection.findUniqueOrThrow({ where: { id: submission.sectionId } });
    if (section.status !== 'SUBMITTED') throw workflowError('این ارسال دیگر آماده تصمیم نیست.', 'PERFORMANCE_SUBMISSION_STALE', 409);
    await admitSectionWrite(tx, section.evaluationId, 'DECIDE_HR_REVIEW');
    const latest = await tx.performanceSubmission.findFirst({ where: { sectionId: section.id }, orderBy: { version: 'desc' } });
    if (latest?.id !== submission.id) throw workflowError('نسخه تازه‌تری برای این بخش وجود دارد.', 'PERFORMANCE_SUBMISSION_STALE', 409);
    const reviewer = await tx.user.findUniqueOrThrow({ where: { id: input.reviewerUserId }, select: { personnelId: true } });
    if (input.decision === PerformanceReviewDecision.ACCEPTED) {
    await assertFrozenSupervisorContext(tx, section, keyring);
      const submittedPayload = await readPerformancePayload<{ responses: PerformanceCriterionResponse[] }>(tx, submission.encryptedPayloadId, keyring);
      await assertSubmissionComplete(tx, section, submittedPayload, keyring);
    }
    const reviewId = randomUUID();
    const encrypted = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_REVIEW', aggregateId: reviewId, payloadKind: 'HR_DECISION', schemaVersion: 1,
      payload: {
        decision: input.decision, reason, reasonCategory,
        criterionVersionId: input.criterionVersionId?.trim() || null,
        evidenceReferenceId: input.evidenceReferenceId?.trim() || null,
        submissionVersion: submission.version, decidedAt: now.toISOString(),
      }, keyring,
    });
    const review = await tx.performanceReview.create({ data: {
      id: reviewId, submissionId: submission.id, version: submission.version,
      reviewerUserId: input.reviewerUserId, decision: input.decision, encryptedPayloadId: encrypted.id,
      selfReview: Boolean(reviewer.personnelId && reviewer.personnelId === submission.supervisorPersonnelId), decidedAt: now,
    } });
    const sectionStatus = input.decision === PerformanceReviewDecision.ACCEPTED ? 'ACCEPTED'
      : input.decision === PerformanceReviewDecision.REJECTED ? 'REJECTED' : 'NOT_EVALUABLE';
    await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: sectionStatus } });
    await tx.performanceReviewClaim.updateMany({
      where: { submissionId: submission.id, releasedAt: null }, data: { releasedAt: now, releaseReason: 'تصمیم بررسی ثبت شد' },
    });
    const result = await finalizeResolvedEvaluation(tx, {
      evaluationId: section.evaluationId, actorUserId: input.reviewerUserId,
      idempotencyKey: input.idempotencyKey.trim(), now, keyring,
    });
    await notify(tx, {
      type: 'PERFORMANCE_SUBMISSION_DECIDED', deduplicationKey: `performance-submission-decided:${review.id}`,
      recipientIds: [submission.supervisorUserId], actorId: input.reviewerUserId,
      resourceType: 'PERFORMANCE_SUBMISSION', resourceId: submission.id,
      actionUrl: `/dashboard/hr/personnel/performance/supervisor/${section.id}`,
    });
    const receiptId = randomUUID();
    const receiptPayload = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_OPERATION_RECEIPT', aggregateId: receiptId, payloadKind: 'DECIDE_REVIEW', schemaVersion: 1,
      payload: { reviewId: review.id, submissionId: submission.id, decision: review.decision }, keyring,
    });
    await tx.performanceOperationReceipt.create({ data: {
      id: receiptId, idempotencyKeyHash: decisionReceiptHash, operationKind: 'DECIDE_PERFORMANCE_REVIEW',
      intentHash: decisionIntentHash, encryptedPayloadId: receiptPayload.id, completedAt: now,
    } });
    return { review, result, idempotent: false };
  });
};

export const markPerformanceSectionNotEvaluable = async (client: PrismaClient, input: {
  sectionId: string;
  reviewerUserId: string;
  reasonCategory: string;
  reason: string;
  idempotencyKey: string;
  now?: Date;
  keyring?: PerformanceVaultKey;
}) => {
  if (!input.idempotencyKey.trim()) throw workflowError('کلید تکرارپذیری تصمیم الزامی است.', 'PERFORMANCE_IDEMPOTENCY_KEY_REQUIRED', 422);
  const reason = requirePerformanceReason(input.reason, 'ثبت غیرقابل‌ارزیابی');
  const reasonCategory = controlledReviewCategory('NOT_EVALUABLE', input.reasonCategory);
  const now = input.now ?? new Date();
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-section:' + input.sectionId}, 0))`;
    if (!(await activeHrActionPermissionsForUser(tx, input.reviewerUserId, now)).includes('REVIEW_PERFORMANCE_EVALUATION')) {
      throw workflowError('مجوز فعال بررسی ارزیابی عملکرد را ندارید.', 'PERFORMANCE_REVIEW_PERMISSION_REVOKED', 403);
    }
    const section = await tx.performanceEvaluationSection.findUnique({ where: { id: input.sectionId } });
    if (!section) throw workflowError('بخش ارزیابی پیدا نشد.', 'PERFORMANCE_SECTION_NOT_FOUND', 404);
    const receiptHash = canonicalPerformanceHash({ scope: 'MARK_SECTION_NOT_EVALUABLE', key: input.idempotencyKey.trim() });
    const intentHash = canonicalPerformanceHash({
      sectionId: section.id, reviewerUserId: input.reviewerUserId, reasonCategory, reason,
    });
    const receipt = await tx.performanceOperationReceipt.findUnique({ where: { idempotencyKeyHash: receiptHash } });
    if (receipt) {
      if (receipt.intentHash !== intentHash) throw workflowError('کلید تکرارپذیری برای تصمیم دیگری استفاده شده است.', 'PERFORMANCE_IDEMPOTENCY_CONFLICT', 409);
      return { section, idempotent: true };
    }
    if (!['DRAFT', 'REJECTED'].includes(section.status)) {
      throw workflowError('این بخش از مسیر ارسال موجود باید تعیین تکلیف شود.', 'PERFORMANCE_SECTION_NOT_RESOLVABLE', 409);
    }
    await admitSectionWrite(tx, section.evaluationId, 'DECIDE_HR_REVIEW');
    const updated = await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'NOT_EVALUABLE' } });
    const auditId = randomUUID();
    const evidence = await persistPerformancePayload(tx, {
      aggregateType: 'EVALUATION_SECTION', aggregateId: auditId, payloadKind: 'NOT_EVALUABLE_DECISION', schemaVersion: 1,
      payload: { reasonCategory, reason, decidedAt: now.toISOString() }, keyring,
    });
    await tx.performanceAuditEvent.create({ data: {
      id: auditId, aggregateType: 'EVALUATION_SECTION', aggregateId: section.id,
      eventType: 'SECTION_NOT_EVALUABLE', actorUserId: input.reviewerUserId, reason,
      encryptedPayloadId: evidence.id,
      eventHash: canonicalPerformanceHash({ auditId, sectionId: section.id, reasonCategory, evidenceHash: evidence.contentHash }),
      occurredAt: now,
    } });
    const result = await finalizeResolvedEvaluation(tx, {
      evaluationId: section.evaluationId, actorUserId: input.reviewerUserId,
      idempotencyKey: input.idempotencyKey.trim(), now, keyring,
    });
    const supervisor = await tx.user.findFirst({
      where: { personnelId: section.responsibleSupervisorPersonnelId, isActive: true }, select: { id: true },
    });
    if (supervisor) await notify(tx, {
      type: 'PERFORMANCE_SUBMISSION_DECIDED', deduplicationKey: `performance-section-not-evaluable:${section.id}`,
      recipientIds: [supervisor.id], actorId: input.reviewerUserId,
      resourceType: 'PERFORMANCE_EVALUATION_SECTION', resourceId: section.id,
      actionUrl: `/dashboard/hr/personnel/performance/supervisor/${section.id}`,
    });
    const receiptId = randomUUID();
    const receiptPayload = await persistPerformancePayload(tx, {
      aggregateType: 'PERFORMANCE_OPERATION_RECEIPT', aggregateId: receiptId,
      payloadKind: 'MARK_SECTION_NOT_EVALUABLE', schemaVersion: 1,
      payload: { sectionId: section.id, status: updated.status }, keyring,
    });
    await tx.performanceOperationReceipt.create({ data: {
      id: receiptId, idempotencyKeyHash: receiptHash, operationKind: 'MARK_PERFORMANCE_SECTION_NOT_EVALUABLE',
      intentHash, encryptedPayloadId: receiptPayload.id, completedAt: now,
    } });
    return { section: updated, result, idempotent: false };
  });
};

export const extendPerformanceSectionDeadline = async (client: PrismaClient, input: {
  sectionId: string;
  actorUserId: string;
  dueAt: Date;
  reason: string;
}) => {
  const reason = requirePerformanceReason(input.reason, 'تمدید مهلت');
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-section:' + input.sectionId}, 0))`;
    const section = await tx.performanceEvaluationSection.findUnique({ where: { id: input.sectionId } });
    if (!section) throw workflowError('بخش ارزیابی پیدا نشد.', 'PERFORMANCE_SECTION_NOT_FOUND', 404);
    if (!['DRAFT', 'REJECTED'].includes(section.status)) throw workflowError('مهلت فقط پیش از ارسال یا پس از بازگشت برای اصلاح قابل تمدید است.', 'PERFORMANCE_EXTENSION_STATE_INVALID', 409);
    if (!section.submissionDueAt || input.dueAt <= section.submissionDueAt) throw workflowError('مهلت تازه باید پس از مهلت فعلی باشد.', 'PERFORMANCE_EXTENSION_INVALID', 422);
    if (!(await activeHrActionPermissionsForUser(tx, input.actorUserId)).includes('MANAGE_PERFORMANCE_CYCLE')) {
      throw workflowError('مجوز مدیریت نوبت عملکرد را ندارید.', 'PERFORMANCE_CYCLE_PERMISSION_REQUIRED', 403);
    }
    await admitSectionWrite(tx, section.evaluationId, 'MANAGE_PERFORMANCE_CYCLE');
    const updated = await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: {
      submissionDueAt: input.dueAt, extensionCount: { increment: 1 }, windowClosedAt: null,
    } });
    const id = randomUUID();
    await tx.performanceAuditEvent.create({ data: {
      id, aggregateType: 'EVALUATION_SECTION', aggregateId: section.id, eventType: 'DEADLINE_EXTENDED',
      actorUserId: input.actorUserId, reason, eventHash: canonicalPerformanceHash({ id, sectionId: section.id, dueAt: input.dueAt.toISOString(), reason }),
    } });
    return updated;
  });
};

export const listPerformanceLifecycleSections = async (client: PrismaClient, input: { actorUserId: string }) => {
  const permissions = new Set(await activeHrActionPermissionsForUser(client, input.actorUserId));
  const canManage = permissions.has('MANAGE_PERFORMANCE_CYCLE');
  const canReview = permissions.has('REVIEW_PERFORMANCE_EVALUATION');
  const canPause = permissions.has('PAUSE_PERFORMANCE_EVALUATION');
  if (!canManage && !canReview && !canPause) return [];
  const effectiveResults = canPause ? await client.performanceAcceptedResult.findMany({ where: { status: 'EFFECTIVE' }, select: { id: true } }) : [];
  const pausableEvaluationIds = canPause ? (await client.performanceEvaluation.findMany({
    where: { acceptedResultId: { in: effectiveResults.map(({ id }) => id) } }, select: { id: true },
  })).map(({ id }) => id) : [];
  const sections = await client.performanceEvaluationSection.findMany({
    where: canManage ? { status: { in: ['DRAFT', 'REJECTED', 'SUBMITTED', 'ACCEPTED'] } } : {
      OR: [
        ...(canReview ? [{ status: 'SUBMITTED' as const }] : []),
        ...(canPause ? [{ evaluationId: { in: pausableEvaluationIds } }] : []),
      ],
    },
    orderBy: [{ submissionDueAt: 'asc' }, { effectiveFrom: 'asc' }], take: 250,
  });
  const evaluations = await client.performanceEvaluation.findMany({
    where: { id: { in: [...new Set(sections.map(({ evaluationId }) => evaluationId))] } },
    select: { id: true, subjectId: true, status: true, acceptedResultId: true },
  });
  const subjects = await client.performanceSubject.findMany({
    where: { id: { in: [...new Set(evaluations.map(({ subjectId }) => subjectId))] } }, select: { id: true, personnelId: true },
  });
  const personnel = await client.personnel.findMany({
    where: { id: { in: subjects.flatMap(({ personnelId }) => personnelId ? [personnelId] : []) } },
    select: { id: true, firstName: true, lastName: true },
  });
  const evaluationById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const personnelById = new Map(personnel.map((person) => [person.id, person]));
  return sections.map((section) => {
    const evaluation = evaluationById.get(section.evaluationId)!;
    const person = personnelById.get(subjectById.get(evaluation.subjectId)?.personnelId ?? '');
    return {
      id: section.id, evaluationId: section.evaluationId, status: section.status,
      effectiveFrom: section.effectiveFrom, effectiveTo: section.effectiveTo,
      submissionDueAt: section.submissionDueAt, reviewDueAt: section.reviewDueAt,
      evaluationStatus: evaluation.status,
      hasAcceptedResult: effectiveResults.some(({ id }) => id === evaluation.acceptedResultId),
      personnel: { displayName: person ? `${person.firstName} ${person.lastName}` : 'هویت جداشده' },
    };
  });
};

const terminateEvaluation = async (client: PrismaClient, input: {
  evaluationId: string;
  actorUserId: string;
  reason: string;
  target: 'CANCELLED' | 'INVALIDATED';
  keyring?: PerformanceVaultKey;
}) => {
  const reason = requirePerformanceReason(input.reason, input.target === 'CANCELLED' ? 'لغو ارزیابی' : 'نامعتبرسازی ارزیابی');
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  return runPerformanceSerializableTransaction(client, async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-evaluation:' + input.evaluationId}, 0))`;
    const evaluation = await tx.performanceEvaluation.findUnique({ where: { id: input.evaluationId } });
    if (!evaluation) throw workflowError('پرونده ارزیابی پیدا نشد.', 'PERFORMANCE_EVALUATION_NOT_FOUND', 404);
    if (input.target === 'INVALIDATED' && !(await activeHrActionPermissionsForUser(tx, input.actorUserId, new Date())).includes('PAUSE_PERFORMANCE_EVALUATION')) {
      throw workflowError('مجوز مستقل تعلیق اثر ارزیابی را ندارید.', 'PERFORMANCE_INVALIDATION_PERMISSION_REVOKED', 403);
    }
    if (input.target === 'CANCELLED') {
      if (!(await activeHrActionPermissionsForUser(tx, input.actorUserId)).includes('MANAGE_PERFORMANCE_CYCLE')) {
        throw workflowError('مجوز مدیریت نوبت عملکرد را ندارید.', 'PERFORMANCE_CYCLE_PERMISSION_REQUIRED', 403);
      }
      await assertPersonnelPerformanceWriteAdmission(tx, 'MANAGE_PERFORMANCE_CYCLE', evaluation.subjectId);
    }
    if (input.target === 'CANCELLED' && evaluation.acceptedResultId) throw workflowError('نتیجه مصوب فقط از مسیر تعلیق اثر و اصلاح قابل تغییر است.', 'PERFORMANCE_ACCEPTED_CANCELLATION_FORBIDDEN', 409);
    if (input.target === 'CANCELLED' && !['DRAFT', 'SUBMITTED', 'REJECTED'].includes(evaluation.status)) throw workflowError('این پرونده در وضعیت قابل لغو نیست.', 'PERFORMANCE_CANCELLATION_STATE_INVALID', 409);
    if (['CANCELLED', 'INVALIDATED'].includes(evaluation.status)) return evaluation;
    const mutableStatuses = ['DRAFT', 'SUBMITTED', 'REJECTED', 'ACCEPTED', 'NOT_EVALUABLE'] as const;
    for (const status of mutableStatuses) await tx.performanceEvaluationSection.updateMany({
      where: { evaluationId: evaluation.id, status }, data: { status: input.target },
    });
    const updated = await tx.performanceEvaluation.update({ where: { id: evaluation.id }, data: { status: input.target, writerVersion: { increment: 1 } } });
    const id = randomUUID();
    await tx.performanceAuditEvent.create({ data: {
      id, aggregateType: 'EVALUATION', aggregateId: evaluation.id,
      eventType: input.target === 'CANCELLED' ? 'EVALUATION_CANCELLED' : 'EVALUATION_INVALIDATED',
      actorUserId: input.actorUserId, reason,
      eventHash: canonicalPerformanceHash({ id, evaluationId: evaluation.id, target: input.target, reason }),
    } });
    if (input.target === 'INVALIDATED' && evaluation.acceptedResultId) {
      const suspended = await tx.performanceAcceptedResult.updateMany({
        where: { id: evaluation.acceptedResultId, status: PerformanceResultStatus.EFFECTIVE },
        data: { status: PerformanceResultStatus.SUSPENDED },
      });
      if (suspended.count) {
        const resultAuditId = randomUUID();
        const resultEvidence = await persistPerformancePayload(tx, {
          aggregateType: 'ACCEPTED_RESULT', aggregateId: resultAuditId, payloadKind: 'AUDIT_EVENT', schemaVersion: 1,
          payload: { evaluationId: evaluation.id, previousStatus: 'EFFECTIVE', nextStatus: 'SUSPENDED' }, keyring,
        });
        const previous = await tx.performanceAuditEvent.findFirst({
          where: { aggregateType: 'ACCEPTED_RESULT', aggregateId: evaluation.acceptedResultId }, orderBy: { occurredAt: 'desc' },
        });
        await tx.performanceAuditEvent.create({ data: {
          id: resultAuditId, aggregateType: 'ACCEPTED_RESULT', aggregateId: evaluation.acceptedResultId,
          eventType: 'RESULT_SUSPENDED', actorUserId: input.actorUserId, reason,
          encryptedPayloadId: resultEvidence.id, previousEventHash: previous?.eventHash,
          eventHash: canonicalPerformanceHash({ resultAuditId, resultId: evaluation.acceptedResultId, evidenceHash: resultEvidence.contentHash }),
        } });
      }
      await recomputePerformanceProjectionsInTransaction(tx, {
        now: new Date(), actorUserId: input.actorUserId, reason: 'نامعتبرسازی دلیل‌دار ارزیابی و تعلیق اثر نتیجه', keyring,
      });
    }
    return updated;
  });
};

export const cancelPerformanceEvaluation = (client: PrismaClient, input: Omit<Parameters<typeof terminateEvaluation>[1], 'target'>) => terminateEvaluation(client, { ...input, target: 'CANCELLED' });
export const invalidatePerformanceEvaluation = (client: PrismaClient, input: Omit<Parameters<typeof terminateEvaluation>[1], 'target'>) => terminateEvaluation(client, { ...input, target: 'INVALIDATED' });

export const runPerformanceReminders = async (client: PrismaClient, input: { actorUserId: string; now?: Date }) => {
  const now = input.now ?? new Date();
  const sections = await client.performanceEvaluationSection.findMany({ where: {
    status: { in: ['DRAFT', 'REJECTED'] }, submissionDueAt: { not: null }, windowClosedAt: null,
  } });
  let notifications = 0;
  for (const section of sections) {
    const daysUntilDue = Math.ceil((section.submissionDueAt!.getTime() - now.getTime()) / DAY_MS);
    if (![3, 1, 0].includes(daysUntilDue) && daysUntilDue > 0) continue;
    const supervisor = await client.user.findFirst({ where: { personnelId: section.responsibleSupervisorPersonnelId, isActive: true }, select: { id: true } });
    if (!supervisor) continue;
    const cadence = daysUntilDue < 0 ? `overdue-${Math.abs(daysUntilDue)}` : `due-${daysUntilDue}`;
    await notify(client, {
      type: 'PERFORMANCE_REMINDER', deduplicationKey: `performance-reminder:${section.id}:${cadence}`,
      recipientIds: [supervisor.id], actorId: input.actorUserId,
      resourceType: 'PERFORMANCE_EVALUATION_SECTION', resourceId: section.id,
      actionUrl: `/dashboard/hr/personnel/performance/supervisor/${section.id}`,
    });
    notifications += 1;
  }
  const reviewSections = await client.performanceEvaluationSection.findMany({ where: {
    status: 'SUBMITTED', reviewDueAt: { not: null }, windowClosedAt: null,
  } });
  const reviewerIds = await usersWithPerformancePermission(client, 'REVIEW_PERFORMANCE_EVALUATION', now);
  for (const section of reviewSections) {
    const daysUntilDue = Math.ceil((section.reviewDueAt!.getTime() - now.getTime()) / DAY_MS);
    if (![3, 1, 0].includes(daysUntilDue) && daysUntilDue > 0) continue;
    const cadence = daysUntilDue < 0 ? `overdue-${Math.abs(daysUntilDue)}` : `due-${daysUntilDue}`;
    await notify(client, {
      type: 'PERFORMANCE_REMINDER', deduplicationKey: `performance-review-reminder:${section.id}:${cadence}`,
      recipientIds: reviewerIds, actorId: input.actorUserId,
      resourceType: 'PERFORMANCE_EVALUATION_SECTION', resourceId: section.id,
      actionUrl: '/dashboard/hr/personnel/performance',
    });
    notifications += reviewerIds.length ? 1 : 0;
  }
  const [latestReadinessRun, rejectedReviews, currentlyRejectedSections] = await Promise.all([
    client.performanceReadinessRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    client.performanceReview.findMany({ where: { decision: 'REJECTED' }, select: { submissionId: true } }),
    client.performanceEvaluationSection.findMany({ where: { status: 'REJECTED' }, select: { id: true } }),
  ]);
  const rejectedSubmissions = rejectedReviews.length ? await client.performanceSubmission.findMany({
    where: {
      id: { in: rejectedReviews.map(({ submissionId }) => submissionId) },
      sectionId: { in: currentlyRejectedSections.map(({ id }) => id) },
    }, select: { sectionId: true },
  }) : [];
  const rejectionCounts = rejectedSubmissions.reduce((counts, { sectionId }) => counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1), new Map<string, number>());
  const repeatedRejectionCount = [...rejectionCounts.values()].filter((count) => count >= 2).length;
  const hrRecipientIds = await usersWithPerformancePermission(client, 'MANAGE_PERFORMANCE_CYCLE', now);
  const hasStructuralBlockers = Boolean(latestReadinessRun?.blockedCount);
  if ((hasStructuralBlockers || repeatedRejectionCount) && hrRecipientIds.length) {
    const weekStart = new Date(now);
    weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
    const weekKey = weekStart.toISOString().slice(0, 10);
    await notify(client, {
      type: 'PERFORMANCE_REMINDER', deduplicationKey: `performance-hr-weekly-summary:${weekKey}`,
      recipientIds: hrRecipientIds, actorId: input.actorUserId,
      resourceType: hasStructuralBlockers ? 'PERFORMANCE_READINESS_RUN' : 'PERSONNEL_PERFORMANCE',
      resourceId: hasStructuralBlockers ? latestReadinessRun!.id : 'workflow', actionUrl: '/dashboard/hr/personnel/performance',
    });
    notifications += 1;
  }
  return { scanned: sections.length + reviewSections.length, notifications };
};
