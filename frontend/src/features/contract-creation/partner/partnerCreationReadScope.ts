import { coalescePartnerCatalogReads } from './partnerCreationCatalogLoader';

type CatalogRead = Parameters<typeof coalescePartnerCatalogReads>[0];
/** Display data lives only in this mounted creator, across its internal steps.
 * Case/authority reads share pending work only; they are never cached. */
export function createPartnerCreationReadScope(options: { now?: () => number } = {}) {
  let actor: string | null = null;
  let catalog: ReturnType<typeof coalescePartnerCatalogReads> | undefined;
  const flights = new Map<string, Promise<unknown>>();
  const clear = () => { catalog?.clear(); catalog = undefined; flights.clear(); actor = null; };
  const select = (next: string) => { if (actor !== next) { clear(); actor = next; } };
  return {
    clear,
    catalog(actorId: string, read: CatalogRead) {
      select(actorId);
      return catalog ??= coalescePartnerCatalogReads(read, { ttlMs: 60_000, now: options.now });
    },
    read<T>(actorId: string, key: string, request: () => Promise<T>): Promise<T> {
      select(actorId);
      const existing = flights.get(key);
      if (existing) return existing as Promise<T>;
      const flight = request().catch(error => {
        if (actor === actorId && (error?.code === 'FORBIDDEN' || error?.response?.status === 403 || error?.response?.status === 401)) clear();
        throw error;
      }).finally(() => { if (flights.get(key) === flight) flights.delete(key); });
      flights.set(key, flight);
      return flight;
    },
  };
}
