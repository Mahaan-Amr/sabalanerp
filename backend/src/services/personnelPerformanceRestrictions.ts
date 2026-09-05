import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { activeHrActionPermissionsForUser } from './hrAuthorizationService';
import { recomputePerformanceProjectionsInTransaction } from './personnelPerformancePolicyStore';
import { performanceVaultKeyFromEnvironment, readPerformancePayload } from './personnelPerformancePayloadStore';
export { activePerformanceRestrictionIds } from './personnelPerformanceRestrictionQueries';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';

type Client = PrismaClient | Prisma.TransactionClient;


const unavailable = () => Object.assign(new Error('اختیار یا دامنه اقدام معتبر نیست.'), { status: 404, code: 'PERFORMANCE_RESTRICTION_UNAVAILABLE' });
export const restrictPerformanceEvidence = async (client: Client, input: {
  actorUserId: string; evaluationId: string; privacyCaseId?: string; reasonCode: string; releaseId?: string;
}) => {
  const work = async (tx: Prisma.TransactionClient) => {
    if (typeof input.evaluationId !== 'string' || !input.evaluationId || (input.privacyCaseId !== undefined && typeof input.privacyCaseId !== 'string')) throw unavailable();
    await tx.$queryRaw`SELECT revision FROM performance_disclosure_revision WHERE id = 1 FOR UPDATE`;
    const permission = input.releaseId ? 'RELEASE_PERFORMANCE_RESTRICTION' : 'RESTRICT_PERFORMANCE_EVIDENCE';
    if (!(await activeHrActionPermissionsForUser(tx, input.actorUserId)).includes(permission)
      || !/^[A-Z][A-Z0-9_]{2,79}$/.test(input.reasonCode)) throw unavailable();
    const evaluation = await tx.performanceEvaluation.findUnique({ where: { id: input.evaluationId } });
    if (!evaluation) throw unavailable();
    if (input.privacyCaseId && !await tx.performancePrivacyScope.findUnique({ where: { caseId_evaluationId: { caseId: input.privacyCaseId, evaluationId: input.evaluationId } } })) throw unavailable();
    let restriction;
    if (input.releaseId) {
      const existing = await tx.performanceEvidenceRestriction.findUnique({ where: { id: input.releaseId } });
      if (!existing || existing.evaluationId !== input.evaluationId) throw unavailable();
      if (existing.status === 'RELEASED') return existing;
      restriction = await tx.performanceEvidenceRestriction.update({ where: { id: existing.id }, data: {
        status: 'RELEASED', releasedByUserId: input.actorUserId, releasedAt: new Date(), releaseReason: input.reasonCode,
      } });
    } else {
      const existing = await tx.performanceEvidenceRestriction.findFirst({ where: { evaluationId: input.evaluationId, privacyCaseId: input.privacyCaseId ?? null, status: 'ACTIVE' } });
      if (existing) return existing;
      restriction = await tx.performanceEvidenceRestriction.create({ data: {
        evaluationId: input.evaluationId, privacyCaseId: input.privacyCaseId, reasonCode: input.reasonCode, createdByUserId: input.actorUserId,
      } });
    }
    const projection = await tx.performanceCurrentLevelProjection.findUnique({ where: { subjectId: evaluation.subjectId } });
    if (projection) await recomputePerformanceProjectionsInTransaction(tx, {
      now: new Date(), actorUserId: input.actorUserId, reason: input.reasonCode, keyring: performanceVaultKeyFromEnvironment(), subjectIds: [evaluation.subjectId],
    });
    if (!input.releaseId) {
      const results = await tx.performanceAcceptedResult.findMany({ where: { evaluationId: evaluation.id }, select: { id: true } });
      const resultIds = new Set(results.map(({ id }) => id));
      const handoffs = await tx.performanceConsequenceHandoff.findMany({ where: { subjectId: evaluation.subjectId, status: { in: ['SENT','RECEIVED'] } } });
      for (const handoff of handoffs) {
        const packageRecord = handoff.packageId ? await tx.performanceConsequencePackage.findUnique({ where: { id: handoff.packageId } }) : null;
        const payloadId = packageRecord?.encryptedPayloadId ?? handoff.encryptedPayloadId;
        if (!payloadId) throw unavailable();
        const snapshot = await readPerformancePayload<{ selectedResults?: Array<{ id: string }>; recentTrend?: Array<{ resultId: string }>; currentProjection?: { state: string }; projectionResultIds?: string[] }>(tx, payloadId, performanceVaultKeyFromEnvironment());
        const dependsOnEvidence = snapshot.selectedResults?.some(({ id }) => resultIds.has(id))
          || snapshot.recentTrend?.some(({ resultId }) => resultIds.has(resultId))
          || snapshot.projectionResultIds?.some((id) => resultIds.has(id))
          // Older snapshots did not enumerate the projection dependencies. They require independent review.
          || (snapshot.currentProjection?.state === 'LEVEL' && !snapshot.projectionResultIds);
        if (!dependsOnEvidence) continue;
        await tx.performanceConsequenceHandoff.update({ where: { id: handoff.id }, data: { status: 'SUSPENDED', suspendedAt: new Date() } });
        const auditId = randomUUID();
        await tx.performanceAuditEvent.create({ data: { id: auditId, aggregateType: 'PERFORMANCE_CONSEQUENCE_HANDOFF', aggregateId: handoff.id,
          eventType: 'CONSEQUENCE_HANDOFF_SUSPENDED', actorUserId: input.actorUserId, reason: input.reasonCode,
          authorityHash: canonicalPerformanceHash([permission]), eventHash: canonicalPerformanceHash({ auditId, restrictionId: restriction.id, handoffId: handoff.id }),
        } });
      }
    }
    const id = randomUUID();
    await tx.performanceAuditEvent.create({ data: { id, aggregateType: 'PERFORMANCE_RESTRICTION', aggregateId: restriction.id,
      eventType: input.releaseId ? 'RESTRICTION_RELEASED' : 'RESTRICTION_PLACED', actorUserId: input.actorUserId,
      authorityHash: canonicalPerformanceHash([permission]), reason: input.reasonCode,
      eventHash: canonicalPerformanceHash({ id, restrictionId: restriction.id, status: restriction.status, actorUserId: input.actorUserId }),
    } });
    return restriction;
  };
  return '$transaction' in client ? client.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }) : work(client);
};
