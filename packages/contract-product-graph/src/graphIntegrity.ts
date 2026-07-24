import type {
  CanonicalProductGraph,
  ProductGraphConflict
} from './productGraph';
import { stableCanonicalJson } from './canonicalJson';

const duplicateIdentityConflict = (
  collection: string,
  identity: string
): ProductGraphConflict => ({
  code: 'duplicate-stable-identity',
  path: [collection, identity],
  entityId: identity,
  message: 'Canonical product graph contains a duplicate stable identity.'
});

const collectDuplicateIdentityConflicts = (
  collection: string,
  identities: readonly string[]
): ProductGraphConflict[] => {
  const seen = new Set<string>();
  const reported = new Set<string>();
  const conflicts: ProductGraphConflict[] = [];
  identities.forEach(identity => {
    if (seen.has(identity) && !reported.has(identity)) {
      reported.add(identity);
      conflicts.push(duplicateIdentityConflict(collection, identity));
    }
    seen.add(identity);
  });
  return conflicts;
};

export const findGraphIntegrityConflicts = (
  graph: CanonicalProductGraph
): ProductGraphConflict[] => {
  const conflicts: ProductGraphConflict[] = [];
  const productRowIds = new Set(graph.rows.map(row => row.productRowId));
  const stairSystemIds = new Set(
    graph.stairSystems.map(system => system.stairSystemId)
  );
  const sourceBatchIds = new Set(graph.sourceBatches.map(batch => batch.sourceBatchId));
  const remainingStoneIds = new Set(
    [
      ...graph.remainingStones.map(stone => stone.remainingStoneId),
      ...graph.sourceBatches.flatMap(
        batch => (batch.initialRemainders ?? []).map(stone => stone.remainingStoneId)
      ),
      ...graph.allocations.flatMap(allocation => allocation.generatedRemainingStoneIds)
    ]
  );
  const operationGroupIds = new Set(
    graph.operationGroups.map(group => group.operationGroupId)
  );

  conflicts.push(
    ...collectDuplicateIdentityConflicts(
      'rows',
      graph.rows.map(row => row.productRowId)
    ),
    ...collectDuplicateIdentityConflicts(
      'stairSystems',
      graph.stairSystems.map(system => system.stairSystemId)
    ),
    ...collectDuplicateIdentityConflicts(
      'layerConfigurations',
      graph.layerConfigurations.map(layer => layer.layerConfigurationId)
    ),
    ...collectDuplicateIdentityConflicts(
      'sourceBatches',
      graph.sourceBatches.map(batch => batch.sourceBatchId)
    ),
    ...collectDuplicateIdentityConflicts(
      'remainingStones',
      graph.remainingStones.map(stone => stone.remainingStoneId)
    ),
    ...collectDuplicateIdentityConflicts(
      'sourceBatches.initialRemainders',
      graph.sourceBatches.flatMap(
        batch => (batch.initialRemainders ?? []).map(stone => stone.remainingStoneId)
      )
    ),
    ...collectDuplicateIdentityConflicts(
      'allocations',
      graph.allocations.map(allocation => allocation.allocationId)
    ),
    ...collectDuplicateIdentityConflicts(
      'operationGroups',
      graph.operationGroups.map(group => group.operationGroupId)
    ),
    ...collectDuplicateIdentityConflicts(
      'toolSelections',
      graph.toolSelections.map(selection => selection.toolSelectionId)
    ),
    ...collectDuplicateIdentityConflicts(
      'finishingSelections',
      graph.finishingSelections.map(selection => selection.finishingSelectionId)
    )
  );

  const catalogSnapshotsByIdentity = new Map<string, string>();
  graph.catalogSnapshots.forEach(snapshot => {
    const identity = `${snapshot.catalogProductId}\u0000${snapshot.snapshotVersion}`;
    const truth = stableCanonicalJson(snapshot);
    const existingTruth = catalogSnapshotsByIdentity.get(identity);
    if (existingTruth !== undefined) {
      conflicts.push({
        code: existingTruth === truth
          ? 'duplicate-stable-identity'
          : 'catalog-snapshot-conflict',
        path: [
          'catalogSnapshots',
          snapshot.catalogProductId,
          snapshot.snapshotVersion
        ],
        entityId: `${snapshot.catalogProductId}:${snapshot.snapshotVersion}`,
        message: existingTruth === truth
          ? 'Canonical product graph contains a duplicate catalog snapshot identity.'
          : 'Catalog snapshot identity has contradictory immutable facts.'
      });
    } else {
      catalogSnapshotsByIdentity.set(identity, truth);
    }
  });

  graph.rows.forEach(row => {
    if (row.stairPart && !stairSystemIds.has(row.stairPart.stairSystemId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['rows', row.productRowId, 'stairPart', 'stairSystemId'],
        productRowId: row.productRowId,
        message: 'Stair part references a missing stair system.',
        received: row.stairPart.stairSystemId
      });
    }
    if (row.stairPart) {
      const system = graph.stairSystems.find(
        item => item.stairSystemId === row.stairPart?.stairSystemId
      );
      if (
        system &&
        (
          system.catalogProductId !== row.catalogProductId ||
          system.catalogSnapshotVersion !== row.catalogSnapshotVersion
        )
      ) {
        conflicts.push({
          code: 'catalog-snapshot-conflict',
          path: ['rows', row.productRowId, 'stairPart', 'catalogIdentity'],
          productRowId: row.productRowId,
          message: 'Stair part catalog identity differs from its stair system.'
        });
      }
    }
    if (row.stairPart && row.productType !== 'stair') {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['rows', row.productRowId, 'stairPart'],
        productRowId: row.productRowId,
        message: 'Stair-part facts can only belong to a stair row.'
      });
    }
    if (row.parentProductRowId && !productRowIds.has(row.parentProductRowId)) {
      conflicts.push({
        code: 'orphan-product-reference',
        path: ['rows', row.productRowId, 'parentProductRowId'],
        productRowId: row.productRowId,
        message: 'Contract product row references a missing parent product row.',
        received: row.parentProductRowId
      });
    }
    if (row.sourceProductRowId && !productRowIds.has(row.sourceProductRowId)) {
      conflicts.push({
        code: 'orphan-product-reference',
        path: ['rows', row.productRowId, 'sourceProductRowId'],
        productRowId: row.productRowId,
        message: 'Contract product row references a missing source product row.',
        received: row.sourceProductRowId
      });
    }
    const hasSnapshot = graph.catalogSnapshots.some(snapshot =>
      snapshot.catalogProductId === row.catalogProductId &&
      snapshot.snapshotVersion === row.catalogSnapshotVersion
    );
    if (!hasSnapshot) {
      conflicts.push({
        code: 'catalog-snapshot-missing',
        path: ['rows', row.productRowId, 'catalogSnapshotVersion'],
        productRowId: row.productRowId,
        message: 'Contract product row does not have its referenced catalog snapshot.',
        received: row.catalogSnapshotVersion
      });
    }
  });

  graph.stairSystems.forEach(system => {
    const hasSnapshot = graph.catalogSnapshots.some(snapshot =>
      snapshot.catalogProductId === system.catalogProductId &&
      snapshot.snapshotVersion === system.catalogSnapshotVersion
    );
    if (!hasSnapshot) {
      conflicts.push({
        code: 'catalog-snapshot-missing',
        path: ['stairSystems', system.stairSystemId, 'catalogSnapshotVersion'],
        entityId: system.stairSystemId,
        received: system.catalogSnapshotVersion,
        message: 'Stair system does not have its shared catalog snapshot.'
      });
    }
  });

  graph.layerConfigurations.forEach(layer => {
    if (!productRowIds.has(layer.parentProductRowId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['layerConfigurations', layer.layerConfigurationId, 'parentProductRowId'],
        entityId: layer.layerConfigurationId,
        message: 'Layer configuration references a missing parent product row.',
        received: layer.parentProductRowId
      });
    }
    if (layer.sourceBatchId && !sourceBatchIds.has(layer.sourceBatchId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['layerConfigurations', layer.layerConfigurationId, 'sourceBatchId'],
        entityId: layer.layerConfigurationId,
        message: 'Layer configuration references a missing source batch.',
        received: layer.sourceBatchId
      });
    }
  });

  graph.sourceBatches.forEach(batch => {
    if (batch.ownerProductRowId && !productRowIds.has(batch.ownerProductRowId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['sourceBatches', batch.sourceBatchId, 'ownerProductRowId'],
        entityId: batch.sourceBatchId,
        message: 'Source batch references a missing owner product row.',
        received: batch.ownerProductRowId
      });
    }
    (batch.initialRemainders ?? []).forEach(stone => {
      if (
        stone.sourceBatchId !== batch.sourceBatchId ||
        stone.ownerProductRowId !== batch.ownerProductRowId
      ) {
        conflicts.push({
          code: 'orphan-graph-reference',
          path: ['sourceBatches', batch.sourceBatchId, 'initialRemainders'],
          entityId: stone.remainingStoneId,
          message: 'Initial remainder identity does not belong to its source batch owner.'
        });
      }
    });
  });

  graph.remainingStones.forEach(stone => {
    if (!sourceBatchIds.has(stone.sourceBatchId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['remainingStones', stone.remainingStoneId, 'sourceBatchId'],
        entityId: stone.remainingStoneId,
        message: 'Remaining stone references a missing source batch.',
        received: stone.sourceBatchId
      });
    }
    if (!productRowIds.has(stone.ownerProductRowId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['remainingStones', stone.remainingStoneId, 'ownerProductRowId'],
        entityId: stone.remainingStoneId,
        message: 'Remaining stone references a missing owner product row.',
        received: stone.ownerProductRowId
      });
    }
  });

  graph.allocations.forEach(allocation => {
    if (!productRowIds.has(allocation.sourceProductRowId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['allocations', allocation.allocationId, 'sourceProductRowId'],
        entityId: allocation.allocationId,
        message: 'Allocation references a missing source product row.',
        received: allocation.sourceProductRowId
      });
    }
    if (!productRowIds.has(allocation.targetProductRowId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['allocations', allocation.allocationId, 'targetProductRowId'],
        entityId: allocation.allocationId,
        message: 'Allocation references a missing target product row.',
        received: allocation.targetProductRowId
      });
    }
    if (
      !remainingStoneIds.has(allocation.sourceRemainingStoneId)
    ) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['allocations', allocation.allocationId, 'sourceRemainingStoneId'],
        entityId: allocation.allocationId,
        message: 'Allocation references a missing remaining stone.',
        received: allocation.sourceRemainingStoneId
      });
    }
  });

  graph.operationGroups.forEach(group => {
    if (!productRowIds.has(group.productRowId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['operationGroups', group.operationGroupId, 'productRowId'],
        entityId: group.operationGroupId,
        message: 'Operation group references a missing product row.',
        received: group.productRowId
      });
    }
  });

  graph.toolSelections.forEach(selection => {
    if (!operationGroupIds.has(selection.operationGroupId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['toolSelections', selection.toolSelectionId, 'operationGroupId'],
        entityId: selection.toolSelectionId,
        message: 'Tool selection references a missing operation group.',
        received: selection.operationGroupId
      });
    }
  });

  graph.finishingSelections.forEach(selection => {
    if (!operationGroupIds.has(selection.operationGroupId)) {
      conflicts.push({
        code: 'orphan-graph-reference',
        path: ['finishingSelections', selection.finishingSelectionId, 'operationGroupId'],
        entityId: selection.finishingSelectionId,
        message: 'Finishing selection references a missing operation group.',
        received: selection.operationGroupId
      });
    }
  });

  return conflicts;
};
