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

export const inferLogisticsContractUnit = (item: { productType: string | null }, snapshot: Record<string, any> | null) => {
  const explicitUnit = snapshot?.unit || snapshot?.preparedUnit || snapshot?.meta?.unit;
  if (explicitUnit) {
    const unit = String(explicitUnit);
    if (unit.includes('متر طول') || unit === 'meter') return 'meter';
    if (unit.includes('متر مربع') || unit === 'squareMeter') return 'squareMeter';
    if (unit.includes('عدد') || unit === 'count') return 'count';
    return unit;
  }

  const productType = String(item?.productType || snapshot?.productType || '').toLowerCase();
  if (productType.includes('longitudinal') || productType.includes('طولی')) return 'meter';
  if (productType.includes('slab') || productType.includes('اسلب')) return 'squareMeter';
  return 'count';
};
