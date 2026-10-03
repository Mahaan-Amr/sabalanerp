import { assertPartnerFinancialFinality } from './partnerSales/cases/commercialLifecycle';
import { Prisma, type PrismaClient } from '@prisma/client';
import { isOrdinaryCommercialFlow, isCommerciallyFinal, commercialDeadlinePassed } from './ordinaryContractLifecycle';
import { refreshDispatchExpiryExemption } from './ordinaryContractLifecycle';

export type OrdinaryCommercialContract = {
  commercialFlowVersion?: number;
  commercialRevision?: number;
  salesApprovalRevision?: number | null;
  customerAcceptanceRevision?: number | null;
  commercialExpiresAt?: Date | null;
  firstFinancialRecordAt?: Date | null;
  dispatchExpiryExempt?: boolean;
  status: string;
  isInactive?: boolean;
  partnerCaseId?: string | null;
  partnerKind?: string | null;
  partnerCommercialStatus?: string;
};

export const isNewOrdinaryCommercialFlow = (contract: OrdinaryCommercialContract) =>
  isOrdinaryCommercialFlow(contract);

export const ordinaryFinancialActionsAllowed = (contract: OrdinaryCommercialContract, now = new Date()) => {
  if (contract.partnerCommercialStatus) return contract.partnerCommercialStatus === 'FINAL';
  if (!isNewOrdinaryCommercialFlow(contract)) return true;
  return isCommerciallyFinal(contract) && !commercialDeadlinePassed(contract, now);
};

export class OrdinaryAccountingCommercialError extends Error {
  readonly status = 409;
  constructor(message = 'ابتدا قرارداد باید برای نسخه جاری تأیید فروش و تأیید مشتری داشته باشد و قطعی شود.') {
    super(message);
  }
}

// Existing correction decisions must remain usable while Sales is renewing
// approvals. They do not authorize new financial work for the changed version.
const correctionContinuation = new Set([
  'APPROVE_CORRECTION_FOR_SALES_EDIT', 'DECLINE_CORRECTION', 'RESOLVE_CORRECTION',
  'ACCOUNTING_CORRECTION_VERIFIED', 'ACCOUNTING_CORRECTION_RETURNED',
]);

export const assertOrdinaryAccountingCommercialGate = async (
  tx: Prisma.TransactionClient | PrismaClient,
  contractId: string,
  action: string,
  expectedRevision?: number,
) => {
  const identity = await tx.salesContract.findUnique({ where: { id: contractId }, select: { partnerCaseId: true } });
  if (identity?.partnerCaseId) await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${identity.partnerCaseId} FOR UPDATE`;
  await tx.$queryRaw(Prisma.sql`SELECT id FROM sales_contracts WHERE id = ${contractId} FOR UPDATE`);
  const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
  if (!contract) throw new OrdinaryAccountingCommercialError('قرارداد پیدا نشد.');
  if (contract.commercialFlowVersion === 2 && contract.partnerCaseId && !correctionContinuation.has(action)) await assertPartnerFinancialFinality(tx as Prisma.TransactionClient, contract.partnerCaseId);
  await refreshDispatchExpiryExemption(tx, contract);
  if (isNewOrdinaryCommercialFlow(contract)) {
    if (expectedRevision !== undefined && contract.commercialRevision !== expectedRevision) {
      throw new OrdinaryAccountingCommercialError('قرارداد تغییر کرده است؛ صفحه را تازه‌سازی کنید.');
    }
    if (!correctionContinuation.has(action) && !ordinaryFinancialActionsAllowed(contract)) {
      // Inactive settlement retains the platform's existing obligation policy.
      if (!(contract.isInactive && ['REGISTER_RECEIPT', 'UPDATE_CHECK_STATUS', 'REVERSE_RECEIPT'].includes(action))) {
        throw new OrdinaryAccountingCommercialError();
      }
    }
  }
  return contract;
};
