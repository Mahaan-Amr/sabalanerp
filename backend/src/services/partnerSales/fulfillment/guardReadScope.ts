import type { GuardDriverQueueEvent, Prisma, PrismaClient } from '@prisma/client';
import { readPartnerSnapshot } from '../authorization/readSnapshot';
import { authorizePartnerLoading, type PartnerLoadingActor } from './loadingAuthority';

const summarizeGuardQueueEvent = ({ id, eventType, fromStatus, toStatus, recordedAt }: GuardDriverQueueEvent) =>
  ({ id, eventType, fromStatus, toStatus, recordedAt });

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const eventLoadingId = (event: GuardDriverQueueEvent) => {
  const payload = object(event.payload);
  return typeof payload?.loadingId === 'string' ? payload.loadingId : null;
};

/** Current Case authority governs retained audit text, even after release
 * cleared the turn's live loading reference. */
export function readGuardQueueTurnEvidence(database: PrismaClient, actor: PartnerLoadingActor,
  where: Prisma.GuardDriverQueueTurnWhereUniqueInput, redacted: boolean) {
  return readPartnerSnapshot(database, async tx => {
    const turn = await tx.guardDriverQueueTurn.findUnique({
      where, select: { loadingId: true, events: { orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] } },
    });
    if (!turn) return null;
    if (redacted) return turn.events.map(summarizeGuardQueueEvent);

    const loadingIds = [...new Set([turn.loadingId, ...turn.events.map(eventLoadingId)].filter((id): id is string => id !== null))];
    const loadings = loadingIds.length ? await tx.logisticsLoading.findMany({
      where: { id: { in: loadingIds }, sourceKind: 'PARTNER_CASE' }, select: { id: true, partnerCaseId: true },
    }) : [];
    const byLoading = new Map(loadings.map(row => [row.id, row.partnerCaseId]));
    const allowed = new Set<string>();
    for (const caseId of [...new Set(loadings.flatMap(row => row.partnerCaseId ? [row.partnerCaseId] : []))].sort()) {
      if ((await authorizePartnerLoading(tx, actor, caseId, 'GUARD_READ')).ok) allowed.add(caseId);
    }

    const privateEvent = (event: GuardDriverQueueEvent) => {
      const source = object(object(event.payload)?.source);
      const loadingId = eventLoadingId(event);
      const caseId = loadingId ? byLoading.get(loadingId) : undefined;
      if (loadingId && byLoading.has(loadingId)) {
        return !caseId || !allowed.has(caseId) || (source && object(source.owner)?.caseId !== caseId);
      }
      // Incomplete or orphaned Partner provenance must remain private.
      return source?.sourceKind === 'PARTNER_CASE' || Boolean(source && 'owner' in source);
    };
    const currentCase = turn.loadingId ? byLoading.get(turn.loadingId) : undefined;
    const hideCurrent = Boolean(turn.loadingId && byLoading.has(turn.loadingId) && (!currentCase || !allowed.has(currentCase)));
    return hideCurrent || turn.events.some(privateEvent) ? turn.events.map(summarizeGuardQueueEvent) : turn.events;
  });
}
