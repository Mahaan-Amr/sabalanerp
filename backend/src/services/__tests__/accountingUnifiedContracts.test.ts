import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerAccountingContractRow } from '../accountingUnifiedContracts';

test('cancelled Partner contract stays cancelled in Accounting despite retained financial history', () => {
  const source = { id: 'voided-history', status: 'VOIDED', amount: { toString: () => '200' },
    currency: 'IRT', createdAt: new Date(), partnerContext: {
      caseNumber: 'case', customerContractNumber: '100634', internalRecordNumber: 'internal',
      debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' }, actionUrl: '/case',
      caseState: 'VOIDED', commercialStatus: 'CANCELLED', accountingWritable: false,
    } };
  const row = partnerAccountingContractRow(source);
  assert.equal(row?.status, 'CANCELLED');
  assert.equal(row?.accounting.eligibleForFinancialRecords, false);
  assert.equal(row?.nextBestActions.find(action => action.kind === 'CREATE_CORRECTION_REQUEST')?.enabled, true);
});

test('Accounting list shows the end customer while preserving the internal debtor and amount', () => {
  const record = partnerAccountingContractRow({ id: 'invoice-1', status: 'DRAFT', amount: { toString: () => '1500000' },
    currency: 'IRT', createdAt: new Date('2026-09-26T09:00:00Z'), contractDate: '2026-10-06', partnerContext: {
      caseNumber: 'PC-c27668a2-7578-4229-a060-b1f7639b627f', customerContractNumber: '100329', internalRecordNumber: 'PI-100329',
      debtor: { displayName: 'فروشنده همکار' }, endCustomer: { displayName: 'مشتری نهایی' },
      actionUrl: '/dashboard/accounting/invoice-candidates?search=case',
    } });
  assert.ok(record);
  assert.equal(record.contractNumber, '100329');
  assert.equal(record.contractDate, '2026-10-06', 'edited business date is independent of source creation time');
  assert.equal(record.customer.displayName, 'مشتری نهایی');
  assert.equal(record.partnerContext.debtor.displayName, 'فروشنده همکار');
  assert.equal(record.accounting.currency, 'IRT');
  assert.equal(record.financialRecords[0].id, 'invoice-1');
  assert.equal(JSON.stringify(record).includes('PI-100329'), true);
  assert.equal(JSON.stringify(record).includes('retail'), false);
});

test('approved Partner receivable contributes actual paid and remaining amounts', () => {
  const row = partnerAccountingContractRow({ id: 'invoice-2', status: 'ISSUED', amount: { toString: () => '1500000' },
    currency: 'IRT', createdAt: new Date('2026-09-26T09:00:00Z'),
    receivables: [{ status: 'PARTIALLY_PAID', paidAmount: { toString: () => '500000' }, remainingAmount: { toString: () => '1000000' } }],
    partnerContext: { caseNumber: 'PC-c27668a2-7578-4229-a060-b1f7639b627f', customerContractNumber: '100329',
      internalRecordNumber: 'PI-100329', debtor: { displayName: 'فروشنده همکار' },
      endCustomer: { displayName: 'مشتری نهایی' }, actionUrl: '/dashboard/accounting/invoice-candidates' } });
  assert.equal(row?.accounting.receivableStatus, 'PARTIALLY_PAID');
  assert.equal(row?.accounting.receivedAmount, '500000');
  assert.equal(row?.accounting.remainingAmount, '1000000');
});
