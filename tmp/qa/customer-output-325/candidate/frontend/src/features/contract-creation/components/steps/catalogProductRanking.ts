import { normalizeDigits } from '@/lib/numberFormat';
import type { ContractUsageType, Product } from '../../types/contract.types';
import { productSupportsContractRoute } from '../../utils/productUtils';

export type CatalogMatchKind =
  | 'personalized'
  | 'catalog-order'
  | 'exact-code'
  | 'exact-name'
  | 'prefix'
  | 'token-fuzzy';

export interface SellerProductHistoryEntry {
  selectionCount: number;
  lastSelectedAt: string | null;
}

export type SellerProductHistory = Record<string, SellerProductHistoryEntry>;

export const recordSellerProductSelection = (
  history: SellerProductHistory,
  productId: string,
  selectedAt: string
): SellerProductHistory => ({
  ...history,
  [productId]: {
    selectionCount: (history[productId]?.selectionCount ?? 0) + 1,
    lastSelectedAt: selectedAt
  }
});

export interface RankedContractCatalogProduct {
  product: Product;
  matchKind: CatalogMatchKind;
}

interface RankContractCatalogProductsInput {
  products: Product[];
  query: string;
  activeType: ContractUsageType | null;
  sellerHistory?: SellerProductHistory;
}

export const normalizeContractCatalogSearchText = (value: unknown): string =>
  normalizeDigits(String(value ?? ''))
    .normalize('NFKC')
    .replace(/\u064a/g, '\u06cc')
    .replace(/\u0649/g, '\u06cc')
    .replace(/\u0643/g, '\u06a9')
    .replace(/\u200c/g, ' ')
    .replace(/[.,،؛:()[\]{}_\-/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('fa');

const getProductName = (product: Product): string =>
  normalizeContractCatalogSearchText(product.namePersian || product.name || product.fullName);

const getSearchableText = (product: Product): string =>
  normalizeContractCatalogSearchText([
    product.code,
    product.namePersian,
    product.name,
    product.fullName,
    product.cuttingDimensionNamePersian,
    product.stoneTypeNamePersian,
    product.widthName,
    product.widthValue,
    product.thicknessName,
    product.thicknessValue,
    product.mineNamePersian,
    product.finishNamePersian,
    product.colorNamePersian,
    product.qualityNamePersian,
    product.description
  ].filter(value => value !== null && value !== undefined && value !== '').join(' '));

const isTokenFuzzyMatch = (searchableText: string, queryTokens: string[]): boolean =>
  queryTokens.every(token => {
    if (searchableText.includes(token)) return true;
    const searchableTokens = searchableText.split(' ');
    return searchableTokens.some(candidate => candidate.startsWith(token) || token.startsWith(candidate));
  });

const getMatchKind = (product: Product, query: string): CatalogMatchKind | null => {
  const normalizedCode = normalizeContractCatalogSearchText(product.code);
  const normalizedName = getProductName(product);
  const searchableText = getSearchableText(product);
  const queryTokens = query.split(' ').filter(Boolean);

  if (normalizedCode === query) return 'exact-code';
  if (normalizedName === query) return 'exact-name';
  if (normalizedCode.startsWith(query) || normalizedName.startsWith(query)) return 'prefix';
  return isTokenFuzzyMatch(searchableText, queryTokens) ? 'token-fuzzy' : null;
};

const matchPriority: Record<Exclude<CatalogMatchKind, 'personalized' | 'catalog-order'>, number> = {
  'exact-code': 0,
  'exact-name': 1,
  prefix: 2,
  'token-fuzzy': 3
};

const getHistoryTime = (entry: SellerProductHistoryEntry | undefined): number => {
  if (!entry?.lastSelectedAt) return 0;
  const timestamp = Date.parse(entry.lastSelectedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export const rankContractCatalogProducts = ({
  products,
  query,
  activeType,
  sellerHistory = {}
}: RankContractCatalogProductsInput): RankedContractCatalogProduct[] => {
  const uniqueProducts = Array.from(new Map(
    products.map(product => [product.id, product] as const)
  ).values());
  const eligible = uniqueProducts
    .map((product, catalogIndex) => ({ product, catalogIndex }))
    .filter(({ product }) =>
      !activeType ||
      productSupportsContractRoute(product, activeType)
    );
  const normalizedQuery = normalizeContractCatalogSearchText(query);

  if (!normalizedQuery) {
    return eligible
      .sort((left, right) => {
        const leftHistory = sellerHistory[left.product.id];
        const rightHistory = sellerHistory[right.product.id];
        const leftPersonalized = (leftHistory?.selectionCount ?? 0) > 0;
        const rightPersonalized = (rightHistory?.selectionCount ?? 0) > 0;
        if (leftPersonalized !== rightPersonalized) return leftPersonalized ? -1 : 1;
        if (leftPersonalized && rightPersonalized) {
          const countDifference = rightHistory.selectionCount - leftHistory.selectionCount;
          if (countDifference !== 0) return countDifference;
          const recencyDifference = getHistoryTime(rightHistory) - getHistoryTime(leftHistory);
          if (recencyDifference !== 0) return recencyDifference;
        }
        return left.catalogIndex - right.catalogIndex;
      })
      .map(({ product }) => ({
        product,
        matchKind: (sellerHistory[product.id]?.selectionCount ?? 0) > 0
          ? 'personalized'
          : 'catalog-order'
      }));
  }

  return eligible
    .map(({ product, catalogIndex }) => ({
      product,
      catalogIndex,
      matchKind: getMatchKind(product, normalizedQuery)
    }))
    .filter((item): item is typeof item & { matchKind: Exclude<CatalogMatchKind, 'personalized' | 'catalog-order'> } =>
      item.matchKind !== null
    )
    .sort((left, right) => {
      const priorityDifference = matchPriority[left.matchKind] - matchPriority[right.matchKind];
      if (priorityDifference !== 0) return priorityDifference;
      const leftHistory = sellerHistory[left.product.id];
      const rightHistory = sellerHistory[right.product.id];
      const countDifference = (rightHistory?.selectionCount ?? 0) - (leftHistory?.selectionCount ?? 0);
      if (countDifference !== 0) return countDifference;
      const recencyDifference = getHistoryTime(rightHistory) - getHistoryTime(leftHistory);
      if (recencyDifference !== 0) return recencyDifference;
      return left.catalogIndex - right.catalogIndex;
    })
    .map(({ product, matchKind }) => ({ product, matchKind }));
};

export const moveCatalogHighlight = (
  currentIndex: number | null,
  direction: 'next' | 'previous',
  resultCount: number
): number | null => {
  if (resultCount <= 0) return null;
  if (currentIndex === null || currentIndex < 0 || currentIndex >= resultCount) {
    return direction === 'next' ? 0 : resultCount - 1;
  }
  return direction === 'next'
    ? (currentIndex + 1) % resultCount
    : (currentIndex - 1 + resultCount) % resultCount;
};

export const resolveHighlightedCatalogProduct = (
  products: Product[],
  highlightedIndex: number | null
): Product | null => {
  if (highlightedIndex === null || highlightedIndex < 0 || highlightedIndex >= products.length) {
    return null;
  }
  return products[highlightedIndex] ?? null;
};
