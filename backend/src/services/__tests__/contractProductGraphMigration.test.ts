import assert from 'node:assert/strict';
import { buildLegacyContractMigrationPlan } from '../contractProductGraphMigration';

const plan = buildLegacyContractMigrationPlan({
  id: 'discounted-contract-with-services',
  totalAmount: 130000,
  contractData: {
    products: [{
      productRowId: 'product-row-1',
      productId: 'catalog-product-1',
      productType: 'longitudinal',
      name: 'Granite',
      totalPrice: 100000
    }],
    serviceRows: [{
      serviceRowId: 'service-row-1',
      totalPrice: 50000
    }],
    discount: {
      amount: 20000
    },
    payment: {
      totalContractAmount: 130000
    }
  }
});

if (!plan.ok) {
  throw new Error(
    `standalone services and contract discounts must not be compared with the product-only graph: ${
      JSON.stringify(plan.conflicts)
    }`
  );
}
assert.deepEqual(plan.reconciliation, {
  legacyTotalAmountToman: '100000',
  canonicalTotalAmountToman: '100000',
  differenceToman: '0',
  matches: true
});

console.log('contract product graph migration tests passed');
