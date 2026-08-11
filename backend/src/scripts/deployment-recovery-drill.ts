import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { readConfiguredFile } from '../services/deploymentCheckpointStorage';
import { assertIsolatedRecoveryDrill } from '../services/deploymentDrillPolicy';
import { sha256File } from '../services/recoveryCrypto';
import { readRestoreJournal, recoveryEngineInternals, stageAndPromoteRecovery, validateRecoveryPackage } from '../services/systemRecoveryEngine';
import { initializeSystemRecovery } from '../services/systemRecoveryLifecycle';

type RemoteMetadata = {
  deploymentId: string;
  releaseId: string;
  remotePath: string;
  checksum: string;
  remoteVerified: boolean;
  lastDrill?: Record<string, unknown>;
};

const execFileAsync = promisify(execFile);

const main = async () => {
  assertIsolatedRecoveryDrill(process.env);
  const expectedMarker = String(process.env.DEPLOYMENT_DRILL_DATABASE_MARKER);
  const controlDatabaseUrl = recoveryEngineInternals.databaseUrlWithName(String(process.env.DATABASE_URL), 'postgres');
  const markerResult = await execFileAsync('psql', [controlDatabaseUrl, '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    'SELECT marker FROM deployment_drill_environment_marker WHERE singleton = true'], { timeout: 30_000, windowsHide: true });
  if (markerResult.stdout.trim() !== expectedMarker) {
    throw Object.assign(new Error('The connected database did not prove its isolated drill identity.'), {
      code: 'DEPLOYMENT_DRILL_DATABASE_IDENTITY_MISMATCH',
    });
  }
  const metadataPath = String(process.env.DEPLOYMENT_DRILL_METADATA_PATH || '').trim();
  if (!metadataPath) throw Object.assign(new Error('DEPLOYMENT_DRILL_METADATA_PATH is required.'), { code: 'DEPLOYMENT_DRILL_CONFIGURATION_MISSING' });
  const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8')) as RemoteMetadata;
  if (!metadata.remoteVerified || !metadata.remotePath || !metadata.checksum) {
    throw Object.assign(new Error('Remote checkpoint metadata is not verified.'), { code: 'DEPLOYMENT_DRILL_CHECKPOINT_UNVERIFIED' });
  }
  if (await sha256File(metadata.remotePath) !== metadata.checksum) {
    throw Object.assign(new Error('Remote checkpoint checksum failed before the drill.'), { code: 'DEPLOYMENT_DRILL_CHECKSUM_MISMATCH' });
  }
  const remoteKey = await readConfiguredFile('DEPLOYMENT_REMOTE_RECOVERY_PRIVATE_KEY');
  const startedAt = new Date();
  const validation = await validateRecoveryPackage({ sourcePath: metadata.remotePath, passphrase: remoteKey, prisma });
  const operationId = `drill-${metadata.deploymentId}-${Date.now()}`;
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
  await initializeSystemRecovery(prisma);
  if (await readRestoreJournal()) throw Object.assign(new Error('Recovery drill finalization left an unresolved restore journal.'), { code: 'DEPLOYMENT_DRILL_FINALIZE_FAILED' });
  await prisma.$queryRawUnsafe('SELECT 1');
  const completedAt = new Date();
  const drill = {
    status: 'HEALTHY',
    operationId,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    compatibility: validation.compatibility,
    promoted: result.promoted,
  };
  await fs.promises.writeFile(metadataPath, `${JSON.stringify({ ...metadata, lastDrill: drill }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const reportRoot = process.env.DEPLOYMENT_REPORT_DIR || path.join(process.cwd(), 'reports', 'deploy');
  await fs.promises.mkdir(reportRoot, { recursive: true });
  await fs.promises.writeFile(path.join(reportRoot, `${operationId}.json`), `${JSON.stringify({ metadata, drill }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ok: true, drill }));
};

main()
  .catch((error: any) => {
    console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_DRILL_FAILED', message: error?.message }));
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
