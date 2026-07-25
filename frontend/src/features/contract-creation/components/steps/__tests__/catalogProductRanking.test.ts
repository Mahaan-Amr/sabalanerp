import assert from 'node:assert/strict';
import {
  moveCatalogHighlight,
  rankContractCatalogProducts,
  recordSellerProductSelection,
  resolveHighlightedCatalogProduct,
  type SellerProductHistory
} from '../catalogProductRanking';
import type { Product } from '../../../types/contract.types';
import { inferCatalogContractType } from '../../../utils/productUtils';

const product = (overrides: Partial<Product> & Pick<Product, 'id' | 'code' | 'namePersian'>): Product => ({
  currency: 'تومان',
  isAvailable: true,
  cuttingDimensionNamePersian: 'طولی',
  stoneTypeNamePersian: 'گرانیت',
  widthValue: 40,
  thicknessValue: 2,
  widthName: '40',
  thicknessName: '2',
  mineNamePersian: 'نطنز',
  finishNamePersian: 'صیقلی',
  colorNamePersian: 'مشکی',
  qualityNamePersian: 'استاندارد',
  availableInLongitudinalContracts: true,
  ...overrides,
  id: overrides.id,
  code: overrides.code,
  name: overrides.name ?? overrides.namePersian,
  namePersian: overrides.namePersian
});

const catalog = [
  product({ id: 'catalog-1', code: '0012', namePersian: 'گرانیت نطنز' }),
  product({ id: 'catalog-2', code: '1200', namePersian: 'تراورتن عباس آباد' }),
  product({ id: 'catalog-3', code: '1201', namePersian: 'سنگ گرانیت ویژه' }),
  product({ id: 'catalog-4', code: '1202', namePersian: 'سنگ كريستال' })
];

const history: SellerProductHistory = {
  'catalog-3': { selectionCount: 8, lastSelectedAt: '2026-07-24T10:00:00.000Z' },
  'catalog-1': { selectionCount: 2, lastSelectedAt: '2026-07-20T10:00:00.000Z' }
};

{
  const ranked = rankContractCatalogProducts({
    products: catalog,
    query: '',
    activeType: null,
    sellerHistory: history
  });
  assert.deepEqual(
    ranked.map(item => item.product.id),
    ['catalog-3', 'catalog-1', 'catalog-2', 'catalog-4'],
    'empty search should keep personalized products inside the unified list before stable catalog order'
  );
}

{
  const first = recordSellerProductSelection({}, 'catalog-2', '2026-07-25T08:00:00.000Z');
  const second = recordSellerProductSelection(first, 'catalog-2', '2026-07-25T09:00:00.000Z');
  assert.deepEqual(second['catalog-2'], {
    selectionCount: 2,
    lastSelectedAt: '2026-07-25T09:00:00.000Z'
  });
}

{
  const ranked = rankContractCatalogProducts({
    products: catalog,
    query: '0012',
    activeType: null,
    sellerHistory: history
  });
  assert.equal(ranked[0]?.product.id, 'catalog-1', 'exact catalog code must rank first');
  assert.equal(ranked[0]?.matchKind, 'exact-code');
}

{
  const ranked = rankContractCatalogProducts({
    products: catalog,
    query: 'سنگ گرانیت ویژه',
    activeType: null,
    sellerHistory: history
  });
  assert.equal(ranked[0]?.product.id, 'catalog-3', 'exact normalized name must rank before token matches');
  assert.equal(ranked[0]?.matchKind, 'exact-name');
}

{
  const ranked = rankContractCatalogProducts({
    products: catalog,
    query: 'سنگ کریستال',
    activeType: null,
    sellerHistory: history
  });
  assert.equal(
    ranked[0]?.product.id,
    'catalog-4',
    'Persian and Arabic ی/ي and ک/ك variants must be equivalent'
  );
}

console.log('catalogProductRanking tests passed');

{
  assert.equal(
    resolveHighlightedCatalogProduct(catalog, null),
    null,
    'Enter must not select an implicit first result when nothing is highlighted'
  );
  assert.equal(moveCatalogHighlight(null, 'next', catalog.length), 0);
  assert.equal(moveCatalogHighlight(0, 'previous', catalog.length), 3);
  assert.equal(resolveHighlightedCatalogProduct(catalog, 2)?.id, 'catalog-3');
}

{
  const broadlyAvailableLongitudinal = product({
    id: 'catalog-all-flags',
    code: '10407107404',
    namePersian: 'طولی گرانیت ع40',
    cuttingDimensionNamePersian: 'طولی',
    availableInLongitudinalContracts: true,
    availableInStairContracts: true,
    availableInSlabContracts: true,
    availableInVolumetricContracts: true
  });
  assert.equal(
    inferCatalogContractType(broadlyAvailableLongitudinal),
    'longitudinal',
    'availability flags must not misclassify the catalog primary type'
  );
  assert.equal(
    inferCatalogContractType(product({
      id: 'catalog-slab',
      code: '3030010520000',
      namePersian: 'اسلب کریستال',
      cuttingDimensionNamePersian: 'اسلب'
    })),
    'slab'
  );
}
