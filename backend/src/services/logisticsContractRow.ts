/** Resolve row-specific dimensions and quantities without relying on query order. */
export const resolveLogisticsContractRow = (
  contractData: unknown,
  item: { id: string; productId: string; productRowId?: string | null },
): Record<string, any> => {
  const data = contractData && typeof contractData === 'object'
    ? contractData as Record<string, any> : {};
  const products: Array<Record<string, any>> = Array.isArray(data.products) ? data.products
    : Array.isArray(data.items) ? data.items : [];
  const matches = products.filter(row => row && (item.productRowId
    ? row.rowId === item.productRowId : row.productId === item.productId));
  // Older rows without stable identity are usable only if the catalog identity
  // has one unambiguous match. A missing stable row must never fall back to it.
  if (matches.length !== 1 || (matches[0].productId && matches[0].productId !== item.productId)) {
    throw new Error(`Contract row ${item.id} has missing, ambiguous or conflicting product snapshot identity.`);
  }
  return matches[0];
};
