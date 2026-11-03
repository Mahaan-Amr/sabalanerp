import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import AccountingDeadlinesPanel, { type AccountingDeadlines } from '../AccountingDeadlinesPanel';

const counts = (all: number, receivable: number, check: number) => ({ all, receivable, check });

const deadlines = (overrides: Partial<AccountingDeadlines> = {}): AccountingDeadlines => ({
  selection: { due: 'next7', deadlineType: 'all' },
  typeCounts: counts(2, 1, 1),
  bucketCounts: {
    overdue: counts(0, 0, 0),
    next7: counts(2, 1, 1),
    days8to30: counts(0, 0, 0),
    later30: counts(0, 0, 0),
  },
  items: [
    {
      id: 'receivable-1',
      type: 'receivable',
      bucket: 'next7',
      status: 'OPEN',
      dueDate: '2026-08-10T00:00:00.000Z',
      amount: '125000',
      contractId: 'contract-1',
      contract: { contractNumber: 'C-1', customer: { displayName: 'Customer One' } },
    },
    {
      id: 'check-1',
      type: 'check',
      bucket: 'next7',
      status: 'RECEIVED',
      dueDate: '2026-08-11T00:00:00.000Z',
      amount: '250000',
      contractId: null,
    },
  ],
  total: 2,
  ...overrides,
});

const renderPanel = (data: AccountingDeadlines) => renderToStaticMarkup(
  <AccountingDeadlinesPanel
    deadlines={data}
    dashboardHref={({ due, deadlineType }) => `/dashboard/accounting?due=${due || ''}&deadlineType=${deadlineType || data.selection.deadlineType}`}
    onTypeChange={() => undefined}
  />,
);

test('combined deadline panel links buckets and rows to their canonical destinations', () => {
  const html = renderPanel(deadlines());
  assert.match(html, /\/dashboard\/accounting\?due=next7&amp;deadlineType=all/);
  assert.match(html, /\/dashboard\/accounting\/contracts\/contract-1\?focus=receivable&amp;recordId=receivable-1#collections/);
  assert.match(html, /\/dashboard\/accounting\/payments\?view=unsettled-checks&amp;due=next7&amp;recordId=check-1/);
});

test('type-specific deadline panel renders the selected actionable population', () => {
  const checkOnly = deadlines({
    selection: { due: 'next7', deadlineType: 'check' },
    typeCounts: counts(1, 0, 1),
    items: [deadlines().items[1]],
    total: 1,
  });
  const html = renderPanel(checkOnly);
  assert.match(html, /deadlineType=check/);
  assert.doesNotMatch(html, /recordId=receivable-1/);
  assert.match(html, /recordId=check-1/);
});

test('empty deadline filter keeps bucket register actions without rendering stale rows', () => {
  const html = renderPanel(deadlines({
    selection: { due: 'days8to30', deadlineType: 'receivable' },
    typeCounts: counts(0, 0, 0),
    items: [],
    total: 0,
  }));
  assert.match(html, /\/dashboard\/accounting\/receivables\?view=open&amp;due=days8to30/);
  assert.doesNotMatch(html, /<li/);
  assert.doesNotMatch(html, /recordId=/);
});

test('a stale Last Successful View keeps stable row navigation for current-truth recovery', () => {
  const staleSnapshot = deadlines({
    typeCounts: counts(0, 0, 0),
    bucketCounts: {
      overdue: counts(0, 0, 0),
      next7: counts(0, 0, 0),
      days8to30: counts(0, 0, 0),
      later30: counts(0, 0, 0),
    },
  });
  const html = renderPanel(staleSnapshot);
  assert.match(html, /\/dashboard\/accounting\/contracts\/contract-1\?focus=receivable&amp;recordId=receivable-1#collections/);
  assert.match(html, /\/dashboard\/accounting\/payments\?view=unsettled-checks&amp;due=next7&amp;recordId=check-1/);
});
