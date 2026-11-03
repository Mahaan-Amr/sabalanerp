import assert from 'node:assert/strict';
import {
  contractCorrectionCategoryLabel,
  contractCorrectionBannerTitle,
} from '../contractCorrectionPresentation';

assert.equal(contractCorrectionCategoryLabel('OTHER'), 'سایر');
assert.equal(contractCorrectionCategoryLabel('AMOUNT_PRICING'), 'مبلغ و قیمت');
assert.equal(contractCorrectionCategoryLabel('UNKNOWN'), 'سایر');
assert.equal(
  contractCorrectionBannerTitle('اصلاح'),
  'اصلاح قرارداد با تأیید حسابداری — اصلاح',
);
assert.equal(contractCorrectionBannerTitle('  '), 'اصلاح قرارداد با تأیید حسابداری');

console.log('contract correction presentation tests passed');
