import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeAuditQuery,
  canonicalizeAccountingDashboardQuery,
  canonicalizeContractsQuery,
  canonicalizeCorrectionRequestsQuery,
  canonicalizeInvoiceCandidatesQuery,
  canonicalizePaymentsQuery,
  canonicalizePerformanceQuery,
  canonicalizeReceivablesQuery,
  canonicalizeTaxQuery,
  patchAuditQuery,
  patchAccountingDashboardQuery,
  patchContractsQuery,
  patchCorrectionRequestsQuery,
  patchInvoiceCandidatesQuery,
  patchPaymentsQuery,
  patchPerformanceQuery,
  patchReceivablesQuery,
  patchTaxQuery,
} from '../accountingQueryState';

test('accounting dashboard deadline query keeps the bucket and omits the default all type', () => {
  const combined = canonicalizeAccountingDashboardQuery(new URLSearchParams(
    'due=next7&deadlineType=all&campaign=summer',
  ));
  const receivables = patchAccountingDashboardQuery(combined.params, { deadlineType: 'receivable' });
  const nextBucket = patchAccountingDashboardQuery(receivables.params, { due: 'days8to30' });

  assert.equal(combined.params.toString(), 'campaign=summer&due=next7');
  assert.deepEqual(combined.state, { due: 'next7', deadlineType: 'all' });
  assert.equal(receivables.params.toString(), 'campaign=summer&due=next7&deadlineType=receivable');
  assert.equal(nextBucket.params.toString(), 'campaign=summer&due=days8to30&deadlineType=receivable');
});

test('accounting dashboard removes invalid deadline values without dropping unknown parameters', () => {
  const result = canonicalizeAccountingDashboardQuery(new URLSearchParams(
    'due=today&deadlineType=invoice&page=3&campaign=summer',
  ));

  assert.equal(result.params.toString(), 'page=3&campaign=summer');
  assert.deepEqual(result.state, { due: '', deadlineType: 'all' });
});

test('contract query canonicalization preserves unknown parameters and removes invalid recognized values', () => {
  const result = canonicalizeContractsQuery(new URLSearchParams(
    'view=unknown&status=NOPE&sourceStatus=ALL&page=1&pageSize=200&sort=attention&dateFrom=2026-02-30&campaign=summer',
  ));

  assert.equal(result.params.toString(), 'campaign=summer');
  assert.deepEqual(result.state, {
    view: null,
    lifecycleView: 'active',
    search: '',
    status: 'ALL',
    sourceStatus: 'ALL',
    dateFrom: '',
    dateTo: '',
    page: 1,
  });
});

test('contract lifecycle views are canonical and reset pagination when changed', () => {
  const inactive = canonicalizeContractsQuery(new URLSearchParams('lifecycleView=inactive&page=2'));
  const pending = patchContractsQuery(inactive.params, { lifecycleView: 'pending' });

  assert.equal(inactive.params.toString(), 'lifecycleView=inactive&page=2');
  assert.equal(inactive.state.lifecycleView, 'inactive');
  assert.equal(pending.params.toString(), 'lifecycleView=pending');
  assert.equal(pending.state.lifecycleView, 'pending');
});

test('status takes precedence over semantic view and remains the established enum filter', () => {
  const contracts = canonicalizeContractsQuery(new URLSearchParams('view=reviewable&status=SIGNED'));
  const invoices = canonicalizeInvoiceCandidatesQuery(new URLSearchParams(
    'view=actionable&status=VOIDED&period=2026-08',
  ));

  assert.equal(contracts.params.toString(), 'status=SIGNED');
  assert.equal(invoices.params.toString(), 'status=VOIDED');
  assert.equal(contracts.state.view, null);
  assert.equal(invoices.state.view, null);
});

test('filter changes replace canonical values and reset pagination without dropping unknown parameters', () => {
  const contracts = patchContractsQuery(
    new URLSearchParams('view=reviewable&page=4&campaign=summer'),
    { sourceStatus: 'ELIGIBLE' },
  );
  const invoices = patchInvoiceCandidatesQuery(
    new URLSearchParams('view=actionable&page=3&campaign=summer'),
    { status: 'READY' },
  );

  assert.equal(contracts.params.toString(), 'campaign=summer&view=reviewable&sourceStatus=ELIGIBLE');
  assert.equal(invoices.params.toString(), 'campaign=summer&status=READY');
});

test('every manual status change removes the semantic view, including a change back to the default', () => {
  const contracts = patchContractsQuery(
    new URLSearchParams('view=reviewable&page=3'),
    { status: 'ALL' },
  );
  const invoices = patchInvoiceCandidatesQuery(
    new URLSearchParams('view=actionable&page=3'),
    { status: 'ALL' },
  );

  assert.equal(contracts.params.toString(), '');
  assert.equal(invoices.params.toString(), '');
});

test('search and manual dates use their canonical representations', () => {
  const result = patchContractsQuery(
    new URLSearchParams('page=8&source=dashboard'),
    { search: '  AC-104  ', dateFrom: '2026-08-08', dateTo: '2026-08-09' },
  );

  assert.equal(result.state.search, 'AC-104');
  assert.equal(result.state.page, 1);
  assert.equal(result.params.toString(), 'source=dashboard&search=AC-104&dateFrom=2026-08-08&dateTo=2026-08-09');
});

test('invoiced period is canonical only for the invoiced semantic view', () => {
  const invoiced = canonicalizeInvoiceCandidatesQuery(new URLSearchParams('view=invoiced&period=1405-05'));
  const orphaned = canonicalizeInvoiceCandidatesQuery(new URLSearchParams('period=1405-05'));

  assert.equal(invoiced.params.toString(), 'view=invoiced&period=1405-05');
  assert.equal(orphaned.params.toString(), '');
  assert.equal(canonicalizeInvoiceCandidatesQuery(new URLSearchParams('view=invoiced&period=2026-08')).params.toString(), 'view=invoiced');
});

test('daily trend drilldowns retain an exact Jalali day only inside their represented period', () => {
  const cutoff = '2026-08-01T12%3A00%3A00.000Z';
  const invoice = canonicalizeInvoiceCandidatesQuery(new URLSearchParams(`view=invoiced&period=1405-05&date=1405-05-10&cutoff=${cutoff}`));
  const received = canonicalizePaymentsQuery(new URLSearchParams('view=received&period=1405-05&date=1405-05-10'));
  const outstanding = canonicalizeReceivablesQuery(new URLSearchParams('view=outstanding&period=1405-05&date=1405-05-10'));
  assert.equal(invoice.params.toString(), `view=invoiced&period=1405-05&date=1405-05-10&cutoff=${cutoff}`);
  assert.equal(received.params.toString(), 'view=received&period=1405-05&date=1405-05-10');
  assert.equal(outstanding.params.toString(), 'view=outstanding&period=1405-05&date=1405-05-10');
  assert.equal(canonicalizePaymentsQuery(new URLSearchParams('view=received&period=1405-05&date=1405-04-10')).state.date, '');
  assert.equal(canonicalizePaymentsQuery(new URLSearchParams('view=received&period=1404-12&date=1404-12-30')).state.date, '');
  assert.equal(canonicalizePaymentsQuery(new URLSearchParams('view=received&period=1403-12&date=1403-12-30')).state.date, '1403-12-30');
});

test('collection register queries canonicalize semantic views, due buckets, focus, and unknown parameters', () => {
  const receivables = canonicalizeReceivablesQuery(new URLSearchParams(
    'view=open&due=next7&period=1405-05&recordId= legacy-receivable &page=1&campaign=summer',
  ));
  const payments = canonicalizePaymentsQuery(new URLSearchParams(
    'view=received&due=days8to30&period=1405-05&recordId=legacy-payment&page=2&campaign=summer',
  ));

  assert.equal(receivables.params.toString(), 'campaign=summer&view=open&due=next7&recordId=legacy-receivable');
  assert.equal(payments.params.toString(), 'campaign=summer&view=received&due=days8to30&period=1405-05&recordId=legacy-payment&page=2');
  assert.equal(receivables.state.period, '');
  assert.equal(payments.state.period, '1405-05');
});

test('collection status takes precedence and filter changes reset pagination without changing focus population', () => {
  const receivables = patchReceivablesQuery(
    new URLSearchParams('view=open&due=overdue&recordId=receivable-1&page=4&source=dashboard'),
    { status: 'SETTLED' },
  );
  const payments = patchPaymentsQuery(
    new URLSearchParams('view=unsettled-checks&due=next7&recordId=payment-1&page=3&source=dashboard'),
    { status: 'CLEARED' },
  );

  assert.equal(receivables.params.toString(), 'source=dashboard&due=overdue&recordId=receivable-1&status=SETTLED');
  assert.equal(payments.params.toString(), 'source=dashboard&due=next7&recordId=payment-1&status=CLEARED');
});

test('invalid collection parameters and defaults are removed while due today remains canonical', () => {
  const receivables = canonicalizeReceivablesQuery(new URLSearchParams(
    'view=nope&due=today&status=ALL&period=2026-08&recordId=%20&page=-1&source=dashboard',
  ));
  const payments = canonicalizePaymentsQuery(new URLSearchParams(
    'view=due-soon&due=next7&status=ALL&period=1405-05&pageSize=100&source=dashboard',
  ));

  assert.equal(receivables.params.toString(), 'source=dashboard');
  assert.equal(payments.params.toString(), 'source=dashboard&view=due-soon&due=next7');
});

test('operational drilldown views initialize canonical filters and status takes precedence', () => {
  const tax = canonicalizeTaxQuery(new URLSearchParams('view=needs-attention&campaign=summer'));
  const corrections = canonicalizeCorrectionRequestsQuery(new URLSearchParams('view=active'));

  assert.equal(tax.params.toString(), 'campaign=summer&view=needs-attention');
  assert.equal(tax.state.status, 'ALL');
  assert.equal(corrections.params.toString(), 'view=active');
  assert.equal(corrections.state.status, 'ALL');
  assert.equal(canonicalizeTaxQuery(new URLSearchParams(
    'view=needs-attention&status=READY',
  )).params.toString(), 'status=READY');
  assert.equal(canonicalizeCorrectionRequestsQuery(new URLSearchParams(
    'view=active&status=ACKNOWLEDGED',
  )).params.toString(), 'status=ACKNOWLEDGED');
});

test('operational register changes reset page, preserve unknown parameters, and trim search', () => {
  const tax = patchTaxQuery(
    new URLSearchParams('view=needs-attention&page=4&campaign=summer'),
    { search: '  invoice  ' },
  );
  const corrections = patchCorrectionRequestsQuery(
    new URLSearchParams('view=active&page=3&campaign=summer'),
    { status: 'ACKNOWLEDGED' },
  );
  const audit = patchAuditQuery(
    new URLSearchParams('page=8&campaign=summer'),
    { action: 'CREATE_INVOICE' },
  );

  assert.equal(tax.params.toString(), 'campaign=summer&view=needs-attention&search=invoice');
  assert.equal(corrections.params.toString(), 'campaign=summer&status=ACKNOWLEDGED');
  assert.equal(audit.params.toString(), 'campaign=summer&action=CREATE_INVOICE');
});

test('manual performance range replaces last-30-days view with canonical dates', () => {
  const result = patchPerformanceQuery(
    new URLSearchParams('view=last30days&page=3&campaign=summer'),
    { dateFrom: '2026-08-08', dateTo: '2026-08-09' },
  );

  assert.equal(result.params.toString(), 'campaign=summer&dateFrom=2026-08-08&dateTo=2026-08-09');
  assert.deepEqual(result.state, {
    view: null,
    search: '',
    dateFrom: '2026-08-08',
    dateTo: '2026-08-09',
    page: 1,
  });
  assert.equal(canonicalizePerformanceQuery(new URLSearchParams(
    'view=invalid&dateFrom=2026-02-30&page=1&campaign=summer',
  )).params.toString(), 'campaign=summer');
});

test('operational queries remove invalid defaults without dropping unknown parameters', () => {
  const tax = canonicalizeTaxQuery(new URLSearchParams(
    'view=invalid&status=ALL&page=1&pageSize=100&campaign=summer',
  ));
  const corrections = canonicalizeCorrectionRequestsQuery(new URLSearchParams(
    'view=invalid&status=NOPE&page=-1&campaign=summer',
  ));
  const audit = canonicalizeAuditQuery(new URLSearchParams(
    'action=NOPE&page=1&pageSize=100&campaign=summer',
  ));

  assert.equal(tax.params.toString(), 'campaign=summer');
  assert.equal(corrections.params.toString(), 'campaign=summer');
  assert.equal(audit.params.toString(), 'campaign=summer');
});
