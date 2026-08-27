import type { PackingPlan } from './packingPricing';

/** Geometry only. Calculation evidence stays with the authoritative graph owner. */
export type TechnicalPackingPlan = Omit<PackingPlan, 'policyVersion' | 'inputHash' | 'resultHash'>;

export const projectTechnicalPacking = (plan: PackingPlan): TechnicalPackingPlan => ({
  consumedSources: plan.consumedSources,
  unusedSources: plan.unusedSources,
  placements: plan.placements,
  cuts: plan.cuts,
  longitudinalCutMeters: plan.longitudinalCutMeters,
  crossCutMeters: plan.crossCutMeters,
  calibrationMeters: plan.calibrationMeters,
  kerfWasteSquareMeters: plan.kerfWasteSquareMeters,
  remainders: plan.remainders,
});

// Identifies the currently implemented pure packing algorithm for rate-free previews.
// Priced/historical callers keep passing their original recorded version to the core.
export const TECHNICAL_PACKING_VERSION = 'packing-v1';
