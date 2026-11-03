import assert from 'node:assert/strict';
import type { ContractProduct } from '../../types/contract.types';
import {
  getContractProductPriceComponents,
  getContractGrossPayableTotal,
  getContractProductNonServiceSubtotal,
  getContractProductPayableTotal,
  reconcileContractProductPricing
} from '../../utils/contractProductPricing';

const product = (overrides: Partial<ContractProduct> = {}): ContractProduct => ({
  productId: 'stone-1',
  productType: 'longitudinal',
  stoneName: 'سنگ طولی تست',
  length: 400,
  width: 4,
  quantity: 0,
  squareMeters: 16,
  pricePerSquareMeter: 6_000_000,
  totalPrice: 96_000_000,
  originalTotalPrice: 96_000_000,
  isMandatory: false,
  mandatoryPercentage: 0,
  isCut: true,
  cutType: 'longitudinal',
  originalWidth: 40,
  originalLength: 400,
  cuttingCost: 8_000_000,
  physicalCuttingCost: 8_000_000,
  cuttingCostPerMeter: 20_000,
  cuttingBreakdown: [{
    type: 'longitudinal',
    meters: 400,
    rate: 20_000,
    cost: 8_000_000
  }],
  description: '',
  currency: 'تومان',
  remainingStones: [],
  cutDetails: [],
  usedRemainingStones: [],
  totalUsedRemainingWidth: 0,
  totalUsedRemainingLength: 0,
  appliedSubServices: [],
  totalSubServiceCost: 0,
  usedLengthForSubServices: 0,
  usedSquareMetersForSubServices: 0,
  ...overrides
} as ContractProduct);

{
  const inconsistent = product();
  const components = getContractProductPriceComponents(inconsistent);
  assert.equal(components.materialBase, 96_000_000);
  assert.equal(components.cuttingCost, 8_000_000);
  assert.equal(components.reconciledTotal, 104_000_000);
  assert.equal(getContractProductNonServiceSubtotal(inconsistent), 96_000_000);
  assert.equal(getContractGrossPayableTotal([inconsistent], [{
    id: 'standalone-cut',
    sourceType: 'cutting',
    sourceId: 'cut-standalone',
    sourceCode: 'CUT-STANDALONE',
    title: 'برش مستقل',
    unit: 'meter',
    quantity: 10,
    unitPrice: 100_000,
    totalPrice: 1_000_000,
    currency: 'تومان',
    description: ''
  }]), 105_000_000);
  assert.equal(reconcileContractProductPricing(inconsistent).totalPrice, 104_000_000);
}

{
  const alreadyCorrect = product({ totalPrice: 104_000_000 });
  assert.equal(getContractProductPayableTotal(alreadyCorrect), 104_000_000);
  assert.equal(reconcileContractProductPricing(alreadyCorrect), alreadyCorrect);
}

{
  const withOperations = product({
    cuttingCost: 0,
    physicalCuttingCost: 0,
    cuttingBreakdown: [],
    totalSubServiceCost: 2_000_000,
    appliedSubServices: [{
      id: 'applied-tool',
      subServiceId: 'tool-1',
      subService: {
        id: 'tool-1',
        code: 'tool-1',
        namePersian: 'ابزار تست',
        pricePerMeter: 100_000,
        calculationBase: 'length',
        isActive: true
      },
      meter: 20,
      cost: 2_000_000,
      calculationBase: 'length'
    }],
    finishingId: 'finish-1',
    finishingCost: 3_000_000
  });
  assert.equal(getContractProductPayableTotal(withOperations), 101_000_000);
  assert.equal(getContractProductNonServiceSubtotal(withOperations), 96_000_000);
}

{
  const mandatory = product({
    isMandatory: true,
    mandatoryPercentage: 20,
    totalPrice: 115_200_000
  });
  const components = getContractProductPriceComponents(mandatory);
  assert.equal(components.mandatoryAmount, 19_200_000);
  assert.equal(components.cuttingCost, 8_000_000);
  assert.equal(components.reconciledTotal, 123_200_000);
}

{
  const remainingChild = product({
    parentProductRowId: 'source-row',
    originalTotalPrice: 0,
    totalPrice: 0,
    cuttingCost: 500_000,
    physicalCuttingCost: 500_000,
    cuttingBreakdown: [{ type: 'cross', meters: 5, rate: 100_000, cost: 500_000 }]
  });
  assert.equal(getContractProductPayableTotal(remainingChild), 500_000);
}

{
  const ambiguousLegacy = product({
    originalTotalPrice: 0,
    totalPrice: 12_000_000,
    cuttingCost: 3_000_000
  });
  assert.equal(getContractProductPayableTotal(ambiguousLegacy), 12_000_000);
}

{
  const explicitlySavedCanonicalRow = product({
    originalTotalPrice: 3_480_000,
    isMandatory: true,
    mandatoryPercentage: 20,
    cuttingCost: 0,
    physicalCuttingCost: 0,
    cuttingBreakdown: [],
    totalPrice: 27_600_000,
    meta: {
      pricing: {
        authority: 'canonical-current-save',
        totalPrice: 4_176_000
      }
    }
  });
  assert.equal(getContractProductPayableTotal(explicitlySavedCanonicalRow), 4_176_000);
  assert.equal(reconcileContractProductPricing(explicitlySavedCanonicalRow).totalPrice, 4_176_000);
}

console.log('contractProductPricing tests passed');
