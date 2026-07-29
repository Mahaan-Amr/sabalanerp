import type { ProductOperationsInput } from '@sabalanerp/contract-product-graph';

import type {
  Product,
  StairPartDraftV2
} from '../types/contract.types';

export const LAYER_OPERATIONS_MIXED_MESSAGE =
  'عملیات نوارها یکسان نیست';

export const selectNewLayerStone = (
  draft: StairPartDraftV2,
  product: Product,
  label: string
): StairPartDraftV2 => ({
  ...draft,
  layerUseDifferentStone: true,
  layerStoneProductId: product.id,
  layerStoneProduct: product,
  layerStoneLabel: label,
  layerPricePerSquareMeter: null,
  layerUseMandatory: draft.layerUseMandatory ?? true,
  layerMandatoryPercentage: draft.layerMandatoryPercentage ?? 20
});

const sorted = <T,>(values: readonly T[]): T[] =>
  [...values].sort((left, right) =>
    JSON.stringify(left).localeCompare(JSON.stringify(right))
  );

const groupScopeById = (input: ProductOperationsInput): Map<string, string> =>
  new Map(input.groups.map(group => [
    String(group.operationGroupId),
    String(group.scope)
  ]));

const quantityOverrideIntent = (
  override: ProductOperationsInput['tools'][number]['quantityOverride']
) => override
  ? {
    value: override.value,
    resolution: override.resolution ?? null
  }
  : null;

const toolSignature = (
  input: ProductOperationsInput,
  tool: ProductOperationsInput['tools'][number]
): string => {
  const groupScopes = groupScopeById(input);
  return JSON.stringify({
    groupScope: groupScopes.get(String(tool.operationGroupId)) ?? null,
    catalogItemId: tool.catalogItemId,
    catalogSnapshotVersion: tool.catalogSnapshotVersion,
    name: tool.name,
    unit: tool.unit,
    rateToman: tool.rateToman ?? null,
    edges: sorted(tool.edges ?? []),
    quantityOverride: quantityOverrideIntent(tool.quantityOverride),
    outsideCurrentCatalog: tool.outsideCurrentCatalog ?? false
  });
};

const finishingSignature = (
  input: ProductOperationsInput,
  finishing: ProductOperationsInput['finishings'][number]
): string => {
  const groupScopes = groupScopeById(input);
  return JSON.stringify({
    groupScope: groupScopes.get(String(finishing.operationGroupId)) ?? null,
    catalogItemId: finishing.catalogItemId,
    catalogSnapshotVersion: finishing.catalogSnapshotVersion,
    name: finishing.name,
    unit: finishing.unit,
    rateToman: finishing.rateToman ?? null,
    incompatibleCatalogItemIds: sorted(finishing.incompatibleCatalogItemIds),
    quantityOverride: quantityOverrideIntent(finishing.quantityOverride),
    outsideCurrentCatalog: finishing.outsideCurrentCatalog ?? false
  });
};

const collectionSignature = (input: ProductOperationsInput): string =>
  JSON.stringify({
    tools: sorted(input.tools.map(tool => toolSignature(input, tool))),
    finishings: sorted(
      input.finishings.map(finishing => finishingSignature(input, finishing))
    )
  });

const sharedSignatureCounts = (
  signaturesByInput: string[][]
): Map<string, number> => {
  const firstCounts = new Map<string, number>();
  signaturesByInput[0]?.forEach(signature => {
    firstCounts.set(signature, (firstCounts.get(signature) ?? 0) + 1);
  });

  for (const signatures of signaturesByInput.slice(1)) {
    const counts = new Map<string, number>();
    signatures.forEach(signature => {
      counts.set(signature, (counts.get(signature) ?? 0) + 1);
    });
    firstCounts.forEach((count, signature) => {
      firstCounts.set(signature, Math.min(count, counts.get(signature) ?? 0));
    });
  }
  return firstCounts;
};

const takeShared = <T,>(
  values: readonly T[],
  signatureFor: (value: T) => string,
  remainingCounts: Map<string, number>
): T[] => values.filter(value => {
  const signature = signatureFor(value);
  const remaining = remainingCounts.get(signature) ?? 0;
  if (remaining <= 0) return false;
  remainingCounts.set(signature, remaining - 1);
  return true;
});

export interface LayerBulkOperationView {
  input: ProductOperationsInput;
  mixed: boolean;
  message: string | null;
}

export const resolveLayerBulkOperationView = (
  inputs: readonly ProductOperationsInput[]
): LayerBulkOperationView => {
  const first = inputs[0];
  if (!first) {
    throw new Error('At least one active layer side is required.');
  }

  const signatures = inputs.map(collectionSignature);
  const mixed = signatures.some(signature => signature !== signatures[0]);
  if (!mixed) {
    return { input: first, mixed: false, message: null };
  }

  const sharedToolCounts = sharedSignatureCounts(
    inputs.map(input => input.tools.map(tool => toolSignature(input, tool)))
  );
  const sharedFinishingCounts = sharedSignatureCounts(
    inputs.map(input =>
      input.finishings.map(finishing => finishingSignature(input, finishing))
    )
  );
  const tools = takeShared(
    first.tools,
    tool => toolSignature(first, tool),
    sharedToolCounts
  );
  const finishings = takeShared(
    first.finishings,
    finishing => finishingSignature(first, finishing),
    sharedFinishingCounts
  );
  const usedGroupIds = new Set([
    ...tools.map(tool => String(tool.operationGroupId)),
    ...finishings.map(finishing => String(finishing.operationGroupId))
  ]);

  return {
    input: {
      ...first,
      groups: first.groups.filter(group =>
        usedGroupIds.has(String(group.operationGroupId))
      ),
      tools,
      finishings
    },
    mixed: true,
    message: LAYER_OPERATIONS_MIXED_MESSAGE
  };
};
