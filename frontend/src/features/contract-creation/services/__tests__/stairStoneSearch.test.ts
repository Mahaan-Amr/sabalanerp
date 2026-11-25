import assert from 'node:assert/strict';
import test from 'node:test';
import type { Product } from '../../types/contract.types';
import { createStairStoneSearch } from '../stairStoneSearch';

function stone(id: string, dimensions: string, attributes: Partial<Product> = {}): Product {
  return {
    id,
    code: id,
    name: 'سنگ کریستال',
    namePersian: 'سنگ کریستال',
    currency: 'تومان',
    isAvailable: true,
    cuttingDimensionNamePersian: dimensions,
    stoneTypeNamePersian: 'مرمریت',
    widthValue: 40,
    thicknessValue: 2,
    widthName: '40',
    thicknessName: '2',
    mineNamePersian: 'کاشمر',
    finishNamePersian: 'صیقلی',
    colorNamePersian: '',
    qualityNamePersian: '',
    ...attributes
  };
}

test('stair and layer lookups share in-flight catalogue results in source order with stable identity', async () => {
  const direct = stone('direct', 'پله', { basePrice: 825_000 });
  const longitudinal = stone('fallback', 'طولی', { availableInLongitudinalContracts: true });
  const local = stone('local', 'پله');
  const ineligible = stone('removed-eligibility', 'اسلب');
  const requests: unknown[] = [];
  const search = createStairStoneSearch(
    [local, stone(direct.id, 'پله', { basePrice: 9 }), stone(ineligible.id, 'پله')],
    async parameters => {
      requests.push(parameters);
      if (parameters.contractType === 'stair') {
        return { data: { success: true, data: [direct, ineligible] } };
      }
      return { data: { success: true, items: [stone(direct.id, 'طولی'), longitudinal, longitudinal] } };
    }
  );

  const [stair, layer] = await Promise.all([search('  كريستال ٤٠  '), search('كريستال ٤٠')]);
  assert.deepEqual(stair.map(product => product.id), ['direct', 'fallback', 'local']);
  assert.deepEqual(layer, stair);
  assert.equal(stair[0], direct);
  assert.equal(stair[1], longitudinal);
  assert.deepEqual(requests, [
    { search: 'كريستال ٤٠', limit: 10, contractType: 'stair' },
    { search: 'كريستال ٤٠', limit: 10, contractType: 'longitudinal' }
  ]);
});

test('a failed catalogue request cannot expose cached candidates', async () => {
  const search = createStairStoneSearch([stone('cached', 'پله')], async ({ contractType }) => {
    if (contractType === 'stair') throw new Error('catalogue permission revoked');
    return { data: { success: true, data: [stone('fallback', 'طولی')] } };
  });

  await assert.rejects(search('کریستال'), /permission revoked/);
});
