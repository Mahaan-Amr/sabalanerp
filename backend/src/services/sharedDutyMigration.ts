import { Prisma, type PrismaClient } from '@prisma/client';
import {
  CROSS_WORKSPACE_DUTY_DEFINITIONS,
  loadCrossWorkspaceDutySourceProjection,
} from './crossWorkspaceDutyModule';
import { lockCrossWorkspaceDuty } from './crossWorkspaceDutyLock';

type AccountabilityModel = 'SHARED_DECISION' | 'INDIVIDUAL_EXECUTION';

export const planSharedDutyMigration = (duties: Array<{
  id: string;
  status: string;
  accountabilityModel: AccountabilityModel;
  sourceIsCurrent: boolean;
}>) => duties.reduce((report, duty) => {
  if (duty.status !== 'OPEN' || duty.accountabilityModel !== 'SHARED_DECISION') {
    report.unchanged.push(duty.id);
  } else if (!duty.sourceIsCurrent) {
    report.stale.push(duty.id);
  } else {
    report.migrate.push(duty.id);
  }
  return report;
}, { migrate: [] as string[], stale: [] as string[], unchanged: [] as string[] });

const definitionFor = (sourceActionCode: string) => Object.values(CROSS_WORKSPACE_DUTY_DEFINITIONS)
  .find((definition) => definition.sourceActionCode === sourceActionCode);
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export const migrateOpenSharedDecisionDuties = async (
  database: PrismaClient,
  input: { apply: boolean; actorUserId?: string; policyVersion?: number; now?: Date; createdBefore?: Date; dutyIds?: string[] },
) => {
  const now = input.now ?? new Date();
  const actorUserId = input.actorUserId ?? 'SYSTEM';
  const policyVersion = input.policyVersion ?? 1;
  if (input.apply && !input.createdBefore) throw new Error('SHARED_DUTY_ROLLOUT_CUTOFF_REQUIRED');
  const priorMigrations = await database.crossWorkspaceDutyAuditVersion.findMany({
    where: { eventCode: 'MIGRATED_TO_SHARED_DECISION' },
    orderBy: { createdAt: 'asc' }, select: { afterJson: true },
  });
  const priorCutoffText = priorMigrations.map(({ afterJson }) => (
    afterJson && typeof afterJson === 'object' && !Array.isArray(afterJson)
      ? (afterJson as Record<string, unknown>).rolloutCutoff
      : null
  )).find((value): value is string => typeof value === 'string');
  const priorCutoff = typeof priorCutoffText === 'string' ? new Date(priorCutoffText) : null;
  if (priorCutoff && input.createdBefore && priorCutoff.getTime() !== input.createdBefore.getTime()) {
    throw new Error('SHARED_DUTY_ROLLOUT_CUTOFF_MISMATCH');
  }
  const createdBefore = priorCutoff ?? input.createdBefore ?? now;
  const duties = await database.crossWorkspaceDuty.findMany({
    where: { createdAt: { lt: createdBefore }, ...(input.dutyIds ? { id: { in: input.dutyIds } } : {}) },
    select: {
      id: true, status: true, sourceType: true, sourceId: true, sourceActionCode: true,
      sourceVersion: true, envelopeVersion: true, currentAssigneeUserId: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const inspected = await Promise.all(duties.map(async (duty) => {
    const definition = definitionFor(duty.sourceActionCode);
    let sourceIsCurrent = false;
    if (duty.status === 'OPEN' && definition?.accountabilityModel === 'SHARED_DECISION') {
      try {
        sourceIsCurrent = (await loadCrossWorkspaceDutySourceProjection(database, {
          sourceType: duty.sourceType,
          sourceId: duty.sourceId,
          sourceActionCode: duty.sourceActionCode,
          sourceVersion: duty.sourceVersion,
        })).sourceIsCurrent;
      } catch {
        sourceIsCurrent = false;
      }
    }
    return {
      ...duty,
      accountabilityModel: definition?.accountabilityModel ?? 'INDIVIDUAL_EXECUTION' as const,
      sourceIsCurrent,
    };
  }));
  const plan = planSharedDutyMigration(inspected);
  const report = { mode: input.apply ? 'apply' : 'dry-run', rolloutCutoff: createdBefore.toISOString(),
    ...plan, migrated: [] as string[], replayed: [] as string[] };
  if (!input.apply) return report;

  for (const dutyId of plan.migrate) {
    const outcome = await database.$transaction(async (tx) => {
      await lockCrossWorkspaceDuty(tx, dutyId);
      const duty = await tx.crossWorkspaceDuty.findUnique({ where: { id: dutyId } });
      if (!duty || duty.status !== 'OPEN' || definitionFor(duty.sourceActionCode)?.accountabilityModel !== 'SHARED_DECISION') {
        return 'replayed' as const;
      }
      const existing = await tx.crossWorkspaceDutyAuditVersion.findFirst({
        where: { dutyId, eventCode: 'MIGRATED_TO_SHARED_DECISION' },
        select: { id: true },
      });
      if (existing) return 'replayed' as const;
      const source = await loadCrossWorkspaceDutySourceProjection(tx, {
        sourceType: duty.sourceType,
        sourceId: duty.sourceId,
        sourceActionCode: duty.sourceActionCode,
        sourceVersion: duty.sourceVersion,
      });
      if (!source.sourceIsCurrent) return 'replayed' as const;
      if (duty.currentAssigneeUserId) {
        const changed = await tx.crossWorkspaceDuty.updateMany({
          where: { id: duty.id, status: 'OPEN', currentAssigneeUserId: duty.currentAssigneeUserId },
          data: { currentAssigneeUserId: null },
        });
        if (!changed.count) return 'replayed' as const;
        await tx.crossWorkspaceDutyAssignmentHistory.updateMany({
          where: { dutyId: duty.id, endedAt: null },
          data: { endedAt: now, endReason: 'REASSIGNED', changedByUserId: actorUserId },
        });
      }
      const latest = await tx.crossWorkspaceDutyAuditVersion.aggregate({
        where: { dutyId }, _max: { version: true },
      });
      const stillOpen = await tx.crossWorkspaceDuty.count({ where: { id: duty.id, status: 'OPEN' } });
      if (!stillOpen) return 'replayed' as const;
      await tx.crossWorkspaceDutyAuditVersion.create({ data: {
        dutyId,
        version: (latest._max.version ?? 0) + 1,
        eventCode: 'MIGRATED_TO_SHARED_DECISION',
        actorUserId,
        sourceVersion: duty.sourceVersion,
        envelopeVersion: duty.envelopeVersion,
        policyVersion,
        beforeJson: json({ currentAssigneeUserId: duty.currentAssigneeUserId }),
        afterJson: json({ currentAssigneeUserId: null, accountabilityModel: 'SHARED_DECISION',
          rolloutCutoff: createdBefore.toISOString() }),
      } });
      return 'migrated' as const;
    });
    report[outcome].push(dutyId);
  }
  return report;
};
