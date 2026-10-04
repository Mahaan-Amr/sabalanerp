import React from 'react';
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PartnerTechnicalProduct } from '@sabalanerp/partner-sales-contracts';
import { addPartnerTechnicalProduct, setPartnerTechnicalRetailUnitPrice } from './partnerTechnicalDraftAdapter';
import { PartnerTechnicalDraftEditor } from './PartnerTechnicalDraftEditor';
const product: PartnerTechnicalProduct = { catalogItemId: 'catalog-stone', catalogSnapshotVersion: '2026-10-03T00:00:00.000Z', code: '123', name: 'سنگ محفوظ',
  families: ['prepared'], salesUnits: { prepared: 'count', volumetric: 'count' }, dimensions: {},
  attributes: { stoneType: 'مرمریت', mine: 'آباد', finish: 'صیقل', color: 'سفید', quality: '1', cuttingDimension: 'طولی' }, isAvailable: true };
const draft = setPartnerTechnicalRetailUnitPrice(addPartnerTechnicalProduct({ schemaVersion: 1, inputRevision: 0, rows: [] }, product, { family: 'prepared', productRowId: 'saved-row' }), 'saved-row', '3000000');
for (const catalogState of ['loading', 'error'] as const) test(`unavailable catalog ${catalogState} preserves row without declaring it inactive`, () => {
  const html = renderToStaticMarkup(<PartnerTechnicalDraftEditor draft={draft} products={[product]} currentProducts={[]} operations={[]}
    catalogState={catalogState} onChange={() => {}} />);
  assert.ok(html.includes('سنگ محفوظ'));
  assert.ok(html.includes('۳,۰۰۰,۰۰۰ تومان'), 'saved customer price remains visible');
  assert.equal(draft.rows[0].retailUnitPrice?.amount, '3000000');
  assert.ok(!html.includes('این محصول دیگر در کاتالوگ فعال نیست'));
  assert.ok(!html.includes('حذف و انتخاب محصول دیگر'));
});

test('a completed catalog still identifies a genuinely absent product', () => {
  const html = renderToStaticMarkup(<PartnerTechnicalDraftEditor draft={draft} products={[product]} currentProducts={[]} operations={[]}
    catalogState="ready" onChange={() => {}} />);
  assert.ok(html.includes('این محصول دیگر در کاتالوگ فعال نیست'));
  assert.ok(html.includes('حذف و انتخاب محصول دیگر'));
});
