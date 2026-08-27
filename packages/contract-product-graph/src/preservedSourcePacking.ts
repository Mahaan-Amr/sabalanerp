import Decimal from 'decimal.js';
import { parseCanonicalDecimal } from './canonicalDecimal';
import { hashCanonicalValue } from './canonicalHash';
import { calculatePackingPlan, type PackingPlan, type PackingRequest, type PackingResult } from './packingPricing';
import { parseStableIdentity } from './stableIdentity';

/** A historical allocation is not a new optimization request. Validate each witnessed source separately. */
export const packPreservedSourceDistribution = (
  request: PackingRequest, distribution: readonly number[]
): PackingResult => {
  const invalid = (): PackingResult => ({ ok: false, conflict: {
    code: 'invalid-packing-input', message: 'The witnessed physical source distribution is invalid.'
  } });
  if (request.sources.length !== 1 || request.demands.length !== 1 ||
    distribution.length > request.sources[0].quantity || !distribution.length ||
    distribution.some(q => !Number.isSafeInteger(q) || q <= 0) ||
    distribution.reduce((s, q) => s + q, 0) !== request.demands[0].quantity) return invalid();
  const plans: PackingPlan[] = [];
  let demandOffset = 0;
  for (const [index, quantity] of distribution.entries()) {
    const result = calculatePackingPlan({ ...request,
      sources: [{ ...request.sources[0], quantity: 1 }], demands: [{ ...request.demands[0], quantity }] });
    if (!result.ok) return result;
    plans.push({ ...result.plan,
      consumedSources: result.plan.consumedSources.map(s => ({ ...s, sourceOrdinal: index })),
      placements: result.plan.placements.map(p => ({ ...p, sourceOrdinal: index, demandOrdinal: p.demandOrdinal + demandOffset })),
      cuts: result.plan.cuts.map(c => ({ ...c, sourceOrdinal: index, cutId: `${c.cutId}:preserved:${index}` })),
      remainders: result.plan.remainders.map(r => ({ ...r, sourceOrdinal: index,
        remainingStoneId: parseStableIdentity('remaining-stone', `${r.remainingStoneId}:preserved:${index}`) }))
    });
    demandOffset += quantity;
  }
  const sum = (key: 'longitudinalCutMeters' | 'crossCutMeters' | 'calibrationMeters' | 'kerfWasteSquareMeters') =>
    parseCanonicalDecimal(plans.reduce((s, p) => s.plus(p[key]), new Decimal(0)).toFixed());
  const plan = {
    policyVersion: request.policyVersion, inputHash: hashCanonicalValue({ request, distribution }),
    consumedSources: plans.flatMap(p => p.consumedSources),
    unusedSources: request.sources[0].quantity > distribution.length
      ? [{ sourceBatchId: request.sources[0].sourceBatchId, quantity: request.sources[0].quantity - distribution.length }] : [],
    placements: plans.flatMap(p => p.placements),
    cuts: plans.flatMap(p => p.cuts).map((c, sequence) => ({ ...c, sequence })),
    remainders: plans.flatMap(p => p.remainders),
    longitudinalCutMeters: sum('longitudinalCutMeters'), crossCutMeters: sum('crossCutMeters'),
    calibrationMeters: sum('calibrationMeters'), kerfWasteSquareMeters: sum('kerfWasteSquareMeters')
  };
  return { ok: true, plan: { ...plan, resultHash: hashCanonicalValue(plan) } };
};
