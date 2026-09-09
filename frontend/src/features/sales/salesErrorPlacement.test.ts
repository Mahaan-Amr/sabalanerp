import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpInlineState } from '@/components/erp';
import { getSalesOperationalErrorKind } from './salesOperationalError';
import CatalogImagePicker from '@/components/CatalogImagePicker';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('product edit validation is attached to editable fields', () => {
  const page = source('src/app/dashboard/sales/products/[id]/page.tsx');
  assert.match(page, /error=\{fieldErrors\.basePrice\}/);
  assert.match(page, /error=\{fieldErrors\.motherLengthValue\}/);
  assert.match(page, /fieldErrors\.images/);
  assert.match(page, /getSalesErrorSummary\(fieldErrors\)/);
});

test('contract, product, and partner action failures are rendered beside their row', () => {
  const contracts = source('src/app/dashboard/sales/contracts/page.tsx');
  const products = source('src/app/dashboard/sales/products/page.tsx');
  const partnerCases = source('src/features/partner-sales/cases/PartnerCaseRuntime.tsx');
  assert.match(contracts, /operationError\?\.contractId === contract\.id/);
  assert.match(contracts, /kind=\{operationError\.kind\}/);
  assert.match(products, /rowError\?\.productId === product\.id/);
  assert.match(products, /kind=\{rowError\.kind\}/);
  assert.match(partnerCases, /error\?\.caseId === row\.view\.owner\.caseId/);
  assert.match(partnerCases, /kind=\{error\.kind\}/);
});

test('failed product deletion closes confirmation before exposing its row error', () => {
  const page = source('src/app/dashboard/sales/products/page.tsx');
  const deleteHandler = page.slice(page.indexOf('const handleDeleteConfirm'), page.indexOf('const handleToggleStatus'));
  assert.equal(deleteHandler.match(/setDeleteConfirm\(\{ show: false, product: null \}\)/g)?.length, 3);
  assert.match(deleteHandler, /catch[\s\S]*setDeleteConfirm\(\{ show: false, product: null \}\)[\s\S]*setRowError/);
});

test('accounting workflow lock is presented as stale state rather than missing permission', () => {
  const page = source('src/app/dashboard/sales/contracts/[id]/edit/page.tsx');
  assert.match(page, /accountingEditLocked[\s\S]{0,300}setErrorKind\('stale'\)/);
});

test('cached shipment warning retains the actionable refresh failure', () => {
  const summary = source('src/features/shipment-quantities/ShipmentQuantitySummary.tsx');
  assert.match(summary, /kind="stale" title=\{<>آخرین اطلاعات موفق نمایش داده می‌شود\. \{refreshError\}<\/>\}/);
});

test('catalog download failures normalize blob responses before building their message', () => {
  const modal = source('src/components/CatalogExcelSyncModal.tsx');
  assert.match(modal, /await normalizeSalesBlobError\(err\)/);
  assert.match(modal, /kind=\{errorKind\}/);
});

test('contract detail renders permission and stale failures with their semantic kind', () => {
  const page = source('src/app/dashboard/sales/contracts/[id]/page.tsx');
  assert.match(page, /if \(error\) return \([\s\S]*kind=\{errorKind\}/);
  assert.match(page, /getSalesOperationalErrorKind/);
});

test('real HTTP response classes render as warning, permission, or danger states', () => {
  for (const status of [404, 409, 410, 412]) {
    const html = renderToStaticMarkup(React.createElement(ErpInlineState, {
      kind: getSalesOperationalErrorKind({ response: { status } }),
      title: `status-${status}`,
    }));
    assert.match(html, /role="status"/);
    assert.match(html, /sds-tone-warning/);
  }
  const permission = renderToStaticMarkup(React.createElement(ErpInlineState, {
    kind: getSalesOperationalErrorKind({ response: { status: 403 } }), title: 'permission',
  }));
  assert.match(permission, /role="status"/);
  assert.match(permission, /sds-tone-neutral/);
  const failure = renderToStaticMarkup(React.createElement(ErpInlineState, {
    kind: getSalesOperationalErrorKind({ response: { status: 500 } }), title: 'failure',
  }));
  assert.match(failure, /role="alert"/);
  assert.match(failure, /sds-tone-danger/);
});

test('image validation is associated with the actual file input', () => {
  const html = renderToStaticMarkup(React.createElement(CatalogImagePicker, {
    images: [],
    onChange: () => undefined,
    error: 'تصویر معتبر را انتخاب کنید.',
  }));
  assert.match(html, /aria-invalid="true"/);
  const errorId = html.match(/aria-errormessage="([^"]+)"/)?.[1];
  assert.ok(errorId);
  assert.match(html, new RegExp(`id="${errorId}"[^>]*role="alert"`));
});
