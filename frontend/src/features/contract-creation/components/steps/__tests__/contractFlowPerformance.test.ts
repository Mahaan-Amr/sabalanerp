import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { rankContractCatalogProducts } from '../catalogProductRanking';
import { buildContractCartRows } from '../contractCartRows';

const products = Array.from({ length: 500 }, (_, index) => ({
  id: `catalog-${index}`,
  code: `ST-${index}`,
  name: `Stone ${index}`,
  namePersian: `سنگ ${index}`,
  stoneTypeNamePersian: index % 2 ? 'گرانیت' : 'مرمریت',
  widthValue: 40,
  thicknessValue: 2,
  availableInLongitudinalContracts: true
})) as any[];
const rows = Array.from({ length: 200 }, (_, index) => ({
  rowId: `row-${index}`,
  productId: `catalog-${index}`,
  productType: 'longitudinal',
  stoneName: `سنگ ${index}`,
  quantity: 1,
  length: 1,
  width: 40,
  lengthUnit: 'm',
  widthUnit: 'cm',
  squareMeters: 0.4,
  totalPrice: 1000,
  currency: 'تومان',
  ...(index > 0 && index % 4 === 0 ? { parentProductRowId: `row-${index - 1}` } : {})
})) as any[];

const searchStart = performance.now();
const ranked = rankContractCatalogProducts({
  products,
  query: 'سنگ ۴۹۹',
  activeType: null,
  sellerHistory: {
    'catalog-499': { selectionCount: 20, lastSelectedAt: new Date().toISOString() }
  }
});
const searchMs = performance.now() - searchStart;
assert.equal(ranked[0]?.product.id, 'catalog-499');
assert.ok(searchMs < 50, `local search took ${searchMs.toFixed(2)}ms`);

const rowsStart = performance.now();
const projected = buildContractCartRows(rows);
const rowsMs = performance.now() - rowsStart;
assert.ok(projected.length > 0);
assert.ok(rowsMs < 50, `200-row projection took ${rowsMs.toFixed(2)}ms`);

console.log(`contract flow performance passed: search=${searchMs.toFixed(2)}ms rows=${rowsMs.toFixed(2)}ms`);
