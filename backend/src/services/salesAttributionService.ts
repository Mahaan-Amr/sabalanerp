import { Prisma, PrismaClient } from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

const decimal = (value: unknown) => new Prisma.Decimal(String(value ?? 0));

export const snapshotRealizedSale = async (
  tx: DbClient,
  contractId: string,
  actorId: string,
  effectiveAt = new Date()
) => {
  const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
  if (!contract) throw new Error('Contract not found');
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
      metadata: { statusAtRealization: contract.status }
    }
  });
  return updated;
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
  const contract = await tx.salesContract.findUnique({ where: { id: params.contractId } });
  if (!contract?.realizedAt) return null;
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
) => {
  const contract = await tx.salesContract.findUnique({
    where: { id: contractId },
    include: { reportingEvents: true }
  });
  if (!contract) throw new Error('Contract not found');

  await tx.salesContract.update({ where: { id: contractId }, data: { lostAt: effectiveAt } });
  if (!contract.realizedAt) return;

  const currentNet = contract.reportingEvents.reduce(
    (sum, event) => sum.plus(event.amount),
    new Prisma.Decimal(0)
  );
  if (currentNet.isZero()) return;
  await tx.salesReportingEvent.upsert({
    where: { sourceKey: `cancellation:${contract.id}` },
    update: {},
    create: {
      contractId: contract.id,
      eventType: 'CANCELLATION',
      amount: currentNet.negated(),
      effectiveAt,
      sellerId: contract.realizedSellerId,
      sourceKey: `cancellation:${contract.id}`,
      reason: 'Realized contract cancelled',
      createdBy: actorId,
      metadata: { previousStatus: contract.status }
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
