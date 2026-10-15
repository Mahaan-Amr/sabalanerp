import type { PartnerTechnicalCatalogPage, PartnerTechnicalOperation, PartnerTechnicalProduct, PartnerTechnicalServiceCatalogItem } from '@sabalanerp/partner-sales-contracts';

type ReadPages = (kind: PartnerTechnicalCatalogPage['kind'], sourceType?: 'tool' | 'cutting' | 'finishing') => Promise<PartnerTechnicalCatalogPage[]>;
/** One creator owns this cache. Frozen versioned display pages expire after
 * their original receive time; permissions and command authority never use it.
 * Failed flights are evicted and a denied read clears all private entries. */
export function coalescePartnerCatalogReads(read: ReadPages, options: {
  ttlMs?: number; now?: () => number; onFresh?: (at: number) => void;
} = {}): ReadPages & { clear: () => void; receivedAt: () => number | null } {
  const flights = new Map<string, Promise<PartnerTechnicalCatalogPage[]>>();
  const cached = new Map<string, { at: number; pages: PartnerTechnicalCatalogPage[] }>();
  const now = options.now ?? Date.now;
  let generation = 0;
  let receivedAt: number | null = null;
  const reader: ReadPages = (kind, sourceType) => {
    const key = `${kind}:${sourceType ?? ''}`;
    const entry = cached.get(key);
    if (entry && now() - entry.at < (options.ttlMs ?? 0)) return Promise.resolve(entry.pages);
    const existing = flights.get(key);
    if (existing) return existing;
    const startedGeneration = generation;
    const flight = read(kind, sourceType).then(pages => {
      if (startedGeneration === generation) {
        const at = now(); receivedAt = at; cached.set(key, { at, pages }); options.onFresh?.(at);
      }
      return pages;
    }).catch(error => {
      if (['FORBIDDEN', 'UNAUTHORIZED', 'ACCESS_DENIED'].includes(error?.code)) {
        generation++; cached.clear(); flights.clear(); receivedAt = null;
      }
      throw error;
    }).finally(() => { if (flights.get(key) === flight) flights.delete(key); });
    flights.set(key, flight);
    return flight;
  };
  return Object.assign(reader, { receivedAt: () => receivedAt, clear: () => { generation++; cached.clear(); flights.clear(); receivedAt = null; } });
}
export async function loadPartnerCreationCatalog(read: ReadPages, publishProducts: (products: PartnerTechnicalProduct[]) => void,
  publishDependencies: (operations: PartnerTechnicalOperation[], services: PartnerTechnicalServiceCatalogItem[]) => void,
  isActive: () => boolean = () => true, options: { products?: boolean } = {}) {
  if (options.products !== false) {
    const productPages = await read('PRODUCT');
    if (!isActive()) return;
    publishProducts(productPages.flatMap(page => page.kind === 'PRODUCT' ? page.items : []).filter(item => item.isAvailable));
  }
  const toolPages = await read('TOOL');
  if (!isActive()) return;
  const finishingPages = await read('FINISHING');
  if (!isActive()) return;
  const layerPages = await read('LAYER');
  if (!isActive()) return;
  const servicePages: PartnerTechnicalCatalogPage[] = [];
  for (const source of ['tool', 'cutting', 'finishing'] as const) {
    servicePages.push(...await read('SERVICE', source));
    if (!isActive()) return;
  }
  publishDependencies([...toolPages, ...finishingPages, ...layerPages].flatMap<PartnerTechnicalOperation>(page =>
    page.kind === 'TOOL' || page.kind === 'FINISHING' || page.kind === 'LAYER' ? page.items : []),
  servicePages.flatMap(page => page.kind === 'SERVICE' ? page.items : []));
}
