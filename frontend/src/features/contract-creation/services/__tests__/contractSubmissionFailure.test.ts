import assert from 'node:assert/strict';
import {
  isContractProductValidationFailure,
  mapProductValidationFailure
} from '../../utils/contractSubmissionErrors';
import {
  buildContractSubmissionDiagnostic,
  clearContractSubmissionDiagnostic,
  CONTRACT_SUBMISSION_DIAGNOSTIC_STORAGE_KEY,
  readContractSubmissionDiagnostic,
  storeContractSubmissionDiagnostic
} from '../../utils/contractSubmissionDiagnostics';

const globalProductError = {
  response: {
    status: 422,
    data: {
      success: false,
      code: 'contract-product-graph-validation-failed',
      error: 'اطلاعات محصولات قرارداد نیاز به بازبینی دارد',
      details: [{
        code: 'legacy-canonical-input-invalid',
        causeCode: 'duplicate-stable-identity',
        path: 'products',
        message: 'ساختار محصولات قرارداد قابل تشخیص نیست؛ محصولات را بازبینی و دوباره ذخیره کنید'
      }]
    }
  }
};

assert.equal(
  isContractProductValidationFailure(globalProductError, {
    products: globalProductError.response.data.details[0].message
  }),
  true
);
assert.deepEqual(
  mapProductValidationFailure(globalProductError, {
    products: globalProductError.response.data.details[0].message
  }),
  {
    products: 'ساختار محصولات قرارداد قابل تشخیص نیست؛ محصولات را بازبینی و دوباره ذخیره کنید'
  }
);
assert.deepEqual(
  mapProductValidationFailure(globalProductError, {
    general: 'اطلاعات محصولات قرارداد نیاز به بازبینی دارد'
  }),
  {
    products: 'اطلاعات محصولات قرارداد نیاز به بازبینی دارد'
  }
);

const rowError = {
  response: {
    status: 422,
    data: {
      code: 'contract-product-graph-validation-failed',
      details: [{
        code: 'legacy-canonical-input-invalid',
        causeCode: 'duplicate-stable-identity',
        path: 'productRow:row-4',
        productRowId: 'row-4',
        message: 'ساختار عملیات این محصول قابل تشخیص نیست؛ ابزارها و پرداخت‌ها را بازبینی و دوباره ذخیره کنید'
      }]
    }
  }
};
assert.deepEqual(buildContractSubmissionDiagnostic(rowError, 1_000), {
  occurredAt: 1_000,
  httpStatus: 422,
  errorCode: 'contract-product-graph-validation-failed',
  causeCode: 'duplicate-stable-identity',
  errorPath: 'productRow:row-4',
  productRowId: 'row-4'
});

const values = new Map<string, string>();
const storage = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => {
    values.set(key, value);
  },
  removeItem: (key: string) => {
    values.delete(key);
  }
};
storeContractSubmissionDiagnostic(rowError, storage);
const stored = JSON.parse(values.get(CONTRACT_SUBMISSION_DIAGNOSTIC_STORAGE_KEY)!);
assert.equal(stored.httpStatus, 422);
assert.equal(stored.productRowId, 'row-4');
assert.equal('payload' in stored, false);
assert.equal('products' in stored, false);
assert.equal(readContractSubmissionDiagnostic(storage)?.errorCode,
  'contract-product-graph-validation-failed');
clearContractSubmissionDiagnostic(storage);
assert.equal(values.size, 0);

console.log('contract submission failure tests passed');
