import assert from 'node:assert/strict';
import { mapAxiosFormErrors } from '../../../../lib/formErrors';
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
import {
  finalizeSuccessfulContractCommit,
  getContractDetailDestination,
  getCreatedContractDestination,
  isContractDateOlderThanToday
} from '../../utils/contractCreationCompletion';

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
const recoveryMessage = 'ردیف 2؛ منبع سنگ: ردیف 1؛ وابسته: ردیف 3. ترتیب ساخت مجدد: ردیف 2 سپس ردیف 3. پیش‌نویس حفظ شده است. کد پیگیری: recovery-test';
const recoveryError = { response: { status: 422, data: { code: 'contract-product-graph-validation-failed',
  trackingId: 'recovery-test', details: [{ path: 'productRow:row-2', message: recoveryMessage }] } } };
assert.deepEqual(mapProductValidationFailure(recoveryError, mapAxiosFormErrors(recoveryError, 'fallback')),
  { 'productRow:row-2': recoveryMessage }, 'Complete chain guidance survives the shared create/edit error mapping');
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

assert.equal(
  getCreatedContractDestination('contract/with spaces'),
  '/dashboard/sales/contracts/contract%2Fwith%20spaces?created=1'
);
assert.equal(
  getContractDetailDestination('contract/with spaces'),
  '/dashboard/sales/contracts/contract%2Fwith%20spaces'
);
assert.equal(isContractDateOlderThanToday('1405/05/27', '1405/05/29'), true);
assert.equal(isContractDateOlderThanToday('1405/05/29', '1405/05/29'), false);
assert.equal(isContractDateOlderThanToday('1405/05/30', '1405/05/29'), false);

const runCompletionAssertions = async () => {
  const completionEvents: string[] = [];
  await finalizeSuccessfulContractCommit({
    contractId: 'contract-1',
    finalizeRecovery: async () => {
      completionEvents.push('cleanup');
      throw new Error('cleanup failed');
    },
    navigate: (destination) => completionEvents.push(`navigate:${destination}`),
    logCleanupError: () => completionEvents.push('logged')
  });
  assert.deepEqual(completionEvents, [
    'cleanup',
    'logged',
    'navigate:/dashboard/sales/contracts/contract-1?created=1'
  ], 'a committed contract must navigate successfully even when recovery cleanup fails');

  const editDestinations: string[] = [];
  await finalizeSuccessfulContractCommit({
    contractId: 'contract-1',
    justCreated: false,
    navigate: (destination) => editDestinations.push(destination)
  });
  assert.deepEqual(editDestinations, [
    '/dashboard/sales/contracts/contract-1'
  ], 'an edited contract must not be presented as newly created');
};

runCompletionAssertions()
  .then(() => console.log('contract submission failure tests passed'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
