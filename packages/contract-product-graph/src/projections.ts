import type {
  CanonicalFinishingSelection,
  CanonicalLayerConfiguration,
  CanonicalOperationGroup,
  CanonicalProductGraph,
  CanonicalProductRow,
  CanonicalToolSelection
} from './productGraph';
import { parseCanonicalDecimal } from './canonicalDecimal';

const sumCanonicalDecimals = (values: readonly string[]): string => {
  const parsed = values.map(value => String(parseCanonicalDecimal(value)).split('.'));
  const scale = Math.max(0, ...parsed.map(([, fraction = '']) => fraction.length));
  const factor = 10n ** BigInt(scale);
  const atoms = parsed.reduce((sum, [integer = '0', fraction = '']) => {
    const negative = integer.startsWith('-');
    const magnitude = BigInt(integer.replace('-', '') || '0') * factor +
      BigInt(fraction.padEnd(scale, '0') || '0');
    return sum + (negative ? -magnitude : magnitude);
  }, 0n);
  const negative = atoms < 0n;
  const magnitude = negative ? -atoms : atoms;
  const integer = magnitude / factor;
  const fraction = scale === 0 ? '' : (magnitude % factor).toString().padStart(scale, '0').replace(/0+$/, '');
  return String(parseCanonicalDecimal(`${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`));
};

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

export interface CanonicalProjectedPricingComponent {
  readonly id: string;
  readonly kind: string;
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
  readonly pricingComponents: readonly CanonicalProjectedPricingComponent[];
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

const canonicalPricingComponentsFor = (
  row: CanonicalProductRow,
  operations: readonly CanonicalProjectedOperation[],
  layers: readonly CanonicalLayerConfiguration[]
): CanonicalProjectedPricingComponent[] => {
  const snapshot = row.commercial.calculationSnapshot;
  const rawPricingLines: unknown[] = [];
  if (snapshot) {
    if (row.productType === 'slab') {
      if (snapshot.materialPricingLine !== undefined) rawPricingLines.push(snapshot.materialPricingLine);
      if (snapshot.cuttingPricingLines !== undefined) {
        if (!Array.isArray(snapshot.cuttingPricingLines)) {
          throw new Error(`Product ${row.productRowId} slab cutting pricing lines are malformed`);
        }
        rawPricingLines.push(...snapshot.cuttingPricingLines);
      }
      if (snapshot.verticalCutPricingLine !== undefined) rawPricingLines.push(snapshot.verticalCutPricingLine);
    } else if (snapshot.pricingLines !== undefined) {
      if (!Array.isArray(snapshot.pricingLines)) {
        throw new Error(`Product ${row.productRowId} pricing lines are malformed`);
      }
      rawPricingLines.push(...snapshot.pricingLines);
    }
  }
  const componentFromLine = (
    value: unknown,
    idPrefix?: string,
    kindPrefix?: string
  ): CanonicalProjectedPricingComponent => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Product ${row.productRowId} pricing component is malformed`);
    }
    const line = value as Record<string, unknown>;
    if (
      typeof line.lineId !== 'string' || line.lineId.trim() === '' ||
      typeof line.amountToman !== 'string'
    ) {
      throw new Error(`Product ${row.productRowId} pricing component is malformed`);
    }
    return {
      id: idPrefix ? `${idPrefix}:${line.lineId}` : line.lineId,
      kind: kindPrefix ? `${kindPrefix}:${line.lineId}` : line.lineId,
      amountToman: line.amountToman
    };
  };
  let intrinsic = rawPricingLines.map(value => componentFromLine(value));
  const materialPricing = snapshot?.materialPricing;
  let materialWasPaidInSource = false;
  if (
    materialPricing &&
    typeof materialPricing === 'object' &&
    !Array.isArray(materialPricing) &&
    (materialPricing as Record<string, unknown>).reason === 'paid-in-source-product'
  ) {
    const material = materialPricing as Record<string, unknown>;
    try {
      if (
        typeof material.amountToman !== 'string' ||
        parseCanonicalDecimal(material.amountToman) !== '0' ||
        typeof row.commercial.baseAmountToman !== 'string' ||
        parseCanonicalDecimal(row.commercial.baseAmountToman) !== '0'
      ) {
        throw new TypeError('Paid source material and commercial base amounts must be zero.');
      }
    } catch {
      throw new Error(`Product ${row.productRowId} material pricing evidence is malformed`);
    }
    materialWasPaidInSource = true;
  }
  if (materialWasPaidInSource) {
    intrinsic = intrinsic.map(component =>
      component.kind === 'base-material' || component.kind === 'slab-material'
        ? { ...component, amountToman: '0' }
        : component
    );
    const remainderCutting = snapshot?.remainderCutting;
    if (remainderCutting !== undefined) {
      if (!remainderCutting || typeof remainderCutting !== 'object' || Array.isArray(remainderCutting)) {
        throw new Error(`Product ${row.productRowId} remainder cutting evidence is malformed`);
      }
      const remainder = remainderCutting as Record<string, unknown>;
      if (
        typeof remainder.allocationId !== 'string' || remainder.allocationId.trim() === '' ||
        typeof remainder.amountToman !== 'string'
      ) {
        throw new Error(`Product ${row.productRowId} remainder cutting evidence is malformed`);
      }
      let amountToman: string;
      try {
        amountToman = parseCanonicalDecimal(remainder.amountToman);
        if (amountToman.startsWith('-')) throw new TypeError('Negative remainder cutting amount.');
      } catch {
        throw new Error(`Product ${row.productRowId} remainder cutting evidence is malformed`);
      }
      intrinsic = [
        ...intrinsic.filter(component =>
          component.kind === 'base-material' || component.kind === 'slab-material'
        ),
        {
          id: `remainder-cutting:${remainder.allocationId}`,
          kind: 'remainder-cutting',
          amountToman
        }
      ];
    }
  }
  const hasProjectedBase = intrinsic.some(component =>
    component.kind === 'base-material' || component.kind === 'slab-material'
  );
  if (!hasProjectedBase && row.commercial.baseAmountToman !== undefined) {
    const baseKind = row.productType === 'slab' ? 'slab-material' : 'base-material';
    intrinsic.unshift({
      id: baseKind,
      kind: baseKind,
      amountToman: row.commercial.baseAmountToman
    });
  }
  const attached = operations.map(operation => ({
    id: operation.id,
    kind: operation.kind,
    amountToman: operation.amountToman
  }));
  const layerComponents = layers
    .filter(layer => layer.parentProductRowId === row.productRowId)
    .flatMap(layer => {
      const prefix = `layer:${layer.layerConfigurationId}`;
      const result = layer.result;
      const directLines = [
        result.layerPricingLine,
        ...(result.materialPricingLine ? [result.materialPricingLine] : []),
        ...result.cuttingPricingLines
      ].map(line => componentFromLine(line, prefix, 'stair-layer'));
      const operationLines = result.sideOperationResults.flatMap(operation =>
        operation.result.pricingLines.map(line => componentFromLine(
          line,
          `${prefix}:operation:${operation.operationCollectionId}`,
          'stair-layer-operation'
        ))
      );
      return [...directLines, ...operationLines];
    });
  return [...intrinsic, ...layerComponents, ...attached];
};

export const projectCanonicalProductGraph = (
  graph: CanonicalProductGraph,
  audience: CanonicalProjectionAudience
): CanonicalContractProjection => {
  const products = graph.rows.map(row => {
    const operations = operationsFor(row, graph.operationGroups, graph.toolSelections, graph.finishingSelections);
    return {
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
    pricingComponents: audience === 'accounting'
      ? canonicalPricingComponentsFor(row, operations, graph.layerConfigurations)
      : [],
    operations,
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
    };
  });
  const totalAmountToman = sumCanonicalDecimals(
    graph.rows.map(row => row.commercial.totalAmountToman ?? '0')
  );
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
