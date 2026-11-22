import { createHash } from 'node:crypto';
/** Synthetic completed independent drill for pure policy/filesystem tests only. */
export function withHealthyDrill<T extends { id: string; releaseId: string; size: number; checksum?: string }>(artifact: T) {
  const checksum = artifact.checksum || createHash('sha256').update(artifact.id).digest('hex');
  const sourceMachineUuidSha256 = 'a'.repeat(64), sourceKernelBootIdSha256 = 'b'.repeat(64);
  return { ...artifact, checksum, sourceMachineUuidSha256, sourceKernelBootIdSha256, lastDrill: {
    format: 'sabalan-independent-checkpoint-drill/v1', status: 'HEALTHY', phase: 'COMPLETE',
    checkpointId: artifact.id, releaseId: artifact.releaseId, checksum, size: artifact.size,
    operationId: `drill-${artifact.id}-123`, packageType: 'COMPLETE',
    sourceMachineUuidSha256, sourceKernelBootIdSha256,
    recoveryMachineUuidSha256: 'c'.repeat(64), recoveryKernelBootIdSha256: 'd'.repeat(64),
    startedAt: '2026-10-05T00:00:00.000Z', completedAt: '2026-10-05T00:01:00.000Z',
    stagedPostgresRestore: true, stagedSqliteIntegrity: true, verifiedFiles: true,
    verifiedApplicationPayloads: true, verifiedBusinessData: true,
  } };
}
