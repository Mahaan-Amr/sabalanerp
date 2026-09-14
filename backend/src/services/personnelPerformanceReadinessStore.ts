import { createHash, randomUUID } from 'node:crypto';
import { PerformanceArtifactLifecycle, PerformancePolicyKind, PerformanceTemplateKind, Prisma, type PrismaClient } from '@prisma/client';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, persistPerformancePayload, type PerformanceVaultKey } from './personnelPerformancePayloadStore';
import { runPerformanceSerializableTransaction } from './personnelPerformancePolicyStore';
import { publishNotificationEvent } from './notificationService';
import {
  buildPerformanceReadinessSnapshotFacts,
  buildPerformanceReadinessSnapshot,
  derivePerformanceSectionPlans,
  type PerformanceReadinessAssignment,
} from './personnelPerformanceWorkflow';
import { projectFoundationAtEvent } from './hrFoundationGovernance';

const readinessError = (message: string, code: string, status = 400) => Object.assign(new Error(message), { code, status });
const DAY_MS = 86_400_000;
type Client = PrismaClient | Prisma.TransactionClient;

type EligibleReadinessSourceRow = PerformanceReadinessAssignment & {
  readinessKind: 'ELIGIBLE_ASSIGNMENT';
  sourceKey: string;
  organizationalUnitId: string | null;
  workplaceId: string | null;
  costCenterId: string | null;
  assignmentType: string;
};

type InventoryReadinessSourceRow = {
  readinessKind: 'STRUCTURAL_BLOCKER' | 'INELIGIBLE';
  sourceKey: string;
  personnelId: string;
  employmentRelationshipId: string | null;
  assignmentId: string | null;
  classification: PerformanceReadinessInventoryClassification;
};

export type PerformanceReadinessInventoryClassification = 'PERSONNEL_INACTIVE' | 'EMPLOYMENT_RELATIONSHIP_MISSING'
  | 'RELATIONSHIP_PLANNED' | 'RELATIONSHIP_OUTSIDE_PERIOD' | 'EMPLOYMENT_ASSIGNMENT_MISSING'
  | 'ASSIGNMENT_OUTSIDE_PERIOD' | 'RELATIONSHIP_INTERVAL_INVALID' | 'ASSIGNMENT_INTERVAL_INVALID';

type ReadinessSourceRow = EligibleReadinessSourceRow | InventoryReadinessSourceRow;

export type PerformanceReadinessCoverage = {
  inventory: { personnelCount: number; relationshipCount: number; assignmentCount: number };
  inventoryClassifications: Partial<Record<PerformanceReadinessInventoryClassification, number>>;
  periodEligibility: { personnelCount: number; relationshipCount: number; assignmentCount: number };
  structuralTemplateReadiness: {
    readyPersonnelCount: number;
    readyRelationshipCount: number;
    readyAssignmentCount: number;
    blockedSourceCount: number;
    failedSourceCount: number;
  };
  cohort: { subjectCount: number };
  acceptedResult: { subjectCount: number };
  resultBadge: { subjectCount: number };
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

const loadReadinessSource = async (client: Client, period: { measurementFrom: Date; measurementTo: Date }) => {
  const personnelRows = await client.personnel.findMany({
    select: {
      id: true,
      isActive: true,
      archivedAt: true,
      hrEmploymentRelationships: { orderBy: { id: 'asc' }, select: {
        id: true, status: true, effectiveFrom: true, effectiveTo: true,
        assignments: { orderBy: { id: 'asc' }, select: {
          id: true, type: true, effectiveFrom: true, effectiveTo: true,
          positionId: true, positionSnapshot: true, organizationalUnitId: true, organizationalUnitSnapshot: true,
          workplaceId: true, costCenterId: true, performanceAllocationPercent: true,
          position: { select: {
            id: true, code: true, codeOccurrence: true, title: true, jobId: true, organizationalUnitId: true,
            workplaceId: true, costCenterId: true, supervisorPositionId: true, capacity: true, isActive: true,
          } },
          responsibleSupervisorAssignmentId: true,
          responsibleSupervisorAssignment: { select: {
            effectiveFrom: true, effectiveTo: true,
            employmentRelationship: { select: { personnelId: true, status: true, effectiveFrom: true, effectiveTo: true } },
          } },
          performanceResponsibilities: {
            where: { status: 'ACTIVE' }, orderBy: { effectiveFrom: 'asc' },
            select: {
              id: true, supervisorAssignmentId: true, effectiveFrom: true, effectiveTo: true, allocationPercent: true,
              supervisorAssignment: { select: {
                effectiveFrom: true, effectiveTo: true,
                employmentRelationship: { select: { personnelId: true, status: true, effectiveFrom: true, effectiveTo: true } },
              } },
            },
          },
        } },
      } },
    },
    orderBy: { id: 'asc' },
  });
  const relationships = personnelRows.flatMap((personnel) => personnel.hrEmploymentRelationships.map((relationship) => ({
    ...relationship, personnelId: personnel.id,
  })));
  const personnelById = new Map(personnelRows.map((personnel) => [personnel.id, personnel]));
  const relationshipById = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  const activePersonnelIds = new Set(personnelRows.filter((personnel) => personnel.isActive && !personnel.archivedAt).map(({ id }) => id));
  const assignments = relationships.flatMap((relationship) => relationship.assignments.map((assignment) => ({
    ...assignment, employmentRelationshipId: relationship.id,
  })));
  const positionIds = [...new Set(assignments.map(({ positionId }) => positionId).filter((id): id is string => Boolean(id)))];
  const positionVersions = positionIds.length ? await client.hrFoundationLifecycleVersion.findMany({
    where: { entityType: 'POSITION', entityId: { in: positionIds } }, orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
    select: { entityId: true, version: true, effectiveFrom: true, afterJson: true },
  }) : [];
  const versionsByPosition = new Map<string, typeof positionVersions>();
  for (const version of positionVersions) versionsByPosition.set(version.entityId, [...(versionsByPosition.get(version.entityId) ?? []), version]);
  const eligibleRelationships = new Set(relationships.filter((relationship) => relationship.status !== 'PLANNED'
    && (!relationship.effectiveTo || relationship.effectiveFrom < relationship.effectiveTo)
    && relationship.effectiveFrom < period.measurementTo
    && (!relationship.effectiveTo || relationship.effectiveTo > period.measurementFrom)).map(({ id }) => id));
  const eligiblePersonnel = new Set(personnelRows.filter((personnel) => personnel.isActive && !personnel.archivedAt)
    .flatMap((personnel) => personnel.hrEmploymentRelationships.filter(({ id }) => eligibleRelationships.has(id)).map(() => personnel.id)));
  const eligibleAssignments = assignments.filter((assignment) => eligibleRelationships.has(assignment.employmentRelationshipId)
    && (!assignment.effectiveTo || assignment.effectiveFrom < assignment.effectiveTo)
    && assignment.effectiveFrom < period.measurementTo && (!assignment.effectiveTo || assignment.effectiveTo > period.measurementFrom));
  const primaryRelationships = new Set(eligibleAssignments.filter(({ type }) => type === 'PRIMARY').map(({ employmentRelationshipId }) => employmentRelationshipId));
  const mappedAssignments = eligibleAssignments.map<EligibleReadinessSourceRow>((row) => {
    const relationship = relationshipById.get(row.employmentRelationshipId)!;
    const personnel = personnelById.get(relationship.personnelId)!;
    const positionHistory = snapshotDefinition(row.positionSnapshot);
    const organizationalHistory = snapshotDefinition(row.organizationalUnitSnapshot);
    const effectiveFrom = later(row.effectiveFrom, relationship.effectiveFrom);
    const effectiveTo = earlierOptional(row.effectiveTo, relationship.effectiveTo);
    const sectionFrom = later(effectiveFrom, period.measurementFrom);
    const sectionTo = earlierOptional(effectiveTo, period.measurementTo) ?? period.measurementTo;
    const versions = row.position ? versionsByPosition.get(row.position.id) ?? [] : [];
    const contextBoundaries = [sectionFrom, ...versions
      .map(({ effectiveFrom }) => effectiveFrom)
      .filter((effectiveFrom) => effectiveFrom > sectionFrom && effectiveFrom < sectionTo), sectionTo]
      .sort((left, right) => left.getTime() - right.getTime());
    const contextPeriods = contextBoundaries.slice(0, -1).map((contextFrom, index) => {
      const definition = positionHistory ?? (row.position ? projectFoundationAtEvent(row.position, versions, contextFrom) : null);
      const applicableVersion = [...versions].reverse().find((version) => version.effectiveFrom <= contextFrom);
      return {
        effectiveFrom: contextFrom,
        effectiveTo: contextBoundaries[index + 1]!,
        positionId: row.positionId ?? (typeof definition?.id === 'string' ? definition.id : null),
        jobId: typeof definition?.jobId === 'string' ? definition.jobId : null,
        organizationalUnitId: (typeof definition?.organizationalUnitId === 'string' ? definition.organizationalUnitId : null)
          ?? row.organizationalUnitId ?? (typeof organizationalHistory?.id === 'string' ? organizationalHistory.id : null),
        workplaceId: (typeof definition?.workplaceId === 'string' ? definition.workplaceId : null) ?? row.workplaceId,
        costCenterId: (typeof definition?.costCenterId === 'string' ? definition.costCenterId : null) ?? row.costCenterId,
        sourceVersion: applicableVersion
          ? `HR_FOUNDATION_POSITION:${row.positionId}:${applicableVersion.version}`
          : `HR_EMPLOYMENT_ASSIGNMENT:${row.id}`,
      };
    });
    const firstContext = contextPeriods[0]!;
    const responsibilityPeriods = row.performanceResponsibilities.filter((responsibility) => responsibility.effectiveFrom < period.measurementTo
      && (!responsibility.effectiveTo || responsibility.effectiveTo > period.measurementFrom)).map((responsibility) => {
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
      readinessKind: 'ELIGIBLE_ASSIGNMENT',
      sourceKey: row.id,
      assignmentId: row.id,
      employmentRelationshipId: relationship.id,
      personnelId: personnel.id,
      effectiveFrom,
      effectiveTo,
      responsibleSupervisorAssignmentId: firstResponsibility?.supervisorAssignmentId ?? row.responsibleSupervisorAssignmentId,
      responsibleSupervisorPersonnelId: firstResponsibility?.supervisorPersonnelId ?? null,
      responsibilityPeriods,
      responsibilityHistoryComplete,
      relationshipStatus: relationship.status as EligibleReadinessSourceRow['relationshipStatus'],
      hasPrimaryAssignment: primaryRelationships.has(relationship.id),
      positionId: firstContext.positionId,
      jobId: firstContext.jobId,
      hasHistoricalContext: Boolean(positionHistory || versions.length)
        && contextPeriods.every((context) => Boolean(context.organizationalUnitId)),
      performanceAllocationPercent: firstResponsibility?.allocationPercent ?? row.performanceAllocationPercent?.toFixed(2) ?? null,
      allocationConsistent: true,
      organizationalUnitId: firstContext.organizationalUnitId,
      workplaceId: firstContext.workplaceId,
      costCenterId: firstContext.costCenterId,
      assignmentType: row.type,
      contextPeriods,
    };
  }).filter((row) => !row.effectiveTo || row.effectiveTo > row.effectiveFrom);
  const allocationEventsByRelationship = new Map<string, Map<number, Prisma.Decimal>>();
  for (const row of mappedAssignments) {
    const events = allocationEventsByRelationship.get(row.employmentRelationshipId) ?? new Map<number, Prisma.Decimal>();
    for (const responsibility of row.responsibilityPeriods) {
      const allocation = new Prisma.Decimal(responsibility.allocationPercent);
      const start = responsibility.effectiveFrom.getTime();
      events.set(start, (events.get(start) ?? new Prisma.Decimal(0)).add(allocation));
      if (responsibility.effectiveTo) {
        const end = responsibility.effectiveTo.getTime();
        events.set(end, (events.get(end) ?? new Prisma.Decimal(0)).sub(allocation));
      }
    }
    allocationEventsByRelationship.set(row.employmentRelationshipId, events);
  }
  const allocationConsistentByRelationship = new Map<string, boolean>();
  for (const [relationshipId, events] of allocationEventsByRelationship) {
    let total = new Prisma.Decimal(0);
    let consistent = true;
    for (const [, delta] of [...events].sort(([left], [right]) => left - right)) {
      total = total.add(delta);
      if (total.gt(100)) consistent = false;
    }
    allocationConsistentByRelationship.set(relationshipId, consistent);
  }
  for (const row of mappedAssignments) {
    row.allocationConsistent = allocationConsistentByRelationship.get(row.employmentRelationshipId) ?? true;
  }
  const eligibleByAssignmentId = new Map(mappedAssignments.filter((row) => activePersonnelIds.has(row.personnelId))
    .map((row) => [row.assignmentId, row]));
  const sourceRows: ReadinessSourceRow[] = personnelRows.flatMap((personnel) => {
    const activePersonnel = personnel.isActive && !personnel.archivedAt;
    if (!personnel.hrEmploymentRelationships.length) return [{
      readinessKind: activePersonnel ? 'STRUCTURAL_BLOCKER' : 'INELIGIBLE', sourceKey: `personnel:${personnel.id}`,
      personnelId: personnel.id, employmentRelationshipId: null, assignmentId: null,
      classification: activePersonnel ? 'EMPLOYMENT_RELATIONSHIP_MISSING' : 'PERSONNEL_INACTIVE',
    } satisfies InventoryReadinessSourceRow];
    return personnel.hrEmploymentRelationships.flatMap((relationship) => {
      const relationshipIntervalValid = !relationship.effectiveTo || relationship.effectiveFrom < relationship.effectiveTo;
      const relationshipEligible = eligibleRelationships.has(relationship.id);
      const ineligibleClassification = relationship.status === 'PLANNED' ? 'RELATIONSHIP_PLANNED' : 'RELATIONSHIP_OUTSIDE_PERIOD';
      if (!relationship.assignments.length) return [{
        readinessKind: activePersonnel && (relationshipEligible || !relationshipIntervalValid) ? 'STRUCTURAL_BLOCKER' : 'INELIGIBLE',
        sourceKey: `relationship:${relationship.id}`, personnelId: personnel.id,
        employmentRelationshipId: relationship.id, assignmentId: null,
        classification: !activePersonnel ? 'PERSONNEL_INACTIVE'
          : !relationshipIntervalValid ? 'RELATIONSHIP_INTERVAL_INVALID'
            : relationshipEligible ? 'EMPLOYMENT_ASSIGNMENT_MISSING' : ineligibleClassification,
      } satisfies InventoryReadinessSourceRow];
      return relationship.assignments.map((assignment): ReadinessSourceRow => {
        const eligible = activePersonnel ? eligibleByAssignmentId.get(assignment.id) : undefined;
        if (eligible) return eligible;
        const assignmentIntervalValid = !assignment.effectiveTo || assignment.effectiveFrom < assignment.effectiveTo;
        return {
          readinessKind: activePersonnel && (!relationshipIntervalValid || !assignmentIntervalValid) ? 'STRUCTURAL_BLOCKER' : 'INELIGIBLE',
          sourceKey: assignment.id, personnelId: personnel.id,
          employmentRelationshipId: relationship.id, assignmentId: assignment.id,
          classification: !activePersonnel ? 'PERSONNEL_INACTIVE'
            : !relationshipIntervalValid ? 'RELATIONSHIP_INTERVAL_INVALID'
              : !assignmentIntervalValid ? 'ASSIGNMENT_INTERVAL_INVALID'
                : !relationshipEligible ? ineligibleClassification : 'ASSIGNMENT_OUTSIDE_PERIOD',
        };
      });
    });
  }).sort((left, right) => left.sourceKey.localeCompare(right.sourceKey));
  return {
    rows: sourceRows,
    inventory: { personnelCount: personnelRows.length, relationshipCount: relationships.length, assignmentCount: assignments.length },
    periodEligibility: {
      personnelCount: eligiblePersonnel.size,
      relationshipCount: relationships.filter((relationship) => eligibleRelationships.has(relationship.id)
        && activePersonnelIds.has(relationship.personnelId)).length,
      assignmentCount: eligibleByAssignmentId.size,
    },
  };
};

const readinessCoverage = async (
  client: Client,
  source: Awaited<ReturnType<typeof loadReadinessSource>>,
  runId: string,
): Promise<PerformanceReadinessCoverage> => {
  const [statuses, appliedRecords, activeCohort, acceptedResultSubjects, badgeSubjects] = await Promise.all([
    client.performanceReadinessRecord.groupBy({ by: ['status'], where: { runId }, _count: true }),
    client.performanceReadinessRecord.findMany({
      where: { runId, status: 'APPLIED' }, select: { employmentAssignmentId: true },
    }),
    client.performanceCohortVersion.findFirst({
      where: { lifecycle: 'ACTIVE' }, orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }], select: { id: true },
    }),
    client.performanceEvaluation.findMany({
      where: { acceptedResultId: { not: null } },
      distinct: ['subjectId'], select: { subjectId: true },
    }),
    client.performanceCurrentLevelProjection.count({ where: { state: 'LEVEL', levelCode: { not: null } } }),
  ]);
  const count = (status: string) => statuses.find((item) => item.status === status)?._count ?? 0;
  const inventoryClassifications = inventoryClassificationCounts(source.rows);
  const inventoryBlockers = source.rows.filter((row) => row.readinessKind === 'STRUCTURAL_BLOCKER').length;
  const appliedAssignmentIds = new Set(appliedRecords.map(({ employmentAssignmentId }) => employmentAssignmentId));
  const readyRows = source.rows.filter((row): row is EligibleReadinessSourceRow => (
    row.readinessKind === 'ELIGIBLE_ASSIGNMENT' && appliedAssignmentIds.has(row.assignmentId)
  ));
  return {
    inventory: source.inventory,
    inventoryClassifications,
    periodEligibility: source.periodEligibility,
    structuralTemplateReadiness: {
      readyPersonnelCount: new Set(readyRows.map(({ personnelId }) => personnelId)).size,
      readyRelationshipCount: new Set(readyRows.map(({ employmentRelationshipId }) => employmentRelationshipId)).size,
      readyAssignmentCount: count('APPLIED'), blockedSourceCount: count('BLOCKED') + inventoryBlockers, failedSourceCount: count('FAILED'),
    },
    cohort: { subjectCount: activeCohort ? await client.performanceCohortMember.count({ where: { cohortVersionId: activeCohort.id } }) : 0 },
    acceptedResult: { subjectCount: acceptedResultSubjects.length },
    resultBadge: { subjectCount: badgeSubjects },
  };
};

const inventoryClassificationCounts = (rows: ReadinessSourceRow[]) => rows
  .filter((row): row is InventoryReadinessSourceRow => row.readinessKind !== 'ELIGIBLE_ASSIGNMENT')
  .reduce<Partial<Record<PerformanceReadinessInventoryClassification, number>>>((totals, row) => ({
    ...totals, [row.classification]: (totals[row.classification] ?? 0) + 1,
  }), {});

export const getPerformanceReadinessCoverage = async (client: PrismaClient, input: {
  runId: string;
}) => {
  const run = await client.performanceReadinessRun.findUnique({ where: { id: input.runId } });
  if (!run) throw readinessError('اجرای بازسازی آمادگی پیدا نشد.', 'PERFORMANCE_READINESS_RUN_NOT_FOUND', 404);
  const source = await loadReadinessSource(client, run);
  const snapshot = readinessSourceSnapshot(source.rows);
  if (snapshot.count !== run.sourceCount || snapshot.hash !== run.sourceHash) {
    throw readinessError('منبع داده از زمان اجرای بازسازی تغییر کرده است.', 'PERFORMANCE_READINESS_DRIFT', 409);
  }
  return readinessCoverage(client, source, run.id);
};

const sourceRowHash = (row: ReadinessSourceRow) => canonicalPerformanceHash(row.readinessKind === 'ELIGIBLE_ASSIGNMENT' ? {
  readinessKind: row.readinessKind,
  sourceKey: row.sourceKey,
  workflowHash: buildPerformanceReadinessSnapshot([row]).hash,
  organizationalUnitId: row.organizationalUnitId,
  workplaceId: row.workplaceId,
  costCenterId: row.costCenterId,
  assignmentType: row.assignmentType,
} : row);

const readinessSourceSnapshot = (rows: ReadinessSourceRow[]) => ({
  count: rows.length,
  hash: canonicalPerformanceHash(rows
    .map((row) => ({ sourceKey: row.sourceKey, hash: sourceRowHash(row) }))
    .sort((left, right) => left.sourceKey.localeCompare(right.sourceKey))),
});

const promoteCompleteEvaluations = async (client: Client, runId: string, rows: ReadinessSourceRow[]) => {
  const records = await client.performanceReadinessRecord.findMany({
    where: { runId }, select: { employmentAssignmentId: true, status: true, evaluationId: true },
  });
  const recordMap = new Map(records.map((record) => [record.employmentAssignmentId, record]));
  const eligibleRows = rows.filter((row): row is EligibleReadinessSourceRow => row.readinessKind === 'ELIGIBLE_ASSIGNMENT');
  const relationshipIds = [...new Set(eligibleRows.map(({ employmentRelationshipId }) => employmentRelationshipId))];
  const evaluationIds = relationshipIds.flatMap((relationshipId) => {
    const assignmentIds = eligibleRows.filter((row) => row.employmentRelationshipId === relationshipId).map(({ assignmentId }) => assignmentId);
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

const activeTemplateVersions = async (tx: Prisma.TransactionClient, row: EligibleReadinessSourceRow, at: Date) => {
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
  client: Client,
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
  const recordKey = input.row.sourceKey;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'performance-readiness-source:' + recordKey}, 0))`;
  const existingRecord = await tx.performanceReadinessRecord.findUnique({
    where: { runId_employmentAssignmentId: { runId: input.runId, employmentAssignmentId: recordKey } },
  });
  if (existingRecord && ['APPLIED', 'BLOCKED', 'INELIGIBLE'].includes(existingRecord.status)) return existingRecord;
  if (input.row.readinessKind !== 'ELIGIBLE_ASSIGNMENT') {
    return { sourceKey: recordKey, status: input.row.readinessKind, classification: input.row.classification };
  }
  const row = input.row;
  const snapshot = buildPerformanceReadinessSnapshot([row]);
  const blocker = snapshot.blockers[0];
  if (blocker) {
    return tx.performanceReadinessRecord.upsert({
      where: { runId_employmentAssignmentId: { runId: input.runId, employmentAssignmentId: recordKey } },
      create: {
        runId: input.runId, employmentAssignmentId: recordKey, sourceHash: sourceRowHash(row),
        status: 'BLOCKED', blockerCode: blocker.code,
      },
      update: {
        sourceHash: sourceRowHash(row), status: 'BLOCKED', blockerCode: blocker.code,
        attemptCount: { increment: 1 }, lastErrorCode: null, processedAt: new Date(),
      },
    });
  }
  const periodRows = input.allRows.filter((candidate): candidate is EligibleReadinessSourceRow => (
    candidate.readinessKind === 'ELIGIBLE_ASSIGNMENT' && candidate.employmentRelationshipId === row.employmentRelationshipId
  ));
  const plans = derivePerformanceSectionPlans(periodRows, input)
    .filter((candidate) => candidate.employmentAssignmentId === row.assignmentId);
  const planArtifacts = await Promise.all(plans.map(async (plan) => {
    const [templateVersions, scoringPolicy] = await Promise.all([
      activeTemplateVersions(tx, {
        ...row, jobId: plan.jobId ?? row.jobId, positionId: plan.positionId ?? row.positionId,
      }, plan.effectiveFrom),
      effectiveScoringPolicy(tx, plan.effectiveFrom),
    ]);
    return { plan, templateVersions, scoringPolicy };
  }));
  const policyBlocker = planArtifacts.some(({ templateVersions }) => !templateVersions.some(({ templateKind }) => templateKind === PerformanceTemplateKind.JOB_TEMPLATE))
    ? 'JOB_TEMPLATE_VERSION_MISSING'
    : planArtifacts.some(({ scoringPolicy }) => !scoringPolicy?.encryptedPayloadId) ? 'SCORING_POLICY_VERSION_MISSING' : null;
  if (policyBlocker) return tx.performanceReadinessRecord.upsert({
    where: { runId_employmentAssignmentId: { runId: input.runId, employmentAssignmentId: recordKey } },
    create: {
      runId: input.runId, employmentAssignmentId: recordKey, sourceHash: sourceRowHash(row),
      status: 'BLOCKED', blockerCode: policyBlocker,
    },
    update: {
      sourceHash: sourceRowHash(row), status: 'BLOCKED', blockerCode: policyBlocker,
      attemptCount: { increment: 1 }, lastErrorCode: null, processedAt: new Date(),
    },
  });
  const subject = await tx.performanceSubject.upsert({
    where: { personnelId_employmentRelationshipId: {
      personnelId: row.personnelId, employmentRelationshipId: row.employmentRelationshipId,
    } },
    create: {
      stableKey: canonicalPerformanceHash({ relationshipId: row.employmentRelationshipId, subject: 'PERSONNEL_PERFORMANCE' }),
      nonDisplayKey: randomUUID(), personnelId: row.personnelId,
      employmentRelationshipId: row.employmentRelationshipId, createdByUserId: input.actorUserId,
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
        schemaVersion: 1, personnelId: row.personnelId,
        employmentRelationshipId: row.employmentRelationshipId,
        measurementFrom: input.measurementFrom.toISOString(), measurementTo: input.measurementTo.toISOString(),
        sourceAssignmentIds: periodRows.map((candidate) => candidate.assignmentId).sort(),
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
        evaluationId: evaluation.id, employmentAssignmentId: row.assignmentId, effectiveFrom: plan.effectiveFrom,
      } },
      create: {
        evaluationId: evaluation.id, employmentAssignmentId: row.assignmentId,
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
            assignmentId: row.assignmentId,
            ...buildPerformanceReadinessSnapshotFacts({
              jobId: plan.jobId ?? row.jobId, positionId: plan.positionId ?? row.positionId,
              organizationalUnitId: plan.organizationalUnitId ?? row.organizationalUnitId,
              workplaceId: plan.workplaceId ?? row.workplaceId, assignmentType: row.assignmentType,
            }, plan.effectiveFrom, {
              jobId: plan.sourceVersion ?? `HR_EMPLOYMENT_ASSIGNMENT:${row.assignmentId}`,
              positionId: plan.sourceVersion ?? `HR_EMPLOYMENT_ASSIGNMENT:${row.assignmentId}`,
              organizationalUnitId: plan.sourceVersion ?? `HR_EMPLOYMENT_ASSIGNMENT:${row.assignmentId}`,
              workplaceId: plan.sourceVersion ?? `HR_EMPLOYMENT_ASSIGNMENT:${row.assignmentId}`,
              assignmentType: `HR_EMPLOYMENT_ASSIGNMENT:${row.assignmentId}`,
              effectiveDate: `PERFORMANCE_EVALUATION_SECTION:${section.id}`,
            }),
            costCenterId: plan.costCenterId ?? row.costCenterId,
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
    where: { runId_employmentAssignmentId: { runId: input.runId, employmentAssignmentId: recordKey } },
    create: {
      runId: input.runId, employmentAssignmentId: recordKey, sourceHash: sourceRowHash(row),
      status: 'APPLIED', evaluationId: evaluation.id, sectionId: sections[0]?.id,
    },
    update: {
      sourceHash: sourceRowHash(row), status: 'APPLIED', blockerCode: null, lastErrorCode: null,
      evaluationId: evaluation.id, sectionId: sections[0]?.id, attemptCount: { increment: 1 }, processedAt: new Date(),
    },
  });
});

export const reconstructPerformanceReadiness = async (client: Client, input: {
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
  const source = await loadReadinessSource(client, input);
  const rows = source.rows;
  const snapshot = readinessSourceSnapshot(rows);
  const stableKey = runStableKey(input);
  let run = await client.performanceReadinessRun.findUnique({ where: { stableKey } });
  if (run && (run.sourceCount !== snapshot.count || run.sourceHash !== snapshot.hash)) {
    run = await client.performanceReadinessRun.update({
      where: { id: run.id }, data: { status: 'DRIFTED', driftDetected: true },
    });
    return { run, processed: 0, hasMore: false, drift: true, businessCode: 'PERFORMANCE_READINESS_DRIFT' as const,
      coverage: await readinessCoverage(client, source, run.id) };
  }
  if (!run) {
    run = await client.performanceReadinessRun.create({ data: {
      stableKey, measurementFrom: input.measurementFrom, measurementTo: input.measurementTo,
      sourceCount: snapshot.count, sourceHash: snapshot.hash, requestedByUserId: input.actorUserId,
    } });
  }
  if (run.status === 'COMPLETED') return {
    run, processed: 0, hasMore: false, drift: false, coverage: await readinessCoverage(client, source, run.id),
  };
  const cycleStableKey = canonicalPerformanceHash({ measurementFrom: input.measurementFrom.toISOString(), measurementTo: input.measurementTo.toISOString() });
  const cycle = await client.performanceCycle.upsert({
    where: { stableKey: cycleStableKey },
    create: {
      stableKey: cycleStableKey, labelFa: `چرخه عملکرد ${input.measurementFrom.toLocaleDateString('fa-IR')} تا ${input.measurementTo.toLocaleDateString('fa-IR')}`,
      measurementFrom: input.measurementFrom, measurementTo: input.measurementTo, createdByUserId: input.actorUserId,
    },
    update: {},
  });
  const candidates = rows.filter((row) => !run!.cursorAssignmentId || row.sourceKey > run!.cursorAssignmentId).slice(0, batchSize);
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
        where: { runId_employmentAssignmentId: { runId: run.id, employmentAssignmentId: row.sourceKey } },
        create: { runId: run.id, employmentAssignmentId: row.sourceKey, sourceHash: sourceRowHash(row), status: 'FAILED', lastErrorCode: code },
        update: { status: 'FAILED', lastErrorCode: code, attemptCount: { increment: 1 }, processedAt: new Date() },
      });
    }
    run = await client.performanceReadinessRun.update({ where: { id: run.id }, data: { cursorAssignmentId: row.sourceKey } });
  }
  const hasMore = rows.some((row) => !run!.cursorAssignmentId || row.sourceKey > run!.cursorAssignmentId);
  const counts = await client.performanceReadinessRecord.groupBy({ by: ['status'], where: { runId: run.id }, _count: true });
  const count = (status: string) => counts.find((item) => item.status === status)?._count ?? 0;
  const inventoryBlockers = rows.filter((row) => row.readinessKind === 'STRUCTURAL_BLOCKER').length;
  if (!hasMore) {
    const finalSource = await loadReadinessSource(client, input);
    const finalSnapshot = readinessSourceSnapshot(finalSource.rows);
    if (finalSnapshot.count !== snapshot.count || finalSnapshot.hash !== snapshot.hash) {
      run = await client.performanceReadinessRun.update({
        where: { id: run.id }, data: { status: 'DRIFTED', driftDetected: true, completedAt: null },
      });
      return { run, processed: candidates.length, hasMore: false, drift: true,
        businessCode: 'PERFORMANCE_READINESS_DRIFT' as const,
        coverage: await readinessCoverage(client, finalSource, run.id) };
    }
    const failed = count('FAILED');
    if (!failed) {
      await promoteCompleteEvaluations(client, run.id, rows);
    }
    run = await client.performanceReadinessRun.update({ where: { id: run.id }, data: {
      status: failed ? 'FAILED' : 'COMPLETED', completedAt: failed ? null : new Date(),
      appliedCount: count('APPLIED'), blockedCount: count('BLOCKED') + inventoryBlockers, failedCount: failed,
    } });
    await runPerformanceSerializableTransaction(client, (tx) => appendReadinessAudit(tx, {
      runId: run!.id, actorUserId: input.actorUserId,
      eventType: failed ? 'READINESS_FAILED' : 'READINESS_COMPLETED',
      reason: failed ? 'بازسازی آمادگی با رکوردهای نیازمند تلاش مجدد پایان یافت.' : 'بازسازی آمادگی داده عملکرد تکمیل شد.',
      evidence: {
        sourceCount: run!.sourceCount, sourceHash: run!.sourceHash, appliedCount: run!.appliedCount,
        blockedCount: run!.blockedCount, failedCount: run!.failedCount,
        inventory: source.inventory,
        inventoryClassifications: inventoryClassificationCounts(rows),
        periodEligibility: source.periodEligibility,
      },
      keyring,
    }));
  }
  return { run, processed: candidates.length, hasMore, drift: false, coverage: await readinessCoverage(client, source, run.id) };
};

export const retryFailedPerformanceReadinessRecords = async (client: PrismaClient, input: {
  runId: string;
  actorUserId: string;
  batchSize?: number;
  keyring?: PerformanceVaultKey;
}) => {
  const run = await client.performanceReadinessRun.findUnique({ where: { id: input.runId } });
  if (!run) throw readinessError('اجرای بازسازی آمادگی پیدا نشد.', 'PERFORMANCE_READINESS_RUN_NOT_FOUND', 404);
  if (run.status !== 'FAILED') {
    throw readinessError('فقط اجرای ناموفق و کامل‌پیمایش‌شده قابل تلاش مجدد است.', 'PERFORMANCE_READINESS_RETRY_STATUS_INVALID', 409);
  }
  const source = await loadReadinessSource(client, run);
  const rows = source.rows;
  const snapshot = readinessSourceSnapshot(rows);
  if (snapshot.count !== run.sourceCount || snapshot.hash !== run.sourceHash) {
    await client.performanceReadinessRun.update({ where: { id: run.id }, data: { status: 'DRIFTED', driftDetected: true } });
    throw readinessError('منبع داده از زمان شروع بازسازی تغییر کرده است. ابتدا مغایرت را بررسی کنید.', 'PERFORMANCE_READINESS_DRIFT', 409);
  }
  if (rows.length && run.cursorAssignmentId !== rows.at(-1)?.sourceKey) {
    throw readinessError('پیمایش منبع این اجرا هنوز کامل نشده است.', 'PERFORMANCE_READINESS_RETRY_SOURCE_INCOMPLETE', 409);
  }
  const failed = await client.performanceReadinessRecord.findMany({
    where: { runId: run.id, status: 'FAILED' }, orderBy: { employmentAssignmentId: 'asc' }, take: Math.min(500, Math.max(1, input.batchSize ?? 100)),
  });
  const rowMap = new Map(rows.map((row) => [row.sourceKey, row]));
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
  const inventoryBlockers = rows.filter((row) => row.readinessKind === 'STRUCTURAL_BLOCKER').length;
  const remainingFailures = count('FAILED');
  if (!remainingFailures) {
    await promoteCompleteEvaluations(client, run.id, rows);
  }
  const updated = await runPerformanceSerializableTransaction(client, async (tx) => {
    const completedRun = await tx.performanceReadinessRun.update({
      where: { id: run.id },
      data: {
        status: remainingFailures ? 'FAILED' : 'COMPLETED',
        completedAt: remainingFailures ? null : new Date(),
        appliedCount: count('APPLIED'), blockedCount: count('BLOCKED') + inventoryBlockers, failedCount: remainingFailures,
      },
    });
    if (!remainingFailures && run.status !== 'COMPLETED') await appendReadinessAudit(tx, {
      runId: completedRun.id, actorUserId: input.actorUserId,
      eventType: 'READINESS_COMPLETED',
      reason: 'بازسازی آمادگی پس از تلاش مجدد رکوردهای ناموفق تکمیل شد.',
      evidence: {
        sourceCount: completedRun.sourceCount, sourceHash: completedRun.sourceHash,
        appliedCount: completedRun.appliedCount, blockedCount: completedRun.blockedCount, failedCount: completedRun.failedCount,
        inventory: source.inventory,
        inventoryClassifications: inventoryClassificationCounts(rows),
        periodEligibility: source.periodEligibility,
      },
      keyring,
    });
    return completedRun;
  });
  return {
    run: updated, retried: failed.length, remainingFailures,
    coverage: await readinessCoverage(client, source, updated.id),
  };
};
