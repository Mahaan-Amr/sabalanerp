import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { readConfiguredFile } from '../services/deploymentCheckpointStorage';
import { assertIsolatedRecoveryDrill } from '../services/deploymentDrillPolicy';
import { sha256File } from '../services/recoveryCrypto';
import { readRestoreJournal, stageAndPromoteRecovery, validateRecoveryPackage, verifyPromotedRecoveryFiles, validateLiveStoredFileReferences } from '../services/systemRecoveryEngine';
import { nativePostgresCliConnection } from '../services/nativePostgresCli';
import { initializeSystemRecovery } from '../services/systemRecoveryLifecycle';
import { getRecoveryRuntimeState } from '../services/recoveryRuntime';
import { assertIndependentRecoveryApplicationKeys, verifyRecoveredApplicationPayloads } from '../services/deploymentDrillApplicationKeys';
import { assertRecoveryBusinessProof } from '../services/deploymentRecoveryDataProof';
import { readRecoveryHostIdentity } from '../services/deploymentRecoveryHostIdentity';
import { hasHealthyIndependentCheckpointDrill } from '../services/deploymentCheckpointPolicy';

type RemoteMetadata = {
  id: string;
  deploymentId: string;
  releaseId: string;
  remotePath: string;
  checksum: string;
  size: number;
  sourceMachineUuidSha256?: string;
  sourceKernelBootIdSha256?: string;
  remoteVerified: boolean;
  lastDrill?: Record<string, unknown>;
};

const execFileAsync = promisify(execFile);

const main = async () => {
  assertIsolatedRecoveryDrill(process.env);
  assertIndependentRecoveryApplicationKeys();
  const expectedMarker = String(process.env.DEPLOYMENT_DRILL_DATABASE_MARKER);
  const controlConnection = nativePostgresCliConnection(String(process.env.DATABASE_URL), 'postgres');
  const markerResult = await execFileAsync('psql', [controlConnection.url, '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    'SELECT marker FROM deployment_drill_environment_marker WHERE singleton = true'], {
    env: { ...process.env, ...controlConnection.environment }, timeout: 30_000, windowsHide: true,
  });
  if (markerResult.stdout.trim() !== expectedMarker) {
    throw Object.assign(new Error('The connected database did not prove its isolated drill identity.'), {
      code: 'DEPLOYMENT_DRILL_DATABASE_IDENTITY_MISMATCH',
    });
  }
  const metadataPath = String(process.env.DEPLOYMENT_DRILL_METADATA_PATH || '').trim();
  if (!metadataPath) throw Object.assign(new Error('DEPLOYMENT_DRILL_METADATA_PATH is required.'), { code: 'DEPLOYMENT_DRILL_CONFIGURATION_MISSING' });
  let metadataBytes = await fs.promises.readFile(metadataPath, 'utf8');
  const metadata = JSON.parse(metadataBytes) as RemoteMetadata;
  if (!metadata.remoteVerified || !metadata.remotePath || !metadata.checksum) {
    throw Object.assign(new Error('Remote checkpoint metadata is not verified.'), { code: 'DEPLOYMENT_DRILL_CHECKPOINT_UNVERIFIED' });
  }
  if (await sha256File(metadata.remotePath) !== metadata.checksum) {
    throw Object.assign(new Error('Remote checkpoint checksum failed before the drill.'), { code: 'DEPLOYMENT_DRILL_CHECKSUM_MISMATCH' });
  }
  const recoveryHost = readRecoveryHostIdentity();
  if (metadata.id !== metadata.deploymentId || !metadata.releaseId
    || !/^[a-f0-9]{64}$/.test(metadata.sourceMachineUuidSha256 || '')
    || !/^[a-f0-9]{64}$/.test(metadata.sourceKernelBootIdSha256 || '')
    || recoveryHost.machineUuidSha256 === metadata.sourceMachineUuidSha256
    || recoveryHost.kernelBootIdSha256 === metadata.sourceKernelBootIdSha256
    || !Number.isSafeInteger(metadata.size) || metadata.size < 1
    || (await fs.promises.stat(metadata.remotePath)).size !== metadata.size) {
    throw new Error('DEPLOYMENT_DRILL_INDEPENDENT_HOST_OR_ARCHIVE_UNPROVEN');
  }
  const remoteKey = await readConfiguredFile('DEPLOYMENT_REMOTE_RECOVERY_PRIVATE_KEY');
  const startedAt = new Date();
  const operationId = `drill-${metadata.deploymentId}-${Date.now()}`;
  if (await fs.promises.readFile(metadataPath, 'utf8') !== metadataBytes) throw new Error('DEPLOYMENT_DRILL_EVIDENCE_CHANGED');
  // Withdraw old health before a new restore attempt. A failed or interrupted
  // attempt leaves RUNNING/unknown evidence, never a stale HEALTHY replacement.
  metadataBytes = `${JSON.stringify({ ...metadata, independentRestoreVerified: false, lastDrill: {
    format: 'sabalan-independent-checkpoint-drill/v1', status: 'RUNNING', phase: 'RESTORING',
    operationId, checkpointId: metadata.id, releaseId: metadata.releaseId, checksum: metadata.checksum,
    size: metadata.size, startedAt: startedAt.toISOString(),
  } }, null, 2)}\n`;
  await fs.promises.writeFile(metadataPath, metadataBytes, { encoding: 'utf8', mode: 0o600 });
  const validation = await validateRecoveryPackage({ sourcePath: metadata.remotePath, passphrase: remoteKey, prisma,
    verifyRestore: true, verifyApplicationPayloads: true, verifyBusinessData: true });
  if (validation.manifest.packageType !== 'COMPLETE' || !validation.compatibility.compatible) {
    throw Object.assign(new Error('The independent recovery target is incompatible.'), { code: 'DEPLOYMENT_DRILL_INCOMPATIBLE' });
  }
  // This standalone owner is about to replace its isolated target database.
  // Do not carry pre-promotion pooled sessions across the database rename.
  await disconnectDatabase();
  const result = await stageAndPromoteRecovery({
    operationId,
    sourcePath: metadata.remotePath,
    passphrase: remoteKey,
    packageType: 'COMPLETE',
    checksum: metadata.checksum,
    actorId: 'deployment-drill-service',
    actorDisplay: 'Automated isolated recovery drill',
    authorizationMode: 'BREAK_GLASS',
    breakGlassReason: `Scheduled isolated restore drill for ${metadata.releaseId}`,
    applyMigrations: true,
    preservePackage: true,
    onProgress: async (progress) => console.log(JSON.stringify({ event: 'drill-progress', progress })),
  });
  const inquiryTransformation=result.journal.inquiryTransformation;
  if(inquiryTransformation&&(inquiryTransformation.operationId!==operationId||inquiryTransformation.archiveSha256!==metadata.checksum))throw new Error('INQUIRY_TRANSFORMATION_JOURNAL_MISMATCH');
  const initialPromotedFiles = await verifyPromotedRecoveryFiles(validation.manifest,[],inquiryTransformation,validation.inquiryBusinessProof);
  let erasureReplay: { replayed: number; erasedArtifactPaths: string[] } | undefined;
  await initializeSystemRecovery(prisma, { onVerifiedErasureReplay: evidence => { erasureReplay = evidence; } });
  if (await readRestoreJournal() || getRecoveryRuntimeState().mode !== 'NORMAL') throw Object.assign(new Error('Recovery drill finalization did not prove a normal runtime.'), { code: 'DEPLOYMENT_DRILL_FINALIZE_FAILED' });
  await prisma.$queryRawUnsafe('SELECT 1');
  const promotedFiles = await verifyPromotedRecoveryFiles(validation.manifest, erasureReplay?.erasedArtifactPaths,inquiryTransformation,validation.inquiryBusinessProof);
  const liveFileReferences = await validateLiveStoredFileReferences(prisma);
  const applicationPayloads = await verifyRecoveredApplicationPayloads(prisma);
  const businessData = await assertRecoveryBusinessProof(prisma, validation.businessDataProof ?? []);
  const completedAt = new Date();
  const drill = {
    format: 'sabalan-independent-checkpoint-drill/v1',
    status: 'HEALTHY',
    phase: 'COMPLETE',
    checkpointId: metadata.id, releaseId: metadata.releaseId,
    checksum: metadata.checksum, size: metadata.size, packageType: 'COMPLETE',
    sourceMachineUuidSha256: metadata.sourceMachineUuidSha256,
    sourceKernelBootIdSha256: metadata.sourceKernelBootIdSha256,
    recoveryMachineUuidSha256: recoveryHost.machineUuidSha256,
    recoveryKernelBootIdSha256: recoveryHost.kernelBootIdSha256,
    operationId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    compatibility: validation.compatibility,
    promoted: result.promoted,
    promotedFiles,
    initialPromotedFiles,
    verifiedErasureReplay: { operations: erasureReplay?.replayed ?? 0, erasedArtifacts: erasureReplay?.erasedArtifactPaths.length ?? 0 },
    liveFileReferences,
    applicationPayloads,
    businessData,
    ...(inquiryTransformation?{inquiryTransformation}:{}),
    stagedPostgresRestore: true,
    stagedSqliteIntegrity: true,
    verifiedFiles: true,
    verifiedApplicationPayloads: true,
    verifiedBusinessData: true,
  };
  if (!hasHealthyIndependentCheckpointDrill({ ...metadata, lastDrill: drill })
    || JSON.stringify(readRecoveryHostIdentity()) !== JSON.stringify(recoveryHost)
    || await fs.promises.readFile(metadataPath, 'utf8') !== metadataBytes
    || (await fs.promises.stat(metadata.remotePath)).size !== metadata.size
    || await sha256File(metadata.remotePath) !== metadata.checksum) throw new Error('DEPLOYMENT_DRILL_EVIDENCE_CHANGED');
  await fs.promises.writeFile(metadataPath, `${JSON.stringify({ ...metadata, independentRestoreVerified: true, lastDrill: drill }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const reportRoot = process.env.DEPLOYMENT_REPORT_DIR || path.join(process.cwd(), 'reports', 'deploy');
  await fs.promises.mkdir(reportRoot, { recursive: true });
  await fs.promises.writeFile(path.join(reportRoot, `${operationId}.json`), `${JSON.stringify({ metadata, drill }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ok: true, drill }));
};

main()
  .catch((error: any) => {
    // Native command exceptions can include a connection URI or protected payload path.
    console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_DRILL_FAILED',
      message: 'تمرین بازیابی کامل نشد؛ کد خطا و شواهد خصوصی تمرین را بررسی کنید.' }));
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
