import Decimal from 'decimal.js';
import {
  parseProductOperationsInput,
  type ProductOperationsInput
} from './operationsPolicy';
import {
  parseStableIdentity,
  type StableIdentity,
  type StableIdentityKind
} from './stableIdentity';

export type OperationIdentityCollisionKind =
  | 'operation-owner-mismatch'
  | 'duplicate-operation-group'
  | 'duplicate-tool-selection'
  | 'duplicate-finishing-selection'
  | 'derived-no-operation-group-collision';

export interface OperationIdentityRepairEvidence {
  readonly productRowId: string;
  readonly collisionKinds: readonly OperationIdentityCollisionKind[];
  readonly collisionCount: number;
}

export interface OperationIdentityRepairResult<Product> {
  readonly products: Product[];
  readonly repairedProductRowIds: string[];
  readonly blockedProductRowIds: string[];
  readonly evidence: OperationIdentityRepairEvidence[];
}

interface ProductAnalysis {
  readonly rowIndex: number;
  readonly rowId?: string;
  readonly input?: ProductOperationsInput;
  readonly blocked: boolean;
  readonly localCollisionKinds: OperationIdentityCollisionKind[];
  readonly groupOccurrences: Array<{
    readonly identity: string;
    readonly kind: 'explicit' | 'derived';
  }>;
  readonly toolIdentities: string[];
  readonly finishingIdentities: string[];
}

interface IdentityOccurrence {
  readonly rowIndex: number;
  readonly kind?: 'explicit' | 'derived';
}

let repairSequence = 0;

const recordFrom = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const rowIdentityFrom = (product: Record<string, unknown>): string | undefined => {
  const identity = product.rowId ?? product.productRowId;
  return typeof identity === 'string' && identity.length > 0
    ? identity
    : undefined;
};

const createRepairIdentity = <Kind extends Extract<
  StableIdentityKind,
  'operation-group' | 'tool-selection' | 'finishing-selection'
>>(
  kind: Kind,
  productRowId: string
): StableIdentity<Kind> => {
  const uuid = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${++repairSequence}`;
  return parseStableIdentity(kind, `${productRowId}:repair:${uuid}`);
};

const addOccurrence = (
  index: Map<string, IdentityOccurrence[]>,
  identity: string,
  occurrence: IdentityOccurrence
) => {
  index.set(identity, [...(index.get(identity) ?? []), occurrence]);
};

const hasRepeated = (identities: readonly string[]): boolean =>
  new Set(identities).size !== identities.length;

const analyzeProduct = (
  product: unknown,
  rowIndex: number
): ProductAnalysis => {
  const productRecord = recordFrom(product);
  const operationRecord = productRecord
    ? recordFrom(productRecord.operationPolicyInput)
    : undefined;
  if (!operationRecord) {
    return {
      rowIndex,
      rowId: productRecord ? rowIdentityFrom(productRecord) : undefined,
      blocked: false,
      localCollisionKinds: [],
      groupOccurrences: [],
      toolIdentities: [],
      finishingIdentities: []
    };
  }

  const rowId = productRecord ? rowIdentityFrom(productRecord) : undefined;
  try {
    const input = parseProductOperationsInput(operationRecord);
    if (!rowId) {
      return {
        rowIndex,
        blocked: true,
        input,
        localCollisionKinds: [],
        groupOccurrences: [],
        toolIdentities: [],
        finishingIdentities: []
      };
    }

    const groupsById = new Map<string, typeof input.groups>();
    input.groups.forEach(group => {
      groupsById.set(
        group.operationGroupId,
        [...(groupsById.get(group.operationGroupId) ?? []), group]
      );
    });
    const contradictoryGroup = Array.from(groupsById.values()).some(groups =>
      groups.some(group => !new Decimal(group.scope).eq(groups[0].scope))
    );
    const knownGroupIds = new Set(input.groups.map(group => group.operationGroupId));
    const orphanSelection = [
      ...input.tools.map(tool => tool.operationGroupId),
      ...input.finishings.map(finishing => finishing.operationGroupId)
    ].some(groupId => !knownGroupIds.has(groupId));
    const toolSelectionIds = input.tools.map(tool => String(tool.toolSelectionId));
    const finishingSelectionIds = input.finishings.map(finishing =>
      String(finishing.finishingSelectionId)
    );
    const appliedSubServices = Array.isArray(productRecord?.appliedSubServices)
      ? productRecord.appliedSubServices
      : [];
    const finishingSnapshots = Array.isArray(productRecord?.finishings)
      ? productRecord.finishings
      : [];
    const snapshotOwnershipIsAmbiguous =
      appliedSubServices.some(snapshot => {
        const snapshotRecord = recordFrom(snapshot);
        return !snapshotRecord ||
          typeof snapshotRecord.id !== 'string' ||
          !toolSelectionIds.includes(snapshotRecord.id);
      }) ||
      finishingSnapshots.some(snapshot => {
        const snapshotRecord = recordFrom(snapshot);
        return !snapshotRecord ||
          typeof snapshotRecord.selectionId !== 'string' ||
          !finishingSelectionIds.includes(snapshotRecord.selectionId);
      });
    if (contradictoryGroup || orphanSelection || snapshotOwnershipIsAmbiguous) {
      return {
        rowIndex,
        rowId,
        input,
        blocked: true,
        localCollisionKinds: [],
        groupOccurrences: [],
        toolIdentities: [],
        finishingIdentities: []
      };
    }

    const uniqueGroups = Array.from(groupsById.values()).map(groups => groups[0]);
    const totalScope = input.quantity === undefined
      ? new Decimal(input.lengthMeters)
      : new Decimal(input.quantity);
    const allocatedScope = uniqueGroups.reduce(
      (total, group) => total.plus(group.scope),
      new Decimal(0)
    );
    if (allocatedScope.gt(totalScope)) {
      return {
        rowIndex,
        rowId,
        input,
        blocked: true,
        localCollisionKinds: [],
        groupOccurrences: [],
        toolIdentities: [],
        finishingIdentities: []
      };
    }

    const groupOccurrences: ProductAnalysis['groupOccurrences'] =
      uniqueGroups.map(group => ({
      identity: String(group.operationGroupId),
      kind: 'explicit' as const
      }));
    if (allocatedScope.lt(totalScope)) {
      groupOccurrences.push({
        identity: `${input.productRowId}:no-operations`,
        kind: 'derived'
      });
    }

    const localCollisionKinds: OperationIdentityCollisionKind[] = [];
    if (input.productRowId !== rowId) {
      localCollisionKinds.push('operation-owner-mismatch');
    }
    if (groupsById.size !== input.groups.length) {
      localCollisionKinds.push('duplicate-operation-group');
    }
    if (hasRepeated(input.tools.map(tool => tool.toolSelectionId))) {
      localCollisionKinds.push('duplicate-tool-selection');
    }
    if (hasRepeated(input.finishings.map(finishing =>
      finishing.finishingSelectionId
    ))) {
      localCollisionKinds.push('duplicate-finishing-selection');
    }

    return {
      rowIndex,
      rowId,
      input,
      blocked: false,
      localCollisionKinds,
      groupOccurrences,
      toolIdentities: toolSelectionIds,
      finishingIdentities: finishingSelectionIds
    };
  } catch {
    return {
      rowIndex,
      rowId,
      blocked: true,
      localCollisionKinds: [],
      groupOccurrences: [],
      toolIdentities: [],
      finishingIdentities: []
    };
  }
};

const rekeyOperationSubtree = <Product extends object>(
  product: Product,
  rowId: string,
  input: ProductOperationsInput
): Product => {
  const productRecord = product as Product & Record<string, unknown>;
  const uniqueGroups = input.groups.filter((group, index, collection) =>
    collection.findIndex(candidate =>
      candidate.operationGroupId === group.operationGroupId
    ) === index
  );
  const groupIds = new Map(uniqueGroups.map(group => [
    String(group.operationGroupId),
    createRepairIdentity('operation-group', rowId)
  ]));
  const tools = input.tools.map(tool => ({
    ...tool,
    toolSelectionId: createRepairIdentity('tool-selection', rowId),
    operationGroupId: groupIds.get(String(tool.operationGroupId))!
  }));
  const finishings = input.finishings.map(finishing => ({
    ...finishing,
    finishingSelectionId: createRepairIdentity('finishing-selection', rowId),
    operationGroupId: groupIds.get(String(finishing.operationGroupId))!
  }));
  const operationPolicyInput: ProductOperationsInput = {
    ...input,
    productRowId: parseStableIdentity('product-row', rowId),
    groups: uniqueGroups.map(group => ({
      ...group,
      operationGroupId: groupIds.get(String(group.operationGroupId))!
    })),
    tools,
    finishings
  };

  const toolIdsByOriginal = new Map<string, string[]>();
  input.tools.forEach((tool, index) => {
    const original = String(tool.toolSelectionId);
    toolIdsByOriginal.set(original, [
      ...(toolIdsByOriginal.get(original) ?? []),
      String(tools[index].toolSelectionId)
    ]);
  });
  const finishingIdsByOriginal = new Map<string, string[]>();
  input.finishings.forEach((finishing, index) => {
    const original = String(finishing.finishingSelectionId);
    finishingIdsByOriginal.set(original, [
      ...(finishingIdsByOriginal.get(original) ?? []),
      String(finishings[index].finishingSelectionId)
    ]);
  });
  const claimedToolIds = new Map<string, number>();
  const claimedFinishingIds = new Map<string, number>();
  const nextMappedId = (
    original: unknown,
    ids: Map<string, string[]>,
    claimed: Map<string, number>,
    fallback: string
  ) => {
    const key = String(original ?? '');
    const occurrence = claimed.get(key) ?? 0;
    claimed.set(key, occurrence + 1);
    return ids.get(key)?.[occurrence] ?? fallback;
  };

  const appliedSubServices = Array.isArray(productRecord.appliedSubServices)
    ? productRecord.appliedSubServices.map(snapshot => {
        const snapshotRecord = recordFrom(snapshot) ?? {};
        return {
          ...snapshotRecord,
          id: nextMappedId(
            snapshotRecord.id,
            toolIdsByOriginal,
            claimedToolIds,
            String(snapshotRecord.id)
          )
        };
      })
    : productRecord.appliedSubServices;
  const finishingSnapshots = Array.isArray(productRecord.finishings)
    ? productRecord.finishings.map(snapshot => {
        const snapshotRecord = recordFrom(snapshot) ?? {};
        return {
          ...snapshotRecord,
          selectionId: nextMappedId(
            snapshotRecord.selectionId,
            finishingIdsByOriginal,
            claimedFinishingIds,
            String(snapshotRecord.selectionId)
          )
        };
      })
    : productRecord.finishings;

  return {
    ...productRecord,
    operationPolicyInput,
    ...(appliedSubServices === undefined ? {} : { appliedSubServices }),
    ...(finishingSnapshots === undefined ? {} : { finishings: finishingSnapshots })
  } as Product;
};

export const repairLegacyProductOperationIdentities = <Product extends object>(
  products: readonly Product[]
): OperationIdentityRepairResult<Product> => {
  const analyses = products.map(analyzeProduct);
  const blockedIndexes = new Set(
    analyses.filter(analysis => analysis.blocked).map(analysis => analysis.rowIndex)
  );
  const repairKindsByIndex = new Map<number, Set<OperationIdentityCollisionKind>>();
  const markRepair = (
    rowIndex: number,
    kind: OperationIdentityCollisionKind
  ) => {
    if (blockedIndexes.has(rowIndex)) return;
    const kinds = repairKindsByIndex.get(rowIndex) ?? new Set();
    kinds.add(kind);
    repairKindsByIndex.set(rowIndex, kinds);
  };
  analyses.forEach(analysis => {
    analysis.localCollisionKinds.forEach(kind =>
      markRepair(analysis.rowIndex, kind)
    );
  });

  const groupIndex = new Map<string, IdentityOccurrence[]>();
  const toolIndex = new Map<string, IdentityOccurrence[]>();
  const finishingIndex = new Map<string, IdentityOccurrence[]>();
  analyses.forEach(analysis => {
    analysis.groupOccurrences.forEach(occurrence =>
      addOccurrence(groupIndex, occurrence.identity, {
        rowIndex: analysis.rowIndex,
        kind: occurrence.kind
      })
    );
    analysis.toolIdentities.forEach(identity =>
      addOccurrence(toolIndex, identity, { rowIndex: analysis.rowIndex })
    );
    analysis.finishingIdentities.forEach(identity =>
      addOccurrence(finishingIndex, identity, { rowIndex: analysis.rowIndex })
    );
  });

  groupIndex.forEach(occurrences => {
    if (occurrences.length < 2) return;
    const explicit = occurrences.filter(occurrence =>
      occurrence.kind === 'explicit'
    );
    const derived = occurrences.filter(occurrence =>
      occurrence.kind === 'derived'
    );
    if (derived.length > 0) {
      explicit.forEach(occurrence =>
        markRepair(occurrence.rowIndex, 'derived-no-operation-group-collision')
      );
      if (explicit.length === 0) {
        derived.slice(1).forEach(occurrence =>
          markRepair(occurrence.rowIndex, 'operation-owner-mismatch')
        );
      }
      return;
    }
    occurrences.slice(1).forEach(occurrence =>
      markRepair(occurrence.rowIndex, 'duplicate-operation-group')
    );
  });
  toolIndex.forEach(occurrences => {
    occurrences.slice(1).forEach(occurrence =>
      markRepair(occurrence.rowIndex, 'duplicate-tool-selection')
    );
  });
  finishingIndex.forEach(occurrences => {
    occurrences.slice(1).forEach(occurrence =>
      markRepair(occurrence.rowIndex, 'duplicate-finishing-selection')
    );
  });

  const repairedProducts = products.map((product, rowIndex) => {
    const analysis = analyses[rowIndex];
    return repairKindsByIndex.has(rowIndex) && analysis.rowId && analysis.input
      ? rekeyOperationSubtree(product, analysis.rowId, analysis.input)
      : product;
  });
  const repairedAnalyses = repairedProducts.map(analyzeProduct);
  repairedAnalyses.forEach(analysis => {
    if (analysis.blocked) blockedIndexes.add(analysis.rowIndex);
  });

  const repairedProductRowIds = Array.from(repairKindsByIndex.keys())
    .filter(index => !blockedIndexes.has(index))
    .map(index => analyses[index].rowId)
    .filter((rowId): rowId is string => !!rowId);
  const blockedProductRowIds = Array.from(blockedIndexes)
    .map(index => analyses[index].rowId)
    .filter((rowId): rowId is string => !!rowId);
  const evidence = Array.from(repairKindsByIndex.entries())
    .filter(([index]) => !blockedIndexes.has(index))
    .map(([index, kinds]) => ({
      productRowId: analyses[index].rowId!,
      collisionKinds: [...kinds],
      collisionCount: kinds.size
    }));

  return {
    products: repairedProducts,
    repairedProductRowIds,
    blockedProductRowIds,
    evidence
  };
};
