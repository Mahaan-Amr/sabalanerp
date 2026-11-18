import fs from 'node:fs/promises';
import path from 'node:path';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { assertRuntimeControlOwnership } from '../services/runtimeControlOwnership';
import { assertProtectedRoleCheckpointBoundary, configuredProtectedDatabaseRoleRecovery,
  verifyPromotedProtectedDatabaseRoles } from '../services/protectedDatabaseRoleRecovery';
import { RECOVERY_COORDINATION_DIR } from '../services/recoveryRuntime';
import { readRestoreJournal } from '../services/systemRecoveryEngine';
import { assertRecoveryAllocationContinuity, captureRecoveryAllocationAuthority, readRecoveryAllocationAuthority,
  readRecoveryOwnerPreparation, recoveryOwnerReceiptPath, writeRecoveryOwnerFile,
  type RecoveryRuntimeProof } from '../services/systemRecoveryAllocationAuthority';

async function main() {
  assertRuntimeControlOwnership();
  const id = process.env.DEPLOYMENT_ID || '';
  const operationId = process.argv[2] || '';
  const scope = configuredProtectedDatabaseRoleRecovery();
  if (!scope || !/^c[a-z0-9]{24}$/.test(operationId)) throw new Error('RECOVERY_ROLLBACK_RECEIPT_REJECTED');
  const checkpoint = JSON.parse(await fs.readFile(path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json'), 'utf8'));
  if (checkpoint.deploymentId !== id || !checkpoint.localVerified || !checkpoint.remoteVerified || await readRestoreJournal()) {
    throw new Error('RECOVERY_ROLLBACK_RECEIPT_REJECTED');
  }
  await assertProtectedRoleCheckpointBoundary({ prisma, coordinationDir: RECOVERY_COORDINATION_DIR,
    id, phase: 'ROLLBACK_STARTED', checksum: checkpoint.checksum });
  const [identity] = await prisma.$queryRaw<Array<{ admitted: boolean }>>`
    SELECT current_user = session_user AND r.rolsuper AND r.rolcanlogin AND d.datdba = r.oid
      AND current_database() = ${scope.source}
      AND EXISTS (SELECT FROM pg_locks l JOIN pg_stat_activity a USING (pid)
        WHERE a.application_name = ${'sabalan-lock-' + id} AND a.datname = 'postgres'
          AND l.locktype = 'advisory' AND l.mode = 'ExclusiveLock' AND l.granted
          AND l.classid = 0 AND l.objid = 741936425 AND l.objsubid = 1)
      AND NOT EXISTS (SELECT FROM pg_stat_activity WHERE datname = current_database() AND usename = ${scope.roles.runtime}) AS admitted
    FROM pg_roles r JOIN pg_database d ON d.datname = current_database() WHERE r.rolname = session_user
  `;
  if (!identity?.admitted) throw new Error('RECOVERY_ROLLBACK_RECEIPT_REJECTED');
  const runtimeBefore = JSON.parse(process.env.SYSTEM_RECOVERY_RUNTIME_BEFORE || 'null') as RecoveryRuntimeProof;
  const observed = await readRecoveryAllocationAuthority(prisma);
  const allocation = captureRecoveryAllocationAuthority(observed, runtimeBefore);
  const preparation = await readRecoveryOwnerPreparation(id).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (preparation) {
    if (preparation.operationId !== operationId || preparation.leaseToken !== process.env.DEPLOYMENT_LEASE_TOKEN
      || preparation.checkpointChecksum !== checkpoint.checksum) throw new Error('RECOVERY_ROLLBACK_RECEIPT_REJECTED');
    await verifyPromotedProtectedDatabaseRoles(process.env.DATABASE_URL!, scope.roles, preparation.roles, scope.source);
    assertRecoveryAllocationContinuity(preparation.allocation, observed, runtimeBefore);
  }
  const request = await prisma.recoveryOperation.findUnique({ where: { id: operationId } });
  if (!request || request.status !== 'RESTORING') throw new Error('RECOVERY_ROLLBACK_REQUEST_MISSING');
  const actor = await prisma.recoveryAuditEvent.findFirst({ where: { operationId, eventType: 'RECOVERY_RESTORE_STARTED' },
    orderBy: { createdAt: 'desc' }, select: { actorId: true } });
  await prisma.$transaction(async tx => {
    await tx.recoveryOperation.update({ where: { id: operationId }, data: { status: 'FAILED', progress: 100,
      errorCode: 'RESTORE_ROLLED_BACK', errorMessage: 'The protected owner restored the verified pre-request recovery point.', completedAt: new Date() } });
    await tx.recoveryAuditEvent.create({ data: { operationId, actorId: actor?.actorId,
      eventType: 'RECOVERY_RESTORE_FAILED', packageChecksum: request.encryptedSha256,
      details: { code: 'RESTORE_ROLLED_BACK', deploymentId: id, checkpointChecksum: checkpoint.checksum } } });
  });
  await writeRecoveryOwnerFile(recoveryOwnerReceiptPath(id, true), {
    format: 'sabalan-system-recovery-owner-completion/v1', deploymentId: id, operationId,
    ownerCompleted: true, outcome: 'ROLLED_BACK', checkpointChecksum: checkpoint.checksum, allocation,
  });
}
void main().catch(() => { console.error('SYSTEM_RECOVERY_ROLLBACK_RECEIPT_FAILED'); process.exitCode = 1; })
  .finally(() => disconnectDatabase());
