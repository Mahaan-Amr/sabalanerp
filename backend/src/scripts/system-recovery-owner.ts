import { disconnectDatabase, prisma } from '../lib/prisma';
import { assertProtectedRoleCheckpointBoundary, configuredProtectedDatabaseRoleRecovery } from '../services/protectedDatabaseRoleRecovery';
import { RECOVERY_COORDINATION_DIR } from '../services/recoveryRuntime';
import { assertRuntimeControlOwnership } from '../services/runtimeControlOwnership';
import { executeBackupRequest, OWNER_BACKUP_REQUESTED } from '../services/systemRecoveryBackupRequest';
import { readSystemRecoveryOwnerRequest } from '../services/systemRecoveryOwnerInput';
import { readRestoreJournal } from '../services/systemRecoveryEngine';

const rejected = () => new Error('SYSTEM_RECOVERY_OWNER_ADMISSION_REJECTED');

async function main() {
  assertRuntimeControlOwnership();
  const scope = configuredProtectedDatabaseRoleRecovery();
  if (process.env.BACKEND_RUNTIME_ROLE !== 'control' || !scope || process.stdin.isTTY) throw rejected();
  const inputDeadline = setTimeout(() => process.stdin.destroy(new Error('SYSTEM_RECOVERY_OWNER_INPUT_INVALID')), 10_000);
  const { operationId, deploymentId, passphrase } = await readSystemRecoveryOwnerRequest(
    process.argv.slice(2), process.stdin, process.env.DEPLOYMENT_ID,
  )
    .finally(() => clearTimeout(inputDeadline));

  const advisoryApplicationName = 'sabalan-lock-' + deploymentId;
  const assertBoundary = async () => {
    assertRuntimeControlOwnership();
    await assertProtectedRoleCheckpointBoundary({
      prisma, coordinationDir: RECOVERY_COORDINATION_DIR, id: deploymentId, phase: 'SERVICES_DRAINED',
    });
    if (await readRestoreJournal()) throw rejected();
    const [database] = await prisma.$queryRaw<Array<{ admitted: boolean }>>`
      SELECT current_database() = ${scope.source} AND r.rolsuper AND r.rolcanlogin
        AND current_user = session_user AND d.datdba = r.oid
        AND EXISTS (SELECT FROM pg_locks l JOIN pg_stat_activity a USING (pid)
          WHERE a.application_name = ${advisoryApplicationName} AND a.datname = 'postgres'
            AND l.locktype = 'advisory' AND l.mode = 'ExclusiveLock' AND l.granted
            AND l.classid = 0 AND l.objid = 741936425 AND l.objsubid = 1)
        AND NOT EXISTS (SELECT FROM pg_stat_activity
          WHERE datname = current_database() AND usename = ${scope.roles.runtime})
        AS admitted
      FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
      WHERE r.rolname = session_user
    `;
    if (database?.admitted !== true) throw rejected();
  };

  await assertBoundary();
  const actorId = await prisma.$transaction(async tx => {
    const operation = await tx.recoveryOperation.findUnique({
      where: { id: operationId },
      select: { createdById: true, createdBy: { select: { role: true, isActive: true, erasedAt: true } } },
    });
    const actor = operation?.createdBy;
    if (!operation?.createdById || actor?.role !== 'ADMIN' || !actor.isActive || actor.erasedAt) throw rejected();
    const requested = await tx.recoveryAuditEvent.count({
      where: { operationId, actorId: operation.createdById, eventType: OWNER_BACKUP_REQUESTED },
    });
    if (requested !== 1) throw rejected();
    const claim = await tx.recoveryOperation.updateMany({
      where: {
        id: operationId, createdById: operation.createdById, packageType: 'COMPLETE', source: 'CREATED',
        status: 'CREATING', progress: 0, expiresAt: { gt: new Date() }, storageName: null,
      },
      data: { progress: 1 },
    });
    if (claim.count !== 1) throw rejected();
    return operation.createdById;
  }, { isolationLevel: 'Serializable' });

  try {
    await executeBackupRequest(prisma, {
      operationId, actorId, packageType: 'COMPLETE', passphrase, protectedDatabaseRoles: scope,
      onProgress: async (progress) => {
        await assertBoundary();
        await prisma.recoveryOperation.update({ where: { id: operationId }, data: { progress } });
      },
    });
    console.log(JSON.stringify({ ok: true, operationId }));
  } catch {
    await prisma.$transaction(async tx => {
      await tx.recoveryOperation.updateMany({
        where: { id: operationId, status: 'CREATING' },
        data: { status: 'FAILED', errorCode: 'BACKUP_CREATION_FAILED', errorMessage: 'Backup creation failed.' },
      });
      await tx.recoveryAuditEvent.create({ data: {
        operationId, actorId, eventType: 'RECOVERY_BACKUP_FAILED', details: { code: 'BACKUP_CREATION_FAILED' },
      } });
    });
    throw new Error('SYSTEM_RECOVERY_OWNER_BACKUP_FAILED');
  }
}

void main().catch(error => {
  const candidate = error instanceof Error ? error.message : null;
  const code = candidate && [
    'SYSTEM_RECOVERY_OWNER_ADMISSION_REJECTED',
    'SYSTEM_RECOVERY_OWNER_INPUT_INVALID',
    'SYSTEM_RECOVERY_OWNER_BACKUP_FAILED',
    'RUNTIME_CONTROL_OWNERSHIP_REQUIRED',
  ].includes(candidate) ? candidate : 'SYSTEM_RECOVERY_OWNER_FAILED';
  console.error(JSON.stringify({ ok: false, code }));
  process.exitCode = 1;
}).finally(() => disconnectDatabase()).catch(() => {
  console.error(JSON.stringify({ ok: false, code: 'SYSTEM_RECOVERY_OWNER_DISCONNECT_FAILED' }));
  process.exitCode = 1;
});
