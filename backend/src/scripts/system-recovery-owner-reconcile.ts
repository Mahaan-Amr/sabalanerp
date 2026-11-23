import fs from 'node:fs/promises';
import path from 'node:path';
import { disconnectDatabase, prisma } from '../lib/prisma';
import { configuredProtectedDatabaseRoleRecovery, assertProtectedRoleCheckpointBoundary,
  verifyPromotedProtectedDatabaseRoles } from '../services/protectedDatabaseRoleRecovery';
import { assertRuntimeControlOwnership } from '../services/runtimeControlOwnership';
import { RECOVERY_COORDINATION_DIR, RECOVERY_ROOT } from '../services/recoveryRuntime';
import { initializeSystemRecovery } from '../services/systemRecoveryLifecycle';
import { readRestoreJournal } from '../services/systemRecoveryEngine';
import { readRecoveryOwnerPreparation } from '../services/systemRecoveryAllocationAuthority';

/** Only the still-owned host runner uses this after its original child closes.
 * It resolves that child's journal before the one canonical checkpoint rollback. */
async function main() {
  assertRuntimeControlOwnership();
  const scope = configuredProtectedDatabaseRoleRecovery();
  const id = process.env.DEPLOYMENT_ID || '';
  const operationId = process.argv[2] || '';
  if (!scope || !/^c[a-z0-9]{24}$/.test(operationId)) throw new Error('RECOVERY_RECONCILE_REJECTED');
  const journal = await readRestoreJournal();
  if (!journal) return;
  const checkpoint = JSON.parse(await fs.readFile(path.join(RECOVERY_COORDINATION_DIR, 'deployment-checkpoint.json'), 'utf8'));
  await assertProtectedRoleCheckpointBoundary({ prisma, coordinationDir: RECOVERY_COORDINATION_DIR,
    id, phase: process.env.DEPLOYMENT_PHASE === 'ROLLBACK_STARTED' ? 'ROLLBACK_STARTED' : 'MUTATION_STARTED', checksum: checkpoint.checksum });
  const [admitted] = await prisma.$queryRaw<Array<{ admitted: boolean }>>`
    SELECT current_user = session_user AND r.rolsuper AND r.rolcanlogin AND d.datdba = r.oid
      AND current_database() = ${scope.source}
      AND EXISTS (SELECT FROM pg_locks l JOIN pg_stat_activity a USING (pid)
        WHERE a.application_name = ${'sabalan-lock-' + id} AND a.datname = 'postgres'
          AND l.locktype = 'advisory' AND l.mode = 'ExclusiveLock' AND l.granted
          AND l.classid = 0 AND l.objid = 741936425 AND l.objsubid = 1)
      AND NOT EXISTS (SELECT FROM pg_stat_activity WHERE datname = current_database() AND usename = ${scope.roles.runtime}) AS admitted
    FROM pg_roles r JOIN pg_database d ON d.datname = current_database() WHERE r.rolname = session_user
  `;
  if (!admitted?.admitted || checkpoint.deploymentId !== id || !checkpoint.localVerified || !checkpoint.remoteVerified) {
    throw new Error('RECOVERY_RECONCILE_REJECTED');
  }
  const preparation = await readRecoveryOwnerPreparation(id);
  if (preparation.operationId !== operationId || preparation.leaseToken !== process.env.DEPLOYMENT_LEASE_TOKEN
    || preparation.checkpointChecksum !== checkpoint.checksum || journal.operationId !== operationId
    || journal.checksum !== preparation.checksum || journal.actorId !== preparation.actorId
    || journal.currentDatabase !== scope.source || !/^sabalan_restore_[a-f0-9]{12}$/.test(journal.stagedDatabase)
    || !/^sabalan_safety_[a-f0-9]{12}$/.test(journal.safetyDatabase)
    || journal.safetyFilesRoot !== path.join(RECOVERY_ROOT, 'safety', operationId)
    || journal.packageStoragePath !== preparation.sourcePath) throw new Error('RECOVERY_RECONCILE_REJECTED');
  await verifyPromotedProtectedDatabaseRoles(process.env.DATABASE_URL!, scope.roles, preparation.roles, scope.source);
  await initializeSystemRecovery(prisma);
  if (await readRestoreJournal()) throw new Error('RECOVERY_RECONCILE_REJECTED');
  await assertProtectedRoleCheckpointBoundary({ prisma, coordinationDir: RECOVERY_COORDINATION_DIR,
    id, phase: process.env.DEPLOYMENT_PHASE === 'ROLLBACK_STARTED' ? 'ROLLBACK_STARTED' : 'MUTATION_STARTED', checksum: checkpoint.checksum });
}
void main().catch(() => { console.error('SYSTEM_RECOVERY_RECONCILE_FAILED'); process.exitCode = 1; })
  .finally(() => disconnectDatabase());
