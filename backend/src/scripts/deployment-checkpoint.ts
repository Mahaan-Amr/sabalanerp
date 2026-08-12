import fs from 'node:fs';
import path from 'node:path';
import { disconnectDatabase, prisma } from '../lib/prisma';
import {
  directorySize,
  enforceFilesystemRemoteRetention,
  ensureLocalCapacity,
  estimateCheckpointCapacity,
  FilesystemRemoteCheckpointStore,
  readConfiguredFile,
  readSecret,
  type CheckpointObject,
} from '../services/deploymentCheckpointStorage';
import { createRecoveryPackage, validateRecoveryPackage } from '../services/systemRecoveryEngine';
import { RECOVERY_COORDINATION_DIR, RECOVERY_ROOT } from '../services/recoveryRuntime';

const required = (name: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value || /UNCONFIGURED|REPLACE/.test(value)) {
    throw Object.assign(new Error(`${name} is required.`), { code: 'DEPLOYMENT_CONFIGURATION_MISSING' });
  }
  return value;
};

const loadLocalArtifacts = async (packageRoot: string): Promise<CheckpointObject[]> => {
  const entries = await fs.promises.readdir(packageRoot, { withFileTypes: true }).catch(() => []);
  const artifacts: CheckpointObject[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.startsWith('deploy-') && entry.name.endsWith('.sabrec')) {
      const archivePath = path.join(packageRoot, entry.name);
      const sidecarPath = `${archivePath}.json`;
      const stat = await fs.promises.stat(archivePath);
      if (!fs.existsSync(sidecarPath) && Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) {
        await fs.promises.rm(archivePath, { force: true });
      }
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.sabrec.json')) continue;
    const metadataPath = path.join(packageRoot, entry.name);
    try {
      const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8')) as CheckpointObject;
      if (metadata.id && metadata.archivePath && metadata.checksum && Number.isFinite(metadata.size) && Number.isFinite(new Date(metadata.createdAt).getTime())) artifacts.push(metadata);
    } catch {
      // An incomplete or corrupt sidecar is never eligible for automatic deletion.
    }
  }
  return artifacts;
};

const main = async () => {
  const deploymentId = required('DEPLOYMENT_ID');
  const releaseId = required('DEPLOYMENT_RELEASE_ID');
  const targetCommit = required('DEPLOYMENT_TARGET_COMMIT');
  const remoteRoot = required('DEPLOYMENT_REMOTE_MOUNT');
  const localKey = await readSecret('DEPLOYMENT_LOCAL_ROLLBACK_KEY');
  const remotePublicKey = await readConfiguredFile('DEPLOYMENT_REMOTE_RECOVERY_PUBLIC_KEY');
  const packagesRoot = path.join(RECOVERY_ROOT, 'packages');
  await fs.promises.mkdir(packagesRoot, { recursive: true });

  const protectedFilesBytes = await Promise.all([
    directorySize(path.join(process.cwd(), 'storage', 'contracts')),
    directorySize(path.join(process.cwd(), 'storage', 'hr-hiring')),
    directorySize(path.join(process.cwd(), 'storage', 'accounting-contracts')),
    directorySize(path.join(process.cwd(), 'storage', 'support-tickets')),
    directorySize(path.join(process.cwd(), 'uploads')),
    directorySize(process.env.INQUIRY_RECOVERY_SOURCE_DIR || path.join(process.cwd(), 'recovery-sources', 'inquiry')),
    directorySize(RECOVERY_COORDINATION_DIR),
  ]).then((sizes) => sizes.reduce((total, size) => total + size, 0));
  const databaseSizeRows = await prisma.$queryRawUnsafe<Array<{ bytes: bigint }>>('SELECT pg_database_size(current_database()) AS bytes');
  const databaseBytes = Number(databaseSizeRows[0]?.bytes || 0);
  const capacity = estimateCheckpointCapacity({ databaseBytes, protectedFilesBytes });
  const auditPath = path.join(RECOVERY_ROOT, 'audit', 'deployment-retention.jsonl');
  const localCapacity = await ensureLocalCapacity({
    root: RECOVERY_ROOT,
    requiredBytes: capacity.requiredLocalBytes,
    artifacts: await loadLocalArtifacts(packagesRoot),
    activeDeploymentId: deploymentId,
    auditPath,
  });
  const remote = new FilesystemRemoteCheckpointStore(remoteRoot);
  const preUploadRemoteRetention = await enforceFilesystemRemoteRetention(remoteRoot, deploymentId);
  const remoteCapacity = await remote.assertAvailable(capacity.requiredRemoteBytes);

  const result = await createRecoveryPackage({
    operationId: deploymentId,
    packageType: 'COMPLETE',
    recipients: [
      { keyId: 'local-rollback', passphrase: localKey },
      { keyId: 'remote-recovery', publicKeyPem: remotePublicKey },
    ],
    prisma,
    onProgress: async (progress) => console.log(JSON.stringify({ event: 'checkpoint-progress', progress })),
  });
  const localValidation = await validateRecoveryPackage({ sourcePath: result.destination, passphrase: localKey, prisma, verifyRestore: true });

  const objectKey = `${releaseId}/${deploymentId}.sabrec`;
  // The local package has already passed decrypt, manifest, compatibility, and
  // restore validation. uploadVerified performs a full streaming read-back of
  // the remote object and requires it to be byte-identical to that package.
  // Decrypting the identical remote bytes again would add another complete
  // off-server transfer without proving a different safety property.
  const uploaded = await remote.uploadVerified(result.destination, objectKey, result.sha256);

  const metadata = {
    id: deploymentId,
    deploymentId,
    releaseId,
    targetCommit,
    createdAt: new Date().toISOString(),
    archivePath: result.destination,
    localPath: result.destination,
    remotePath: uploaded.objectPath,
    remoteFingerprint: uploaded.fingerprint,
    checksum: uploaded.checksum,
    size: uploaded.size,
    remoteVerified: true,
    localVerified: true,
    manifestReadable: Boolean(localValidation.manifest),
    compatibility: { local: localValidation.compatibility, remote: localValidation.compatibility },
    capacity: { estimate: capacity, localAvailableBytes: localCapacity.availableBytes, remoteAvailableBytes: remoteCapacity.availableBytes },
    manifest: result.manifest,
    rollbackReleaseSet: {
      backend: required('DEPLOYMENT_PREVIOUS_BACKEND_IMAGE'),
      frontend: required('DEPLOYMENT_PREVIOUS_FRONTEND_IMAGE'),
      inquiry: required('DEPLOYMENT_PREVIOUS_INQUIRY_IMAGE'),
      nginx: required('DEPLOYMENT_PREVIOUS_NGINX_IMAGE'),
      postgres: required('DEPLOYMENT_PREVIOUS_POSTGRES_IMAGE'),
      clamav: required('DEPLOYMENT_PREVIOUS_CLAMAV_IMAGE'),
    },
  };

  const localMetadataPath = `${result.destination}.json`;
  const coordinationMetadataPath = path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json');
  const remoteMetadataKey = `${objectKey}.json`;
  const remoteMetadataPath = path.join(remoteRoot, remoteMetadataKey);
  await fs.promises.writeFile(localMetadataPath, `${JSON.stringify({ ...metadata, metadataPath: localMetadataPath }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await fs.promises.mkdir(path.dirname(remoteMetadataPath), { recursive: true });
  await fs.promises.writeFile(remoteMetadataPath, `${JSON.stringify({ ...metadata, localPath: undefined, archivePath: undefined }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const readBackMetadata = await remote.readMetadata(remoteMetadataKey);
  if (readBackMetadata.checksum !== uploaded.checksum || readBackMetadata.deploymentId !== deploymentId) {
    throw Object.assign(new Error('Remote checkpoint manifest read-back did not match the uploaded checkpoint.'), {
      code: 'DEPLOYMENT_REMOTE_MANIFEST_MISMATCH',
    });
  }
  const remoteRetention = await enforceFilesystemRemoteRetention(remoteRoot, deploymentId);
  await fs.promises.writeFile(coordinationMetadataPath, `${JSON.stringify({ ...metadata, metadataPath: localMetadataPath }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    await prisma.deploymentOperation.update({ where: { id: deploymentId }, data: { checkpointJson: metadata as any } });
  } catch (error: any) {
    if (process.env.DEPLOYMENT_INITIAL_SCHEMA_BOOTSTRAP !== 'true' || error?.code !== 'P2021') throw error;
  }
  console.log(JSON.stringify({ ok: true, checkpoint: metadata, preUploadRemoteRetention, remoteRetention }));
};

main()
  .catch((error: any) => {
    console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_CHECKPOINT_FAILED', message: error?.message }));
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
