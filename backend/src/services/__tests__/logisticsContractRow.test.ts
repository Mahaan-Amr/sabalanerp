import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLogisticsContractRow } from '../logisticsContractRow';

const narrow = { rowId: 'narrow', productId: 'stone', width: 40, length: 3, quantity: 2 };
const wide = { rowId: 'wide', productId: 'stone', width: 60, length: 3, quantity: 3 };
const item = { id: 'item', productId: 'stone', productRowId: 'narrow' };

test('stable row identity wins for both snapshot formats and either array order', () => {
  for (const key of ['products', 'items']) {
    for (const rows of [[narrow, wide], [wide, narrow]]) {
      assert.equal(resolveLogisticsContractRow({ [key]: rows }, item), narrow);
    }
  }
});

test('missing, duplicate or conflicting stable identity cannot fall back to a same-product row', () => {
  for (const rows of [[wide], [narrow, narrow], [{ ...narrow, productId: 'other-stone' }]]) {
    assert.throws(() => resolveLogisticsContractRow({ products: rows }, item), /snapshot identity/);
  }
});

test('legacy catalog-only rows resolve only when the match is unique', () => {
  const legacy = { id: 'legacy', productId: 'stone', productRowId: null };
  assert.equal(resolveLogisticsContractRow({ items: [narrow] }, legacy), narrow);
  assert.throws(() => resolveLogisticsContractRow({ products: [narrow, wide] }, legacy), /snapshot identity/);
  assert.throws(() => resolveLogisticsContractRow(null, legacy), /snapshot identity/);
});
