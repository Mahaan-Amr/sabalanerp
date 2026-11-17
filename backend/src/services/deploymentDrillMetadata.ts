import fs from 'node:fs';
import path from 'node:path';
import { hasHealthyIndependentCheckpointDrill, protectedCheckpointRoleComponent, type RemoteCheckpointArtifact } from './deploymentCheckpointPolicy';

export type DeploymentDrillMetadata = {
  deploymentId: string;
  createdAt: string;
  remoteVerified: boolean;
  lastDrill?: { status?: string; completedAt?: string };
  lastRehearsal?: { status?: string; completedAt?: string };
} & Partial<Pick<RemoteCheckpointArtifact, 'id' | 'releaseId' | 'size' | 'checksum' | 'sourceMachineUuidSha256'
  | 'sourceKernelBootIdSha256' | 'manifest'>>;

export function hasCurrentDrillEvidence(item: DeploymentDrillMetadata) {
  if (item.lastDrill?.status !== 'HEALTHY' || !item.lastDrill.completedAt) return false;
  try {
    if (!protectedCheckpointRoleComponent(item.manifest) && !('verifiedDatabaseRoles' in item.lastDrill)) return true;
    return item.id === item.deploymentId && typeof item.releaseId === 'string' && typeof item.size === 'number'
      && hasHealthyIndependentCheckpointDrill({ ...item, id: item.id, releaseId: item.releaseId, size: item.size });
  } catch {
    return false;
  }
}

type MetadataFileSystem = {
  readdir: (directory: string) => Promise<fs.Dirent[]>;
  readFile: (file: string) => Promise<string>;
};

const disk: MetadataFileSystem = {
  readdir: (directory) => fs.promises.readdir(directory, { withFileTypes: true }),
  readFile: (file) => fs.promises.readFile(file, 'utf8'),
};

// An accessible empty store permits the first deployment. An unreadable store
// cannot prove there are no previous checkpoints or overdue recovery drills.
export const readDeploymentDrillMetadata = async (
  root: string,
  fileSystem: MetadataFileSystem = disk,
): Promise<DeploymentDrillMetadata[]> => {
  const metadata: DeploymentDrillMetadata[] = [];
  const visit = async (directory: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = await fileSystem.readdir(directory);
    } catch {
      throw Object.assign(new Error('The configured remote checkpoint store cannot be read.'), {
        code: 'DEPLOYMENT_REMOTE_STORE_UNAVAILABLE',
      });
    }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name.endsWith('.sabrec.json')) {
        let item: DeploymentDrillMetadata;
        try {
          item = JSON.parse(await fileSystem.readFile(absolute));
          if (!item || typeof item.deploymentId !== 'string' || !item.deploymentId
            || typeof item.remoteVerified !== 'boolean'
            || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt))) {
            throw new Error('Invalid checkpoint metadata.');
          }
        } catch {
          throw Object.assign(new Error('Remote checkpoint metadata cannot be read or validated.'), {
            code: 'DEPLOYMENT_REMOTE_METADATA_INVALID',
          });
        }
        if (item.remoteVerified) metadata.push(item);
      }
    }
  };
  await visit(root);
  return metadata;
};
