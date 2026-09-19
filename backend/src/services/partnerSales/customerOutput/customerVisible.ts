import type { CustomerContractOutput } from '@sabalanerp/partner-sales-contracts';

/** Commercial content whose change is observable by the customer. Revision-owned
 * identifiers and workflow status do not make an otherwise identical version new. */
export function projectCustomerVisibleRevisionContent(content: CustomerContractOutput) {
  const { outputHash: _outputHash, revision: _revision, status: _status,
    confirmation: _confirmation, ...visible } = content;
  const productAliases = new Map(visible.products.map((product, index) =>
    [product.productRowId, `product-${index + 1}`] as const));
  return {
    ...visible,
    products: visible.products.map(({ productRowId, ...product }) => ({
      ...product,
      productAlias: productAliases.get(productRowId),
    })),
    customerPaymentPlan: {
      effectiveDate: visible.customerPaymentPlan.effectiveDate,
      installments: visible.customerPaymentPlan.installments.map(({ installmentId: _installmentId, ...installment }) => installment),
    },
    deliveries: visible.deliveries.map(({ deliveryId: _deliveryId, ...delivery }) => ({
      ...delivery,
      items: delivery.items.map(({ productRowId, ...item }) => ({
        ...item,
        // Valid output always references a product row. Retaining an unknown
        // identifier fails closed if corrupted evidence reaches comparison.
        productAlias: productAliases.get(productRowId) ?? `unmatched:${productRowId}`,
      })),
    })),
  };
}
