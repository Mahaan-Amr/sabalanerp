import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAccountingFinancialTrend,
  resolveFinancialTrendPeriods,
} from '../accountingFinancialTrend';

const now = new Date('2026-08-08T12:00:00.000Z');

test('financial trend periods use half-open Tehran Jalali boundaries and cut the current period off at now', () => {
  const monthly = resolveFinancialTrendPeriods('3m', now);
  assert.deepEqual(monthly.map((period) => period.key), ['1405-03', '1405-04', '1405-05']);
  assert.equal(monthly[2].startsAt.toISOString(), '2026-07-22T20:30:00.000Z');
  assert.equal(monthly[2].endsAt.toISOString(), now.toISOString());

  const daily = resolveFinancialTrendPeriods('1m', now);
  assert.equal(daily[0].key, '1405-05-01');
  assert.equal(daily.at(-1)?.key, '1405-05-17');
  assert.equal(daily.at(-1)?.endsAt.toISOString(), now.toISOString());
  assert.deepEqual(daily.filter((period) => period.marker).map((period) => period.day), [1, 8, 15]);
});

test('half-open buckets include their first instant and exclude the next boundary and future entries', () => {
  const result = buildAccountingFinancialTrend({
    range: '3m', now,
    invoices: [
      { id: 'at-start', contractId: 'c1', status: 'ISSUED', amount: 100, financiallyApprovedAt: now, systemInvoiceDate: new Date('2026-07-22T20:30:00.000Z'), createdAt: now },
      { id: 'before-start', contractId: 'c1', status: 'ISSUED', amount: 20, financiallyApprovedAt: now, systemInvoiceDate: new Date('2026-07-22T20:29:59.999Z'), createdAt: now },
      { id: 'future', contractId: 'c1', status: 'ISSUED', amount: 9_999, financiallyApprovedAt: now, systemInvoiceDate: new Date('2026-08-08T12:00:00.000Z'), createdAt: now },
    ],
    payments: [], auditEvents: [],
  });
  assert.equal(result.points.at(-1)?.invoicedRial, 100);
});

test('trend replays invoice, void, replacement, collection, clearance, and reversal movements on effective dates', () => {
  const result = buildAccountingFinancialTrend({
    range: '3m',
    now,
    invoices: [
      { id: 'issued', contractId: 'c1', status: 'VOIDED', amount: 1_000, financiallyApprovedAt: new Date('2026-06-01T08:00:00Z'), systemInvoiceDate: new Date('2026-06-01T08:00:00Z'), voidedAt: new Date('2026-07-01T08:00:00Z'), createdAt: new Date('2026-06-01T08:00:00Z') },
      { id: 'replacement', contractId: 'c1', status: 'ISSUED', amount: 1_200, financiallyApprovedAt: new Date('2026-07-05T08:00:00Z'), systemInvoiceDate: new Date('2026-06-20T08:00:00Z'), createdAt: new Date('2026-07-05T08:00:00Z') },
      { id: 'draft', contractId: 'c1', status: 'DRAFT', amount: 9_999, systemInvoiceDate: new Date('2026-08-01T08:00:00Z'), createdAt: new Date('2026-08-01T08:00:00Z') },
      { id: 'unapproved-replacement', contractId: 'c1', status: 'ISSUED', amount: 8_888, systemInvoiceDate: new Date('2026-08-01T08:00:00Z'), createdAt: new Date('2026-08-01T08:00:00Z') },
    ],
    payments: [
      { id: 'cash', contractId: 'c1', method: 'CASH', status: 'REVERSED', amount: 300, occurredAt: new Date('2026-06-02T08:00:00Z'), updatedAt: new Date('2026-07-02T08:00:00Z'), createdAt: new Date('2026-06-02T08:00:00Z'), metadata: { collectionMovements: [{ kind: 'RECEIVED', effectiveAt: '2026-06-02T08:00:00Z', amount: '300' }, { kind: 'REVERSED', effectiveAt: '2026-07-02T08:00:00Z', amount: '-300' }] } },
      { id: 'check', contractId: 'c1', method: 'CHECK', status: 'RECONCILED', checkStatus: 'BOUNCED', amount: 200, occurredAt: new Date('2026-07-04T08:00:00Z'), createdAt: new Date('2026-06-03T08:00:00Z'), metadata: { collectionMovements: [{ kind: 'CHECK_CLEARED', effectiveAt: '2026-06-03T08:00:00Z', amount: '200' }, { kind: 'CHECK_BOUNCED', effectiveAt: '2026-07-04T08:00:00Z', amount: '-200' }] } },
      { id: 'replacement-check', contractId: 'c1', method: 'CHECK', status: 'RECONCILED', checkStatus: 'CLEARED', amount: 250, occurredAt: new Date('2026-08-03T08:00:00Z'), createdAt: new Date('2026-08-01T08:00:00Z'), metadata: { collectionMovements: [{ kind: 'CHECK_CLEARED', effectiveAt: '2026-08-03T08:00:00Z', amount: '250' }] } },
    ],
    auditEvents: [],
  });

  assert.deepEqual(result.points.map((point) => [point.periodKey, point.invoicedRial, point.receivedRial, point.outstandingRial]), [
    ['1405-03', 2_200, 500, 1_700],
    ['1405-04', -1_000, -500, 1_200],
    ['1405-05', 0, 250, 950],
  ]);
});

test('outstanding is floored per contract, includes unallocated receipts, and excludes uninvoiced contracts', () => {
  const result = buildAccountingFinancialTrend({
    range: '1m', now,
    invoices: [
      { id: 'c1-invoice', contractId: 'c1', status: 'ISSUED', amount: 100, financiallyApprovedAt: new Date('2026-08-01T00:00:00Z'), systemInvoiceDate: new Date('2026-08-01T00:00:00Z'), createdAt: new Date('2026-08-01T00:00:00Z') },
      { id: 'c2-invoice', contractId: 'c2', status: 'ISSUED', amount: 200, financiallyApprovedAt: new Date('2026-08-01T00:00:00Z'), systemInvoiceDate: new Date('2026-08-01T00:00:00Z'), createdAt: new Date('2026-08-01T00:00:00Z') },
    ],
    payments: [
      { id: 'advance', contractId: 'c1', receivableId: null, method: 'BANK_TRANSFER', status: 'RECEIVED', amount: 150, occurredAt: new Date('2026-08-02T00:00:00Z'), createdAt: new Date('2026-08-02T00:00:00Z') },
      { id: 'c2-partial', contractId: 'c2', method: 'CARD', status: 'RECEIVED', amount: 50, occurredAt: new Date('2026-08-02T00:00:00Z'), createdAt: new Date('2026-08-02T00:00:00Z') },
      { id: 'no-invoice', contractId: 'c3', method: 'RECEIPT', status: 'RECEIVED', amount: 500, occurredAt: new Date('2026-08-02T00:00:00Z'), createdAt: new Date('2026-08-02T00:00:00Z') },
    ],
    auditEvents: [],
  });
  assert.equal(result.points.at(-1)?.outstandingRial, 150);
});

test('legacy event fallback is exposed and prefers audit time before creation time', () => {
  const result = buildAccountingFinancialTrend({
    range: '1m', now,
    invoices: [{ id: 'legacy', contractId: 'c1', status: 'ISSUED', amount: 100, financiallyApprovedAt: new Date('2026-08-02T00:00:00Z'), systemInvoiceDate: null, createdAt: new Date('2026-08-04T00:00:00Z') }],
    payments: [],
    auditEvents: [{ entityId: 'legacy', entityType: 'AccountingFinancialRecord', createdAt: new Date('2026-08-03T00:00:00Z') }],
  });
  const attributed = result.points.find((point) => point.invoicedRial === 100);
  assert.equal(attributed?.periodKey, '1405-05-12');
  assert.equal(attributed?.confidence, 'legacy-fallback');
  assert.equal(result.hasLegacyFallback, true);
});

test('legacy collection fallback prefers its dedicated occurrence, then audit, then creation timestamp', () => {
  const result = buildAccountingFinancialTrend({
    range: '1m', now,
    invoices: [{ id: 'invoice', contractId: 'c1', status: 'ISSUED', amount: 500, financiallyApprovedAt: new Date('2026-08-01T00:00:00Z'), systemInvoiceDate: new Date('2026-08-01T00:00:00Z'), createdAt: new Date('2026-08-01T00:00:00Z') }],
    payments: [
      { id: 'dedicated', contractId: 'c1', method: 'CASH', status: 'RECEIVED', amount: 100, occurredAt: new Date('2026-08-02T00:00:00Z'), createdAt: new Date('2026-08-06T00:00:00Z') },
      { id: 'audited', contractId: 'c1', method: 'CARD', status: 'RECEIVED', amount: 50, occurredAt: null, createdAt: new Date('2026-08-06T00:00:00Z') },
    ],
    auditEvents: [{ entityId: 'audited', entityType: 'AccountingPaymentStatus', createdAt: new Date('2026-08-03T00:00:00Z') }],
  });
  assert.equal(result.points.find((point) => point.periodKey === '1405-05-11')?.receivedRial, 100);
  assert.equal(result.points.find((point) => point.periodKey === '1405-05-12')?.receivedRial, 50);
});
