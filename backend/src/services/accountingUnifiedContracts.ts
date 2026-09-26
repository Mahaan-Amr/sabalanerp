import { Prisma } from '@prisma/client';

export type PartnerAccountingListSource = {
  id: string; status: string; amount: { toString(): string }; currency: string; createdAt: Date;
  receivables?: readonly { status: string; paidAmount: { toString(): string }; remainingAmount: { toString(): string } }[];
  partnerContext?: { caseNumber: string; customerContractNumber: string; internalRecordNumber: string;
    debtor: { displayName: string }; actionUrl: string };
};

/** A committed internal sale is a financial source, never the Partner's private retail contract. */
export function partnerAccountingContractRow(record: PartnerAccountingListSource) {
  const context = record.partnerContext;
  if (!context) return null;
  const amount = record.amount.toString();
  const receivables = record.receivables ?? [];
  const receivedAmount = receivables.reduce((sum, receivable) => sum.plus(receivable.paidAmount.toString()), new Prisma.Decimal(0)).toString();
  const remainingAmount = record.receivables?.length
    ? receivables.reduce((sum, receivable) => sum.plus(receivable.remainingAmount.toString()), new Prisma.Decimal(0)).toString()
    : amount;
  const receivableStatus = receivables.length === 0 ? 'NONE' : receivables.length === 1 ? receivables[0].status
    : new Prisma.Decimal(remainingAmount).isZero() ? 'SETTLED' : new Prisma.Decimal(receivedAmount).gt(0) ? 'PARTIALLY_PAID' : 'OPEN';
  const approved = ['ISSUED', 'POSTED'].includes(record.status);
  return {
    contractId: `partner:${record.id}`, contractNumber: context.customerContractNumber,
    titlePersian: 'فروش سبلان به همکار', contractDate: record.createdAt, createdAt: record.createdAt,
    customer: { displayName: context.debtor.displayName }, status: 'COMMITTED',
    sourceKind: 'PARTNER_INTERNAL_RECORD', partnerContext: context,
    financialRecords: [{ id: record.id, kind: 'INVOICE_CANDIDATE', status: record.status,
      amount, currency: record.currency, createdAt: record.createdAt }],
    accounting: { sourceStatus: approved ? 'HAS_FINANCIAL_RECORDS' : 'ELIGIBLE', eligibleForFinancialRecords: !approved,
      invoiceStatus: record.status, receivableStatus, taxStatus: 'NOT_APPLICABLE',
      openFlags: 0, openBlockerFlags: 0, openCorrections: 0,
      totalContractAmount: amount, invoicedAmount: approved ? amount : '0', receivedAmount, remainingAmount,
      currency: record.currency },
    nextBestActions: [{ kind: 'APPROVE_FINANCIAL_INVOICE', labelFa: 'تأیید مالی',
      enabled: record.status === 'DRAFT', reason: record.status === 'DRAFT' ? null : 'این سند قبلاً بررسی شده است.' }],
  };
}
