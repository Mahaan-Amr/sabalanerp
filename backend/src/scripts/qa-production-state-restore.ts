import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { readConfiguredFile } from '../services/deploymentCheckpointStorage';
import { assertIsolatedRecoveryDrill } from '../services/deploymentDrillPolicy';
import { assertIndependentRecoveryApplicationKeys, verifyRecoveredApplicationPayloads } from '../services/deploymentDrillApplicationKeys';
import { assertRecoveryBusinessProof } from '../services/deploymentRecoveryDataProof';
import { sha256File } from '../services/recoveryCrypto';
import { nativePostgresCliConnection } from '../services/nativePostgresCli';
import { assertQaProductionStateRestorePlan, QaProductionStateRestorePlan } from '../services/qaProductionStateRestorePlan';
import { assertQaRestoreBootstrap, BUSINESS_TABLES } from '../services/qaRestoreBootstrap';
import { assertQaRetainedOldStateProof } from '../services/qaRetainedOldStateProof';
import { readRestoreJournal, stageAndPromoteRecovery, validateLiveStoredFileReferences,
  validateRecoveryPackage, verifyPromotedRecoveryFiles } from '../services/systemRecoveryEngine';
import { initializeSystemRecovery } from '../services/systemRecoveryLifecycle';
import { getRecoveryRuntimeState } from '../services/recoveryRuntime';

const execFileAsync = promisify(execFile);
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const regular = async (file: string, mode: number, owner = 0) => {
  const stat = await fs.promises.lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== owner || (stat.mode & 0o777) !== mode) fail('QA_RESTORE_CUSTODY_UNPROVEN');
  return stat;
};
const readJson = async (file: string) => JSON.parse(await fs.promises.readFile(file, 'utf8')) as Record<string, unknown>;

const bootstrapEmptyQaTarget = async (application: ReturnType<typeof nativePostgresCliConnection>) => {
  // The current database becomes the safety database during promotion. The
  // canonical erasure replay reads its schema even when it contains no rows.
  const entries = await fs.promises.readdir(path.join(process.cwd(), 'prisma', 'migrations'), { withFileTypes: true });
  const expected = (await Promise.all(entries.filter(entry => entry.isDirectory()).map(async entry => {
    const migration = path.join(process.cwd(), 'prisma', 'migrations', entry.name, 'migration.sql');
    return (await fs.promises.stat(migration).catch(() => null))?.isFile() ? entry.name : null;
  }))).filter((name): name is string => name !== null).sort();
  await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: process.cwd(), env: process.env, timeout: 900_000, maxBuffer: 16 * 1024 * 1024, windowsHide: true,
  });
  const query = async (sql: string) => (await execFileAsync('psql', [application.url, '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql], {
    env: { ...process.env, ...application.environment }, timeout: 30_000, windowsHide: true,
  })).stdout.trim();
  const ledger = (await query('SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name'))
    .split('\n').filter(Boolean);
  const total = Number(await query('SELECT count(*) FROM "_prisma_migrations"'));
  if (total !== ledger.length) fail('QA_RESTORE_BOOTSTRAP_SCHEMA_INCOMPLETE');
  const counts = JSON.parse(await query(`SELECT json_build_object(${BUSINESS_TABLES.map(table => `'${table}', (SELECT count(*) FROM "${table}")`).join(', ')})::text`)) as Record<string, number>;
  return assertQaRestoreBootstrap(expected, ledger, counts);
};

const assertQaEnvironment = () => {
  if (process.platform !== 'linux' || process.env.NODE_ENV !== 'test') fail('QA_RESTORE_NOT_ISOLATED');
  assertIsolatedRecoveryDrill(process.env);
  const database = new URL(String(process.env.DATABASE_URL || ''));
  const identityOnly = new URL(String(process.env.PRODUCTION_DATABASE_URL || ''));
  if (!['postgresql:', 'postgres:'].includes(database.protocol) || database.hostname !== 'postgres'
    || database.pathname === '/postgres'
    || !/^(sabalanerp|sabalanerp_qa_[a-z0-9_]+)$/.test(database.pathname.slice(1))
    || database.searchParams.get('connection_limit') !== '2' || database.searchParams.get('pool_timeout') !== '10'
    || !identityOnly.hostname.endsWith('.invalid') || identityOnly.password || identityOnly.username
    || process.env.INQUIRY_RECOVERY_COORDINATED !== 'false'
    || process.env.RECOVERY_STORAGE_DIR !== '/app/storage/recovery'
    || process.env.RECOVERY_COORDINATION_DIR !== '/app/recovery-coordination'
    || process.env.INQUIRY_RECOVERY_SOURCE_DIR !== '/app/recovery-sources/inquiry'
    || process.env.DEPLOYMENT_REPORT_DIR !== '/qa-evidence/reports'
    || process.env.DEPLOYMENT_REMOTE_RECOVERY_PRIVATE_KEY_FILE !== '/run/secrets/recovery-private.pem'
    || process.env.DEPLOYMENT_REMOTE_RECOVERY_PRIVATE_KEY) fail('QA_RESTORE_DATABASE_UNSAFE');
  assertIndependentRecoveryApplicationKeys();
  return database.pathname.slice(1);
};

async function main() {
  const databaseName = assertQaEnvironment();
  const planPath = process.env.QA_PRODUCTION_STATE_RESTORE_PLAN_FILE || '';
  const planHash = process.env.QA_PRODUCTION_STATE_RESTORE_PLAN_SHA256 || '';
  if (!planPath.startsWith('/qa-evidence/') || !/^[a-f0-9]{64}$/.test(planHash)) fail('QA_RESTORE_PLAN_INVALID');
  await regular(planPath, 0o400);
  if (await sha256File(planPath) !== planHash) fail('QA_RESTORE_PLAN_CHANGED');
  const rawPlan = await readJson(planPath);
  const plan = rawPlan as QaProductionStateRestorePlan;
  if (!plan.sourceObject || !plan.sourceSidecar) fail('QA_RESTORE_PLAN_INVALID');
  if (plan.qaTargetPlanSha256 !== process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256) fail('QA_RESTORE_TARGET_PLAN_CHANGED');
  if (!plan.checkpointId || !/^deploy-[a-zA-Z0-9-]+-release$/.test(plan.checkpointId)
    || plan.databaseName !== databaseName
    || plan.sourceObject.path !== `/qa-checkpoint/${plan.checkpointId}.sabrec`
    || plan.sourceSidecar.path !== `${plan.sourceObject.path}.json`
    || !plan.runSidecarPath?.startsWith('/qa-evidence/')) fail('QA_RESTORE_PLAN_INVALID');
  await regular(plan.sourceObject.path, 0o400);
  await regular(plan.sourceSidecar.path, 0o400);
  await regular(plan.runSidecarPath, 0o600);
  await regular('/run/secrets/recovery-private.pem', 0o400);
  const source = await readJson(plan.sourceSidecar.path);
  const run = await readJson(plan.runSidecarPath);
  assertQaProductionStateRestorePlan(rawPlan, source, run);
  const qaBootId = (await fs.promises.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim().toLowerCase();
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(qaBootId)) fail('QA_RESTORE_BOOT_IDENTITY_UNAVAILABLE');
  const qaBootIdSha256 = createHash('sha256').update(qaBootId).digest('hex');
  if (qaBootIdSha256 === source.sourceKernelBootIdSha256) fail('QA_RESTORE_SOURCE_BOOT_IDENTITY_MATCH');
  if (await sha256File(plan.sourceSidecar.path) !== plan.sourceSidecar.sha256
    || await sha256File(plan.sourceObject.path) !== plan.sourceObject.sha256
    || (await fs.promises.stat(plan.sourceObject.path)).size !== plan.sourceObject.size) fail('QA_RESTORE_SOURCE_CHANGED');
  if (await readRestoreJournal()) fail('QA_RESTORE_PENDING_JOURNAL');
  try { await fs.promises.lstat(plan.reportPath); fail('QA_RESTORE_REPORT_EXISTS'); }
  catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  const sourceHash = await sha256File(plan.sourceSidecar.path);
  const runHash = await sha256File(plan.runSidecarPath);
  const control = nativePostgresCliConnection(String(process.env.DATABASE_URL), 'postgres');
  const marker = await execFileAsync('psql', [control.url, '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    'SELECT marker FROM deployment_drill_environment_marker WHERE singleton = true'], {
    env: { ...process.env, ...control.environment }, timeout: 30_000, windowsHide: true,
  });
  if (marker.stdout.trim() !== process.env.DEPLOYMENT_DRILL_DATABASE_MARKER) fail('QA_RESTORE_DATABASE_IDENTITY_MISMATCH');
  const application = nativePostgresCliConnection(String(process.env.DATABASE_URL));
  const existing = await execFileAsync('psql', [application.url, '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'"], {
    env: { ...process.env, ...application.environment }, timeout: 30_000, windowsHide: true,
  });
  if (existing.stdout.trim() !== '0') fail('QA_RESTORE_TARGET_NOT_EMPTY');
  const key = await readConfiguredFile('DEPLOYMENT_REMOTE_RECOVERY_PRIVATE_KEY');
  const startedAt = new Date();
  const operationId = `qa-production-copy-${randomUUID()}`;
  const validation = await validateRecoveryPackage({ sourcePath: plan.sourceObject.path, passphrase: key, prisma,
    verifyRestore: true, verifyApplicationPayloads: true, verifyBusinessData: true });
  if (validation.manifest.packageType !== 'COMPLETE' || !validation.compatibility.compatible
    || !validation.inquiryBusinessProof || validation.manifest.commit !== plan.previousCommit) fail('QA_RESTORE_PACKAGE_INCOMPATIBLE');
  const sourceInquiryComponents = validation.manifest.components.filter(component => component.path === 'inquiry/inquiry.db');
  if (sourceInquiryComponents.length !== 1 || sourceInquiryComponents[0].sha256 !== plan.rawInquirySha256) {
    fail('QA_RESTORE_SOURCE_INQUIRY_CHANGED');
  }
  const businessDataProof = validation.businessDataProof;
  if (!businessDataProof) throw Object.assign(new Error('QA_RESTORE_PACKAGE_INCOMPATIBLE'), { code: 'QA_RESTORE_PACKAGE_INCOMPATIBLE' });
  const qaTargetSchemaBootstrap = await bootstrapEmptyQaTarget(application);
  if (await sha256File(plan.sourceObject.path) !== plan.sourceObject.sha256
    || await sha256File(plan.sourceSidecar.path) !== sourceHash
    || await sha256File(plan.runSidecarPath) !== runHash) fail('QA_RESTORE_EVIDENCE_CHANGED');
  // This standalone owner must close its pool before the current database is renamed.
  await disconnectDatabase();
  const result = await stageAndPromoteRecovery({ operationId, sourcePath: plan.sourceObject.path,
    passphrase: key, packageType: 'COMPLETE', checksum: plan.sourceObject.sha256,
    actorId: 'qa-production-state-copy', actorDisplay: 'Isolated QA production-state copy',
    authorizationMode: 'BREAK_GLASS', breakGlassReason: `QA-only production-state copy of ${source.releaseId}`,
    // Keep the restored production-state copy at the retained image's schema.
    // The protected release controller, not this QA preparation, owns candidate migrations.
    applyMigrations: false, preservePackage: true,
    onProgress: async progress => { console.log(JSON.stringify({ event: 'qa-restore-progress', progress })); },
  });
  const inquiryTransformation = result.journal.inquiryTransformation;
  if (!result.promoted || inquiryTransformation) fail('QA_RESTORE_PROMOTION_UNPROVEN');
  const initialPromotedFiles = await verifyPromotedRecoveryFiles(validation.manifest, [], inquiryTransformation, validation.inquiryBusinessProof);
  const rawInquiryPath = path.join(String(process.env.INQUIRY_RECOVERY_SOURCE_DIR), 'inquiry.db');
  const rawInquirySha256 = await sha256File(rawInquiryPath);
  const sourceLedger = await execFileAsync('psql', [application.url, '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    `SELECT json_build_object(
      'successful', count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
      'rolledBack', count(*) FILTER (WHERE rolled_back_at IS NOT NULL),
      'unfinished', count(*) FILTER (WHERE finished_at IS NULL AND rolled_back_at IS NULL),
      'latest', max(migration_name) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL))::text
     FROM "_prisma_migrations"`], {
    env: { ...process.env, ...application.environment }, timeout: 30_000, windowsHide: true,
  });
  const retainedOldStateProof = assertQaRetainedOldStateProof(plan, {
    promoted: result.promoted, inquiryTransformation, manifestCommit: validation.manifest.commit,
    manifestInquirySha256: sourceInquiryComponents[0].sha256, liveInquirySha256: rawInquirySha256,
    sourceMigrationLedger: JSON.parse(sourceLedger.stdout.trim()),
  });
  let erasureReplay: { replayed: number; erasedArtifactPaths: string[] } | undefined;
  await initializeSystemRecovery(prisma, { onVerifiedErasureReplay: evidence => { erasureReplay = evidence; } });
  if (await readRestoreJournal() || getRecoveryRuntimeState().mode !== 'NORMAL') fail('QA_RESTORE_FINALIZATION_FAILED');
  await prisma.$queryRawUnsafe('SELECT 1');
  const promotedFiles = await verifyPromotedRecoveryFiles(validation.manifest, erasureReplay?.erasedArtifactPaths,
    inquiryTransformation, validation.inquiryBusinessProof);
  const liveFileReferences = await validateLiveStoredFileReferences(prisma);
  const applicationPayloads = await verifyRecoveredApplicationPayloads(prisma);
  const businessData = await assertRecoveryBusinessProof(prisma, businessDataProof);
  if (await sha256File(plan.sourceObject.path) !== plan.sourceObject.sha256
    || await sha256File(plan.sourceSidecar.path) !== sourceHash
    || await sha256File(plan.runSidecarPath) !== runHash
    || await readRestoreJournal()) fail('QA_RESTORE_EVIDENCE_CHANGED');
  const report = { format: 'sabalan-qa-production-state-copy/v1', qaOnly: true, productionAdmission: false,
    status: 'RESTORED', operationId, checkpointId: plan.checkpointId, releaseId: source.releaseId,
    startedAt: startedAt.toISOString(), completedAt: new Date().toISOString(), packageType: 'COMPLETE',
    sourceObjectSha256: plan.sourceObject.sha256, sourceObjectSize: plan.sourceObject.size,
    sourceMachineUuidSha256: source.sourceMachineUuidSha256, sourceKernelBootIdSha256: source.sourceKernelBootIdSha256,
    qaKernelBootIdSha256: qaBootIdSha256, hostIdentityScope: 'boot-only',
    sourceSidecarSha256: sourceHash, runSidecarSha256: runHash, compatibility: validation.compatibility,
    stagedPostgresRestore: true, stagedSqliteIntegrity: true, verifiedFiles: true,
    verifiedApplicationPayloads: true, verifiedBusinessData: true, initialPromotedFiles, promotedFiles,
    qaTargetSchemaBootstrap, retainedOldState: true, retainedPreviousImages: plan.previousImages, ...retainedOldStateProof,
    liveFileReferences, applicationPayloads, businessData,
    verifiedErasureReplay: { operations: erasureReplay?.replayed ?? 0, erasedArtifacts: erasureReplay?.erasedArtifactPaths.length ?? 0 },
    inquiryTransformation };
  await fs.promises.writeFile(plan.reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  console.log(JSON.stringify({ ok: true, qaOnly: true, reportPath: path.basename(plan.reportPath), operationId }));
}

main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'QA_RESTORE_FAILED' }));
  process.exitCode = 1;
}).finally(() => disconnectDatabase());
