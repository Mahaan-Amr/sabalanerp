import assert from 'node:assert/strict';
import { renderContractHtml } from '../printTemplate';

const html = renderContractHtml({
  id: 'operation-lookup-contract',
  contractNumber: 'operation-lookup',
  status: 'DRAFT',
  currency: 'تومان',
  items: [],
  contractData: {
    products: [{
      rowId: 'stair-row',
      productId: 'stone',
      productType: 'stair',
      stairPartType: 'tread',
      stoneName: 'سنگ پله',
      quantity: 1,
      squareMeters: 0.4,
      totalPrice: 131950,
      pricePerSquareMeter: 1,
      appliedSubServices: [{
        id: 'tool-selection:one',
        subServiceId: 'tool-one',
        meter: 1.82,
        cost: 91000,
        calculationBase: 'length',
        edges: { front: true, back: true }
      }]
    }]
  }
} as any, {
  subServiceById: {
    'tool-one': {
      code: '923218',
      name: 'نیم لول',
      pricePerMeter: 50000,
      calculationBase: 'length'
    }
  }
});

assert.ok(html.includes('نیم لول'));
assert.ok(html.includes('۹۲۳۲۱۸'));
assert.ok(html.includes('۵۰'));
assert.ok(html.includes('۱٫۸۲'));

console.log('printTemplate operation lookup tests passed');
