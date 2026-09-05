import { Prisma, type PrismaClient } from '@prisma/client';
import {
  PartnerEventSchema, SabalanInternalRecordViewSchema, canonicalHash, partnerError,
  type PartnerEvent, type Result,
} from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { lockPartnerOperationsControl } from '../authorization/technicalRollout';
import type {
  AccountingQueueEntry, CommittedAccountingSource, PartnerAccountSnapshot, PartnerAccountingFact,
  PartnerAccountingRepository, PartnerInvoiceEvidence, PartnerReceivable,
} from './repository';
import type { PartnerFinancialPreparation } from './source';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE } from './financialApproval';
import { latestPartnerFinancialApproval, readPartnerOfficialPurchase, PartnerOfficialAccountingIntegrityError } from './officialPurchase';
import { readPersistedPartnerEvents, PartnerEventIntegrityError } from '../events/persisted';
import { visibleEvents } from '../reporting/revenue';
import * as partnerContracts from '@sabalanerp/partner-sales-contracts';
import { partnerPredecessorIsFrozen } from '../corrections/mutationFreeze';
import { readCurrentPartnerCaseViews } from '../cases/lifecycle';
import { PartnerAccountingCommandError, PartnerAccountingTechnicalError } from './errors';
import { PartnerCollectionIntegrityError } from './collections';

const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
class RollbackResult extends Error { constructor(readonly result: Result<unknown>) { super('rollback Partner accounting'); } }

const ownsRevision = (owner: { caseId: string; revision: number; integrityHash: string },
  expected: { caseId: string; revision: number; integrityHash: string }) =>
  owner.caseId === expected.caseId && owner.revision === expected.revision && owner.integrityHash === expected.integrityHash;

function preparation(value: unknown): PartnerFinancialPreparation | undefined {
  const candidate = object(value)?.partnerPreparation ?? value;
  return candidate && typeof candidate === 'object' && !Array.isArray(candidate) ? candidate as PartnerFinancialPreparation : undefined;
}
function invoice(row: { id: string; kind: string; status: string; amount: Prisma.Decimal; currency: string;
  sourceSnapshot: Prisma.JsonValue | null; financiallyApprovedAt: Date | null; financiallyApprovedBy: string | null;
  metadata: Prisma.JsonValue | null }): PartnerInvoiceEvidence | undefined {
  const source = preparation(row.sourceSnapshot);
  const approval = object(row.metadata)?.partnerApproval;
  if (!source || row.kind !== 'INVOICE_CANDIDATE') return undefined;
  return { invoiceRecordId: row.id, preparation: source, amount: { amount: row.amount.toString(), currency: row.currency as 'IRR' | 'IRT' },
    kind: 'INVOICE_CANDIDATE', status: row.status as PartnerInvoiceEvidence['status'],
    approval: row.financiallyApprovedAt && row.financiallyApprovedBy && approval && typeof approval === 'object' && !Array.isArray(approval)
      ? approval as PartnerInvoiceEvidence['approval'] : null };
}
function receivable(row: { id: string; invoiceRecordId: string | null; originalAmount: Prisma.Decimal; currency: string;
  dueDate: Date; metadata: Prisma.JsonValue | null }): PartnerReceivable | undefined {
  const value = object(row.metadata)?.partnerReceivable;
  return value && typeof value === 'object' && !Array.isArray(value) && row.invoiceRecordId
    ? value as PartnerReceivable : undefined;
}

export function createPrismaPartnerAccountingRepository(input: {
  database: PrismaClient; actorId: string; correlationId: string;
}): PartnerAccountingRepository {
  return { async transaction(operation) {
    try {
      return await input.database.$transaction(async tx => {
        await lockPartnerOperationsControl(tx);
        const readSource = async (expected: CommittedAccountingSource['view']['owner'], action: 'QUEUE' | 'PREPARE' | 'APPROVAL' | 'PUBLISH_FACT'):
        Promise<Result<CommittedAccountingSource>> => {
          await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${expected.caseId} FOR UPDATE`;
          const row = await tx.partnerSaleCase.findUnique({ where: { id: expected.caseId }, select: {
            id: true, state: true, headRevision: true, integrityHash: true, internalRecordId: true,
            profile: { select: { userId: true } }, head: { select: { internalProjection: true } },
            events: { where: { type: 'CASE_COMMITTED' }, orderBy: { sequence: 'asc' }, take: 1,
              select: { id: true, caseRevision: true, integrityHash: true, evidence: true } },
          } });
          if (!row) return { ok: false, error: partnerError('NOT_FOUND') };
          const view = SabalanInternalRecordViewSchema.safeParse(object(row.head.internalProjection)?.accounting);
          const event = PartnerEventSchema.safeParse(object(row.events[0]?.evidence)?.publicEvent);
          const commitmentRow = row.events[0];
          if (!view.success || !event.success || event.data.type !== 'CASE_COMMITTED' || !commitmentRow ||
              row.state !== 'COMMITTED' || !ownsRevision(view.data.owner, expected) ||
              !ownsRevision(view.data.owner, { caseId: row.id, revision: row.headRevision, integrityHash: row.integrityHash }) ||
              view.data.recordId !== row.internalRecordId || event.data.eventId !== commitmentRow.id ||
              !ownsRevision(event.data.owner, { caseId: row.id, revision: commitmentRow.caseRevision,
                integrityHash: commitmentRow.integrityHash }) || event.data.internalRecordId !== row.internalRecordId) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          const authAction = action === 'PREPARE' ? 'ACCOUNTING_READ' : 'ACCOUNTING_WRITE';
          const allowed = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId,
            purpose: 'ACCOUNTING', channel: 'API' }, { correlationId: input.correlationId })
            .authorize(authAction, { kind: 'CASE', id: row.id });
          if (!allowed.ok) return allowed;
          if (!await readCurrentPartnerCaseViews(tx, row.id)) {
            return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
          }
          if (action === 'QUEUE' && await partnerPredecessorIsFrozen(tx, row.id, row.headRevision)) {
            return { ok: false, error: partnerError('DEPENDENCY_BLOCKED') };
          }
          return { ok: true, value: { view: { ...view.data, state: row.state },
            partnerSellerId: row.profile.userId, commitment: event.data } };
        };
        const appendPublicEvent = async (event: PartnerEvent) => {
          const current = await tx.partnerSaleCase.findUnique({ where: { id: event.owner.caseId }, select: {
            headRevision: true, integrityHash: true, events: { orderBy: { sequence: 'desc' }, take: 1, select: { sequence: true } } } });
          if (!current || event.owner.revision > current.headRevision) throw new RollbackResult({ ok: false, error: partnerError('ROW_STALE') });
          const prior = await tx.partnerCaseEvent.findUnique({ where: { id: event.eventId } });
          if (prior) {
            if (await canonicalHash(object(prior.evidence)?.publicEvent) !== await canonicalHash(event)) {
              throw new RollbackResult({ ok: false, error: partnerError('INTEGRITY_CONFLICT') });
            }
            return;
          }
          await tx.partnerCaseEvent.create({ data: { id: event.eventId, caseId: event.owner.caseId,
            caseRevision: event.owner.revision, integrityHash: event.owner.integrityHash,
            sequence: (current.events[0]?.sequence ?? 0) + 1, type: event.type, actorId: event.actorId,
            commandId: event.commandId, correlationId: event.correlationId,
            effectiveDate: new Date(`${event.effectiveDate}T00:00:00.000Z`), evidence: json({ publicEvent: event }) } });
        };
        const result = await operation({
          readAuthorizedSource: readSource,
          findQueue: async caseId => {
            const row = await tx.accountingFinancialRecord.findFirst({ where: { sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE,
              metadata: { path: ['partnerCaseId'], equals: caseId } }, orderBy: { createdAt: 'asc' } });
            const prepared = row && preparation(row.sourceSnapshot);
            const commitmentEventId = row && object(row.metadata)?.commitmentEventId;
            return row && prepared && typeof commitmentEventId === 'string' ? { queueEvidenceId: row.id,
              commitmentEventId, preparation: prepared } : null;
          },
          insertQueue: async entry => {
            await tx.accountingFinancialRecord.create({ data: { id: entry.queueEvidenceId, kind: 'INVOICE_CANDIDATE',
              status: 'DRAFT', sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: entry.preparation.internalRecordId,
              amount: entry.preparation.amount.amount,
              currency: entry.preparation.amount.currency, sourceSnapshot: json({ partnerPreparation: entry.preparation }),
              metadata: json({ partnerCaseId: entry.preparation.owner.caseId, commitmentEventId: entry.commitmentEventId }),
              idempotencyKey: entry.queueEvidenceId, createdBy: input.actorId } });
          },
          readInvoice: async (invoiceRecordId, expected) => {
            const row = await tx.accountingFinancialRecord.findUnique({ where: { id: invoiceRecordId } });
            const value = row && invoice(row);
            return value?.preparation.owner.caseId === expected.caseId ? value : null;
          },
          findReceivable: async invoiceRecordId => {
            const row = await tx.accountingReceivable.findFirst({ where: { invoiceRecordId }, orderBy: { createdAt: 'asc' } });
            return row ? receivable(row) ?? null : null;
          },
          findActiveReceivable: async internalRecordId => {
            const row = await tx.accountingReceivable.findFirst({ where: { status: { not: 'VOIDED' },
              metadata: { path: ['partnerReceivable', 'internalRecordId'], equals: internalRecordId } }, orderBy: { createdAt: 'asc' } });
            return row ? receivable(row) ?? null : null;
          },
          insertReceivable: async value => {
            await tx.accountingReceivable.create({ data: { id: value.id, invoiceRecordId: value.invoiceRecordId,
              originalAmount: value.originalAmount.amount, remainingAmount: value.originalAmount.amount,
              currency: value.originalAmount.currency, dueDate: new Date(`${value.dueDate}T00:00:00.000Z`),
              metadata: json({ partnerReceivable: value }), createdBy: input.actorId } });
          },
          appendEvent: appendPublicEvent,
          readOwnAccount: async () => {
            const profile = await tx.partnerProfile.findUnique({ where: { userId: input.actorId }, select: { id: true } });
            if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
            const allowed = await createAuditedPartnerAuthorization(tx, { actorId: input.actorId, purpose: 'PARTNER', channel: 'DETAIL' },
              { correlationId: input.correlationId }).authorize('ACCOUNTING_READ', { kind: 'PROFILE', id: profile.id });
            if (!allowed.ok) return allowed;
            const cases = await tx.partnerSaleCase.findMany({ where: { profileId: profile.id, state: { in: ['COMMITTED', 'VOIDED'] } },
              select: { id: true, state: true, headRevision: true, integrityHash: true, internalRecordId: true,
                profile: { select: { userId: true } }, head: { select: { internalProjection: true } },
                events: { orderBy: { sequence: 'asc' },
                  select: { id: true, type: true, caseRevision: true, integrityHash: true, evidence: true } } } });
            const purchases: PartnerAccountSnapshot['purchases'] = [];
            const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
            for (const row of cases) {
              if (!await readCurrentPartnerCaseViews(tx, row.id)) {
                return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
              }
              const view = SabalanInternalRecordViewSchema.safeParse(object(row.head.internalProjection)?.accounting);
              const events = readPersistedPartnerEvents(row, row.events);
              const commitmentRow = row.events.find(event => event.type === 'CASE_COMMITTED');
              const commitment = PartnerEventSchema.safeParse(object(commitmentRow?.evidence)?.publicEvent);
              if (!view.success || !commitment.success || commitment.data.type !== 'CASE_COMMITTED' || !commitmentRow ||
                  !ownsRevision(view.data.owner, { caseId: row.id, revision: row.headRevision,
                    integrityHash: row.integrityHash }) || view.data.recordId !== row.internalRecordId ||
                  commitment.data.eventId !== commitmentRow.id ||
                  !ownsRevision(commitment.data.owner, { caseId: row.id, revision: commitmentRow.caseRevision,
                    integrityHash: commitmentRow.integrityHash }) || commitment.data.internalRecordId !== row.internalRecordId) {
                return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
              }
              const source = { view: { ...view.data, state: row.state }, partnerSellerId: row.profile.userId };
              const { official, covered } = await readPartnerOfficialPurchase(tx, { internalRecordId: view.data.recordId,
                approval: latestPartnerFinancialApproval(visibleEvents(partnerContracts, events, {
                  from: '0001-01-01', to: '9999-12-31', asOf: clock.now.toISOString() })),
                cutoff: clock.now, asOf: clock.now, voided: row.state === 'VOIDED' });
              if (!covered) return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
              purchases.push({ source, official });
            }
            return { ok: true, value: { partnerSellerId: input.actorId, purchases } };
          },
          readAccountingFact: async (factId, caseId): Promise<PartnerAccountingFact | null> => {
            const caseRow = await tx.partnerSaleCase.findUnique({ where: { id: caseId }, select: {
              internalRecordId: true, profile: { select: { userId: true } } } });
            if (!caseRow) return null;
            const payment = await tx.accountingPaymentStatus.findUnique({ where: { id: factId } });
            const evidence = object(payment?.metadata)?.partnerFact;
            return evidence && typeof evidence === 'object' && !Array.isArray(evidence)
              ? evidence as PartnerAccountingFact : null;
          },
        });
        if (!result.ok) throw new RollbackResult(result);
        return result;
      });
    } catch (error) {
      if (error instanceof RollbackResult) return error.result as Result<never>;
      if (error instanceof PartnerEventIntegrityError || error instanceof PartnerOfficialAccountingIntegrityError ||
          error instanceof PartnerCollectionIntegrityError ||
          (error instanceof PartnerAccountingCommandError && error.code === 'INTEGRITY_CONFLICT')) {
        return { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
      }
      throw new PartnerAccountingTechnicalError(error);
    }
  } };
}
