import { Prisma } from '@prisma/client';

export type PartnerAccountingListSource = {
  id: string; status: string; amount: { toString(): string }; currency: string; createdAt: Date;
  contractDate?: string | Date;
  receivables?: readonly { status: string; paidAmount: { toString(): string }; remainingAmount: { toString(): string } }[];
  partnerFlags?: readonly { severity: string }[];
  partnerOpenCorrections?: number;
  partnerContext?: { caseNumber: string; trackingNumber?: number; customerContractNumber: string; internalRecordNumber: string;
    debtor: { displayName: string }; endCustomer: { displayName: string }; actionUrl: string;
    accountingWritable?: boolean; caseState?: string; commercialStatus?: string };
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
    titlePersian: 'فروش سبلان به همکار', contractDate: record.contractDate ?? record.createdAt, createdAt: record.createdAt,
    customer: { displayName: context.endCustomer.displayName },
    status: context.commercialStatus ? ({ NOTE: 'DRAFT', DRAFT: 'PENDING_APPROVAL', CUSTOMER_SIGNED: 'APPROVED', QUOTED: 'QUOTED', FINAL: 'SIGNED', EXPIRED: 'EXPIRED', CANCELLED: 'CANCELLED' } as Record<string, string>)[context.commercialStatus]
      : ['CANCELLED', 'VOIDED'].includes(context.caseState || '') ? 'CANCELLED' : 'SIGNED',
    sourceKind: 'PARTNER_INTERNAL_RECORD', partnerContext: context,
    financialRecords: [{ id: record.id, kind: 'INVOICE_CANDIDATE', status: record.status,
      amount, currency: record.currency, createdAt: record.createdAt }],
    accounting: { sourceStatus: approved ? 'HAS_FINANCIAL_RECORDS' : 'ELIGIBLE', eligibleForFinancialRecords: context.accountingWritable === true && !approved,
      invoiceStatus: record.status, receivableStatus, taxStatus: 'NOT_APPLICABLE',
      openFlags: record.partnerFlags?.length ?? 0,
      openBlockerFlags: record.partnerFlags?.filter(flag => flag.severity === 'BLOCKER').length ?? 0,
      openCorrections: record.partnerOpenCorrections ?? 0,
      totalContractAmount: amount, invoicedAmount: approved ? amount : '0', receivedAmount, remainingAmount,
      currency: record.currency },
    nextBestActions: [{ kind: 'APPROVE_FINANCIAL_INVOICE', labelFa: 'تأیید مالی',
      enabled: record.status === 'DRAFT' && !record.partnerFlags?.some(flag => flag.severity === 'BLOCKER')
        && !record.partnerOpenCorrections,
      reason: record.partnerFlags?.some(flag => flag.severity === 'BLOCKER') ? 'ابتدا پرچم مسدودکننده را بررسی کنید.'
        : record.partnerOpenCorrections ? 'ابتدا درخواست اصلاح باز را تکمیل کنید.'
        : record.status === 'DRAFT' ? null : 'این سند قبلاً بررسی شده است.' },
    { kind: 'FLAG_CONTRACT', labelFa: 'پرچم حسابداری', enabled: context.accountingWritable === true,
      reason: context.accountingWritable ? null : 'مجوز ثبت پرچم برای این پرونده فعال نیست.' },
    { kind: 'CREATE_CORRECTION_REQUEST', labelFa: 'درخواست اصلاح', enabled: ['COMMITTED', 'VOIDED'].includes(context.caseState || ''),
      reason: ['COMMITTED', 'VOIDED'].includes(context.caseState || '') ? null : 'مجوز درخواست اصلاح برای این پرونده فعال نیست.' }],
  };
}
