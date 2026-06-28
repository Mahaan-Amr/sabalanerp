import assert from 'node:assert/strict';
import { formatPrice, normalizeDigits, parseFormattedNumber } from '../../../../lib/numberFormat';
import {
  createDeliveryDraft,
  getDeliveryUnit,
  getDeliveryUnitLabel,
  syncDeliveryDefaults
} from '../../utils/deliveryScheduleController';
import {
  clampContractDraftStep,
  createContractAutosaveDraft,
  isContractDraftExpired,
  parseContractAutosaveDraft
} from '../../utils/contractDraftStorage';
import {
  mergeEditedRemainingStoneState,
  resolveLongitudinalWidth
} from '../../utils/productConfigurationController';
import {
  isValidIranianMobile,
  normalizeIranianMobile,
  validateOptionalIranianMobile,
  validateRequiredIranianMobile
} from '../../../../lib/phoneFormat';
import type { ContractProduct, ContractWizardData, Product, RemainingStone } from '../../types/contract.types';

const product = {
  id: 'p1',
  code: 'P1',
  name: 'Stone',
  namePersian: 'سنگ',
  currency: 'تومان',
  isAvailable: true,
  cuttingDimensionNamePersian: '',
  stoneTypeNamePersian: '',
  widthValue: 40,
  thicknessValue: 4,
  widthName: '',
  thicknessName: '',
  mineNamePersian: '',
  finishNamePersian: '',
  colorNamePersian: '',
  qualityNamePersian: ''
} satisfies Product;

const makeContractProduct = (overrides: Partial<ContractProduct> = {}): ContractProduct => ({
  productId: product.id,
  product,
  productType: 'longitudinal',
  stoneCode: product.code,
  stoneName: product.namePersian,
  diameterOrWidth: 40,
  length: 10,
  width: 20,
  quantity: 1,
  squareMeters: 2,
  pricePerSquareMeter: 1000,
  totalPrice: 2000,
  description: '',
  currency: 'تومان',
  lengthUnit: 'm',
  widthUnit: 'cm',
  isMandatory: false,
  mandatoryPercentage: 0,
  originalTotalPrice: 2000,
  isCut: true,
  cutType: 'longitudinal',
  originalWidth: 40,
  originalLength: 10,
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
  usedSquareMetersForSubServices: 0,
  ...overrides
});

const makeWizardData = (overrides: Partial<ContractWizardData> = {}): ContractWizardData => ({
  contractDate: '',
  contractNumber: '',
  customerId: '',
  customer: {
    id: 'c1',
    firstName: '',
    lastName: '',
    companyName: '',
    customerType: 'PERSON',
    status: 'ACTIVE',
    projectAddresses: [],
    phoneNumbers: [],
    projectManagerName: 'مدیر پروژه',
    isBlacklisted: false,
    isLocked: false
  },
  projectId: '',
  project: {
    id: 'a1',
    address: 'آدرس',
    city: '',
    isActive: true,
    projectManagerName: 'مدیر پروژه'
  },
  selectedProductTypeForAddition: null,
  products: [],
  deliveries: [],
  payment: {
    payments: [],
    currency: 'تومان',
    totalContractAmount: 0
  },
  signature: {},
  ...overrides
} as ContractWizardData);

assert.equal(normalizeDigits('۱۲۳٬۴۵۶٫۷'), '123,456.7');
assert.equal(parseFormattedNumber('۱۲۳,۴۵۶'), 123456);
assert.equal(parseFormattedNumber('١٢٣٤.٥'), 1234.5);
assert.equal(formatPrice(9050120), '۹٬۰۵۰٬۱۲۰ تومان');

assert.deepEqual(
  resolveLongitudinalWidth({ length: 12, width: 0 }, product, 'cm', false),
  { length: 12, width: 40 }
);
assert.deepEqual(
  resolveLongitudinalWidth({ squareMeters: 4, width: 0 }, product, 'm', false),
  { squareMeters: 4, width: 0.4 }
);

const usedStone: RemainingStone = {
  id: 'used-1',
  width: 10,
  length: 3,
  squareMeters: 0.3,
  isAvailable: false,
  sourceCutId: 'cut-1'
};
const nextAvailable: RemainingStone = {
  id: 'new-1',
  width: 15,
  length: 8,
  squareMeters: 1.2,
  isAvailable: true,
  sourceCutId: 'cut-2',
  quantity: 1
};
const merged = mergeEditedRemainingStoneState({
  geometryChanged: true,
  nextAvailableRemainingStones: [nextAvailable],
  previousProduct: makeContractProduct({
    remainingStones: [],
    usedRemainingStones: [usedStone],
    totalUsedRemainingWidth: 10,
    totalUsedRemainingLength: 3
  })
});
assert.deepEqual(merged.remainingStones, [nextAvailable]);
assert.equal(merged.remainingStones[0].quantity, 1);
assert.deepEqual(merged.usedRemainingStones, [usedStone]);
assert.equal(merged.totalUsedRemainingWidth, 10);
assert.equal(merged.totalUsedRemainingLength, 3);
assert.ok(merged.warning);

const wizardData = makeWizardData();
assert.equal(createDeliveryDraft(wizardData).projectManagerName, 'مدیر پروژه');
assert.equal(createDeliveryDraft(wizardData).receiverName, 'مدیر پروژه');
assert.deepEqual(
  syncDeliveryDefaults([
    {
      deliveryDate: '',
      projectManagerName: '',
      receiverName: '',
      deliveryAddress: '',
      products: []
    },
    {
      deliveryDate: '',
      projectManagerName: '',
      receiverName: 'تحویل گیرنده متفاوت',
      deliveryAddress: '',
      products: []
    }
  ], wizardData).map((delivery) => delivery.receiverName),
  ['مدیر پروژه', 'تحویل گیرنده متفاوت']
);
assert.deepEqual(
  syncDeliveryDefaults([
    {
      deliveryDate: '',
      projectManagerName: 'Ali ',
      receiverName: 'Ali Mohammadi',
      deliveryAddress: 'Tehran ',
      products: []
    }
  ], wizardData).map((delivery) => ({
    projectManagerName: delivery.projectManagerName,
    receiverName: delivery.receiverName,
    deliveryAddress: delivery.deliveryAddress
  })),
  [{
    projectManagerName: 'Ali ',
    receiverName: 'Ali Mohammadi',
    deliveryAddress: 'Tehran '
  }]
);

assert.equal(getDeliveryUnit(makeContractProduct({ productType: 'longitudinal' })), 'meter');
assert.equal(getDeliveryUnitLabel('meter'), 'متر طول');

assert.equal(normalizeIranianMobile('\u06F9\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'), '09123456789');
assert.equal(normalizeIranianMobile('+989123456789'), '09123456789');
assert.equal(normalizeIranianMobile('00989123456789'), '09123456789');
assert.equal(isValidIranianMobile('\u06F0\u06F9\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'), true);
assert.equal(validateRequiredIranianMobile('\u06F0\u06F9\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8\u06F9'), null);
assert.equal(validateRequiredIranianMobile('02112345678') !== null, true);
assert.equal(validateOptionalIranianMobile(''), null);
assert.equal(validateOptionalIranianMobile('\u06F0\u06F2\u06F1\u06F1\u06F2\u06F3\u06F4\u06F5\u06F6\u06F7\u06F8') !== null, true);

{
  const now = 1_000_000;
  const draft = createContractAutosaveDraft({
    currentStep: 4,
    wizardData: makeWizardData()
  }, now);

  assert.equal(isContractDraftExpired(draft, now + 14 * 60 * 1000), false);
  assert.equal(isContractDraftExpired(draft, now + 16 * 60 * 1000), true);
  assert.equal(parseContractAutosaveDraft(JSON.stringify(draft), now + 14 * 60 * 1000)?.currentStep, 4);
  assert.equal(parseContractAutosaveDraft(JSON.stringify(draft), now + 16 * 60 * 1000), null);
  assert.equal(clampContractDraftStep(4, 7), 4);
  assert.equal(clampContractDraftStep('8', 7), 7);
  assert.equal(clampContractDraftStep(0, 7), 1);
  assert.equal(clampContractDraftStep('bad', 7), 1);
}

console.log('contractControllerHelpers tests passed');
