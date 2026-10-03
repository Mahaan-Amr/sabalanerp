import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';

/** Caller holds the Case lock and has advanced stateRevision exactly once. */
export async function appendPartnerCommercialEvent(tx: Prisma.TransactionClient, caseId: string, actorId: string, type: string, evidence: unknown, reason?: string) {
  const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: caseId } });
  const maximum = await tx.partnerCaseEvent.aggregate({ where: { caseId }, _max: { sequence: true } });
  const commandId = randomUUID();
  await tx.partnerCaseEvent.create({ data: { id: randomUUID(), caseId, caseRevision: root.headRevision,
    integrityHash: root.integrityHash, sequence: (maximum._max.sequence ?? 0) + 1, stateRevision: root.stateRevision,
    type, fromState: root.state, toState: root.state, actorId, commandId, correlationId: commandId,
    effectiveDate: new Date(), reason, evidence: JSON.parse(JSON.stringify(evidence)) as Prisma.InputJsonValue } });
}
