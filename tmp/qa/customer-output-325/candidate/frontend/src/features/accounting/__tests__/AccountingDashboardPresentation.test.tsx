import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  AccountingDashboardSkeleton,
  AccountingOperationalMetricGrid,
} from '../AccountingDashboardPresentation';

(globalThis as typeof globalThis & { React: typeof React }).React = React;

test('dashboard loading view preserves both panels and all ten metric-card positions', () => {
  const html = renderToStaticMarkup(<AccountingDashboardSkeleton />);
  assert.match(html, /aria-label="در حال بارگذاری روند مالی"/);
  assert.match(html, /aria-label="در حال بارگذاری سررسیدها"/);
  assert.match(html, /aria-label="در حال بارگذاری شاخص‌های عملیاتی"/);
  assert.ok(
    html.indexOf('aria-label="در حال بارگذاری شاخص‌های عملیاتی"')
      < html.indexOf('aria-label="در حال بارگذاری روند مالی"'),
    'metric-card skeleton must render before the trend and deadline panels',
  );
  assert.match(html, /grid grid-cols-1 items-stretch gap-5/);
  assert.match(html, /grid grid-cols-2 gap-3 xl:grid-cols-4/);
  assert.equal((html.match(/sds-skeleton block rounded-xl h-48/g) || []).length, 4);
  assert.equal((html.match(/sds-neumorphic-card/g) || []).length, 10);
});

test('loaded operational metrics keep canonical drilldowns and hide unavailable HR counts', () => {
  const html = renderToStaticMarkup(
    <AccountingOperationalMetricGrid
      commandCenter={{ reviewableContracts: { count: 23 }, openReceivables: { count: 5 } }}
      hrMetrics={{
        status: 'pending',
        actionableCollateralOrContractCases: 91,
        activeCollateralTemplates: 92,
      }}
    />,
  );
  assert.match(html, /\/dashboard\/accounting\/contracts\?view=reviewable/);
  assert.match(html, /\/dashboard\/accounting\/receivables\?view=open/);
  assert.match(html, />۲۳</);
  assert.match(html, />۵</);
  assert.doesNotMatch(html, />۹۱</);
  assert.doesNotMatch(html, />۹۲</);
  assert.match(html, /در حال بررسی دسترسی/);
});

test('authorized HR metrics appear in the shared Accounting metric grid', () => {
  const html = renderToStaticMarkup(
    <AccountingOperationalMetricGrid
      commandCenter={{}}
      hrMetrics={{
        status: 'available',
        actionableCollateralOrContractCases: 7,
        activeCollateralTemplates: 3,
      }}
    />,
  );
  assert.match(html, />۷</);
  assert.match(html, />۳</);
});
