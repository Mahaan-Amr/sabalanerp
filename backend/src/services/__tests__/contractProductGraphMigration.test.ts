import assert from 'node:assert/strict';
import { buildLegacyContractMigrationPlan } from '../contractProductGraphMigration';
import { ContractProductGraphValidationError } from '../contractService';

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

const duplicateDependencyError = new ContractProductGraphValidationError(
  [{
    code: 'duplicate-stable-identity',
    path: ['toolSelections', 'shared-tool-selection'],
    message: 'Canonical product graph contains a duplicate stable identity.'
  }],
  {
    products: [
      {
        rowId: 'original-row',
        operationPolicyInput: {
          tools: [{ toolSelectionId: 'shared-tool-selection' }]
        }
      },
      {
        rowId: 'duplicated-row',
        operationPolicyInput: {
          tools: [{ toolSelectionId: 'shared-tool-selection' }]
        }
      }
    ]
  }
);
assert.equal(duplicateDependencyError.code, 'contract-product-graph-validation-failed');
assert.deepEqual(duplicateDependencyError.issues, [{
  code: 'duplicate-stable-identity',
  path: ['productRow:duplicated-row'],
  message: 'وابستگی‌های محصول تکثیرشده قابل تشخیص نیست؛ محصول را باز کرده و دوباره ذخیره کنید',
  productRowId: 'duplicated-row'
}]);

const operationStructureError = new ContractProductGraphValidationError(
  [{
    code: 'legacy-canonical-input-invalid',
    causeCode: 'duplicate-stable-identity',
    path: ['toolSelections', 'repeated-tool-selection'],
    message: 'Canonical product graph contains a duplicate stable identity.'
  }],
  {
    products: [{
      rowId: 'operation-row',
      operationPolicyInput: {
        tools: [{ toolSelectionId: 'repeated-tool-selection' }]
      }
    }]
  }
);
assert.deepEqual(operationStructureError.issues, [{
  code: 'legacy-canonical-input-invalid',
  causeCode: 'duplicate-stable-identity',
  path: ['productRow:operation-row'],
  message: 'ساختار عملیات این محصول قابل تشخیص نیست؛ ابزارها و پرداخت‌ها را بازبینی و دوباره ذخیره کنید',
  productRowId: 'operation-row'
}]);

const globalGraphError = new ContractProductGraphValidationError(
  [{
    code: 'legacy-canonical-input-invalid',
    path: ['graph'],
    message: 'Internal graph parsing failed.'
  }],
  { products: [{ rowId: 'unresolved-row' }] }
);
assert.deepEqual(globalGraphError.issues, [{
  code: 'legacy-canonical-input-invalid',
  path: ['products'],
  message: 'ساختار محصولات قرارداد قابل تشخیص نیست؛ محصولات را بازبینی و دوباره ذخیره کنید',
  productRowId: undefined
}]);

console.log('contract product graph migration tests passed');
