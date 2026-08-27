import { parseStableIdentity, type StableIdentity } from './stableIdentity';
import type { ProductOperationsConflict } from './operationsPolicy';
import type { StairLayerSide, StairLayerPhysicalStripDemand, StairLayerConflict } from './stairLayerPolicy';
import type { CanonicalDecimal } from './canonicalDecimal';

export interface LayerSideResult<Result> {
  readonly side: StairLayerSide;
  readonly operationCollectionId: StableIdentity<'layer-operation-collection'>;
  readonly scopeIntent: 'all-strips' | 'side' | 'side-subset';
  readonly result: Result;
}
interface OperationGeometry {
  readonly productRowId: StableIdentity<'product-row'>;
  readonly lengthMeters: CanonicalDecimal;
  readonly widthMeters: CanonicalDecimal;
  readonly quantity?: number;
}
/** One shared parent/scope validator for priced and technical layer operations. */
export const calculateLayerSideOperations = <Operation extends OperationGeometry, Result>(
  input: {
    readonly parentProductRowId: StableIdentity<'product-row'>;
    readonly layerConfigurationId: StableIdentity<'layer-configuration'>;
    readonly sideOperations: readonly {
      readonly side: StairLayerSide; readonly operations: Operation;
      readonly operationCollectionId?: StableIdentity<'layer-operation-collection'>;
      readonly scopeIntent?: 'all-strips' | 'side' | 'side-subset';
    }[];
  },
  strips: readonly StairLayerPhysicalStripDemand[],
  calculate: (input: Operation) => { readonly ok: true; readonly result: Result } |
    { readonly ok: false; readonly conflicts: readonly ProductOperationsConflict[]; readonly result?: Result },
): { readonly ok: true; readonly results: readonly LayerSideResult<Result>[] } |
   { readonly ok: false; readonly results: readonly LayerSideResult<Result>[]; readonly conflicts: readonly StairLayerConflict[] } => {
    const results: LayerSideResult<Result>[] = [];
    const conflicts: StairLayerConflict[] = [];
    const operationSides = new Set<StairLayerSide>();
    for (const sideOperation of input.sideOperations) {
      if (operationSides.has(sideOperation.side)) {
        conflicts.push({
            code: 'layer-operation-invalid',
            field: `sideOperations.${sideOperation.side}`,
            entityId: sideOperation.side,
            message: 'Each selected side must own one combined operation draft.'
          });
        continue;
      }
      operationSides.add(sideOperation.side);
      const strip = strips.find(item => item.side === sideOperation.side);
      if (!strip) {
        conflicts.push({
            code: 'layer-operation-invalid',
            field: 'sideOperations',
            entityId: sideOperation.side,
            message: 'Layer operations may target only a selected physical side.'
          });
        continue;
      }
      if (
        sideOperation.operations.productRowId !== input.parentProductRowId ||
        sideOperation.operations.lengthMeters !== strip.lengthMeters ||
        sideOperation.operations.widthMeters !== strip.widthMeters ||
        sideOperation.operations.quantity !== strip.quantity
      ) {
        conflicts.push({
            code: 'layer-parent-mismatch',
            field: `sideOperations.${sideOperation.side}`,
            entityId: sideOperation.side,
            message: 'Layer operations must use authoritative strip geometry.'
          });
        continue;
      }
      const operations = calculate(sideOperation.operations);
      if (!operations.ok) {
        conflicts.push(...operations.conflicts.map(conflict => ({
            code: 'layer-operation-invalid' as const,
            field: `sideOperations.${sideOperation.side}.${conflict.path.join('.')}`,
            entityId: conflict.entityId,
            message: conflict.message
          })));
      }
      if (operations.result === undefined) continue;
      results.push({
        side: sideOperation.side,
        operationCollectionId:
          sideOperation.operationCollectionId ||
          parseStableIdentity(
            'layer-operation-collection',
            `${input.layerConfigurationId}:operation:${sideOperation.side}`
          ),
        scopeIntent: sideOperation.scopeIntent || 'side',
        result: operations.result
      });
    }

    return conflicts.length > 0 ? { ok: false, results, conflicts } : { ok: true, results };
};
