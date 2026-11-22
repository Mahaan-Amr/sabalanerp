import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { Prisma } from '@prisma/client';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { activateDeploymentMaintenance, deactivateDeploymentMaintenance, readDeploymentMaintenance } from '../services/deploymentMaintenance';
import { assertIsolatedRecoveryDrill } from '../services/deploymentDrillPolicy';
import { nativePostgresCliConnection } from '../services/nativePostgresCli';
import { assertQaRestoredLeaseEvidence, assertQaSnapshotOperation, QaRestoredLeasePlan, QaSourceTerminalProof } from '../services/qaRestoredLeaseReconcile';
import { sha256File } from '../services/recoveryCrypto';
import { readRestoreJournal } from '../services/systemRecoveryEngine';

const execFileAsync = promisify(execFile);
const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const regular = async (file: string, mode: number) => {
  if (!file.startsWith('/qa-evidence/') && !file.startsWith('/qa-checkpoint/')) fail('QA_LEASE_CUSTODY_INVALID');
  if (path.posix.normalize(file) !== file || file.includes('//')) fail('QA_LEASE_CUSTODY_INVALID');
  const stat = await fs.promises.lstat(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== 0 || (stat.mode & 0o777) !== mode) fail('QA_LEASE_CUSTODY_INVALID');
  return stat;
};
const readJson = async (file: string) => JSON.parse(await fs.promises.readFile(file, 'utf8')) as Record<string, unknown>;

async function main() {
  const command = process.argv[2];
  if (!['prepare', 'apply'].includes(command)) fail('QA_LEASE_COMMAND_INVALID');
  if (process.platform !== 'linux' || process.env.NODE_ENV !== 'test'
    || process.env.QA_RECONCILE_HOST_LOCK_HELD !== 'true'
    || process.env.BACKEND_RUNTIME_ROLE !== 'control') fail('QA_LEASE_NOT_ISOLATED');
  assertIsolatedRecoveryDrill(process.env);
  const database = new URL(String(process.env.DATABASE_URL || ''));
  const production = new URL(String(process.env.PRODUCTION_DATABASE_URL || ''));
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== 'postgres'
    || !/^(sabalanerp|sabalanerp_qa_[a-z0-9_]+)$/.test(database.pathname.slice(1))
    || database.searchParams.get('connection_limit') !== '2' || database.searchParams.get('pool_timeout') !== '10'
    || !production.hostname.endsWith('.invalid') || production.username || production.password
    || process.env.DEPLOYMENT_REPORT_DIR !== '/qa-evidence/reports'
    || process.env.RECOVERY_COORDINATION_DIR !== '/app/recovery-coordination') fail('QA_LEASE_DATABASE_UNSAFE');
  const planFile = '/qa-evidence/lease-reconcile-plan.json';
  const proofFile = '/qa-evidence/production-terminal-proof.json';
  const restorePlanFile = '/qa-evidence/restore-plan.json';
  const planSha = process.env.QA_RECONCILE_PLAN_SHA256 || '';
  if (!/^[a-f0-9]{64}$/.test(planSha)) fail('QA_LEASE_PLAN_INVALID');
  await regular(planFile, 0o400); await regular(proofFile, 0o400); await regular(restorePlanFile, 0o400);
  if (await sha256File(planFile) !== planSha) fail('QA_LEASE_PLAN_CHANGED');
  const plan = await readJson(planFile) as QaRestoredLeasePlan;
  const restorePlan = await readJson(restorePlanFile);
  const restoreReportFile = String(restorePlan.reportPath || '');
  await regular(restoreReportFile, 0o600);
  if (await sha256File(restorePlanFile) !== plan.restorePlanSha256
    || await sha256File(restoreReportFile) !== plan.restoreReportSha256
    || process.env.QA_PRODUCTION_STATE_RESTORE_PLAN_SHA256 !== plan.restorePlanSha256
    || process.env.DEPLOYMENT_QA_REHEARSAL_PLAN_SHA256 !== plan.qaTargetPlanSha256) fail('QA_LEASE_RESTORE_CHANGED');
  const source = `/qa-checkpoint/${plan.checkpointId}.sabrec`;
  const sourceSidecar = `${source}.json`;
  await regular(source, 0o400); await regular(sourceSidecar, 0o400);
  if (restorePlan.checkpointId !== plan.checkpointId || restorePlan.databaseName !== plan.databaseName
    || (restorePlan.sourceObject as any)?.path !== source
    || (restorePlan.sourceSidecar as any)?.path !== sourceSidecar
    || await sha256File(source) !== plan.checkpointSha256
    || await sha256File(sourceSidecar) !== plan.sourceSidecarSha256
    || await sha256File(proofFile) !== plan.productionProofSha256) fail('QA_LEASE_SOURCE_CHANGED');
  const boot = (await fs.promises.readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim().toLowerCase();
  if (createHash('sha256').update(boot).digest('hex') !== plan.qaKernelBootIdSha256) fail('QA_LEASE_MACHINE_CHANGED');
  if (database.pathname.slice(1) !== plan.databaseName) fail('QA_LEASE_DATABASE_UNSAFE');
  const report = await readJson(restoreReportFile);
  const proof = await readJson(proofFile) as QaSourceTerminalProof;
  assertQaRestoredLeaseEvidence(plan, report, proof, new Date());
  const control = nativePostgresCliConnection(String(process.env.DATABASE_URL), 'postgres');
  const marker = await execFileAsync('psql', [control.url, '-At', '-v', 'ON_ERROR_STOP=1', '-c',
    'SELECT marker FROM deployment_drill_environment_marker WHERE singleton = true'], {
    env: { ...process.env, ...control.environment }, timeout: 30_000, windowsHide: true,
  });
  if (marker.stdout.trim() !== process.env.DEPLOYMENT_DRILL_DATABASE_MARKER) fail('QA_LEASE_DATABASE_IDENTITY_MISMATCH');
  if (await readRestoreJournal()) fail('QA_LEASE_PENDING_RESTORE');
  const session = '/qa-evidence/reports/active-deployment-session.json';
  if (fs.existsSync(session)) fail('QA_LEASE_CONTROLLER_ACTIVE');
  const maintenanceOwner = `qa-reconcile-${plan.checkpointId}`;
  const maintenanceDir = String(process.env.RECOVERY_COORDINATION_DIR);
  const currentMaintenance = await readDeploymentMaintenance(maintenanceDir);
  if (command === 'prepare') {
    if (currentMaintenance) fail('QA_LEASE_MAINTENANCE_ALREADY_ACTIVE');
    await assertSnapshotRow(plan);
    await activateDeploymentMaintenance(maintenanceDir, {
      deploymentId: maintenanceOwner, releaseId: plan.expected.releaseId,
      message: 'QA restored source lease reconciliation', activatedAt: new Date(),
    });
    console.log(JSON.stringify({ ok: true, qaOnly: true, status: 'MAINTENANCE_PREPARED' }));
    return;
  }
  if (currentMaintenance?.deploymentId !== maintenanceOwner) fail('QA_LEASE_MAINTENANCE_UNPROVEN');
  // The host owner holds FD9 and independently checked HTTP 503 for both QA origins.
  if (process.env.QA_RECONCILE_503_PROVEN !== 'true') fail('QA_LEASE_503_UNPROVEN');
  const beforePath = `${plan.receiptPrefix}.before.json`;
  const afterPath = `${plan.receiptPrefix}.after.json`;
  if (fs.existsSync(beforePath) || fs.existsSync(afterPath)) fail('QA_LEASE_RECEIPT_EXISTS');
  const result = await prisma.$transaction(async tx => {
    const lock = await tx.$queryRawUnsafe<Array<{ acquired: boolean }>>('SELECT pg_try_advisory_xact_lock(741936425) AS acquired');
    if (lock[0]?.acquired !== true) fail('QA_LEASE_ADVISORY_BUSY');
    const row = await assertSnapshotRow(plan, tx);
    const original = JSON.parse(JSON.stringify(row));
    const before = { format: 'sabalan-qa-lease-reconciliation-before/v1', qaOnly: true,
      checkpointSha256: plan.checkpointSha256, restoreReportSha256: plan.restoreReportSha256,
      productionProofSha256: plan.productionProofSha256, planSha256: planSha,
      databaseName: plan.databaseName, qaKernelBootIdSha256: plan.qaKernelBootIdSha256,
      originalRowSha256: hash(original), originalRow: original, capturedAt: new Date().toISOString() };
    const beforeBytes = `${JSON.stringify(before, null, 2)}\n`;
    await fs.promises.writeFile(beforePath, beforeBytes, { mode: 0o600, flag: 'wx' });
    const changed = await tx.deploymentOperation.updateMany({
      where: { id: row.id, activeKey: 'production', releaseId: row.releaseId, targetCommit: row.targetCommit,
        phase: 'SERVICES_DRAINED', leaseToken: row.leaseToken, startedAt: row.startedAt,
        heartbeatAt: row.heartbeatAt, leaseExpiresAt: row.leaseExpiresAt, updatedAt: row.updatedAt,
        completedAt: null },
      data: { phase: 'ABORTED', activeKey: null, completedAt: new Date(proof.sourceDeployment.completedAt),
        errorCode: 'QA_RESTORED_SOURCE_LEASE_RECONCILED', errorMessage: `QA-only terminal proof ${plan.productionProofSha256}` },
    });
    if (changed.count !== 1) fail('QA_LEASE_CAS_MISMATCH');
    const after = await tx.deploymentOperation.findUnique({ where: { id: row.id } });
    if (!after || after.phase !== 'ABORTED' || after.activeKey !== null
      || after.completedAt?.getTime() !== Date.parse(proof.sourceDeployment.completedAt)) fail('QA_LEASE_POSTIMAGE_MISMATCH');
    if (await tx.deploymentOperation.count({ where: { activeKey: { not: null } } }) !== 0
      || await tx.deploymentOperation.count({ where: { phase: { in: ['RECOVERY_REQUIRED', 'COMPLETED_WITH_NOTIFICATION_FAILURE'] } } }) !== 0) {
      fail('QA_LEASE_POSTIMAGE_BLOCKED');
    }
    return { beforeSha256: createHash('sha256').update(beforeBytes).digest('hex'),
      originalRowSha256: hash(original), afterRowSha256: hash(JSON.parse(JSON.stringify(after))) };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  const receipt = { format: 'sabalan-qa-lease-reconciliation-after/v1', qaOnly: true, productionAdmission: false,
    checkpointId: plan.checkpointId, checkpointSha256: plan.checkpointSha256,
    restoreReportSha256: plan.restoreReportSha256, productionProofSha256: plan.productionProofSha256,
    planSha256: planSha, databaseName: plan.databaseName, qaKernelBootIdSha256: plan.qaKernelBootIdSha256,
    beforePath, ...result, outcome: 'ABORTED_SOURCE_COPY', completedAt: new Date().toISOString() };
  await fs.promises.writeFile(afterPath, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await deactivateDeploymentMaintenance(maintenanceDir, maintenanceOwner);
  console.log(JSON.stringify({ ok: true, qaOnly: true, receipt: path.posix.basename(afterPath) }));
}

async function assertSnapshotRow(plan: QaRestoredLeasePlan, db: Pick<typeof prisma, 'deploymentOperation'> = prisma) {
  const active = await db.deploymentOperation.findMany({ where: { activeKey: { not: null } } });
  const blockers = await db.deploymentOperation.findMany({ where: {
    phase: { in: ['RECOVERY_REQUIRED', 'COMPLETED_WITH_NOTIFICATION_FAILURE'] },
  }, select: { id: true } });
  return assertQaSnapshotOperation(plan, active, blockers.length, new Date());
}

main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, qaOnly: true, code: error?.code || 'QA_LEASE_RECONCILE_REFUSED' }));
  process.exitCode = 1;
}).finally(() => disconnectDatabase());
