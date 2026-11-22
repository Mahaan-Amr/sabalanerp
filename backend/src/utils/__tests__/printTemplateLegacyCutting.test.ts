import assert from 'node:assert/strict';
import { renderContractHtml } from '../printTemplate';

const product = {
  rowId: 'row-cut', productId: 'stone', productType: 'longitudinal', stoneName: 'سنگ تست',
  length: 40, lengthUnit: 'cm', width: 12, widthUnit: 'cm', quantity: 157, squareMeters: 7.536,
  isCut: true, cutType: 'longitudinal', cuttingCost: 1884000,
  cutDetails: [{ id: 'old-cut', orientation: 'longitudinal', originalWidth: 40, cutWidth: 12,
    remainingWidth: 28, length: 2120, cuttingCost: 1884000, cuttingCostPerMeter: 30000 }]
};
const cutRows = (p: object, variant: 'original' | 'summary' = 'original') => {
  const html = renderContractHtml({ contractNumber: 'CUT-REGRESSION', currency: 'تومان', items: [],
    contractData: { products: [p] } } as any, { variant });
  return (html.match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || [])
    .filter(row => row.includes('برش طولی'))
    .map(row => row.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)))
      .replace(/٬/g, ',').replace(/٫/g, '.').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
};
for (const variant of ['original', 'summary'] as const) {
  const rows = cutRows(product, variant);
  assert.equal(rows.length, 1);
  assert.match(rows[0], /62\.8/);
  assert.doesNotMatch(rows[0], /2,120/);
  assert.match(rows[0], /1,884,000/, 'historical saved amount is preserved');
  const explicit = cutRows({ ...product, cutDetails: [{ ...product.cutDetails[0], meters: 7, length: 999,
    cuttingCost: 210000 }] }, variant);
  assert.match(explicit[0], /\b7\b/, 'explicit meters take precedence');
  const removed = cutRows({ ...product, isCut: false, cutType: null, width: 40, cuttingCost: 0,
    meta: { pricing: { authority: 'canonical-current-save', cuttingCost: 0 } } }, variant);
  assert.equal(removed.length, 0, 'canonical uncut rows must not print retained legacy cuts');
}
console.log('legacy cutting print regressions passed');
