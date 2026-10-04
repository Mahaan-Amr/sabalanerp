import type { PrismaClient } from '@prisma/client';
import { actualContractReceiptsRials } from './ordinaryContractDispatchEligibility';
import { dispatchCreditAccess, rials, tehranDay } from './contractDispatchCredit';
import { publishNotificationEvent } from './notificationService';
import { consumedCustomerCredit, lockCustomerCredit, canManageCustomerCredit } from './specialCustomerCredit';

export const processContractCreditReminders = async (database: PrismaClient, now = new Date()) => {
  const today = tehranDay(now);
  const customerDue = await database.salesContract.findMany({ where: { customerCreditAmountRials: { gt: 0 },
    customerCreditPromisedDate: { lte: new Date(`${today}T00:00:00Z`) } } });
  const customerRecipients = customerDue.length ? await database.user.findMany({ where: { isActive: true }, select: { id: true } }) : [];
  for (const candidate of customerDue) {
    const day = candidate.customerCreditPromisedDate!.toISOString().slice(0, 10);
    if (candidate.customerCreditNotifiedFor === day) continue;
    await database.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sales_contracts WHERE id=${candidate.id} FOR UPDATE`;
      const current = await tx.salesContract.findUniqueOrThrow({ where: { id: candidate.id } });
      if (current.customerCreditNotifiedFor === day || current.customerCreditPromisedDate?.getTime() !== candidate.customerCreditPromisedDate?.getTime() || !current.customerCreditCustomerId) return;
      await lockCustomerCredit(tx, current.customerCreditCustomerId);
      if ((await consumedCustomerCredit(tx, current)).gt(0)) {
        for (const user of customerRecipients) {
          const access = await dispatchCreditAccess(tx, current, user.id);
          if (access.manage || await canManageCustomerCredit(tx, user.id) || access.request || (access.read && user.id === current.responsibleSellerId)) {
            await publishNotificationEvent(tx, { type: 'CONTRACT_PAYMENT_PROMISE_DUE',
              deduplicationKey: `special-customer-credit-promise:${current.id}:${day}:${user.id}`,
              recipientIds: [user.id], resourceType: 'CONTRACT_DISPATCH', resourceId: current.id,
              actionUrl: access.manage || access.request ? `/dashboard/accounting/contracts/${current.id}` : `/dashboard/sales/contracts/${current.id}`,
              payload: { contractNumber: current.contractNumber, promisedDate: current.customerCreditPromisedDate!.toLocaleDateString('fa-IR', { timeZone: 'UTC' }) } });
          }
        }
      }
      await tx.salesContract.update({ where: { id: current.id }, data: { customerCreditNotifiedFor: day } });
    }, { maxWait: 10_000, timeout: 60_000 });
  }
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
