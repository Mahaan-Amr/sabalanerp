import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
