import type { PrismaClient } from '@prisma/client';
import { recordDispatchCriticalFailure } from '../dispatchCutover';
import type { DispatchIntegrityIncidentReporter } from './ports';

export const createDispatchIntegrityIncidentReporter = (prisma: PrismaClient): DispatchIntegrityIncidentReporter => ({
  async report(input) {
    await recordDispatchCriticalFailure(prisma, { actorId: input.actorId,
      reason: `Dispatch artifact integrity failure: ${input.failureCode}`,
      evidence: { waybillId: input.waybillId, artifactId: input.artifactId, correlationId: input.correlationId,
        failureCode: input.failureCode, ...input.evidence } });
  },
});
