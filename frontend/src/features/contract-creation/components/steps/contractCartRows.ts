import type { ContractProduct } from '../../types/contract.types';

export interface ContractCartProjectedRow {
  product: ContractProduct;
  children: ContractProduct[];
}

export const resolveContractRowIndex = (
  products: ContractProduct[],
  rowId: string
): number => products.findIndex(product => product.rowId === rowId);

export const buildContractCartRows = (
  products: ContractProduct[]
): ContractCartProjectedRow[] => {
  const existingRowIds = new Set(
    products.map(product => product.rowId).filter((rowId): rowId is string => Boolean(rowId))
  );
  const childrenByParent = new Map<string, ContractProduct[]>();

  products.forEach(product => {
    const parentRowId = product.parentProductRowId;
    if (!parentRowId || !existingRowIds.has(parentRowId)) return;
    const children = childrenByParent.get(parentRowId) ?? [];
    children.push(product);
    childrenByParent.set(parentRowId, children);
  });

  return products
    .filter(product => !product.parentProductRowId || !existingRowIds.has(product.parentProductRowId))
    .map(product => ({
      product,
      children: product.rowId ? childrenByParent.get(product.rowId) ?? [] : []
    }));
};
