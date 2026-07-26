export type StableIdentityKind =
  | 'allocation'
  | 'audit-mutation'
  | 'finishing-selection'
  | 'layer-configuration'
  | 'layer-operation-collection'
  | 'layer-source-row'
  | 'operation-group'
  | 'product-row'
  | 'remaining-stone'
  | 'source-batch'
  | 'slab-source-row'
  | 'stair-system'
  | 'tool-selection';

declare const stableIdentityBrand: unique symbol;

export type StableIdentity<Kind extends StableIdentityKind> = string & {
  readonly [stableIdentityBrand]: Kind;
};

export const parseStableIdentity = <Kind extends StableIdentityKind>(
  kind: Kind,
  value: string
): StableIdentity<Kind> => {
  const normalized = value.trim();
  if (!normalized) {
    throw new TypeError(`Stable ${kind} identity is required.`);
  }
  return normalized as StableIdentity<Kind>;
};
