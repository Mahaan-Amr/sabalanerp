import assert from 'node:assert/strict';
import type { ContractProduct } from '../../types/contract.types';
import { prepareContractSubmissionFinancials } from '../../utils/contractSubmissionFinancials';
import {
  getContractProductPriceComponents,
  getContractGrossPayableTotal,
  getContractPayableTotal,
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
  const rows = ['fraction-a', 'fraction-b'].map(rowId => product({ rowId, totalPrice: 100.4,
    originalTotalPrice: 100.4, isCut: false, cuttingCost: 0, physicalCuttingCost: 0, cuttingBreakdown: [] }));
  const payment = { currency: 'تومان', totalContractAmount: 200.8,
    payments: [{ id: 'whole-payment', method: 'CASH_SHIBA' as const, amount: 201, paymentDate: '1405/07/06' }] };
  const submission = prepareContractSubmissionFinancials(rows, [], 0, payment, false);
  assert.equal(submission.totalAmount, 201);
  assert.equal(submission.payment.totalContractAmount, 201);
  assert.equal(submission.validation.isValid, true, JSON.stringify(submission.validation));
  assert.equal(submission.monetaryRounding?.sourceAmount, '200.8');
  assert.equal(rows[0].totalPrice, 100.4);
  const tiny = [product({ totalPrice: 0.4, originalTotalPrice: 0.4, isCut: false,
    cuttingCost: 0, physicalCuttingCost: 0, cuttingBreakdown: [] })];
  const zero = prepareContractSubmissionFinancials(tiny, [], 0, { ...payment, payments: [] }, false);
  assert.equal(zero.totalAmount, 0);
  assert.equal(zero.validation.isValid, true, 'a zero payable obligation needs no artificial payment');
  assert.equal(getContractPayableTotal(rows, [], 0.3), 201);
  assert.equal(getContractPayableTotal(rows, [], 0, false), 200.8);
  assert.equal(prepareContractSubmissionFinancials(rows, [], 0, { ...payment,
    payments: [{ ...payment.payments[0], amount: 200 }] }, false).validation.isValid, false,
    'a real shortfall still blocks submission');
}

{
  const previouslySavedPaymentTotal = 875_000_000;
  const rowsAfterEdit = [
    product({ rowId: 'longitudinal', totalPrice: previouslySavedPaymentTotal, originalTotalPrice: previouslySavedPaymentTotal, cuttingCost: 0, cuttingBreakdown: [] }),
    product({ rowId: 'stair-tread', productType: 'stair', totalPrice: 33_120_000, originalTotalPrice: 33_120_000, cuttingCost: 0, cuttingBreakdown: [] }),
    product({ rowId: 'stair-riser', productType: 'stair', totalPrice: 12_576_000, originalTotalPrice: 12_576_000, cuttingCost: 0, cuttingBreakdown: [] })
  ];
  assert.equal(getContractPayableTotal(rowsAfterEdit, [], 0), 920_696_000);
  assert.notEqual(getContractPayableTotal(rowsAfterEdit, [], 0), previouslySavedPaymentTotal);
  assert.equal(getContractPayableTotal(rowsAfterEdit, [], 2_000_000), 918_696_000);
  const oldPaymentPlan = {
    payments: [{
      id: 'original-payment',
      method: 'CASH_SHIBA' as const,
      amount: previouslySavedPaymentTotal,
      paymentDate: '1405/07/04'
    }],
    currency: 'تومان',
    totalContractAmount: previouslySavedPaymentTotal
  };
  const submission = prepareContractSubmissionFinancials(
    rowsAfterEdit, [], 0, oldPaymentPlan, true
  );
  assert.equal(submission.totalAmount, 920_696_000);
  assert.equal(submission.payment.totalContractAmount, 920_696_000);
  assert.equal(submission.payment.payments[0].amount, 875_000_000);
  assert.equal(submission.validation.isValid, false,
    'the old payment plan must not validate against the newly priced rows');
}

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
  const prepared = product({
    productType: 'prepared',
    preparedUnit: 'count',
    preparedQuantity: 200,
    quantity: 200,
    unitPrice: 200_000,
    pricePerSquareMeter: 200_000,
    originalTotalPrice: 40_000_000,
    totalPrice: 40_000_000,
    cuttingCost: 0,
    physicalCuttingCost: 0,
    cuttingBreakdown: []
  });
  const reconciled = reconcileContractProductPricing(prepared);
  assert.equal(reconciled.totalPrice, 40_000_000);
  assert.deepEqual(reconciled.meta?.pricing, {
    authority: 'canonical-current-save',
    materialBase: 40_000_000,
    mandatoryAmount: 0,
    cuttingCost: 0,
    toolsCost: 0,
    finishingCost: 0,
    totalPrice: 40_000_000,
    reconciled: true
  });
}

{
  const incompletePreparedEvidence = product({
    productType: 'prepared',
    preparedUnit: 'count',
    preparedQuantity: 200,
    quantity: 200,
    unitPrice: 200_000,
    pricePerSquareMeter: 200_000,
    originalTotalPrice: 40_000_000,
    totalPrice: 40_000_000,
    cuttingCost: 0,
    physicalCuttingCost: 0,
    cuttingBreakdown: [],
    meta: {
      pricing: {
        authority: 'canonical-current-save',
        materialBase: 40_000_000,
        totalPrice: 40_000_000,
        reconciled: true
      }
    }
  });
  const reconciled = reconcileContractProductPricing(incompletePreparedEvidence);
  assert.notEqual(reconciled, incompletePreparedEvidence);
  assert.equal(reconciled.meta?.pricing?.toolsCost, 0);
  assert.equal(reconciled.meta?.pricing?.finishingCost, 0);
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
