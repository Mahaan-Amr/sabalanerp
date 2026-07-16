import assert from 'node:assert/strict';
import { AccountingRecordStatus, FinancialRecordKind } from '@prisma/client';
import { classifyInvoiceStatus, isValidFinanciallyApprovedInvoice } from '../accountingStatus';

const invoice = (status: AccountingRecordStatus) => ({
  kind: FinancialRecordKind.INVOICE_CANDIDATE,
  status
});

assert.equal(classifyInvoiceStatus([]), 'NONE');
assert.equal(classifyInvoiceStatus([invoice(AccountingRecordStatus.DRAFT)]), 'DRAFT');
assert.equal(classifyInvoiceStatus([invoice(AccountingRecordStatus.VOIDED)]), 'NONE');
assert.equal(classifyInvoiceStatus([invoice(AccountingRecordStatus.ISSUED)]), 'ISSUED');
assert.equal(classifyInvoiceStatus([invoice(AccountingRecordStatus.POSTED)]), 'ISSUED');
assert.equal(
  classifyInvoiceStatus([
    invoice(AccountingRecordStatus.VOIDED),
    invoice(AccountingRecordStatus.DRAFT)
  ]),
  'DRAFT'
);
assert.equal(isValidFinanciallyApprovedInvoice(invoice(AccountingRecordStatus.VOIDED)), false);
assert.equal(isValidFinanciallyApprovedInvoice(invoice(AccountingRecordStatus.ISSUED)), true);

console.log('accountingStatus tests passed');
