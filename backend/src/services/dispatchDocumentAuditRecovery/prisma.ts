import type { Prisma } from '@prisma/client';
import { dispatchRecoveryIntegrityHash, type DispatchArtifactAuditEvent } from './index';

export const createPrismaDispatchArtifactAuditPort = (tx: Prisma.TransactionClient) => ({
  append: async (event: DispatchArtifactAuditEvent) => {
    const aggregateId = event.artifactId ?? dispatchRecoveryIntegrityHash({ storageKey: event.storageKey });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'DISPATCH_DOCUMENT_RECOVERY'}), hashtext(${aggregateId}))`;
    const previous = await tx.dispatchLifecycleAudit.findFirst({
      where: { aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    });
    const payload = {
      action: event.action,
      correlationId: event.correlationId,
      idempotencyKey: event.idempotencyKey,
      storageKey: event.storageKey ?? null,
      artifactId: event.artifactId ?? null,
      reason: event.reason ?? null,
      authority: event.authority,
      detail: event.detail,
    };
    const recordedAt = new Date(event.occurredAt);
    const previousHash = previous?.eventHash ?? null;
    return tx.dispatchLifecycleAudit.create({ data: {
      aggregateType: 'DISPATCH_DOCUMENT_RECOVERY',
      aggregateId,
      eventType: event.action,
      payload: payload as Prisma.InputJsonValue,
      actorId: event.actorId,
      recordedAt,
      previousHash,
      eventHash: dispatchRecoveryIntegrityHash({
        aggregateType: 'DISPATCH_DOCUMENT_RECOVERY', aggregateId, eventType: event.action,
        payload, actorId: event.actorId, recordedAt: recordedAt.toISOString(), previousHash,
      }),
    } });
  },
});

type DispatchRecoveryAuditDatabase = {
  dispatchLifecycleAudit: {
    findMany(args: unknown): Promise<unknown[]>;
    count(args: unknown): Promise<number>;
  };
};

export const listDispatchDocumentRecoveryAudit = async (database: DispatchRecoveryAuditDatabase, query: {
  page?: number;
  pageSize?: number;
  actorId?: string;
  eventType?: string;
  aggregateId?: string;
  dateFrom?: string;
  dateTo?: string;
} = {}) => {
  const page = Number.isSafeInteger(Number(query.page)) && Number(query.page) > 0 ? Number(query.page) : 1;
  const pageSize = Number.isSafeInteger(Number(query.pageSize)) ? Math.min(Math.max(Number(query.pageSize), 1), 100) : 25;
  const recordedAt = query.dateFrom || query.dateTo ? {
    ...(query.dateFrom && !Number.isNaN(Date.parse(query.dateFrom)) ? { gte: new Date(query.dateFrom) } : {}),
    ...(query.dateTo && !Number.isNaN(Date.parse(query.dateTo)) ? { lte: new Date(query.dateTo) } : {}),
  } : undefined;
  const where = {
    aggregateType: 'DISPATCH_DOCUMENT_RECOVERY',
    ...(query.actorId ? { actorId: query.actorId } : {}),
    ...(query.eventType && query.eventType !== 'ALL' ? { eventType: query.eventType } : {}),
    ...(query.aggregateId ? { aggregateId: query.aggregateId } : {}),
    ...(recordedAt && Object.keys(recordedAt).length ? { recordedAt } : {}),
  };
  const [items, total] = await Promise.all([
    database.dispatchLifecycleAudit.findMany({ where, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
    database.dispatchLifecycleAudit.count({ where }),
  ]);
  return { items, total, page, pageSize };
};
