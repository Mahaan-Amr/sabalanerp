import { canRetireOnlineDirectory, hasHealthyOnlineDirectory, type OnlineDirectoryEvidence } from './onlineCheckpointDirectory';

export type LocalCheckpointArtifact = {
  id: string;
  createdAt: Date;
  size: number;
  remoteVerified: boolean;
  active: boolean;
  incidentOpen: boolean;
};

export const planLocalCheckpointCleanup = (input: {
  artifacts: LocalCheckpointArtifact[];
  bytesNeeded: number;
  minimumSuccessfulLocal: number;
}) => {
  const verifiedSuccessful = input.artifacts
    .filter((artifact) => artifact.remoteVerified && !artifact.active && !artifact.incidentOpen)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const retained = new Set(verifiedSuccessful.slice(0, input.minimumSuccessfulLocal).map((artifact) => artifact.id));
  const eligible = verifiedSuccessful
    .filter((artifact) => !retained.has(artifact.id))
    .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());

  const deleteIds: string[] = [];
  let reclaimedBytes = 0;
  for (const artifact of eligible) {
    if (reclaimedBytes >= input.bytesNeeded) break;
    deleteIds.push(artifact.id);
    reclaimedBytes += artifact.size;
  }
  return {
    deleteIds,
    reclaimedBytes,
    sufficient: reclaimedBytes >= input.bytesNeeded,
  };
};

export type IndependentCheckpointDrill = {
  format: 'sabalan-independent-checkpoint-drill/v1'; status: 'HEALTHY'; phase: 'COMPLETE';
  operationId: string; checkpointId: string; releaseId: string; checksum: string; size: number;
  packageType: 'COMPLETE'; sourceMachineUuidSha256: string; recoveryMachineUuidSha256: string;
  sourceKernelBootIdSha256: string; recoveryKernelBootIdSha256: string;
  startedAt: string; completedAt: string; stagedPostgresRestore: true; stagedSqliteIntegrity: true;
  verifiedFiles: true; verifiedApplicationPayloads: true; verifiedBusinessData: true;
};
export type RemoteCheckpointArtifact = LocalCheckpointArtifact & { releaseId: string; checksum?: string;
  sourceMachineUuidSha256?: string; sourceKernelBootIdSha256?: string; restoreVerified?: boolean; lastDrill?: unknown;
  onlineDirectoryEvidence?: OnlineDirectoryEvidence };

/** Local restore validation and remote byte equality do not prove independent recovery. */
export const hasHealthyIndependentCheckpointDrill = (artifact: Pick<RemoteCheckpointArtifact,
  'id' | 'releaseId' | 'checksum' | 'size' | 'sourceMachineUuidSha256' | 'sourceKernelBootIdSha256' | 'lastDrill'>): boolean => {
  const drill = artifact.lastDrill as Partial<IndependentCheckpointDrill> | undefined;
  const digest = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!drill || drill.format !== 'sabalan-independent-checkpoint-drill/v1' || drill.status !== 'HEALTHY'
    || drill.phase !== 'COMPLETE' || drill.packageType !== 'COMPLETE'
    || drill.checkpointId !== artifact.id || drill.releaseId !== artifact.releaseId
    || !digest(artifact.checksum) || drill.checksum !== artifact.checksum
    || !Number.isSafeInteger(artifact.size) || artifact.size < 1 || drill.size !== artifact.size
    || !digest(artifact.sourceMachineUuidSha256) || drill.sourceMachineUuidSha256 !== artifact.sourceMachineUuidSha256
    || !digest(drill.recoveryMachineUuidSha256) || drill.recoveryMachineUuidSha256 === drill.sourceMachineUuidSha256
    || !digest(artifact.sourceKernelBootIdSha256) || drill.sourceKernelBootIdSha256 !== artifact.sourceKernelBootIdSha256
    || !digest(drill.recoveryKernelBootIdSha256) || drill.recoveryKernelBootIdSha256 === drill.sourceKernelBootIdSha256
    || typeof drill.operationId !== 'string' || !drill.operationId.startsWith(`drill-${artifact.id}-`)
    || !/^\d+$/.test(drill.operationId.slice(`drill-${artifact.id}-`.length))
    || !drill.startedAt || !drill.completedAt || !Number.isFinite(Date.parse(drill.startedAt))
    || !Number.isFinite(Date.parse(drill.completedAt)) || Date.parse(drill.completedAt) < Date.parse(drill.startedAt)) return false;
  return drill.stagedPostgresRestore === true && drill.stagedSqliteIntegrity === true
    && drill.verifiedFiles === true && drill.verifiedApplicationPayloads === true && drill.verifiedBusinessData === true;
};

export const hasHealthyRemoteRecoveryPoint = (artifact: RemoteCheckpointArtifact) =>
  artifact.onlineDirectoryEvidence ? hasHealthyOnlineDirectory(artifact.onlineDirectoryEvidence, artifact)
    : hasHealthyIndependentCheckpointDrill(artifact);

export const planRemoteCheckpointRetention = (artifacts: RemoteCheckpointArtifact[]) => {
  const verified = artifacts
    .filter((artifact) => artifact.remoteVerified && hasHealthyRemoteRecoveryPoint(artifact)
      && Number.isFinite(artifact.createdAt.getTime()))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
  const keep = new Set(verified.slice(0, 2).map(artifact => artifact.id));
  for (const artifact of artifacts) {
    if (artifact.active || artifact.incidentOpen || !artifact.remoteVerified || !hasHealthyRemoteRecoveryPoint(artifact)
      || artifact.onlineDirectoryEvidence && !canRetireOnlineDirectory(artifact.onlineDirectoryEvidence)
      || !Number.isFinite(artifact.createdAt.getTime()) || verified.length < 2) keep.add(artifact.id);
  }
  return {
    keepIds: [...keep],
    deleteIds: verified.filter((artifact) => !keep.has(artifact.id)).map((artifact) => artifact.id),
  };
};
