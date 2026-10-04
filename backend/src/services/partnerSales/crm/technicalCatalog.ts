import { parseCanonicalDecimal } from '@sabalanerp/contract-product-graph';
import { Prisma } from '@prisma/client';
import {
  PartnerTechnicalProductSchema, PartnerTechnicalOperationSchema, partnerError,
  type PartnerTechnicalFamily, type PartnerTechnicalProduct, type PartnerTechnicalOperation, type Result,
} from '@sabalanerp/partner-sales-contracts';

type InventoryDecimal = string | { toString(): string };
export interface TechnicalProductSource {
  id: string; code: string; namePersian: string; updatedAt: Date;
  widthValue: InventoryDecimal | null; motherLengthValue: InventoryDecimal | null;
  thicknessValue: InventoryDecimal | null;
  stoneTypeNamePersian: string; mineNamePersian: string; finishNamePersian: string;
  colorNamePersian: string; qualityNamePersian: string; cuttingDimensionNamePersian: string;
  isActive: boolean; deletedAt: Date | null; isAvailable: boolean;
  availableInLongitudinalContracts: boolean; availableInStairContracts: boolean;
  availableInSlabContracts: boolean; availableInVolumetricContracts: boolean;
  preparedSalesUnit: string; volumetricSalesUnit: string;
  basePrice?: InventoryDecimal | null; currency?: string;
}

export function catalogMaterialRateToman(value: InventoryDecimal, currency: string): string {
  if (!['ریال', 'IRR', 'تومان', 'IRT'].includes(currency)) throw new Error('Unknown catalog currency');
  return parseCanonicalDecimal(new Prisma.Decimal(value.toString()).div(currency === 'ریال' || currency === 'IRR' ? 10 : 1).toFixed());
}

type TechnicalOperationSource = { id: string; updatedAt: Date; isActive: boolean } & (
  | { kind: 'TOOL'; namePersian: string; calculationBase: string }
  | { kind: 'FINISHING'; namePersian: string; calculationBase: string; incompatibleCatalogItemIds: readonly string[] }
  | { kind: 'LAYER'; name: string; calculationUnit: string }
);

export function projectPartnerTechnicalOperation(source: TechnicalOperationSource): Result<PartnerTechnicalOperation> {
  try {
    if (source.isActive !== true) return { ok: false, error: partnerError('NOT_FOUND') };
    const identity = { catalogItemId: source.id, catalogSnapshotVersion: source.updatedAt.toISOString() };
    const operationUnit = (base: string) => base === 'length' ? 'meter' : base === 'squareMeters' ? 'squareMeter' : undefined;
    const item = source.kind === 'LAYER'
      ? { ...identity, kind: source.kind, name: source.name, unit: source.calculationUnit }
      : { ...identity, kind: source.kind, name: source.namePersian, unit: operationUnit(source.calculationBase),
          ...(source.kind === 'FINISHING' ? { incompatibleCatalogItemIds: source.incompatibleCatalogItemIds } : {}),
        };
    return { ok: true, value: PartnerTechnicalOperationSchema.parse(item) };
  } catch {
    return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  }
}

/** Projection only. The authenticated catalog producer must authorize before
 * reading candidates/counts; passing an inventory row here grants no access.
 * Never spread the source: only the normalized ordinary catalog suggestion is
 * public; responder quotes and other private evidence do not enter this DTO.
 */
export function projectPartnerTechnicalProduct(source: TechnicalProductSource): Result<PartnerTechnicalProduct> {
  try {
    if (source.isActive !== true || source.deletedAt !== null) {
      return { ok: false, error: partnerError('NOT_FOUND') };
    }
    const dimension = (value: InventoryDecimal | null) => {
      if (value === null) return undefined;
      const normalized = parseCanonicalDecimal(value.toString());
      // Inventory uses zero for an unspecified catalog dimension (notably
      // slab width and prepared-stone thickness). Keep the product selectable;
      // its configuration must still supply any required physical geometry.
      return normalized === '0' ? undefined : normalized;
    };
    const families: PartnerTechnicalFamily[] = [];
    if (source.availableInLongitudinalContracts) families.push('longitudinal');
    if (source.availableInStairContracts) families.push('stair');
    if (source.availableInSlabContracts) families.push('slab');
    // The existing volumetric eligibility owns both the current prepared picker
    // and historical volumetric rows; it is not a newly inferred product family.
    if (source.availableInVolumetricContracts) families.push('prepared', 'volumetric');
    return { ok: true, value: PartnerTechnicalProductSchema.parse({
      catalogItemId: source.id, catalogSnapshotVersion: source.updatedAt.toISOString(),
      code: source.code, name: source.namePersian, families,
      ...(source.basePrice != null && new Prisma.Decimal(source.basePrice.toString()).gt(0)
        ? { suggestedRetailUnitPrice: { amount: catalogMaterialRateToman(source.basePrice, source.currency ?? ''), currency: 'IRT' } } : {}),
      salesUnits: { prepared: source.preparedSalesUnit, volumetric: source.volumetricSalesUnit },
      dimensions: {
        motherWidthCentimeters: dimension(source.widthValue),
        motherLengthMeters: dimension(source.motherLengthValue),
        thicknessCentimeters: dimension(source.thicknessValue),
      },
      attributes: {
        stoneType: source.stoneTypeNamePersian, mine: source.mineNamePersian,
        finish: source.finishNamePersian, color: source.colorNamePersian,
        quality: source.qualityNamePersian, cuttingDimension: source.cuttingDimensionNamePersian,
      },
      isAvailable: source.isAvailable,
    }) };
  } catch {
    // Neither a validator diagnostic nor a source value crosses this seam.
    return { ok: false, error: partnerError('INVALID_PAYLOAD') };
  }
}
