import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { CustomerContractOutputSchema } from '../src';

test('customer output accepts retail evidence but rejects nested wholesale evidence', () => {
  const output = {
    schemaVersion: 1, purpose: 'CUSTOMER_OUTPUT', contractNumber: 'PC-313-1',
    revision: 1, outputHash: 'sha256-v1:' + 'a'.repeat(64), status: 'DRAFT',
    contractDate: '2026-08-27', seller: { displayName: 'همکار نمونه', phone: '09120000000', address: 'تهران' },
    customer: { displayName: 'مشتری نمونه', phone: '09120000001', address: 'تهران' },
    products: [{ productRowId: 'row-313-1', description: 'سنگ طولی', quantity: '2.000', unit: 'm', retailUnitPrice: '1000' }],
    totals: { net: '2000', discount: '0', tax: '0', charges: '0', payable: '2000', currency: 'IRR' },
    customerPaymentPlan: { planId: 'retail-plan-1', version: 1, effectiveDate: '2026-08-27', installments: [] },
    deliveries: [], legalText: 'متن قرارداد', signatures: [], confirmation: 'NOT_SENT',
  };
  assert.equal(CustomerContractOutputSchema.parse(output).contractNumber, 'PC-313-1');
  assert.equal(CustomerContractOutputSchema.safeParse({ ...output, products: [{ ...output.products[0], wholesaleUnitPrice: '800' }] }).success, false);
});
