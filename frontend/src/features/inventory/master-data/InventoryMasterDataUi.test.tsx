import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErpInput } from '@/components/erp';
import { InventoryMasterDataActions, InventoryMasterDataEntry } from './InventoryMasterDataUi';

test('inventory master-data form associates errors and protects pending submission', () => {
  const html = renderToStaticMarkup(
    <>
      <InventoryMasterDataEntry id="service-code" label="کد خدمت" error="کد تکراری است" required>
        <ErpInput />
      </InventoryMasterDataEntry>
      <InventoryMasterDataActions pending submitLabel="ایجاد خدمت" onCancel={() => undefined} />
    </>
  );

  assert.match(html, /کد خدمت/);
  assert.match(html, /id="service-code-error"/);
  assert.match(html, /aria-describedby="service-code-error"/);
  assert.match(html, /disabled=""/);
});
