import type { FormErrorMap } from '@/lib/formErrors';

export const CONTRACT_PRODUCT_GRAPH_ERROR_CODE =
  'contract-product-graph-validation-failed';

export const isContractProductValidationFailure = (
  error: any,
  mappedErrors: FormErrorMap
): boolean => {
  if (error?.response?.status !== 422) return false;
  if (error?.response?.data?.code === CONTRACT_PRODUCT_GRAPH_ERROR_CODE) {
    return true;
  }
  return Object.keys(mappedErrors).some(key =>
    key === 'products' || key.startsWith('productRow:')
  );
};
export const mapProductValidationFailure = (
  error: any,
  mappedErrors: FormErrorMap
): FormErrorMap => {
  if (!isContractProductValidationFailure(error, mappedErrors)) {
    return mappedErrors;
  }
  if (
    mappedErrors.products ||
    Object.keys(mappedErrors).some(key => key.startsWith('productRow:'))
  ) {
    return mappedErrors;
  }
  return {
    products:
      mappedErrors.general ||
      error?.response?.data?.error ||
      'ساختار محصولات قرارداد قابل تشخیص نیست؛ محصولات را بازبینی و دوباره ذخیره کنید'
  };
};
