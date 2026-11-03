import assert from 'node:assert/strict';
import { renderContractHtml } from '../printTemplate';

const html = renderContractHtml({
  id: 'layer-contract',
  contractNumber: '100156-regression',
  status: 'DRAFT',
  currency: 'تومان',
  items: [],
  contractData: {
    products: [{
      rowId: 'parent-row',
      productId: 'stone-35',
      productType: 'stair',
      stairPartType: 'tread',
      stoneName: 'پله مرمریت',
      quantity: 32,
      squareMeters: 13.216,
      totalPrice: 1,
      pricePerSquareMeter: 1
    }, {
      rowId: 'layer-row',
      parentProductRowId: 'parent-row',
      productId: 'stone-35',
      productType: 'stair',
      stairPartType: 'tread',
      stoneName: 'لایه پله مرمریت',
      width: 5,
      widthUnit: 'cm',
      length: 1.18,
      lengthUnit: 'm',
      quantity: 32,
      squareMeters: 2.288,
      originalWidth: 35,
      originalLength: 1.2,
      originalTotalPrice: 1_827_000,
      totalPrice: 1_827_000,
      pricePerSquareMeter: 1_450_000,
      meta: {
        isLayer: true,
        layerEdges: { front: true, left: true },
        layerInfo: {
          parentPartType: 'tread',
          numberOfLayersPerStair: 1,
          layerSetQuantity: 32,
          physicalPieceQuantity: 64
        },
        layerSourcePlan: {
          fromAlreadyPaidSets: 20,
          fromNewSets: 12,
          sourceStoneQuantity: 3,
          sourceAreaSqm: 1.26,
          sourceWidthCm: 35,
          sourceLengthM: 1.2
        }
      }
    }]
  }
} as any);

assert.ok(html.includes('↳ لایه پله مرمریت'));
assert.ok(html.includes('۳۲ ست'));
assert.ok(html.includes('جلو + چپ'));
assert.ok(html.includes('۶۴ نوار فیزیکی'));
assert.ok(html.includes('لایه از سنگ قبلاً محاسبه‌شده'));
assert.ok(html.includes('لایه از سنگ جدید'));
assert.ok(html.includes('سنگ جدید مصرفی لایه'));
assert.ok(html.includes('۱٫۲۶'));

const normalizeCell = (value: string): string => value
  .replace(/<[^>]+>/g, ' ')
  .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
  .replace(/٬/g, ',')
  .replace(/٫/g, '.')
  .replace(/\s+/g, ' ')
  .trim();
const rows = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [];
const cellsFor = (text: string): string[] => {
  const row = rows.find((candidate) => candidate.includes(text)) || '';
  return Array.from(row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g), (match) => normalizeCell(match[1]));
};

assert.deepEqual(cellsFor('↳ لایه پله مرمریت').slice(-2), ['—', '—']);
assert.deepEqual(cellsFor('لایه از سنگ قبلاً محاسبه‌شده').slice(-2), ['—', '—']);
assert.deepEqual(cellsFor('لایه از سنگ جدید').slice(-2), ['—', '—']);
assert.deepEqual(
  cellsFor('سنگ جدید مصرفی لایه').slice(-2),
  ['1,450,000', '1,827,000'],
  'only the physical newly charged layer stone should present material price'
);

console.log('printTemplateStairLayer tests passed');
