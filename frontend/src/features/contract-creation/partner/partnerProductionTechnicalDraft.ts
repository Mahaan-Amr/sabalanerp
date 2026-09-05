import {
  PartnerTechnicalDraftSchema,
  previewPartnerTechnicalDraft,
  type PartnerTechnicalDraft,
  type PartnerTechnicalFamily,
  type PartnerTechnicalOperation,
  type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';

type IdentityFactory = (kind: string) => string;

export type PartnerProductionTechnicalInput = {
  family: PartnerTechnicalFamily;
  product: PartnerTechnicalProduct;
  quantity: string;
  lengthMeters: string;
  widthMeters: string;
  sourceLengthMeters: string;
  sourceWidthMeters: string;
  tool?: Extract<PartnerTechnicalOperation, { kind: 'TOOL' }>;
  finishing?: Extract<PartnerTechnicalOperation, { kind: 'FINISHING' }>;
  products: PartnerTechnicalProduct[];
  operationsCatalog: PartnerTechnicalOperation[];
  includeRemainder: boolean;
};

const positiveInteger = (value: string) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('Quantity must be a positive integer');
  return parsed;
};

export function buildPartnerProductionTechnicalDraft(input: PartnerProductionTechnicalInput,
  identity: IdentityFactory): PartnerTechnicalDraft {
  const productRowId = identity('product');
  const base = { productRowId, catalogItemId: input.product.catalogItemId,
    catalogSnapshotVersion: input.product.catalogSnapshotVersion };
  const quantity = positiveInteger(input.quantity);
  const sourceBatchId = identity('source');
  const operationGroupId = identity('operation-group');
  const operations = input.family === 'prepared' || input.family === 'volumetric' || (!input.tool && !input.finishing)
    ? undefined : {
      groups: [{ operationGroupId, scope: input.quantity }],
      tools: input.tool ? [{ toolSelectionId: identity('tool'), operationGroupId,
        catalogItemId: input.tool.catalogItemId, catalogSnapshotVersion: input.tool.catalogSnapshotVersion,
        edges: ['front' as const] }] : [],
      finishings: input.finishing ? [{ finishingSelectionId: identity('finishing'), operationGroupId,
        catalogItemId: input.finishing.catalogItemId,
        catalogSnapshotVersion: input.finishing.catalogSnapshotVersion }] : [],
    };
  const row = input.family === 'prepared' || input.family === 'volumetric'
    ? { ...base, family: input.family, configuration: { kind: input.family === 'volumetric' ? 'cubic' as const
      : 'readyPiece' as const, unit: 'count' as const, quantity: input.quantity } }
    : input.family === 'longitudinal'
      ? { ...base, family: 'longitudinal' as const, configuration: { sourceBatchId,
        lengthMeters: input.lengthMeters, widthMeters: input.widthMeters, quantity,
        lastManualField: 'quantity' as const, lastManualDimension: 'length' as const,
        lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const,
        sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' as const },
        ...(operations ? { operations } : {}) }
      : input.family === 'slab'
        ? { ...base, family: 'slab' as const, configuration: { sourceBatchId,
          lengthMeters: input.lengthMeters, widthMeters: input.widthMeters, quantity,
          lastManualField: 'length' as const, lastManualDimension: 'length' as const,
          lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const, sawKerfEnabled: false,
          sourceRows: [{ sourceRowId: identity('slab-source'), lengthMeters: input.sourceLengthMeters,
            widthMeters: input.sourceWidthMeters, quantity, lengthDisplayUnit: 'm' as const,
            widthDisplayUnit: 'm' as const }], verticalCutSides: [] }, ...(operations ? { operations } : {}) }
        : { ...base, family: 'stair' as const, configuration: { stairSystemId: identity('stair-system'),
          part: 'tread' as const, sourceBatchId, lengthMeters: input.lengthMeters,
          crossDimensionMeters: input.widthMeters, quantity, motherLengthMeters: input.sourceLengthMeters,
          motherLengthDisplayUnit: 'm' as const, quantityMode: 'manual' as const,
          lengthDisplayUnit: 'm' as const, crossDimensionDisplayUnit: 'm' as const,
          sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' as const },
          ...(operations ? { operations } : {}) };
  const baseDraft = PartnerTechnicalDraftSchema.parse({ schemaVersion: 1, inputRevision: 1, rows: [row], dependents: [] });
  if (!input.includeRemainder || ['prepared', 'volumetric'].includes(input.family)) return baseDraft;
  const preview = previewPartnerTechnicalDraft(baseDraft,
    { products: input.products, operations: input.operationsCatalog, sawKerfMeters: '0' });
  if (!preview.ok || preview.value.conflicts.length) throw new Error('Canonical remainder inventory is unavailable');
  const stock = preview.value.inventory.find(item => item.ownerProductRowId === productRowId);
  if (!stock) throw new Error('Canonical remainder inventory is unavailable');
  const remainderProduct = input.products.find(item => item.catalogItemId === stock.catalogProductId);
  if (!remainderProduct) throw new Error('Canonical remainder product is unavailable');
  return PartnerTechnicalDraftSchema.parse({ ...baseDraft, dependents: [{ kind: 'remainder',
    creationOrder: stock.creationOrder, allocationId: identity('remainder-allocation'),
    productRowId: identity('remainder-product'), sourceProductRowId: productRowId,
    selectedRemainingStoneId: stock.remainingStoneId, catalogItemId: stock.catalogProductId,
    catalogSnapshotVersion: remainderProduct.catalogSnapshotVersion,
    lengthMeters: stock.lengthMeters, widthMeters: stock.widthMeters, quantity: stock.quantity,
    lengthDisplayUnit: 'm', widthDisplayUnit: 'm', sawKerfEnabled: false, calibrationEnabled: false }] });
}
