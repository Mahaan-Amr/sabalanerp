import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { renderCustomerContractPrint, renderContractHtml } from '../../../backend/src/utils/printTemplate';
const foundationRequire = createRequire(path.resolve(__dirname, '../../../packages/partner-sales-contracts/package.json'));
const { createPartnerFixtures } = foundationRequire('@sabalanerp/partner-sales-contracts/testing');

test('customer print reuses the contract sections with frozen retail facts and no internal branding', () => {
  const content = createPartnerFixtures().customer;
  content.seller.displayName = 'سنگ آفتاب';
  content.products[0].description = '<script>secret()</script>سنگ';
  content.totals = { net: '2000', discount: '100', tax: '190', charges: '20', payable: '2110', currency: 'IRR' };
  const result = renderCustomerContractPrint(content);
  const html = result.htmlContent + result.headerTemplate;
  for (const label of ['سنگ آفتاب', 'تأمین و تحویل توسط سبلان', 'برنامه پرداخت', 'برنامه تحویل', '۲۱۱۰', 'ریال', 'Yekan Bakh']) assert.ok(html.includes(label), label);
  assert.ok(html.includes('&lt;script&gt;'));
  for (const secret of ['<script>', '<img', 'FIXTURE-CASE', 'FIXTURE-INTERNAL', 'fixture-313-row', 'contractData', 'ایجاد کننده:', 'سامانه سبلان']) assert.ok(!html.includes(secret), secret);
  assert.ok(renderContractHtml({ contractNumber: 'ORDINARY', createdByUser: { firstName: 'Ordinary', lastName: 'Seller' } }).includes('ایجاد کننده:'));
});
