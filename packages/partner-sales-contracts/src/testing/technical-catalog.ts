import {
  PartnerTechnicalProductSchema, PartnerTechnicalOperationSchema,
  PartnerTechnicalCatalogQuerySchema, PartnerTechnicalCatalogPageSchema,
  type PartnerTechnicalCatalogPort, type PartnerTechnicalCatalogQuery, type PartnerTechnicalCatalogPage,
} from '../technical-catalog';
import { partnerError, type Result } from '../errors';

export function createPartnerTechnicalCatalogFixtures() {
  const catalogSnapshotVersion = '2026-08-27T10:00:00.000Z';
  return {
    sawKerfMeters: '0.003',
    products: [PartnerTechnicalProductSchema.parse({
      catalogItemId: 'fixture-technical-stone', catalogSnapshotVersion, code: 'FIXTURE-STONE', name: 'سنگ آزمایشی',
      families: ['longitudinal', 'stair', 'slab', 'prepared', 'volumetric'],
      dimensions: { motherWidthCentimeters: '40', motherLengthMeters: '3', thicknessCentimeters: '2' },
      attributes: { stoneType: 'تراورتن', mine: 'معدن آزمایشی', finish: 'صیقلی', color: 'سفید', quality: 'ممتاز', cuttingDimension: 'طولی' },
      isAvailable: true,
    })],
    operations: [
      PartnerTechnicalOperationSchema.parse({ catalogItemId: 'fixture-technical-tool', catalogSnapshotVersion, name: 'ابزار آزمایشی', kind: 'TOOL', unit: 'meter' }),
      PartnerTechnicalOperationSchema.parse({ catalogItemId: 'fixture-technical-finishing', catalogSnapshotVersion, name: 'پرداخت آزمایشی', kind: 'FINISHING', unit: 'squareMeter', incompatibleCatalogItemIds: [] }),
      PartnerTechnicalOperationSchema.parse({ catalogItemId: 'fixture-technical-layer', catalogSnapshotVersion, name: 'لایه آزمایشی', kind: 'LAYER', unit: 'physicalPiece' }),
    ],
  };
}

/** Explicit fixture-only catalog, not an authorization or readiness authority. */
export class FixturePartnerTechnicalCatalogAdapter implements PartnerTechnicalCatalogPort {
  async read(input: PartnerTechnicalCatalogQuery): Promise<Result<PartnerTechnicalCatalogPage>> {
    const parsed = PartnerTechnicalCatalogQuerySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const query = parsed.data;
    const fixtures = createPartnerTechnicalCatalogFixtures();
    const candidates = query.kind === 'PRODUCT'
      ? fixtures.products.filter(item => !query.family || item.families.includes(query.family))
      : fixtures.operations.filter(item => item.kind === query.kind);
    const search = query.search?.toLocaleLowerCase() ?? '';
    const filtered = candidates.filter(item => `${item.name} ${'code' in item ? item.code : ''}`.toLocaleLowerCase().includes(search));
    const cursorIndex = query.cursor ? filtered.findIndex(item => item.catalogItemId === query.cursor) : -1;
    if (query.cursor && cursorIndex < 0) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const items = filtered.slice(cursorIndex + 1, cursorIndex + 1 + (query.limit ?? 50));
    const hasMore = cursorIndex + 1 + items.length < filtered.length;
    return { ok: true, value: PartnerTechnicalCatalogPageSchema.parse({
      schemaVersion: 1, purpose: 'PARTNER_TECHNICAL_CATALOG', kind: query.kind, items,
      ...(hasMore ? { nextCursor: items[items.length - 1].catalogItemId } : {}),
    }) };
  }
}
