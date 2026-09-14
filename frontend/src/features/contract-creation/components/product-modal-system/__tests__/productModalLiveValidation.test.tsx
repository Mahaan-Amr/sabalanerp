import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createNewLongitudinalProductInput,
  parseCanonicalDecimal,
  parseStableIdentity
} from '@sabalanerp/contract-product-graph';
import { LongitudinalProductSection } from '../LongitudinalProductSection';
import { getRemainingStoneDraftFieldErrors } from '../../../services/remainingStoneAllocationReplayService';
import type { ContractProduct, Product } from '../../../types/contract.types';

const input = {
  ...createNewLongitudinalProductInput({
    calculationPolicyVersion: 'calculation-v1',
    packingPolicyVersion: 'packing-v1',
    pricingPolicyVersion: 'pricing-v1',
    roundingPolicyVersion: 'rounding-v1',
    sourceBatchId: parseStableIdentity('source-batch', 'live-validation'),
    motherWidthMeters: parseCanonicalDecimal('0.4'),
    defaultMandatoryPercentage: parseCanonicalDecimal('20'),
    sawKerfMeters: parseCanonicalDecimal('0.003'),
    baseMaterialPricing: 'paid-source-zero' as const,
    baseRateToman: parseCanonicalDecimal('0')
  }),
  lengthMeters: parseCanonicalDecimal('5.001'),
  widthMeters: parseCanonicalDecimal('0.4'),
  quantity: 50,
  requestedAreaSquareMeters: parseCanonicalDecimal('100.02'),
  lastManualField: 'length' as const,
  lastManualDimension: 'length' as const
};
const product = {
  id: 'live-product',
  code: 'LIVE',
  name: 'Live',
  namePersian: 'سنگ تست',
  widthValue: 40,
  basePrice: 0
} as Product;
const shared = {
  productId: product.id,
  product,
  productType: 'longitudinal' as const,
  stoneCode: product.code,
  stoneName: product.namePersian,
  diameterOrWidth: 40,
  length: 5,
  width: 40,
  quantity: 50,
  squareMeters: 100,
  pricePerSquareMeter: 0,
  totalPrice: 0,
  description: '',
  currency: 'تومان',
  lengthUnit: 'm' as const,
  widthUnit: 'cm' as const,
  isMandatory: false,
  mandatoryPercentage: 0,
  originalTotalPrice: 0,
  isCut: false,
  cutType: null,
  originalWidth: 40,
  originalLength: 5,
  cuttingCost: 0,
  cuttingCostPerMeter: 0,
  cutDescription: '',
  remainingStones: [],
  cutDetails: [],
  usedRemainingStones: [],
  totalUsedRemainingWidth: 0,
  totalUsedRemainingLength: 0,
  appliedSubServices: [],
  totalSubServiceCost: 0,
  usedLengthForSubServices: 0,
  usedSquareMetersForSubServices: 0
};
const source = {
  ...shared,
  rowId: 'live-source',
  remainingStoneSourceInventory: [{
    id: 'live-stock',
    width: 40,
    length: 5,
    quantity: 50,
    squareMeters: 100,
    isAvailable: true
  }]
} as ContractProduct;
const child = {
  ...shared,
  rowId: 'live-child',
  parentProductRowId: source.rowId,
  remainingStoneAllocationOrder: 0,
  length: 5.001,
  squareMeters: 100.02,
  meta: {
    remainingSource: {
      sourceProductRowId: source.rowId,
      allocationId: 'live-allocation',
      allocationOrder: 0
    }
  }
} as ContractProduct;
const liveErrors = getRemainingStoneDraftFieldErrors({
  products: [source, { ...child, length: 5, squareMeters: 100 }],
  draftProduct: child,
  lastEditedField: 'length'
});
const error = 'طول واردشده از ظرفیت سنگ باقی‌مانده بیشتر است؛ طول را کاهش دهید.';
const html = renderToStaticMarkup(
  <LongitudinalProductSection
    input={input}
    onChange={() => undefined}
    calculation={null}
    liveErrors={liveErrors}
  />
);

assert.match(html, /id="longitudinal-length"[^>]*aria-invalid="true"/);
assert.ok(html.includes(error));
assert.doesNotMatch(html, /ثبت قرارداد|ذخیره تغییرات/);

console.log('product modal live validation tests passed');
