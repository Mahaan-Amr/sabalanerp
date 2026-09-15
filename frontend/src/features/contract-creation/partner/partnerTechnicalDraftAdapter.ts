import {
  PartnerTechnicalDraftSchema,
  type PartnerTechnicalDraft,
  type PartnerTechnicalFamily,
  type PartnerTechnicalOperation,
  type PartnerTechnicalProduct,
} from '@sabalanerp/partner-sales-contracts';
import { parseCanonicalDecimal } from '@sabalanerp/contract-product-graph';
import { normalizeNumericText } from '@/lib/numberFormat';

type Row = PartnerTechnicalDraft['rows'][number];
type EditingValue = NonNullable<PartnerTechnicalDraft['editingValues']>[number];

const revise = (draft: PartnerTechnicalDraft, changes: Partial<PartnerTechnicalDraft>) =>
  PartnerTechnicalDraftSchema.parse({ ...draft, ...changes, inputRevision: draft.inputRevision + 1 });

export type PartnerTechnicalProductInput =
  | { family: 'prepared' | 'volumetric'; productRowId: string }
  | { family: 'longitudinal' | 'slab'; productRowId: string; sourceBatchId: string }
  | { family: 'stair'; productRowId: string; sourceBatchId: string; stairSystemId: string };

/** Adapts the safe catalog projection into the one canonical Partner draft.
 * IDs are issued by the caller and never derived from array position/catalog ID. */
export function addPartnerTechnicalProduct(
  draft: PartnerTechnicalDraft,
  product: PartnerTechnicalProduct,
  input: PartnerTechnicalProductInput,
): PartnerTechnicalDraft {
  const family: PartnerTechnicalFamily = input.family;
  if (!product.families.includes(family)) throw new Error('Product family is unavailable');
  const identity = { productRowId: input.productRowId, catalogItemId: product.catalogItemId,
    catalogSnapshotVersion: product.catalogSnapshotVersion };
  let row: Row;
  if (input.family === 'prepared' || input.family === 'volumetric') {
    row = { ...identity, family: input.family, configuration: { kind: input.family === 'volumetric' ? 'cubic' : 'readyPiece', unit: 'squareMeter' } };
  } else if (input.family === 'longitudinal') {
    row = { ...identity, family: 'longitudinal', configuration: { sourceBatchId: input.sourceBatchId,
      lastManualField: 'length', lastManualDimension: 'length', lengthDisplayUnit: 'm', widthDisplayUnit: 'cm',
      sawKerfEnabled: false, calibrationEnabled: false, calibrationSelection: 'manual' } };
  } else if (input.family === 'slab') {
    row = { ...identity, family: 'slab', configuration: { sourceBatchId: input.sourceBatchId,
      lengthDisplayUnit: 'm', widthDisplayUnit: 'm', sawKerfEnabled: false, sourceRows: [], verticalCutSides: [] } };
  } else if (input.family === 'stair') {
    row = { ...identity, family: 'stair', configuration: { stairSystemId: input.stairSystemId, part: 'tread',
      sourceBatchId: input.sourceBatchId, quantityMode: 'manual', lengthDisplayUnit: 'm',
      crossDimensionDisplayUnit: 'cm', sawKerfEnabled: false, calibrationEnabled: false,
      calibrationSelection: 'manual' } };
  } else {
    throw new Error('Product family is unavailable');
  }
  return revise(draft, { rows: [...draft.rows, row] });
}

/** A standalone rate inquiry needs a canonical stone identity but must not ask
 * for contract quantities, cuts, tools, payment, customer, or project. Minimal
 * geometry is therefore generated only for the protected calculation record;
 * the optional dimensions shown to the responder travel separately on the
 * inquiry command and never affect approval validity. */
export function addPartnerQuickInquiryProduct(draft: PartnerTechnicalDraft, product: PartnerTechnicalProduct,
  family: PartnerTechnicalFamily, productRowId: string): PartnerTechnicalDraft {
  const sourceBatchId = `source-batch:${crypto.randomUUID()}`;
  const stairSystemId = `stair-system:${crypto.randomUUID()}`;
  const added = family === 'prepared' || family === 'volumetric'
    ? addPartnerTechnicalProduct(draft, product, { family, productRowId })
    : family === 'stair'
      ? addPartnerTechnicalProduct(draft, product, { family, productRowId, sourceBatchId, stairSystemId })
      : addPartnerTechnicalProduct(draft, product, { family, productRowId, sourceBatchId });
  const lengthMeters = product.dimensions.motherLengthMeters ?? '1';
  const widthMeters = product.dimensions.motherWidthCentimeters
    ? parseCanonicalDecimal(String(Number(product.dimensions.motherWidthCentimeters) / 100)) : '1';
  const areaSquareMeters = parseCanonicalDecimal(String(Number(lengthMeters) * Number(widthMeters)));
  const rows = added.rows.map(row => {
    if (row.productRowId !== productRowId) return row;
    if (row.family === 'prepared') return { ...row, configuration: { ...row.configuration, unit: 'count' as const, quantity: '1' } };
    if (row.family === 'volumetric') return { ...row, configuration: { ...row.configuration, unit: 'ton' as const, quantity: '1' } };
    if (row.family === 'longitudinal') return { ...row, configuration: { ...row.configuration,
      lengthMeters, widthMeters, requestedAreaSquareMeters: areaSquareMeters, quantity: 1 } };
    if (row.family === 'slab') return { ...row, configuration: { ...row.configuration,
      lengthMeters, widthMeters, areaSquareMeters, quantity: 1,
      sourceRows: [{ sourceRowId: `slab-source-row:${crypto.randomUUID()}`, lengthMeters, widthMeters, quantity: 1,
        lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const }] } };
    return { ...row, configuration: { ...row.configuration, lengthMeters,
      crossDimensionMeters: widthMeters, motherLengthMeters: lengthMeters, quantity: 1, quantityMode: 'manual' as const } };
  });
  return PartnerTechnicalDraftSchema.parse({ ...added, inputRevision: added.inputRevision + 1, rows });
}

type DependentInput =
  | { kind: 'remainder'; parentProductRowId: string; product: PartnerTechnicalProduct; allocationId: string;
      productRowId: string; creationOrder: number; selectedRemainingStoneId?: string;
      sourcePieceQuantities?: number[]; secondaryOwnerProductRowId?: string }
  | { kind: 'layer'; parentProductRowId: string; layer: Extract<PartnerTechnicalOperation, { kind: 'LAYER' }>;
      layerConfigurationId: string; sourceBatchId: string; creationOrder: number };

export function addPartnerTechnicalDependent(draft: PartnerTechnicalDraft, input: DependentInput): PartnerTechnicalDraft {
  const parentExists = input.kind === 'layer'
    ? draft.rows.some(row => row.family === 'stair' && row.productRowId === input.parentProductRowId)
    : draft.rows.some(row => row.productRowId === input.parentProductRowId) ||
      (draft.dependents ?? []).some(item => item.kind === 'remainder' && item.productRowId === input.parentProductRowId);
  if (!parentExists) throw new Error('Parent row is unavailable');
  const dependent = input.kind === 'remainder'
    ? { kind: 'remainder' as const, creationOrder: input.creationOrder, allocationId: input.allocationId,
        productRowId: input.productRowId, sourceProductRowId: input.parentProductRowId,
        catalogItemId: input.product.catalogItemId, catalogSnapshotVersion: input.product.catalogSnapshotVersion,
        lengthDisplayUnit: 'm' as const, widthDisplayUnit: 'm' as const,
        sawKerfEnabled: false, calibrationEnabled: false,
        ...(input.selectedRemainingStoneId ? { selectedRemainingStoneId: input.selectedRemainingStoneId } : {}),
        ...(input.sourcePieceQuantities ? { sourcePieceQuantities: input.sourcePieceQuantities } : {}),
        ...(input.secondaryOwnerProductRowId ? { secondaryOwnerProductRowId: input.secondaryOwnerProductRowId } : {}) }
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
  const removedRows = draft.rows.filter(row => row.productRowId === productRowId);
  const allDependents = draft.dependents ?? [];
  const removedProductRowIds = new Set([productRowId]);
  const removedDependentSet = new Set<(typeof allDependents)[number]>();
  let foundDependent = true;
  while (foundDependent) {
    foundDependent = false;
    allDependents.forEach(item => {
      if (removedDependentSet.has(item)) return;
      const remove = item.kind === 'remainder'
        ? removedProductRowIds.has(item.sourceProductRowId) || removedProductRowIds.has(item.productRowId) ||
          (item.secondaryOwnerProductRowId !== undefined && removedProductRowIds.has(item.secondaryOwnerProductRowId))
        : removedProductRowIds.has(item.parentProductRowId);
      if (!remove) return;
      removedDependentSet.add(item);
      if (item.kind === 'remainder') removedProductRowIds.add(item.productRowId);
      foundDependent = true;
    });
  }
  const removedDependents = allDependents.filter(item => removedDependentSet.has(item));
  const dependents = allDependents.filter(item => !removedDependentSet.has(item));
  const removedEntityIds = new Set<string>([productRowId]);
  const collectOperations = (operations: { groups: Array<{ operationGroupId: string }>;
    tools: Array<{ toolSelectionId: string }>; finishings: Array<{ finishingSelectionId: string }> } | undefined) => {
    operations?.groups.forEach(group => removedEntityIds.add(group.operationGroupId));
    operations?.tools.forEach(tool => removedEntityIds.add(tool.toolSelectionId));
    operations?.finishings.forEach(finishing => removedEntityIds.add(finishing.finishingSelectionId));
  };
  removedRows.forEach(row => {
    if ('operations' in row) collectOperations(row.operations);
    if (row.family === 'slab') row.configuration.sourceRows.forEach(source => removedEntityIds.add(source.sourceRowId));
  });
  removedDependents.forEach(item => {
    if (item.kind === 'remainder') {
      removedEntityIds.add(item.productRowId); removedEntityIds.add(item.allocationId); collectOperations(item.operations);
      return;
    }
    removedEntityIds.add(item.layerConfigurationId);
    if (item.source && item.source.kind !== 'paid-remainder') {
      item.source.sourceRows.forEach(source => removedEntityIds.add(source.sourceRowId));
    }
    item.sideOperations?.forEach(side => { removedEntityIds.add(side.operationCollectionId); collectOperations(side.operations); });
  });
  const editingValues = (draft.editingValues ?? []).filter(value => !removedEntityIds.has(value.entityId));
  return revise(draft, { rows, dependents, editingValues });
}

export function removePartnerTechnicalDependent(draft: PartnerTechnicalDraft, identity: string): PartnerTechnicalDraft {
  const dependents = draft.dependents ?? [];
  const target = dependents.find(item => item.kind === 'remainder' ? item.productRowId === identity || item.allocationId === identity
    : item.layerConfigurationId === identity);
  if (!target) return draft;
  const removedProductIds = new Set(target.kind === 'remainder' ? [target.productRowId] : []);
  const removed = new Set([target]);
  let changed = true;
  while (changed) {
    changed = false;
    dependents.forEach(item => {
      if (removed.has(item)) return;
      const cascade = item.kind === 'remainder' ? removedProductIds.has(item.sourceProductRowId)
        : removedProductIds.has(item.parentProductRowId);
      if (cascade) { removed.add(item); if (item.kind === 'remainder') removedProductIds.add(item.productRowId); changed = true; }
    });
  }
  const entityIds = new Set<string>();
  removed.forEach(item => { if (item.kind === 'remainder') { entityIds.add(item.productRowId); entityIds.add(item.allocationId); }
    else entityIds.add(item.layerConfigurationId); });
  return revise(draft, { dependents: dependents.filter(item => !removed.has(item)),
    editingValues: (draft.editingValues ?? []).filter(value => !entityIds.has(value.entityId)) });
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
  const normalizedText = normalizeNumericText(text);
  let value: number | ReturnType<typeof parseCanonicalDecimal>;
  const integerFields: readonly EditingValue['field'][] = ['quantity', 'layersPerParentPiece',
    'totalSteps', 'numberOfStaircases', 'stepsPerStaircase'];
  if (integerFields.includes(field)) {
    const quantity = Number(normalizedText);
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new Error('Quantity must be an integer');
    value = quantity;
  } else {
    value = parseCanonicalDecimal(normalizedText);
  }
  let committed = false;
  const commitOperations = <T extends { groups: Array<{ operationGroupId: string; scope: string }>;
    tools: Array<{ toolSelectionId: string; quantityOverride?: { value: string; automaticQuantitySnapshot: string; resolution?: 'keep' | 'use-calculation' } }>;
    finishings: Array<{ finishingSelectionId: string; quantityOverride?: { value: string; automaticQuantitySnapshot: string; resolution?: 'keep' | 'use-calculation' } }> }>(operations: T | undefined): T | undefined => {
    if (!operations) return operations;
    if (field === 'scope') return { ...operations, groups: operations.groups.map(group => {
      if (group.operationGroupId !== entityId) return group;
      committed = true; return { ...group, scope: value as string };
    }) };
    if (field !== 'quantityOverride.value') return operations;
    const update = <S extends { toolSelectionId?: string; finishingSelectionId?: string;
      quantityOverride?: { value: string; automaticQuantitySnapshot: string; resolution?: 'keep' | 'use-calculation' } }>(selection: S): S => {
      if ((selection.toolSelectionId ?? selection.finishingSelectionId) !== entityId || !selection.quantityOverride) return selection;
      committed = true; return { ...selection, quantityOverride: { ...selection.quantityOverride, value: value as string } };
    };
    return { ...operations, tools: operations.tools.map(update), finishings: operations.finishings.map(update) };
  };
  const rows = draft.rows.map(row => {
    if (row.productRowId === entityId) {
      const supported: Record<Row['family'], readonly EditingValue['field'][]> = {
        prepared: ['quantity'], volumetric: ['quantity'],
        longitudinal: ['lengthMeters', 'widthMeters', 'requestedAreaSquareMeters', 'quantity'],
        slab: ['lengthMeters', 'widthMeters', 'areaSquareMeters', 'quantity'],
        stair: ['lengthMeters', 'crossDimensionMeters', 'motherLengthMeters', 'quantity'],
      };
      if (!supported[row.family].includes(field)) throw new Error('Technical field is unavailable for this family');
      committed = true;
      return { ...row, configuration: { ...row.configuration, [field]: value } } as Row;
    }
    if (row.family === 'slab' && ['lengthMeters', 'widthMeters', 'quantity'].includes(field)) {
      const sourceRows = row.configuration.sourceRows.map(source => {
        if (source.sourceRowId !== entityId) return source;
        committed = true; return { ...source, [field]: value };
      });
      if (committed) return { ...row, configuration: { ...row.configuration, sourceRows } };
    }
    if ('operations' in row) {
      const operations = commitOperations(row.operations);
      if (operations !== row.operations) return { ...row, operations } as Row;
    }
    return row;
  });
  const dependents = (draft.dependents ?? []).map(item => {
    if (item.kind === 'remainder') {
      if ((item.productRowId === entityId || item.allocationId === entityId) &&
          ['lengthMeters', 'widthMeters', 'quantity'].includes(field)) {
        committed = true; return { ...item, [field]: value };
      }
      const operations = commitOperations(item.operations);
      return operations === item.operations ? item : { ...item, operations };
    }
    if (item.layerConfigurationId === entityId && ['widthMeters', 'layersPerParentPiece'].includes(field)) {
      committed = true; return { ...item, [field]: value };
    }
    let source = item.source;
    if (source && source.kind !== 'paid-remainder' && ['lengthMeters', 'widthMeters', 'quantity'].includes(field)) {
      const sourceRows = source.sourceRows.map(row => {
        if (row.sourceRowId !== entityId) return row;
        committed = true; return { ...row, [field]: value };
      });
      if (committed) source = { ...source, sourceRows };
    }
    const sideOperations = item.sideOperations?.map(side => ({ ...side,
      operations: commitOperations(side.operations)! }));
    return { ...item, ...(source ? { source } : {}), ...(sideOperations ? { sideOperations } : {}) };
  });
  const stairSystems = (draft.stairSystems ?? []).map(system => {
    if (system.stairSystemId !== entityId || !['totalSteps', 'numberOfStaircases', 'stepsPerStaircase'].includes(field)) return system;
    committed = true; return { ...system, quantity: { ...system.quantity, [field]: value } };
  });
  if (!committed) throw new Error('Technical field is unavailable for this entity');
  const editingValues = (draft.editingValues ?? []).filter(item => item.entityId !== entityId || item.field !== field);
  return revise(draft, { rows, dependents, stairSystems, editingValues });
}
