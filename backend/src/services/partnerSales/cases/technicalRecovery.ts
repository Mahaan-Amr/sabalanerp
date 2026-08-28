import { Prisma, type PrismaClient, type SalesContractEditSession } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import {
  PartnerTechnicalCheckpointSchema, PartnerTechnicalRecoveryAccessSchema,
  PartnerTechnicalCheckpointReceiptSchema, canonicalHash,
  partnerError, type Result, type PartnerTechnicalRecoveryPort, type PartnerTechnicalRecoveryAccess,
} from '@sabalanerp/partner-sales-contracts';
import { CONTRACT_EDIT_LEASE_TTL_MS, CONTRACT_CREATION_DRAFT_TTL_MS } from '../../contractEditSessionService';
import { PARTNER_TECHNICAL_RECOVERY_KIND } from '../../contractRecoveryProtection';
import { decodeTechnicalRecovery, decodeTechnicalReceipt, type TechnicalRecoveryRecord } from './technicalRecoveryRecords';

export interface PartnerTechnicalRecoveryDependencies {
  readonly actorId: string;
  transaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
  authorize(transaction: Prisma.TransactionClient, input: {
    actorId: string; recoveryId: string; operation: 'READ' | 'CHECKPOINT';
  }): Promise<Result<void>>;
}

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));
const CHECKPOINT_OPERATION = 'PARTNER_TECHNICAL_CHECKPOINT_V1';

/** Runtime uses the application's injected shared Prisma client. The promise
 * resolves only after commit; no module-owned client or second connection pool. */
export function createPrismaPartnerTechnicalRecoveryService(input: {
  database: PrismaClient; actorId: string; authorize: PartnerTechnicalRecoveryDependencies['authorize'];
}): PartnerTechnicalRecoveryPort {
  return createPartnerTechnicalRecoveryService({ actorId: input.actorId, authorize: input.authorize,
    transaction: work => input.database.$transaction(work) });
}

export function createPartnerTechnicalRecoveryService(dependencies: PartnerTechnicalRecoveryDependencies): PartnerTechnicalRecoveryPort {
  async function underLease<T>(access: PartnerTechnicalRecoveryAccess, operation: 'READ' | 'CHECKPOINT',
    work: (tx: Prisma.TransactionClient, session: SalesContractEditSession, recovery: TechnicalRecoveryRecord | null, now: Date) => Promise<Result<T>>,
  ): Promise<Result<T>> {
    return dependencies.transaction(async tx => {
      // Existing lease row is the serialization point for checkpoint, takeover
      // and heartbeat. The adapter must supply a real owning DB transaction.
      await tx.$queryRaw`SELECT "draftId" FROM sales_contract_edit_sessions WHERE "draftId" = ${access.recoveryId} FOR UPDATE`;
      const session = await tx.salesContractEditSession.findUnique({ where: { draftId: access.recoveryId } });
      if (!session || session.ownerUserId !== dependencies.actorId) return { ok: false, error: partnerError('NOT_FOUND') };
      const authorized = await dependencies.authorize(tx, { actorId: dependencies.actorId, recoveryId: access.recoveryId, operation });
      if (!authorized.ok) return { ok: false, error: partnerError(authorized.error.code) };
      const [clock] = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
      const now = clock.now;
      if (session.browserSessionId !== access.browserSessionId || session.leaseToken !== access.leaseToken ||
          now.getTime() - session.updatedAt.getTime() > CONTRACT_EDIT_LEASE_TTL_MS) {
        return { ok: false, error: partnerError('FORBIDDEN') };
      }
      if (session.contractId !== null) return { ok: false, error: partnerError('STATE_CONFLICT') };
      if (session.baseRevision !== access.baseRevision) return { ok: false, error: partnerError('ROW_STALE') };
      const recovery = session.recovery === null ? null : decodeTechnicalRecovery(session.recovery);
      if (recovery === undefined) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      if (recovery && (recovery.updatedAt > now.getTime() || now.getTime() - recovery.updatedAt > CONTRACT_CREATION_DRAFT_TTL_MS)) {
        return { ok: false, error: partnerError('STATE_CONFLICT') };
      }
      return work(tx, session, recovery, now);
    });
  }
  return {
    async read(input) {
      const parsed = PartnerTechnicalRecoveryAccessSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      return underLease(parsed.data, 'READ', async (_tx, session, recovery) => ({ ok: true, value: {
        schemaVersion: 1, recoveryId: session.draftId, recoveryRevision: recovery?.recoveryRevision ?? 0,
        updatedAt: recovery ? new Date(recovery.updatedAt).toISOString() : session.updatedAt.toISOString(),
        draft: recovery?.draft ?? null,
      } }));
    },
    async checkpoint(input) {
      const parsed = PartnerTechnicalCheckpointSchema.safeParse(input);
      if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
      const command = parsed.data;
      const payloadHash = await canonicalHash(json({ schemaVersion: command.schemaVersion, recoveryId: command.recoveryId,
        baseRevision: command.baseRevision, expectedRecoveryRevision: command.expectedRecoveryRevision, draft: command.draft }));
      return underLease(command, 'CHECKPOINT', async (tx, session, recovery, now) => {
        const identity = { actorId: dependencies.actorId, operation: CHECKPOINT_OPERATION,
          targetScope: session.draftId, key: command.idempotencyKey };
        const previous = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
        if (previous) {
          if (previous.payloadHash !== payloadHash) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
          const stored = decodeTechnicalReceipt(previous.outcome);
          if (!stored || stored.sessionId !== session.id ||
              stored.receipt.recoveryId !== session.draftId || !recovery ||
              stored.receipt.recoveryRevision > recovery.recoveryRevision) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          return { ok: true, value: { ...stored.receipt, replayed: true } };
        }
        const revision = recovery?.recoveryRevision ?? 0;
        if (revision !== command.expectedRecoveryRevision || revision === Number.MAX_SAFE_INTEGER) {
          return { ok: false, error: partnerError('ROW_STALE') };
        }
        const next = { ...recovery, kind: PARTNER_TECHNICAL_RECOVERY_KIND, version: 1,
          recoveryRevision: revision + 1, updatedAt: now.getTime(), draft: command.draft };
        const written = await tx.salesContractEditSession.updateMany({ where: {
          draftId: session.draftId, leaseToken: session.leaseToken, baseRevision: session.baseRevision,
          recovery: { equals: session.recovery === null ? Prisma.AnyNull : json(session.recovery) },
        }, data: { recovery: json(next), updatedAt: now } });
        if (written.count !== 1) return { ok: false, error: partnerError('ROW_STALE') };
        const receipt = PartnerTechnicalCheckpointReceiptSchema.parse({ schemaVersion: 1, recoveryId: session.draftId,
          recoveryRevision: next.recoveryRevision, inputRevision: command.draft.inputRevision,
          updatedAt: now.toISOString(), replayed: false });
        await tx.partnerCommandOutcome.create({ data: { id: randomUUID(), ...identity, payloadHash,
          outcome: json({ sessionId: session.id, receipt }), recordedAt: now } });
        return { ok: true, value: receipt };
      });
    },
  };
}
