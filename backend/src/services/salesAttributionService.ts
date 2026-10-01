import { Prisma, PrismaClient } from '@prisma/client';
import { isOrdinaryCommercialFlow } from './ordinaryContractLifecycle';

type DbClient = PrismaClient | Prisma.TransactionClient;

const decimal = (value: unknown) => new Prisma.Decimal(String(value ?? 0));

export const countValidOrdinaryFinancialRecords = async (tx: DbClient, contractId: string) => {
  const direct = await tx.accountingFinancialRecord.count({ where: { contractId,
    status: { not: 'VOIDED' }, kind: { not: 'RECEIVABLE' } } });
  const companions = await tx.accountingFinancialRecord.findMany({ where: { contractId,
    status: { not: 'VOIDED' }, kind: 'RECEIVABLE' }, select: { id: true, metadata: true } });
  if (!companions.length) return direct;
  // Existing companion records have an exact CREATE_RECEIVABLE audit link;
  // newer records also retain that obligation identity in metadata.
  const links = await tx.accountingAuditLog.findMany({ where: { contractId, action: 'CREATE_RECEIVABLE',
    recordId: { in: companions.map(record => record.id) }, entityType: 'AccountingReceivable' },
  select: { recordId: true, entityId: true } });
  const byRecord = new Map(links.map(link => [link.recordId, link.entityId]));
  const obligationByRecord = new Map(companions.map(record => [record.id,
    String((record.metadata as any)?.receivableId || byRecord.get(record.id) || '')]));
  const active = await tx.accountingReceivable.findMany({ where: { contractId, status: { not: 'VOIDED' },
    id: { in: [...obligationByRecord.values()].filter(Boolean) } }, select: { id: true } });
  const activeIds = new Set(active.map(item => item.id));
  return direct + companions.filter(record => activeIds.has(obligationByRecord.get(record.id)!)).length;
};

export const snapshotRealizedSale = async (
  tx: DbClient,
  contractId: string,
  actorId: string,
  effectiveAt = new Date(),
  trigger: 'COMMERCIAL' | 'FINANCIAL_RECORD' = 'COMMERCIAL'
) => {
  const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error('Contract not found');
  if (isOrdinaryCommercialFlow(contract) && trigger !== 'FINANCIAL_RECORD') return contract;
  if (contract.realizedAt) return contract;

  const amount = decimal(contract.totalAmount);
  const updated = await tx.salesContract.update({
    where: { id: contract.id },
    data: {
      realizedAt: effectiveAt,
      realizedAmount: amount,
      realizedSellerId: contract.responsibleSellerId,
      realizedSellerSource: 'RESPONSIBLE_SELLER_SNAPSHOT'
    }
  });

  await tx.salesReportingEvent.upsert({
    where: { sourceKey: `realized:${contract.id}` },
    update: {},
    create: {
      contractId: contract.id,
      eventType: 'REALIZED',
      amount,
      effectiveAt,
      sellerId: contract.responsibleSellerId,
      sourceKey: `realized:${contract.id}`,
      reason: 'First transition to realized sales',
      createdBy: actorId,
      metadata: { statusAtRealization: contract.status, trigger }
    }
  });
  return updated;
};

/** Reconcile after the financial writer persists its mutation, inside its transaction. */
export const reconcileOrdinaryFinancialRealization = async (
  tx: DbClient,
  input: { contractId: string; actorId: string; sourceKey: string; effectiveAt?: Date }
) => {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts" WHERE "id" = ${input.contractId} FOR UPDATE`);
  const contract = await tx.salesContract.findUnique({ where: { id: input.contractId }, include: { reportingEvents: true } });
  if (!contract || !isOrdinaryCommercialFlow(contract)) return;
  const original = contract.reportingEvents.find(event => event.eventType === 'REALIZED');
  // Adoption never rewrites a realization earned under the historical commercial trigger.
  if (original && (original.metadata as any)?.trigger !== 'FINANCIAL_RECORD') return;
  if (contract.realizedAt && !original) return;
  const valid = await countValidOrdinaryFinancialRecords(tx, input.contractId);
  const effectiveAt = input.effectiveAt || new Date();
  if (!contract.realizedAt) {
    if (valid > 0) await snapshotRealizedSale(tx, contract.id, input.actorId, effectiveAt, 'FINANCIAL_RECORD');
    return;
  }
  const net = contract.reportingEvents.reduce((sum, event) => sum.plus(event.amount), new Prisma.Decimal(0));
  const target = valid > 0 && contract.status !== 'CANCELLED' ? decimal(contract.totalAmount) : new Prisma.Decimal(0);
  const delta = target.minus(net);
  if (delta.isZero()) return;
  await tx.salesReportingEvent.upsert({ where: { sourceKey: input.sourceKey }, update: {}, create: {
    contractId: contract.id, eventType: 'ADJUSTMENT', amount: delta, effectiveAt,
    sellerId: contract.realizedSellerId, sourceKey: input.sourceKey, createdBy: input.actorId,
    reason: valid > 0 ? 'Accounting financial record restored realized sales value' : 'Last valid accounting financial record removed',
    metadata: { trigger: 'FINANCIAL_RECORD', validRecordCount: valid, previousNet: net.toString(), nextNet: target.toString() }
  } });
};

export const recordRealizedAdjustment = async (
  tx: DbClient,
  params: {
    contractId: string;
    previousAmount: unknown;
    nextAmount: unknown;
    sourceKey: string;
    actorId: string;
    reason: string;
    effectiveAt?: Date;
  }
) => {
  const contract = await tx.salesContract.findUnique({ where: { id: params.contractId }, include: { reportingEvents: true } });
  if (!contract?.realizedAt) return null;
  if (isOrdinaryCommercialFlow(contract)
    && contract.reportingEvents.some(event => event.eventType === 'REALIZED' && (event.metadata as any)?.trigger === 'FINANCIAL_RECORD')
    && await countValidOrdinaryFinancialRecords(tx, contract.id) === 0) return null;
  const delta = decimal(params.nextAmount).minus(decimal(params.previousAmount));
  if (delta.isZero()) return null;

  return tx.salesReportingEvent.upsert({
    where: { sourceKey: params.sourceKey },
    update: {},
    create: {
      contractId: contract.id,
      eventType: 'ADJUSTMENT',
      amount: delta,
      effectiveAt: params.effectiveAt || new Date(),
      sellerId: contract.realizedSellerId,
      sourceKey: params.sourceKey,
      reason: params.reason,
      createdBy: params.actorId,
      metadata: {
        previousAmount: decimal(params.previousAmount).toString(),
        nextAmount: decimal(params.nextAmount).toString()
      }
    }
  });
};

export const recordContractCancellation = async (
  tx: DbClient,
  contractId: string,
  actorId: string,
  effectiveAt = new Date()
): Promise<string | null> => {
  const contract = await tx.salesContract.findUnique({
    where: { id: contractId },
    include: { reportingEvents: true }
  });
  if (!contract) throw new Error('Contract not found');

  await tx.salesContract.update({ where: { id: contractId }, data: { lostAt: effectiveAt } });
  if (!contract.realizedAt) return null;

  const currentNet = contract.reportingEvents.reduce(
    (sum, event) => sum.plus(event.amount),
    new Prisma.Decimal(0)
  );
  if (currentNet.isZero()) return null;
  const baseSourceKey = `cancellation:${contract.id}`;
  const existingCancellation = await tx.salesReportingEvent.findUnique({
    where: { sourceKey: baseSourceKey },
    select: { id: true }
  });
  const sourceKey = existingCancellation
    ? `${baseSourceKey}:${effectiveAt.toISOString()}`
    : baseSourceKey;
  await tx.salesReportingEvent.upsert({
    where: { sourceKey },
    update: {},
    create: {
      contractId: contract.id,
      eventType: 'CANCELLATION',
      amount: currentNet.negated(),
      effectiveAt,
      sellerId: contract.realizedSellerId,
      sourceKey,
      reason: 'Realized contract cancelled',
      createdBy: actorId,
      metadata: { previousStatus: contract.status }
    }
  });
  return sourceKey;
};

export const recordContractReactivation = async (
  tx: DbClient,
  contractId: string,
  actorId: string,
  cancellationSourceKey: string | null,
  effectiveAt = new Date()
): Promise<void> => {
  await tx.salesContract.update({ where: { id: contractId }, data: { lostAt: null } });
  if (!cancellationSourceKey) return;

  const cancellation = await tx.salesReportingEvent.findUnique({
    where: { sourceKey: cancellationSourceKey }
  });
  if (!cancellation || cancellation.eventType !== 'CANCELLATION') return;

  await tx.salesReportingEvent.upsert({
    where: { sourceKey: `reactivation:${cancellationSourceKey}` },
    update: {},
    create: {
      contractId,
      eventType: 'REACTIVATION',
      amount: cancellation.amount.negated(),
      effectiveAt,
      sellerId: cancellation.sellerId,
      sourceKey: `reactivation:${cancellationSourceKey}`,
      reason: 'Realized contract cancellation reversed',
      createdBy: actorId,
      metadata: { cancellationSourceKey }
    }
  });
};

export const reassignContractSeller = async (
  prisma: PrismaClient,
  params: { contractId: string; nextSellerId: string; actorId: string; reason: string }
) => prisma.$transaction(async (tx) => {
  const contract = await tx.salesContract.findUnique({ where: { id: params.contractId } });
  if (!contract) throw new Error('Contract not found');

  // Partner activation locks the profile before it evaluates ordinary Sales
  // responsibility. Take the same lock first so an assignment can neither
  // slip past that evaluation nor deadlock by acquiring the User first.
  await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT id
    FROM partner_profiles
    WHERE "userId" = ${params.nextSellerId}
    FOR UPDATE
  `);
  const nextSeller = await tx.user.findUnique({
    where: { id: params.nextSellerId },
    select: {
      id: true,
      isActive: true,
      departmentId: true,
      partnerProfile: { select: { irreversibleAt: true } }
    }
  });
  if (!nextSeller?.isActive) throw new Error('Responsible seller not found or inactive');
  if (nextSeller.partnerProfile?.irreversibleAt && contract.partnerKind !== 'PARTNER_CUSTOMER') {
    throw new Error('Irreversible Partner persona cannot own an ordinary Sales contract');
  }
  if (nextSeller.departmentId !== contract.departmentId) throw new Error('Responsible seller must belong to the contract department');
  if (contract.responsibleSellerId === nextSeller.id) return contract;

  const updated = await tx.salesContract.update({
    where: { id: contract.id },
    data: { responsibleSellerId: nextSeller.id, responsibleSellerSource: 'MANAGER_REASSIGNMENT' }
  });
  await tx.salesContractSellerAudit.create({
    data: {
      contractId: contract.id,
      previousSellerId: contract.responsibleSellerId,
      nextSellerId: nextSeller.id,
      changedBy: params.actorId,
      changeType: 'RESPONSIBILITY_REASSIGNED',
      reason: params.reason
    }
  });
  return updated;
});

export const assignLegacyRealizedCredit = async (
  prisma: PrismaClient,
  params: { contractId: string; sellerId: string; actorId: string; reason: string }
) => prisma.$transaction(async (tx) => {
  const contract = await tx.salesContract.findUnique({ where: { id: params.contractId } });
  if (!contract?.realizedAt) throw new Error('Contract has no realized sale to attribute');
  if (contract.realizedSellerId && contract.realizedSellerSource !== 'LEGACY_UNASSIGNED') {
    throw new Error('Realized seller credit is already assigned');
  }
  const seller = await tx.user.findUnique({ where: { id: params.sellerId }, select: { id: true, isActive: true, departmentId: true } });
  if (!seller?.isActive) throw new Error('Seller not found or inactive');
  if (seller.departmentId !== contract.departmentId) throw new Error('Seller must belong to the contract department');

  const updated = await tx.salesContract.update({
    where: { id: contract.id },
    data: { realizedSellerId: seller.id, realizedSellerSource: 'MANAGER_LEGACY_ASSIGNMENT' }
  });
  await tx.salesReportingEvent.updateMany({
    where: { contractId: contract.id },
    data: { sellerId: seller.id }
  });
  await tx.salesContractSellerAudit.create({
    data: {
      contractId: contract.id,
      previousSellerId: null,
      nextSellerId: seller.id,
      changedBy: params.actorId,
      changeType: 'LEGACY_REALIZED_CREDIT_ASSIGNED',
      reason: params.reason
    }
  });
  return updated;
});
