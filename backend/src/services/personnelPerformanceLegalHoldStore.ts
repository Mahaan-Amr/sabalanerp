import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { publishNotificationEvent } from './notificationService';

type Client = PrismaClient | Prisma.TransactionClient;
const scopes: Record<string, string> = {
  EVALUATION: 'performance_evaluations', EVALUATION_SECTION: 'performance_evaluation_sections',
  PERFORMANCE_DRAFT: 'performance_drafts', PERFORMANCE_SUBMISSION: 'performance_submissions',
  PERFORMANCE_REVIEW: 'performance_reviews', CALCULATION_TRACE: 'performance_calculation_traces',
  ACCEPTED_RESULT: 'performance_accepted_results', POLICY_VERSION: 'performance_policy_versions',
  CRITERION_VERSION: 'performance_criterion_versions', TEMPLATE_VERSION: 'performance_template_versions',
  PERFORMANCE_EXPORT: 'performance_export_receipts', PERFORMANCE_CONSEQUENCE_HANDOFF: 'performance_consequence_handoffs',
  PERFORMANCE_PRIVACY_CASE: 'performance_privacy_cases', PERFORMANCE_SUBJECT: 'performance_subjects',
};
const unavailable = () => Object.assign(new Error('دامنه یا اختیار توقف نگهداری معتبر نیست.'), { code: 'PERFORMANCE_HOLD_UNAVAILABLE', status: 404 });
const transaction = async <T>(client: Client, work: (tx: Prisma.TransactionClient) => Promise<T>) => '$transaction' in client
  ? client.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000 }) : work(client);
const authorize = async (tx: Prisma.TransactionClient, actorUserId: string, permission: string, reasonCode: string) => {
  const permissions = await activeHrActionPermissionsForUser(tx, actorUserId);
  if (!permissions.includes(permission) || typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{2,79}$/.test(reasonCode)) throw unavailable();
  return canonicalPerformanceHash({ actorUserId, permission, effectivePermissions: permissions.sort(), resolvedAt: new Date().toISOString() });
};
const subjectUserForHold = async (tx: Prisma.TransactionClient, aggregateType: string, aggregateId: string) => {
  const evaluationId = aggregateType === 'EVALUATION' ? aggregateId
    : aggregateType === 'EVALUATION_SECTION' ? (await tx.performanceEvaluationSection.findUnique({ where: { id: aggregateId }, select: { evaluationId: true } }))?.evaluationId
      : null;
  const subjectId = aggregateType === 'PERFORMANCE_SUBJECT' ? aggregateId
    : evaluationId ? (await tx.performanceEvaluation.findUnique({ where: { id: evaluationId }, select: { subjectId: true } }))?.subjectId : null;
  const personnelId = subjectId ? (await tx.performanceSubject.findUnique({ where: { id: subjectId }, select: { personnelId: true } }))?.personnelId : null;
  return personnelId ? tx.user.findFirst({ where: { personnelId, isActive: true }, select: { id: true } }) : null;
};
export const placePerformanceLegalHold = async (client: Client, input: {
  actorUserId: string; aggregateType: string; aggregateId: string; reasonCode: string;
}) => transaction(client, async (tx) => {
  await tx.$executeRaw`UPDATE performance_disclosure_revision SET revision = revision + 1 WHERE id = 1`;
  const authorityHash = await authorize(tx, input.actorUserId, 'PLACE_PERFORMANCE_LEGAL_HOLD', input.reasonCode);
  if (!Object.prototype.hasOwnProperty.call(scopes, input.aggregateType) || typeof input.aggregateId !== 'string' || !input.aggregateId) throw unavailable();
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`SELECT id FROM ${Prisma.raw(scopes[input.aggregateType])} WHERE id = ${input.aggregateId}`);
  if (!rows.length) throw unavailable();
  const latest = await tx.performanceLegalHold.findFirst({ where: { aggregateType: input.aggregateType, aggregateId: input.aggregateId }, orderBy: { version: 'desc' } });
  if (latest?.status === 'ACTIVE') return latest;
  const hold = await tx.performanceLegalHold.create({ data: {
    aggregateType: input.aggregateType, aggregateId: input.aggregateId,
    aggregateIdHash: createHash('sha256').update(input.aggregateId).digest('hex'), version: (latest?.version ?? 0) + 1,
    reason: input.reasonCode, placedByUserId: input.actorUserId,
  } });
  const id = randomUUID();
  await tx.performanceAuditEvent.create({ data: { id, aggregateType: 'PERFORMANCE_LEGAL_HOLD', aggregateId: hold.id,
    eventType: 'LEGAL_HOLD_PLACED', actorUserId: input.actorUserId, reason: input.reasonCode, authorityHash,
    eventHash: canonicalPerformanceHash({ id, holdId: hold.id, version: hold.version, scopeHash: hold.aggregateIdHash }),
  } });
  const subjectUser = await subjectUserForHold(tx, input.aggregateType, input.aggregateId);
  if (subjectUser) await publishNotificationEvent(tx, { type: 'PERFORMANCE_LEGAL_HOLD_NOTICE',
    deduplicationKey: `performance-legal-hold:${hold.id}:placed`, recipientIds: [subjectUser.id], recipientGroups: { DIRECT_USER: [subjectUser.id] },
    resourceType: 'PERFORMANCE_LEGAL_HOLD', resourceId: hold.id,
    actionUrl: '/dashboard/hr/personnel/performance', payload: {} });
  return hold;
});

export const decidePerformanceLegalHold = async (client: Client, input: {
  actorUserId: string; holdId: string; action: 'REVIEW' | 'APPROVE_RELEASE'; reasonCode: string;
}) => transaction(client, async (tx) => {
  await tx.$executeRaw`UPDATE performance_disclosure_revision SET revision = revision + 1 WHERE id = 1`;
  if (!['REVIEW','APPROVE_RELEASE'].includes(input.action) || typeof input.holdId !== 'string') throw unavailable();
  const permission = input.action === 'REVIEW' ? 'PLACE_PERFORMANCE_LEGAL_HOLD' : 'RELEASE_PERFORMANCE_LEGAL_HOLD';
  const authorityHash = await authorize(tx, input.actorUserId, permission, input.reasonCode);
  const hold = await tx.performanceLegalHold.findUnique({ where: { id: input.holdId } });
  if (!hold) throw unavailable();
  if (hold.status !== 'ACTIVE') return hold;
  const previous = input.action === 'APPROVE_RELEASE' ? await tx.performanceLegalHoldDecision.findFirst({ where: { holdId: hold.id, action: input.action, actorUserId: input.actorUserId, reasonCode: input.reasonCode, decidedAt: { gte: new Date(Date.now() - 86_400_000) } } }) : null;
  if (!previous) await tx.performanceLegalHoldDecision.create({ data: {
    holdId: hold.id, action: input.action, actorUserId: input.actorUserId, reasonCode: input.reasonCode, authorityHash,
  } });
  if (input.action === 'APPROVE_RELEASE') {
    const approvals = await tx.performanceLegalHoldDecision.findMany({ where: { holdId: hold.id, action: 'APPROVE_RELEASE', reasonCode: input.reasonCode, decidedAt: { gte: new Date(Date.now() - 86_400_000) } } });
    const stillAuthorized = await Promise.all(approvals.map(async (approval) => (await activeHrActionPermissionsForUser(tx, approval.actorUserId)).includes(permission)));
    if (new Set(approvals.filter((_approval, index) => stillAuthorized[index]).map(({ actorUserId }) => actorUserId)).size >= 2) {
      const released = await tx.performanceLegalHold.update({ where: { id: hold.id }, data: { status: 'RELEASED', releasedByUserId: input.actorUserId, releasedAt: new Date(), releaseReason: input.reasonCode } });
      const subjectUser = await subjectUserForHold(tx, hold.aggregateType, hold.aggregateId);
      if (subjectUser) await publishNotificationEvent(tx, { type: 'PERFORMANCE_LEGAL_HOLD_NOTICE',
        deduplicationKey: `performance-legal-hold:${hold.id}:released`, recipientIds: [subjectUser.id], recipientGroups: { DIRECT_USER: [subjectUser.id] },
        resourceType: 'PERFORMANCE_LEGAL_HOLD', resourceId: hold.id,
        actionUrl: '/dashboard/hr/personnel/performance', payload: {} });
      return released;
    }
  }
  return hold;
});

export const listPerformanceLegalHolds = async (client: Client, actorUserId: string) => {
  if (!(await activeHrActionPermissionsForUser(client, actorUserId)).includes('MANAGE_PERFORMANCE_RETENTION')) throw unavailable();
  const holds = await client.performanceLegalHold.findMany({ where: { status: 'ACTIVE' }, orderBy: { placedAt: 'asc' }, take: 200 });
  return Promise.all(holds.map(async (hold) => {
    const review = await client.performanceLegalHoldDecision.findFirst({ where: { holdId: hold.id, action: 'REVIEW' }, orderBy: { decidedAt: 'desc' } });
    return { ...hold, reviewBy: new Date((review?.decidedAt ?? hold.placedAt).getTime() + 90 * 86_400_000) };
  }));
};
