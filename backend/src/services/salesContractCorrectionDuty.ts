import { CorrectionRequestCategory, CorrectionRequestPriority, Prisma, type PrismaClient } from '@prisma/client';
import { synchronizeCrossWorkspaceDutySource } from './crossWorkspaceDutyModule';
import { completeSalesCorrectionEditDuty } from './crossWorkspaceDutyAdapters/salesContractCorrectionDutyAdapter';

type Database = PrismaClient | Prisma.TransactionClient;

export type RequestSalesContractCorrectionInput = {
  contractId: string;
  actorUserId: string;
  category: keyof typeof CorrectionRequestCategory;
  priority: keyof typeof CorrectionRequestPriority;
  reason: string;
  idempotencyKey: string;
  now?: Date;
};

const inTransaction = <Result>(database: Database, work: (tx: Prisma.TransactionClient) => Promise<Result>) => (
  '$transaction' in database ? database.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }) : work(database)
);

export const requestSalesContractCorrection = (
  database: Database,
  input: RequestSalesContractCorrectionInput,
) => inTransaction(database, async (tx) => {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error('DUTY_REASON_REQUIRED');
  if (!input.idempotencyKey.trim()) throw new Error('DUTY_IDEMPOTENCY_KEY_REQUIRED');
  const contract = await tx.salesContract.findUnique({ where: { id: input.contractId } });
  if (!contract) throw new Error('CONTRACT_NOT_FOUND');
  if (contract.isInactive) throw new Error('CONTRACT_INACTIVE');
  if (contract.responsibleSellerId !== input.actorUserId) throw new Error('DUTY_REQUESTER_NOT_RESPONSIBLE_SELLER');
  const replaySource = await tx.accountingCorrectionRequest.findUnique({
    where: { requestIdempotencyKey: input.idempotencyKey.trim() },
  });
  if (replaySource) {
    if (
      replaySource.contractId !== contract.id
      || replaySource.createdBy !== input.actorUserId
      || replaySource.accountantNote !== reason
    ) throw new Error('DUTY_IDEMPOTENCY_CONFLICT');
    const duty = await tx.crossWorkspaceDuty.findFirst({
      where: {
        sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: replaySource.id,
        sourceActionCode: 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
      },
    });
    if (!duty) throw new Error('DUTY_REPLAY_REVALIDATION_FAILED');
    return { correction: replaySource, duty, replayed: true };
  }

  const active = await tx.accountingCorrectionRequest.findFirst({
    where: { contractId: contract.id, status: { in: ['OPEN', 'ACKNOWLEDGED', 'APPROVED_FOR_SALES_EDIT', 'SALES_EDITED'] } },
  });
  if (active) throw new Error('DUTY_ACTIVE_CHAIN_CONFLICT');

  const correction = await tx.accountingCorrectionRequest.create({ data: {
    contractId: contract.id,
    category: CorrectionRequestCategory[input.category] ?? CorrectionRequestCategory.OTHER,
    priority: CorrectionRequestPriority[input.priority] ?? CorrectionRequestPriority.MEDIUM,
    assignedToUserId: null,
    requestIdempotencyKey: input.idempotencyKey.trim(),
    accountantNote: reason,
    createdBy: input.actorUserId,
    createdAt: now,
  } });
  await tx.accountingAuditLog.create({ data: {
    action: 'SELLER_REQUESTED_CONTRACT_CORRECTION',
    actorId: input.actorUserId,
    contractId: contract.id,
    entityType: 'AccountingCorrectionRequest',
    entityId: correction.id,
    afterState: JSON.parse(JSON.stringify(correction)),
    note: reason,
    createdAt: now,
  } });
  const duty = await synchronizeCrossWorkspaceDutySource(tx, {
    sourceType: 'SALES_CONTRACT_CORRECTION',
    sourceId: correction.id,
    dutyTypeCode: 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
    actorUserId: input.actorUserId,
    policyVersion: 1,
    now,
  });
  return { correction, duty, replayed: false };
}).catch(async (error) => {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || !['P2002', 'P2034'].includes(error.code)) throw error;
  const replaySource = await database.accountingCorrectionRequest.findUnique({
    where: { requestIdempotencyKey: input.idempotencyKey.trim() },
  });
  if (replaySource
    && replaySource.contractId === input.contractId
    && replaySource.createdBy === input.actorUserId
    && replaySource.accountantNote === input.reason.trim()) {
    const duty = await database.crossWorkspaceDuty.findFirst({
      where: {
        sourceType: 'SALES_CONTRACT_CORRECTION', sourceId: replaySource.id,
        sourceActionCode: 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION',
      },
    });
    if (duty) return { correction: replaySource, duty, replayed: true };
  }
  throw new Error('DUTY_ACTIVE_CHAIN_CONFLICT');
});

export const completeSalesContractCorrectionEdit = (
  database: Database,
  input: { contractId: string; actorUserId: string; note?: string | null; policyVersion: number; now?: Date },
) => inTransaction(database, (tx) => completeSalesCorrectionEditDuty(tx, {
  contractId: input.contractId,
  actorUserId: input.actorUserId,
  note: input.note?.trim() || null,
  policyVersion: input.policyVersion,
  now: input.now ?? new Date(),
}));

const correctionStage = (status: string) => ({
  OPEN: { actionCode: 'ACCOUNTING_PROCESS_CONTRACT_CORRECTION', sourceVersion: 1 },
  ACKNOWLEDGED: { actionCode: 'ACCOUNTING_DECIDE_CONTRACT_CORRECTION', sourceVersion: 2 },
  APPROVED_FOR_SALES_EDIT: { actionCode: 'SALES_EDIT_CONTRACT_CORRECTION', sourceVersion: 3 },
  SALES_EDITED: { actionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION', sourceVersion: 4 },
}[status] ?? null);

export const reconcileSalesContractCorrectionDuties = async (
  database: Database,
  options: { sourceIds?: string[] } = {},
) => {
  const [sources, duties] = await Promise.all([
    database.accountingCorrectionRequest.findMany({
      where: {
        status: { in: ['OPEN', 'ACKNOWLEDGED', 'APPROVED_FOR_SALES_EDIT', 'SALES_EDITED'] },
        ...(options.sourceIds ? { id: { in: options.sourceIds } } : {}),
      },
      select: {
        id: true, status: true, assignedToUserId: true, requestIdempotencyKey: true, dutySourceVersion: true,
      },
    }),
    database.crossWorkspaceDuty.findMany({
      where: {
        sourceType: 'SALES_CONTRACT_CORRECTION', status: 'OPEN',
        ...(options.sourceIds ? { sourceId: { in: options.sourceIds } } : {}),
      },
      select: {
        id: true, sourceId: true, sourceActionCode: true, sourceVersion: true, currentAssigneeUserId: true,
      },
    }),
  ]);
  const findings: Array<{ code: string; sourceId?: string; dutyId?: string }> = [];
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  for (const source of sources) {
    const stage = correctionStage(source.status);
    if (!source.requestIdempotencyKey) continue;
    const matches = duties.filter((duty) => (
      duty.sourceId === source.id
      && duty.sourceActionCode === stage?.actionCode
      && duty.sourceVersion === source.dutySourceVersion
    ));
    if (matches.length !== 1) findings.push({ code: 'ACTIONABLE_SOURCE_DUTY_COUNT_MISMATCH', sourceId: source.id });
    if (matches[0] && matches[0].currentAssigneeUserId !== source.assignedToUserId) {
      findings.push({ code: 'ACTIONABLE_SOURCE_ASSIGNEE_MISMATCH', sourceId: source.id, dutyId: matches[0].id });
    }
    for (const stale of duties.filter((duty) => duty.sourceId === source.id && !matches.includes(duty))) {
      findings.push({ code: 'STALE_OPEN_DUTY', sourceId: source.id, dutyId: stale.id });
    }
  }
  for (const duty of duties) {
    if (!sourceById.has(duty.sourceId)) findings.push({ code: 'ORPHAN_OPEN_DUTY', dutyId: duty.id });
  }
  return {
    ok: findings.length === 0,
    counts: {
      actionableSources: sources.filter(({ requestIdempotencyKey }) => Boolean(requestIdempotencyKey)).length,
      openDuties: duties.length,
      grandfatheredLegacySources: sources.filter(({ requestIdempotencyKey }) => !requestIdempotencyKey).length,
    },
    findings,
  };
};
