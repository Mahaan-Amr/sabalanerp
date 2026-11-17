import type { PrismaClient } from '@prisma/client';
import type { RecoveryPackageType } from './systemRecoveryPolicy';
import { RECOVERY_RETENTION_MS } from './systemRecoveryPolicy';
import type { ProtectedDatabaseRoleRecovery } from './protectedDatabaseRoleRecovery';
import { createRecoveryPackage } from './systemRecoveryEngine';

export const OWNER_BACKUP_REQUESTED = 'RECOVERY_OWNER_BACKUP_REQUESTED';

export function createBackupRequest(prisma: PrismaClient, input: {
  packageType: RecoveryPackageType;
  actorId: string;
  ownerExecution?: boolean;
}) {
  if (input.ownerExecution && input.packageType !== 'COMPLETE') throw new Error('SYSTEM_RECOVERY_OWNER_PACKAGE_TYPE_INVALID');
  return prisma.$transaction(async tx => {
    const operation = await tx.recoveryOperation.create({
      data: {
        packageType: input.packageType,
        source: 'CREATED',
        status: 'CREATING',
        progress: 0,
        createdById: input.actorId,
        expiresAt: new Date(Date.now() + RECOVERY_RETENTION_MS),
      },
    });
    await tx.recoveryAuditEvent.create({ data: {
      operationId: operation.id,
      actorId: input.actorId,
      eventType: input.ownerExecution ? OWNER_BACKUP_REQUESTED : 'RECOVERY_BACKUP_REQUESTED',
      details: { packageType: input.packageType },
    } });
    return operation;
  });
}

export async function executeBackupRequest(prisma: PrismaClient, input: {
  operationId: string;
  actorId: string;
  packageType: RecoveryPackageType;
  passphrase: string;
  protectedDatabaseRoles?: ProtectedDatabaseRoleRecovery;
  onProgress: (progress: number) => Promise<void>;
}) {
  const result = await createRecoveryPackage({ ...input, prisma });
  const readyAt = new Date();
  await prisma.$transaction(async tx => {
    await tx.recoveryOperation.update({
      where: { id: input.operationId },
      data: {
        status: 'READY',
        progress: 100,
        storageName: result.storageName,
        originalName: 'sabalan-' + input.packageType.toLowerCase() + '-' + readyAt.toISOString().replace(/[:.]/g, '-') + '.sabrec',
        encryptedSha256: result.sha256,
        size: BigInt(result.size),
        sourceAppVersion: result.manifest.appVersion,
        sourceCommit: result.manifest.commit,
        sourcePostgresVersion: result.manifest.postgresVersion,
        compatibility: { compatible: true, reasons: [] },
        readyAt,
      },
    });
    await tx.recoveryAuditEvent.create({ data: {
      operationId: input.operationId,
      actorId: input.actorId,
      eventType: 'RECOVERY_BACKUP_READY',
      packageChecksum: result.sha256,
      details: { packageType: input.packageType, size: result.size },
    } });
  });
  return result;
}
