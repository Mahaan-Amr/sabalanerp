import type { PaidRemainderStock } from './remainderPolicy';
import type { StairLayerParentGeometry, StairLayerConflict } from './stairLayerPolicy';
import type { StableIdentity } from './stableIdentity';

interface LayerIdentity {
  readonly layerConfigurationId: StableIdentity<'layer-configuration'>;
  readonly parentProductRowId: StableIdentity<'product-row'>;
  readonly creationOrder: number;
}
export interface LayerReplayState<Input, Result> {
  readonly configurations: readonly { readonly input: Input; readonly result: Result }[];
  readonly inventory: readonly PaidRemainderStock[];
}
const cloneStock = (stock: PaidRemainderStock): PaidRemainderStock => ({ ...stock });
/** Shared ordered replay; failed configurations never consume the caller's inventory. */
export const replayLayerSequence = <Input extends LayerIdentity, Result>({
  inputs, parents, baseInventory,
}: {
  readonly inputs: readonly Input[];
  readonly parents: ReadonlyMap<StableIdentity<'product-row'>, StairLayerParentGeometry>;
  readonly baseInventory: readonly PaidRemainderStock[];
}, calculate: (args: { input: Input; parent: StairLayerParentGeometry; availableInventory: readonly PaidRemainderStock[] }) =>
  { readonly ok: true; readonly result: Result; readonly inventory: readonly PaidRemainderStock[] } |
  { readonly ok: false; readonly conflicts: readonly StairLayerConflict[] }
): { readonly ok: true; readonly result: LayerReplayState<Input, Result> } |
   { readonly ok: false; readonly result: LayerReplayState<Input, Result>; readonly conflicts: readonly StairLayerConflict[] } => {
  const identities = new Set<string>();
  let inventory = baseInventory.map(cloneStock);
  const configurations: Array<
    LayerReplayState<Input, Result>['configurations'][number]
  > = [];
  const ordered = [...inputs].sort(
    (left, right) =>
      left.creationOrder - right.creationOrder ||
      left.layerConfigurationId.localeCompare(right.layerConfigurationId)
  );
  for (const input of ordered) {
    if (identities.has(input.layerConfigurationId)) {
      return {
        ok: false,
        result: { configurations, inventory },
        conflicts: [{
          code: 'invalid-layer-input',
          field: 'layerConfigurationId',
          entityId: input.layerConfigurationId,
          message: 'Layer configuration identity is duplicated.'
        }]
      };
    }
    identities.add(input.layerConfigurationId);
    const parent = parents.get(input.parentProductRowId);
    if (!parent) {
      return {
        ok: false,
        result: { configurations, inventory },
        conflicts: [{
          code: 'layer-parent-mismatch',
          field: 'parentProductRowId',
          entityId: input.layerConfigurationId,
          message: 'Layer configuration references a missing stair parent.'
        }]
      };
    }
    const calculated = calculate({
      input,
      parent,
      availableInventory: inventory
    });
    if (!calculated.ok) {
      return {
        ok: false,
        result: { configurations, inventory },
        conflicts: calculated.conflicts.map(conflict => ({
          ...conflict,
          field: `${input.layerConfigurationId}.${conflict.field}`
        }))
      };
    }
    configurations.push({ input, result: calculated.result });
    inventory = calculated.inventory.map(cloneStock);
  }
  return { ok: true, result: { configurations, inventory } };
};

