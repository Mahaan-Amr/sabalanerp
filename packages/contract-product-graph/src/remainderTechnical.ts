import type { PaidRemainderStock, RemainderReplayConflict } from './remainderPolicy';
import { replayRemainderGeometry, type RemainderGeometryAllocation, type RemainderTechnicalIntent } from './remainderGeometry';
import { projectTechnicalPacking, TECHNICAL_PACKING_VERSION, type TechnicalPackingPlan } from './technicalPacking';
import { technicalShape, technicalDecimal, technicalIdentity, technicalRevision, technicalStock } from './technicalInput';

export type { RemainderTechnicalIntent } from './remainderGeometry';
export interface RemainderTechnicalInput {
  readonly inputRevision: number;
  readonly baseInventory: readonly PaidRemainderStock[];
  readonly childIntents: readonly RemainderTechnicalIntent[];
}
export interface RemainderTechnicalAllocation extends Omit<RemainderGeometryAllocation, 'packingPlan'> {
  readonly packingPlan: TechnicalPackingPlan;
}
export interface RemainderTechnicalResult {
  readonly inputRevision: number;
  readonly inventory: readonly PaidRemainderStock[];
  readonly allocations: readonly RemainderTechnicalAllocation[];
}
export type RemainderTechnicalReplay =
  | { readonly ok: true; readonly result: RemainderTechnicalResult }
  | { readonly ok: false; readonly inputRevision?: number; readonly conflicts: readonly RemainderReplayConflict[];
      readonly result?: RemainderTechnicalResult };

export const replayRemainderTechnical = (input: RemainderTechnicalInput): RemainderTechnicalReplay => {
  const inputRevision = technicalRevision(input);
  try {
    technicalShape(input, ['inputRevision', 'baseInventory', 'childIntents']);
    if (inputRevision === undefined || !Array.isArray(input.baseInventory) || !Array.isArray(input.childIntents)) throw new TypeError();
    input.baseInventory.forEach(technicalStock);
    for (const intent of input.childIntents) {
      technicalShape(intent, ['sourcePieceQuantities', 'secondaryOwnerProductRowId', 'allocationId',
        'allocationOrder', 'childProductRowId', 'sourceProductRowId', 'selectedRemainingStoneId',
        'catalogProductId', 'lengthMeters', 'widthMeters', 'quantity', 'kerfMeters', 'calibrationEnabled']);
      for (const value of [intent.allocationId, intent.childProductRowId, intent.sourceProductRowId, intent.catalogProductId]) technicalIdentity(value);
      if (intent.secondaryOwnerProductRowId !== undefined) technicalIdentity(intent.secondaryOwnerProductRowId);
      if (intent.selectedRemainingStoneId !== undefined) technicalIdentity(intent.selectedRemainingStoneId);
      for (const value of [intent.lengthMeters, intent.widthMeters, intent.kerfMeters]) technicalDecimal(value);
      if (typeof intent.calibrationEnabled !== 'boolean') throw new TypeError();
    }
  } catch {
    return { ok: false, ...(inputRevision === undefined ? {} : { inputRevision }),
      conflicts: [{ code: 'invalid-remainder-input', path: [], message: 'Invalid technical remainder input.' }] };
  }
  const geometry = replayRemainderGeometry({ ...input, policyVersion: TECHNICAL_PACKING_VERSION });
  const result = geometry.result ? { inputRevision: input.inputRevision, inventory: geometry.result.inventory,
    allocations: geometry.result.allocations.map(allocation => ({ ...allocation,
      packingPlan: projectTechnicalPacking(allocation.packingPlan) })) } : undefined;
  if (!geometry.ok) return { ok: false, inputRevision: input.inputRevision, conflicts: geometry.conflicts,
    ...(result ? { result } : {}) };
  return { ok: true, result: result! };
};
