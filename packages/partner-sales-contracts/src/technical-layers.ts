import { z } from 'zod';
import { calculateStairLayerTechnical, calculateLayerSideOperations, parseStableIdentity, parseCanonicalDecimal,
  type PaidRemainderStock, type StairLayerParentGeometry, type StairLayerTechnicalCalculation,
  type StairLayerTechnicalSource, type StairLayerConflict } from '@sabalanerp/contract-product-graph';
import { IdSchema, InstantSchema } from './primitives';
import { technicalDecimal as decimal } from './technical-values';
import type { PartnerTechnicalPreviewCatalog } from './technical-draft';
import { PartnerTechnicalOperationsIntentSchema, previewTechnicalOperations } from './technical-operations';

const newMaterial = {
  catalogItemId: IdSchema, catalogSnapshotVersion: InstantSchema,
  sourceRows: z.array(z.object({ sourceRowId: IdSchema, lengthMeters: decimal.optional(),
    widthMeters: decimal.optional(), quantity: z.number().int().safe().optional(),
  }).strict()),
};
export const PartnerTechnicalLayerSchema = z.object({
  kind: z.literal('layer'), creationOrder: z.number().int().nonnegative().safe(),
  layerConfigurationId: IdSchema, parentProductRowId: IdSchema, sourceBatchId: IdSchema,
  catalogItemId: IdSchema, catalogSnapshotVersion: InstantSchema,
  layersPerParentPiece: z.number().int().safe().optional(), widthMeters: decimal.optional(),
  widthDisplayUnit: z.enum(['cm', 'm']), targetSides: z.array(z.enum(['front', 'back', 'left', 'right'])),
  source: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('paid-remainder'), selectedRemainingStoneIds: z.array(IdSchema) }).strict(),
    z.object({ kind: z.literal('parent-material'), selectedRemainingStoneIds: z.array(IdSchema), ...newMaterial }).strict(),
    z.object({ kind: z.literal('new-material'), ...newMaterial }).strict(),
  ]).optional(),
  sawKerfEnabled: z.boolean(), calibrationEnabled: z.boolean(), description: z.string().max(4000).optional(),
  sideOperations: z.array(z.object({ side: z.enum(['front', 'back', 'left', 'right']),
    operationCollectionId: IdSchema, scopeIntent: z.enum(['all-strips', 'side', 'side-subset']),
    operations: PartnerTechnicalOperationsIntentSchema,
  }).strict()).optional(),
}).strict();
export type PartnerTechnicalLayer = z.infer<typeof PartnerTechnicalLayerSchema>;
export interface TechnicalLayerParent {
  geometry: StairLayerParentGeometry; catalogItemId: string; catalogSnapshotVersion: string;
}

export function previewTechnicalLayer(inputRevision: number, intent: PartnerTechnicalLayer,
  parent: TechnicalLayerParent | undefined, inventory: readonly PaidRemainderStock[],
  catalog: PartnerTechnicalPreviewCatalog,
): StairLayerTechnicalCalculation & { readonly inventory?: readonly PaidRemainderStock[] } {
  const incomplete = (field: string): StairLayerTechnicalCalculation => ({ ok: false, inputRevision,
    conflicts: [{ code: 'invalid-layer-input', field, entityId: intent.layerConfigurationId,
      message: 'مشخصات فنی لایه و منبع آن را کامل کنید.' }] });
  const item = catalog.operations.find(entry => entry.kind === 'LAYER' && entry.catalogItemId === intent.catalogItemId &&
    entry.catalogSnapshotVersion === intent.catalogSnapshotVersion);
  if (!item || item.kind !== 'LAYER') return incomplete('catalogItemId');
  if (!parent) return incomplete('parentProductRowId');
  if (intent.widthMeters === undefined || intent.layersPerParentPiece === undefined) return incomplete('widthMeters');
  if (!intent.source) return incomplete('source');
  if (intent.source.kind === 'parent-material' && (intent.source.catalogItemId !== parent.catalogItemId ||
    intent.source.catalogSnapshotVersion !== parent.catalogSnapshotVersion)) {
    return { ok: false, inputRevision, conflicts: [{ code: 'layer-parent-mismatch', field: 'source',
      entityId: intent.layerConfigurationId, message: 'سنگ اصلی لایه باید همان مشخصات ثبت‌شدهٔ والد باشد.' }] };
  }
  // The canonical packing engine knows geometry, not the editor's parent
  // eligibility. Bind the selection before allowing it to consume inventory.
  const parentMaterial = intent.source.kind === 'parent-material';
  if (intent.source.kind !== 'new-material' && intent.source.selectedRemainingStoneIds.some(id =>
    inventory.some(stock => (stock.remainingStoneId === id || stock.remainingStoneId.startsWith(`${id}:layer-remainder:`)) &&
      (stock.ownerProductRowId !== intent.parentProductRowId || (parentMaterial && stock.catalogProductId !== parent.catalogItemId))))) {
    return { ok: false, inputRevision, conflicts: [{ code: 'layer-parent-mismatch', field: 'source',
      entityId: intent.layerConfigurationId, message: 'منبع لایه باید به والد و نوع سنگ انتخاب‌شده تعلق داشته باشد.' }] };
  }
  let source: StairLayerTechnicalSource;
  if (intent.source.kind === 'paid-remainder') source = { kind: intent.source.kind,
    selectedRemainingStoneIds: intent.source.selectedRemainingStoneIds.map(id => parseStableIdentity('remaining-stone', id)) };
  else {
    const selection = intent.source;
    const material = catalog.products.find(product => product.catalogItemId === selection.catalogItemId &&
      product.catalogSnapshotVersion === selection.catalogSnapshotVersion);
    if (!material || intent.source.sourceRows.some(row => row.lengthMeters === undefined || row.widthMeters === undefined || row.quantity === undefined)) return incomplete('source');
    const common = { catalogProductId: material.catalogItemId, catalogSnapshotVersion: material.catalogSnapshotVersion,
      sourceRows: intent.source.sourceRows.map(row => ({ sourceRowId: parseStableIdentity('layer-source-row', row.sourceRowId),
        lengthMeters: parseCanonicalDecimal(row.lengthMeters!), widthMeters: parseCanonicalDecimal(row.widthMeters!), quantity: row.quantity! })) };
    source = intent.source.kind === 'new-material' ? { kind: 'new-material', ...common }
      : { kind: 'parent-material', ...common, selectedRemainingStoneIds: intent.source.selectedRemainingStoneIds.map(id => parseStableIdentity('remaining-stone', id)) };
  }
  const geometry = calculateStairLayerTechnical({ parent: parent.geometry, availableInventory: inventory, input: {
    inputRevision, layerConfigurationId: parseStableIdentity('layer-configuration', intent.layerConfigurationId),
    parentProductRowId: parseStableIdentity('product-row', intent.parentProductRowId),
    sourceBatchId: parseStableIdentity('source-batch', intent.sourceBatchId), creationOrder: intent.creationOrder,
    layerCatalogItemId: item.catalogItemId, layerCatalogSnapshotVersion: item.catalogSnapshotVersion,
    layerTitle: item.name, layerUnit: item.unit, layersPerParentPiece: intent.layersPerParentPiece,
    widthMeters: parseCanonicalDecimal(intent.widthMeters), widthDisplayUnit: intent.widthDisplayUnit, targetSides: intent.targetSides,
    source, kerfMeters: parseCanonicalDecimal(intent.sawKerfEnabled ? catalog.sawKerfMeters : '0'),
    calibrationEnabled: intent.calibrationEnabled, description: intent.description, sideOperations: [],
  } });
  if (!geometry.ok || !intent.sideOperations?.length) return geometry;
  const conflicts: StairLayerConflict[] = [];
  const sides = intent.sideOperations.flatMap(side => {
    const strip = geometry.result.physicalStrips.find(value => value.side === side.side);
    if (!strip) {
      conflicts.push({ code: 'layer-operation-invalid', field: `sideOperations.${side.side}`, entityId: side.side,
        message: 'عملیات فقط روی ضلع انتخاب‌شدهٔ لایه قابل اعمال است.' });
      return [];
    }
    return [{ side: side.side, scopeIntent: side.scopeIntent,
      operationCollectionId: parseStableIdentity('layer-operation-collection', side.operationCollectionId),
      operations: { productRowId: parseStableIdentity('product-row', intent.parentProductRowId), inputRevision,
        operationScopeId: side.operationCollectionId,
        lengthMeters: strip.lengthMeters, widthMeters: strip.widthMeters, quantity: strip.quantity, intent: side.operations } }];
  });
  // Reuse the canonical side/scope checks and already-calculated strip facts;
  // neither cutting nor packing is repeated just to bind operation quantities.
  const operations = calculateLayerSideOperations({ parentProductRowId: geometry.result.parentProductRowId,
    layerConfigurationId: geometry.result.layerConfigurationId, sideOperations: sides }, geometry.result.physicalStrips,
  ({ intent: operationsIntent, ...facts }) => previewTechnicalOperations(operationsIntent, facts, catalog.operations));
  if (!operations.ok) conflicts.push(...operations.conflicts);
  const result = { ...geometry.result, sideOperationResults: operations.results };
  return conflicts.length ? { ok: false, inputRevision, result, conflicts, inventory: geometry.inventory }
    : { ok: true, result, inventory: geometry.inventory };
}
