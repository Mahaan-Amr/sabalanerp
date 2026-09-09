import type { Prisma } from '@prisma/client';
import { canonicalPerformanceHash } from './personnelPerformancePolicy';
import { readPerformancePayload, performanceVaultKeyFromEnvironment } from './personnelPerformancePayloadStore';

/** Null resultIds means historical linkage is unknown, never an empty dependency set. */
export const readPerformanceConsequenceDependencies = async (tx: Prisma.TransactionClient, handoff: {
  packageId: string | null; encryptedPayloadId: string | null; snapshotHash: string;
}) => {
  const packageRecord = handoff.packageId ? await tx.performanceConsequencePackage.findUnique({ where: { id: handoff.packageId } }) : null;
  const payloadId = packageRecord?.encryptedPayloadId ?? handoff.encryptedPayloadId;
  if (!payloadId) return { payloadId, resultIds: null };
  const snapshot = await readPerformancePayload<{
    selectedResults?: Array<{ id: string }>; recentTrend?: Array<{ resultId: string }>;
    projectionResultIds?: string[]; currentProjection?: { state: string };
  }>(tx, payloadId, performanceVaultKeyFromEnvironment());
  if (canonicalPerformanceHash(snapshot) !== handoff.snapshotHash) throw Object.assign(new Error('وابستگی پیامد قابل تأیید نیست.'), { code: 'PERFORMANCE_RETENTION_DEPENDENCY_UNVERIFIED', status: 409 });
  if ((!snapshot.selectedResults && !snapshot.recentTrend && !snapshot.projectionResultIds)
    || (snapshot.currentProjection?.state === 'LEVEL' && !snapshot.projectionResultIds)) return { payloadId, resultIds: null };
  const resultIds = [...(snapshot.selectedResults ?? []).map(({ id }) => id), ...(snapshot.recentTrend ?? []).map(({ resultId }) => resultId), ...(snapshot.projectionResultIds ?? [])];
  if (resultIds.some((id) => typeof id !== 'string' || !id)) return { payloadId, resultIds: null };
  return { payloadId, resultIds: [...new Set(resultIds)] };
};
