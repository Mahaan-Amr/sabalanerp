import fs from 'node:fs';
import { recoverUnit, restoreUnit, requireBoundary } from '../../scripts/clamav-checkpoint.mjs';
import path from 'node:path';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { readSecret } from '../services/deploymentCheckpointStorage';
import { decryptRecoveryArchive, sha256File } from '../services/recoveryCrypto';
import { stageAndPromoteRecovery, validateRecoveryPackage } from '../services/systemRecoveryEngine';
import { RECOVERY_COORDINATION_DIR, setRecoveryRuntimeState } from '../services/recoveryRuntime';

type CheckpointMetadata = {
  deploymentId: string;
  localPath: string;
  checksum: string;
  localVerified: boolean;
  remoteVerified: boolean;
  rollbackReleaseSet: Record<'backend' | 'frontend' | 'inquiry' | 'nginx' | 'postgres' | 'clamav', string>;
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
  const validated = await validateRecoveryPackage({ sourcePath: metadata.localPath, passphrase: localKey, prisma });
  const clamavUnit = path.join(RECOVERY_COORDINATION_DIR, `clamav-checkpoint-${metadata.deploymentId}`);
  if (validated.manifest.components.some((item) => item.path.startsWith(`recovery-coordination/clamav-checkpoint-${metadata.deploymentId}/`))) {
    const session = JSON.parse(await fs.promises.readFile(path.join(process.env.DEPLOYMENT_REPORT_DIR || '/app/deployment-reports', 'active-deployment-session.json'), 'utf8'));
    const maintenance = JSON.parse(await fs.promises.readFile(path.join(RECOVERY_COORDINATION_DIR, 'deployment-maintenance.json'), 'utf8'));
    const active = await prisma.deploymentOperation.findUnique({ where: { activeKey: 'production' } });
    requireBoundary({ session, active, maintenance, id: metadata.deploymentId, token: process.env.DEPLOYMENT_LEASE_TOKEN || '', phase: 'ROLLBACK_STARTED' });
    await recoverUnit({
      unit: clamavUnit, id: metadata.deploymentId, checkpoint: { ...metadata, manifest: validated.manifest },
      readArchive: (destination) => decryptRecoveryArchive(metadata.localPath, destination, localKey),
    });
    // Recheck the live lease after potentially large archive IO, before any bank mutation.
    const liveSession = JSON.parse(await fs.promises.readFile(path.join(process.env.DEPLOYMENT_REPORT_DIR || '/app/deployment-reports', 'active-deployment-session.json'), 'utf8'));
    const liveMaintenance = JSON.parse(await fs.promises.readFile(path.join(RECOVERY_COORDINATION_DIR, 'deployment-maintenance.json'), 'utf8'));
    const liveActive = await prisma.deploymentOperation.findUnique({ where: { activeKey: 'production' } });
    requireBoundary({ session: liveSession, active: liveActive, maintenance: liveMaintenance, id: metadata.deploymentId, token: process.env.DEPLOYMENT_LEASE_TOKEN || '', phase: 'ROLLBACK_STARTED' });
    await restoreUnit({ bank: '/app/recovery-sources/clamav', unit: clamavUnit, id: metadata.deploymentId, checkpoint: { ...metadata, manifest: validated.manifest } });
  }
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
