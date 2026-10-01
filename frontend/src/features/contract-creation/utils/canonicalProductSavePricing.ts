import { parseCanonicalDecimal, sumContractMonetaryAmounts } from '@sabalanerp/contract-product-graph';

type Amount = string | number;

/** Persist versioned calculation facts; never recalculate money from display geometry. */
export const canonicalProductSavePricing = (
  facts: {
    materialBase: Amount;
    mandatoryAmount?: Amount;
    cuttingCost: Amount;
    totalAmount: Amount;
  },
  toolsCost: Amount = 0,
  finishingCost: Amount = 0
) => {
  const exactAmounts = {
    policyVersion: 'canonical-save-decimal-v1' as const,
    materialBase: parseCanonicalDecimal(String(facts.materialBase)),
    mandatoryAmount: parseCanonicalDecimal(String(facts.mandatoryAmount ?? 0)),
    cuttingCost: parseCanonicalDecimal(String(facts.cuttingCost)),
    toolsCost: parseCanonicalDecimal(String(toolsCost)),
    finishingCost: parseCanonicalDecimal(String(finishingCost)),
    totalPrice: sumContractMonetaryAmounts([facts.totalAmount, toolsCost, finishingCost])
  };
  return {
    authority: 'canonical-current-save' as const,
    materialBase: Number(facts.materialBase),
    mandatoryAmount: Number(facts.mandatoryAmount ?? 0),
    cuttingCost: Number(facts.cuttingCost),
    toolsCost: Number(toolsCost),
    finishingCost: Number(finishingCost),
    totalPrice: Number(exactAmounts.totalPrice),
    exactAmounts
  };
};
