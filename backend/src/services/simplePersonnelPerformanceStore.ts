import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import {
  calculateSimplePerformance,
  canEvaluatePersonnel,
  SIMPLE_PERFORMANCE_LEVEL_LABELS,
  validateSimpleEvaluationDate,
  type SimpleEvaluatorAuthority,
  type SimplePerformanceDirection,
} from './simplePersonnelPerformance';

type Client = PrismaClient | Prisma.TransactionClient;

const runTransaction = <T>(client: Client, work: (tx: Prisma.TransactionClient) => Promise<T>) => (
  '$transaction' in client
    ? (client as PrismaClient).$transaction(work)
    : work(client as Prisma.TransactionClient)
);

const simpleError = (message: string, code: string, status = 422) => Object.assign(new Error(message), { code, status });
const activeAt = (now: Date) => ({ effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] });

const isResponsibleSupervisor = async (client: Client, actorUserId: string, personnelId: string, now = new Date()) => {
  const actor = await client.user.findUnique({ where: { id: actorUserId }, select: { personnelId: true } });
  if (!actor?.personnelId) return false;
  const [performanceResponsibility, primaryAssignment] = await Promise.all([
    client.hrAssignmentPerformanceResponsibility.findFirst({
      where: {
        status: 'ACTIVE', ...activeAt(now),
        supervisorAssignment: { employmentRelationship: { personnelId: actor.personnelId } },
        employmentAssignment: { employmentRelationship: { personnelId } },
      },
      select: { id: true },
    }),
    client.hrEmploymentAssignment.findFirst({
      where: {
        ...activeAt(now), employmentRelationship: { personnelId },
        responsibleSupervisorAssignment: { employmentRelationship: { personnelId: actor.personnelId } },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(performanceResponsibility || primaryAssignment);
};

export const resolveSimpleEvaluationAuthority = async (
  client: Client,
  input: { actorUserId: string; personnelId: string; now?: Date },
): Promise<SimpleEvaluatorAuthority> => {
  const now = input.now ?? new Date();
  const permissions = new Set(await activeHrActionPermissionsForUser(client, input.actorUserId, now));
  const authority = canEvaluatePersonnel({
    hasEvaluateAll: permissions.has('EVALUATE_ALL_PERSONNEL'),
    hasEvaluateDirectReports: permissions.has('EVALUATE_DIRECT_REPORTS'),
    isResponsibleSupervisor: await isResponsibleSupervisor(client, input.actorUserId, input.personnelId, now),
  });
  if (!authority) throw simpleError('اجازه ارزیابی این پرسنل را ندارید.', 'SIMPLE_PERFORMANCE_FORBIDDEN', 403);
  return authority;
};

const evaluationInclude = {
  profile: { include: { indicators: { orderBy: { sortOrder: 'asc' as const } } } },
  values: { include: { indicator: true } },
} as const;

export const listSimplePerformanceProfiles = (client: Client) => client.simplePerformanceProfile.findMany({
  where: { isActive: true }, include: { indicators: { orderBy: { sortOrder: 'asc' } } }, orderBy: { nameFa: 'asc' },
});

export const getSimplePerformanceWorkspace = async (client: Client, actorUserId: string, now = new Date()) => {
  const permissions = new Set(await activeHrActionPermissionsForUser(client, actorUserId, now));
  const canSeeAll = permissions.has('VIEW_PERFORMANCE_EVALUATIONS')
    || permissions.has('EVALUATE_ALL_PERSONNEL') || permissions.has('MANAGE_PERFORMANCE_PROFILES');
  const canSeeReports = permissions.has('EVALUATE_DIRECT_REPORTS');
  if (!canSeeAll && !canSeeReports) throw simpleError('اجازه مشاهده ارزیابی‌ها را ندارید.', 'SIMPLE_PERFORMANCE_VIEW_FORBIDDEN', 403);

  let personnelIds: string[] | undefined;
  if (!canSeeAll) {
    const actor = await client.user.findUnique({ where: { id: actorUserId }, select: { personnelId: true } });
    if (!actor?.personnelId) personnelIds = [];
    else {
      const [responsibilities, primaryAssignments] = await Promise.all([
        client.hrAssignmentPerformanceResponsibility.findMany({
          where: { status: 'ACTIVE', ...activeAt(now), supervisorAssignment: { employmentRelationship: { personnelId: actor.personnelId } } },
          select: { employmentAssignment: { select: { employmentRelationship: { select: { personnelId: true } } } } },
        }),
        client.hrEmploymentAssignment.findMany({
          where: { ...activeAt(now), responsibleSupervisorAssignment: { employmentRelationship: { personnelId: actor.personnelId } } },
          select: { employmentRelationship: { select: { personnelId: true } } },
        }),
      ]);
      personnelIds = [...new Set([
        ...responsibilities.map((item) => item.employmentAssignment.employmentRelationship.personnelId),
        ...primaryAssignments.map((item) => item.employmentRelationship.personnelId),
      ])];
    }
  }
  const personnel = await client.personnel.findMany({
    where: { isActive: true, archivedAt: null, ...(personnelIds ? { id: { in: personnelIds } } : {}) },
    select: {
      id: true, firstName: true, lastName: true, employeeNumber: true,
      department: { select: { name: true } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const ids = personnel.map(({ id }) => id);
  const canSeeEvaluations = permissions.has('VIEW_PERFORMANCE_EVALUATIONS')
    || permissions.has('EVALUATE_ALL_PERSONNEL') || permissions.has('EVALUATE_DIRECT_REPORTS');
  const [assignments, evaluations, profiles] = await Promise.all([
    client.simplePerformanceProfileAssignment.findMany({ where: { personnelId: { in: ids } }, include: { profile: true } }),
    canSeeEvaluations ? client.simplePerformanceEvaluation.findMany({
      where: { personnelId: { in: ids } }, include: evaluationInclude,
      orderBy: [{ finalizedAt: 'desc' }, { createdAt: 'desc' }],
    }) : Promise.resolve([]),
    listSimplePerformanceProfiles(client),
  ]);
  return {
    currentUserId: actorUserId, personnel, assignments, evaluations, profiles,
    capabilities: Object.fromEntries([...permissions].map((code) => [code, true])),
  };
};

export const createSimplePerformanceProfile = async (client: Client, input: {
  actorUserId: string;
  stableKey?: string;
  nameFa: string;
  indicators: Array<{ code: string; categoryFa?: string; titleFa: string; unitFa: string; target: string; direction: SimplePerformanceDirection; weightPercent: string }>;
}) => {
  const nameFa = typeof input.nameFa === 'string' ? input.nameFa.trim() : '';
  if (!nameFa) throw simpleError('نام الگو را وارد کنید.', 'SIMPLE_PROFILE_NAME_REQUIRED');
  if (!Array.isArray(input.indicators)) throw simpleError('معیارهای الگو کامل نیست.', 'SIMPLE_PROFILE_INDICATORS_INVALID');
  const validNumber = (value: unknown) => typeof value === 'string' && /^\d+(?:\.\d{1,4})?$/.test(value.trim());
  const codes = new Set(input.indicators.map(({ code }) => typeof code === 'string' ? code.trim() : ''));
  if (!input.indicators.length || codes.size !== input.indicators.length || input.indicators.some((indicator) => (
    typeof indicator.code !== 'string' || !indicator.code.trim()
    || typeof indicator.titleFa !== 'string' || !indicator.titleFa.trim()
    || typeof indicator.unitFa !== 'string' || !indicator.unitFa.trim()
    || !validNumber(indicator.target) || !validNumber(indicator.weightPercent)
    || !['HIGHER_IS_BETTER', 'LOWER_IS_BETTER'].includes(indicator.direction)
  ))) throw simpleError('معیارهای الگو کامل نیست.', 'SIMPLE_PROFILE_INDICATORS_INVALID');
  calculateSimplePerformance(input.indicators.map((indicator, index) => ({
    indicatorId: indicator.code || String(index), direction: indicator.direction, target: indicator.target,
    actual: indicator.target, weightPercent: indicator.weightPercent,
  })));
  const stableKey = typeof input.stableKey === 'string' && input.stableKey.trim() ? input.stableKey.trim() : `profile-${randomUUID()}`;
  return runTransaction(client, async (tx) => {
    const previous = await tx.simplePerformanceProfile.findFirst({ where: { stableKey }, orderBy: { version: 'desc' } });
    if (previous) await tx.simplePerformanceProfile.updateMany({ where: { stableKey, isActive: true }, data: { isActive: false } });
    const profile = await tx.simplePerformanceProfile.create({
      data: {
        stableKey, nameFa, version: (previous?.version ?? 0) + 1, createdByUserId: input.actorUserId,
        indicators: { create: input.indicators.map((indicator, index) => ({
          code: indicator.code.trim(), categoryFa: indicator.categoryFa?.trim() || null,
          titleFa: indicator.titleFa.trim(), unitFa: indicator.unitFa.trim(), target: indicator.target,
          direction: indicator.direction, weightPercent: indicator.weightPercent, sortOrder: index + 1,
        })) },
      },
      include: { indicators: { orderBy: { sortOrder: 'asc' } } },
    });
    if (previous) {
      await tx.simplePerformanceProfileAssignment.updateMany({
        where: { profileId: previous.id },
        data: { profileId: profile.id, assignedByUserId: input.actorUserId, assignedAt: new Date() },
      });
    }
    return profile;
  });
};

export const assignSimplePerformanceProfile = async (client: Client, input: {
  actorUserId: string; personnelId: string; profileId: string;
}) => {
  const [profile, personnel] = await Promise.all([
    client.simplePerformanceProfile.findFirst({ where: { id: input.profileId, isActive: true } }),
    client.personnel.findFirst({ where: { id: input.personnelId, isActive: true, archivedAt: null } }),
  ]);
  if (!profile || !personnel) throw simpleError('پرسنل یا الگو پیدا نشد.', 'SIMPLE_PROFILE_ASSIGNMENT_INVALID', 404);
  return runTransaction(client, async (tx) => {
    const assignment = await tx.simplePerformanceProfileAssignment.upsert({
      where: { personnelId: input.personnelId },
      create: { personnelId: input.personnelId, profileId: input.profileId, assignedByUserId: input.actorUserId },
      update: { profileId: input.profileId, assignedByUserId: input.actorUserId, assignedAt: new Date() },
      include: { profile: true },
    });
    await tx.simplePerformanceAudit.create({ data: {
      personnelId: input.personnelId, actorUserId: input.actorUserId, eventType: 'PROFILE_ASSIGNED',
      details: { profileId: input.profileId },
    } });
    return assignment;
  });
};

export const createSimplePerformanceEvaluation = async (client: Client, input: {
  actorUserId: string; personnelId: string; evaluationDate: string;
}) => {
  const dateDecision = validateSimpleEvaluationDate(input.evaluationDate);
  if (!dateDecision.valid) throw simpleError(dateDecision.message!, 'SIMPLE_EVALUATION_DATE_INVALID');
  const authority = await resolveSimpleEvaluationAuthority(client, input);
  const assignment = await client.simplePerformanceProfileAssignment.findUnique({ where: { personnelId: input.personnelId } });
  if (!assignment) throw simpleError('ابتدا یک الگو برای این پرسنل انتخاب کنید.', 'SIMPLE_PROFILE_REQUIRED');
  return runTransaction(client, async (tx) => {
    const evaluation = await tx.simplePerformanceEvaluation.create({
      data: {
        personnelId: input.personnelId, profileId: assignment.profileId,
        evaluationDate: new Date(`${input.evaluationDate}T00:00:00.000Z`), evaluatorUserId: input.actorUserId,
        evaluatorAuthority: authority,
      },
      include: evaluationInclude,
    });
    await tx.simplePerformanceAudit.create({ data: {
      evaluationId: evaluation.id, personnelId: input.personnelId, actorUserId: input.actorUserId,
      authoritySource: authority, eventType: 'CREATED', details: { evaluationDate: input.evaluationDate },
    } });
    return evaluation;
  });
};

const ownOpenEvaluation = async (client: Client, evaluationId: string, actorUserId: string) => {
  const evaluation = await client.simplePerformanceEvaluation.findUnique({ where: { id: evaluationId }, include: evaluationInclude });
  if (!evaluation) throw simpleError('ارزیابی پیدا نشد.', 'SIMPLE_EVALUATION_NOT_FOUND', 404);
  if (evaluation.status !== 'DRAFT') throw simpleError('این نتیجه نهایی شده است.', 'SIMPLE_EVALUATION_LOCKED', 409);
  if (evaluation.evaluatorUserId !== actorUserId) throw simpleError('این پیش‌نویس متعلق به شما نیست.', 'SIMPLE_EVALUATION_DRAFT_OWNER', 403);
  await resolveSimpleEvaluationAuthority(client, { actorUserId, personnelId: evaluation.personnelId });
  return evaluation;
};

const normalizedValues = (evaluation: Awaited<ReturnType<typeof ownOpenEvaluation>>, values: Array<{ indicatorId: string; actual: string }>) => {
  const allowed = new Set(evaluation.profile.indicators.map(({ id }) => id));
  const unique = new Map<string, string>();
  for (const value of values) {
    if (!allowed.has(value.indicatorId) || unique.has(value.indicatorId)) throw simpleError('مقدار معیار معتبر نیست.', 'SIMPLE_VALUE_INVALID');
    if (typeof value.actual !== 'string' || !/^\d+(?:\.\d{1,4})?$/.test(value.actual.trim())) {
      throw simpleError('مقدار واقعی معتبر نیست.', 'SIMPLE_VALUE_INVALID');
    }
    const actual = new Prisma.Decimal(value.actual);
    if (actual.lt(0)) throw simpleError('مقدار واقعی نمی‌تواند منفی باشد.', 'SIMPLE_VALUE_INVALID');
    unique.set(value.indicatorId, actual.toString());
  }
  return [...unique].map(([indicatorId, actual]) => ({ indicatorId, actual }));
};

export const saveSimplePerformanceDraft = async (client: Client, input: {
  actorUserId: string; evaluationId: string; values: Array<{ indicatorId: string; actual: string }>;
}) => {
  return runTransaction(client, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "simple_performance_evaluations" WHERE "id" = ${input.evaluationId} FOR UPDATE`;
    const evaluation = await ownOpenEvaluation(tx, input.evaluationId, input.actorUserId);
    const values = normalizedValues(evaluation, input.values);
    await tx.simplePerformanceValue.deleteMany({ where: { evaluationId: evaluation.id } });
    if (values.length) await tx.simplePerformanceValue.createMany({ data: values.map((value) => ({ ...value, evaluationId: evaluation.id })) });
    await tx.simplePerformanceAudit.create({ data: {
      evaluationId: evaluation.id, personnelId: evaluation.personnelId, actorUserId: input.actorUserId,
      authoritySource: evaluation.evaluatorAuthority, eventType: 'DRAFT_SAVED', details: { valueCount: values.length },
    } });
    return tx.simplePerformanceEvaluation.findUniqueOrThrow({ where: { id: evaluation.id }, include: evaluationInclude });
  });
};

export const finalizeSimplePerformanceEvaluation = async (client: Client, input: { actorUserId: string; evaluationId: string }) => {
  return runTransaction(client, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "simple_performance_evaluations" WHERE "id" = ${input.evaluationId} FOR UPDATE`;
    const evaluation = await ownOpenEvaluation(tx, input.evaluationId, input.actorUserId);
    const byIndicator = new Map(evaluation.values.map((value) => [value.indicatorId, value.actual.toString()]));
    const calculation = calculateSimplePerformance(evaluation.profile.indicators.map((indicator) => ({
      indicatorId: indicator.id, direction: indicator.direction as SimplePerformanceDirection,
      target: indicator.target.toString(), actual: byIndicator.get(indicator.id) ?? null,
      weightPercent: indicator.weightPercent.toString(),
    })));
    const finalizedAt = new Date();
    const claimed = await tx.simplePerformanceEvaluation.updateMany({
      where: { id: evaluation.id, status: 'DRAFT', evaluatorUserId: input.actorUserId },
      data: { status: 'FINALIZING' },
    });
    if (claimed.count !== 1) throw simpleError('این ارزیابی قبلاً نهایی شده است.', 'SIMPLE_EVALUATION_LOCKED', 409);
    for (const indicator of calculation.indicators) {
      await tx.simplePerformanceValue.update({
        where: { evaluationId_indicatorId: { evaluationId: evaluation.id, indicatorId: indicator.indicatorId } },
        data: { score: indicator.score },
      });
    }
    if (evaluation.correctionOfId) {
      await tx.simplePerformanceEvaluation.update({ where: { id: evaluation.correctionOfId }, data: { supersededAt: finalizedAt } });
    }
    const result = await tx.simplePerformanceEvaluation.update({
      where: { id: evaluation.id },
      data: { status: 'FINAL', score: calculation.score, levelCode: calculation.level, finalizedAt },
      include: evaluationInclude,
    });
    await tx.simplePerformanceAudit.create({ data: {
      evaluationId: evaluation.id, personnelId: evaluation.personnelId, actorUserId: input.actorUserId,
      authoritySource: evaluation.evaluatorAuthority, eventType: 'FINALIZED',
      details: { score: calculation.score, levelCode: calculation.level },
    } });
    return result;
  });
};

export const createSimplePerformanceCorrection = async (client: Client, input: {
  actorUserId: string; evaluationId: string; reason: string;
}) => {
  const reason = input.reason.trim();
  if (!reason) throw simpleError('دلیل اصلاح را وارد کنید.', 'SIMPLE_CORRECTION_REASON_REQUIRED');
  return runTransaction(client, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "simple_performance_evaluations" WHERE "id" = ${input.evaluationId} FOR UPDATE`;
    const target = await tx.simplePerformanceEvaluation.findUnique({ where: { id: input.evaluationId }, include: evaluationInclude });
    if (!target || target.status !== 'FINAL' || target.supersededAt) throw simpleError('نتیجه قابل اصلاح نیست.', 'SIMPLE_CORRECTION_TARGET_INVALID', 409);
    const authority = await resolveSimpleEvaluationAuthority(tx, { actorUserId: input.actorUserId, personnelId: target.personnelId });
    const correction = await tx.simplePerformanceEvaluation.create({
      data: {
        personnelId: target.personnelId, profileId: target.profileId, evaluationDate: target.evaluationDate,
        evaluatorUserId: input.actorUserId, evaluatorAuthority: authority, correctionOfId: target.id,
        correctionReason: reason,
        values: { create: target.values.map((value) => ({ indicatorId: value.indicatorId, actual: value.actual })) },
      },
      include: evaluationInclude,
    });
    await tx.simplePerformanceAudit.create({ data: {
      evaluationId: correction.id, personnelId: target.personnelId, actorUserId: input.actorUserId,
      authoritySource: authority, eventType: 'CORRECTION_CREATED', reason, details: { correctionOfId: target.id },
    } });
    return correction;
  });
};

export const getSimplePerformanceBadges = async (client: Client, personnelIds: string[]) => {
  const evaluations = await client.simplePerformanceEvaluation.findMany({
    where: { personnelId: { in: personnelIds }, status: 'FINAL', supersededAt: null },
    orderBy: [{ finalizedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const badges: Record<string, unknown> = {};
  for (const evaluation of evaluations) {
    if (badges[evaluation.personnelId] || !evaluation.levelCode) continue;
    const levelCode = evaluation.levelCode as keyof typeof SIMPLE_PERFORMANCE_LEVEL_LABELS;
    badges[evaluation.personnelId] = {
      state: 'LEVEL', levelCode, labelFa: SIMPLE_PERFORMANCE_LEVEL_LABELS[levelCode],
      meaningFa: `امتیاز ${evaluation.score?.toString() ?? '۰'} از ۱۰۰`,
      newestMeasurementTo: evaluation.evaluationDate.toISOString(), version: 1,
    };
  }
  return badges;
};
