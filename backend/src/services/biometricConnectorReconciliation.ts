import { createHash } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { dispatchRecoveryIntegrityHash } from './dispatchDocumentAuditRecovery';

export const reconcileBiometricConnectorChallenges = async (prisma: PrismaClient, input: { actorId: string; now?: Date }) => {
  const now = input.now || new Date();
  return prisma.$transaction(async (tx) => {
    const actor = await tx.user.findFirst({ where: { id: input.actorId, role: 'ADMIN', isActive: true, erasedAt: null }, select: { id: true } });
    if (!actor) throw new Error('Biometric connector reconciliation requires an active system administrator');
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('BIOMETRIC_CONNECTOR_RECONCILIATION'))`;
    const abandonedBefore = new Date(now.getTime() - 5 * 60_000);
    const stale = await tx.biometricConnectorChallenge.findMany({
      where: { OR: [{ status: 'ISSUED', expiresAt: { lt: now } }, { status: 'PROCESSING', processingStartedAt: { lt: abandonedBefore } }] },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
    });
    let reconciledCount = 0;
    for (const challenge of stale) {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `BIOMETRIC_CONNECTOR_CHALLENGE:${challenge.id}`);
      const changed = await tx.biometricConnectorChallenge.updateMany({
        where: { id: challenge.id, OR: [{ status: 'ISSUED', expiresAt: { lt: now } }, { status: 'PROCESSING', processingStartedAt: { lt: abandonedBefore } }] },
        data: { status: 'FAILED', completedAt: now },
      });
      if (!changed.count) continue;
      reconciledCount += 1;
      const existing = await tx.dispatchEvidenceException.findFirst({ where: {
        exceptionType: 'BIOMETRIC_CONNECTOR_COMMAND_UNRECONCILED', aggregateType: 'BIOMETRIC_CONNECTOR_CHALLENGE', aggregateId: challenge.id, status: 'OPEN',
      } });
      if (!existing) await tx.dispatchEvidenceException.create({ data: {
        exceptionType: 'BIOMETRIC_CONNECTOR_COMMAND_UNRECONCILED', aggregateType: 'BIOMETRIC_CONNECTOR_CHALLENGE', aggregateId: challenge.id,
        detail: { workstationId: challenge.workstationId, operation: challenge.operation, previousStatus: challenge.status,
          issuedAt: challenge.issuedAt.toISOString(), expiresAt: challenge.expiresAt.toISOString(), reconciledAt: now.toISOString() } as Prisma.InputJsonValue,
        createdBy: input.actorId,
      } });
      const payload = { challengeId: challenge.id, workstationId: challenge.workstationId, operation: challenge.operation,
        previousStatus: challenge.status, exceptionCreated: !existing, reconciledAt: now.toISOString() };
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_AUDIT:BIOMETRIC_CONNECTOR_CHALLENGE:${challenge.id}`);
      const previous = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: 'BIOMETRIC_CONNECTOR_CHALLENGE', aggregateId: challenge.id },
        orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
      const eventHash = dispatchRecoveryIntegrityHash({ aggregateType: 'BIOMETRIC_CONNECTOR_CHALLENGE', aggregateId: challenge.id,
        eventType: 'UNRECONCILED_COMMAND_FAILED', payload, actorId: input.actorId, recordedAt: now.toISOString(), previousHash: previous?.eventHash || null });
      await tx.dispatchLifecycleAudit.create({ data: { aggregateType: 'BIOMETRIC_CONNECTOR_CHALLENGE', aggregateId: challenge.id,
        eventType: 'UNRECONCILED_COMMAND_FAILED', payload: payload as Prisma.InputJsonValue, actorId: input.actorId, recordedAt: now,
        previousHash: previous?.eventHash || null, eventHash } });
    }
    const statusCounts = await tx.biometricConnectorChallenge.groupBy({ by: ['status'], _count: { _all: true } });
    const report = { reconciledAt: now.toISOString(), staleCommandsFailed: reconciledCount,
      statusCounts: Object.fromEntries(statusCounts.map((item) => [item.status, item._count._all])) };
    return { ...report, reportHash: createHash('sha256').update(JSON.stringify(report)).digest('hex') };
  });
};
