import { Prisma } from '@prisma/client';

export class CustomerCreditError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type CustomerCreditContract = {
  customerId?: string; customerCreditCustomerId?: string | null;
  commercialFlowVersion?: number; commercialRevision?: number;
  salesApprovalRevision?: number | null; customerCreditRevision?: number | null;
  customerCreditAmountRials?: Prisma.Decimal.Value;
  status: string; isInactive?: boolean; partnerKind?: string | null; partnerCaseId?: string | null;
};

/** Authorization is contract-owned evidence, never the customer's live category. */
export const hasSpecialCustomerCreditAuthorization = (contract: CustomerCreditContract) =>
  contract.commercialFlowVersion === 1 && !contract.partnerKind && !contract.partnerCaseId
  && !contract.isInactive && ['PENDING_APPROVAL', 'SIGNED'].includes(contract.status)
  && !!contract.customerCreditCustomerId && contract.customerCreditCustomerId === contract.customerId
  && contract.customerCreditRevision === contract.commercialRevision
  && contract.salesApprovalRevision === contract.commercialRevision
  && new Prisma.Decimal(contract.customerCreditAmountRials ?? 0).gt(0);

export const unpaidCustomerCredit = (credit: Prisma.Decimal.Value, obligation: Prisma.Decimal.Value, receipts: Prisma.Decimal.Value) =>
  Prisma.Decimal.max(0, Prisma.Decimal.min(new Prisma.Decimal(credit), new Prisma.Decimal(obligation).minus(receipts)));
