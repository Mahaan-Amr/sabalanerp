import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { assertMandatoryDeploymentGates, connectionUtilizationDecision, runMandatoryDeploymentGates } from '../services/deploymentGates';
import { assertRemoteCheckpointFingerprint } from '../services/deploymentCheckpointStorage';
import { RECOVERY_COORDINATION_DIR } from '../services/recoveryRuntime';
import { sha256File } from '../services/recoveryCrypto';
import { validateLiveStoredFileReferences } from '../services/systemRecoveryEngine';
import { verifyShipmentStatementDeploymentState } from '../services/shipmentStatementOperations';
import { verifyInquiryBaseline, inspectInquiryBaseline } from '../services/inquiryMigrationPlan';
import { verifyCustomerAllocationDatabaseProtections, verifyCustomerAllocationDeploymentState } from '../services/accountingCustomerAllocationDeployment';
import { assertRecoveryAllocationContinuity, readRecoveryAllocationAuthority, readRecoveryOwnerReceipt,
  type RecoveryRuntimeProof } from '../services/systemRecoveryAllocationAuthority';

const execFileAsync = promisify(execFile);
const deploymentId = String(process.env.DEPLOYMENT_ID || '').trim();
const reportRoot = process.env.DEPLOYMENT_REPORT_DIR || '/app/deployment-reports';
const gateMode = process.env.DEPLOYMENT_GATE_MODE || 'RELEASE';
const rollbackMode = gateMode === 'ROLLBACK';
const previousUnchangedMode = gateMode === 'PREVIOUS_UNCHANGED';
const applicationRecoveryRollbackMode = gateMode === 'APPLICATION_RECOVERY_ROLLBACK';
const applicationRecoveryMode = gateMode === 'APPLICATION_RECOVERY' || applicationRecoveryRollbackMode;
const releaseMode = !rollbackMode && !previousUnchangedMode;

const httpGate = (url: string) => async () => {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return { url, status: response.status };
};

const writableDirectoryGate = (directory: string) => async () => {
  await fs.promises.access(directory, fs.constants.R_OK | fs.constants.W_OK);
  const marker = path.join(directory, `.deployment-gate-${deploymentId}-${process.pid}`);
  await fs.promises.writeFile(marker, 'gate', { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.promises.rm(marker);
  return { directory };
};

const performanceExportStorageGate = async () => {
  const directory = '/app/storage/performance-exports';
  await writableDirectoryGate(directory)();
  try {
    const ready = await prisma.performanceExportReceipt.findMany({
      where: { status: 'READY' }, select: { id: true, artifactPath: true },
    });
    for (const receipt of ready) {
      if (!receipt.artifactPath) throw new Error(`READY performance export ${receipt.id} has no artifact path.`);
      const resolved = path.resolve(receipt.artifactPath);
      if (!resolved.startsWith(`${directory}${path.sep}`)) throw new Error(`Performance export ${receipt.id} is outside protected storage.`);
      await fs.promises.access(resolved, fs.constants.R_OK);
    }
    return { directory, readyArtifacts: ready.length };
  } catch (error: any) {
    if (error?.code === 'P2021' && process.env.DEPLOYMENT_ALLOW_MISSING_PERFORMANCE_EXPORT_TABLE === 'true') {
      console.warn('Performance export table is not present yet; allowing pre-migration gate to continue.');
      return { directory, readyArtifacts: 0, tablePendingMigration: true };
    }
    throw error;
  }
};

const main = async () => {
  if (!deploymentId) throw Object.assign(new Error('DEPLOYMENT_ID is required.'), { code: 'DEPLOYMENT_CONFIGURATION_MISSING' });
  if (process.env.DEPLOYMENT_ONLINE_GATE_CONTEXT) throw new Error('ONLINE_GATE_RETIRED');
  const inquiryDatabase = process.env.INQUIRY_RECOVERY_SOURCE_DIR
    ? path.join(process.env.INQUIRY_RECOVERY_SOURCE_DIR, 'inquiry.db')
    : '/app/recovery-sources/inquiry/inquiry.db';
  const checkpointPath = path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json');
  const gates = await runMandatoryDeploymentGates([
    {
      name: 'postgres-query-and-isolated-write',
      run: async () => prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT 1');
        await tx.$executeRawUnsafe('CREATE TEMP TABLE deployment_gate_probe (value integer) ON COMMIT DROP');
        await tx.$executeRawUnsafe('INSERT INTO deployment_gate_probe(value) VALUES (1)');
        return { transactionRolledBackByTempTableLifecycle: true };
      }),
    },
    ...(releaseMode ? [{
      name: 'migration-history',
      run: async () => {
        const result = await execFileAsync('npx', ['prisma', 'migrate', 'status'], { env: process.env, timeout: 60_000, windowsHide: true });
        if (!/up to date/i.test(`${result.stdout}\n${result.stderr}`)) throw new Error('Prisma migration history is not up to date.');
        const manifestSha256 = process.env.DEPLOYMENT_CUSTOMER_ALLOCATION_MANIFEST_SHA256;
        const expectedAllocation = manifestSha256 === undefined ? undefined : {
          manifestSha256, deploymentId, releaseId: process.env.DEPLOYMENT_RELEASE_ID ?? '',
          targetCommit: process.env.DEPLOYMENT_TARGET_COMMIT ?? '', leaseToken: process.env.DEPLOYMENT_LEASE_TOKEN ?? '',
        };
        let allocation;
        let recoveredRuntime: RecoveryRuntimeProof | undefined;
        if (applicationRecoveryMode) {
          if (expectedAllocation) throw new Error('Application recovery cannot publish new allocation authority.');
          const receipt = await readRecoveryOwnerReceipt(deploymentId, applicationRecoveryRollbackMode);
          await verifyCustomerAllocationDatabaseProtections(prisma);
          recoveredRuntime = JSON.parse(process.env.SYSTEM_RECOVERY_RUNTIME_AFTER || 'null') as RecoveryRuntimeProof;
          assertRecoveryAllocationContinuity(receipt.allocation, await readRecoveryAllocationAuthority(prisma), recoveredRuntime);
          allocation = { customerAllocationDatabaseProtections: 'verified', preservedCurrentAllocationAuthority: receipt.allocation.state };
        } else allocation = await verifyCustomerAllocationDeploymentState(prisma, expectedAllocation);
        if (expectedAllocation || applicationRecoveryMode) {
          const runtimeAddress = recoveredRuntime?.address || process.env.DEPLOYMENT_CUSTOMER_ALLOCATION_RUNTIME_ADDRESS || '';
          if (!isIP(runtimeAddress)) throw new Error('Customer allocation runtime address is unverified.');
          const [sessions] = await prisma.$queryRaw<Array<{ admitted: boolean }>>`
            SELECT count(*) > 0 AND bool_and(usename = 'sabalan_application_runtime') AS admitted
            FROM pg_catalog.pg_stat_activity
            WHERE client_addr = CAST(${runtimeAddress} AS inet)
              AND datname = current_database() AND backend_type = 'client backend'
          `;
          if (!sessions?.admitted) throw new Error('Customer allocation runtime database sessions are unverified.');
        }
        return { status: 'up-to-date', ...allocation };
      },
    }, {
      name: 'shipment-statement-runtime-state',
      run: async () => verifyShipmentStatementDeploymentState(prisma),
    }, {
      name: 'contract-financial-evidence',
      run: async () => {
        const output = path.join(reportRoot, `contract-financial-evidence-final-${deploymentId}.json`);
        const result = await execFileAsync('node', [
          'dist/scripts/reconcile-contract-financial-evidence.js',
          `--output=${output}`,
        ], { env: process.env, timeout: 120_000, windowsHide: true });
        const report = JSON.parse(result.stdout) as { scannedCandidates: number; reconciled: number; unresolved: number };
        if (report.unresolved !== 0) throw new Error(`${report.unresolved} contract financial evidence cases remain unresolved.`);
        return { output, ...report };
      },
    }] : []),
    {
      name: 'inquiry-sqlite-integrity',
      run: async () => {
        const result = await execFileAsync('sqlite3', [inquiryDatabase, 'PRAGMA integrity_check;'], { timeout: 30_000, windowsHide: true });
        if (result.stdout.trim() !== 'ok') throw new Error(`SQLite integrity check failed: ${result.stdout.trim()}`);
        let identity;
        if(releaseMode) {
          const checkpoint=JSON.parse(await fs.promises.readFile(checkpointPath,'utf8'));
          const unchangedConfiguration=process.env.DEPLOYMENT_MODE==='configuration' && checkpoint.deploymentId===deploymentId
            && checkpoint.rollbackReleaseSet?.inquiry===process.env.DEPLOYMENT_INQUIRY_IMAGE
            && /^sha256:[a-f0-9]{64}$/.test(process.env.DEPLOYMENT_INQUIRY_IMAGE||'');
          identity=unchangedConfiguration?await inspectInquiryBaseline(inquiryDatabase):await verifyInquiryBaseline(inquiryDatabase);
        }
        return { integrity: 'ok', identity };
      },
    },
    { name: 'backend-readiness', run: httpGate('http://backend:5000/api/ready') },
    { name: 'frontend-health', run: httpGate('http://frontend:3000') },
    { name: 'inquiry-health', run: httpGate('http://inquiry:3001') },
    { name: 'nginx-health', run: httpGate('http://nginx/healthz') },
    { name: 'contracts-storage', run: writableDirectoryGate('/app/storage/contracts') },
    { name: 'hr-storage', run: writableDirectoryGate('/app/storage/hr-hiring') },
    { name: 'accounting-storage', run: writableDirectoryGate('/app/storage/accounting-contracts') },
    { name: 'dispatch-storage', run: writableDirectoryGate('/app/storage/dispatch-documents') },
    { name: 'support-storage', run: writableDirectoryGate('/app/storage/support-tickets') },
    { name: 'performance-export-storage', run: performanceExportStorageGate },
    { name: 'uploads-storage', run: writableDirectoryGate('/app/uploads') },
    { name: 'database-file-references', run: async () => validateLiveStoredFileReferences(prisma) },
    ...(!previousUnchangedMode ? [{
      name: 'checkpoint-manifest',
      run: async () => {
        const checkpoint:any=JSON.parse(await fs.promises.readFile(checkpointPath, 'utf8'));
        if(!checkpoint)throw Error('DEPLOYMENT_CHECKPOINT_REQUIRED');
        if (!checkpoint.localVerified || !checkpoint.remoteVerified || !checkpoint.manifestReadable) throw new Error('Checkpoint verification flags are incomplete.');
        const configuredRemoteRoot = String(process.env.DEPLOYMENT_REMOTE_MOUNT || '').trim();
        if (!configuredRemoteRoot) throw new Error('DEPLOYMENT_REMOTE_MOUNT is required for checkpoint read-back.');
        const remoteRoot = path.resolve(configuredRemoteRoot);
        const remotePath = path.resolve(String(checkpoint.remotePath || ''));
        const localPath = path.resolve(String(checkpoint.localPath || checkpoint.archivePath || ''));
        if (!remotePath.startsWith(`${remoteRoot}${path.sep}`)) throw new Error('Remote checkpoint path is outside its configured mount.');
        const [localChecksum, remoteFingerprint, remoteSidecar] = await Promise.all([
          sha256File(localPath),
          assertRemoteCheckpointFingerprint(remotePath, checkpoint.remoteFingerprint),
          fs.promises.readFile(`${remotePath}.json`, 'utf8').then((value) => JSON.parse(value)),
        ]);
        if (localChecksum !== checkpoint.checksum) {
          throw new Error('Local checkpoint checksum no longer matches the release checkpoint.');
        }
        if (remoteSidecar.checksum !== checkpoint.checksum
          || remoteSidecar.deploymentId !== deploymentId
          || remoteSidecar.remoteVerified !== true) {
          throw new Error('Remote checkpoint manifest read-back no longer proves this deployment.');
        }
        return { checksum: checkpoint.checksum, releaseId: checkpoint.releaseId, remoteReadBack: true, remoteFingerprint };
      },
    }] : []),
    {
      name: 'database-connection-capacity',
      run: async () => {
        const rows = await prisma.$queryRawUnsafe<Array<{ used: bigint; maximum: string }>>(
          "SELECT count(*)::bigint AS used, current_setting('max_connections') AS maximum FROM pg_stat_activity",
        );
        const decision = connectionUtilizationDecision(Number(rows[0]?.used || 0), Number(rows[0]?.maximum || 0));
        if (!decision.mayDeploy) throw new Error(`Database connection utilization is ${(decision.utilization * 100).toFixed(1)}%.`);
        return decision;
      },
    },
  ]);

  const report = {
    format: 'sabalan-deployment-report',
    version: 1,
    mode: gateMode,
    deploymentId,
    releaseId: process.env.DEPLOYMENT_RELEASE_ID,
    targetCommit: process.env.DEPLOYMENT_TARGET_COMMIT,
    createdAt: new Date().toISOString(),
    gates,
  };
  await fs.promises.mkdir(reportRoot, { recursive: true });
  await fs.promises.mkdir(RECOVERY_COORDINATION_DIR, { recursive: true });
  const suffix = rollbackMode ? '.rollback' : previousUnchangedMode ? '.previous' : '';
  let reportPath = path.join(reportRoot, `${deploymentId}${suffix}.json`);
  if (fs.existsSync(reportPath)) reportPath = path.join(reportRoot, `${deploymentId}${suffix}.${Date.now()}.json`);
  const coordinationPath = path.join(RECOVERY_COORDINATION_DIR, 'deployment-report.json');
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  await fs.promises.writeFile(reportPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await fs.promises.writeFile(coordinationPath, serialized, { encoding: 'utf8', mode: 0o600 });
  if (releaseMode) await prisma.deploymentOperation.update({ where: { id: deploymentId }, data: { reportJson: report as any } });
  assertMandatoryDeploymentGates(gates);
  console.log(JSON.stringify({ ok: true, reportPath, gates }));
};

main()
  .catch((error: any) => {
    console.error(JSON.stringify({ ok: false, code: error?.code || 'DEPLOYMENT_GATES_FAILED', message: error?.message, results: error?.results }));
    process.exitCode = 1;
  })
  .finally(() => disconnectDatabase());
