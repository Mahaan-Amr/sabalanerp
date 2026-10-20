import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, SalesContract } from '@prisma/client';
import { createAuditedPartnerAuthorization } from './partnerSales/authorization/audited';
import { isPartnerCommercialFlow, lockPartnerCommercialContract, assertPartnerFinancialFinality } from './partnerSales/cases/commercialLifecycle';
import { isCommerciallyFinal } from './ordinaryContractLifecycle';

type Db = PrismaClient | Prisma.TransactionClient;
export const dispatchAccountingHref = (contract: Pick<SalesContract, 'id' | 'partnerCaseId'>) => contract.partnerCaseId
  ? `/dashboard/accounting/contracts/partner/${encodeURIComponent(contract.partnerCaseId)}`
  : `/dashboard/accounting/contracts/${contract.id}`;

export async function partnerDispatchAccess(db: Db, contract: SalesContract, actorId: string, write = false) {
  if (!isPartnerCommercialFlow(contract) || !contract.partnerCaseId) return false;
  const root = await db.partnerSaleCase.findUnique({ where: { id: contract.partnerCaseId }, select: { customerContractId: true } });
  if (root?.customerContractId !== contract.id) return false;
  const decision = await createAuditedPartnerAuthorization(db as Prisma.TransactionClient,
    { actorId, purpose: 'ACCOUNTING', channel: 'API' }, { correlationId: randomUUID(), reason: 'بررسی مجوز ارسال قرارداد همکار در حسابداری' })
    .authorize(write ? 'ACCOUNTING_WRITE' : 'ACCOUNTING_READ', { kind: 'CASE', id: contract.partnerCaseId });
  return decision.ok;
}

/** Partner writers always acquire Case before Contract, including decisions through shared duties. */
export async function lockDispatchContract(db: Db, contractId: string) {
  const candidate = await db.salesContract.findUniqueOrThrow({ where: { id: contractId } });
  if (candidate.partnerCaseId) {
    const locked = await lockPartnerCommercialContract(db as Prisma.TransactionClient, candidate.partnerCaseId);
    if (locked.contract.id !== candidate.id) throw new Error('قرارداد به این پرونده همکار تعلق ندارد.');
    return locked.contract;
  }
  await db.$queryRaw`SELECT id FROM sales_contracts WHERE id = ${contractId} FOR UPDATE`;
  return db.salesContract.findUniqueOrThrow({ where: { id: contractId } });
}

export const dispatchCommerciallyFinal = (contract: SalesContract) => isPartnerCommercialFlow(contract)
  ? !contract.isInactive && contract.status === 'SIGNED'
    && contract.salesApprovalRevision === contract.commercialRevision && contract.customerAcceptanceRevision === contract.commercialRevision
  : isCommerciallyFinal(contract);

export async function assertDispatchFinality(db: Db, contract: SalesContract) {
  if (!dispatchCommerciallyFinal(contract)) throw new Error('درخواست تأیید مدیریتی به قرارداد قطعی نیاز دارد.');
  if (contract.partnerCaseId) await assertPartnerFinancialFinality(db as Prisma.TransactionClient, contract.partnerCaseId);
}
