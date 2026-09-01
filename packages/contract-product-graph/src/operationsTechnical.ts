import Decimal from 'decimal.js';
import { parseCanonicalDecimal, type CanonicalDecimal } from './canonicalDecimal';
import { parseStableIdentity } from './stableIdentity';
import type {
  CalculatedOperationGroup, FinishingSelectionDraft, OperationEdge, OperationGroupBasis,
  OperationQuantityOverride, ProductOperationsConflict, ProductOperationsInput,
  ToolSelectionDraft, WorkshopOperationGroup,
} from './operationsPolicy';

export type TechnicalToolSelection = Omit<ToolSelectionDraft, 'rateToman'>;
export type TechnicalFinishingSelection = Omit<FinishingSelectionDraft, 'rateToman'>;
export interface ProductOperationsTechnicalInput extends Pick<ProductOperationsInput,
  'productRowId' | 'lengthMeters' | 'widthMeters' | 'quantity' | 'groups'> {
  /** Caller revision for rejecting late previews; not a persisted recovery revision. */
  readonly inputRevision: number;
  /** Independent layer-side collection; ordinary product calls retain their row identity. */
  readonly operationScopeId?: string;
  readonly tools: readonly TechnicalToolSelection[];
  readonly finishings: readonly TechnicalFinishingSelection[];
}
interface TechnicalQuantityResult {
  readonly automaticQuantity: CanonicalDecimal;
  readonly finalQuantity: CanonicalDecimal;
  readonly overrideStatus: 'automatic' | 'current' | 'kept' | 'used-calculation';
}
export interface TechnicalToolSelectionResult extends TechnicalToolSelection, TechnicalQuantityResult {}
export interface TechnicalFinishingSelectionResult extends TechnicalFinishingSelection, TechnicalQuantityResult {}
export interface ProductOperationsTechnicalResult {
  readonly inputRevision: number;
  readonly productRowId: ProductOperationsInput['productRowId'];
  readonly basis: OperationGroupBasis;
  readonly totalScope: CanonicalDecimal;
  readonly noOperationScope: CanonicalDecimal;
  readonly groups: readonly CalculatedOperationGroup[];
  readonly tools: readonly TechnicalToolSelectionResult[];
  readonly finishings: readonly TechnicalFinishingSelectionResult[];
  readonly workshopGroups: readonly WorkshopOperationGroup[];
}
export type ProductOperationsTechnicalCalculation =
  | { readonly ok: true; readonly result: ProductOperationsTechnicalResult }
  | { readonly ok: false; readonly conflicts: readonly ProductOperationsConflict[];
      readonly inputRevision?: number;
      readonly result?: ProductOperationsTechnicalResult };

const d = (value: CanonicalDecimal | string) => new Decimal(value);
const canonical = (value: Decimal): CanonicalDecimal => parseCanonicalDecimal(value.toFixed());
const requiredText = (value: string, label: string) => {
  if (!value.trim()) throw new TypeError(`${label} is required.`);
};
const unique = <Value>(values: readonly Value[]) => new Set(values).size === values.length;

// This public seam accepts only technical facts, even when called from plain JS.
// Never echo an unknown field name/value: it may itself contain private evidence.
const validateTechnicalInput = (input: ProductOperationsTechnicalInput): void => {
  const shape = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).some(key => !keys.includes(key))) {
      throw new TypeError('Unsupported technical input.');
    }
    return value as Record<string, unknown>;
  };
  const decimal = (value: unknown) => {
    if (typeof value !== 'string' || parseCanonicalDecimal(value) !== value) {
      throw new TypeError('Invalid technical decimal.');
    }
  };
  const text = (value: unknown) => {
    if (typeof value !== 'string' || !value.trim()) throw new TypeError('Invalid technical text.');
    return value;
  };
  const array = (value: unknown): readonly unknown[] => {
    if (!Array.isArray(value)) throw new TypeError('Invalid technical collection.');
    return value;
  };
  const override = (value: unknown) => {
    if (value === undefined) return;
    const item = shape(value, ['value', 'automaticQuantitySnapshot', 'resolution']);
    decimal(item.value); decimal(item.automaticQuantitySnapshot);
    if (item.resolution !== undefined && item.resolution !== 'keep' && item.resolution !== 'use-calculation') {
      throw new TypeError('Invalid override resolution.');
    }
  };
  shape(input, ['inputRevision', 'productRowId', 'operationScopeId', 'lengthMeters', 'widthMeters', 'quantity', 'groups', 'tools', 'finishings']);
  decimal(input.lengthMeters); decimal(input.widthMeters);
  text(input.productRowId);
  if (input.operationScopeId !== undefined) parseStableIdentity('layer-operation-collection', text(input.operationScopeId));
  array(input.groups).forEach(value => {
    const group = shape(value, ['operationGroupId', 'scope']);
    text(group.operationGroupId);
    parseStableIdentity('operation-group', text(group.operationGroupId));
    decimal(group.scope);
  });
  const commonKeys = ['operationGroupId', 'catalogItemId', 'catalogSnapshotVersion', 'name', 'unit', 'quantityOverride', 'outsideCurrentCatalog'];
  const selection = (value: unknown, keys: readonly string[]) => {
    const item = shape(value, [...commonKeys, ...keys]);
    for (const key of ['operationGroupId', 'catalogItemId', 'catalogSnapshotVersion', 'name']) text(item[key]);
    parseStableIdentity('operation-group', text(item.operationGroupId));
    if (item.unit !== 'meter' && item.unit !== 'squareMeter') throw new TypeError('Invalid operation unit.');
    if (item.outsideCurrentCatalog !== undefined && typeof item.outsideCurrentCatalog !== 'boolean') {
      throw new TypeError('Invalid catalog status.');
    }
    override(item.quantityOverride);
    return item;
  };
  array(input.tools).forEach(value => {
    const tool = selection(value, ['toolSelectionId', 'edges']);
    text(tool.toolSelectionId);
    parseStableIdentity('tool-selection', text(tool.toolSelectionId));
    if (tool.edges !== undefined) array(tool.edges).forEach(edge => {
      if (typeof edge !== 'string' || !['front', 'back', 'left', 'right'].includes(edge)) throw new TypeError('Invalid edge.');
    });
  });
  array(input.finishings).forEach(value => {
    const finishing = selection(value, ['finishingSelectionId', 'incompatibleCatalogItemIds']);
    text(finishing.finishingSelectionId);
    parseStableIdentity('finishing-selection', text(finishing.finishingSelectionId));
    array(finishing.incompatibleCatalogItemIds).forEach(text);
  });
};

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

export const calculateProductOperationsTechnical = (
  input: ProductOperationsTechnicalInput
): ProductOperationsTechnicalCalculation => {
  const correlation = Number.isSafeInteger(input?.inputRevision) && input.inputRevision >= 0
    ? { inputRevision: input.inputRevision } : {};
  try {
    validateTechnicalInput(input);
    if (!Number.isSafeInteger(input.inputRevision) || input.inputRevision < 0) {
      throw new TypeError('Input revision must be a non-negative integer.');
    }
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
        ...correlation,
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
          ...correlation,
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
    if (noOperationScope.gt(0) && groupIds.includes(`${input.operationScopeId ?? input.productRowId}:no-operations` as typeof groupIds[number])) {
      return { ok: false, ...correlation, conflicts: [{
        code: 'duplicate-operation-identity', path: ['groups'],
        message: 'The automatic no-operation group requires an independent identity.',
      }] };
    }
    const conflicts: ProductOperationsConflict[] = [];
    const calculatedTools: TechnicalToolSelectionResult[] = [];
    input.tools.forEach(tool => {
      parseStableIdentity('tool-selection', tool.toolSelectionId);
      const group = groupMap.get(tool.operationGroupId);
      if (!group) {
        conflicts.push({
          code: 'operation-group-missing',
          path: ['tools', tool.toolSelectionId, 'operationGroupId'],
          entityId: tool.toolSelectionId,
          message: 'Tool selection references a missing operation group.'
        });
        return;
      }
      requiredText(tool.catalogItemId, 'Tool catalog identity');
      requiredText(tool.catalogSnapshotVersion, 'Tool catalog snapshot version');
      requiredText(tool.name, 'Tool name');
      const edges = [...(tool.edges ?? [])];
      if (!unique(edges)) {
        throw new TypeError('Tool edges cannot be repeated.');
      }
      if (tool.unit === 'meter' && edges.length === 0) {
        conflicts.push({
          code: 'tool-edge-required',
          path: ['tools', tool.toolSelectionId, 'edges'],
          entityId: tool.toolSelectionId,
          message: 'Select at least one edge.'
        });
        return;
      }
      if (tool.unit === 'squareMeter' && edges.length > 0) {
        conflicts.push({
          code: 'edges-not-allowed',
          path: ['tools', tool.toolSelectionId, 'edges'],
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
        ['tools', tool.toolSelectionId, 'quantityOverride']
      );
      if (override.conflict) conflicts.push({
        ...override.conflict,
        entityId: tool.toolSelectionId
      });
      const { quantityOverride: _previousOverride, ...toolFacts } = tool;
      calculatedTools.push({
        ...toolFacts,
        edges,
        ...(override.normalizedOverride
          ? { quantityOverride: override.normalizedOverride }
          : {}),
        automaticQuantity: automatic,
        finalQuantity: override.finalQuantity,
        overrideStatus: override.status
      });
    });

    const calculatedFinishings: TechnicalFinishingSelectionResult[] = [];
    input.finishings.forEach(finishing => {
      parseStableIdentity('finishing-selection', finishing.finishingSelectionId);
      const group = groupMap.get(finishing.operationGroupId);
      if (!group) {
        conflicts.push({
          code: 'operation-group-missing',
          path: ['finishings', finishing.finishingSelectionId, 'operationGroupId'],
          entityId: finishing.finishingSelectionId,
          message: 'Stone finishing references a missing operation group.'
        });
        return;
      }
      requiredText(finishing.catalogItemId, 'Finishing catalog identity');
      requiredText(finishing.catalogSnapshotVersion, 'Finishing snapshot version');
      requiredText(finishing.name, 'Finishing name');
      const automatic = canonical(finishing.unit === 'meter'
        ? (basis === 'piece-count'
            ? length.times(group.decimalScope)
            : group.decimalScope)
        : calculateGroupArea(basis, group.decimalScope, length, width));
      const override = resolveOverride(
        finishing.quantityOverride,
        automatic,
        ['finishings', finishing.finishingSelectionId, 'quantityOverride']
      );
      if (override.conflict) conflicts.push({
        ...override.conflict,
        entityId: finishing.finishingSelectionId
      });
      const { quantityOverride: _previousOverride, ...finishingFacts } = finishing;
      calculatedFinishings.push({
        ...finishingFacts,
        ...(override.normalizedOverride
          ? { quantityOverride: override.normalizedOverride }
          : {}),
        automaticQuantity: automatic,
        finalQuantity: override.finalQuantity,
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

    const calculatedGroups: CalculatedOperationGroup[] = input.groups.map(group => ({
      ...group,
      basis,
      automaticNoOperations: false
    }));
    if (noOperationScope.gt(0)) {
      calculatedGroups.push({
        operationGroupId: parseStableIdentity(
          'operation-group',
          `${input.operationScopeId ?? input.productRowId}:no-operations`
        ),
        scope: canonical(noOperationScope),
        basis,
        automaticNoOperations: true
      });
    }
    const tools = calculatedTools;
    const finishings = calculatedFinishings;
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
      inputRevision: input.inputRevision,
      productRowId: input.productRowId,
      basis,
      totalScope: canonical(totalScope),
      noOperationScope: canonical(noOperationScope),
      groups: calculatedGroups,
      tools,
      finishings,
      workshopGroups
    };
    return conflicts.length > 0
      ? { ok: false, ...correlation, conflicts, result: resultBase }
      : { ok: true, result: resultBase };
  } catch (error) {
    return {
      ok: false,
      ...correlation,
      conflicts: [{
        code: 'invalid-operation-input',
        path: ['operations'],
        message: 'Operation technical input is invalid.'
      }]
    };
  }
};
