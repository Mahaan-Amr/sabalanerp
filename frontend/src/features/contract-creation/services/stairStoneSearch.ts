import { normalizeDigits } from '@/lib/numberFormat';
import type { Product } from '../types/contract.types';
import { generateFullProductName, productSupportsContractRoute } from '../utils/productUtils';

type SearchParameters = {
  search: string;
  limit: number;
  contractType: 'stair' | 'longitudinal';
};

type ProductSearchBody = {
  success?: boolean;
  items?: Product[];
  data?: Product[] | { items?: Product[]; data?: Product[] };
};

type RequestProducts = (parameters: SearchParameters) => Promise<{ data: ProductSearchBody }>;

const normalizeText = (value: string): string =>
  normalizeDigits(value)
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\u200c/g, ' ')
    .toLowerCase();

function matchesCatalogText(product: Product, terms: string[]): boolean {
  const text = normalizeText([
    product.code,
    product.namePersian,
    product.name,
    product.fullName,
    generateFullProductName(product),
    product.cuttingDimensionNamePersian,
    product.stoneTypeNamePersian,
    product.widthName,
    product.thicknessName,
    product.mineNamePersian,
    product.finishNamePersian,
    product.colorNamePersian,
    product.qualityNamePersian,
    product.description,
    product.widthValue?.toString(),
    product.thicknessValue?.toString(),
    product.basePrice?.toString(),
    `${product.widthValue}×${product.thicknessValue}`,
    `عرض ${product.widthValue}×ضخامت ${product.thicknessValue}`
  ].filter(Boolean).join(' '));
  return terms.every(term => text.includes(term));
}

function responseProducts(body: ProductSearchBody): Product[] {
  if (body.success === false) throw new Error('Stone catalogue search failed');
  if (Array.isArray(body.data)) return body.data;
  return body.items ?? body.data?.items ?? body.data?.data ?? [];
}

function eligibleCandidates(candidates: Product[]): Product[] {
  const seen = new Set<string>();
  return candidates.filter(product => {
    const key = product.id ? `id:${product.id}` : product.code ? `code:${product.code}` : null;
    if (key && seen.has(key)) return false;
    // A fresh catalogue record takes precedence over a cached record for the same stone.
    if (key) seen.add(key);
    return productSupportsContractRoute(product, 'stair');
  });
}

export function createStairStoneSearch(localProducts: Product[], requestProducts: RequestProducts) {
  const pending = new Map<string, Promise<Product[]>>();

  async function searchCatalog(search: string): Promise<Product[]> {
    const [stair, longitudinal] = await Promise.all([
      requestProducts({ search, limit: 10, contractType: 'stair' }),
      requestProducts({ search, limit: 10, contractType: 'longitudinal' })
    ]);
    const stairProducts = responseProducts(stair.data);
    const longitudinalProducts = responseProducts(longitudinal.data);
    const terms = normalizeText(search).trim().split(/\s+/).filter(Boolean);
    const localMatches = localProducts.filter(product =>
      productSupportsContractRoute(product, 'stair') && matchesCatalogText(product, terms)
    );
    return eligibleCandidates([...stairProducts, ...longitudinalProducts, ...localMatches]);
  }

  return (term: string): Promise<Product[]> => {
    const search = term.trim();
    if (!search) return Promise.resolve([]);
    const existing = pending.get(search);
    if (existing) return existing;

    const result = searchCatalog(search).finally(() => pending.delete(search));
    pending.set(search, result);
    return result;
  };
}
