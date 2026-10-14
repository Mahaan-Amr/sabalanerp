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

export type RemoteCheckpointArtifact = LocalCheckpointArtifact & { releaseId: string; restoreVerified?: boolean };

export const planRemoteCheckpointRetention = (artifacts: RemoteCheckpointArtifact[]) => {
  const verified = artifacts
    .filter((artifact) => artifact.remoteVerified && artifact.restoreVerified === true
      && Number.isFinite(artifact.createdAt.getTime()))
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime() || right.id.localeCompare(left.id));
  const keep = new Set(verified.slice(0, 2).map(artifact => artifact.id));
  for (const artifact of artifacts) {
    if (artifact.active || artifact.incidentOpen || !artifact.remoteVerified || artifact.restoreVerified !== true
      || !Number.isFinite(artifact.createdAt.getTime()) || verified.length < 2) keep.add(artifact.id);
  }
  return {
    keepIds: [...keep],
    deleteIds: verified.filter((artifact) => !keep.has(artifact.id)).map((artifact) => artifact.id),
  };
};
