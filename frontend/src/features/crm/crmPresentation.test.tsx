import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpMetricGrid, ErpPresentationProvider } from '../../components/erp';
import { usesCrmPresentation } from './crmPresentation';

test('CRM presentation covers nested views while excluding Sales and Partner entry points', () => {
  for (const path of ['/dashboard/crm', '/dashboard/crm/customers/create', '/dashboard/crm/customers/1/edit', '/dashboard/crm/duties/1']) {
    assert.equal(usesCrmPresentation(path, new URLSearchParams()), true);
    assert.equal(usesCrmPresentation(path, new URLSearchParams('workspace=sales')), false);
    assert.equal(usesCrmPresentation(path, new URLSearchParams('partnerContract=1')), false);
    assert.equal(usesCrmPresentation(path, new URLSearchParams('returnTo=contract&step=2')), false);
  }
  for (const path of ['/dashboard/hr', '/dashboard/sales', '/dashboard/crm-other']) {
    assert.equal(usesCrmPresentation(path, new URLSearchParams()), false);
  }
});

test('workspace metrics retain values and status meaning while other consumers retain their rendering', () => {
  const metrics = <ErpMetricGrid items={[{ label: 'سررسیدشده', value: '۱۲', hint: 'اقدام‌های عقب‌افتاده', tone: 'danger' }]} />;
  const original = renderToStaticMarkup(metrics);
  assert.doesNotMatch(original, /sds-neumorphic-card/);
  assert.equal(renderToStaticMarkup(<ErpPresentationProvider scope="default">{metrics}</ErpPresentationProvider>), original);
  const workspace = renderToStaticMarkup(<ErpPresentationProvider scope="workspace">{metrics}</ErpPresentationProvider>);
  for (const meaning of ['۱۲', 'سررسیدشده', 'اقدام‌های عقب‌افتاده', 'sds-tone-danger']) assert.ok(workspace.includes(meaning));
  assert.match(workspace, /sds-neumorphic-card/);
  assert.match(workspace, /grid-cols-1 sm:grid-cols-2/);
});
