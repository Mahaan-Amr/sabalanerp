import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPrice } from '../../../lib/numberFormat';
import { formatPartnerMoney, formatPartnerMoneyTotal } from '../presentation';

test('money conversion is exact even above safe-number range and preserves fractional rial', () => {
  assert.equal(formatPartnerMoney('9007199254740993', 'IRT', 'IRR'), '۹۰٬۰۷۱٬۹۹۲٬۵۴۷٬۴۰۹٬۹۳۰ ریال');
  assert.equal(formatPartnerMoney('1234567', 'IRR', 'IRT'), '۱۲۳٬۴۵۶٫۷ تومان');
  assert.equal(formatPartnerMoneyTotal('1234567', 'IRT', 'IRR'), '۱۲٬۳۴۵٬۶۷۰ ریال (۱٬۲۳۴٬۵۶۷ تومان)');
  assert.equal(formatPartnerMoneyTotal('12345670', 'IRR', 'IRT'), '۱٬۲۳۴٬۵۶۷ تومان (۱۲٬۳۴۵٬۶۷۰ ریال)');
  assert.equal(formatPartnerMoney('unknown', 'IRT', 'IRR'), 'داده معتبر در دسترس نیست');
});


test('shared contract amounts localize currency codes without converting their value', () => {
  assert.equal(formatPrice('629350100', 'IRT'), '۶۲۹٬۳۵۰٬۱۰۰ تومان');
  assert.equal(formatPrice('629350100', 'IRR'), '۶۲۹٬۳۵۰٬۱۰۰ ریال');
  assert.equal(formatPrice('629350100', 'تومان'), '۶۲۹٬۳۵۰٬۱۰۰ تومان');
});
