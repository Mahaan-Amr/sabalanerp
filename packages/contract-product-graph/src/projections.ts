import type {
  CanonicalFinishingSelection,
  CanonicalOperationGroup,
  CanonicalProductGraph,
  CanonicalProductRow,
  CanonicalToolSelection
} from './productGraph';

export type CanonicalProjectionAudience =
  | 'step5'
  | 'confirmation'
  | 'pdf'
  | 'accounting'
  | 'workshop'
  | 'delivery'
  | 'logistics';

export interface CanonicalProjectedOperation {
  readonly id: string;
  readonly kind: 'tool' | 'finishing';
  readonly name: string;
  readonly groupId: string;
  readonly scope: string;
  readonly unit: 'meter' | 'squareMeter';
  readonly edges: readonly string[];
  readonly quantity: string;
  readonly rateToman: string;
  readonly amountToman: string;
}

export interface CanonicalProjectedProduct {
  readonly productRowId: string;
  readonly parentProductRowId?: string;
  readonly sourceProductRowId?: string;
  readonly productType: string;
  readonly contractualTitle: string;
  readonly description?: string;
  readonly quantity?: string;
  readonly lengthMeters?: string;
  readonly widthMeters?: string;
  readonly areaSquareMeters?: string;
  readonly baseAmountToman?: string;
  readonly totalAmountToman: string;
  readonly operations: readonly CanonicalProjectedOperation[];
  readonly childRowIds: readonly string[];
  readonly layerConfigurationIds: readonly string[];
  readonly remainingStoneIds: readonly string[];
}

export interface CanonicalContractProjection {
  readonly audience: CanonicalProjectionAudience;
  readonly schemaVersion: number;
  readonly revision: number;
  readonly totalAmountToman: string;
  readonly products: readonly CanonicalProjectedProduct[];
}

const operationsFor = (
  row: CanonicalProductRow,
  groups: readonly CanonicalOperationGroup[],
  tools: readonly CanonicalToolSelection[],
  finishings: readonly CanonicalFinishingSelection[]
): CanonicalProjectedOperation[] => {
  const rowGroups = groups.filter(group => group.productRowId === row.productRowId);
  const byId = new Map(rowGroups.map(group => [group.operationGroupId, group]));
  const mapOperation = (
    operation: CanonicalToolSelection | CanonicalFinishingSelection,
    kind: 'tool' | 'finishing'
  ): CanonicalProjectedOperation | null => {
    const group = byId.get(operation.operationGroupId);
    if (!group) return null;
    return {
      id: kind === 'tool'
        ? (operation as CanonicalToolSelection).toolSelectionId
        : (operation as CanonicalFinishingSelection).finishingSelectionId,
      kind,
      name: operation.name,
      groupId: operation.operationGroupId,
      scope: group.scope,
      unit: operation.unit,
      edges: kind === 'tool' ? [...((operation as CanonicalToolSelection).edges ?? [])] : [],
      quantity: operation.finalQuantity,
      rateToman: operation.rateToman,
      amountToman: operation.amountToman
    };
  };
  return [
    ...tools.map(item => mapOperation(item, 'tool')),
    ...finishings.map(item => mapOperation(item, 'finishing'))
  ].filter((item): item is CanonicalProjectedOperation => item !== null);
};

export const projectCanonicalProductGraph = (
  graph: CanonicalProductGraph,
  audience: CanonicalProjectionAudience
): CanonicalContractProjection => {
  const products = graph.rows.map(row => ({
    productRowId: row.productRowId,
    ...(row.parentProductRowId ? { parentProductRowId: row.parentProductRowId } : {}),
    ...(row.sourceProductRowId ? { sourceProductRowId: row.sourceProductRowId } : {}),
    productType: row.productType,
    contractualTitle: row.contractualTitle,
    ...(row.description ? { description: row.description } : {}),
    ...(row.commercial.requestedQuantity !== undefined
      ? { quantity: row.commercial.requestedQuantity } : {}),
    ...(row.commercial.requestedLengthMeters !== undefined
      ? { lengthMeters: row.commercial.requestedLengthMeters } : {}),
    ...(row.commercial.requestedWidthMeters !== undefined
      ? { widthMeters: row.commercial.requestedWidthMeters } : {}),
    ...(row.commercial.requestedAreaSquareMeters !== undefined
      ? { areaSquareMeters: row.commercial.requestedAreaSquareMeters } : {}),
    ...(row.commercial.baseAmountToman !== undefined
      ? { baseAmountToman: row.commercial.baseAmountToman } : {}),
    totalAmountToman: row.commercial.totalAmountToman ?? '0',
    operations: operationsFor(row, graph.operationGroups, graph.toolSelections, graph.finishingSelections),
    childRowIds: graph.rows
      .filter(candidate => candidate.parentProductRowId === row.productRowId ||
        candidate.sourceProductRowId === row.productRowId)
      .map(candidate => candidate.productRowId),
    layerConfigurationIds: graph.layerConfigurations
      .filter(layer => layer.parentProductRowId === row.productRowId)
      .map(layer => layer.layerConfigurationId),
    remainingStoneIds: graph.remainingStones
      .filter(stone => stone.ownerProductRowId === row.productRowId)
      .map(stone => stone.remainingStoneId)
  }));
  const totalAmountToman = graph.rows.reduce(
    (sum, row) => sum + BigInt(row.commercial.totalAmountToman ?? '0'),
    0n
  ).toString();
  return { audience, schemaVersion: graph.schemaVersion, revision: graph.revision, totalAmountToman, products };
};

export const projectCanonicalGraphToLegacyProducts = (graph: CanonicalProductGraph) =>
  graph.rows.map(row => ({
    ...(row.commercial.legacySnapshot ?? {}),
    rowId: row.productRowId,
    productRowId: row.productRowId,
    productId: row.catalogProductId,
    productType: row.productType,
    name: row.contractualTitle,
    stoneName: row.contractualTitle,
    description: row.description ?? '',
    quantity: row.commercial.requestedQuantity ?? undefined,
    length: row.commercial.requestedLengthMeters ?? undefined,
    ...(row.commercial.requestedLengthMeters === undefined ? {} : { lengthUnit: 'm' }),
    width: row.commercial.requestedWidthMeters ?? undefined,
    ...(row.commercial.requestedWidthMeters === undefined ? {} : { widthUnit: 'm' }),
    squareMeters: row.commercial.requestedAreaSquareMeters ?? undefined,
    totalPrice: row.commercial.totalAmountToman ?? '0',
    parentProductRowId: row.parentProductRowId,
    sourceProductRowId: row.sourceProductRowId
  }));
