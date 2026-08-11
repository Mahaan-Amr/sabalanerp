import assert from 'node:assert/strict';
import { renderContractHtml } from '../printTemplate';

const contract = {
  id: 'contract-accounting-currency-test',
  contractNumber: 'TEST-ACCOUNTING-CURRENCY',
  contractDate: '1405/05/20',
  status: 'DRAFT',
  currency: 'تومان',
  totalAmount: 250,
  customer: {
    firstName: 'مشتری',
    lastName: 'آزمایشی'
  },
  items: [{
    id: 'item-1',
    productName: 'محصول آزمایشی',
    quantity: 2,
    unitPrice: 125,
    totalPrice: 250
  }],
  contractData: {
    payment: {
      currency: 'تومان',
      payments: [{
        method: 'CASH',
        amount: 250,
        status: 'PENDING'
      }]
    }
  }
};

const accountingHtml = renderContractHtml(contract as any, { variant: 'accounting' });

assert.ok(accountingHtml.includes('<th>نرخ - ریال</th>'));
assert.ok(accountingHtml.includes('<th>مبلغ کل - ریال</th>'));
assert.ok(accountingHtml.includes('۱٬۲۵۰ ریال'), 'unit prices should be converted from Toman to Rial');
assert.ok(accountingHtml.includes('۲٬۵۰۰ ریال'), 'totals and payments should be converted from Toman to Rial');
assert.ok(!accountingHtml.includes('تومان'), 'accounting output should contain Rial prices only');
assert.ok(
  !accountingHtml.includes('<span class="rial-equivalent">'),
  'accounting output should not render a second currency line'
);

const originalHtml = renderContractHtml(contract as any, { variant: 'original' });

assert.ok(originalHtml.includes('<th>نرخ - تومان</th>'));
assert.ok(originalHtml.includes('<th>مبلغ کل - تومان</th>'));
assert.ok(originalHtml.includes('۱۲۵'), 'non-accounting unit prices should remain in Toman');
assert.ok(!originalHtml.includes('۱٬۲۵۰ ریال'), 'non-accounting line-item prices should not be converted');

console.log('printTemplateAccountingCurrency tests passed');
