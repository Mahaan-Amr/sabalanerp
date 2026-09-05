export interface ProductDependentOrder {
  readonly kind: 'layer' | 'remainder';
  readonly order: number;
  readonly identity: string;
}

/** Persisted graph replay order, shared by priced writes and technical preview. */
export const compareProductDependentOrder = (left: ProductDependentOrder, right: ProductDependentOrder): number =>
  left.order - right.order || left.kind.localeCompare(right.kind) || left.identity.localeCompare(right.identity);
