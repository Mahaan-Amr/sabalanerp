import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpInlineState } from '@/components/erp';
import { getSalesOperationalErrorKind } from './salesOperationalError';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('product edit validation is attached to editable fields', () => {
  const page = source('src/app/dashboard/sales/products/[id]/page.tsx');
  assert.match(page, /error=\{fieldErrors\.basePrice\}/);
  assert.match(page, /error=\{fieldErrors\.motherLengthValue\}/);
  assert.match(page, /fieldErrors\.images/);
  assert.match(page, /getSalesErrorSummary\(fieldErrors\)/);
});

test('contract, product, and partner action failures are rendered beside their row', () => {
  assert.match(source('src/app/dashboard/sales/contracts/page.tsx'), /operationError\?\.contractId === contract\.id/);
  assert.match(source('src/app/dashboard/sales/products/page.tsx'), /rowError\?\.productId === product\.id/);
  assert.match(source('src/features/partner-sales/cases/PartnerCaseRuntime.tsx'), /error\?\.caseId === row\.view\.owner\.caseId/);
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
