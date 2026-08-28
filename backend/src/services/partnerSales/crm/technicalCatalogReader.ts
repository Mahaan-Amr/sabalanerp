import type { Prisma } from '@prisma/client';
import { PartnerTechnicalCatalogQuerySchema, PartnerTechnicalCatalogPageSchema, partnerError,
  type PartnerTechnicalCatalogPort, type PartnerTechnicalFamily, type PartnerTechnicalProduct,
  type PartnerTechnicalOperation, type Result } from '@sabalanerp/partner-sales-contracts';
import { createAuditedPartnerAuthorization } from '../authorization/audited';
import { projectPartnerTechnicalProduct, projectPartnerTechnicalOperation } from './technicalCatalog';

// Query only the public technical projection's source fields. Prices, notes,
// customer relationships and future inventory fields cannot be spread outward.
const productSelect = { id: true, code: true, namePersian: true, updatedAt: true,
  widthValue: true, motherLengthValue: true, thicknessValue: true, stoneTypeNamePersian: true,
  mineNamePersian: true, finishNamePersian: true, colorNamePersian: true, qualityNamePersian: true, cuttingDimensionNamePersian: true,
  isActive: true, deletedAt: true, isAvailable: true, availableInLongitudinalContracts: true,
  availableInStairContracts: true, availableInSlabContracts: true, availableInVolumetricContracts: true } satisfies Prisma.ProductSelect;
const familyFilter: Record<PartnerTechnicalFamily, Prisma.ProductWhereInput> = {
  longitudinal: { availableInLongitudinalContracts: true }, stair: { availableInStairContracts: true },
  slab: { availableInSlabContracts: true }, prepared: { availableInVolumetricContracts: true }, volumetric: { availableInVolumetricContracts: true },
};

/** Transaction-scoped safe catalog producer for the creator's Partner form.
 * No route mount, inventory permission fallback, raw inventory DTO or new pool. */
export function createPartnerTechnicalCatalogReader(tx: Prisma.TransactionClient, binding: { actorId: string; correlationId: string }): PartnerTechnicalCatalogPort {
  return { async read(input) {
    const parsed = PartnerTechnicalCatalogQuerySchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: partnerError('INVALID_PAYLOAD') };
    const profile = await tx.partnerProfile.findUnique({ where: { userId: binding.actorId }, select: { id: true } });
    if (!profile) return { ok: false, error: partnerError('NOT_FOUND') };
    const root = { kind: 'PROFILE' as const, id: profile.id };
    const authority = createAuditedPartnerAuthorization(tx, { actorId: binding.actorId, purpose: 'PARTNER', channel: 'SEARCH' }, binding);
    const allowed = await authority.authorize('CASE_READ', root);
    if (!allowed.ok) return allowed;
    const query = parsed.data;
    const limit = query.limit ?? 50;
    let projectedRows: Array<{ id: string; result: Result<PartnerTechnicalProduct | PartnerTechnicalOperation> }>;
    if (query.kind !== 'PRODUCT') {
      const where = { isActive: true, ...(query.cursor ? { id: { gt: query.cursor } } : {}),
        ...(query.search ? { OR: [{ code: { contains: query.search, mode: 'insensitive' as const } },
          query.kind === 'LAYER' ? { name: { contains: query.search, mode: 'insensitive' as const } }
            : { namePersian: { contains: query.search, mode: 'insensitive' as const } }] } : {}) };
      const selection = { id: true, updatedAt: true, isActive: true, namePersian: true, calculationBase: true } as const;
      projectedRows = query.kind === 'TOOL'
        ? (await tx.subService.findMany({ where, select: selection, take: limit + 1, orderBy: { id: 'asc' } }))
          .map(row => ({ id: row.id, result: projectPartnerTechnicalOperation({ ...row, kind: 'TOOL' }) }))
        : query.kind === 'FINISHING'
          ? (await tx.stoneFinishing.findMany({ where, select: selection, take: limit + 1, orderBy: { id: 'asc' } }))
            // Current Inventory has no persisted incompatibility relation; this
            // matches its existing catalog. Never invent conflicting ids/rates.
            .map(row => ({ id: row.id, result: projectPartnerTechnicalOperation({ ...row, kind: 'FINISHING', incompatibleCatalogItemIds: [] }) }))
          : (await tx.layerType.findMany({ where, select: { id: true, updatedAt: true, isActive: true, name: true, calculationUnit: true },
            take: limit + 1, orderBy: { id: 'asc' } }))
            .map(row => ({ id: row.id, result: projectPartnerTechnicalOperation({ ...row, kind: 'LAYER' }) }));
    } else {
      const rows = await tx.product.findMany({ select: productSelect, orderBy: { id: 'asc' }, take: limit + 1,
      where: { isActive: true, deletedAt: null, ...(query.cursor ? { id: { gt: query.cursor } } : {}),
        AND: [query.family ? familyFilter[query.family] : { OR: Object.values(familyFilter) },
          ...(query.search ? [{ OR: [{ code: { contains: query.search, mode: 'insensitive' as const } },
            { namePersian: { contains: query.search, mode: 'insensitive' as const } }] }] : [])] } });
      projectedRows = rows.map(row => ({ id: row.id, result: projectPartnerTechnicalProduct(row) }));
    }
    const items: Array<PartnerTechnicalProduct | PartnerTechnicalOperation> = [];
    for (const { result } of projectedRows.slice(0, limit)) {
      if (!result.ok) return result;
      items.push(result.value);
    }
    const refreshed = await authority.authorize('CASE_READ', root);
    if (!refreshed.ok) return refreshed;
    const page = PartnerTechnicalCatalogPageSchema.safeParse({ schemaVersion: 1, purpose: query.purpose, kind: query.kind, items,
      ...(projectedRows.length > limit ? { nextCursor: projectedRows[limit - 1].id } : {}) });
    return page.success ? { ok: true, value: page.data } : { ok: false, error: partnerError('INTEGRITY_CONFLICT') };
  } };
}
