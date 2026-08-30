import {
  PartnerTechnicalDraftSchema,
  type PartnerTechnicalDraft,
  type PartnerTechnicalFamily,
  type PartnerTechnicalOperation,
  type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';
import { parseCanonicalDecimal } from '@sabalanerp/contract-product-graph';

type Row = PartnerTechnicalDraft['rows'][number];
type EditingValue = NonNullable<PartnerTechnicalDraft['editingValues']>[number];

const revise = (draft: PartnerTechnicalDraft, changes: Partial<PartnerTechnicalDraft>) =>
  PartnerTechnicalDraftSchema.parse({ ...draft, ...changes, inputRevision: draft.inputRevision + 1 });

export interface PartnerTechnicalProductIdentities {
  productRowId: string;
  sourceBatchId: string;
  stairSystemId: string;
}

/** Adapts the safe catalog projection into the one canonical Partner draft.
 * IDs are issued by the caller and never derived from array position/catalog ID. */
export function addPartnerTechnicalProduct(
  draft: PartnerTechnicalDraft,
  product: PartnerTechnicalProduct,
  family: PartnerTechnicalFamily,
  identities: PartnerTechnicalProductIdentities,
): PartnerTechnicalDraft {
  if (!product.families.includes(family)) throw new Error('Product family is unavailable');
  const identity = { productRowId: identities.productRowId, catalogItemId: product.catalogItemId,
    catalogSnapshotVersion: product.catalogSnapshotVersion };
  let row: Row;
  if (family === 'prepared' || family === 'volumetric') {
    row = { ...identity, family, configuration: { kind: family === 'volumetric' ? 'cubic' : 'readyPiece', unit: 'squareMeter' } };
  } else if (family === 'longitudinal') {
    row = { ...identity, family, configuration: { sourceBatchId: identities.sourceBatchId,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  } else if (family === 'slab') {
    row = { ...identity, family, configuration: { sourceBatchId: identities.sourceBatchId,
      lengthDisplayUnit: 'm', widthDisplayUnit: 'm', sawKerfEnabled: false, sourceRows: [], verticalCutSides: [] } };
  } else {
    row = { ...identity, family, configuration: { stairSystemId: identities.stairSystemId, part: 'tread',
      sourceBatchId: identities.sourceBatchId, quantityMode: 'manual', lengthDisplayUnit: 'm',
      crossDimensionDisplayUnit: 'cm', sawKerfEnabled: false, calibrationEnabled: false,
      calibrationSelection: 'manual' } };
  }
  return revise(draft, { rows: [...draft.rows, row] });
}

type DependentInput =
  | { kind: 'remainder'; parentProductRowId: string; product: PartnerTechnicalProduct; allocationId: string;
      productRowId: string; sourceBatchId: string; creationOrder: number }
  | { kind: 'layer'; parentProductRowId: string; layer: Extract<PartnerTechnicalOperation, { kind: 'LAYER' }>;
      layerConfigurationId: string; sourceBatchId: string; creationOrder: number };

export function addPartnerTechnicalDependent(draft: PartnerTechnicalDraft, input: DependentInput): PartnerTechnicalDraft {
  if (!draft.rows.some(row => row.productRowId === input.parentProductRowId)) throw new Error('Parent row is unavailable');
  const dependent = input.kind === 'remainder'
    ? { kind: 'remainder' as const, creationOrder: input.creationOrder, allocationId: input.allocationId,
        productRowId: input.productRowId, sourceProductRowId: input.parentProductRowId,
        catalogItemId: input.product.catalogItemId, catalogSnapshotVersion: input.product.catalogSnapshotVersion,
        lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const,
        sawKerfEnabled: false, calibrationEnabled: false }
    : { kind: 'layer' as const, creationOrder: input.creationOrder, layerConfigurationId: input.layerConfigurationId,
        parentProductRowId: input.parentProductRowId, sourceBatchId: input.sourceBatchId,
        catalogItemId: input.layer.catalogItemId, catalogSnapshotVersion: input.layer.catalogSnapshotVersion,
        widthDisplayUnit: 'cm' as const, targetSides: [] as Array<'front' | 'back' | 'left' | 'right'>,
        sawKerfEnabled: false, calibrationEnabled: false };
  return revise(draft, { dependents: [...(draft.dependents ?? []), dependent] });
}

export function removePartnerTechnicalProduct(draft: PartnerTechnicalDraft, productRowId: string): PartnerTechnicalDraft {
  const rows = draft.rows.filter(row => row.productRowId !== productRowId);
  if (rows.length === draft.rows.length) return draft;
  const dependents = (draft.dependents ?? []).filter(item => item.kind === 'remainder'
    ? item.sourceProductRowId !== productRowId && item.productRowId !== productRowId
    : item.parentProductRowId !== productRowId);
  const editingValues = (draft.editingValues ?? []).filter(value => value.entityId !== productRowId);
  return revise(draft, { rows, dependents, editingValues });
}

export function retainPartnerTechnicalFieldText(
  draft: PartnerTechnicalDraft,
  entityId: string,
  field: EditingValue['field'],
  text: string,
): PartnerTechnicalDraft {
  const editingValues = [...(draft.editingValues ?? []).filter(value => value.entityId !== entityId || value.field !== field),
    { entityId, field, text }];
  return revise(draft, { editingValues });
}

export function commitPartnerTechnicalField(
  draft: PartnerTechnicalDraft,
  entityId: string,
  field: EditingValue['field'],
  text: string,
): PartnerTechnicalDraft {
  const rowIndex = draft.rows.findIndex(row => row.productRowId === entityId);
  if (rowIndex < 0) throw new Error('Technical row is unavailable');
  const row = draft.rows[rowIndex];
  const supported: Record<Row['family'], readonly EditingValue['field'][]> = {
    prepared: ['quantity'], volumetric: ['quantity'],
    longitudinal: ['lengthMeters', 'widthMeters', 'requestedAreaSquareMeters', 'quantity'],
    slab: ['lengthMeters', 'widthMeters', 'areaSquareMeters', 'quantity'],
    stair: ['lengthMeters', 'crossDimensionMeters', 'motherLengthMeters', 'quantity'],
  };
  if (!supported[row.family].includes(field)) throw new Error('Technical field is unavailable for this family');
  let value: number | ReturnType<typeof parseCanonicalDecimal>;
  if (field === 'quantity') {
    const quantity = Number(text);
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Quantity must be an integer');
    value = quantity;
  } else {
    value = parseCanonicalDecimal(text);
  }
  const rows = [...draft.rows];
  rows[rowIndex] = { ...row, configuration: { ...row.configuration, [field]: value } } as Row;
  const editingValues = (draft.editingValues ?? []).filter(item => item.entityId !== entityId || item.field !== field);
  return revise(draft, { rows, editingValues });
}
