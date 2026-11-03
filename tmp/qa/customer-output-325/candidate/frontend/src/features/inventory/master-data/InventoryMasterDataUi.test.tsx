import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpField, ErpInput } from '@/components/erp';
import { InventoryMasterDataActions, InventoryMasterDataForm } from './InventoryMasterDataUi';

test('inventory master-data form associates errors and protects pending submission', () => {
  const html = renderToStaticMarkup(
    <>
      <ErpField label="کد خدمت" error="کد تکراری است" required><ErpInput id="service-code" /></ErpField>
      <InventoryMasterDataActions pending submitLabel="ایجاد خدمت" onCancel={() => undefined} />
    </>
  );

  assert.match(html, /کد خدمت/);
  assert.match(html, /id="service-code-error"/);
  assert.match(html, /aria-describedby="service-code-error"/);
  assert.match(html, /disabled=""/);
});

test('all inventory master-data families share the executable canonical form', () => {
  const base = { code: '', name: '', namePersian: '', description: '', images: [], isActive: true };
  for (const kind of ['service', 'cuttingType', 'stoneFinishing', 'subService'] as const) {
    const html = renderToStaticMarkup(
      <InventoryMasterDataForm kind={kind} values={{ ...base, pricePerMeter: '', pricePerSquareMeter: '', calculationBase: 'length' }} errors={{ code: 'کد الزامی است' }} pending={false} submitLabel="ثبت" onChange={() => undefined} onSubmit={() => undefined} onCancel={() => undefined} />
    );
    assert.match(html, new RegExp(`data-inventory-master-data-kind="${kind}"`));
    assert.match(html, /aria-invalid="true"/);
    assert.match(html, /role="alert"/);
  }
});
