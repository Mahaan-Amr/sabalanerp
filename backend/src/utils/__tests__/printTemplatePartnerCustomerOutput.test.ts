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
assert.equal((html.match(/class="first-page-header"/g) || []).length, 1);
assert.match(html, /<strong>صفحه:<\/strong> <span>۱<\/span>/);
assert.doesNotMatch(html, /margin: 50mm/);
assert.equal(renderCustomerContractPrint(output).headerTemplate, '<span></span>');

const compactOutput = { ...output, products: [
  { ...output.products[0], productRowId: 'a' },
  { ...output.products[0], productRowId: 'b' },
  { ...output.products[0], productRowId: 'c', productCode: 'DIFFERENT' },
  { ...output.products[0], productRowId: 'd', unit: 'meter' },
  { ...output.products[0], productRowId: 'e', description: 'نام متفاوت' },
], deliveries: [
  { ...output.deliveries[0], items: [
    { productRowId: 'a', quantity: '0.1' }, { productRowId: 'b', quantity: '0.2' },
    { productRowId: 'c', quantity: '2' }, { productRowId: 'd', quantity: '3' },
    { productRowId: 'e', quantity: '4' },
  ] },
  { ...output.deliveries[0], deliveryId: 'later', date: '2026-10-16', items: [{ productRowId: 'a', quantity: '0.1' }] },
] };
const compactHtml = renderCustomerContractPrint(compactOutput).htmlContent;
const deliveryTable = compactHtml.match(/<table class="delivery-table">([\s\S]*?)<\/table>/)![1];
assert.equal((deliveryTable.match(/class="delivery-row"/g) || []).length, 5);
assert.match(deliveryTable, /۰\.۳ متر مربع/);
assert.match(deliveryTable, /۰\.۱ متر مربع/);
assert.match(deliveryTable, /۳ متر طول/);
assert.match(deliveryTable, /کد محصول: DIFFERENT/);
assert.match(deliveryTable, /نام متفاوت/);

assert.match(html, /۱۰۰۳۲۸/);
assert.match(html, /۱۰۲۰۹۱۱۰۱۰۱۰۰/);
assert.match(html, /طولی مرمریت/);
assert.match(html, /۱\.۲۵/);
assert.match(html, /۰\.۴/);
assert.match(html, /۱۰/);
assert.match(html, /۱۰٬۰۰۰٬۰۰۰ تومان/);
assert.match(html, /پروژه گل‌دشت/);
assert.match(html, /معالی‌آباد/);
assert.match(html, /انبار مشتری/);
assert.match(html, /برنامه پرداخت/);
assert.doesNotMatch(html, /wholesaleUnitPrice|approvalEvidenceId|resaleDifference/);

const fractionalRate = { ...output, products: [{ ...output.products[0], retailUnitPrice: '4764025.974025974' }] };
const formattedRate = renderCustomerContractPrint(fractionalRate).htmlContent;
assert.match(formattedRate, /۴٬۷۶۴٬۰۲۶ تومان/);
assert.match(formattedRate, /۱۰٬۰۰۰٬۰۰۰ تومان/);
assert.equal(fractionalRate.products[0].retailUnitPrice, '4764025.974025974');

const localized = renderCustomerContractPrint(CustomerContractOutputSchema.parse({ ...output,
  products: [{ ...output.products[0], unit: 'meter' }],
  customerPaymentPlan: { ...output.customerPaymentPlan, installments: [{ ...output.customerPaymentPlan.installments[0],
    method: 'CASH', subtype: 'CARD' }] },
})).htmlContent;
assert.match(localized, /مقدار قراردادی:[^<]*متر/);
assert.match(localized, /نقد - کارت/);
assert.doesNotMatch(localized, />meter<|>CARD<| - CARD/);

console.log('printTemplatePartnerCustomerOutput tests passed');

const execution = renderCustomerContractPrint(CustomerContractOutputSchema.parse({ ...output,
  products: [{...output.products[0],productRowId:'independent-service',productType:'service',description:'ابزار مستقل قرارداد',quantity:'2.5',unit:'meter'}],
  deliveries:[{deliveryId:'execution',date:'2026-09-28',destination:'محل اجرای ابزار',items:[],serviceItems:[{serviceRowId:'independent-service',quantity:'2.5'}]}],
})).htmlContent;
assert.match(execution,/اجرای خدمت: ابزار مستقل قرارداد/);
assert.match(execution,/محل اجرای ابزار/);
assert.match(execution,/۲\.۵/);
