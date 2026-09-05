import type { Prisma, PrismaClient } from '@prisma/client';
import { readPartnerSnapshot } from '../authorization/readSnapshot';
import { authorizePartnerLoading, type PartnerLoadingActor } from './loadingAuthority';

type Turn = Prisma.GuardDriverQueueTurnGetPayload<{ include: { events: true } }>;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Guard still sees the physical visit. Private loading associations and free
 * text/history require current Case authority even after release cleared the
 * live loading FK. No public read mutates retained audit evidence. */
export function withPartnerGuardReadScope<T>(database: PrismaClient, actor: PartnerLoadingActor,
  read: (scope: { database: Prisma.TransactionClient; present: (turn: Turn) => unknown }) => Promise<T>) {
  return readPartnerSnapshot(database, async tx => {
    const loadings = await tx.logisticsLoading.findMany({ where: { sourceKind: 'PARTNER_CASE' }, select: { id: true, partnerCaseId: true } });
    const byLoading = new Map(loadings.map(row => [row.id, row.partnerCaseId]));
    const allowed = new Set<string>();
    for (const caseId of [...new Set(loadings.flatMap(row => row.partnerCaseId ? [row.partnerCaseId] : []))].sort()) {
      if ((await authorizePartnerLoading(tx, actor, caseId, 'GUARD_READ')).ok) allowed.add(caseId);
    }
    const privateEvent = (event: Turn['events'][number]) => {
      const payload = object(event.payload), source = object(payload?.source);
      const loadingId = typeof payload?.loadingId === 'string' ? payload.loadingId : null;
      const caseId = loadingId ? byLoading.get(loadingId) : undefined;
      if (loadingId && byLoading.has(loadingId)) {
        return !caseId || !allowed.has(caseId) || (source && object(source.owner)?.caseId !== caseId);
      }
      // Incomplete or orphaned Partner provenance cannot become ordinary audit.
      return source?.sourceKind === 'PARTNER_CASE' || Boolean(source && 'owner' in source);
    };
    return read({ database: tx, present: turn => {
      const currentCase = turn.loadingId ? byLoading.get(turn.loadingId) : undefined;
      const hideCurrent = Boolean(turn.loadingId && byLoading.has(turn.loadingId) && (!currentCase || !allowed.has(currentCase)));
      if (!hideCurrent && !turn.events.some(privateEvent)) return turn;
      return { ...turn, loadingId: hideCurrent ? null : turn.loadingId, closureReason: null, voidReason: null,
        privateLoadingRestricted: true,
        events: turn.events.map(event => ({ id: event.id, eventType: event.eventType,
          fromStatus: event.fromStatus, toStatus: event.toStatus, recordedAt: event.recordedAt })) };
    } });
  });
}
