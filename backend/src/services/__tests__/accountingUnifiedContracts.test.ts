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
    receivables: [{ status: 'PARTIALLY_PAID', currency: 'IRT', paidAmount: { toString: () => '500000' }, remainingAmount: { toString: () => '1000000' } }],
    partnerContext: { caseNumber: 'PC-c27668a2-7578-4229-a060-b1f7639b627f', customerContractNumber: '100329',
      internalRecordNumber: 'PI-100329', debtor: { displayName: 'فروشنده همکار' },
      endCustomer: { displayName: 'مشتری نهایی' }, actionUrl: '/dashboard/accounting/invoice-candidates' } });
  assert.equal(row?.accounting.receivableStatus, 'PARTIALLY_PAID');
  assert.equal(row?.accounting.receivedAmount, '500000');
  assert.equal(row?.accounting.remainingAmount, '1000000');
});

test('Partner receivable amounts use their own currency before summing in the invoice currency', () => {
  const row = partnerAccountingContractRow({ id: 'mixed', status: 'ISSUED', amount: { toString: () => '2000' },
    currency: 'IRT', createdAt: new Date('2026-09-26T09:00:00Z'),
    receivables: [{ status: 'PARTIALLY_PAID', currency: 'IRR', paidAmount: { toString: () => '5000' }, remainingAmount: { toString: () => '15000' } }],
    partnerContext: { caseNumber: 'case', customerContractNumber: 'C', internalRecordNumber: 'I',
      debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' }, actionUrl: '/case' } });
  assert.equal(row?.accounting.receivedAmount, '500');
  assert.equal(row?.accounting.remainingAmount, '1500');
  assert.equal(row?.accounting.currency, 'IRT');
});

test('authorized writable partner draft enters work inbox with recorded source date', () => {
 const createdAt = new Date('2026-09-26T09:00:00Z');
 const row = partnerAccountingContractRow({ id: 'invoice-draft', status: 'DRAFT', amount: { toString: () => '1000' },
   currency: 'IRT', createdAt, partnerContext: { caseNumber: 'case', customerContractNumber: '100329',
   internalRecordNumber: 'PI-100329', debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' },
   actionUrl: '/case', accountingWritable: true, caseState: 'COMMITTED' } });
 assert.equal((row as any)?.attention?.reason, 'پیش‌نویس در انتظار بررسی مالی');
 assert.equal((row as any)?.attention?.waitingSince, createdAt);
});

test('a Partner blocker retains its actual owner and time before financial approval', () => {
  const createdAt = new Date('2026-09-26T09:00:00Z');
  const flagAt = new Date('2026-09-27T09:00:00Z');
  const row = partnerAccountingContractRow({ id: 'invoice-blocked', status: 'DRAFT', amount: { toString: () => '1000' },
    currency: 'IRT', createdAt, partnerFlags: [{ severity: 'BLOCKER', createdAt: flagAt, assignedToUserId: 'accountant', title: 'مغایرت مبلغ' }],
    partnerAssignees: { accountant: 'حسابدار' }, partnerContext: { caseNumber: 'case', customerContractNumber: '100329',
      internalRecordNumber: 'PI-100329', debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' },
      actionUrl: '/case', accountingWritable: true, caseState: 'COMMITTED' } });
  assert.equal(row?.attention?.reason, 'مغایرت مسدودکننده');
  assert.equal(row?.attention?.waitingSince, flagAt);
  assert.equal(row?.attention?.owner, 'حسابدار');
  assert.equal(row?.nextBestActions.find(action => action.kind === 'APPROVE_FINANCIAL_INVOICE')?.enabled, false);
});

test('a read-only Partner draft is not represented as an available approval task', () => {
  const row = partnerAccountingContractRow({ id: 'invoice-read-only', status: 'DRAFT', amount: { toString: () => '1000' },
    currency: 'IRT', createdAt: new Date(), partnerContext: { caseNumber: 'case', customerContractNumber: '100329',
      internalRecordNumber: 'PI-100329', debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' },
      actionUrl: '/case', accountingWritable: false, caseState: 'COMMITTED' } });
  assert.equal(row?.attention, null);
});

test('overdue partner receivables use Tehran civil-day boundary and exclude closed statuses', () => {
  const now = new Date('2026-11-02T09:00:00.000Z');
  const values = [
    { status: 'OPEN', currency: 'IRR', dueDate: new Date('2026-11-01T20:29:59Z'), paidAmount: { toString: () => '0' }, remainingAmount: { toString: () => '1000' } },
    { status: 'OPEN', currency: 'IRR', dueDate: new Date('2026-11-01T20:30:00Z'), paidAmount: { toString: () => '0' }, remainingAmount: { toString: () => '1000' } },
    { status: 'SETTLED', currency: 'IRR', dueDate: new Date('2026-10-01T00:00:00Z'), paidAmount: { toString: () => '1000' }, remainingAmount: { toString: () => '0' } },
  ];
  const row = partnerAccountingContractRow({ id: 'overdue', status: 'ISSUED', amount: { toString: () => '2000' },
    currency: 'IRR', createdAt: now, receivables: values, partnerContext: { caseNumber: 'case', customerContractNumber: 'C',
      internalRecordNumber: 'I', debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' }, actionUrl: '/case', accountingWritable: true } }, now);
  assert.equal(row?.attention?.reason, 'دریافتنی سررسیدگذشته');
  assert.equal(row?.attention?.waitingSince.toISOString(), values[0].dueDate.toISOString());
});
test('historical Persian currency aliases convert exactly without guessing unknown currencies', () => {
  const base = { id: 'alias', status: 'ISSUED', amount: { toString: () => '1000' }, currency: 'تومان', createdAt: new Date(),
    receivables: [{ status: 'OPEN', currency: 'ریال', dueDate: new Date('2026-11-01'), paidAmount: { toString: () => '1000' }, remainingAmount: { toString: () => '9000' } }],
    partnerContext: { caseNumber: 'case', customerContractNumber: 'C', internalRecordNumber: 'I', debtor: { displayName: 'همکار' }, endCustomer: { displayName: 'مشتری' }, actionUrl: '/case' } };
  const row = partnerAccountingContractRow(base);
  assert.equal(row?.accounting.receivedAmount, '100');
  assert.equal(row?.accounting.remainingAmount, '900');
  assert.equal(row?.accounting.currency, 'IRT');
  assert.throws(() => partnerAccountingContractRow({ ...base, currency: 'UNKNOWN' }));
});
