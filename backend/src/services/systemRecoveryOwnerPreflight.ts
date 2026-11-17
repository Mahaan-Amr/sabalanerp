import type { PrismaClient } from '@prisma/client';
import type { RecoveryOwnerRequest } from './systemRecoveryOwnerHandoff';
import { assertRestoreAuthorization } from './systemRecoveryPolicy';

type Decision = { admissible: true } | { admissible: false; bound: boolean; code: string };

/** Read admission before maintenance. A rejection can update only an exactly
 * bound, still-unclaimed operation; this function never claims owner authority. */
export async function preflightRecoveryOwnerRequest(prisma: PrismaClient, input: {
  request: RecoveryOwnerRequest;
  sealedSha256: string;
}): Promise<Decision> {
  const { request, sealedSha256 } = input;
  return prisma.$transaction(async tx => {
    const events = await tx.recoveryAuditEvent.findMany({ where: { operationId: request.operationId,
      actorId: request.actorId, eventType: 'RECOVERY_OWNER_HANDOFF_REQUESTED' }, select: { details: true, packageChecksum: true } });
    const bindings = events.filter(event => {
      const details = event.details as Record<string, unknown> | null;
      return details?.requestId === request.requestId && details.sealedSha256 === sealedSha256
        && details.action === request.action && details.packageType === request.packageType
        && (event.packageChecksum || null) === (request.checksum || null);
    });
    if (!/^[a-f0-9]{64}$/.test(sealedSha256) || bindings.length !== 1) {
      return { admissible: false, bound: false, code: 'OWNER_REQUEST_UNBOUND' };
    }
    const operation = await tx.recoveryOperation.findUnique({ where: { id: request.operationId } });
    const pendingStatus = request.action === 'RESTORE' ? 'RESTORING' : 'CREATING';
    const reject = async (code: string, expired = false): Promise<Decision> => {
      const rejected = await tx.recoveryOperation.updateMany({ where: { id: request.operationId, status: pendingStatus, progress: 0 },
        data: { status: expired ? 'EXPIRED' : 'FAILED', errorCode: code,
          errorMessage: 'The bound owner request is no longer admissible.', completedAt: new Date() } });
      if (rejected.count === 1) await tx.recoveryAuditEvent.create({ data: {
        operationId: request.operationId, actorId: request.actorId, eventType: 'OWNER_REQUEST_REJECTED', packageChecksum: request.checksum,
        details: { code, requestId: request.requestId, sealedSha256, action: request.action, packageType: request.packageType },
      } });
      return { admissible: false, bound: true, code };
    };
    if (!operation || operation.status !== pendingStatus || operation.progress !== 0) {
      return { admissible: false, bound: true, code: 'OWNER_REQUEST_NOT_PENDING' };
    }
    const now = new Date();
    if (!operation.expiresAt || operation.expiresAt <= now) return reject('OWNER_REQUEST_EXPIRED', true);
    const actor = await tx.user.findUnique({ where: { id: request.actorId } });
    if (!actor || actor.role !== 'ADMIN' || !actor.isActive || actor.erasedAt) return reject('OWNER_REQUEST_ACTOR_INACTIVE');
    if (operation.packageType !== request.packageType) return reject('OWNER_REQUEST_PACKAGE_CHANGED');
    if (request.action === 'BACKUP') {
      if (operation.source !== 'CREATED' || operation.createdById !== actor.id || operation.encryptedSha256 || operation.storageName) {
        return reject('OWNER_REQUEST_BACKUP_CHANGED');
      }
    } else {
      if (!['CREATED', 'UPLOADED'].includes(operation.source) || !operation.storageName
        || operation.encryptedSha256 !== request.checksum) return reject('OWNER_REQUEST_RESTORE_CHANGED');
      if ((operation.approvedById || null) !== (request.approvedById || null)
        || (operation.approvalExpiresAt?.toISOString() || null) !== (request.approvalExpiresAt || null)) {
        return reject('OWNER_REQUEST_APPROVAL_CHANGED');
      }
      if (operation.approvedById) {
        const approver = await tx.user.findUnique({ where: { id: operation.approvedById } });
        if (!approver || approver.role !== 'ADMIN' || !approver.isActive || approver.erasedAt) return reject('OWNER_REQUEST_APPROVER_INACTIVE');
      }
      const activeAdminCount = await tx.user.count({ where: { role: 'ADMIN', isActive: true, erasedAt: null } });
      try {
        assertRestoreAuthorization({ actorId: actor.id, activeAdminCount, approvedById: operation.approvedById,
          approvalExpiresAt: operation.approvalExpiresAt, confirmationPhrase: request.confirmationPhrase,
          breakGlassReason: request.breakGlassReason, now });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (!code || !['RESTORE_CONFIRMATION_MISMATCH', 'SECOND_ADMIN_APPROVAL_REQUIRED', 'RESTORE_APPROVAL_EXPIRED',
          'BREAK_GLASS_REASON_REQUIRED'].includes(code)) throw error;
        return reject(code);
      }
    }
    return { admissible: true };
  }, { isolationLevel: 'Serializable' });
}
