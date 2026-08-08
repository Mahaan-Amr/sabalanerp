import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalizeContractsQuery,
  canonicalizeInvoiceCandidatesQuery,
  patchContractsQuery,
  patchInvoiceCandidatesQuery,
} from '../accountingQueryState';

test('contract query canonicalization preserves unknown parameters and removes invalid recognized values', () => {
  const result = canonicalizeContractsQuery(new URLSearchParams(
    'view=unknown&status=NOPE&sourceStatus=ALL&page=1&pageSize=200&sort=attention&dateFrom=2026-02-30&campaign=summer',
  ));

  assert.equal(result.params.toString(), 'campaign=summer');
  assert.deepEqual(result.state, {
    view: null,
    search: '',
    status: 'ALL',
    sourceStatus: 'ALL',
    dateFrom: '',
    dateTo: '',
    page: 1,
  });
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
