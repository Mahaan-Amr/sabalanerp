import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { personnelPerformanceRollbackMode } from './personnelPerformanceRolloutPolicy';

type Client = PrismaClient | Prisma.TransactionClient;
const operationsError = (code: string, status = 409) => Object.assign(new Error('اقدام عملیاتی با وضعیت یا اختیار فعلی مجاز نیست.'), { code, status });
const transaction = async <T>(client: Client, work: (tx: Prisma.TransactionClient) => Promise<T>) => '$transaction' in client
  ? client.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 }) : work(client);

export const getPersonnelPerformanceOperationsState = async (client: Client) => {
  const state = await client.$queryRaw<Array<{ firstCanonicalWriteAt: Date | null; firstCanonicalTable: string | null; firstCanonicalIdHash: string | null }>>`
    SELECT "firstCanonicalWriteAt", "firstCanonicalTable", "firstCanonicalIdHash" FROM performance_disclosure_revision WHERE id = 1`;
  if (!state[0]) throw operationsError('PERFORMANCE_OPERATIONS_FENCE_UNAVAILABLE');
  return { ...state[0], rollbackMode: personnelPerformanceRollbackMode(Boolean(state[0].firstCanonicalWriteAt)),
    activePauses: await client.performanceSafetyPause.findMany({ where: { status: 'ACTIVE' }, orderBy: { startedAt: 'asc' } }),
  };
};

export const pausePersonnelPerformance = async (client: Client, input: {
  actorUserId: string; phaseVersionId: string; scope: 'ALL' | 'COHORT'; cohortVersionId?: string; reasonCode: string; reason: string;
}) => transaction(client, async (tx) => {
  await tx.$executeRaw`UPDATE performance_disclosure_revision SET revision = revision + 1 WHERE id = 1`;
  const permissions = await activeHrActionPermissionsForUser(tx, input.actorUserId);
  if (!permissions.includes('PAUSE_PERFORMANCE_EVALUATION')) throw operationsError('PERFORMANCE_PAUSE_PERMISSION_REQUIRED', 403);
  if (!['ALL','COHORT'].includes(input.scope) || typeof input.phaseVersionId !== 'string'
    || typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.length > 2000
    || typeof input.reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{2,79}$/.test(input.reasonCode)
    || (input.scope === 'ALL' && input.cohortVersionId !== undefined)
    || (input.scope === 'COHORT' && typeof input.cohortVersionId !== 'string')) throw operationsError('PERFORMANCE_PAUSE_INVALID', 422);
  const phase = await tx.performanceFeaturePhaseVersion.findUnique({ where: { id: input.phaseVersionId } });
  if (!phase || (input.scope === 'COHORT' && !await tx.performanceCohortVersion.findUnique({ where: { id: input.cohortVersionId } }))) {
    throw operationsError('PERFORMANCE_PAUSE_SCOPE_INVALID', 422);
  }
  const existing = await tx.performanceSafetyPause.findFirst({ where: { status: 'ACTIVE', scope: input.scope, cohortVersionId: input.cohortVersionId ?? null } });
  if (existing) return existing;
  const pause = await tx.performanceSafetyPause.create({ data: {
    phaseVersionId: phase.id, scope: input.scope, cohortVersionId: input.cohortVersionId,
    reasonCode: input.reasonCode, reason: input.reason.trim(), startedByUserId: input.actorUserId,
  } });
  const id = randomUUID();
  await tx.performanceAuditEvent.create({ data: { id, aggregateType: 'PERFORMANCE_SAFETY_PAUSE', aggregateId: pause.id,
    eventType: 'SAFETY_PAUSE_STARTED', actorUserId: input.actorUserId, reason: input.reasonCode,
    authorityHash: canonicalPerformanceHash({ permission: 'PAUSE_PERFORMANCE_EVALUATION', effectivePermissions: permissions.sort() }),
    eventHash: canonicalPerformanceHash({ id, pauseId: pause.id, scope: pause.scope, cohortVersionId: pause.cohortVersionId }),
  } });
  return pause;
});

export const disablePersonnelPerformanceBeforeFirstWrite = async (client: Client, input: { actorUserId: string; reason: string }) => transaction(client, async (tx) => {
  await tx.$executeRaw`UPDATE performance_disclosure_revision SET revision = revision + 1 WHERE id = 1`;
  if (!(await activeHrActionPermissionsForUser(tx, input.actorUserId)).includes('MANAGE_PERFORMANCE_ROLLOUT')) throw operationsError('PERFORMANCE_ROLLOUT_PERMISSION_REQUIRED', 403);
  if (typeof input.reason !== 'string' || input.reason.trim().length < 8 || input.reason.length > 2000) throw operationsError('PERFORMANCE_ROLLOUT_REASON_REQUIRED', 422);
  if ((await getPersonnelPerformanceOperationsState(tx)).firstCanonicalWriteAt) throw operationsError('PERFORMANCE_FIX_FORWARD_REQUIRED');
  const previous = await tx.performanceFeaturePhaseVersion.findFirst({ orderBy: { version: 'desc' } });
  return tx.performanceFeaturePhaseVersion.create({ data: {
    version: (previous?.version ?? 0) + 1, predecessorId: previous?.id, phase: previous?.phase ?? 'SCHEMA_PROTECTION',
    releaseEnabled: false, cohortVersionId: previous?.cohortVersionId, effectiveFrom: new Date(),
    recordedByUserId: input.actorUserId, reason: input.reason.trim(),
  } });
});
