import { Prisma, type PrismaClient } from '@prisma/client';
import { isOrdinaryCommercialFlow, isCommerciallyFinal, commercialDeadlinePassed } from './ordinaryContractLifecycle';
import { refreshDispatchExpiryExemption } from './ordinaryContractLifecycle';
import { hasSpecialCustomerCreditAuthorization, type CustomerCreditContract } from './specialCustomerCreditPolicy';
import { lockCustomerCredit } from './specialCustomerCredit';

export type OrdinaryCommercialContract = CustomerCreditContract & {
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
};

export const isNewOrdinaryCommercialFlow = (contract: OrdinaryCommercialContract) =>
  isOrdinaryCommercialFlow(contract);

export const ordinaryFinancialActionsAllowed = (contract: OrdinaryCommercialContract, now = new Date()) => {
  if (!isNewOrdinaryCommercialFlow(contract)) return true;
  return (isCommerciallyFinal(contract) || hasSpecialCustomerCreditAuthorization(contract)) && !commercialDeadlinePassed(contract, now);
};

export class OrdinaryAccountingCommercialError extends Error {
  readonly status = 409;
  constructor(message = 'قرارداد باید قطعی باشد یا برای نسخه جاری، مجوز اعتباری مشتری خاص و تأیید فروش داشته باشد.') {
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
  await tx.$queryRaw(Prisma.sql`SELECT id FROM sales_contracts WHERE id = ${contractId} FOR UPDATE`);
  const contract = await tx.salesContract.findUnique({ where: { id: contractId } });
  if (!contract) throw new OrdinaryAccountingCommercialError('قرارداد پیدا نشد.');
  if (contract.customerCreditCustomerId) await lockCustomerCredit(tx, contract.customerCreditCustomerId);
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
