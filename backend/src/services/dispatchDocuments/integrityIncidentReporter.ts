import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { recordDispatchCriticalFailure } from '../dispatchCutover';
import type { DispatchIntegrityIncidentReporter } from './ports';

export const createDispatchIntegrityIncidentReporter = (prisma: PrismaClient): DispatchIntegrityIncidentReporter => ({
  async report(input) {
    await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_AUDIT:ACCOUNTING_DISPATCH_WAYBILL:${input.waybillId}`);
      const previous = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL',
        aggregateId: input.waybillId }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
      const recordedAt = new Date();
      const payload = { artifactId: input.artifactId, correlationId: input.correlationId,
        failureCode: input.failureCode, ...input.evidence };
      const eventHash = createHash('sha256').update(JSON.stringify({ aggregateId: input.waybillId,
        eventType: 'DISPATCH_DOCUMENT_INTEGRITY_INCIDENT', payload, actorId: input.actorId,
        recordedAt: recordedAt.toISOString(), previousHash: previous?.eventHash ?? null })).digest('hex');
      await tx.dispatchLifecycleAudit.create({ data: { id: randomUUID(), aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL',
        aggregateId: input.waybillId, eventType: 'DISPATCH_DOCUMENT_INTEGRITY_INCIDENT', payload,
        actorId: input.actorId, recordedAt, previousHash: previous?.eventHash ?? null, eventHash } });
    });
    await recordDispatchCriticalFailure(prisma, { actorId: input.actorId,
      reason: `Dispatch artifact integrity failure: ${input.failureCode}`,
      evidence: { waybillId: input.waybillId, artifactId: input.artifactId, correlationId: input.correlationId,
        failureCode: input.failureCode, ...input.evidence } });
  },
});
