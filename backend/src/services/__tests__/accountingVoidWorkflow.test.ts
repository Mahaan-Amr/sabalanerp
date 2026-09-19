import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAccountingVoidWorkflow, validateAccountingVoidCaseStart } from '../accountingVoidWorkflow';

const baseCase = {
  id: 'case-1',
  status: 'OPEN' as const,
  sourceRecordId: 'invoice-1406',
  reasonKind: 'DUPLICATE_ISSUE' as const,
  reason: 'صدور تکراری',
  effectiveAt: new Date('2026-09-19T00:00:00.000Z'),
  retainedRecordId: 'invoice-1405',
  startedAt: new Date('2026-09-19T00:00:00.000Z'),
};

test('guides the manager through receipts, receivable, then invoice without cascading', () => {
  const withReceipt = buildAccountingVoidWorkflow({
    voidCase: baseCase,
    sourceRecord: { id: 'invoice-1406', status: 'ISSUED' },
    receivables: [{ id: 'receivable-1', status: 'PARTIALLY_PAID', paidAmount: '100', remainingAmount: '900' }],
    payments: [{ id: 'payment-1', receivableId: 'receivable-1', method: 'CASH', status: 'RECEIVED', checkStatus: null }],
    taxRecords: [],
  });
  assert.equal(withReceipt.nextAction?.kind, 'REVERSE_RECEIPT');
  assert.equal(withReceipt.steps[0].messageFa, 'ابتدا دریافت ثبت‌شده را برگشت بزنید.');
  assert.equal(withReceipt.steps[2].state, 'WAITING');

  const readyForReceivable = buildAccountingVoidWorkflow({
    voidCase: baseCase,
    sourceRecord: { id: 'invoice-1406', status: 'ISSUED' },
    receivables: [{ id: 'receivable-1', status: 'OPEN', paidAmount: '0', remainingAmount: '1000' }],
    payments: [{ id: 'payment-1', receivableId: 'receivable-1', method: 'CASH', status: 'REVERSED', checkStatus: null }],
    taxRecords: [],
  });
  assert.equal(readyForReceivable.nextAction?.kind, 'VOID_RECEIVABLE');

  const readyForInvoice = buildAccountingVoidWorkflow({
    voidCase: baseCase,
    sourceRecord: { id: 'invoice-1406', status: 'ISSUED' },
    receivables: [{ id: 'receivable-1', status: 'VOIDED', paidAmount: '0', remainingAmount: '1000' }],
    payments: [{ id: 'payment-1', receivableId: 'receivable-1', method: 'CASH', status: 'REVERSED', checkStatus: null }],
    taxRecords: [],
  });
  assert.equal(readyForInvoice.nextAction?.kind, 'VOID_FINANCIAL_RECORD');
});

test('explains check and submitted-tax blockers in simple Persian', () => {
  const workflow = buildAccountingVoidWorkflow({
    voidCase: baseCase,
    sourceRecord: { id: 'invoice-1406', status: 'ISSUED' },
    receivables: [{ id: 'receivable-1', status: 'OPEN', paidAmount: '0', remainingAmount: '1000' }],
    payments: [{ id: 'check-1', receivableId: 'receivable-1', method: 'CHECK', status: 'RECEIVED', checkStatus: 'DEPOSITED' }],
    taxRecords: [{ id: 'tax-1', submissionStatus: 'SUBMITTED_EXTERNALLY' }],
  });
  assert.equal(workflow.nextAction?.kind, 'RETURN_CHECK');
  assert(workflow.blockers.some(item => item.messageFa === 'چک واگذارشده را ابتدا عودت دهید.'));
  assert(workflow.blockers.some(item => item.messageFa === 'سابقه مالیاتی ارسال‌شده باید ابتدا اصلاح و تعیین‌تکلیف شود.'));
});

test('treats a tax record that was submitted and rejected as requiring resolution', () => {
  const workflow = buildAccountingVoidWorkflow({
    voidCase: baseCase,
    sourceRecord: { id: 'invoice-1406', status: 'ISSUED' },
    receivables: [{ id: 'receivable-1', status: 'VOIDED', paidAmount: '0', remainingAmount: '1000' }],
    payments: [],
    taxRecords: [{ id: 'tax-1', submissionStatus: 'REJECTED' }],
  });
  assert.equal(workflow.nextAction?.kind, 'RESOLVE_TAX');
  assert.equal(workflow.nextAction?.labelFa, 'تعیین‌تکلیف مالیات');
});

test('allows cancellation only before the first downstream financial change', () => {
  const untouched = buildAccountingVoidWorkflow({
    voidCase: baseCase,
    sourceRecord: { id: 'invoice-1406', status: 'ISSUED' },
    receivables: [{ id: 'receivable-1', status: 'OPEN', paidAmount: '0', remainingAmount: '1000' }],
    payments: [],
    taxRecords: [],
  });
  assert.equal(untouched.canCancel, true);

  const changed = buildAccountingVoidWorkflow({
    voidCase: baseCase,
    sourceRecord: { id: 'invoice-1406', status: 'ISSUED' },
    receivables: [{ id: 'receivable-1', status: 'VOIDED', paidAmount: '0', remainingAmount: '1000', metadata: { voidCaseId: baseCase.id } }],
    payments: [],
    taxRecords: [],
  });
  assert.equal(changed.canCancel, false);

  const historicalReversal = buildAccountingVoidWorkflow({
    voidCase: baseCase,
    sourceRecord: { id: 'invoice-1406', status: 'ISSUED' },
    receivables: [{ id: 'receivable-1', status: 'OPEN', paidAmount: '0', remainingAmount: '1000' }],
    payments: [{ id: 'payment-1', receivableId: 'receivable-1', method: 'CASH', status: 'REVERSED', checkStatus: null }],
    taxRecords: [],
  });
  assert.equal(historicalReversal.canCancel, true);
});

test('duplicate issuance requires a different valid invoice from the same contract', () => {
  assert.throws(() => validateAccountingVoidCaseStart({
    sourceRecord: { id: 'invoice-1406', contractId: 'contract-1', status: 'ISSUED', createdAt: new Date('2026-09-10') },
    retainedRecord: null,
    reasonKind: 'DUPLICATE_ISSUE', reason: 'صدور تکراری', effectiveAt: new Date('2026-09-19'), now: new Date('2026-09-19'),
  }), /فاکتور معتبر باقی‌مانده/);
  assert.throws(() => validateAccountingVoidCaseStart({
    sourceRecord: { id: 'invoice-1406', contractId: 'contract-1', status: 'ISSUED', createdAt: new Date('2026-09-10') },
    retainedRecord: { id: 'invoice-1405', contractId: 'contract-2', status: 'ISSUED' },
    reasonKind: 'DUPLICATE_ISSUE', reason: 'صدور تکراری', effectiveAt: new Date('2026-09-19'), now: new Date('2026-09-19'),
  }), /همان قرارداد/);
  assert.doesNotThrow(() => validateAccountingVoidCaseStart({
    sourceRecord: { id: 'invoice-1406', contractId: 'contract-1', status: 'ISSUED', createdAt: new Date('2026-09-10') },
    retainedRecord: { id: 'invoice-1405', contractId: 'contract-1', status: 'ISSUED' },
    reasonKind: 'DUPLICATE_ISSUE', reason: 'صدور تکراری', effectiveAt: new Date('2026-09-19'), now: new Date('2026-09-19'),
  }));
});

test('effective void date cannot precede the source record or be in the future', () => {
  const sourceRecord = { id: 'invoice-1406', contractId: 'contract-1', status: 'ISSUED', createdAt: new Date('2026-09-10') };
  assert.throws(() => validateAccountingVoidCaseStart({ sourceRecord, retainedRecord: null,
    reasonKind: 'OTHER', reason: 'اشتباه ثبت', effectiveAt: new Date('2026-09-09'), now: new Date('2026-09-19') }), /پیش از تاریخ/);
  assert.throws(() => validateAccountingVoidCaseStart({ sourceRecord, retainedRecord: null,
    reasonKind: 'OTHER', reason: 'اشتباه ثبت', effectiveAt: new Date('2026-09-20'), now: new Date('2026-09-19') }), /آینده/);
});
