import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountingFinancialTrend } from '../AccountingFinancialTrend';
import { ErpSegmentedControl } from '@/components/erp';
import type { FinancialTrendState } from '../accountingFinancialTrendState';

const point = (periodKey: string, marker: boolean) => ({
  periodKey,
  monthKey: '1405-05',
  label: periodKey.slice(-2),
  marker,
  startsAt: '2026-08-01T00:00:00.000Z',
  endsAt: '2026-08-02T00:00:00.000Z',
  invoicedRial: 10_000_000,
  receivedRial: 4_000_000,
  outstandingRial: 6_000_000,
  confidence: 'authoritative' as const,
  destinations: {
    invoiced: `/invoices?date=${periodKey}`,
    received: `/payments?date=${periodKey}`,
    outstanding: `/receivables?date=${periodKey}`,
  },
});

test('trend presentation exposes range switching, Toman values, and every point drilldown', () => {
  const state: FinancialTrendState = {
    status: 'available',
    data: {
      range: '1m',
      currency: 'RIAL',
      hasLegacyFallback: false,
      points: [point('1405-05-01', true), point('1405-05-02', false)],
    },
  };
  const html = renderToStaticMarkup(
    <AccountingFinancialTrend range="1m" state={state} onRangeChange={() => undefined} onRetry={() => undefined} />,
  );
  assert.match(html, /role="group"/);
  assert.match(html, /تومان/);
  assert.equal((html.match(/href="\/(?:invoices|payments|receivables)\?date=/g) || []).length, 6);
  assert.match(html, /date=1405-05-02/);
});

test('range control forwards the selected production range', () => {
  let selected = '';
  const state: FinancialTrendState = { status: 'loading', data: null };
  const tree = AccountingFinancialTrend({
    range: '1m',
    state,
    onRangeChange: (range) => { selected = range; },
    onRetry: () => undefined,
  }) as React.ReactElement;
  const visit = (node: React.ReactNode): React.ReactElement | null => {
    if (!React.isValidElement(node)) return null;
    if (node.type === ErpSegmentedControl) return node;
    for (const child of React.Children.toArray((node.props as { children?: React.ReactNode }).children)) {
      const match = visit(child);
      if (match) return match;
    }
    return null;
  };
  const control = visit(tree);
  assert.ok(control);
  (control.props as { onChange: (range: '3m') => void }).onChange('3m');
  assert.equal(selected, '3m');
});
