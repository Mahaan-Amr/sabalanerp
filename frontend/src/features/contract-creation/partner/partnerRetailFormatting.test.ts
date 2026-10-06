import assert from 'node:assert/strict';
import test from 'node:test';
import { partnerMoneyText, defaultPartnerRetailRows } from './partnerRetail';

test('retail totals group only whole digits and preserve decimal precision', () => {
  assert.equal(partnerMoneyText('675315000', 'IRT'), '۶۷۵,۳۱۵,۰۰۰ تومان');
  assert.equal(partnerMoneyText('12345.6789', 'IRR'), '۱۲,۳۴۵.۶۷۸۹ ریال');
});

 test('customer rate never defaults to a Sabalan inquiry price and retains an explicit rate', () => {
  const inquiryRow = { rowId: 'inquiry-row', revision: 1, description: 'سنگ', state: 'APPROVED' as const,
    configurationRef: { recoveryId: 'recovery', recoveryRevision: 1, productRowId: 'row' }, configuration: [], usedCaseNumbers: [], approvedPrice: {amount: '700', currency: 'IRT' as const} };
  const row = {productRowId:'row',quantity:'1',unit:'squareMeter',inquiryRow};
  assert.equal(defaultPartnerRetailRows([row])[0].retailUnitPrice.amount, '');
  assert.equal(defaultPartnerRetailRows([{...row,retailUnitPrice:{amount:'900',currency:'IRT'}}])[0].retailUnitPrice.amount, '900');
});
