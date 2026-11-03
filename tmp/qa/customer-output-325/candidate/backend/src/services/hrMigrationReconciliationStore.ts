import { Prisma, type PrismaClient } from '@prisma/client';
import {
  HR_RECONCILIATION_ATTENTION_FLAGS,
  HR_RECONCILIATION_PRIMARY_STATES,
  HR_RECONCILIATION_REVIEW_OUTCOMES,
  buildHrReconciliationFilter,
  summarizeHrReconciliationRows,
  type HrReconciliationReviewOutcome,
} from './hrMigrationReconciliation';

type StoreClient = PrismaClient | Prisma.TransactionClient;

const activeFlagCodes = (row: { attentionFlags: Array<{ flagCode: string; isActive: boolean }> }) => row.attentionFlags
  .filter((flag) => flag.isActive)
  .map((flag) => flag.flagCode);

export const projectHrReconciliationRow = (row: {
  id: string;
  sourceType: string;
  sourceId: string;
  primaryState: string;
  stateVersion: number;
  detailsJson: unknown;
  cutoverBlocker: boolean;
  classifiedAt: Date;
  attentionFlags: Array<{ flagCode: string; isActive: boolean }>;
  reviews: Array<{ outcome: string; reason: string; reviewedAt: Date; reviewedByUserId: string }>;
}) => {
  const unexpectedPrimaryState = !HR_RECONCILIATION_PRIMARY_STATES.includes(row.primaryState as never)
    ? row.primaryState
    : null;
  const unexpectedFlags = activeFlagCodes(row).filter((flag) => !HR_RECONCILIATION_ATTENTION_FLAGS.includes(flag as never));
  const attentionFlags = [...new Set([
    ...activeFlagCodes(row).filter((flag) => HR_RECONCILIATION_ATTENTION_FLAGS.includes(flag as never)),
    ...(unexpectedPrimaryState || unexpectedFlags.length ? ['CLASSIFICATION_ERROR'] : []),
  ])];
  return {
    id: row.id,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    primaryState: unexpectedPrimaryState ? 'CLASSIFICATION_ERROR' : row.primaryState,
    stateVersion: row.stateVersion,
    details: row.detailsJson,
    attentionFlags,
    cutoverBlocker: row.cutoverBlocker || attentionFlags.length > 0,
    classifiedAt: row.classifiedAt,
    latestReview: row.reviews[0] ?? null,
    technicalEvidence: unexpectedPrimaryState || unexpectedFlags.length
      ? { unexpectedPrimaryState, unexpectedFlags }
      : null,
  };
};

const loadProjectedRows = async (client: StoreClient) => {
  const rows = await client.hrReconciliationRecord.findMany({
    include: {
      attentionFlags: { orderBy: [{ flagCode: 'asc' }, { version: 'desc' }] },
      reviews: { orderBy: { version: 'desc' }, take: 1 },
    },
    orderBy: [{ classifiedAt: 'desc' }, { id: 'asc' }],
  });
  return rows.map(projectHrReconciliationRow);
};

export const getHrReconciliationWorkspace = async (client: StoreClient, filter: {
  primaryState?: string;
  attentionFlag?: string;
  cutoverBlocker?: boolean;
  sourceType?: string;
} = {}) => {
  const allRows = await loadProjectedRows(client);
  const matchingRows = allRows.filter((row) => (
    buildHrReconciliationFilter(filter)(row)
    && (!filter.sourceType || row.sourceType === filter.sourceType)
  ));
  return {
    filters: filter,
    summary: summarizeHrReconciliationRows(allRows),
    matchingCount: matchingRows.length,
    records: matchingRows,
  };
};

const outcomesToFlags: Partial<Record<HrReconciliationReviewOutcome, string[]>> = {
  ACCESS_ONLY_USER: ['UNRESOLVED_PERSONNEL_LINKAGE'],
  DIFFERENT_PEOPLE: ['POSSIBLE_DUPLICATE_IDENTITY'],
  SHARED_IDENTITY: ['POSSIBLE_DUPLICATE_IDENTITY'],
  STILL_AMBIGUOUS: ['POSSIBLE_DUPLICATE_IDENTITY'],
  ORGANIZATION_MAPPED: ['INCOMPLETE_ORGANIZATIONAL_MAPPING'],
  ORGANIZATION_CREATED: ['INCOMPLETE_ORGANIZATIONAL_MAPPING'],
  ORGANIZATION_HISTORICAL: ['INCOMPLETE_ORGANIZATIONAL_MAPPING'],
  START_DATE_UNRECOVERABLE: ['OPEN_START_DATE_REVIEW'],
};

const outcomesThatResolveFlags = new Set<HrReconciliationReviewOutcome>([
  'ACCESS_ONLY_USER',
  'DIFFERENT_PEOPLE',
  'ORGANIZATION_MAPPED',
  'ORGANIZATION_CREATED',
  'ORGANIZATION_HISTORICAL',
  'START_DATE_UNRECOVERABLE',
]);

const hasPersistedOrganizationalMapping = async (
  tx: Prisma.TransactionClient,
  record: { sourceType: string; sourceId: string },
) => {
  if (record.sourceType === 'EMPLOYMENT_RELATIONSHIP') {
    return Boolean(await tx.hrEmploymentAssignment.findFirst({
      where: { employmentRelationshipId: record.sourceId, type: 'PRIMARY', organizationalUnitId: { not: null } },
      select: { id: true },
    }));
  }
  if (record.sourceType === 'PERSONNEL') {
    return Boolean(await tx.hrEmploymentAssignment.findFirst({
      where: {
        employmentRelationship: { personnelId: record.sourceId },
        type: 'PRIMARY',
        organizationalUnitId: { not: null },
      },
      select: { id: true },
    }));
  }
  return false;
};

export const recordHrReconciliationReview = async (client: PrismaClient, input: {
  reconciliationId: string;
  outcome: string;
  reason: string;
  actorUserId: string;
  now?: Date;
}) => {
  const outcome = input.outcome as HrReconciliationReviewOutcome;
  if (!HR_RECONCILIATION_REVIEW_OUTCOMES.includes(outcome)) throw new Error('HR_RECONCILIATION_OUTCOME_UNSUPPORTED');
  const reason = input.reason.trim();
  if (!reason) throw new Error('HR_RECONCILIATION_REVIEW_REASON_REQUIRED');
  const now = input.now ?? new Date();

  return client.$transaction(async (tx) => {
    const record = await tx.hrReconciliationRecord.findUnique({
      where: { id: input.reconciliationId },
      include: {
        attentionFlags: { where: { isActive: true }, orderBy: { version: 'desc' } },
        reviews: { orderBy: { version: 'desc' }, take: 1 },
      },
    });
    if (!record) throw new Error('HR_RECONCILIATION_RECORD_NOT_FOUND');
    const applicableFlags = outcomesToFlags[outcome] ?? [];
    const activeApplicableFlags = record.attentionFlags.filter((flag) => applicableFlags.includes(flag.flagCode));
    if (outcome !== 'LEGACY_ONLY_CONFIRMED' && activeApplicableFlags.length === 0) {
      throw new Error('HR_RECONCILIATION_REVIEW_NOT_ACTIONABLE');
    }
    if (outcome === 'LEGACY_ONLY_CONFIRMED' && record.cutoverBlocker) {
      throw new Error('HR_RECONCILIATION_LEGACY_REVIEW_BLOCKED');
    }
    if (['ORGANIZATION_MAPPED', 'ORGANIZATION_CREATED', 'ORGANIZATION_HISTORICAL'].includes(outcome)
      && !(await hasPersistedOrganizationalMapping(tx, record))) {
      throw new Error('HR_RECONCILIATION_ORGANIZATION_MAPPING_REQUIRED');
    }

    const version = (record.reviews[0]?.version ?? 0) + 1;
    const review = await tx.hrReconciliationReview.create({ data: {
      stableKey: `hr-reconciliation-review:${record.id}:${version}`,
      reconciliationId: record.id,
      version,
      outcome,
      reason,
      reviewedByUserId: input.actorUserId,
      reviewedAt: now,
    } });

    if (outcomesThatResolveFlags.has(outcome)) {
      for (const flag of activeApplicableFlags) {
        await tx.hrReconciliationAttentionFlag.update({ where: { id: flag.id }, data: {
          isActive: false,
          resolvedAt: now,
          resolvedByUserId: input.actorUserId,
          resolutionReason: outcome,
        } });
        await tx.hrCutoverBlockerProjection.updateMany({
          where: { reconciliationId: record.id, blockerCode: flag.flagCode, isActive: true },
          data: { isActive: false, clearedAt: now },
        });
      }
    }

    const remainingBlockers = record.attentionFlags.filter((flag) => (
      !outcomesThatResolveFlags.has(outcome) || !activeApplicableFlags.some((resolved) => resolved.id === flag.id)
    )).length;
    const primaryState = outcome === 'ACCESS_ONLY_USER'
      ? 'USER_ACCESS_ONLY'
      : outcome === 'LEGACY_ONLY_CONFIRMED'
        ? 'LEGACY_ONLY_HISTORY'
        : record.primaryState;
    await tx.hrReconciliationRecord.update({ where: { id: record.id }, data: {
      primaryState,
      cutoverBlocker: remainingBlockers > 0,
      stateVersion: { increment: 1 },
      classifiedAt: now,
      classifiedByUserId: input.actorUserId,
    } });
    return review;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};
