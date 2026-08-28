import { parseCanonicalDecimal as decimal, parseStableIdentity, type StairLayerConfigurationInput, type StairLayerSourceSelection } from '@sabalanerp/contract-product-graph';
import type { PartnerTechnicalDependent, PartnerTechnicalDependentPreview } from '@sabalanerp/partner-sales-contracts';
import type { PartnerTechnicalGraphContext } from './technicalGraph';
import { technicalGraphOperations } from './technicalGraphOperations';

export function technicalGraphLayer(intent: Extract<PartnerTechnicalDependent, { kind: 'layer' }>,
  preview: PartnerTechnicalDependentPreview, context: PartnerTechnicalGraphContext): StairLayerConfigurationInput {
  if (preview.kind !== 'layer' || !preview.calculation.ok || !intent.source) throw new Error('Incomplete layer');
  const items = context.catalog.operations.filter(item => item.kind === 'LAYER' && item.catalogItemId === intent.catalogItemId && item.catalogSnapshotVersion === intent.catalogSnapshotVersion);
  const evidence = context.layers?.filter(item => item.catalogItemId === intent.catalogItemId && item.catalogSnapshotVersion === intent.catalogSnapshotVersion) ?? [];
  if (items.length !== 1 || evidence.length !== 1 || items[0].kind !== 'LAYER') throw new Error('Missing layer evidence');
  const item = items[0];
  const parentProductRowId = parseStableIdentity('product-row', intent.parentProductRowId);
  let source: StairLayerSourceSelection;
  if (intent.source.kind === 'paid-remainder') source = { kind: 'paid-remainder',
    selectedRemainingStoneIds: intent.source.selectedRemainingStoneIds.map(id => parseStableIdentity('remaining-stone', id)) };
  else {
    const selection = intent.source;
    const materials = context.products.filter(item => item.catalogItemId === selection.catalogItemId && item.catalogSnapshotVersion === selection.catalogSnapshotVersion);
    if (materials.length !== 1 || materials[0].layerMaterialRateToman === undefined) throw new Error('Missing layer material evidence');
    const common = { catalogProductId: selection.catalogItemId, catalogSnapshotVersion: selection.catalogSnapshotVersion,
      materialRateToman: decimal(materials[0].layerMaterialRateToman),
      sourceRows: selection.sourceRows.map(row => ({ sourceRowId: parseStableIdentity('layer-source-row', row.sourceRowId),
        lengthMeters: decimal(row.lengthMeters!), widthMeters: decimal(row.widthMeters!), quantity: row.quantity! })) };
    source = selection.kind === 'new-material' ? { kind: 'new-material', ...common }
      : { kind: 'parent-material', ...common, selectedRemainingStoneIds: selection.selectedRemainingStoneIds.map(id => parseStableIdentity('remaining-stone', id)) };
  }
  return { ...evidence[0], calculationPolicyVersion: context.policy.calculation, packingPolicyVersion: context.policy.packing,
    pricingPolicyVersion: context.policy.pricing, roundingPolicyVersion: context.policy.rounding,
    layerConfigurationId: parseStableIdentity('layer-configuration', intent.layerConfigurationId), parentProductRowId,
    sourceBatchId: parseStableIdentity('source-batch', intent.sourceBatchId), creationOrder: intent.creationOrder,
    layerCatalogItemId: item.catalogItemId, layerCatalogSnapshotVersion: item.catalogSnapshotVersion,
    layerTitle: item.name, layerUnit: item.unit, layersPerParentPiece: intent.layersPerParentPiece!,
    widthMeters: decimal(intent.widthMeters!), widthDisplayUnit: intent.widthDisplayUnit, targetSides: intent.targetSides,
    source,
    kerfMeters: decimal(intent.sawKerfEnabled ? context.catalog.sawKerfMeters : '0'), calibrationEnabled: intent.calibrationEnabled,
    description: intent.description,
    sideOperations: (intent.sideOperations ?? []).map(side => {
      const strip = preview.calculation.ok ? preview.calculation.result.physicalStrips.find(strip => strip.side === side.side) : undefined;
      if (!strip) throw new Error('Missing layer strip');
      return { side: side.side, scopeIntent: side.scopeIntent,
        operationCollectionId: parseStableIdentity('layer-operation-collection', side.operationCollectionId),
        operations: technicalGraphOperations(side.operations, { productRowId: parentProductRowId,
          operationScopeId: side.operationCollectionId, lengthMeters: strip.lengthMeters, widthMeters: strip.widthMeters, quantity: strip.quantity }, context) };
    }),
  };
}
