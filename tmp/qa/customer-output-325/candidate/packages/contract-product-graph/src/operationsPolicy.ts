import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { hashCanonicalValue } from './canonicalHash';
import { calculatePricing, type PricedLine } from './packingPricing';
import { parseStableIdentity, type StableIdentity } from './stableIdentity';

export type OperationUnit = 'meter' | 'squareMeter';
export type OperationEdge = 'front' | 'back' | 'left' | 'right';
export type OperationGroupBasis = 'piece-count' | 'linear-meters';

export interface OperationGroupDraft {
  readonly operationGroupId: StableIdentity<'operation-group'>;
  readonly scope: CanonicalDecimal;
}

export interface OperationQuantityOverride {
  readonly value: CanonicalDecimal;
  readonly automaticQuantitySnapshot: CanonicalDecimal;
  readonly resolution?: 'keep' | 'use-calculation';
}

export interface ToolSelectionDraft {
  readonly toolSelectionId: StableIdentity<'tool-selection'>;
  readonly operationGroupId: StableIdentity<'operation-group'>;
  readonly catalogItemId: string;
  readonly catalogSnapshotVersion: string;
  readonly name: string;
  readonly unit: OperationUnit;
  readonly rateToman?: CanonicalDecimal;
  readonly edges?: readonly OperationEdge[];
  readonly quantityOverride?: OperationQuantityOverride;
  readonly outsideCurrentCatalog?: boolean;
}

export interface FinishingSelectionDraft {
  readonly finishingSelectionId: StableIdentity<'finishing-selection'>;
  readonly operationGroupId: StableIdentity<'operation-group'>;
  readonly catalogItemId: string;
  readonly catalogSnapshotVersion: string;
  readonly name: string;
  readonly unit: OperationUnit;
  readonly rateToman?: CanonicalDecimal;
  readonly incompatibleCatalogItemIds: readonly string[];
  readonly quantityOverride?: OperationQuantityOverride;
  readonly outsideCurrentCatalog?: boolean;
}

export interface ProductOperationsInput {
  readonly policyVersion: string;
  readonly pricingPolicyVersion: string;
  readonly roundingPolicyVersion: string;
  readonly productRowId: StableIdentity<'product-row'>;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity?: number;
  readonly groups: readonly OperationGroupDraft[];
  readonly tools: readonly ToolSelectionDraft[];
  readonly finishings: readonly FinishingSelectionDraft[];
}

export const refreshProductOperationsGeometry = ({
  input,
  lengthMeters,
  widthMeters,
  quantity
}: {
  readonly input: ProductOperationsInput;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity?: number;
}): ProductOperationsInput => {
  const previousWholeScope = input.quantity === undefined
    ? input.lengthMeters
    : parseCanonicalDecimal(String(input.quantity));
  const nextWholeScope = quantity === undefined
    ? lengthMeters
    : parseCanonicalDecimal(String(quantity));
  const followsWholeProduct =
    input.groups.length === 1 &&
    input.groups[0]?.scope === previousWholeScope;

  return {
    ...input,
    lengthMeters,
    widthMeters,
    ...(quantity === undefined ? { quantity: undefined } : { quantity }),
    groups: followsWholeProduct
      ? [{ ...input.groups[0], scope: nextWholeScope }]
      : input.groups
  };
};

export interface CalculatedOperationGroup extends OperationGroupDraft {
  readonly basis: OperationGroupBasis;
  readonly automaticNoOperations: boolean;
}

export interface CalculatedToolSelection extends ToolSelectionDraft {
  readonly rateToman: CanonicalDecimal;
  readonly automaticQuantity: CanonicalDecimal;
  readonly finalQuantity: CanonicalDecimal;
  readonly amountToman: CanonicalDecimal;
  readonly overrideStatus: 'automatic' | 'current' | 'kept' | 'used-calculation';
}

export interface CalculatedFinishingSelection extends FinishingSelectionDraft {
  readonly rateToman: CanonicalDecimal;
  readonly automaticQuantity: CanonicalDecimal;
  readonly finalQuantity: CanonicalDecimal;
  readonly amountToman: CanonicalDecimal;
  readonly overrideStatus: 'automatic' | 'current' | 'kept' | 'used-calculation';
}

export interface WorkshopOperationGroup {
  readonly operationGroupId: StableIdentity<'operation-group'>;
  readonly basis: OperationGroupBasis;
  readonly scope: CanonicalDecimal;
  readonly automaticNoOperations: boolean;
  readonly tools: readonly {
    readonly toolSelectionId: StableIdentity<'tool-selection'>;
    readonly name: string;
    readonly edges: readonly OperationEdge[];
    readonly quantity: CanonicalDecimal;
    readonly unit: OperationUnit;
  }[];
  readonly finishings: readonly {
    readonly finishingSelectionId: StableIdentity<'finishing-selection'>;
    readonly name: string;
    readonly quantity: CanonicalDecimal;
    readonly unit: OperationUnit;
  }[];
}

export interface ProductOperationsResult {
  readonly policyVersion: string;
  readonly inputHash: string;
  readonly resultHash: string;
  readonly basis: OperationGroupBasis;
  readonly totalScope: CanonicalDecimal;
  readonly noOperationScope: CanonicalDecimal;
  readonly groups: readonly CalculatedOperationGroup[];
  readonly tools: readonly CalculatedToolSelection[];
  readonly finishings: readonly CalculatedFinishingSelection[];
  readonly pricingLines: readonly PricedLine[];
  readonly totalAmountToman: CanonicalDecimal;
  readonly workshopGroups: readonly WorkshopOperationGroup[];
}

export type ProductOperationsConflictCode =
  | 'duplicate-operation-identity'
  | 'edges-not-allowed'
  | 'finishing-incompatible'
  | 'group-scope-exceeds-product'
  | 'invalid-operation-input'
  | 'inventory-rate-missing'
  | 'manual-override-invalid'
  | 'manual-override-stale'
  | 'operation-group-missing'
  | 'tool-edge-required';

export interface ProductOperationsConflict {
  readonly code: ProductOperationsConflictCode;
  readonly path: readonly string[];
  readonly message: string;
  readonly entityId?: string;
  readonly availableScope?: CanonicalDecimal;
  readonly automaticQuantity?: CanonicalDecimal;
}

export type ProductOperationsCalculation =
  | { readonly ok: true; readonly result: ProductOperationsResult }
  | { readonly ok: false; readonly conflicts: readonly ProductOperationsConflict[] };

export const parseProductOperationsInput = (value: unknown): ProductOperationsInput => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Product operations input must be an object.');
  }
  const record = value as Record<string, unknown>;
  const object = (item: unknown, path: string) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError(`${path} must be an object.`);
    }
    return item as Record<string, unknown>;
  };
  const array = (item: unknown, path: string) => {
    if (!Array.isArray(item)) throw new TypeError(`${path} must be an array.`);
    return item;
  };
  const text = (item: unknown, path: string) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new TypeError(`${path} must be a non-empty string.`);
    }
    return item;
  };
  const decimal = (item: unknown, path: string) => {
    if (typeof item !== 'string' || parseCanonicalDecimal(item) !== item) {
      throw new TypeError(`${path} must be a normalized canonical decimal.`);
    }
    return parseCanonicalDecimal(item);
  };
  const bool = (item: unknown, path: string) => {
    if (typeof item !== 'boolean') throw new TypeError(`${path} must be boolean.`);
    return item;
  };
  const unit = (item: unknown, path: string): OperationUnit => {
    if (item !== 'meter' && item !== 'squareMeter') {
      throw new TypeError(`${path} must be meter or squareMeter.`);
    }
    return item;
  };
  const quantityOverride = (
    item: unknown,
    path: string
  ): OperationQuantityOverride | undefined => {
    if (item === undefined) return undefined;
    const override = object(item, path);
    const resolution = override.resolution;
    if (
      resolution !== undefined &&
      resolution !== 'keep' &&
      resolution !== 'use-calculation'
    ) {
      throw new TypeError(`${path}.resolution is unsupported.`);
    }
    return {
      value: decimal(override.value, `${path}.value`),
      automaticQuantitySnapshot: decimal(
        override.automaticQuantitySnapshot,
        `${path}.automaticQuantitySnapshot`
      ),
      ...(resolution === undefined ? {} : { resolution })
    };
  };
  const quantity = record.quantity;
  if (quantity !== undefined && (!Number.isSafeInteger(quantity) || Number(quantity) <= 0)) {
    throw new TypeError('operations.quantity must be a positive integer or omitted.');
  }
  return {
    policyVersion: text(record.policyVersion, 'operations.policyVersion'),
    pricingPolicyVersion: text(
      record.pricingPolicyVersion,
      'operations.pricingPolicyVersion'
    ),
    roundingPolicyVersion: text(
      record.roundingPolicyVersion,
      'operations.roundingPolicyVersion'
    ),
    productRowId: parseStableIdentity(
      'product-row',
      text(record.productRowId, 'operations.productRowId')
    ),
    lengthMeters: decimal(record.lengthMeters, 'operations.lengthMeters'),
    widthMeters: decimal(record.widthMeters, 'operations.widthMeters'),
    ...(quantity === undefined ? {} : { quantity: Number(quantity) }),
    groups: array(record.groups, 'operations.groups').map((item, index) => {
      const group = object(item, `operations.groups.${index}`);
      return {
        operationGroupId: parseStableIdentity(
          'operation-group',
          text(
            group.operationGroupId,
            `operations.groups.${index}.operationGroupId`
          )
        ),
        scope: decimal(group.scope, `operations.groups.${index}.scope`)
      };
    }),
    tools: array(record.tools, 'operations.tools').map((item, index) => {
      const tool = object(item, `operations.tools.${index}`);
      const parsedUnit = unit(tool.unit, `operations.tools.${index}.unit`);
      const edges = tool.edges === undefined
        ? undefined
        : array(tool.edges, `operations.tools.${index}.edges`).map((edge, edgeIndex) => {
            if (!['front', 'back', 'left', 'right'].includes(String(edge))) {
              throw new TypeError(
                `operations.tools.${index}.edges.${edgeIndex} is unsupported.`
              );
            }
            return edge as OperationEdge;
          });
      return {
        toolSelectionId: parseStableIdentity(
          'tool-selection',
          text(tool.toolSelectionId, `operations.tools.${index}.toolSelectionId`)
        ),
        operationGroupId: parseStableIdentity(
          'operation-group',
          text(tool.operationGroupId, `operations.tools.${index}.operationGroupId`)
        ),
        catalogItemId: text(tool.catalogItemId, `operations.tools.${index}.catalogItemId`),
        catalogSnapshotVersion: text(
          tool.catalogSnapshotVersion,
          `operations.tools.${index}.catalogSnapshotVersion`
        ),
        name: text(tool.name, `operations.tools.${index}.name`),
        unit: parsedUnit,
        ...(tool.rateToman === undefined || tool.rateToman === null
          ? {}
          : {
              rateToman: decimal(
                tool.rateToman,
                `operations.tools.${index}.rateToman`
              )
            }),
        ...(edges === undefined ? {} : { edges }),
        ...(quantityOverride(tool.quantityOverride, `operations.tools.${index}.quantityOverride`)
          ? {
              quantityOverride: quantityOverride(
                tool.quantityOverride,
                `operations.tools.${index}.quantityOverride`
              )
            }
          : {}),
        ...(tool.outsideCurrentCatalog === undefined
          ? {}
          : {
              outsideCurrentCatalog: bool(
                tool.outsideCurrentCatalog,
                `operations.tools.${index}.outsideCurrentCatalog`
              )
            })
      };
    }),
    finishings: array(record.finishings, 'operations.finishings').map((item, index) => {
      const finishing = object(item, `operations.finishings.${index}`);
      return {
        finishingSelectionId: parseStableIdentity(
          'finishing-selection',
          text(
            finishing.finishingSelectionId,
            `operations.finishings.${index}.finishingSelectionId`
          )
        ),
        operationGroupId: parseStableIdentity(
          'operation-group',
          text(
            finishing.operationGroupId,
            `operations.finishings.${index}.operationGroupId`
          )
        ),
        catalogItemId: text(
          finishing.catalogItemId,
          `operations.finishings.${index}.catalogItemId`
        ),
        catalogSnapshotVersion: text(
          finishing.catalogSnapshotVersion,
          `operations.finishings.${index}.catalogSnapshotVersion`
        ),
        name: text(finishing.name, `operations.finishings.${index}.name`),
        unit: unit(finishing.unit, `operations.finishings.${index}.unit`),
        ...(finishing.rateToman === undefined || finishing.rateToman === null
          ? {}
          : {
              rateToman: decimal(
                finishing.rateToman,
                `operations.finishings.${index}.rateToman`
              )
            }),
        incompatibleCatalogItemIds: array(
          finishing.incompatibleCatalogItemIds,
          `operations.finishings.${index}.incompatibleCatalogItemIds`
        ).map((id, incompatibleIndex) => text(
          id,
          `operations.finishings.${index}.incompatibleCatalogItemIds.${incompatibleIndex}`
        )),
        ...(quantityOverride(
          finishing.quantityOverride,
          `operations.finishings.${index}.quantityOverride`
        )
          ? {
              quantityOverride: quantityOverride(
                finishing.quantityOverride,
                `operations.finishings.${index}.quantityOverride`
              )
            }
          : {}),
        ...(finishing.outsideCurrentCatalog === undefined
          ? {}
          : {
              outsideCurrentCatalog: bool(
                finishing.outsideCurrentCatalog,
                `operations.finishings.${index}.outsideCurrentCatalog`
              )
            })
      };
    })
  };
};

const d = (value: CanonicalDecimal | string) => new Decimal(value);
const canonical = (value: Decimal): CanonicalDecimal =>
  parseCanonicalDecimal(value.toFixed());
const withoutUndefined = <Value>(value: Value): Value =>
  JSON.parse(JSON.stringify(value)) as Value;
const requiredText = (value: string, label: string) => {
  if (!value.trim()) throw new TypeError(`${label} is required.`);
  return value;
};
const unique = <Value>(values: readonly Value[]) => new Set(values).size === values.length;

const calculateGroupArea = (
  basis: OperationGroupBasis,
  scope: Decimal,
  length: Decimal,
  width: Decimal
) => basis === 'piece-count'
  ? length.times(width).times(scope)
  : scope.times(width);

const calculateLinearToolQuantity = (
  basis: OperationGroupBasis,
  scope: Decimal,
  length: Decimal,
  width: Decimal,
  edges: readonly OperationEdge[]
) => edges.reduce((total, edge) => {
  if (edge === 'front' || edge === 'back') {
    return total.plus(basis === 'piece-count' ? length.times(scope) : scope);
  }
  return total.plus(basis === 'piece-count' ? width.times(scope) : width);
}, new Decimal(0));

const resolveOverride = (
  override: OperationQuantityOverride | undefined,
  automaticQuantity: CanonicalDecimal,
  path: readonly string[]
): {
  conflict?: ProductOperationsConflict;
  finalQuantity: CanonicalDecimal;
  status: 'automatic' | 'current' | 'kept' | 'used-calculation';
  normalizedOverride?: OperationQuantityOverride;
} => {
  if (!override) {
    return { finalQuantity: automaticQuantity, status: 'automatic' };
  }
  if (d(override.value).lte(0) || d(override.automaticQuantitySnapshot).lt(0)) {
    return {
      conflict: {
        code: 'manual-override-invalid',
        path,
        message: 'Manual operation quantity must be positive.'
      },
      finalQuantity: override.value,
      status: 'current',
      normalizedOverride: override
    };
  }
  if (override.automaticQuantitySnapshot === automaticQuantity) {
    return {
      finalQuantity: override.value,
      status: 'current',
      normalizedOverride: override
    };
  }
  if (!override.resolution) {
    return {
      conflict: {
        code: 'manual-override-stale',
        path,
        message: 'The calculated operation quantity changed and needs an explicit decision.',
        automaticQuantity
      },
      finalQuantity: override.value,
      status: 'current',
      normalizedOverride: override
    };
  }
  return override.resolution === 'keep'
    ? {
        finalQuantity: override.value,
        status: 'kept',
        normalizedOverride: {
          value: override.value,
          automaticQuantitySnapshot: automaticQuantity
        }
      }
    : { finalQuantity: automaticQuantity, status: 'used-calculation' };
};

export const calculateProductOperations = (
  input: ProductOperationsInput
): ProductOperationsCalculation => {
  try {
    requiredText(input.policyVersion, 'Operations policy version');
    requiredText(input.pricingPolicyVersion, 'Pricing policy version');
    requiredText(input.roundingPolicyVersion, 'Rounding policy version');
    parseStableIdentity('product-row', input.productRowId);
    const length = d(input.lengthMeters);
    const width = d(input.widthMeters);
    if (length.lte(0) || width.lte(0)) {
      throw new TypeError('Product operation geometry must be positive.');
    }
    if (input.quantity !== undefined &&
        (!Number.isSafeInteger(input.quantity) || input.quantity <= 0)) {
      throw new TypeError('Product operation quantity must be a positive integer or blank.');
    }
    const basis: OperationGroupBasis =
      input.quantity === undefined ? 'linear-meters' : 'piece-count';
    const totalScope = input.quantity === undefined
      ? length
      : new Decimal(input.quantity);
    const groupIds = input.groups.map(group => group.operationGroupId);
    const toolIds = input.tools.map(tool => tool.toolSelectionId);
    const finishingIds = input.finishings.map(finishing => finishing.finishingSelectionId);
    if (!unique(groupIds) || !unique(toolIds) || !unique(finishingIds)) {
      return {
        ok: false,
        conflicts: [{
          code: 'duplicate-operation-identity',
          path: ['operations'],
          message: 'Operation groups and selections require independent stable identities.'
        }]
      };
    }
    const groupMap = new Map(input.groups.map(group => [
      group.operationGroupId,
      { ...group, decimalScope: d(group.scope) }
    ]));
    for (const group of groupMap.values()) {
      if (group.decimalScope.lte(0) ||
          (basis === 'piece-count' && !group.decimalScope.isInteger())) {
        throw new TypeError('Operation group scope must be positive and match its basis.');
      }
    }
    let allocated = new Decimal(0);
    for (const group of input.groups) {
      const available = totalScope.minus(allocated);
      const scope = d(group.scope);
      if (scope.gt(available)) {
        return {
          ok: false,
          conflicts: [{
            code: 'group-scope-exceeds-product',
            path: ['groups', group.operationGroupId, 'scope'],
            entityId: group.operationGroupId,
            message: `Only ${canonical(Decimal.max(available, 0))} remains available.`,
            availableScope: canonical(Decimal.max(available, 0))
          }]
        };
      }
      allocated = allocated.plus(scope);
    }
    const noOperationScope = totalScope.minus(allocated);
    const conflicts: ProductOperationsConflict[] = [];
    const calculatedTools: CalculatedToolSelection[] = [];
    input.tools.forEach((tool, index) => {
      parseStableIdentity('tool-selection', tool.toolSelectionId);
      const group = groupMap.get(tool.operationGroupId);
      if (!group) {
        conflicts.push({
          code: 'operation-group-missing',
          path: ['tools', String(index), 'operationGroupId'],
          entityId: tool.toolSelectionId,
          message: 'Tool selection references a missing operation group.'
        });
        return;
      }
      requiredText(tool.catalogItemId, 'Tool catalog identity');
      requiredText(tool.catalogSnapshotVersion, 'Tool catalog snapshot version');
      requiredText(tool.name, 'Tool name');
      if (tool.rateToman === undefined) {
        conflicts.push({
          code: 'inventory-rate-missing',
          path: ['tools', String(index), 'rateToman'],
          entityId: tool.toolSelectionId,
          message: 'Tool rate is not registered in inventory.'
        });
        return;
      }
      if (d(tool.rateToman).lt(0)) {
        throw new TypeError('Inventory operation rate cannot be negative.');
      }
      const edges = [...(tool.edges ?? [])];
      if (!unique(edges)) {
        throw new TypeError('Tool edges cannot be repeated.');
      }
      if (tool.unit === 'meter' && edges.length === 0) {
        conflicts.push({
          code: 'tool-edge-required',
          path: ['tools', String(index), 'edges'],
          entityId: tool.toolSelectionId,
          message: 'Select at least one edge.'
        });
        return;
      }
      if (tool.unit === 'squareMeter' && edges.length > 0) {
        conflicts.push({
          code: 'edges-not-allowed',
          path: ['tools', String(index), 'edges'],
          entityId: tool.toolSelectionId,
          message: 'Square-meter tools do not use edges.'
        });
        return;
      }
      const automatic = canonical(tool.unit === 'meter'
        ? calculateLinearToolQuantity(
            basis,
            group.decimalScope,
            length,
            width,
            edges
          )
        : calculateGroupArea(basis, group.decimalScope, length, width));
      const override = resolveOverride(
        tool.quantityOverride,
        automatic,
        ['tools', String(index), 'quantityOverride']
      );
      if (override.conflict) conflicts.push({
        ...override.conflict,
        entityId: tool.toolSelectionId
      });
      const { quantityOverride: _previousOverride, ...toolFacts } = tool;
      calculatedTools.push({
        ...toolFacts,
        rateToman: tool.rateToman,
        edges,
        ...(override.normalizedOverride
          ? { quantityOverride: override.normalizedOverride }
          : {}),
        automaticQuantity: automatic,
        finalQuantity: override.finalQuantity,
        amountToman: canonical(
          d(override.finalQuantity)
            .times(tool.rateToman)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        ),
        overrideStatus: override.status
      });
    });

    const calculatedFinishings: CalculatedFinishingSelection[] = [];
    input.finishings.forEach((finishing, index) => {
      parseStableIdentity('finishing-selection', finishing.finishingSelectionId);
      const group = groupMap.get(finishing.operationGroupId);
      if (!group) {
        conflicts.push({
          code: 'operation-group-missing',
          path: ['finishings', String(index), 'operationGroupId'],
          entityId: finishing.finishingSelectionId,
          message: 'Stone finishing references a missing operation group.'
        });
        return;
      }
      requiredText(finishing.catalogItemId, 'Finishing catalog identity');
      requiredText(finishing.catalogSnapshotVersion, 'Finishing snapshot version');
      requiredText(finishing.name, 'Finishing name');
      if (finishing.rateToman === undefined) {
        conflicts.push({
          code: 'inventory-rate-missing',
          path: ['finishings', String(index), 'rateToman'],
          entityId: finishing.finishingSelectionId,
          message: 'Finishing rate is not registered in inventory.'
        });
        return;
      }
      if (d(finishing.rateToman).lt(0)) {
        throw new TypeError('Inventory finishing rate cannot be negative.');
      }
      const automatic = canonical(finishing.unit === 'meter'
        ? (basis === 'piece-count'
            ? length.times(group.decimalScope)
            : group.decimalScope)
        : calculateGroupArea(basis, group.decimalScope, length, width));
      const override = resolveOverride(
        finishing.quantityOverride,
        automatic,
        ['finishings', String(index), 'quantityOverride']
      );
      if (override.conflict) conflicts.push({
        ...override.conflict,
        entityId: finishing.finishingSelectionId
      });
      const { quantityOverride: _previousOverride, ...finishingFacts } = finishing;
      calculatedFinishings.push({
        ...finishingFacts,
        rateToman: finishing.rateToman,
        ...(override.normalizedOverride
          ? { quantityOverride: override.normalizedOverride }
          : {}),
        automaticQuantity: automatic,
        finalQuantity: override.finalQuantity,
        amountToman: canonical(
          d(override.finalQuantity)
            .times(finishing.rateToman)
            .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
        ),
        overrideStatus: override.status
      });
    });

    input.groups.forEach(group => {
      const selections = input.finishings.filter(
        finishing => finishing.operationGroupId === group.operationGroupId
      );
      selections.forEach((selection, index) => {
        selections.slice(index + 1).forEach(other => {
          if (
            selection.incompatibleCatalogItemIds.includes(other.catalogItemId) ||
            other.incompatibleCatalogItemIds.includes(selection.catalogItemId)
          ) {
            conflicts.push({
              code: 'finishing-incompatible',
              path: ['finishings', selection.finishingSelectionId],
              entityId: selection.finishingSelectionId,
              message: `${selection.name} is incompatible with ${other.name} in this group.`
            });
          }
        });
      });
    });
    if (conflicts.length > 0) return { ok: false, conflicts };

    const calculatedGroups: CalculatedOperationGroup[] = input.groups.map(group => ({
      ...group,
      basis,
      automaticNoOperations: false
    }));
    if (noOperationScope.gt(0)) {
      calculatedGroups.push({
        operationGroupId: parseStableIdentity(
          'operation-group',
          `${input.productRowId}:no-operations`
        ),
        scope: canonical(noOperationScope),
        basis,
        automaticNoOperations: true
      });
    }
    const pricing = calculatePricing({
      policyVersion: input.pricingPolicyVersion,
      roundingPolicyVersion: input.roundingPolicyVersion,
      lines: [
        ...calculatedTools.map(tool => ({
          lineId: `tool:${tool.toolSelectionId}`,
          quantity: tool.finalQuantity,
          rateToman: tool.rateToman
        })),
        ...calculatedFinishings.map(finishing => ({
          lineId: `finishing:${finishing.finishingSelectionId}`,
          quantity: finishing.finalQuantity,
          rateToman: finishing.rateToman
        }))
      ]
    });
    const lineAmount = (lineId: string) =>
      pricing.lines.find(line => line.lineId === lineId)?.amountToman ??
      parseCanonicalDecimal('0');
    const tools = calculatedTools.map(tool => ({
      ...tool,
      amountToman: lineAmount(`tool:${tool.toolSelectionId}`)
    }));
    const finishings = calculatedFinishings.map(finishing => ({
      ...finishing,
      amountToman: lineAmount(`finishing:${finishing.finishingSelectionId}`)
    }));
    const workshopGroups = calculatedGroups.map(group => ({
      operationGroupId: group.operationGroupId,
      basis: group.basis,
      scope: group.scope,
      automaticNoOperations: group.automaticNoOperations,
      tools: tools
        .filter(tool => tool.operationGroupId === group.operationGroupId)
        .map(tool => ({
          toolSelectionId: tool.toolSelectionId,
          name: tool.name,
          edges: tool.edges ?? [],
          quantity: tool.finalQuantity,
          unit: tool.unit
        })),
      finishings: finishings
        .filter(finishing => finishing.operationGroupId === group.operationGroupId)
        .map(finishing => ({
          finishingSelectionId: finishing.finishingSelectionId,
          name: finishing.name,
          quantity: finishing.finalQuantity,
          unit: finishing.unit
        }))
    }));
    const resultBase = {
      policyVersion: input.policyVersion,
      inputHash: hashCanonicalValue(withoutUndefined(input)),
      basis,
      totalScope: canonical(totalScope),
      noOperationScope: canonical(noOperationScope),
      groups: calculatedGroups,
      tools,
      finishings,
      pricingLines: pricing.lines,
      totalAmountToman: pricing.totalAmountToman,
      workshopGroups
    };
    return {
      ok: true,
      result: {
        ...resultBase,
        resultHash: hashCanonicalValue(resultBase)
      }
    };
  } catch (error) {
    return {
      ok: false,
      conflicts: [{
        code: 'invalid-operation-input',
        path: ['operations'],
        message: error instanceof Error ? error.message : 'Operation input is invalid.'
      }]
    };
  }
};

export type OperationGroupBasisConversion =
  | { readonly ok: true; readonly groups: readonly OperationGroupDraft[] }
  | {
      readonly ok: false;
      readonly unresolved: readonly {
        readonly operationGroupId: StableIdentity<'operation-group'>;
        readonly previousScope: CanonicalDecimal;
      }[];
    };

export const convertOperationGroupBasis = ({
  groups,
  from,
  to,
  lengthPerPieceMeters
}: {
  groups: readonly OperationGroupDraft[];
  from: OperationGroupBasis;
  to: OperationGroupBasis;
  lengthPerPieceMeters: CanonicalDecimal;
}): OperationGroupBasisConversion => {
  if (from === to) return {
    ok: true,
    groups: groups.map(group => ({ ...group }))
  };
  const length = d(lengthPerPieceMeters);
  if (length.lte(0)) throw new TypeError('Length per piece must be positive.');
  if (from === 'piece-count') {
    return {
      ok: true,
      groups: groups.map(group => ({
        ...group,
        scope: canonical(d(group.scope).times(length))
      }))
    };
  }
  const unresolved = groups.filter(group => !d(group.scope).div(length).isInteger());
  if (unresolved.length > 0) {
    return {
      ok: false,
      unresolved: unresolved.map(group => ({
        operationGroupId: group.operationGroupId,
        previousScope: group.scope
      }))
    };
  }
  return {
    ok: true,
    groups: groups.map(group => ({
      ...group,
      scope: canonical(d(group.scope).div(length))
    }))
  };
};

export type OperationGroupSplitResult =
  | { readonly ok: true; readonly input: ProductOperationsInput }
  | {
      readonly ok: false;
      readonly message: string;
    };

export const splitOperationGroup = ({
  input,
  sourceOperationGroupId,
  selectedScope,
  selectedOperationGroupId,
  clonedToolSelectionIds,
  clonedFinishingSelectionIds
}: {
  input: ProductOperationsInput;
  sourceOperationGroupId: StableIdentity<'operation-group'>;
  selectedScope: CanonicalDecimal;
  selectedOperationGroupId: StableIdentity<'operation-group'>;
  clonedToolSelectionIds: Readonly<
    Record<string, StableIdentity<'tool-selection'>>
  >;
  clonedFinishingSelectionIds: Readonly<
    Record<string, StableIdentity<'finishing-selection'>>
  >;
}): OperationGroupSplitResult => {
  const sourceIndex = input.groups.findIndex(
    group => group.operationGroupId === sourceOperationGroupId
  );
  if (sourceIndex < 0) return { ok: false, message: 'Source operation group is missing.' };
  if (input.groups.some(group => group.operationGroupId === selectedOperationGroupId)) {
    return { ok: false, message: 'The new operation group identity already exists.' };
  }
  const source = input.groups[sourceIndex];
  const selected = d(selectedScope);
  const sourceScope = d(source.scope);
  if (
    selected.lte(0) ||
    selected.gte(sourceScope) ||
    (input.quantity !== undefined && !selected.isInteger())
  ) {
    return {
      ok: false,
      message: 'The selected scope must be a positive proper part of the source group.'
    };
  }
  const sourceTools = input.tools.filter(
    tool => tool.operationGroupId === sourceOperationGroupId
  );
  const sourceFinishings = input.finishings.filter(
    finishing => finishing.operationGroupId === sourceOperationGroupId
  );
  if (sourceTools.some(tool => !clonedToolSelectionIds[tool.toolSelectionId]) ||
      sourceFinishings.some(
        finishing => !clonedFinishingSelectionIds[finishing.finishingSelectionId]
      )) {
    return {
      ok: false,
      message: 'Every inherited operation requires a new independent identity.'
    };
  }
  const selectedGroup: OperationGroupDraft = {
    operationGroupId: selectedOperationGroupId,
    scope: canonical(selected)
  };
  const remainingGroup: OperationGroupDraft = {
    ...source,
    scope: canonical(sourceScope.minus(selected))
  };
  return {
    ok: true,
    input: {
      ...input,
      groups: [
        ...input.groups.slice(0, sourceIndex),
        selectedGroup,
        remainingGroup,
        ...input.groups.slice(sourceIndex + 1)
      ],
      tools: [
        ...input.tools,
        ...sourceTools.map(tool => ({
          ...tool,
          toolSelectionId: clonedToolSelectionIds[tool.toolSelectionId],
          operationGroupId: selectedOperationGroupId,
          ...(tool.quantityOverride
            ? { quantityOverride: { ...tool.quantityOverride } }
            : {})
        }))
      ],
      finishings: [
        ...input.finishings,
        ...sourceFinishings.map(finishing => ({
          ...finishing,
          finishingSelectionId:
            clonedFinishingSelectionIds[finishing.finishingSelectionId],
          operationGroupId: selectedOperationGroupId,
          incompatibleCatalogItemIds: [...finishing.incompatibleCatalogItemIds],
          ...(finishing.quantityOverride
            ? { quantityOverride: { ...finishing.quantityOverride } }
            : {})
        }))
      ]
    }
  };
};
