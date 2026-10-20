import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { performanceExportStorageDirectory } from './performanceFileRuntime';

type Receipt = { id: string; exportKind: string; attemptCount: number; artifactPath: string | null };
const fail = (): never => { throw Object.assign(Error('PERFORMANCE_EXPORT_ARTIFACT_PATH_UNVERIFIED'), {
  code: 'PERFORMANCE_EXPORT_ARTIFACT_PATH_UNVERIFIED', status: 503,
}); };
/** Original SQL paths remain immutable evidence. Only a domain-generated
 * receipt/attempt/kind name with its committed inventory can resolve under the
 * current configured root after a restore; arbitrary basenames cannot. */
export function performanceInventoryArtifactPath(receipt: Pick<Receipt, 'id' | 'exportKind'>,
  artifact: { attemptCount: number; artifactPath: string }) {
  if (!/^[A-Za-z0-9_-]{1,191}$/.test(receipt.id) || !['PDF', 'XLSX'].includes(receipt.exportKind)
    || !Number.isSafeInteger(artifact.attemptCount) || artifact.attemptCount < 1) return fail();
  const expected = `${receipt.id}-${artifact.attemptCount}.${receipt.exportKind === 'PDF' ? 'pdf' : 'xlsx'}.enc`;
  if (!path.isAbsolute(artifact.artifactPath) || path.resolve(artifact.artifactPath) !== artifact.artifactPath
    || path.basename(artifact.artifactPath) !== expected) return fail();
  return path.join(performanceExportStorageDirectory(), expected);
}
export async function resolvePerformanceExportArtifactPath(client: Pick<Prisma.TransactionClient, 'performanceExportArtifact'>, receipt: Receipt) {
  if (!receipt.artifactPath) return fail();
  const artifact = await client.performanceExportArtifact.findUnique({ where: {
    exportId_attemptCount: { exportId: receipt.id, attemptCount: receipt.attemptCount },
  } });
  if (!artifact || artifact.artifactPath !== receipt.artifactPath) return fail();
  return performanceInventoryArtifactPath(receipt, artifact);
}
