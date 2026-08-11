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

export type RemoteCheckpointArtifact = LocalCheckpointArtifact & { releaseId: string };

export const planRemoteCheckpointRetention = (artifacts: RemoteCheckpointArtifact[]) => {
  const verified = artifacts
    .filter((artifact) => artifact.remoteVerified)
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());
  const keep = new Set<string>();
  const recentReleases = new Set<string>();
  for (const artifact of verified) {
    if (recentReleases.size >= 10 && !recentReleases.has(artifact.releaseId)) continue;
    recentReleases.add(artifact.releaseId);
    keep.add(artifact.id);
  }
  const months = new Set<string>();
  for (const artifact of verified) {
    const month = artifact.createdAt.toISOString().slice(0, 7);
    if (months.has(month)) continue;
    if (months.size >= 12) break;
    months.add(month);
    keep.add(artifact.id);
  }
  for (const artifact of artifacts) {
    if (artifact.active || artifact.incidentOpen || !artifact.remoteVerified) keep.add(artifact.id);
  }
  return {
    keepIds: [...keep],
    deleteIds: verified.filter((artifact) => !keep.has(artifact.id)).map((artifact) => artifact.id),
  };
};
