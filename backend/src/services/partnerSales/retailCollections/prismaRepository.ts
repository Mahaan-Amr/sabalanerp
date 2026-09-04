import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PartnerCaseViewSchema,
  PartnerEventSchema,
  canonicalJson,
  partnerError,
  type IdempotencyIdentity,
  type PartnerEvent,
  type PermissionContext,
  type Result,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import type {
  RetailCollectionCommandReceipt,
  RetailCollectionReceipt,
  RetailCollectionRepository,
  RetailCollectionSource,
} from './repository';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

class RollbackResult extends Error {
  constructor(readonly result: Result<unknown>) { super('rollback retail collection result'); }
}

function receiptEvidence(value: unknown): RetailCollectionReceipt | undefined {
  const candidate = object(value)?.receipt;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  return candidate as RetailCollectionReceipt;
}

function commandEvidence(value: unknown): RetailCollectionCommandReceipt | undefined {
  const candidate = object(value)?.retailCollectionCommand;
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return undefined;
  return candidate as RetailCollectionCommandReceipt;
}

function eventEvidence(value: unknown): PartnerEvent | undefined {
  const candidate = object(value)?.publicEvent;
  const parsed = PartnerEventSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}

export function createPrismaRetailCollectionRepository(input: {
  database: PrismaClient;
  actorId: string;
  correlationId: string;
}): RetailCollectionRepository {
  return { async transaction(operation) {
    try {
      return await input.database.$transaction(async tx => {
        await lockPartnerOperationsControl(tx);
        const now = async () => {
          const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
          return clock.now.toISOString();
        };
        const readAuthorizedSource = async (expected: RetailCollectionSource['owner'], channel: 'DETAIL' | 'EXPORT' | 'API'):
        Promise<Result<RetailCollectionSource>> => {
          await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${expected.caseId} FOR UPDATE`;
          const row = await tx.partnerSaleCase.findUnique({ where: { id: expected.caseId }, select: {
            id: true, state: true, headRevision: true, integrityHash: true,
            profile: { select: { userId: true } },
            head: { select: { internalProjection: true } },
            paymentPlans: { where: { purpose: 'RETAIL' }, orderBy: { version: 'asc' }, select: { evidence: true, caseRevision: true } },
            events: { orderBy: { sequence: 'asc' }, select: { evidence: true } },
          } });
          if (!row) return { ok: false, error: partnerError('NOT_FOUND') };
          const projection = object(row.head.internalProjection)?.partner;
          const view = PartnerCaseViewSchema.safeParse(projection);
          if (!view.success || view.data.owner.caseId !== row.id || view.data.owner.revision !== row.headRevision ||
              view.data.owner.integrityHash !== row.integrityHash) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          const action = channel === 'API' ? 'RETAIL_COLLECTION_WRITE' : 'REPORT_READ';
          const authorization = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
            purpose: 'PARTNER', channel }, { correlationId: input.correlationId }).authorize(action,
            { kind: 'CASE', id: row.id });
          if (!authorization.ok) return authorization;
          const permission = authorization.value as PermissionContext;
          const planHistory = row.paymentPlans.filter(item => item.caseRevision <= row.headRevision).map(item => item.evidence);
          const parsedPlans = planHistory.map(item => PartnerCaseViewSchema.shape.customerPaymentPlan.safeParse(item));
          if (!parsedPlans.length || parsedPlans.some(item => !item.success)) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          const receipts = await tx.partnerRetailReceipt.findMany({ where: { caseId: row.id }, orderBy: { recordedAt: 'asc' },
            select: { evidence: true } });
          const receiptRows = receipts.map(item => receiptEvidence(item.evidence));
          const events = row.events.map(item => eventEvidence(item.evidence)).filter((item): item is PartnerEvent => Boolean(item));
          if (receiptRows.some(item => !item)) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          return { ok: true, value: {
            owner: view.data.owner, state: row.state, partnerSellerId: row.profile.userId,
            retailPayable: { amount: view.data.retailTotals.payable, currency: view.data.retailTotals.currency },
            customerPaymentPlan: view.data.customerPaymentPlan,
            customerOutputPaymentPlan: view.data.customerPaymentPlan,
            privateReportPaymentPlan: view.data.customerPaymentPlan,
            planHistory: parsedPlans.map(item => item.success ? item.data : view.data.customerPaymentPlan),
            receipts: receiptRows as RetailCollectionReceipt[], events, permission,
          } };
        };
        const findCommand = async (_commandId: string, idempotency: IdempotencyIdentity) => {
          const record = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: {
            actorId: idempotency.actorId, operation: idempotency.operation,
            targetScope: idempotency.targetId, key: idempotency.key,
          } }, select: { outcome: true } });
          return commandEvidence(record?.outcome) ?? null;
        };
        const persistCommand = async (command: RetailCollectionCommandReceipt) => {
          await tx.partnerCommandOutcome.create({ data: { id: command.commandId,
            actorId: command.idempotency.actorId, operation: command.idempotency.operation,
            targetScope: command.idempotency.targetId, key: command.idempotency.key,
            payloadHash: command.intentHash, outcome: json({ schemaVersion: 1, retailCollectionCommand: command }) } });
        };
        const appendEvent = async (expected: RetailCollectionSource['owner'], event: PartnerEvent) => {
          const current = await tx.partnerSaleCase.findUnique({ where: { id: expected.caseId },
            select: { headRevision: true, integrityHash: true, events: { orderBy: { sequence: 'desc' }, take: 1,
              select: { sequence: true } } } });
          if (!current || current.headRevision !== expected.revision || current.integrityHash !== expected.integrityHash) {
            return { ok: false, error: partnerError('ROW_STALE') } as const;
          }
          await tx.partnerCaseEvent.create({ data: { id: event.eventId, caseId: expected.caseId,
            caseRevision: expected.revision, integrityHash: expected.integrityHash,
            sequence: (current.events[0]?.sequence ?? 0) + 1, type: event.type,
            actorId: event.actorId, commandId: event.commandId, correlationId: event.correlationId,
            effectiveDate: new Date(`${event.effectiveDate}T00:00:00.000Z`), evidence: json({ publicEvent: event }) } });
          return { ok: true as const, value: undefined };
        };
        const result = await operation({
          now,
          readAuthorizedSource,
          readCommand: findCommand,
          appendReceipt: async ({ expected, receipt, event, command }) => {
            const appended = await appendEvent(expected, event);
            if (!appended.ok) return appended;
            const existing = await tx.partnerRetailReceipt.findUnique({ where: { id: receipt.receiptId } });
            if (existing) return { ok: false, error: partnerError('IDEMPOTENCY_CONFLICT') };
            await tx.partnerRetailReceipt.create({ data: { id: receipt.receiptId, caseId: expected.caseId,
              planId: receipt.planId, kind: receipt.kind, ...(receipt.originalReceiptId ? { originalReceiptId: receipt.originalReceiptId } : {}),
              amount: receipt.amount.amount, currency: receipt.amount.currency,
              effectiveDate: new Date(`${receipt.effectiveDate}T00:00:00.000Z`), actorId: receipt.actorId,
              commandId: receipt.commandId, ...(receipt.reason ? { reason: receipt.reason } : {}),
              evidence: json({ schemaVersion: 1, receipt }),
              allocations: { create: receipt.allocations.map(allocation => ({ planId: receipt.planId,
                installmentId: allocation.installmentId, amount: allocation.amount })) } } });
            await persistCommand(command);
            return { ok: true, value: command };
          },
          appendDelayEvents: async ({ expected, events, command }) => {
            for (const event of events) {
              const appended = await appendEvent(expected, event);
              if (!appended.ok) return appended;
            }
            await persistCommand(command);
            return { ok: true, value: command };
          },
        });
        if (!result.ok) throw new RollbackResult(result);
        return result;
      });
    } catch (error) {
      if (error instanceof RollbackResult) return error.result as Result<never>;
      return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
    }
  } };
}
