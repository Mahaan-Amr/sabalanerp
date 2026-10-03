import type { PrismaClient } from '@prisma/client';
import { actualContractReceiptsRials } from './ordinaryContractDispatchEligibility';
import { dispatchCreditAccess, rials, tehranDay } from './contractDispatchCredit';
import { publishNotificationEvent } from './notificationService';

export const processContractCreditReminders = async (database: PrismaClient, now = new Date()) => {
  const today = tehranDay(now);
  const due = await database.contractDispatchAuthority.findMany({ where: { kind: { in: ['MANAGER','CREDIT'] }, status: 'APPROVED',
    promisedDate: { lte: new Date(`${today}T00:00:00Z`) }, contract: { isInactive: false, status: { notIn: ['CANCELLED','EXPIRED'] } } },
    include: { contract: true } });
  const users = due.length ? await database.user.findMany({ where: { isActive: true }, select: { id: true } }) : [];
  for (const row of due) {
    const day = row.promisedDate.toISOString().slice(0, 10);
    if (row.notifiedFor === day || row.revision !== row.contract.commercialRevision) continue;
    await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT "id" FROM "sales_contracts" WHERE "id"=${row.contractId} FOR UPDATE`;
      const current = await tx.contractDispatchAuthority.findUniqueOrThrow({ where: { id: row.id }, include: { contract: true } });
      if (current.status !== 'APPROVED' || current.notifiedFor === day || current.promisedDate.getTime() !== row.promisedDate.getTime()
        || current.revision !== current.contract.commercialRevision || current.contract.isInactive
        || ['CANCELLED','EXPIRED'].includes(current.contract.status)) return;
      const outstanding = rials(current.contract.totalAmount ?? 0, current.contract.currency).minus(await actualContractReceiptsRials(tx, current.contract));
      if (outstanding.gt(0)) {
        for (const user of users) {
          const access = await dispatchCreditAccess(tx, current.contract, user.id);
          if (access.manage || (current.kind === 'CREDIT' ? access.request || (access.read && user.id === current.contract.responsibleSellerId)
            : access.read && user.id === current.requestedBy)) {
            await publishNotificationEvent(tx, { type: 'CONTRACT_PAYMENT_PROMISE_DUE',
              deduplicationKey: `contract-payment-promise:${current.contractId}:${day}:${user.id}`,
              recipientIds: [user.id], resourceType: 'CONTRACT_DISPATCH', resourceId: current.contractId,
              actionUrl: access.manage || access.request ? `/dashboard/accounting/contracts/${current.contractId}` : `/dashboard/sales/contracts/${current.contractId}`,
              payload: { contractNumber: current.contract.contractNumber, promisedDate: row.promisedDate.toLocaleDateString('fa-IR', { timeZone: 'UTC' }) } });
          }
        }
      }
      await tx.contractDispatchAuthority.update({ where: { id: row.id }, data: { notifiedFor: day } });
    });
  }
};
