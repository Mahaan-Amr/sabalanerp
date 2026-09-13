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
const activeEmploymentForEvaluationDay = async (client: Client, personnelId: string, date: string) => {
  const dayFrom = new Date(`${date}T00:00:00.000+03:30`);
  const dayTo = new Date(`${date}T23:59:59.999+03:30`);
  const relationships = await client.hrEmploymentRelationship.findMany({
    where: {
      personnelId, status: 'ACTIVE', effectiveFrom: { lte: dayTo },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: dayFrom } }],
    },
  orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }],
  select: { id: true }, take: 2,
  });
  if (relationships.length > 1) throw simpleError('رابطه استخدامی نیاز به بررسی دارد.', 'SIMPLE_EMPLOYMENT_AMBIGUOUS', 409);
  return relationships[0] ?? null;
};

const isResponsibleSupervisor = async (client: Client, actorUserId: string, personnelId: string, now = new Date()) => {
  const actor = await client.user.findUnique({ where: { id: actorUserId }, select: { personnelId: true } });
  if (!actor?.personnelId) return false;
  const [performanceResponsibility, primaryAssignment] = await Promise.all([
    client.hrAssignmentPerformanceResponsibility.findFirst({
      where: {
        status: 'ACTIVE', ...activeAt(now),
        supervisorAssignment: { employmentRelationship: { personnelId: actor.personnelId, status: 'ACTIVE', ...activeAt(now) } },
        employmentAssignment: { employmentRelationship: { personnelId, status: 'ACTIVE', ...activeAt(now) } },
      },
      select: { id: true },
    }),
    client.hrEmploymentAssignment.findFirst({
      where: {
        ...activeAt(now), employmentRelationship: { personnelId, status: 'ACTIVE', ...activeAt(now) },
        responsibleSupervisorAssignment: { employmentRelationship: { personnelId: actor.personnelId, status: 'ACTIVE', ...activeAt(now) } },
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

  let directReportPersonnelIds: string[] = [];
  if (canSeeReports) {
    const actor = await client.user.findUnique({ where: { id: actorUserId }, select: { personnelId: true } });
    if (!actor?.personnelId) directReportPersonnelIds = [];
    else {
      const [responsibilities, primaryAssignments] = await Promise.all([
        client.hrAssignmentPerformanceResponsibility.findMany({
          where: {
            status: 'ACTIVE', ...activeAt(now),
            supervisorAssignment: { employmentRelationship: { personnelId: actor.personnelId, status: 'ACTIVE', ...activeAt(now) } },
            employmentAssignment: { employmentRelationship: { status: 'ACTIVE', ...activeAt(now) } },
          },
          select: { employmentAssignment: { select: { employmentRelationship: { select: { personnelId: true } } } } },
        }),
        client.hrEmploymentAssignment.findMany({
          where: {
            ...activeAt(now), employmentRelationship: { status: 'ACTIVE', ...activeAt(now) },
            responsibleSupervisorAssignment: { employmentRelationship: { personnelId: actor.personnelId, status: 'ACTIVE', ...activeAt(now) } },
          },
          select: { employmentRelationship: { select: { personnelId: true } } },
        }),
      ]);
      directReportPersonnelIds = [...new Set([
        ...responsibilities.map((item) => item.employmentAssignment.employmentRelationship.personnelId),
        ...primaryAssignments.map((item) => item.employmentRelationship.personnelId),
      ])];
    }
  }
  const personnelIds = canSeeAll ? undefined : directReportPersonnelIds;
  const personnel = await client.personnel.findMany({
    where: { isActive: true, archivedAt: null, hrEmploymentRelationships: { some: { status: 'ACTIVE', ...activeAt(now) } }, ...(personnelIds ? { id: { in: personnelIds } } : {}) },
    select: {
      id: true, firstName: true, lastName: true, employeeNumber: true,
      department: { select: { name: true } },
    },
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
  });
  const ids = personnel.map(({ id }) => id);
  const canViewHistory = permissions.has('VIEW_PERFORMANCE_EVALUATIONS');
  const canEvaluate = permissions.has('EVALUATE_ALL_PERSONNEL') || permissions.has('EVALUATE_DIRECT_REPORTS');
  const [historicalPersonnelIds, legacyHistoricalPersonnelIds] = canViewHistory ? await Promise.all([
    client.simplePerformanceEvaluation.findMany({ where: { status: 'FINAL' }, distinct: ['personnelId'], select: { personnelId: true } }),
    client.performanceSubject.findMany({ where: { personnelId: { not: null }, identityDetachedAt: null }, distinct: ['personnelId'], select: { personnelId: true } }),
  ]) : [[], []];
  const visibleEvaluationPersonnelIds = [...new Set([
    ...ids,
    ...historicalPersonnelIds.map(({ personnelId }) => personnelId),
    ...legacyHistoricalPersonnelIds.flatMap(({ personnelId }) => personnelId ? [personnelId] : []),
  ])];
  const [assignments, evaluations, profiles, historyPersonnel] = await Promise.all([
    client.simplePerformanceProfileAssignment.findMany({ where: { personnelId: { in: ids } }, include: { profile: true } }),
    canEvaluate ? client.simplePerformanceEvaluation.findMany({
      where: {
        personnelId: { in: ids }, status: 'DRAFT', evaluatorUserId: actorUserId,
      }, include: evaluationInclude,
      orderBy: [{ finalizedAt: 'desc' }, { createdAt: 'desc' }],
    }) : Promise.resolve([]),
    listSimplePerformanceProfiles(client),
    canViewHistory ? client.personnel.findMany({
      where: { id: { in: visibleEvaluationPersonnelIds } },
      select: { id: true, firstName: true, lastName: true, employeeNumber: true, department: { select: { name: true } } },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    }) : Promise.resolve([]),
  ]);
  const evaluatorIds = [...new Set(evaluations.map(({ evaluatorUserId }) => evaluatorUserId))];
  const evaluators = await client.user.findMany({
    where: { id: { in: evaluatorIds } }, select: { id: true, firstName: true, lastName: true },
  });
  const evaluatorNames = new Map(evaluators.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
  return {
    currentUserId: actorUserId, personnel, historyPersonnel, assignments,
    evaluations: evaluations.map((evaluation) => ({ ...evaluation, evaluatorNameFa: evaluatorNames.get(evaluation.evaluatorUserId) || 'نامشخص' })),
    profiles,
    evaluablePersonnelIds: permissions.has('EVALUATE_ALL_PERSONNEL') ? ids : ids.filter((id) => directReportPersonnelIds.includes(id)),
    capabilities: Object.fromEntries([...permissions].map((code) => [code, true])),
  };
};

export const getSimplePerformanceHistory = async (client: Client, input: {
  actorUserId: string; personnelId: string; page?: number; pageSize?: number;
}, now = new Date()) => {
  const permissions = new Set(await activeHrActionPermissionsForUser(client, input.actorUserId, now));
  if (!permissions.has('VIEW_PERFORMANCE_EVALUATIONS')) {
    throw simpleError('اجازه مشاهده سابقه را ندارید.', 'SIMPLE_PERFORMANCE_VIEW_FORBIDDEN', 403);
  }
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(input.pageSize ?? 50)));
  const where = { personnelId: input.personnelId, status: 'FINAL' } as const;
  const [evaluations, total] = await Promise.all([
    client.simplePerformanceEvaluation.findMany({
      where, include: evaluationInclude, orderBy: [{ finalizedAt: 'desc' }, { createdAt: 'desc' }],
      skip: (page - 1) * pageSize, take: pageSize,
    }),
    client.simplePerformanceEvaluation.count({ where }),
  ]);
  const evaluatorIds = [...new Set(evaluations.map(({ evaluatorUserId }) => evaluatorUserId))];
  const evaluators = await client.user.findMany({
    where: { id: { in: evaluatorIds } }, select: { id: true, firstName: true, lastName: true },
  });
  const evaluatorNames = new Map(evaluators.map((user) => [user.id, `${user.firstName} ${user.lastName}`.trim()]));
  return {
    evaluations: evaluations.map((evaluation) => ({
      ...evaluation, evaluatorNameFa: evaluatorNames.get(evaluation.evaluatorUserId) || 'نامشخص',
    })),
    page, pageSize, total, hasMore: page * pageSize < total,
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
    await tx.simplePerformanceAudit.create({ data: {
      actorUserId: input.actorUserId, eventType: 'PROFILE_VERSION_CREATED',
      details: { stableKey, profileId: profile.id, version: profile.version, previousProfileId: previous?.id ?? null },
    } });
    if (previous) {
      const affectedAssignments = await tx.simplePerformanceProfileAssignment.findMany({
        where: { profileId: previous.id }, select: { personnelId: true },
      });
      await tx.simplePerformanceProfileAssignment.updateMany({
        where: { profileId: previous.id },
        data: { profileId: profile.id, assignedByUserId: input.actorUserId, assignedAt: new Date() },
      });
      if (affectedAssignments.length) await tx.simplePerformanceAudit.createMany({ data: affectedAssignments.map(({ personnelId }) => ({
        personnelId, actorUserId: input.actorUserId, eventType: 'PROFILE_REASSIGNED',
        details: { previousProfileId: previous.id, profileId: profile.id },
      })) });
    }
    return profile;
  });
};

export const assignSimplePerformanceProfile = async (client: Client, input: {
  actorUserId: string; personnelId: string; profileId: string;
}) => {
  return runTransaction(client, async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "simple_performance_profiles" WHERE "id" = ${input.profileId} FOR UPDATE`;
    const [profile, personnel] = await Promise.all([
      tx.simplePerformanceProfile.findFirst({ where: { id: input.profileId, isActive: true } }),
      tx.personnel.findFirst({ where: { id: input.personnelId, isActive: true, archivedAt: null } }),
    ]);
    if (!profile || !personnel) throw simpleError('پرسنل یا الگو پیدا نشد.', 'SIMPLE_PROFILE_ASSIGNMENT_INVALID', 404);
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
  return runTransaction(client, async (tx) => {
    const authority = await resolveSimpleEvaluationAuthority(tx, input);
    const evaluationDate = new Date(`${input.evaluationDate}T00:00:00.000Z`);
    const relationship = await activeEmploymentForEvaluationDay(tx, input.personnelId, input.evaluationDate);
    if (!relationship) throw simpleError('رابطه استخدامی فعال پیدا نشد.', 'SIMPLE_EMPLOYMENT_REQUIRED');
    await tx.$queryRaw`SELECT "id" FROM "simple_performance_profile_assignments" WHERE "personnelId" = ${input.personnelId} FOR SHARE`;
    const assignment = await tx.simplePerformanceProfileAssignment.findUnique({ where: { personnelId: input.personnelId } });
    if (!assignment) throw simpleError('ابتدا یک الگو برای این پرسنل انتخاب کنید.', 'SIMPLE_PROFILE_REQUIRED');
    const evaluation = await tx.simplePerformanceEvaluation.create({
      data: {
        personnelId: input.personnelId, employmentRelationshipId: relationship.id, profileId: assignment.profileId,
        evaluationDate, evaluatorUserId: input.actorUserId,
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
  if (!evaluation.employmentRelationshipId || evaluation.employmentBindingStatus !== 'BOUND') {
    throw simpleError('این پیش‌نویس قدیمی قابل ادامه نیست.', 'SIMPLE_EVALUATION_EMPLOYMENT_UNRESOLVED', 409);
  }
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
    if (!target || target.status !== 'FINAL' || target.supersededAt
      || !target.employmentRelationshipId || target.employmentBindingStatus !== 'BOUND') {
      throw simpleError('نتیجه قابل اصلاح نیست.', 'SIMPLE_CORRECTION_TARGET_INVALID', 409);
    }
    const authority = await resolveSimpleEvaluationAuthority(tx, { actorUserId: input.actorUserId, personnelId: target.personnelId });
    const correction = await tx.simplePerformanceEvaluation.create({
      data: {
        personnelId: target.personnelId, employmentRelationshipId: target.employmentRelationshipId,
        profileId: target.profileId, evaluationDate: target.evaluationDate,
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

export const getSimplePerformanceBadges = async (client: Client, personnelIds: string[], now = new Date()) => {
  const relationships = await client.hrEmploymentRelationship.findMany({
    where: { personnelId: { in: personnelIds }, status: { in: ['ACTIVE', 'SUSPENDED'] }, ...activeAt(now) },
    orderBy: [{ effectiveFrom: 'desc' }, { createdAt: 'desc' }], select: { id: true, personnelId: true },
  });
  const relationshipsByPersonnel = new Map<string, string[]>();
  for (const relationship of relationships) {
    relationshipsByPersonnel.set(relationship.personnelId, [
      ...(relationshipsByPersonnel.get(relationship.personnelId) ?? []), relationship.id,
    ]);
  }
  const currentRelationshipByPersonnel = new Map<string, string>();
  const badges: Record<string, unknown> = {};
  for (const [personnelId, relationshipIds] of relationshipsByPersonnel) {
    if (relationshipIds.length === 1) currentRelationshipByPersonnel.set(personnelId, relationshipIds[0]);
    else if (relationshipIds.length > 1) badges[personnelId] = {
      state: 'UNASSESSED', labelFa: 'ارزیابی‌نشده', meaningFa: 'اطلاعات استخدام نیاز به بررسی دارد.', version: 1,
    };
  }
  const evaluations = await client.simplePerformanceEvaluation.findMany({
    where: { employmentRelationshipId: { in: [...currentRelationshipByPersonnel.values()] }, status: 'FINAL', supersededAt: null },
    orderBy: [{ finalizedAt: 'desc' }, { createdAt: 'desc' }],
  });
  for (const evaluation of evaluations) {
    if (badges[evaluation.personnelId] || !evaluation.levelCode
      || currentRelationshipByPersonnel.get(evaluation.personnelId) !== evaluation.employmentRelationshipId) continue;
    const levelCode = evaluation.levelCode as keyof typeof SIMPLE_PERFORMANCE_LEVEL_LABELS;
    badges[evaluation.personnelId] = {
      state: 'LEVEL', levelCode, labelFa: SIMPLE_PERFORMANCE_LEVEL_LABELS[levelCode],
      meaningFa: 'آخرین نتیجه نهایی عملکرد.',
      newestMeasurementTo: evaluation.evaluationDate.toISOString(), version: 1,
    };
  }
  return badges;
};
