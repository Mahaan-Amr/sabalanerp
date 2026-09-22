import assert from 'node:assert/strict';
import { CustomerContractOutputSchema } from '@sabalanerp/partner-sales-contracts';
import { renderCustomerContractPrint } from '../printTemplate';

const hash = `sha256-v1:${'a'.repeat(64)}`;
const output = CustomerContractOutputSchema.parse({
  schemaVersion: 1,
  purpose: 'CUSTOMER_OUTPUT',
  contractNumber: '100328',
  revision: 2,
  outputHash: hash,
  status: 'APPROVED',
  contractDate: '2026-09-22',
  seller: { displayName: 'فروشنده همکار', phone: '09120000000', address: 'تهران' },
  customer: { displayName: 'مشتری نمونه', phone: '09120000001', address: 'شیراز' },
  products: [{
    productRowId: 'product-row-1',
    productCode: '1020911010100',
    description: 'طولی مرمریت ۴۰ عرض دو سانت',
    productType: 'longitudinal',
    quantity: '5',
    unit: 'm2',
    lengthMeters: '1.25',
    widthMeters: '0.4',
    areaSquareMeters: '5',
    count: '10',
    retailUnitPrice: '2000000',
    retailLineTotal: '10000000',
  }],
  project: { title: 'پروژه گل‌دشت', address: 'معالی‌آباد', managerName: 'مدیر پروژه' },
  totals: { net: '10000000', discount: '0', tax: '0', charges: '0', payable: '10000000', currency: 'IRT' },
  customerPaymentPlan: { planId: 'plan-1', version: 1, effectiveDate: '2026-09-22', installments: [{
    installmentId: 'installment-1', dueDate: '2026-09-25', amount: { amount: '10000000', currency: 'IRT' }, method: 'CASH',
  }] },
  deliveries: [{ deliveryId: 'delivery-1', date: '2026-09-28', destination: 'انبار مشتری',
    items: [{ productRowId: 'product-row-1', quantity: '5' }] }],
  legalText: 'متن حقوقی قرارداد',
  signatures: [],
  confirmation: 'VERIFIED',
});

const html = renderCustomerContractPrint(output).htmlContent;

assert.match(html, /۱۰۰۳۲۸/);
assert.match(html, /۱۰۲۰۹۱۱۰۱۰۱۰۰/);
assert.match(html, /طولی مرمریت/);
assert.match(html, /۱\.۲۵/);
assert.match(html, /۰\.۴/);
assert.match(html, /۱۰/);
assert.match(html, /۱۰۰۰۰۰۰۰/);
assert.match(html, /پروژه گل‌دشت/);
assert.match(html, /معالی‌آباد/);
assert.match(html, /انبار مشتری/);
assert.match(html, /برنامه پرداخت/);
assert.doesNotMatch(html, /wholesaleUnitPrice|approvalEvidenceId|resaleDifference/);

console.log('printTemplatePartnerCustomerOutput tests passed');
