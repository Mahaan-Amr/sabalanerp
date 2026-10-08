import type { PartnerTechnicalCatalogPage, PartnerTechnicalOperation, PartnerTechnicalProduct, PartnerTechnicalServiceCatalogItem } from '@sabalanerp/partner-sales-contracts';

type ReadPages = (kind: PartnerTechnicalCatalogPage['kind'], sourceType?: 'tool' | 'cutting' | 'finishing') => Promise<PartnerTechnicalCatalogPage[]>;
/** Share only in-flight reads within one authenticated creator. Failures are
 * evicted so an explicit retry performs a fresh authorized request. */
export function coalescePartnerCatalogReads(read: ReadPages): ReadPages {
  const flights = new Map<string, Promise<PartnerTechnicalCatalogPage[]>>();
  return (kind, sourceType) => {
    const key = `${kind}:${sourceType ?? ''}`;
    const existing = flights.get(key);
    if (existing) return existing;
    const flight = read(kind, sourceType).finally(() => { flights.delete(key); });
    flights.set(key, flight);
    return flight;
  };
}
export async function loadPartnerCreationCatalog(read: ReadPages, publishProducts: (products: PartnerTechnicalProduct[]) => void,
  publishDependencies: (operations: PartnerTechnicalOperation[], services: PartnerTechnicalServiceCatalogItem[]) => void,
  isActive: () => boolean = () => true) {
  const productPages = await read('PRODUCT');
  if (!isActive()) return;
  publishProducts(productPages.flatMap(page => page.kind === 'PRODUCT' ? page.items : []).filter(item => item.isAvailable));
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
