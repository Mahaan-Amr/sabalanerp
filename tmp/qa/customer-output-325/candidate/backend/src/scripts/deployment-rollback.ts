import fs from 'node:fs';
import path from 'node:path';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { readSecret } from '../services/deploymentCheckpointStorage';
import { sha256File } from '../services/recoveryCrypto';
import { stageAndPromoteRecovery, validateRecoveryPackage } from '../services/systemRecoveryEngine';
import { RECOVERY_COORDINATION_DIR, setRecoveryRuntimeState } from '../services/recoveryRuntime';

type CheckpointMetadata = {
  deploymentId: string;
  localPath: string;
  checksum: string;
  localVerified: boolean;
  remoteVerified: boolean;
  rollbackReleaseSet: Record<'backend' | 'frontend' | 'inquiry' | 'nginx', string>;
};

const main = async () => {
  const metadataPath = path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json');
  const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8')) as CheckpointMetadata;
  if (!metadata.localVerified || !metadata.remoteVerified || !metadata.localPath || !metadata.checksum) {
    throw Object.assign(new Error('The deployment checkpoint is not proven safe for automatic rollback.'), {
      code: 'DEPLOYMENT_ROLLBACK_CHECKPOINT_UNVERIFIED',
    });
  }
  if (await sha256File(metadata.localPath) !== metadata.checksum) {
    throw Object.assign(new Error('The local rollback checkpoint checksum changed.'), { code: 'DEPLOYMENT_ROLLBACK_CHECKSUM_MISMATCH' });
  }
  const localKey = await readSecret('DEPLOYMENT_LOCAL_ROLLBACK_KEY');
  await validateRecoveryPackage({ sourcePath: metadata.localPath, passphrase: localKey, prisma });
  setRecoveryRuntimeState('MAINTENANCE', metadata.deploymentId, 'Automatic deployment rollback is in progress.');
  const result = await stageAndPromoteRecovery({
    operationId: `rollback-${metadata.deploymentId}`,
    sourcePath: metadata.localPath,
    passphrase: localKey,
    packageType: 'COMPLETE',
    checksum: metadata.checksum,
    actorId: 'deployment-service',
    actorDisplay: 'Automated deployment service',
    authorizationMode: 'BREAK_GLASS',
    breakGlassReason: `Automatic rollback for deployment ${metadata.deploymentId}`,
    applyMigrations: false,
    preservePackage: true,
    onProgress: async (progress) => console.log(JSON.stringify({ event: 'rollback-progress', progress })),
  });
  console.log(JSON.stringify({ ok: true, result, rollbackReleaseSet: metadata.rollbackReleaseSet }));
};

main()
  .catch((error: any) => {
    console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_ROLLBACK_FAILED', message: error?.message }));
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
