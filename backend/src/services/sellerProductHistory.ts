export interface SellerProductHistoryEntry {
  selectionCount: number;
  lastSelectedAt: string;
}

export type SellerProductHistory = Record<string, SellerProductHistoryEntry>;

interface ContractHistorySource {
  createdAt: Date;
  contractData: unknown;
}

const readProducts = (contractData: unknown): unknown[] => {
  if (!contractData || typeof contractData !== 'object') return [];
  const products = (contractData as { products?: unknown }).products;
  return Array.isArray(products) ? products : [];
};

const readCatalogProductId = (value: unknown): string | null => {
  if (!value || typeof value !== 'object') return null;
  const row = value as { productId?: unknown; product?: { id?: unknown } };
  const candidate = row.productId ?? row.product?.id;
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
};

export const buildSellerProductHistory = (
  contracts: ContractHistorySource[]
): SellerProductHistory => {
  const history: SellerProductHistory = {};

  contracts.forEach(contract => {
    const selectedAt = contract.createdAt.toISOString();
    readProducts(contract.contractData).forEach(product => {
      const productId = readCatalogProductId(product);
      if (!productId) return;
      const current = history[productId];
      history[productId] = {
        selectionCount: (current?.selectionCount ?? 0) + 1,
        lastSelectedAt: !current || selectedAt > current.lastSelectedAt
          ? selectedAt
          : current.lastSelectedAt
      };
    });
  });

  return history;
};
