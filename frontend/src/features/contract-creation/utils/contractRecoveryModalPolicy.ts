export interface ProductModalRecoveryState<SelectedProduct> {
  readonly showProductModal: boolean;
  readonly selectedProduct: SelectedProduct | null;
  readonly returnToProductModalAfterRemainder: boolean;
}

export const resolveProductModalRecoveryState = <SelectedProduct>(
  state: ProductModalRecoveryState<SelectedProduct>,
  editRecoveryBlocked: boolean
): ProductModalRecoveryState<SelectedProduct> => {
  if (!editRecoveryBlocked) return state;

  return {
    showProductModal: false,
    selectedProduct: null,
    returnToProductModalAfterRemainder: false
  };
};
