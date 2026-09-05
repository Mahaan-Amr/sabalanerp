import { createHash, randomUUID } from 'node:crypto';
import { PerformanceArtifactLifecycle, PerformancePolicyKind, PerformanceTemplateKind, Prisma, type PrismaClient } from '@prisma/client';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, persistPerformancePayload, type PerformanceVaultKey } from './personnelPerformancePayloadStore';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';
import { publishNotificationEvent } from './notificationService';
import {
  buildPerformanceReadinessSnapshot,
  derivePerformanceSectionPlans,
  type PerformanceReadinessAssignment,
} from './personnelPerformanceWorkflow';

const readinessError = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });
const DAY_MS = 86_400_000;

type ReadinessSourceRow = PerformanceReadinessAssignment & {
  organizationalUnitId: string | null;
  workplaceId: string | null;
  costCenterId: string | null;
  assignmentType: string;
};

const snapshotDefinition = (value: Prisma.JsonValue | null): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const definition = (value as Record<string, unknown>).definition;
  return definition && typeof definition === 'object' && !Array.isArray(definition)
    ? definition as Record<string, unknown>
    : value as Record<string, unknown>;
};

const later = (left: Date, right: Date) => left > right ? left : right;
const earlierOptional = (...values: Array<Date | null>) => {
  const dates = values.filter((value): value is Date => Boolean(value));
  return dates.length ? new Date(Math.min(...dates.map((value) => value.getTime()))) : null;
};

const loadReadinessSource = async (client: PrismaClient, period: { measurementFrom: Date; measurementTo: Date }) => {
  const rows = await client.hrEmploymentAssignment.findMany({
    where: {
      effectiveFrom: { lt: period.measurementTo },
      OR: [{ effectiveTo: null }, { effectiveTo: { gt: period.measurementFrom } }],
      employmentRelationship: {
        status: { in: ['ACTIVE', 'SUSPENDED', 'ENDED'] },
        effectiveFrom: { lt: period.measurementTo },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: period.measurementFrom } }],
      },
    },
    select: {
      id: true,
      type: true,
      effectiveFrom: true,
      effectiveTo: true,
      positionId: true,
      positionSnapshot: true,
      organizationalUnitId: true,
      organizationalUnitSnapshot: true,
      workplaceId: true,
      costCenterId: true,
      performanceAllocationPercent: true,
      employmentRelationship: { select: { id: true, personnelId: true, status: true, effectiveFrom: true, effectiveTo: true } },
      position: { select: { jobId: true } },
      responsibleSupervisorAssignmentId: true,
      responsibleSupervisorAssignment: {
        select: {
          effectiveFrom: true, effectiveTo: true,
          employmentRelationship: { select: { personnelId: true, status: true, effectiveFrom: true, effectiveTo: true } },
        },
      },
      performanceResponsibilities: {
        where: {
          status: 'ACTIVE',
          effectiveFrom: { lt: period.measurementTo },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: period.measurementFrom } }],
        },
        orderBy: { effectiveFrom: 'asc' },
        select: {
          id: true, supervisorAssignmentId: true, effectiveFrom: true, effectiveTo: true, allocationPercent: true,
          supervisorAssignment: {
            select: {
              effectiveFrom: true, effectiveTo: true,
              employmentRelationship: { select: { personnelId: true, status: true, effectiveFrom: true, effectiveTo: true } },
            },
          },
        },
      },
    },
    orderBy: { id: 'asc' },
  });
  const primaryRelationships = new Set(rows.filter(({ type }) => type === 'PRIMARY').map(({ employmentRelationship }) => employmentRelationship.id));
  const mapped = rows.map<ReadinessSourceRow>((row) => {
    const positionHistory = snapshotDefinition(row.positionSnapshot);
    const organizationalHistory = snapshotDefinition(row.organizationalUnitSnapshot);
    const effectiveFrom = later(row.effectiveFrom, row.employmentRelationship.effectiveFrom);
    const effectiveTo = earlierOptional(row.effectiveTo, row.employmentRelationship.effectiveTo);
    const sectionFrom = later(effectiveFrom, period.measurementFrom);
    const sectionTo = earlierOptional(effectiveTo, period.measurementTo) ?? period.measurementTo;
    const responsibilityPeriods = row.performanceResponsibilities.map((responsibility) => {
      const responsibilityFrom = later(responsibility.effectiveFrom, sectionFrom);
      const responsibilityTo = earlierOptional(responsibility.effectiveTo, sectionTo) ?? sectionTo;
      const supervisor = responsibility.supervisorAssignment;
      const supervisorCoversPeriod = ['ACTIVE', 'ENDED'].includes(supervisor.employmentRelationship.status)
        && supervisor.effectiveFrom <= responsibilityFrom
        && supervisor.employmentRelationship.effectiveFrom <= responsibilityFrom
        && (!supervisor.effectiveTo || supervisor.effectiveTo >= responsibilityTo)
        && (!supervisor.employmentRelationship.effectiveTo || supervisor.employmentRelationship.effectiveTo >= responsibilityTo);
      return {
        responsibilityId: responsibility.id,
        supervisorAssignmentId: responsibility.supervisorAssignmentId,
        supervisorPersonnelId: supervisorCoversPeriod ? supervisor.employmentRelationship.personnelId : null,
        allocationPercent: responsibility.allocationPercent.toFixed(2),
        effectiveFrom: responsibilityFrom,
        effectiveTo: responsibilityTo,
        supervisorCoversPeriod,
      };
    }).filter((responsibility) => responsibility.effectiveFrom < responsibility.effectiveTo);
    let coveredUntil = sectionFrom;
    const responsibilityHistoryComplete = responsibilityPeriods.every((responsibility) => {
      if (responsibility.effectiveFrom.getTime() !== coveredUntil.getTime()) return false;
      coveredUntil = responsibility.effectiveTo!;
      return responsibility.supervisorCoversPeriod;
    }) && coveredUntil.getTime() === sectionTo.getTime();
    const firstResponsibility = responsibilityPeriods[0];
    return {
      assignmentId: row.id,
      employmentRelationshipId: row.employmentRelationship.id,
      personnelId: row.employmentRelationship.personnelId,
      effectiveFrom,
      effectiveTo,
      responsibleSupervisorAssignmentId: firstResponsibility?.supervisorAssignmentId ?? row.responsibleSupervisorAssignmentId,
      responsibleSupervisorPersonnelId: firstResponsibility?.supervisorPersonnelId ?? null,
      responsibilityPeriods,
      responsibilityHistoryComplete,
      relationshipStatus: row.employmentRelationship.status as ReadinessSourceRow['relationshipStatus'],
      hasPrimaryAssignment: primaryRelationships.has(row.employmentRelationship.id),
      positionId: row.positionId ?? (typeof positionHistory?.id === 'string' ? positionHistory.id : null),
      jobId: row.position?.jobId ?? (typeof positionHistory?.jobId === 'string' ? positionHistory.jobId : null),
      hasHistoricalContext: Boolean(row.organizationalUnitId || organizationalHistory),
      performanceAllocationPercent: firstResponsibility?.allocationPercent ?? row.performanceAllocationPercent?.toFixed(2) ?? null,
      allocationConsistent: true,
      organizationalUnitId: row.organizationalUnitId ?? (typeof organizationalHistory?.id === 'string' ? organizationalHistory.id : null),
      workplaceId: row.workplaceId,
      costCenterId: row.costCenterId,
      assignmentType: row.type,
    };
  }).filter((row) => !row.effectiveTo || row.effectiveTo > row.effectiveFrom);
  for (const row of mapped) {
    const contexts = mapped
      .filter((candidate) => candidate.employmentRelationshipId === row.employmentRelationshipId)
      .flatMap((candidate) => candidate.responsibilityPeriods);
    const checkpoints = [...new Set(contexts.flatMap((context) => [context.effectiveFrom.getTime(), context.effectiveTo?.getTime()].filter((value): value is number => value !== undefined)))];
    row.allocationConsistent = checkpoints.every((checkpoint) => contexts
      .filter((context) => context.effectiveFrom.getTime() <= checkpoint && (!context.effectiveTo || context.effectiveTo.getTime() > checkpoint))
      .reduce((sum, context) => sum.add(context.allocationPercent), new Prisma.Decimal(0)).lte(100));
  }
  return mapped;
};

const sourceRowHash = (row: ReadinessSourceRow) => canonicalPerformanceHash({
  ...row,
  effectiveFrom: row.effectiveFrom.toISOString(),
  effectiveTo: row.effectiveTo?.toISOString() ?? null,
});

const readinessSourceSnapshot = (rows: ReadinessSourceRow[]) => ({
  count: rows.length,
  hash: canonicalPerformanceHash(rows
    .map((row) => ({ assignmentId: row.assignmentId, hash: sourceRowHash(row) }))
    .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId))),
});

const promoteCompleteEvaluations = async (client: PrismaClient, runId: string, rows: ReadinessSourceRow[]) => {
  const records = await client.performanceReadinessRecord.findMany({
    where: { runId }, select: { employmentAssignmentId: true, status: true, evaluationId: true },
  });
  const recordMap = new Map(records.map((record) => [record.employmentAssignmentId, record]));
  const relationshipIds = [...new Set(rows.map(({ employmentRelationshipId }) => employmentRelationshipId))];
  const evaluationIds = relationshipIds.flatMap((relationshipId) => {
    const assignmentIds = rows.filter((row) => row.employmentRelationshipId === relationshipId).map(({ assignmentId }) => assignmentId);
    if (!assignmentIds.length || assignmentIds.some((assignmentId) => recordMap.get(assignmentId)?.status !== 'APPLIED')) return [];
    const evaluationId = assignmentIds.map((assignmentId) => recordMap.get(assignmentId)?.evaluationId).find(Boolean);
    return evaluationId ? [evaluationId] : [];
  });
  await client.performanceEvaluation.updateMany({
    where: { id: { in: evaluationIds }, status: 'DRAFT' }, data: { status: 'READY_FOR_SUBMISSION' },
  });
  return evaluationIds;
};

const runStableKey = (input: { idempotencyKey: string; measurementFrom: Date; measurementTo: Date }) => createHash('sha256')
  .update(JSON.stringify({
    idempotencyKey: input.idempotencyKey.trim(),
    measurementFrom: input.measurementFrom.toISOString(),
    measurementTo: input.measurementTo.toISOString(),
  }))
  .digest('hex');

const appendReadinessAudit = async (tx: Prisma.TransactionClient, input: {
  runId: string;
  actorUserId: string;
  eventType: string;
  reason: string;
  evidence: unknown;
  keyring: PerformanceVaultKey;
}) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-readiness-audit:' + input.runId}, 0))`;
  const previous = await tx.performanceAuditEvent.findFirst({
    where: { aggregateType: 'READINESS_RUN', aggregateId: input.runId }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
  });
  const id = randomUUID();
  const encrypted = await persistPerformancePayload(tx, {
    aggregateType: 'READINESS_RUN', aggregateId: id, payloadKind: 'AUDIT_EVENT', schemaVersion: 1,
    payload: input.evidence, keyring: input.keyring,
  });
  return tx.performanceAuditEvent.create({ data: {
    id,
    aggregateType: 'READINESS_RUN',
    aggregateId: input.runId,
    eventType: input.eventType,
    actorUserId: input.actorUserId,
    reason: input.reason,
    encryptedPayloadId: encrypted.id,
    previousEventHash: previous?.eventHash,
    eventHash: canonicalPerformanceHash({ id, runId: input.runId, eventType: input.eventType, evidenceHash: encrypted.contentHash }),
  } });
};

const activeTemplateVersions = async (tx: Prisma.TransactionClient, row: ReadinessSourceRow, at: Date) => {
  const versions = await tx.performanceTemplateVersion.findMany({ where: {
    lifecycle: { in: [PerformanceArtifactLifecycle.ACTIVE, PerformanceArtifactLifecycle.RETIRED] },
    effectiveFrom: { lte: at },
    OR: [
      ...(row.jobId ? [{ templateKind: PerformanceTemplateKind.JOB_TEMPLATE, ownerId: row.jobId }] : []),
      ...(row.positionId ? [{ templateKind: PerformanceTemplateKind.POSITION_ADDENDUM, ownerId: row.positionId }] : []),
    ],
  }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }] });
  const selected = new Map<string, typeof versions[number]>();
  for (const version of versions) {
    const key = `${version.templateKind}:${version.ownerId}`;
    if (!selected.has(key)) selected.set(key, version);
  }
  return [...selected.values()].sort((left, right) => left.templateKind.localeCompare(right.templateKind));
};

const effectiveScoringPolicy = (tx: Prisma.TransactionClient, at: Date) => tx.performancePolicyVersion.findFirst({
  where: {
    policyKind: PerformancePolicyKind.SCORING,
    lifecycle: { in: [PerformanceArtifactLifecycle.ACTIVE, PerformanceArtifactLifecycle.RETIRED] },
    effectiveFrom: { lte: at },
  },
  orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
});

const processReadinessRow = async (
  client: PrismaClient,
  input: {
    runId: string;
    cycleId: string;
    row: ReadinessSourceRow;
    allRows: ReadinessSourceRow[];
    measurementFrom: Date;
    measurementTo: Date;
    actorUserId: string;
    keyring: PerformanceVaultKey;
  },
) => runPerformanceSerializableTransaction(client, async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-readiness-assignment:' + input.row.assignmentId}, 0))`;
  const existingRecord = await tx.performanceReadinessRecord.findUnique({
    where: { runId_employmentAssignmentId: { runId: input.runId, employmentAssignmentId: input.row.assignmentId } },
  });
  if (existingRecord?.status === 'APPLIED' || existingRecord?.status === 'BLOCKED') return existingRecord;
  const snapshot = buildPerformanceReadinessSnapshot([input.row]);
  const blocker = snapshot.blockers[0];
  if (blocker) {
    return tx.performanceReadinessRecord.upsert({
      where: { runId_employmentAssignmentId: { runId: input.runId, employmentAssignmentId: input.row.assignmentId } },
      create: {
        runId: input.runId, employmentAssignmentId: input.row.assignmentId, sourceHash: sourceRowHash(input.row),
        status: 'BLOCKED', blockerCode: blocker.code,
      },
      update: {
        sourceHash: sourceRowHash(input.row), status: 'BLOCKED', blockerCode: blocker.code,
        attemptCount: { increment: 1 }, lastErrorCode: null, processedAt: new Date(),
      },
    });
  }
  const periodRows = input.allRows.filter((row) => row.employmentRelationshipId === input.row.employmentRelationshipId);
  const plans = derivePerformanceSectionPlans(periodRows, input)
    .filter((candidate) => candidate.employmentAssignmentId === input.row.assignmentId);
  const planArtifacts = await Promise.all(plans.map(async (plan) => {
    const [templateVersions, scoringPolicy] = await Promise.all([
      activeTemplateVersions(tx, input.row, plan.effectiveFrom),
      effectiveScoringPolicy(tx, plan.effectiveFrom),
    ]);
    return { plan, templateVersions, scoringPolicy };
  }));
  const policyBlocker = planArtifacts.some(({ templateVersions }) => !templateVersions.some(({ templateKind }) => templateKind === PerformanceTemplateKind.JOB_TEMPLATE))
    ? 'JOB_TEMPLATE_VERSION_MISSING'
    : planArtifacts.some(({ scoringPolicy }) => !scoringPolicy?.encryptedPayloadId) ? 'SCORING_POLICY_VERSION_MISSING' : null;
  if (policyBlocker) return tx.performanceReadinessRecord.upsert({
    where: { runId_employmentAssignmentId: { runId: input.runId, employmentAssignmentId: input.row.assignmentId } },
    create: {
      runId: input.runId, employmentAssignmentId: input.row.assignmentId, sourceHash: sourceRowHash(input.row),
      status: 'BLOCKED', blockerCode: policyBlocker,
    },
    update: {
      sourceHash: sourceRowHash(input.row), status: 'BLOCKED', blockerCode: policyBlocker,
      attemptCount: { increment: 1 }, lastErrorCode: null, processedAt: new Date(),
    },
  });
  const subject = await tx.performanceSubject.upsert({
    where: { personnelId_employmentRelationshipId: {
      personnelId: input.row.personnelId, employmentRelationshipId: input.row.employmentRelationshipId,
    } },
    create: {
      stableKey: canonicalPerformanceHash({ relationshipId: input.row.employmentRelationshipId, subject: 'PERSONNEL_PERFORMANCE' }),
      nonDisplayKey: randomUUID(), personnelId: input.row.personnelId,
      employmentRelationshipId: input.row.employmentRelationshipId, createdByUserId: input.actorUserId,
    },
    update: {},
  });
  const evaluationStableKey = canonicalPerformanceHash({
    subjectId: subject.id, measurementFrom: input.measurementFrom.toISOString(), measurementTo: input.measurementTo.toISOString(),
  });
  const evaluation = await tx.performanceEvaluation.upsert({
    where: { stableKey: evaluationStableKey },
    create: {
      stableKey: evaluationStableKey, subjectId: subject.id, cycleId: input.cycleId,
      measurementFrom: input.measurementFrom, measurementTo: input.measurementTo, createdByUserId: input.actorUserId,
    },
    update: {},
  });
  if (!evaluation.contextSnapshotId) {
    const contextId = randomUUID();
    const contextPayload = await persistPerformancePayload(tx, {
      aggregateType: 'EVALUATION', aggregateId: evaluation.id, payloadKind: 'CONTEXT_SNAPSHOT', schemaVersion: 1,
      payload: {
        schemaVersion: 1, personnelId: input.row.personnelId,
        employmentRelationshipId: input.row.employmentRelationshipId,
        measurementFrom: input.measurementFrom.toISOString(), measurementTo: input.measurementTo.toISOString(),
        sourceAssignmentIds: input.allRows.filter((row) => row.employmentRelationshipId === input.row.employmentRelationshipId).map((row) => row.assignmentId).sort(),
        scoringPolicyVersionIds: [...new Set(planArtifacts.map(({ scoringPolicy }) => scoringPolicy!.id))].sort(),
      },
      keyring: input.keyring,
    });
    await tx.performanceSnapshot.create({ data: {
      id: contextId, evaluationId: evaluation.id, snapshotKind: 'EVALUATION_CONTEXT', version: 1,
      contentHash: contextPayload.contentHash, encryptedPayloadId: contextPayload.id,
    } });
    await tx.performanceEvaluation.update({ where: { id: evaluation.id }, data: { contextSnapshotId: contextId } });
  }

  const sections: Array<{ id: string }> = [];
  for (const { plan, templateVersions, scoringPolicy } of planArtifacts) {
    const frozenScoringPolicy = scoringPolicy!;
    const dueAt = new Date(plan.effectiveTo.getTime() + (7 * DAY_MS));
    const section = await tx.performanceEvaluationSection.upsert({
      where: { evaluationId_employmentAssignmentId_effectiveFrom: {
        evaluationId: evaluation.id, employmentAssignmentId: input.row.assignmentId, effectiveFrom: plan.effectiveFrom,
      } },
      create: {
        evaluationId: evaluation.id, employmentAssignmentId: input.row.assignmentId,
        responsibleSupervisorPersonnelId: plan.responsibleSupervisorPersonnelId,
        effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo, allocationPercent: new Prisma.Decimal(plan.allocationPercent),
        originalSubmissionDueAt: dueAt, submissionDueAt: dueAt,
      },
      update: {},
    });
    if (!section.templateSnapshotId) {
      const snapshotId = randomUUID();
      const templatePayload = await persistPerformancePayload(tx, {
        aggregateType: 'EVALUATION_SECTION', aggregateId: section.id, payloadKind: 'TEMPLATE_SNAPSHOT', schemaVersion: 1,
        payload: {
          schemaVersion: 1,
          assignment: {
            assignmentId: input.row.assignmentId, assignmentType: input.row.assignmentType,
            positionId: input.row.positionId, jobId: input.row.jobId,
            organizationalUnitId: input.row.organizationalUnitId, workplaceId: input.row.workplaceId, costCenterId: input.row.costCenterId,
            responsibleSupervisorAssignmentId: plan.responsibleSupervisorAssignmentId,
            responsibleSupervisorPersonnelId: plan.responsibleSupervisorPersonnelId,
            responsibilityId: plan.responsibilityId,
            effectiveFrom: plan.effectiveFrom.toISOString(), effectiveTo: plan.effectiveTo.toISOString(),
          },
          templateVersions: templateVersions.map((version) => ({
            id: version.id, kind: version.templateKind, ownerType: version.ownerType, ownerId: version.ownerId,
            version: version.version, contentHash: version.contentHash,
          })),
          scoringPolicyVersion: {
            id: frozenScoringPolicy.id, version: frozenScoringPolicy.version, contentHash: frozenScoringPolicy.contentHash,
          },
        },
        keyring: input.keyring,
      });
      await tx.performanceSnapshot.create({ data: {
        id: snapshotId, evaluationId: evaluation.id, sectionId: section.id, snapshotKind: 'SECTION_TEMPLATE', version: 1,
        contentHash: templatePayload.contentHash, encryptedPayloadId: templatePayload.id,
      } });
      for (const version of templateVersions) await tx.performanceArtifactSnapshotBinding.create({ data: {
        snapshotId, artifactType: version.templateKind, templateVersionId: version.id, contentHash: version.contentHash,
      } });
      await tx.performanceArtifactSnapshotBinding.create({ data: {
        snapshotId, artifactType: 'SCORING_POLICY', policyVersionId: frozenScoringPolicy.id, contentHash: frozenScoringPolicy.contentHash,
      } });
      await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { templateSnapshotId: snapshotId } });
    }
    const supervisorUser = await tx.user.findFirst({
      where: { personnelId: plan.responsibleSupervisorPersonnelId, isActive: true }, select: { id: true },
    });
    if (supervisorUser) await publishNotificationEvent(tx, {
      type: 'PERFORMANCE_SUPERVISOR_TASK',
      deduplicationKey: `performance-supervisor-task:${section.id}`,
      recipientIds: [supervisorUser.id], recipientGroups: { DIRECT_USER: [supervisorUser.id] },
      actorId: input.actorUserId, workspace: 'HUMAN_RESOURCES', feature: 'PERSONNEL_PERFORMANCE',
      resourceType: 'PERFORMANCE_EVALUATION_SECTION', resourceId: section.id,
      actionUrl: `/dashboard/hr/personnel/performance/supervisor/${section.id}`, payload: {},
    });
    sections.push(section);
  }
  return tx.performanceReadinessRecord.upsert({
    where: { runId_employmentAssignmentId: { runId: input.runId, employmentAssignmentId: input.row.assignmentId } },
    create: {
      runId: input.runId, employmentAssignmentId: input.row.assignmentId, sourceHash: sourceRowHash(input.row),
      status: 'APPLIED', evaluationId: evaluation.id, sectionId: sections[0]?.id,
    },
    update: {
      sourceHash: sourceRowHash(input.row), status: 'APPLIED', blockerCode: null, lastErrorCode: null,
      evaluationId: evaluation.id, sectionId: sections[0]?.id, attemptCount: { increment: 1 }, processedAt: new Date(),
    },
  });
});

export const reconstructPerformanceReadiness = async (client: PrismaClient, input: {
  idempotencyKey: string;
  measurementFrom: Date;
  measurementTo: Date;
  actorUserId: string;
  batchSize?: number;
  keyring?: PerformanceVaultKey;
}) => {
  if (!input.idempotencyKey.trim()) throw readinessError('کلید تکرارپذیری بازسازی آمادگی الزامی است.', 'PERFORMANCE_IDEMPOTENCY_KEY_REQUIRED', 422);
  if (!(input.measurementFrom < input.measurementTo)) throw readinessError('بازه بازسازی آمادگی معتبر نیست.', 'PERFORMANCE_PERIOD_INVALID', 422);
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  const batchSize = Math.min(500, Math.max(1, input.batchSize ?? 100));
  const rows = await loadReadinessSource(client, input);
  const snapshot = readinessSourceSnapshot(rows);
  const stableKey = runStableKey(input);
  let run = await client.performanceReadinessRun.findUnique({ where: { stableKey } });
  if (run && (run.sourceCount !== snapshot.count || run.sourceHash !== snapshot.hash)) {
    run = await client.performanceReadinessRun.update({
      where: { id: run.id }, data: { status: 'DRIFTED', driftDetected: true },
    });
    return { run, processed: 0, hasMore: false, drift: true };
  }
  if (!run) {
    run = await client.performanceReadinessRun.create({ data: {
      stableKey, measurementFrom: input.measurementFrom, measurementTo: input.measurementTo,
      sourceCount: snapshot.count, sourceHash: snapshot.hash, requestedByUserId: input.actorUserId,
    } });
  }
  if (run.status === 'COMPLETED') return { run, processed: 0, hasMore: false, drift: false };
  const cycleStableKey = canonicalPerformanceHash({ measurementFrom: input.measurementFrom.toISOString(), measurementTo: input.measurementTo.toISOString() });
  const cycle = await client.performanceCycle.upsert({
    where: { stableKey: cycleStableKey },
    create: {
      stableKey: cycleStableKey, labelFa: `چرخه عملکرد ${input.measurementFrom.toLocaleDateString('fa-IR')} تا ${input.measurementTo.toLocaleDateString('fa-IR')}`,
      measurementFrom: input.measurementFrom, measurementTo: input.measurementTo, createdByUserId: input.actorUserId,
    },
    update: {},
  });
  const candidates = rows.filter((row) => !run!.cursorAssignmentId || row.assignmentId > run!.cursorAssignmentId).slice(0, batchSize);
  for (const row of candidates) {
    try {
      await processReadinessRow(client, {
        runId: run.id, cycleId: cycle.id, row, allRows: rows,
        measurementFrom: input.measurementFrom, measurementTo: input.measurementTo,
        actorUserId: input.actorUserId, keyring,
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'PERFORMANCE_READINESS_RECORD_FAILED';
      await client.performanceReadinessRecord.upsert({
        where: { runId_employmentAssignmentId: { runId: run.id, employmentAssignmentId: row.assignmentId } },
        create: { runId: run.id, employmentAssignmentId: row.assignmentId, sourceHash: sourceRowHash(row), status: 'FAILED', lastErrorCode: code },
        update: { status: 'FAILED', lastErrorCode: code, attemptCount: { increment: 1 }, processedAt: new Date() },
      });
    }
    run = await client.performanceReadinessRun.update({ where: { id: run.id }, data: { cursorAssignmentId: row.assignmentId } });
  }
  const hasMore = rows.some((row) => !run!.cursorAssignmentId || row.assignmentId > run!.cursorAssignmentId);
  const counts = await client.performanceReadinessRecord.groupBy({ by: ['status'], where: { runId: run.id }, _count: true });
  const count = (status: string) => counts.find((item) => item.status === status)?._count ?? 0;
  if (!hasMore) {
    const failed = count('FAILED');
    if (!failed) {
      await promoteCompleteEvaluations(client, run.id, rows);
    }
    run = await client.performanceReadinessRun.update({ where: { id: run.id }, data: {
      status: failed ? 'FAILED' : 'COMPLETED', completedAt: failed ? null : new Date(),
      appliedCount: count('APPLIED'), blockedCount: count('BLOCKED'), failedCount: failed,
    } });
    await runPerformanceSerializableTransaction(client, (tx) => appendReadinessAudit(tx, {
      runId: run!.id, actorUserId: input.actorUserId,
      eventType: failed ? 'READINESS_FAILED' : 'READINESS_COMPLETED',
      reason: failed ? 'بازسازی آمادگی با رکوردهای نیازمند تلاش مجدد پایان یافت.' : 'بازسازی آمادگی داده عملکرد تکمیل شد.',
      evidence: { sourceCount: run!.sourceCount, sourceHash: run!.sourceHash, appliedCount: run!.appliedCount, blockedCount: run!.blockedCount, failedCount: run!.failedCount },
      keyring,
    }));
  }
  return { run, processed: candidates.length, hasMore, drift: false };
};

export const retryFailedPerformanceReadinessRecords = async (client: PrismaClient, input: {
  runId: string;
  actorUserId: string;
  batchSize?: number;
  keyring?: PerformanceVaultKey;
}) => {
  const run = await client.performanceReadinessRun.findUnique({ where: { id: input.runId } });
  if (!run) throw readinessError('اجرای بازسازی آمادگی پیدا نشد.', 'PERFORMANCE_READINESS_RUN_NOT_FOUND', 404);
  const rows = await loadReadinessSource(client, run);
  const snapshot = readinessSourceSnapshot(rows);
  if (snapshot.count !== run.sourceCount || snapshot.hash !== run.sourceHash) {
    await client.performanceReadinessRun.update({ where: { id: run.id }, data: { status: 'DRIFTED', driftDetected: true } });
    throw readinessError('منبع داده از زمان شروع بازسازی تغییر کرده است. ابتدا مغایرت را بررسی کنید.', 'PERFORMANCE_READINESS_DRIFT', 409);
  }
  const failed = await client.performanceReadinessRecord.findMany({
    where: { runId: run.id, status: 'FAILED' }, orderBy: { employmentAssignmentId: 'asc' }, take: Math.min(500, Math.max(1, input.batchSize ?? 100)),
  });
  const rowMap = new Map(rows.map((row) => [row.assignmentId, row]));
  const cycle = await client.performanceCycle.findFirstOrThrow({ where: { measurementFrom: run.measurementFrom, measurementTo: run.measurementTo } });
  const keyring = input.keyring ?? performanceVaultKeyFromEnvironment();
  for (const record of failed) {
    const row = rowMap.get(record.employmentAssignmentId);
    if (!row) continue;
    try {
      await processReadinessRow(client, {
        runId: run.id, cycleId: cycle.id, row, allRows: rows,
        measurementFrom: run.measurementFrom, measurementTo: run.measurementTo,
        actorUserId: input.actorUserId, keyring,
      });
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'PERFORMANCE_READINESS_RECORD_FAILED';
      await client.performanceReadinessRecord.update({
        where: { id: record.id },
        data: { status: 'FAILED', lastErrorCode: code, attemptCount: { increment: 1 }, processedAt: new Date() },
      });
    }
  }
  const counts = await client.performanceReadinessRecord.groupBy({ by: ['status'], where: { runId: run.id }, _count: true });
  const count = (status: string) => counts.find((item) => item.status === status)?._count ?? 0;
  const remainingFailures = count('FAILED');
  if (!remainingFailures) {
    await promoteCompleteEvaluations(client, run.id, rows);
  }
  const updated = await client.performanceReadinessRun.update({
    where: { id: run.id },
    data: {
      status: remainingFailures ? 'FAILED' : 'COMPLETED',
      completedAt: remainingFailures ? null : new Date(),
      appliedCount: count('APPLIED'), blockedCount: count('BLOCKED'), failedCount: remainingFailures,
    },
  });
  return { run: updated, retried: failed.length, remainingFailures };
};
