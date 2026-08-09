import assert from 'node:assert/strict';
import test from 'node:test';
import {
  failFinancialTrend,
  financialTrendToman,
  pendingFinancialTrend,
  resolveFinancialTrend,
} from './accountingFinancialTrendState';

const data = {
  range: '3m' as const,
  currency: 'RIAL' as const,
  hasLegacyFallback: false,
  points: [{
    periodKey: '1405-05', monthKey: '1405-05', label: 'مرداد', marker: true,
    startsAt: '2026-07-22T20:30:00.000Z', endsAt: '2026-08-08T12:00:00.000Z',
    invoicedRial: 12_345_670, receivedRial: 4_000_000, outstandingRial: 8_345_670,
    confidence: 'authoritative' as const,
    destinations: { invoiced: '/invoices', received: '/payments', outstanding: '/receivables' },
  }],
};

test('chart presentation converts API Rial values to Toman without changing source data', () => {
  assert.equal(financialTrendToman(data.points[0].invoicedRial), 1_234_567);
  assert.equal(data.points[0].invoicedRial, 12_345_670);
});
test('refresh failure retains the last successful trend and marks it stale', () => {
  const successful = resolveFinancialTrend(pendingFinancialTrend(), data);
  const stale = failFinancialTrend(successful);
  assert.equal(stale.data, data);
  assert.equal(stale.status, 'stale');
});

test('initial failure is an error instead of a fictional empty view', () => {
  const failed = failFinancialTrend(pendingFinancialTrend());
  assert.equal(failed.data, null);
  assert.equal(failed.status, 'error');
});

test('range switching never relabels prior-range data as the newly requested range', () => {
  const successful = resolveFinancialTrend(pendingFinancialTrend(), data);
  const switching = pendingFinancialTrend(successful, '1m');
  assert.equal(switching.data, null);
  assert.equal(pendingFinancialTrend(successful, '3m').data, data);
});
