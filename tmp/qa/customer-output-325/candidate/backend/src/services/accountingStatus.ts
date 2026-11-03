import { AccountingRecordStatus, FinancialRecordKind } from '@prisma/client';

type FinancialRecordStatusInput = {
  kind: FinancialRecordKind;
  status: AccountingRecordStatus;
};

export const isValidFinanciallyApprovedInvoice = (record: FinancialRecordStatusInput) => (
  record.kind === FinancialRecordKind.INVOICE_CANDIDATE &&
  (record.status === AccountingRecordStatus.ISSUED || record.status === AccountingRecordStatus.POSTED)
);

export const isOpenInvoiceCandidate = (record: FinancialRecordStatusInput) => (
  record.kind === FinancialRecordKind.INVOICE_CANDIDATE &&
  record.status !== AccountingRecordStatus.ISSUED &&
  record.status !== AccountingRecordStatus.POSTED &&
  record.status !== AccountingRecordStatus.VOIDED
);

export const classifyInvoiceStatus = (records: FinancialRecordStatusInput[]) => (
  records.some(isValidFinanciallyApprovedInvoice)
    ? 'ISSUED'
    : records.some(isOpenInvoiceCandidate)
      ? 'DRAFT'
      : 'NONE'
);
